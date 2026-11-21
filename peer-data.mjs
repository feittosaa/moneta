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
export function signatures(data) {
  return Object.fromEntries(Object.entries(data).map(([table,rows]) =>
    [table,Object.fromEntries(Object.entries(rows).map(([id,row]) => [id,hash(row)]))]));
}

// Aplica apenas mudanças relativas à última troca confirmada. Em conflito no mesmo
// registro o receptor preserva sua edição. Coletas bancárias usam a data da coleta.
export function merge(db, base, incoming, { initial = false } = {}) {
  const local = capture(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [table,fields] of Object.entries(keys)) {
      if (!incoming[table] || typeof incoming[table] !== 'object' || Array.isArray(incoming[table])) throw Error('Versão de sincronização incompatível.');
      const columns = db.prepare('PRAGMA table_info('+table+')').all().map(c => c.name)
        .filter(c => table !== 'categories' || c !== 'id');
      const remove = db.prepare('DELETE FROM '+table+' WHERE '+fields.map(k => k+'=?').join(' AND '));
      const updates = columns.filter(c => !fields.includes(c)).map(c => c+'=excluded.'+c);
      const save = db.prepare('INSERT INTO '+table+' ('+columns+') VALUES ('+columns.map(() => '?')+') ON CONFLICT ('+fields+') DO UPDATE SET '+updates);
      for (const id of new Set([...Object.keys(base[table] || {}),...Object.keys(incoming[table])])) {
        const before = base[table]?.[id];
        const row = incoming[table][id];
        const here = local[table][id];
        const remoteHash = row && hash(row);
        const localHash = here && hash(here);
        if (remoteHash === before || localHash === remoteHash) continue;
        if (table === 'snapshots' && row && here && row.updated < here.updated) continue;
        if (localHash !== before) {
          const newerCollection = table === 'snapshots' && row && here && row.updated > here.updated;
          const customizedDefault = initial && table === 'categories' && here && row &&
            !here.custom && !here.color && !here.deleted && (row.color || row.deleted);
          if (!newerCollection && !customizedDefault) continue;
        }
        if (!row) { remove.run(...JSON.parse(id)); continue; }
        if (JSON.stringify(fields.map(k => row[k])) !== id || columns.some(k => !Object.hasOwn(row,k))) throw Error('Registro incompatível.');
        const values = {...row};
        if (categoryRefs.has(table) && values.category != null) {
          const category = db.prepare('SELECT id FROM categories WHERE key=?').get(values.category);
          if (!category) throw Error('Categoria ausente na sincronização.');
          values.category = category.id;
        }
        save.run(...columns.map(c => values[c]));
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
