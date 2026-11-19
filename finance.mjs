const templates = [
  ['Moradia', 'Housing'], ['Alimentação', 'Food and drinks', 'Groceries', 'Restaurants'],
  ['Transporte', 'Transportation', 'Transport'], ['Saúde', 'Healthcare'],
  ['Educação', 'Education'], ['Lazer', 'Entertainment'], ['Compras', 'Shopping'],
  ['Salário', 'Salary'], ['Rendimentos', 'Interest'], ['Serviços', 'Services'],
  ['Transferência interna', 'Transfer between own accounts'],
  ['Pagamento de fatura', 'Credit card payment'], ['Movimentação de investimentos', 'Investments'],
];
const excluded = new Set(templates.slice(-3).map(([name]) => name));
const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
function bad(message) { throw Object.assign(new Error(message), { status: 400 }); }
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) bad('Informe um texto de até 100 caracteres.');
  return value.trim();
}
function cents(value) {
  if (value == null) return null;
  const n = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(n)) throw new Error('Valor monetário inválido.');
  return n;
}
function bankName(connector, accounts) {
  if (fold(connector) !== 'meupluggy') return connector;
  for (const account of accounts) {
    const name = account.name?.trim();
    if (!name) continue;
    const normalized = fold(name);
    if (/\bitau\b/.test(normalized)) return 'Itaú';
    if (/\bxp\b/.test(normalized)) return 'XP';
    if (/^(banco|bank|cooperativa) .+/.test(normalized)) return name;
  }
  return connector;
}

