// Cofre do banco: o SQLite roda só na memória e o disco guarda apenas moneta.cofre, com o conteúdo
// inteiro (esquema e linhas) comprimido e cifrado com AES-256-GCM. Nada do banco fica legível em
// disco, nem nomes de tabelas. Usa só o que o Node.js já traz (node:sqlite, node:crypto, node:zlib).
//
// Formato do arquivo: "MONETA\0" + versão (1 byte) + nonce (12 bytes) + texto cifrado + tag GCM (16 bytes).
// O cabeçalho entra como dado autenticado: qualquer byte alterado no arquivo impede a abertura.
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { writePrivate, wipe } from './secret-store.mjs';

const MAGIC = Buffer.from('MONETA\0');
const VERSION = 1;
const HEADER = MAGIC.length + 1;
const NONCE = 12;
const TAG = 16;

// ---- Conteúdo do banco em JSON, sem perder tipos -------------------------------------------------
const encodeValue = value =>
  typeof value === 'bigint' ? (Number.isSafeInteger(Number(value)) ? Number(value) : { $i: value.toString() })
    : value instanceof Uint8Array ? { $b: Buffer.from(value).toString('base64') }
      : value;
const decodeValue = value =>
  value && typeof value === 'object' ? ('$i' in value ? BigInt(value.$i) : Buffer.from(value.$b, 'base64')) : value;
const quote = name => '"' + name.replaceAll('"', '""') + '"';

