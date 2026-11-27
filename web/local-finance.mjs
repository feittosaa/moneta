import { snapshot, merge, revision, track, prepareMeta } from './peer-data.mjs';
import { editFinance, initFinance, initGoals, overview, portfolioHistory, ruleChanges } from './finance.mjs';

export function openFinance(SQL, bytes) {
  const raw = new SQL.Database(bytes);
  const db = {
    exec: sql => raw.run(sql),
    prepare(sql) {
      function* iterate(...params) {
        const statement = raw.prepare(sql);
        try {
          statement.bind(params);
          while (statement.step()) yield statement.getAsObject();
        } finally { statement.free(); }
      }
      return {
        iterate,
        all: (...params) => [...iterate(...params)],
        get(...params) {
          for (const row of iterate(...params)) return row;
        },
        run(...params) {
          raw.run(sql,params);
          return {changes:raw.getRowsModified()};
        },
      };
    },
  };
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY;');
    // Dados só deste aparelho: vínculos e credenciais da Pluggy. Não entram na sincronização.
    db.exec('CREATE TABLE IF NOT EXISTS web_device (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS sync_peers (id TEXT PRIMARY KEY, revision TEXT NOT NULL)');
    prepareMeta(db);
    if (bytes) {
      // Cofres e backups de antes das metas: as tabelas novas entram antes da conferência do esquema.
      initGoals(db);
      const reference = openFinance(SQL);
      try {
        if (reference.schema() !== schema() || db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
          throw Error('O backup contém um banco inválido ou incompatível.');
        overview(db);
        portfolioHistory(db);
      } finally { reference.close(); }
    } else {
      db.exec('CREATE TABLE connections (id TEXT PRIMARY KEY, institution TEXT NOT NULL, status TEXT NOT NULL)');
      initFinance(db);
      track(db);
    }
  } catch (error) { raw.close(); throw error; }

  function schema() {
    return JSON.stringify(db.prepare('SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name').all());
  }
  return {
    schema,
    local(name) {
      const row = db.prepare('SELECT value FROM web_device WHERE name=?').get(name);
      return row ? JSON.parse(row.value) : null;
    },
    saveLocal(name, value) {
      if (value == null) db.prepare('DELETE FROM web_device WHERE name=?').run(name);
      else db.prepare('INSERT OR REPLACE INTO web_device VALUES (?,?)').run(name,JSON.stringify(value));
    },
    peers() { return this.local('peers') || []; },
    savePeers(peers) {
      this.saveLocal('peers',peers.length ? peers : null);
      const ids = new Set(peers.map(peer => peer.id));
      for (const {id} of db.prepare('SELECT id FROM sync_peers').all()) if (!ids.has(id)) db.prepare('DELETE FROM sync_peers WHERE id=?').run(id);
    },
    agreed(id, value) {
      if (value === undefined) return db.prepare('SELECT revision FROM sync_peers WHERE id=?').get(id)?.revision;
      db.prepare('INSERT OR REPLACE INTO sync_peers VALUES (?,?)').run(id,value);
    },
    // Tira vínculos e credenciais: usado em backups e cópias para outro aparelho.
    stripLocal() { db.exec('DELETE FROM web_device; DELETE FROM sync_peers'); },
    track: () => track(db),
    changes: () => db.prepare('SELECT total_changes() AS n').get().n,
    syncState: () => snapshot(db),
    merge: packet => merge(db,packet),
    revision: () => revision(track(db).state),
    db,
    snapshot: () => raw.export(),
    close: () => raw.close(),
    read(path) {
      if (path === 'finance') return overview(db);
      if (path === 'portfolio') return portfolioHistory(db);
      if (path === 'rules/preview') return ruleChanges(db);
      if (path === 'status') return {};
      throw Error('Operação indisponível na Moneta Web.');
    },
    edit: (path,body) => editFinance(db,'/api/'+path,body),
  };
}
