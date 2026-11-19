import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';

import { readJsonObject } from './request-body.mjs';
import { initFinance, restoreBankNames, overview, editFinance, synchronize } from './finance.mjs';

const port = Number(process.env.PORT || 4173);
const instance = randomUUID();
const settingsFile = 'data/pluggy.json';
mkdirSync('data', { recursive: true, mode: 0o700 });
let credentials;
try {
  credentials = JSON.parse(readFileSync(settingsFile, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  credentials = { clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET };
}
function configured() {
  return Boolean(credentials.clientId && credentials.clientSecret);
}
function saveCredentials(pair) {
  const tmp = settingsFile + '.' + randomUUID();
  try {
    writeFileSync(tmp, JSON.stringify(pair), { mode: 0o600, flag: 'wx' });
    renameSync(tmp, settingsFile);
    credentials = pair;
  } finally {
    rmSync(tmp, { force: true });
  }
}
const db = new DatabaseSync('data/moneta.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY, uuid TEXT NOT NULL); CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, institution TEXT NOT NULL, status TEXT NOT NULL)');
db.prepare('INSERT OR IGNORE INTO profile VALUES (1, ?)').run(randomUUID());
const clientUserId = db.prepare('SELECT uuid FROM profile WHERE id=1').get().uuid;
initFinance(db);
restoreBankNames(db);
let syncJob;
let restarting = false;
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
async function authenticate(pair = credentials) {
  const { apiKey } = await pluggy('/auth', null, pair);
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
    if (req.method === 'GET' && req.url === '/api/status') return json(200, { instance });
    if (req.method === 'GET' && assets.has(req.url)) {
      const [type, file] = assets.get(req.url);
      res.setHeader('Content-Type', type + '; charset=utf-8');
      res.end(readFileSync(new URL('public/' + file, import.meta.url)));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/connections') {
      return json(200, { configured: configured(), connections: db.prepare('SELECT * FROM connections ORDER BY institution, id').all() });
    }
    if (req.method === 'GET' && req.url === '/api/finance') return json(200, overview(db));
    if (req.method !== 'POST' || !['/api/connect-token', '/api/connections','/api/sync', '/api/settings/pluggy', '/api/restart', '/api/connections/import', ...edits].includes(req.url)) fail(404, 'Rota desconhecida.');
    if (req.headers.origin !== 'http://' + host) fail(403, 'Origem inválida.');
    const mediaType = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
    if (mediaType !== 'application/json') fail(415, 'Envie o corpo como application/json.');
    const body = await readJsonObject(req);
    if (restarting) fail(503, 'O servidor está reiniciando.');
    if (req.url === '/api/settings/pluggy') {
      const pair = {};
      for (const field of ['clientId', 'clientSecret']) {
        if (typeof body[field] !== 'string' || !body[field].trim()) fail(400, 'Preencha o Client ID e o Client Secret.');
        pair[field] = body[field].trim();
      }
      await authenticate(pair);
      saveCredentials(pair);
      return json(200, { ok: true });
    }
    if (req.url === '/api/restart') {
      restarting = true;
      res.once('finish', () => {
        server.close(() => {
          db.close();
          process.send('restart', () => process.disconnect());
        });
      });
      return json(202, { instance });
    }
    if (edits.includes(req.url)) {
      editFinance(db, req.url, body);
      return json(200, {ok:true});
    }
    if (!configured()) fail(503, 'Cadastre as credenciais da Pluggy em Configuração.');
    const id = body.itemId;
    const importing = req.url === '/api/connections/import';
    if ((importing || req.url === '/api/connections') && (typeof id !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) fail(400, 'Identificador inválido.');
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
    if (item.id !== id || (item.clientUserId != null && item.clientUserId !== clientUserId)) fail(403, 'Conexão de outro perfil.');
    if (!importing && item.clientUserId == null) {
      if (typeof body.connectToken !== 'string' || !body.connectToken) fail(403, 'Sessão de conexão ausente.');
      const authorized = await pluggy('/items/' + id, body.connectToken);
      if (authorized.id !== id) fail(403, 'Item fora da sessão de conexão.');
    }
    if (!importing && item.status !== 'UPDATED') fail(409, 'A Pluggy ainda não confirmou a coleta dos dados. Tente conectar novamente quando ela terminar.');
    db.prepare('INSERT INTO connections VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET institution=excluded.institution, status=excluded.status')
      .run(id, item.connector.name, item.status);
    json(200, { id });
  } catch (error) {
    json(error.status || 502, { error: error.status ? error.message : 'Não foi possível concluir a operação. Tente novamente.' });
  }
});
server.listen(port, process.env.MONETA_BIND_ADDRESS || '127.0.0.1', () => console.log('Moneta em http://127.0.0.1:' + port));
