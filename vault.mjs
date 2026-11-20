// Cofre do banco: o SQLite roda só na memória e o disco guarda apenas moneta.cofre, com o conteúdo
// inteiro (esquema e linhas) comprimido e cifrado com AES-256-GCM. Nada do banco fica legível em
// disco, nem nomes de tabelas. Usa só o que o Node.js já traz (node:sqlite, node:crypto, node:zlib).
//
// Formato do arquivo: "MONETA\0" + versão (1 byte) + nonce (12 bytes) + texto cifrado + tag GCM (16 bytes).
// O cabeçalho entra como dado autenticado: qualquer byte alterado no arquivo impede a abertura.
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
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

// Com replace, troca todo o conteúdo de um banco já aberto, na mesma transação (restauração de backup).
export function restoreDatabase(dump, db = new DatabaseSync(':memory:'), { replace = false } = {}) {
  if (dump?.format !== 'moneta-banco' || dump.version !== 1) throw new Error('Conteúdo do cofre em formato desconhecido.');
  db.exec('BEGIN');
  try {
    if (replace) {
      const objects = db.prepare(`SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND type IN ('view', 'trigger', 'table')
        ORDER BY CASE type WHEN 'view' THEN 0 WHEN 'trigger' THEN 1 ELSE 2 END`).all();
      for (const { type, name } of objects) db.exec(`DROP ${type.toUpperCase()} IF EXISTS ${quote(name)}`);
      if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").get()) db.exec('DELETE FROM sqlite_sequence');
    }
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
  if (data.length < HEADER + NONCE + TAG || !data.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('O arquivo não é um cofre da Moneta.');
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

// ---- Backups --------------------------------------------------------------------------------------
// Arquivo .monetabackup: "MONETA-BACKUP\0" + versão + tamanho do cabeçalho (2 bytes) + cabeçalho JSON
// legível (data e identificador da chave) + nonce + conteúdo cifrado + tag. Tudo o que vem antes do
// nonce é autenticado: a tag do AES-GCM faz o papel do HMAC do artigo, e nada do arquivo pode ser
// trocado sem que a abertura falhe. Dentro vão o manifesto (resumo e impressão digital) e o banco.
// O backup abre com a chave do cofre do momento em que foi feito, ou seja, com a chave de
// recuperação que valia naquele dia.
const BACKUP_MAGIC = Buffer.from('MONETA-BACKUP\0');
export const keyId = key => createHash('sha256').update('moneta-chave\0').update(key).digest('hex').slice(0, 16);

export function sealBackup({ manifest, dump }, key) {
  const head = Buffer.from(JSON.stringify({ created: manifest.created, keyId: keyId(key) }));
  const size = Buffer.alloc(2); size.writeUInt16BE(head.length);
  const header = Buffer.concat([BACKUP_MAGIC, Buffer.from([VERSION]), size, head]);
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(gzipSync(JSON.stringify({ manifest, dump }))), cipher.final()]);
  return Buffer.concat([header, nonce, body, cipher.getAuthTag()]);
}
export function backupHeader(data) {
  if (!Buffer.isBuffer(data) || data.length < BACKUP_MAGIC.length + 3 || !data.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error('O arquivo não é um backup da Moneta.');
  }
  if (data[BACKUP_MAGIC.length] !== VERSION) throw new Error('Versão de backup desconhecida.');
  const size = data.readUInt16BE(BACKUP_MAGIC.length + 1);
  const end = BACKUP_MAGIC.length + 3 + size;
  if (data.length < end + NONCE + TAG) throw new Error('O backup está incompleto.');
  let head;
  try { head = JSON.parse(data.subarray(BACKUP_MAGIC.length + 3, end)); } catch { throw new Error('O backup está danificado.'); }
  return { ...head, end };
}
// Abre, confere a tag e faz o teste de restauração: o banco remontado tem que ter a impressão
// digital registrada no manifesto.
export function openBackup(data, key) {
  const { end, keyId: id } = backupHeader(data);
  if (id !== keyId(key)) throw Object.assign(new Error('Este backup foi feito com outra chave de recuperação.'), { code: 'OTHER_KEY' });
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(end, end + NONCE));
  decipher.setAAD(data.subarray(0, end));
  decipher.setAuthTag(data.subarray(data.length - TAG));
  let content;
  try { content = JSON.parse(gunzipSync(Buffer.concat([decipher.update(data.subarray(end + NONCE, data.length - TAG)), decipher.final()]))); }
  catch { throw Object.assign(new Error('O backup foi alterado ou está danificado.'), { code: 'BAD_KEY' }); }
  const restored = restoreDatabase(content.dump);
  const ok = fingerprint(restored) === content.manifest?.fingerprint;
  restored.close();
  if (!ok) throw new Error('O backup não passou no teste de restauração.');
  return content;
}

