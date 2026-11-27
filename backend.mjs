import { createPeer, deviceName, lan, localAddresses } from './peer-sync.mjs';
import { localAuthority } from './local-ca.mjs';
import { track } from './peer-data.mjs';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, chmodSync, lstatSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { readJsonObject } from './request-body.mjs';
import { createSecretStore, createSecret, protectionLabel } from './secret-store.mjs';
import { openVault, recoverVault, passwordSecret } from './vault.mjs';
import { createUpdater } from './updater.mjs';
import { initFinance, restoreBankNames, overview, portfolioHistory, editFinance, ruleChanges, synchronize } from './finance.mjs';
import { resumo } from './public/resumo.mjs';

const port = Number(process.env.PORT || 4173);
const instance = randomUUID();
// Na instalação de desktop os dados ficam na pasta do usuário; no Docker e no Node direto, em ./data.
const dataDir = process.env.MONETA_DATA_DIR || 'data';
const desktop = process.env.MONETA_DESKTOP === '1';
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
// Dados financeiros e credenciais só para o dono: pasta 0700 e arquivos 0600, inclusive os que
// versões antigas ou backups manuais criaram com permissões abertas.
function restrictPermissions() {
  if (process.platform === 'win32') return;
  chmodSync(dataDir, 0o700);
  for (const file of readdirSync(dataDir)) {
    const path = join(dataDir, file);
    if (lstatSync(path).isFile()) chmodSync(path, 0o600);
  }
}
restrictPermissions();

// Credenciais da Pluggy: lacradas pelo sistema quando possível (veja secret-store.mjs).
const secrets = createSecretStore(dataDir);
let credentials;
let credentialsError = null;
try {
  credentials = secrets.load();
} catch (error) {
  credentialsError = error.message;
  console.warn(error.message);
}
let credentialsFromEnv = !credentials && Boolean(process.env.PLUGGY_CLIENT_ID);
credentials ??= { clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET };
function configured() {
  return Boolean(credentials.clientId && credentials.clientSecret);
}
function saveCredentials(pair) {
  try { secrets.save(pair); } catch (error) { fail(500, error.message); }
  credentials = pair;
  credentialsError = null;
  credentialsFromEnv = false;
}

// Chave de acesso da instalação. Quem abre a Moneta pelo atalho recebe um cookie com ela; sem o
// cookie, a API não responde. Isso fecha a porta para outros usuários do computador e para
// processos que não conseguem ler a pasta de dados.
const accessFile = join(dataDir, 'acesso.key');
let accessKey;
try { accessKey = readFileSync(accessFile, 'utf8').trim(); } catch {}
if (!/^[A-Za-z0-9_-]{43}$/.test(accessKey ?? '')) {
  accessKey = randomBytes(32).toString('base64url');
  writeFileSync(accessFile, accessKey, { mode: 0o600 });
}
const digest = value => createHash('sha256').update(String(value)).digest();
const sameKey = value => timingSafeEqual(digest(value), digest(accessKey));
const cookieName = 'moneta_acesso';
// Programas locais (a janela nativa da Moneta, a Ayla) mandam a mesma chave em
// Authorization: Bearer. Um site não consegue enviar esse cabeçalho para cá sem CORS, que o
// Moneta não libera, então isso não abre caminho para CSRF.
function authorized(req) {
  const bearer = /^Bearer ([A-Za-z0-9_-]{1,100})$/.exec(req.headers.authorization || '')?.[1];
  if (bearer) return sameKey(bearer);
  const cookie = (req.headers.cookie || '').split(';').map(part => part.trim().split('='))
    .find(([key]) => key === cookieName)?.[1];
  return Boolean(cookie) && sameKey(cookie);
}

