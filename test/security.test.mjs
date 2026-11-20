// Sobe o servidor de verdade numa pasta temporária e confere as proteções de acesso e de arquivos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { initFinance, editFinance } from '../finance.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 4187;
const base = 'http://127.0.0.1:' + port;
const mode = file => (statSync(file).mode & 0o777).toString(8);

function start(dir, output) {
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), MONETA_DATA_DIR: dir, MONETA_SECRET_STORE: 'arquivo', PLUGGY_CLIENT_ID: '', PLUGGY_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => { output.text += chunk; });
  return server;
}
async function ready(output) {
  for (let i = 0; i < 100 && !output.text.includes('/entrar?chave='); i++) await new Promise(r => setTimeout(r, 100));
}

test('acesso à API, cabeçalhos, cofre e permissões dos arquivos', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'moneta-seguranca-'));
  // Banco antigo em texto puro, com um dado reconhecível.
  const legacy = new DatabaseSync(join(dir, 'moneta.sqlite'));
  initFinance(legacy);
  editFinance(legacy, '/api/categories', { name: 'Categoria Secreta', color: '#123456', internal: false });
  legacy.close();
  // Arquivos de versões antigas, criados com permissões abertas.
  writeFileSync(join(dir, 'pluggy.json'), JSON.stringify({ clientId: 'id', clientSecret: 'segredo' }), { mode: 0o644 });
  writeFileSync(join(dir, 'backup-antigo.sqlite'), 'x', { mode: 0o644 });
  const output = { text: '' };
  let server = start(dir, output);
  t.after(() => { server.kill(); rmSync(dir, { recursive: true, force: true }); });
  await ready(output);

  const key = readFileSync(join(dir, 'acesso.key'), 'utf8');
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(output.text.includes('/entrar?chave=' + key), 'endereço de entrada no log fora do modo desktop');
  // O banco em texto puro virou o cofre cifrado.
  assert.ok(!existsSync(join(dir, 'moneta.sqlite')), 'texto puro apagado depois da migração');
  const vault = readFileSync(join(dir, 'moneta.cofre'));
  assert.ok(!vault.includes('Categoria Secreta') && !vault.includes('SQLite format') && !vault.includes('CREATE TABLE'));

  if (process.platform !== 'win32') {
    assert.equal(mode(dir), '700');
    for (const file of ['moneta.cofre', 'banco.key', 'pluggy.json', 'acesso.key', 'backup-antigo.sqlite']) assert.equal(mode(join(dir, file)), '600', file);
  }

  // Sem cookie: status mínimo e API fechada.
  const status = await (await fetch(base + '/api/status')).json();
  assert.deepEqual(Object.keys(status).sort(), ['desktop', 'instance', 'locked']);
  assert.equal((await fetch(base + '/api/finance')).status, 401);
  assert.equal((await fetch(base + '/api/connections')).status, 401);
  const anonymousPost = await fetch(base + '/api/settings/currency', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{"currency":"USD"}' });
  assert.equal(anonymousPost.status, 401);

  // A página em si carrega, com os cabeçalhos de segurança.
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self' https:\/\/cdn\.pluggy\.ai(;|$)/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.doesNotMatch(await page.text(), /<script>(?!<\/script>)/, 'nenhum script embutido no HTML');

  // Entrada: chave errada recusada; chave certa vira cookie restrito e sai da URL.
  assert.equal((await fetch(base + '/entrar?chave=errada', { redirect: 'manual' })).status, 403);
  const entry = await fetch(base + '/entrar?chave=' + key, { redirect: 'manual' });
  assert.equal(entry.status, 303);
  assert.equal(entry.headers.get('location'), '/');
  const cookie = entry.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const session = cookie.split(';')[0];

  // Com o cookie: leitura liberada, mas escrita de outra origem continua recusada.
  const finance = await (await fetch(base + '/api/finance', { headers: { Cookie: session } })).json();
  assert.ok(finance.categories.some(c => c.name === 'Categoria Secreta'), 'dados migrados aparecem no app');
  const vaultInfo = await (await fetch(base + '/api/vault', { headers: { Cookie: session } })).json();
  assert.deepEqual(vaultInfo, { protection: 'arquivo 0600', pending: true });
  const post = (path, body = {}) => fetch(base + '/api/' + path, { method: 'POST', headers: { Cookie: session, 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
  const { code } = await (await post('vault/code')).json();
  assert.match(code, /^MONETA(-[A-Z2-7]{5}){11}$/);
  assert.equal((await (await fetch(base + '/api/status', { headers: { Cookie: session } })).json()).authorized, true);
  const foreign = await fetch(base + '/api/settings/currency', { method: 'POST', headers: { Cookie: session, 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: '{"currency":"USD"}' });
  assert.equal(foreign.status, 403);
  const own = await fetch(base + '/api/settings/currency', { method: 'POST', headers: { Cookie: session, 'Content-Type': 'application/json', Origin: base }, body: '{"currency":"USD"}' });
  assert.equal(own.status, 200);
  assert.equal((await fetch(base + '/api/finance', { headers: { Cookie: 'moneta_acesso=' + 'x'.repeat(43) } })).status, 401);

  // Host diferente (DNS rebinding) é recusado mesmo com o cookie.
  const rebinding = await new Promise(resolve => {
    import('node:http').then(({ request }) => request({ host: '127.0.0.1', port, path: '/api/finance', headers: { Host: 'evil.example:' + port, Cookie: session } }, res => resolve(res.statusCode)).end());
  });
  assert.equal(rebinding, 403);
  assert.ok(existsSync(join(dir, 'pluggy.json')), 'sem lacre disponível, o JSON continua, mas 0600');

  // Confirmar a chave esconde ela; a alteração feita vai para o cofre e sobrevive ao reinício.
  assert.equal((await post('vault/confirm')).status, 200);
  assert.equal((await post('vault/code')).status, 409);
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
  output.text = '';
  server = start(dir, output);
  await ready(output);
  const again = await (await fetch(base + '/api/finance', { headers: { Cookie: session } })).json();
  assert.equal(again.currency, 'USD', 'moeda gravada antes do reinício');

  // Sem a chave do cofre, o Moneta sobe trancado e só a chave de recuperação abre.
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
  rmSync(join(dir, 'banco.key'));
  output.text = '';
  server = start(dir, output);
  await ready(output);
  assert.equal((await (await fetch(base + '/api/status')).json()).locked, true);
  assert.equal((await fetch(base + '/api/finance', { headers: { Cookie: session } })).status, 423);
  const wrong = await post('recovery', { code: 'MONETA-' + 'AAAAA-'.repeat(10) + 'AAAAA' });
  assert.equal(wrong.status, 400);
  assert.equal((await post('recovery', { code })).status, 202);
  assert.ok(existsSync(join(dir, 'banco.key')), 'chave lacrada de novo depois da recuperação');
});