export function dumpDatabase(db) {
  const objects = db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid`).all();
  const tables = {};
  const names = objects.filter(o => o.type === 'table').map(o => o.name);
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").get()) names.push('sqlite_sequence');
  for (const name of names) {
    const statement = db.prepare('SELECT * FROM ' + quote(name));
    statement.setReadBigInts(true);
    const columns = statement.columns().map(c => c.name);
    tables[name] = { columns, rows: statement.all().map(row => columns.map(c => encodeValue(row[c]))) };
  }
  return { format: 'moneta-banco', version: 1, schema: objects.map(o => o.sql), tables };
}

export function restoreDatabase(dump, db = new DatabaseSync(':memory:')) {
  if (dump?.format !== 'moneta-banco' || dump.version !== 1) throw new Error('Conteúdo do cofre em formato desconhecido.');
  db.exec('BEGIN');
  try {
    for (const sql of dump.schema) db.exec(sql);
    for (const [name, { columns, rows }] of Object.entries(dump.tables)) {
      if (!rows.length) continue;
      if (name === 'sqlite_sequence') db.exec('DELETE FROM sqlite_sequence');
      const insert = db.prepare(`INSERT INTO ${quote(name)} (${columns.map(quote)}) VALUES (${columns.map(() => '?')})`);
      for (const row of rows) insert.run(...row.map(decodeValue));
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return db;
}

// Impressão digital lógica: esquema e todas as linhas em ordem estável. Serve para provar que a
// migração e cada gravação do cofre preservaram exatamente o mesmo conteúdo.
export function fingerprint(db) {
  const dump = dumpDatabase(db);
  const hash = createHash('sha256');
  hash.update(JSON.stringify([...dump.schema].sort()));
  for (const name of Object.keys(dump.tables).sort()) {
    const { columns, rows } = dump.tables[name];
    hash.update(JSON.stringify([name, columns, rows.map(r => JSON.stringify(r)).sort()]));
  }
  return hash.digest('hex');
}

// ---- Cifra -----------------------------------------------------------------------------------------
export function seal(dump, key) {
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION])]);
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(gzipSync(JSON.stringify(dump))), cipher.final()]);
  return Buffer.concat([header, nonce, body, cipher.getAuthTag()]);
}

export function unseal(data, key) {
  if (data.length < HEADER + NONCE + TAG || !data.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('O arquivo não é um cofre do Moneta.');
  if (data[MAGIC.length] !== VERSION) throw new Error('Versão de cofre desconhecida.');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(HEADER, HEADER + NONCE));
  decipher.setAAD(data.subarray(0, HEADER));
  decipher.setAuthTag(data.subarray(data.length - TAG));
  let plain;
  try { plain = Buffer.concat([decipher.update(data.subarray(HEADER + NONCE, data.length - TAG)), decipher.final()]); }
  catch { throw Object.assign(new Error('Chave errada ou cofre adulterado.'), { code: 'BAD_KEY' }); }
  return JSON.parse(gunzipSync(plain));
}

// ---- Chave de recuperação ----------------------------------------------------------------------
// A própria chave em Base32 (RFC 4648), com 2 bytes de SHA-256 para pegar erros de digitação.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function recoveryCode(key) {
  const data = Buffer.concat([key, createHash('sha256').update(key).digest().subarray(0, 2)]);
  let bits = '', out = '';
  for (const byte of data) bits += byte.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return 'MONETA-' + out.match(/.{1,5}/g).join('-');
}
export function keyFromRecoveryCode(code) {
  const clean = String(code).toUpperCase().replace(/^MONETA/, '').replace(/[^A-Z2-7]/g, '');
  if (clean.length !== 55) throw new Error('A chave de recuperação deve ter 55 letras e números, sem contar MONETA e os traços.');
  let bits = '';
  for (const char of clean) bits += ALPHABET.indexOf(char).toString(2).padStart(5, '0');
  // Os 3 bits que sobram no último caractere são sempre zero; outro valor é erro de digitação.
  if (/1/.test(bits.slice(34 * 8))) throw new Error('A chave de recuperação tem um erro de digitação.');
  const data = Buffer.from(bits.slice(0, 34 * 8).match(/.{8}/g).map(b => parseInt(b, 2)));
  const key = data.subarray(0, 32);
  if (!timingSafeEqual(createHash('sha256').update(key).digest().subarray(0, 2), data.subarray(32))) {
    throw new Error('A chave de recuperação tem um erro de digitação.');
  }
  return Buffer.from(key);
}

// ---- Cofre em disco ----------------------------------------------------------------------------
export function openVault(dataDir, secret, { log = console.log } = {}) {
  const file = join(dataDir, 'moneta.cofre');
  const previous = file + '.anterior';
  const legacy = join(dataDir, 'moneta.sqlite');
  let key, db, created = false;

  if (existsSync(file) || existsSync(previous)) {
    key = secret.load();
    if (!key) throw Object.assign(new Error('A chave do cofre não foi encontrada.'), { code: 'NO_KEY' });
    db = openFile(key);
  } else {
    // A chave é lacrada antes de qualquer gravação: um cofre nunca existe sem a chave guardada.
    key = randomBytes(32);
    secret.save(key);
    created = true;
    db = existsSync(legacy) ? migrate(key) : new DatabaseSync(':memory:');
  }

  // Abre o arquivo principal; se ele estiver incompleto ou corrompido, usa a gravação anterior.
  function openFile(k) {
    let lastError;
    for (const candidate of [file, previous]) {
      if (!existsSync(candidate)) continue;
      try { return restoreDatabase(unseal(readFileSync(candidate), k)); }
      catch (error) { lastError = error; if (error.code === 'BAD_KEY' && candidate === file && !existsSync(previous)) break; }
    }
    throw lastError;
  }

  // Migração do banco antigo em texto puro, como no artigo: checkpoint, impressão digital antes,
  // cofre gravado, cofre relido do disco, impressão digital depois. Só apaga o texto puro se bater.
  function migrate(k) {
    const old = new DatabaseSync(legacy);
    old.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const before = fingerprint(old);
    const dump = dumpDatabase(old);
    old.close();
    writePrivate(file, seal(dump, k));
    const reopened = restoreDatabase(unseal(readFileSync(file), k));
    const after = fingerprint(reopened);
    if (after !== before) {
      rmSync(file, { force: true });
      throw new Error('A migração para o cofre não conferiu; o banco original foi mantido.');
    }
    for (const suffix of ['', '-wal', '-shm', '-journal']) if (existsSync(legacy + suffix)) wipe(legacy + suffix);
    log('Banco migrado para o cofre cifrado (impressão digital ' + after.slice(0, 16) + '…).');
    return reopened;
  }

  let saved = db.prepare('SELECT total_changes() AS n').get().n;
  let changes = () => db.prepare('SELECT total_changes() AS n').get().n;

  function persist({ force = false } = {}) {
    const current = changes();
    if (!force && current === saved) return false;
    const data = seal(dumpDatabase(db), key);
    // Mantém a gravação anterior até a nova estar inteira no disco.
    if (existsSync(file)) renameSync(file, previous);
    writePrivate(file, data);
    saved = current;
    return true;
  }
  if (!existsSync(file)) persist({ force: true });

  return {
    db,
    created,
    persist,
    // Troca a chave e regrava o cofre com ela (por exemplo, depois de expor a chave de recuperação).
    rotate() {
      const next = randomBytes(32);
      const data = seal(dumpDatabase(db), next);
      secret.save(next);
      if (existsSync(file)) renameSync(file, previous);
      writePrivate(file, data);
      writePrivate(previous, data);
      key = next;
      saved = changes();
    },
    recoveryCode: () => recoveryCode(key),
    fingerprint: () => fingerprint(db),
  };
}

// Abre o cofre com a chave de recuperação e lacra a chave de novo neste computador.
export function recoverVault(dataDir, secret, code) {
  const key = keyFromRecoveryCode(code);
  const file = join(dataDir, 'moneta.cofre');
  const source = existsSync(file) ? file : file + '.anterior';
  restoreDatabase(unseal(readFileSync(source), key)).close();
  secret.save(key);
}