// Cofre do banco (vault.mjs): o SQLite roda na memória e o disco só guarda moneta.cofre, cifrado com
// AES-256-GCM. A chave fica lacrada pelo sistema, como as credenciais. Sem a chave (TPM resetado,
// outro computador), a Moneta sobe trancada e pede a chave de recuperação.
// No modo cofre, a chave também depende de uma senha: a Moneta sobe trancada, pede a senha e
// tranca de novo depois de um tempo sem uso.
const vaultSecret = createSecret(dataDir, { name: 'moneta-banco', base: 'banco' });
const passwordStore = createSecret(dataDir, { name: 'moneta-banco-senha', base: 'banco-senha' });
const pendingRecovery = join(dataDir, 'cofre.pendente');
let vault = null;
let locked = null;
let lockReason = null;
let unlockedWith = null;
let db;
let clientUserId;
// Trancado, o app usa um banco vazio só para subir; nada dele é gravado.
function openDatabase(opened) {
  vault = opened;
  db = opened?.db ?? new DatabaseSync(':memory:');
  db.exec('PRAGMA trusted_schema = OFF; PRAGMA temp_store = MEMORY;');
  db.exec('CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY, uuid TEXT NOT NULL); CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, institution TEXT NOT NULL, status TEXT NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO profile VALUES (1, ?)').run(randomUUID());
  clientUserId = db.prepare('SELECT uuid FROM profile WHERE id=1').get().uuid;
  initFinance(db);
  restoreBankNames(db);
  persist();
  restrictPermissions();
}
function persist() {
  if (!vault) return;
  // Marca a hora de cada alteração para a sincronização entre aparelhos.
  if (!locked) track(db);
  vault.persist();
}
if (passwordStore.exists()) {
  locked = 'A Moneta está trancada. Digite a senha.';
  lockReason = 'senha';
  openDatabase(null);
} else {
  try {
    const opened = openVault(dataDir, vaultSecret);
    if (opened.created) writeFileSync(pendingRecovery, '', { mode: 0o600 });
    openDatabase(opened);
  } catch (error) {
    if (!['NO_KEY', 'BAD_KEY', 'UNSEAL_FAILED'].includes(error.code)) throw error;
    locked = error.message;
    lockReason = 'chave';
    console.warn('Cofre trancado: ' + error.message + ' Use a chave de recuperação.');
    openDatabase(null);
  }
}
// Tentativas de senha: depois da terceira errada, espera crescente (até 5 minutos).
let failures = 0;
let retryAt = 0;
let lastActivity = Date.now();
const idleMinutes = () => Number(unlockedWith?.settings.idle) || 15;
const summary = () => {
  const { transactions, accounts, categories } = overview(db);
  return { transactions: transactions.length, accounts: accounts.length, categories: categories.length,
    connections: db.prepare('SELECT count(*) AS n FROM connections').get().n };
};
function autoBackup() {
  if (!vault || locked) return;
  try {
    const name = vault.autoBackup(summary());
    if (name) console.log('Backup automático criado e testado: ' + name);
  } catch (error) { console.error('Falha no backup automático: ' + error.message); }
}
autoBackup();
let syncJob;
let restarting = false;
const edits = ['/api/categories/edit','/api/categories/remove','/api/wallet','/api/categories/color','/api/rules/edit','/api/transaction','/api/settings/currency','/api/categories','/api/rules','/api/rules/remove','/api/rules/import','/api/rules/apply','/api/assignment','/api/vouchers','/api/vouchers/remove','/api/goals','/api/goals/remove','/api/goals/deposit','/api/goals/deposit/remove'];
const assets = new Map([
  ['/peer-ui.mjs',['text/javascript','peer-ui.mjs']],
  ['/device-unlock.mjs',['text/javascript','device-unlock.mjs']],
  ['/appearance.mjs', ['text/javascript', 'appearance.mjs']],
  ['/drawer.mjs',['text/javascript','drawer.mjs']],
  ['/vendor/qrcode.mjs',['text/javascript','vendor/qrcode.mjs']],
  ['/vendor/jsQR.js',['text/javascript','vendor/jsQR.js']],
  ['/', ['text/html', 'index.html']],
  ['/app.js', ['text/javascript', 'app.js']],
  ['/theme.js', ['text/javascript', 'theme.js']],
  ['/movement.mjs', ['text/javascript','movement.mjs']],
  ['/card-periods.mjs', ['text/javascript','card-periods.mjs']],
  ['/forecast.mjs', ['text/javascript','forecast.mjs']],
  ['/portfolio.js', ['text/javascript', 'portfolio.js']],
  ['/report.mjs', ['text/javascript', 'report.mjs']],
  ['/guide.js', ['text/javascript', 'guide.js']],
  ['/date-field.mjs', ['text/javascript', 'date-field.mjs']],
  ['/finance.js', ['text/javascript', 'finance.js']],
  ['/style.css', ['text/css', 'style.css']],
  ['/favicon.svg', ['image/svg+xml', 'favicon.svg']],
  ['/logo.png', ['image/png', 'logo.png']],
  ['/favicon.ico', ['image/x-icon', 'favicon.ico']],
  ['/favicon-96x96.png', ['image/png', 'favicon-96x96.png']],
  ['/apple-touch-icon.png', ['image/png', 'apple-touch-icon.png']],
  ['/web-app-manifest-192x192.png', ['image/png', 'web-app-manifest-192x192.png']],
  ['/web-app-manifest-512x512.png', ['image/png', 'web-app-manifest-512x512.png']],
  ['/site.webmanifest', ['application/manifest+json', 'site.webmanifest']],
  ['/fonts/GoudyBookletter1911.ttf', ['font/ttf', 'fonts/GoudyBookletter1911.ttf']],
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
const syncInterval = 6 * 60 * 60 * 1000;
let lastAttempt = 0;
function sync() {
  if (syncJob) return syncJob;
  lastAttempt = Date.now();
  syncJob = authenticate().then(key => synchronize(db,path => pluggy(path,key))).then(() => persist()).finally(() => { syncJob = null; });
  return syncJob;
}
const syncTimer = setInterval(() => {
  if (locked || !configured() || restarting || syncJob || Date.now()-lastAttempt < syncInterval) return;
  const count = db.prepare('SELECT count(*) AS total FROM connections').get().total;
  if (!count) return;
  const stats = db.prepare('SELECT count(*) AS total, min(updated) AS oldest FROM snapshots').get();
  if (stats.total >= count && Date.now()-Date.parse(stats.oldest) < syncInterval) return;
  sync().catch(() => console.warn('Falha na sincronização automática da Pluggy. A cópia local foi preservada.'));
},60_000);
syncTimer.unref();
const backupTimer = setInterval(autoBackup, 60 * 60 * 1000);
backupTimer.unref();
// Modo cofre: tranca depois de um tempo sem uso. Trancar reinicia o processo, que sobe pedindo a
// senha; assim nada do banco aberto fica na memória.
const idleTimer = setInterval(() => {
  if (!unlockedWith || locked || restarting || Date.now() - lastActivity < idleMinutes() * 60_000) return;
  console.log('Moneta trancada depois de ' + idleMinutes() + ' minutos sem uso.');
  stop('restart');
}, 30_000);
idleTimer.unref();

// O app só carrega scripts próprios e o widget da Pluggy, não pode ser embutido em outro site e
// não vaza o endereço em links externos.
const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'none'", "script-src 'self' https://cdn.pluggy.ai", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://*.pluggy.ai", "font-src 'self'", "connect-src 'self' https://*.pluggy.ai",
    "frame-src https://*.pluggy.ai", "manifest-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
};

// Rede de segurança: grava o que tiver mudado e ainda não foi para o cofre.
const persistTimer = setInterval(() => {
  try { persist(); } catch (error) { console.error('Falha ao gravar o cofre: ' + error.message); }
}, 15_000);
persistTimer.unref();
// systemd, Ctrl+C e o fechamento da janela no Windows: grava antes de sair.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    try { persist(); } catch (error) { console.error('Falha ao gravar o cofre: ' + error.message); }
    process.exit(0);
  });
}

