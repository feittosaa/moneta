// Réplica entre aparelhos: cada registro carrega o momento da última alteração e a edição mais
// recente vence. Exclusões viram marcas (hash nulo) para que também se propaguem. Como o estado
// converge em qualquer ordem de troca, vários aparelhos podem sincronizar entre si.
// As chaves transmitidas são as chaves de negócio. Categorias podem ter IDs SQLite
// diferentes em instalações que já tinham dados antes do primeiro pareamento.
import { createHash } from 'node:crypto';

const keys = {
  categories:['key'], connections:['id'], wallet:['id'], rules:['id'], vouchers:['id'],
  snapshots:['item'], portfolio_history:['item','day'], notes:['tx'], assignments:['tx'],
  preferences:['name'], rule_history:['tx'], personal_rules:['name'], rule_edits:['key'],
};
const categoryRefs = new Set(['rules','vouchers','assignments','rule_history']);
const hash = row => createHash('sha256').update(JSON.stringify(row)).digest('base64url');
const valid = (table,id) => Object.hasOwn(keys,table) && typeof id === 'string' && id.length < 4096;

export function capture(db) {
  const categories = new Map(db.prepare('SELECT id,key FROM categories').all().map(r => [r.id,r.key]));
  const result = {};
  for (const [table, fields] of Object.entries(keys)) {
    const rows = {};
    for (const row of db.prepare('SELECT * FROM '+table).all()) {
      if (table === 'categories') delete row.id;
      if (categoryRefs.has(table) && row.category != null) row.category = categories.get(row.category);
      rows[JSON.stringify(fields.map(k => row[k]))] = row;
    }
    result[table] = rows;
  }
  return result;
}

// Coleta bancária tem data própria: a mais recente vence mesmo que tenha chegado depois.
const stamp = (table,row,now) => table === 'snapshots' && Date.parse(row.updated) || now;

function prepareMeta(db) {
  db.exec('CREATE TABLE IF NOT EXISTS sync_rows (tbl TEXT NOT NULL, id TEXT NOT NULL, hash TEXT, at INTEGER NOT NULL, PRIMARY KEY (tbl,id))');
}

function readMeta(db) {
  const state = Object.fromEntries(Object.keys(keys).map(table => [table,{}]));
  for (const {tbl,id,hash,at} of db.prepare("SELECT * FROM sync_rows WHERE tbl<>''").all()) {
    if (state[tbl]) state[tbl][id] = [hash,at];
  }
  return state;
}

// Registra o que mudou desde a última chamada. Deve rodar depois de cada alteração local, para que
// o horário gravado seja o da edição, e não o da sincronização seguinte.
export function track(db, now = Date.now()) {
  prepareMeta(db);
  const rows = capture(db);
  const started = db.prepare("SELECT 1 FROM sync_rows WHERE tbl='' AND id=''").get();
  const state = readMeta(db);
  const put = db.prepare('INSERT OR REPLACE INTO sync_rows VALUES (?,?,?,?)');
  const writes = [];
  for (const table of Object.keys(keys)) {
    const known = state[table];
    for (const [id,row] of Object.entries(rows[table])) {
      const sig = hash(row);
      const before = known[id];
      if (before?.[0] === sig) continue;
      // Na primeira vez, o que já existia conta como antigo: qualquer edição posterior vence.
      const at = started ? Math.max(stamp(table,row,now),(before?.[1] ?? -1)+1) : stamp(table,row,0);
      known[id] = [sig,at];
      writes.push([table,id,sig,at]);
    }
    for (const [id,[sig,at]] of Object.entries(known)) {
      if (sig === null || Object.hasOwn(rows[table],id)) continue;
      known[id] = [null,Math.max(now,at+1)];
      writes.push([table,id,null,known[id][1]]);
    }
  }
  if (writes.length || !started) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const write of writes) put.run(...write);
      if (!started) put.run('','','',0);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {rows,state};
}

