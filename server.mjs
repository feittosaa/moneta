import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';

import { readJsonObject } from './request-body.mjs';
import { initFinance, overview, editFinance, synchronize } from './finance.mjs';

const port = Number(process.env.PORT || 4173);
const { PLUGGY_CLIENT_ID: clientId, PLUGGY_CLIENT_SECRET: clientSecret } = process.env;
const configured = Boolean(clientId && clientSecret);
mkdirSync('data', { recursive: true, mode: 0o700 });
const db = new DatabaseSync('data/moneta.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY, uuid TEXT NOT NULL); CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, institution TEXT NOT NULL, status TEXT NOT NULL)');
db.prepare('INSERT OR IGNORE INTO profile VALUES (1, ?)').run(randomUUID());
const clientUserId = db.prepare('SELECT uuid FROM profile WHERE id=1').get().uuid;
initFinance(db);
let syncJob;
const edits = ['/api/categories','/api/rules','/api/rules/remove','/api/assignment'];
const assets = new Map([
  ['/', ['text/html', 'index.html']],
  ['/app.js', ['text/javascript', 'app.js']],
  ['/report.mjs', ['text/javascript', 'report.mjs']],
  ['/finance.js', ['text/javascript', 'finance.js']],
  ['/style.css', ['text/css', 'style.css']],
]);
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
async function pluggy(path, apiKey, body) {
  const response = await fetch('https://api.pluggy.ai' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) fail(502, 'A Pluggy recusou a solicitação. Verifique suas credenciais e tente novamente.');
  return response.json();
}
async function authenticate() {
  const { apiKey } = await pluggy('/auth', null, { clientId, clientSecret });
  if (!apiKey) fail(502, 'Resposta de autenticação inválida.');
  return apiKey;
}
const server = http.createServer(async (req, res) => {
  const json = (status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  try {
    const host = req.headers.host;
    if (!['localhost:' + port, '127.0.0.1:' + port].includes(host)) fail(403, 'Host inválido.');
    if (req.method === 'GET' && assets.has(req.url)) {
      const [type, file] = assets.get(req.url);
      res.setHeader('Content-Type', type + '; charset=utf-8');
      res.end(readFileSync(new URL('public/' + file, import.meta.url)));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/connections') {
      return json(200, { configured, connections: db.prepare('SELECT * FROM connections ORDER BY institution, id').all() });
    }
    if (req.method === 'GET' && req.url === '/api/finance') return json(200, overview(db));
    if (req.method !== 'POST' || !['/api/connect-token', '/api/connections','/api/sync', ...edits].includes(req.url)) fail(404, 'Rota desconhecida.');
    if (req.headers.origin !== 'http://' + host) fail(403, 'Origem inválida.');
    const mediaType = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
    if (mediaType !== 'application/json') fail(415, 'Envie o corpo como application/json.');
    const body = await readJsonObject(req);
    if (edits.includes(req.url)) {
      editFinance(db, req.url, body);
      return json(200, {ok:true});
    }
    if (!configured) fail(503, 'Configure as credenciais Pluggy e reinicie a Moneta.');
    const id = body.itemId;
    if (req.url === '/api/connections' && (typeof id !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) fail(400, 'Identificador inválido.');
    if (req.url === '/api/sync') {
      syncJob ??= authenticate().then(key => synchronize(db, path => pluggy(path, key))).finally(() => { syncJob = null; });
      await syncJob;
      return json(200, {ok:true});
    }
    const apiKey = await authenticate();
    if (req.url === '/api/connect-token') {
      const { accessToken } = await pluggy('/connect_token', apiKey, { clientUserId });
      if (!accessToken) fail(502, 'Token indisponível.');
      return json(200, { accessToken });
    }
    const item = await pluggy('/items/' + id, apiKey);
    if (item.id !== id || item.clientUserId !== clientUserId) fail(403, 'Conexão de outro perfil.');
    db.prepare('INSERT INTO connections VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET institution=excluded.institution, status=excluded.status')
      .run(id, item.connector.name, item.status);
    json(200, { id });
  } catch (error) {
    json(error.status || 502, { error: error.status ? error.message : 'Não foi possível concluir a operação. Tente novamente.' });
  }
});
server.listen(port, process.env.MONETA_BIND_ADDRESS || '127.0.0.1', () => console.log('Moneta em http://127.0.0.1:' + port));