export function restoreBankNames(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const rows = db.prepare(`SELECT c.id, c.institution, s.payload FROM connections c
      JOIN snapshots s ON s.item=c.id WHERE lower(c.institution)='meupluggy'`).all();
    for (const row of rows) {
      const snapshot = JSON.parse(row.payload);
      const institution = bankName(row.institution, snapshot.accounts);
      if (institution === row.institution) continue;
      for (const account of snapshot.accounts) account.institution = institution;
      db.prepare('UPDATE connections SET institution=? WHERE id=?').run(institution,row.id);
      db.prepare('UPDATE snapshots SET payload=? WHERE item=?').run(JSON.stringify(snapshot),row.id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function initFinance(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, name TEXT NOT NULL, key TEXT UNIQUE NOT NULL, custom INTEGER NOT NULL, internal INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rules(id INTEGER PRIMARY KEY, term TEXT NOT NULL, category INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS assignments(tx TEXT PRIMARY KEY, category INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots(item TEXT PRIMARY KEY, payload TEXT NOT NULL, updated TEXT NOT NULL);`);
  const seed = db.prepare('INSERT OR IGNORE INTO categories(name,key,custom,internal) VALUES (?,?,0,?)');
  for (const [name] of templates) seed.run(name, fold(name), Number(excluded.has(name)));
}
export function overview(db) {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  const rules = db.prepare('SELECT * FROM rules ORDER BY id').all();
  const normalizedRules = rules.map(rule => ({ term: fold(rule.term), category: rule.category }));
  const manual = new Map(db.prepare('SELECT * FROM assignments').all().map(x => [x.tx, x.category]));
  const aliases = new Map();
  for (const [name,...others] of templates) {
    const id = categories.find(x => x.key === fold(name)).id;
    for (const alias of [name,...others]) aliases.set(fold(alias),id);
  }
  const accounts = [], holdings = [], transactions = [];
  const sources = db.prepare('SELECT * FROM snapshots ORDER BY item').all().map(row => {
    const data = JSON.parse(row.payload);
    accounts.push(...data.accounts);
    holdings.push(...data.holdings);
    for (const tx of data.transactions) {
      const description = fold(tx.description);
      const rule = normalizedRules.find(r => description.includes(r.term));
      const category = manual.get(tx.id) ?? rule?.category ?? aliases.get(fold(tx.providerCategory)) ?? null;
      transactions.push({...tx, category, manual:manual.has(tx.id)});
    }
    return {item:row.item, updated:row.updated};
  });
  transactions.sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return {categories,rules,accounts,holdings,transactions,sources};
}
export function editFinance(db, path, body) {
  const category = body.category;
  if (category != null && (!Number.isInteger(category) || !db.prepare('SELECT 1 FROM categories WHERE id=?').get(category))) bad('Categoria inválida.');
  if (path === '/api/categories') {
    const name = label(body.name);
    if (db.prepare('SELECT 1 FROM categories WHERE key=?').get(fold(name))) bad('Essa categoria já existe.');
    db.prepare('INSERT INTO categories(name,key,custom,internal) VALUES(?,?,1,?)').run(name,fold(name),Number(body.internal === true));
  } else if (path === '/api/rules') {
    if (!category) bad('Selecione uma categoria.');
    db.prepare('INSERT INTO rules(term,category) VALUES(?,?)').run(label(body.term),category);
  } else if (path === '/api/rules/remove') {
    if (!Number.isInteger(body.id)) bad('Regra inválida.');
    db.prepare('DELETE FROM rules WHERE id=?').run(body.id);
  } else {
    const id = label(body.id);
    const exists = db.prepare(`
      SELECT 1 FROM snapshots, json_each(snapshots.payload, '$.transactions') AS tx
      WHERE json_extract(tx.value, '$.id') = ? LIMIT 1
    `).get(id);
    if (!exists) bad('Transação desconhecida.');
    if (category == null) db.prepare('DELETE FROM assignments WHERE tx=?').run(id);
    else db.prepare('INSERT OR REPLACE INTO assignments VALUES(?,?)').run(id,category);
  }
}
// Listagens da Pluggy (docs.pluggy.ai). As listas comuns paginam por page/totalPages.
// /v2/transactions pagina por cursor: `next` já é a query da próxima página, pronta para
// anexar ao endpoint, e vem nulo na última.
async function collect(get, endpoint, params, cursor = false) {
  const rows = [];
  const page = data => {
    if (!Array.isArray(data.results)) throw new Error('Página inválida.');
    rows.push(...data.results);
  };
  if (!cursor) {
    for (let number = 1, total = 1; number <= total; number++) {
      const data = await get(endpoint + '?' + new URLSearchParams({...params, page:number}));
      page(data);
      total = Number(data.totalPages) || 1;
    }
    return rows;
  }
  const requested = new Set();
  for (let query = '?' + new URLSearchParams(params); query; ) {
    if (!query.startsWith('?') || requested.has(query)) throw new Error('Cursor de paginação inválido.');
    requested.add(query);
    const data = await get(endpoint + query);
    page(data);
    query = data.next || '';
    if (typeof query !== 'string') throw new Error('Cursor de paginação inválido.');
  }
  return rows;
}

// Limite total do contrato do cartão, preferindo a visão consolidada quando a instituição
// também informa linhas individuais.
function totalCreditLine(credit) {
  const lines = (credit.disaggregatedCreditLimits || []).filter(l => l.creditLineLimitType === 'LIMITE_CREDITO_TOTAL');
  return lines.find(l => /^CONSOLIDA/i.test(l.consolidationType ?? ''));
}

export async function synchronize(db, get) {
  const records = [];
  for (const item of db.prepare('SELECT * FROM connections').all()) {
    const accounts = [], transactions = new Map();
    const sourceAccounts = await collect(get,'/accounts',{itemId:item.id});
    const institution = bankName(item.institution, sourceAccounts);
    for (const a of sourceAccounts) {
      const credit = a.creditData || {};
      const line = totalCreditLine(credit);
      const balance = cents(a.balance), limit = cents(credit.creditLimit ?? line?.customizedLimitAmount ?? line?.limitAmount);
      accounts.push({id:a.id, institution, name:a.name || a.subtype, last4:String(a.number || '').slice(-4),
        type:a.type, currency:a.currencyCode, balance, limit,
        // Cartões do mesmo contrato na mesma conexão informam o mesmo limite e o mesmo saldo.
        // O patrimônio conta essa dívida uma vez só.
        shared:a.type === 'CREDIT' && limit != null && balance ? JSON.stringify([item.id,a.currencyCode,limit,balance]) : undefined,
        // Valor aplicado automaticamente, como a instituição o informa (nulo quando ela não informa).
        auto:cents(a.bankData?.automaticallyInvestedBalance) || 0});
      for (const t of await collect(get,'/v2/transactions',{accountId:a.id},true)) {
        const currency = t.amountInAccountCurrency != null ? a.currencyCode : t.currencyCode || a.currencyCode;
        const amount = cents(t.amountInAccountCurrency ?? t.amount);
        if (!t.id || amount == null || !t.date) throw new Error('Transação incompleta.');
        const debit = t.type ? t.type === 'DEBIT' : (a.type === 'CREDIT' ? amount > 0 : amount < 0);
        transactions.set(t.id,{id:t.id, account:a.id, date:t.date.slice(0,10), description:t.description || t.descriptionRaw || 'Sem descrição',
          providerCategory:t.operationType === 'PAGAMENTO_FATURA' ? 'Pagamento de fatura' : t.category || '', pending:t.status === 'PENDING', currency, amount:Math.abs(amount)*(debit?-1:1)});
      }
    }
    const positions = await collect(get,'/investments',{itemId:item.id});
    const holdings = positions.map(p => ({id:p.id,name:p.name,currency:p.currencyCode,net:cents(p.balance),gross:cents(p.amount)}));
    records.push([item.id,institution,JSON.stringify({accounts,transactions:[...transactions.values()],holdings})]);
  }
  const stamp = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const put = db.prepare('INSERT OR REPLACE INTO snapshots VALUES(?,?,?)');
    const rename = db.prepare('UPDATE connections SET institution=? WHERE id=?');
    for (const [id,institution,payload] of records) {
      put.run(id,payload,stamp);
      rename.run(institution,id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
