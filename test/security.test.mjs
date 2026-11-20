// Sobe o servidor de verdade numa pasta temporária e confere as proteções de acesso e de arquivos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 4187;
const base = 'http://127.0.0.1:' + port;
const mode = file => (statSync(file).mode & 0o777).toString(8);

test('acesso à API, cabeçalhos e permissões dos arquivos', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'moneta-seguranca-'));
  // Arquivos de versões antigas, criados com permissões abertas.
  writeFileSync(join(dir, 'pluggy.json'), JSON.stringify({ clientId: 'id', clientSecret: 'segredo' }), { mode: 0o644 });
  writeFileSync(join(dir, 'backup-antigo.sqlite'), 'x', { mode: 0o644 });
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), MONETA_DATA_DIR: dir, MONETA_SECRET_STORE: 'arquivo', PLUGGY_CLIENT_ID: '', PLUGGY_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  t.after(() => { server.kill(); rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 100 && !output.includes('/entrar?chave='); i++) await new Promise(r => setTimeout(r, 100));

  const key = readFileSync(join(dir, 'acesso.key'), 'utf8');
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(output.includes('/entrar?chave=' + key), 'endereço de entrada no log fora do modo desktop');

  if (process.platform !== 'win32') {
    assert.equal(mode(dir), '700');
    for (const file of ['moneta.sqlite', 'pluggy.json', 'acesso.key', 'backup-antigo.sqlite']) assert.equal(mode(join(dir, file)), '600', file);
  }

  // Sem cookie: status mínimo e API fechada.
  const status = await (await fetch(base + '/api/status')).json();
  assert.deepEqual(Object.keys(status).sort(), ['desktop', 'instance']);
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
  assert.equal((await fetch(base + '/api/finance', { headers: { Cookie: session } })).status, 200);
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
});