// ---- Senha (modo cofre) ------------------------------------------------------------------------
// A chave do cofre cifrada com uma chave derivada da senha (scrypt, 128 MiB por tentativa). O
// resultado ainda é lacrado pelo sistema, então abrir exige este computador e a senha.
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const derive = (password, salt) => scryptSync(String(password).normalize('NFC'), salt, 32, SCRYPT);
export function passwordSecret(store, password, settings = {}) {
  let salt, kek;
  return {
    sealer: store.sealer,
    exists: store.exists,
    remove: store.remove,
    get settings() { return settings; },
    load() {
      const blob = JSON.parse(store.load());
      salt = Buffer.from(blob.salt, 'base64');
      kek = derive(password, salt);
      const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(blob.nonce, 'base64'));
      decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
      try {
        const key = Buffer.concat([decipher.update(Buffer.from(blob.key, 'base64')), decipher.final()]);
        settings = blob.settings ?? {};
        return key;
      } catch { kek = null; throw Object.assign(new Error('Senha errada.'), { code: 'BAD_PASSWORD' }); }
    },
    save(key, next = settings) {
      if (!kek) { salt = randomBytes(16); kek = derive(password, salt); }
      const nonce = randomBytes(NONCE);
      const cipher = createCipheriv('aes-256-gcm', kek, nonce);
      const data = Buffer.concat([cipher.update(key), cipher.final()]);
      store.save(JSON.stringify({ format: 'moneta-senha', version: 1, kdf: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
        salt: salt.toString('base64'), nonce: nonce.toString('base64'), key: data.toString('base64'), tag: cipher.getAuthTag().toString('base64'), settings: next }));
      settings = next;
    },
  };
}

// ---- Cofre em disco ----------------------------------------------------------------------------
export function openVault(dataDir, secret, { log = console.log } = {}) {
  const file = join(dataDir, 'moneta.cofre');
  const previous = file + '.anterior';
  const legacy = join(dataDir, 'moneta.sqlite');
  const backups = join(dataDir, 'backups');
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
      // Os backups automáticos passam para a chave nova; os baixados continuam com a antiga.
      for (const { name } of listBackups()) {
        const path = join(backups, name);
        try { writePrivate(path, sealBackup(openBackup(readFileSync(path), key), next)); } catch {}
      }
      key = next;
      saved = changes();
    },
    recoveryCode: () => recoveryCode(key),
    fingerprint: () => fingerprint(db),
    // Passa a chave para outro guardião (lacre simples ou senha) sem trocá-la.
    useSecret(next) { next.save(key); secret = next; },
    reseal: settings => secret.save(key, settings),
    backup,
    autoBackup,
    listBackups,
    readBackup: name => readFileSync(join(backups, safeName(name))),
    openBackup: (data, code) => openBackup(data, code ? keyFromRecoveryCode(code) : key),
    restore(dump) {
      restoreDatabase(dump, db, { replace: true });
      persist({ force: true });
    },
  };

  // Backup cifrado e já testado: o arquivo gerado é aberto e restaurado na memória antes de ser entregue.
  function backup(summary = {}) {
    const manifest = { created: new Date().toISOString(), summary, fingerprint: fingerprint(db) };
    const data = sealBackup({ manifest, dump: dumpDatabase(db) }, key);
    if (openBackup(data, key).manifest.fingerprint !== manifest.fingerprint) throw new Error('O backup não passou no teste de restauração.');
    return { data, manifest };
  }
  // Um backup automático por dia em backups/, mantendo os mais recentes. Testado depois de gravado,
  // relendo do disco; um arquivo que não passa é apagado.
  function autoBackup(summary, { keep = 7, every = 24 * 60 * 60 * 1000 } = {}) {
    const newest = listBackups()[0];
    if (newest && Date.now() - Date.parse(newest.created) < every) return null;
    mkdirSync(backups, { recursive: true, mode: 0o700 });
    const { data, manifest } = backup(summary);
    const name = 'moneta-' + manifest.created.replace(/[:.]/g, '-') + '.monetabackup';
    const path = join(backups, name);
    writePrivate(path, data);
    try { openBackup(readFileSync(path), key); } catch (error) { rmSync(path, { force: true }); throw error; }
    for (const old of listBackups().slice(keep)) rmSync(join(backups, old.name), { force: true });
    return name;
  }
  function listBackups() {
    if (!existsSync(backups)) return [];
    return readdirSync(backups).filter(name => /^moneta-[\w-]+\.monetabackup$/.test(name)).map(name => {
      try { return { name, created: backupHeader(readFileSync(join(backups, name))).created, size: statSync(join(backups, name)).size }; }
      catch { return null; }
    }).filter(Boolean).sort((a, b) => b.created.localeCompare(a.created));
  }
}
const safeName = name => {
  if (typeof name !== 'string' || !/^moneta-[\w-]+\.monetabackup$/.test(name)) throw new Error('Backup desconhecido.');
  return name;
};

// Abre o cofre com a chave de recuperação e lacra a chave de novo neste computador.
export function recoverVault(dataDir, secret, code) {
  const key = keyFromRecoveryCode(code);
  const file = join(dataDir, 'moneta.cofre');
  const source = existsSync(file) ? file : file + '.anterior';
  restoreDatabase(unseal(readFileSync(source), key)).close();
  secret.save(key);
}
