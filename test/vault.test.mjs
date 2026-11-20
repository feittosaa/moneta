import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openVault, recoverVault, dumpDatabase, restoreDatabase, fingerprint, seal, unseal, recoveryCode, keyFromRecoveryCode } from '../vault.mjs';
import { createSecret, detectSealer } from '../secret-store.mjs';
import { initFinance, editFinance, overview } from '../finance.mjs';

const tempDir = t => { const dir = mkdtempSync(join(tmpdir(), 'moneta-cofre-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
const secretIn = dir => createSecret(dir, { name: 'moneta-banco-teste', base: 'banco', sealer: null });
const quiet = { log: () => {} };

test('conteúdo vai e volta sem perder tipos', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE t(id INTEGER PRIMARY KEY, txt TEXT, n INTEGER, r REAL, b BLOB, z);
    CREATE INDEX t_txt ON t(txt); CREATE TABLE "aspas ""x"""(a); INSERT INTO "aspas ""x"""(a) VALUES ('ok');`);
  db.prepare('INSERT INTO t VALUES (?,?,?,?,?,?)').run(1, 'Salário · ação', 9007199254740993n, 1.5, Buffer.from([0, 255, 7]), null);
  db.prepare('INSERT INTO t VALUES (?,?,?,?,?,?)').run(2, '', -5, -0.25, null, 'x');
  const copy = restoreDatabase(JSON.parse(JSON.stringify(dumpDatabase(db))));
  assert.equal(fingerprint(copy), fingerprint(db));
  const big = copy.prepare('SELECT n FROM t WHERE id=1'); big.setReadBigInts(true);
  assert.equal(big.get().n, 9007199254740993n, 'inteiro grande exato');
  assert.deepEqual([...copy.prepare('SELECT b FROM t WHERE id=1').get().b], [0, 255, 7]);
  assert.ok(copy.prepare("SELECT 1 FROM sqlite_schema WHERE name='t_txt'").get(), 'índice recriado');
});

test('arquivo cifrado não mostra nada e não aceita adulteração', () => {
  const key = randomBytes(32);
  const dump = { format: 'moneta-banco', version: 1, schema: ['CREATE TABLE segredo(x)'], tables: { segredo: { columns: ['x'], rows: [['Itaú 1234']] } } };
  const data = seal(dump, key);
  assert.ok(data.subarray(0, 7).equals(Buffer.from('MONETA\0')));
  for (const word of ['segredo', 'Ita', 'SQLite', 'CREATE']) assert.ok(!data.includes(word), word);
  assert.deepEqual(unseal(data, key), dump);
  assert.throws(() => unseal(data, randomBytes(32)), { code: 'BAD_KEY' });
  for (const position of [7, 10, data.length - 20, data.length - 1]) {
    const tampered = Buffer.from(data); tampered[position] ^= 1;
    assert.throws(() => unseal(tampered, key), position === 7 ? /Versão/ : { code: 'BAD_KEY' });
  }
  assert.notDeepEqual(seal(dump, key), seal(dump, key), 'nonce novo a cada gravação');
});

test('chave de recuperação pega erros de digitação', () => {
  const key = randomBytes(32);
  const code = recoveryCode(key);
  assert.match(code, /^MONETA(-[A-Z2-7]{5}){11}$/);
  assert.ok(keyFromRecoveryCode(code).equals(key));
  assert.ok(keyFromRecoveryCode(code.toLowerCase().replaceAll('-', ' ')).equals(key), 'aceita minúsculas e espaços');
  // Qualquer caractere trocado é pego, inclusive o último, que tem bits de enchimento.
  for (const position of [7, 32, code.length - 1]) {
    const typo = code.slice(0, position) + (code[position] === 'A' ? 'B' : 'A') + code.slice(position + 1);
    assert.throws(() => keyFromRecoveryCode(typo), /digitação/, 'posição ' + position);
  }
  assert.throws(() => keyFromRecoveryCode('MONETA-ABC'), /55/);
});

test('migra o banco em texto puro, grava a cada mudança e reabre', t => {
  const dir = tempDir(t);
  const legacy = new DatabaseSync(join(dir, 'moneta.sqlite'));
  initFinance(legacy);
  editFinance(legacy, '/api/categories', { name: 'Pets', color: '#123456', internal: false });
  const before = fingerprint(legacy);
  legacy.close();

  const vault = openVault(dir, secretIn(dir), quiet);
  assert.equal(vault.fingerprint(), before, 'mesmo conteúdo depois da migração');
  assert.ok(!existsSync(join(dir, 'moneta.sqlite')), 'texto puro apagado');
  const disk = readFileSync(join(dir, 'moneta.cofre'));
  assert.ok(!disk.includes('Pets') && !disk.includes('SQLite format'));
  if (process.platform !== 'win32') assert.equal((statSync(join(dir, 'moneta.cofre')).mode & 0o777).toString(8), '600');

  assert.equal(vault.persist(), false, 'sem mudanças, não regrava');
  editFinance(vault.db, '/api/categories', { name: 'Viagens', color: '#654321', internal: false });
  assert.equal(vault.persist(), true);
  const after = vault.fingerprint();

  const reopened = openVault(dir, secretIn(dir), quiet);
  assert.equal(reopened.fingerprint(), after);
  assert.ok(overview(reopened.db).categories.some(c => c.name === 'Viagens'));
});

test('gravação interrompida usa a anterior; chave errada não abre', t => {
  const dir = tempDir(t);
  const vault = openVault(dir, secretIn(dir), quiet);
  initFinance(vault.db);
  vault.persist();
  const good = vault.fingerprint();
  editFinance(vault.db, '/api/categories', { name: 'Nova', color: '#111111', internal: false });
  vault.persist();
  // Simula queda no meio da gravação: arquivo principal truncado.
  writeFileSync(join(dir, 'moneta.cofre'), readFileSync(join(dir, 'moneta.cofre')).subarray(0, 40));
  assert.equal(openVault(dir, secretIn(dir), quiet).fingerprint(), good);

  writeFileSync(join(dir, 'banco.key'), randomBytes(32));
  assert.throws(() => openVault(dir, secretIn(dir), quiet), { code: 'BAD_KEY' });
});

test('recuperação em outro computador e troca de chave', t => {
  const dir = tempDir(t);
  const vault = openVault(dir, secretIn(dir), quiet);
  initFinance(vault.db);
  vault.persist();
  const code = vault.recoveryCode();
  const content = vault.fingerprint();

  // "Outro computador": a chave lacrada se perdeu.
  rmSync(join(dir, 'banco.key'));
  assert.throws(() => openVault(dir, secretIn(dir), quiet), { code: 'NO_KEY' });
  assert.throws(() => recoverVault(dir, secretIn(dir), recoveryCode(randomBytes(32))), { code: 'BAD_KEY' });
  recoverVault(dir, secretIn(dir), code);
  const recovered = openVault(dir, secretIn(dir), quiet);
  assert.equal(recovered.fingerprint(), content);

  recovered.rotate();
  assert.notEqual(recovered.recoveryCode(), code);
  assert.throws(() => recoverVault(dir, secretIn(dir), code), { code: 'BAD_KEY' }, 'chave antiga deixa de valer, inclusive na gravação anterior');
  assert.equal(openVault(dir, secretIn(dir), quiet).fingerprint(), content);
});

test('chave em arquivo comum é lacrada quando o lacre fica disponível', { skip: !detectSealer() && 'sem systemd-creds ou DPAPI neste sistema' }, t => {
  const dir = tempDir(t);
  // Cofre criado sem lacre, como no Docker.
  const docker = openVault(dir, secretIn(dir), quiet);
  initFinance(docker.db);
  docker.persist();
  const content = docker.fingerprint();
  assert.ok(existsSync(join(dir, 'banco.key')));
  // Mesmo cofre aberto onde há lacre: a chave vai para o lacre e o arquivo comum some.
  const installed = createSecret(dir, { name: 'moneta-banco-teste', base: 'banco' });
  assert.equal(openVault(dir, installed, quiet).fingerprint(), content);
  assert.ok(!existsSync(join(dir, 'banco.key')), 'arquivo comum apagado');
  assert.ok(existsSync(join(dir, 'banco.' + (process.platform === 'win32' ? 'dpapi' : 'cred'))));
  assert.equal(openVault(dir, createSecret(dir, { name: 'moneta-banco-teste', base: 'banco' }), quiet).fingerprint(), content);
});