// Reinicia ou encerra o processo, gravando o cofre antes. Usado pelas rotas e ao trancar.
function stop(kind) {
  restarting = true;
  peer.close();
  webPeer.close();
  server.close(() => {
    clearInterval(syncTimer);
    const close = () => {
      try { persist(); } catch (error) { console.error('Falha ao gravar o cofre: ' + error.message); }
      db.close();
      if (process.send) process.send(kind, () => process.disconnect());
      else process.exit(0);
    };
    if (syncJob) syncJob.then(close, close);
    else close();
  });
  server.closeAllConnections?.();
}

// Confere a senha do modo cofre, com a mesma espera crescente depois de três erros.
function checkPassword(password) {
  if (Date.now() < retryAt) return { valid: false, error: 'Muitas tentativas. Espere ' + Math.ceil((retryAt - Date.now()) / 1000) + ' segundos.' };
  try { passwordSecret(passwordStore, password).load(); }
  catch (error) {
    if (error.code !== 'BAD_PASSWORD') return { valid: false, error: error.message };
    failures++;
    if (failures >= 3) retryAt = Date.now() + Math.min(2 ** (failures - 2), 300) * 1000;
    return { valid: false };
  }
  failures = 0;
  return { valid: true };
}
// Liga o modo cofre: troca a chave do cofre (cópias da chave lacrada sem senha deixam de valer)
// e devolve a nova chave de recuperação.
const idleChoices = [5, 15, 30, 60, 240];
function enablePassword(password, idle) {
  const secret = passwordSecret(passwordStore, password, { idle });
  vault.useSecret(secret);
  vaultSecret.remove();
  unlockedWith = secret;
  vault.rotate();
  writeFileSync(pendingRecovery, '', { mode: 0o600 });
  autoBackup();
  return vault.recoveryCode();
}
// Instalação nova: sem senha, sem vínculos e sem nada guardado pela pessoa. Só nela o vínculo
// pela primeira abertura pode trazer a senha do cofre de origem.
function fresh() {
  if (unlockedWith || peer.status().devices.length || webPeer.status().devices.length) return false;
  return ['connections', 'snapshots', 'wallet', 'vouchers', 'goals', 'rules', 'assignments', 'notes']
    .every(table => !db.prepare('SELECT 1 FROM ' + table + ' LIMIT 1').get());
}
// Vínculos feitos numa instalação nova com uma Moneta que usa senha, até a senha ser conferida.
const inheritable = new Map();