export function revision(state) {
  const sorted = Object.keys(keys).map(table =>
    [table,Object.entries(state[table] || {}).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)]);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('base64url');
}

// Pacote para outro aparelho: o estado completo, com os registros vivos.
export function snapshot(db) {
  const {rows,state} = track(db);
  const live = {};
  for (const table of Object.keys(keys)) {
    live[table] = {};
    for (const [id,[sig]] of Object.entries(state[table])) if (sig !== null) live[table][id] = rows[table][id];
  }
  return {state,rows:live,revision:revision(state)};
}

// Em empate de horário, a escolha precisa ser a mesma nos dois aparelhos. Categorias padrão
// personalizadas vencem as intocadas; o resto desempata pelo hash.
function prefer(table, incoming, local, [sig], [localSig]) {
  if (table === 'categories' && incoming && local) {
    const touched = row => Boolean(row.custom || row.color || row.deleted);
    if (touched(incoming) !== touched(local)) return touched(incoming);
  }
  return (sig ?? '') > (localSig ?? '');
}

// Aplica o pacote recebido e devolve se algo mudou aqui.
export function merge(db, packet) {
  if (!packet || typeof packet.state !== 'object' || typeof packet.rows !== 'object') throw Error('Versão de sincronização incompatível.');
  const {rows:local,state} = track(db);
  const put = db.prepare('INSERT OR REPLACE INTO sync_rows VALUES (?,?,?,?)');
  let changed = false;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [table,fields] of Object.entries(keys)) {
      const incoming = packet.state[table];
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw Error('Versão de sincronização incompatível.');
      const columns = db.prepare('PRAGMA table_info('+table+')').all().map(c => c.name)
        .filter(c => table !== 'categories' || c !== 'id');
      const remove = db.prepare('DELETE FROM '+table+' WHERE '+fields.map(k => k+'=?').join(' AND '));
      const updates = columns.filter(c => !fields.includes(c)).map(c => c+'=excluded.'+c);
      const save = db.prepare('INSERT INTO '+table+' ('+columns+') VALUES ('+columns.map(() => '?')+') ON CONFLICT ('+fields+') DO '+
        (updates.length ? 'UPDATE SET '+updates : 'NOTHING'));
      for (const [id,entry] of Object.entries(incoming)) {
        if (!valid(table,id) || !Array.isArray(entry) || entry.length !== 2) throw Error('Registro incompatível.');
        const [sig,at] = entry;
        if ((sig !== null && typeof sig !== 'string') || !Number.isSafeInteger(at) || at < 0) throw Error('Registro incompatível.');
        const mine = state[table][id] || [undefined,-1];
        if (sig === mine[0]) {
          // Mesmo conteúdo: só alinha o horário para que as revisões fiquem iguais.
          if (at > mine[1]) put.run(table,id,sig,at);
          continue;
        }
        const row = sig === null ? null : packet.rows[table]?.[id];
        if (sig !== null && (!row || hash(row) !== sig)) throw Error('Registro incompatível.');
        if (at < mine[1] || (at === mine[1] && !prefer(table,row,local[table][id],entry,mine))) continue;
        if (!row) {
          if (Object.hasOwn(local[table],id)) remove.run(...JSON.parse(id));
        } else {
          if (JSON.stringify(fields.map(k => row[k])) !== id || columns.some(k => !Object.hasOwn(row,k))) throw Error('Registro incompatível.');
          const values = {...row};
          if (categoryRefs.has(table) && values.category != null) {
            const category = db.prepare('SELECT id FROM categories WHERE key=?').get(values.category);
            // Categoria apagada em outro aparelho: o registro espera a próxima troca.
            if (!category) continue;
            values.category = category.id;
          }
          save.run(...columns.map(c => values[c]));
        }
        put.run(table,id,sig,at);
        changed = true;
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return changed;
}

export { prepareMeta };
