import { editFinance, initFinance, overview, portfolioHistory, ruleChanges } from './finance.mjs';

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
    if (bytes) {
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
    }
  } catch (error) { raw.close(); throw error; }

  function schema() {
    return JSON.stringify(db.prepare('SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name').all());
  }
  return {
    schema,
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