let panelSeen = 0;
const markPeerPanel = () => { panelSeen = Date.now(); };
// Só sincroniza com a Moneta aberta e destrancada: com a janela fechada, a rede não vê os dados.
const peerDatabase = () => locked || restarting || Date.now() - panelSeen > 25000 ? null : db;
const peerAddresses = process.env.MONETA_WIFI_IP ? () => [process.env.MONETA_WIFI_IP] : localAddresses;
// Perfil com o certificado da autoridade local, entregue ao iPhone ou iPad durante o vínculo.
let authority, profileUntil = 0;
const localCa = () => authority ??= localAuthority(createSecret(dataDir, {name:'moneta-autoridade',base:'autoridade-local'}), deviceName());
// Quem lê o QR fica sabendo se este cofre usa senha e pode conferir a senha logo depois do vínculo.
const vaultInfo = () => ({ password: Boolean(unlockedWith), idle: idleMinutes() });
const verifyPassword = password => unlockedWith ? { ...checkPassword(password), idle: idleMinutes() } : { valid: false };
const peer = createPeer({
  database: peerDatabase,
  persist,
  vault: vaultInfo,
  verify: verifyPassword,
  store: createSecret(dataDir, {name:'moneta-par',base:'par-local'}),
  addresses: peerAddresses,
  profile: () => profileUntil > Date.now() ? localCa().profile() : null,
});
// Endereço onde a Moneta Web está publicada. MONETA_WEB_ORIGIN troca por outro, separado por vírgulas.
const webOrigins = (process.env.MONETA_WEB_ORIGIN || 'https://feittosaa.github.io').split(',').map(origin => origin.trim()).filter(Boolean);
const webPeer = createPeer({
  database: peerDatabase,
  persist,
  vault: vaultInfo,
  verify: verifyPassword,
  store: createSecret(dataDir, {name:'moneta-par-web',base:'par-web'}),
  addresses: peerAddresses,
  port: Number(process.env.MONETA_WEB_PORT || 4175),
  web: { tls: ips => localCa().issue(ips), origins: () => webOrigins },
});
const peerStatus = () => ({name:deviceName(),devices:[
  ...peer.status().devices.map(device => ({...device,kind:'local'})),
  ...webPeer.status().devices.map(device => ({...device,kind:'web'})),
],pending:peer.status().pending || webPeer.status().pending,change:peer.status().change + webPeer.status().change,fresh:fresh()});
const updater = createUpdater({ dataDir, desktop, stop });

const server = http.createServer(async (req, res) => {
  for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
  const json = (status, value) => {
    // Toda alteração confirmada já está no cofre em disco antes da resposta.
    if (req.method === 'POST' && status < 400) {
      try { persist(); } catch (error) {
        console.error('Falha ao gravar o cofre: ' + error.message);
        status = 500; value = { error: 'A alteração não pôde ser gravada no cofre. Tente de novo.' };
      }
    }
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  try {
    const host = req.headers.host;
    if (!['localhost:' + port, '127.0.0.1:' + port].includes(host)) fail(403, 'Host inválido.');
    const allowed = authorized(req);
    if (req.method === 'GET' && req.url === '/api/status') {
      // Público só o necessário para o atalho saber se a Moneta já está aberta.
      // api: versão do contrato com programas locais (docs/integracao.md).
      if (!allowed) return json(200, {api:1,instance,desktop,boot:process.env.MONETA_BOOT_ID,locked:Boolean(locked),lock:lockReason});
      const {updated} = db.prepare('SELECT max(updated) AS updated FROM snapshots').get();
      return json(200, {api:1,instance,updated,desktop,locked:Boolean(locked),lock:lockReason,authorized:true});
    }
    // Entrada pelo atalho: troca a chave da URL por um cookie e tira a chave do endereço.
    const entry = req.method === 'GET' && /^\/entrar\?chave=([A-Za-z0-9_-]{1,100})$/.exec(req.url);
    if (entry) {
      if (!sameKey(entry[1])) fail(403, 'Chave de acesso inválida. Abra a Moneta pelo atalho.');
      res.writeHead(303, {
        'Set-Cookie': `${cookieName}=${accessKey}; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000`,
        'Location': '/', 'Cache-Control': 'no-store',
      });
      return res.end();
    }
    // Guias do app: o Markdown e as imagens ficam em docs/guia, lidos também pelo GitHub. O guia do
    // celular fica em docs/guia-celular.md, onde o README aponta, e é servido como /guia/celular.md.
    const guide = req.method === 'GET' && /^\/guia\/([a-z0-9-]+\.(md|svg|png))$/.exec(req.url);
    if (guide) {
      const types = { md:'text/markdown; charset=utf-8', svg:'image/svg+xml', png:'image/png' };
      const path = guide[1] === 'celular.md' ? 'docs/guia-celular.md' : 'docs/guia/' + guide[1];
      let file;
      try { file = readFileSync(new URL(path, import.meta.url)); }
      catch { fail(404, 'Arquivo do guia não encontrado.'); }
      res.writeHead(200, { 'Content-Type': types[guide[2]], 'Cache-Control': 'no-cache' });
      res.end(file);
      return;
    }
    if (req.method === 'GET' && assets.has(req.url)) {
      const [type, file] = assets.get(req.url);
      res.setHeader('Content-Type', /^(?:image\/(?:png|x-icon)|font\/ttf)$/.test(type) ? type : type + '; charset=utf-8');
      // Sem esse cabeçalho a janela reaproveitava módulos antigos depois de atualizar: o index.html e o
      // finance.js vinham novos e o report.mjs e o card-periods.mjs ficavam na versão anterior.
      res.setHeader('Cache-Control', 'no-cache');
      res.end(readFileSync(new URL('public/' + file, import.meta.url)));
      return;
    }
    if (req.url.startsWith('/api/') && !allowed) fail(401, 'Acesso não autorizado. Abra a Moneta pelo atalho do menu ou pelo comando moneta.');
    if (locked && req.url.startsWith('/api/') && !['/api/recovery', '/api/restart', '/api/shutdown', '/api/unlock'].includes(req.url)) {
      fail(423, lockReason === 'senha' ? 'A Moneta está trancada. Digite a senha.' : 'O cofre do banco está trancado. Informe a chave de recuperação.');
    }
    if (!req.url.startsWith('/api/peer')) lastActivity = Date.now();
    if (req.method === 'GET' && req.url === '/api/peer') {
      markPeerPanel();
      return json(200,peerStatus());
    }
    if (req.method === 'GET' && req.url === '/api/vault') {
      return json(200, { protection: protectionLabel(vaultSecret.sealer), pending: existsSync(pendingRecovery),
        password: Boolean(unlockedWith), idle: idleMinutes(), backups: vault.listBackups() });
    }
    // Backup cifrado e testado, para guardar fora do computador. Abre com a chave de recuperação atual.
    const download = req.method === 'GET' && /^\/api\/backup(?:s\/(moneta-[\w-]+\.monetabackup))?$/.exec(req.url);
    if (download) {
      let data, name = download[1];
      if (name) {
        try { data = vault.readBackup(name); } catch { fail(404, 'Backup não encontrado.'); }
      } else {
        const made = vault.backup(summary());
        data = made.data;
        name = 'moneta-' + made.manifest.created.slice(0, 10) + '.monetabackup';
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
      return res.end(data);
    }
    if (req.method === 'GET' && req.url === '/api/connections') {
      return json(200, { configured: configured(), protection: credentialsFromEnv ? 'ambiente' : secrets.protection, credentialsError, connections: db.prepare('SELECT * FROM connections ORDER BY institution, id').all() });
    }
    if (req.method === 'GET' && req.url === '/api/update') return json(200, await updater.status());
    if (req.method === 'GET' && req.url === '/api/portfolio') return json(200, portfolioHistory(db));
    if (req.method === 'GET' && req.url === '/api/finance') return json(200, overview(db));
    if (req.method === 'GET' && req.url === '/api/resumo') return json(200, resumo(overview(db)));
    if (req.method === 'GET' && req.url === '/api/rules/preview') return json(200, ruleChanges(db));
    if (req.method !== 'POST' || !['/api/peer/invite','/api/peer/join','/api/peer/inherit','/api/peer/check','/api/peer/forget','/api/connect-token', '/api/connections','/api/sync', '/api/settings/pluggy', '/api/restart', '/api/shutdown', '/api/recovery', '/api/vault/code', '/api/vault/rotate', '/api/vault/confirm', '/api/vault/password', '/api/vault/password/remove', '/api/vault/password/check', '/api/vault/password/idle', '/api/vault/lock', '/api/unlock', '/api/backup/restore', '/api/connections/import', '/api/update/install', ...edits].includes(req.url)) fail(404, 'Rota desconhecida.');
    if (req.headers.origin !== 'http://' + host) fail(403, 'Origem inválida.');
    const mediaType = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
    if (mediaType !== 'application/json') fail(415, 'Envie o corpo como application/json.');
    const body = await readJsonObject(req, req.url.startsWith('/api/rules') ? 2 * 1024 * 1024 : req.url === '/api/backup/restore' ? 64 * 1024 * 1024 : req.url === '/api/transaction' ? 16384 : undefined);
    if (restarting) fail(503, 'O servidor está reiniciando.');
    // Primeira abertura: o cofre novo passa a usar a mesma senha da Moneta de onde veio o QR.
    if (req.url === '/api/peer/inherit') {
      markPeerPanel();
      const since = typeof body.id === 'string' && inheritable.get(body.id);
      if (!since || Date.now() - since > 10 * 60 * 1000 || unlockedWith) fail(409, 'Este aparelho não pode mais usar a senha da outra Moneta. Ligue o modo cofre em Configuração.');
      if (typeof body.password !== 'string' || !body.password) fail(400, 'Digite a senha.');
      let result;
      try { result = await peer.verify(body.id, body.password); } catch (error) { fail(502, error.message); }
      if (!result.valid) fail(403, result.error || 'Senha errada. Use a mesma senha da outra Moneta.');
      inheritable.delete(body.id);
      enablePassword(body.password, idleChoices.includes(result.idle) ? result.idle : 15);
      return json(200, { ok: true });
    }
    if (req.url.startsWith('/api/peer/')) {
      markPeerPanel();
      try {
        if (req.url.endsWith('/invite')) {
          if (body.kind !== 'web') return json(200,await peer.invite());
          // O iPhone baixa o perfil pelo Safari, em HTTP, antes de confiar no HTTPS da Moneta.
          profileUntil = Date.now() + 10 * 60 * 1000;
          const port = await peer.share(10 * 60 * 1000);
          const invite = await webPeer.invite();
          return json(200,{...invite,profiles:peerAddresses().filter(lan).map(ip => 'http://'+ip+':'+port+'/moneta.mobileconfig')});
        }
        if (req.url.endsWith('/join')) {
          const blank = fresh();
          const { joined } = await peer.join(body.code);
          if (blank && joined?.vault?.password) inheritable.set(joined.id, Date.now());
          return json(200,{...peerStatus(),joined:joined && {id:joined.id,name:joined.name,inherit:inheritable.has(joined.id)}});
        }
        if (req.url.endsWith('/forget')) {
          if (typeof body.id !== 'string') fail(400,'Escolha o aparelho.');
          (body.kind === 'web' ? webPeer : peer).forget(body.id);
        } else await Promise.all([peer.tick(),webPeer.tick()]);
        return json(200,peerStatus());
      } catch (error) { fail(400,error.message); }
    }
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
    // Chave de recuperação: mostrada enquanto não for confirmada como guardada. Depois disso, só
    // gerando uma nova, o que troca a chave do cofre e invalida a anterior.
    if (req.url === '/api/vault/code') {
      if (!existsSync(pendingRecovery)) fail(409, 'A chave de recuperação já foi guardada. Para ver uma, gere uma nova.');
      return json(200, { code: vault.recoveryCode() });
    }
    if (req.url === '/api/vault/rotate') {
      vault.rotate();
      writeFileSync(pendingRecovery, '', { mode: 0o600 });
      return json(200, { code: vault.recoveryCode() });
    }
    if (req.url === '/api/vault/confirm') {
      rmSync(pendingRecovery, { force: true });
      return json(200, { ok: true });
    }
    // Modo cofre. Ligar troca a chave do cofre (cópias da chave lacrada sem senha deixam de valer)
    // e mostra a nova chave de recuperação.
    const password = typeof body.password === 'string' ? body.password : '';
    const idle = Number(body.idle);
    if (req.url === '/api/vault/password' || req.url === '/api/vault/password/idle') {
      if (!idleChoices.includes(idle)) fail(400, 'Escolha um tempo de inatividade válido.');
    }
    if (req.url === '/api/vault/password') {
      if (unlockedWith) fail(409, 'O modo cofre já está ligado.');
      if ([...password].length < 8) fail(400, 'Use uma senha com pelo menos 8 caracteres.');
      return json(200, { code: enablePassword(password, idle) });
    }
    if (req.url === '/api/vault/password/idle') {
      if (!unlockedWith) fail(409, 'O modo cofre está desligado.');
      vault.reseal({ ...unlockedWith.settings, idle });
      return json(200, { ok: true });
    }
    if (req.url === '/api/vault/password/remove') {
      if (!unlockedWith) fail(409, 'O modo cofre está desligado.');
      try { passwordSecret(passwordStore, password).load(); } catch (error) { fail(403, error.code === 'BAD_PASSWORD' ? 'Senha errada.' : error.message); }
      vault.useSecret(vaultSecret);
      passwordStore.remove();
      unlockedWith = null;
      return json(200, { ok: true });
    }
    // Confere a senha sem mudar nada: o Android só guarda a senha para a biometria depois disso.
    if (req.url === '/api/vault/password/check') {
      if (!unlockedWith) fail(409, 'O modo cofre está desligado.');
      const { valid, error } = checkPassword(password);
      if (!valid) fail(error ? (error.startsWith('Muitas') ? 429 : 500) : 403, error || 'Senha errada.');
      return json(200, { ok: true });
    }
    if (req.url === '/api/unlock') {
      if (lockReason !== 'senha') fail(409, 'A Moneta não está trancada por senha.');
      if (Date.now() < retryAt) fail(429, 'Muitas tentativas. Espere ' + Math.ceil((retryAt - Date.now()) / 1000) + ' segundos.');
      const secret = passwordSecret(passwordStore, password);
      let opened;
      try { opened = openVault(dataDir, secret); }
      catch (error) {
        if (error.code !== 'BAD_PASSWORD') fail(500, error.message);
        failures++;
        if (failures >= 3) retryAt = Date.now() + Math.min(2 ** (failures - 2), 300) * 1000;
        fail(403, 'Senha errada.');
      }
      failures = 0;
      db.close();
      locked = lockReason = null;
      unlockedWith = secret;
      openDatabase(opened);
      vaultSecret.remove();
      lastActivity = Date.now();
      autoBackup();
      return json(200, { ok: true });
    }
    // Restauração: o arquivo é aberto e testado; sem confirm, só devolve o manifesto para conferir.
    // Antes de trocar o banco, um backup do estado atual vai para backups/.
    if (req.url === '/api/backup/restore') {
      let data;
      if (typeof body.name === 'string') {
        try { data = vault.readBackup(body.name); } catch { fail(404, 'Backup não encontrado.'); }
      } else if (typeof body.data === 'string') data = Buffer.from(body.data, 'base64');
      else fail(400, 'Envie o arquivo de backup.');
      let content;
      try { content = vault.openBackup(data, body.code || null); }
      catch (error) {
        if (error.code === 'OTHER_KEY') return json(409, { error: 'Este backup foi feito com outra chave de recuperação. Digite a chave que valia quando ele foi criado.', needsCode: true });
        fail(400, error.code === 'BAD_KEY' && body.code ? 'Essa chave de recuperação não abre este backup.' : error.message);
      }
      if (body.confirm !== true) return json(200, { manifest: content.manifest });
      vault.autoBackup(summary(), { every: 0 });
      vault.restore(content.dump);
      console.log('Backup de ' + content.manifest.created + ' restaurado; reiniciando.');
      req.url = '/api/restart';
    }
    if (req.url === '/api/vault/lock') {
      if (!unlockedWith) fail(409, 'O modo cofre está desligado.');
      req.url = '/api/restart';
    }
    if (req.url === '/api/recovery') {
      if (!locked) fail(409, 'O cofre já está aberta.');
      try { recoverVault(dataDir, vaultSecret, body.code); }
      catch (error) { fail(400, error.code === 'BAD_KEY' ? 'Essa chave de recuperação não abre este cofre.' : error.message); }
      // A chave de recuperação substitui a senha: o modo cofre desliga e pode ser ligado de novo.
      passwordStore.remove();
      console.log('Cofre aberto com a chave de recuperação; reiniciando.');
      req.url = '/api/restart';
    }
    if (req.url === '/api/update/install') {
      // A janela e o navegador entram com o cookie; a Ayla e outros programas locais, com a chave
      // no cabeçalho. Para eles, a Moneta atualizada volta sem abrir uma janela separada.
      const window = !/^Bearer /.test(req.headers.authorization || '');
      try { return json(202, { ...(await updater.install({ window })), instance }); }
      catch (error) { fail(error.status || 502, error.message); }
    }
    if (req.url === '/api/restart' || req.url === '/api/shutdown') {
      // Encerrar só existe na instalação de desktop; no Docker o container cuida do ciclo de vida.
      if (req.url === '/api/shutdown' && !desktop) fail(404, 'Rota desconhecida.');
      const kind = req.url === '/api/restart' ? 'restart' : 'shutdown';
      restarting = true;
      res.once('finish', () => stop(kind));
      return json(202, { instance });
    }
    if (edits.includes(req.url)) {
      const result = editFinance(db, req.url, body);
      return json(200, result ?? {ok:true});
    }
    if (!configured()) fail(503, 'Cadastre as credenciais da Pluggy em Configuração.');
    const id = body.itemId;
    const importing = req.url === '/api/connections/import';
    if ((importing || req.url === '/api/connections') && (typeof id !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) fail(400, 'Identificador inválido.');
    if (req.url === '/api/sync') {
      await sync();
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
server.listen(port, process.env.MONETA_BIND_ADDRESS || '127.0.0.1', () => {
  console.log('Moneta em http://127.0.0.1:' + port);
  // No Docker e no Node direto não há atalho: o endereço de entrada sai no log, visível só a quem
  // já pode ler os logs ou a pasta de dados. O app instalado abre o navegador já com ele.
  if (!desktop) console.log('Para entrar neste navegador: http://127.0.0.1:' + port + '/entrar?chave=' + accessKey);
  process.send?.('ready');
});
