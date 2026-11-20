import {investmentCategory} from './public/movement.mjs';
import { initRuleCatalog, editCatalogRule, catalogRules, importRuleCatalog, categoryKey, receiverDocument, condition, validateConditions, removeCatalogRule } from './category-rules.mjs';
const templates = [
  ['Moradia', 'Housing', 'Telecommunications', 'Utilities', 'Rent'], ['Alimentação', 'Food and drinks', 'Restaurants', 'Food delivery'],
  ['Mercado','Groceries','Supermarket','Supermarkets'], ['Impostos & Taxas','Tax on financial operations'],
  ['Transferências','Transfers','Transfer - PIX','Transfer - TED','Transfer between own accounts','Same person transfer'],
  ['Transporte','Taxi and ride-hailing', 'Transportation', 'Transport'], ['Saúde', 'Healthcare'],
  ['Educação', 'Education'], ['Lazer', 'Entertainment'], ['Compras', 'Shopping', 'Online shopping'],
  ['Salário', 'Salary'], ['Rendimentos', 'Interest', 'Proceeds interests and dividends'], ['Serviços', 'Services', 'Digital services'],
  ['Pagamento de fatura', 'Credit card payment'], ['Movimentação de investimentos', 'Investments','Fixed income','Mutual funds'],
];
const excluded = new Set(templates.slice(-2).map(([name]) => name));
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
const localDay = timestamp => new Date(timestamp).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});

export function portfolioHistory(db) {
  return db.prepare('SELECT * FROM portfolio_history ORDER BY day,item').all()
    .map(({payload,...row}) => ({...row,...JSON.parse(payload)}));
}
export function initFinance(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, name TEXT NOT NULL, key TEXT UNIQUE NOT NULL, custom INTEGER NOT NULL, internal INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rules(id INTEGER PRIMARY KEY, term TEXT NOT NULL, category INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wallet(id TEXT PRIMARY KEY,date TEXT NOT NULL,currency TEXT NOT NULL,amount INTEGER NOT NULL,kind TEXT NOT NULL,description TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notes(tx TEXT PRIMARY KEY, note TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assignments(tx TEXT PRIMARY KEY, category INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS preferences(name TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portfolio_history(item TEXT NOT NULL, day TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(item,day));
    CREATE TABLE IF NOT EXISTS snapshots(item TEXT PRIMARY KEY, payload TEXT NOT NULL, updated TEXT NOT NULL);`);
  const seedHistory = db.prepare('INSERT OR IGNORE INTO portfolio_history VALUES (?,?,?)');
  for (const row of db.prepare('SELECT * FROM snapshots').all()) {
    const {accounts,holdings} = JSON.parse(row.payload);
    seedHistory.run(row.item,localDay(row.updated),JSON.stringify({accounts,holdings}));
  }
  if (!db.prepare('PRAGMA table_info(categories)').all().some(column => column.name === 'color')) {
    db.exec('ALTER TABLE categories ADD COLUMN color TEXT');
  }
  if (!db.prepare('PRAGMA table_info(categories)').all().some(c => c.name === 'deleted')) {
    db.exec('ALTER TABLE categories ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
  }
  if (!db.prepare('PRAGMA table_info(rules)').all().some(c => c.name === 'definition')) {
    db.exec('ALTER TABLE rules ADD COLUMN definition TEXT');
  }
  const seed = db.prepare('INSERT OR IGNORE INTO categories(name,key,custom,internal) VALUES (?,?,0,?)');
  for (const [name] of templates) seed.run(name, fold(name), Number(excluded.has(name)));
  initRuleCatalog(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    const merged = db.prepare('SELECT * FROM categories WHERE key=?');
    for (const key of ['salario & renda','salario e renda','transferencias bancarias','transferencia interna']) {
      const old = merged.get(key);
      const target = merged.get(categoryKey(key));
      if (!old || !target) continue;
      for (const table of ['rules','assignments','rule_history']) {
        db.prepare('UPDATE '+table+' SET category=? WHERE category=?').run(target.id,old.id);
      }
      if (target.key === 'transferencias' && !target.custom) db.prepare('UPDATE categories SET internal=0 WHERE id=?').run(target.id);
      if (old.color) db.prepare('UPDATE categories SET color=COALESCE(color,?) WHERE id=?').run(old.color,target.id);
      db.prepare('DELETE FROM categories WHERE id=?').run(old.id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function accountKind(account, transactions) {
  if (account.type !== 'BANK') return null;
  if (account.institution === 'XP') {
    if (account.bankCode === '102') return 'Conta investimento';
    if (account.bankCode === '348') return 'Conta corrente';
    // Older snapshots only retain the counterparty description on internal transfers.
    const evidence = new Set();
    for (const tx of transactions) {
      if (tx.account !== account.id) continue;
      const match = /^transferencia (recebida da|enviada para a) conta (digital|investimento)$/.exec(fold(tx.description));
      if (!match || !tx.amount || (match[1] === 'recebida da') !== (tx.amount > 0)) continue;
      evidence.add(match[2] === 'digital' ? 'Conta investimento' : 'Conta corrente');
    }
    if (evidence.size === 1) return [...evidence][0];
    if (account.subtype === 'CHECKING_ACCOUNT') return null;
  }
  return {CHECKING_ACCOUNT:'Conta corrente',SAVINGS_ACCOUNT:'Conta poupança',INVESTMENT_ACCOUNT:'Conta investimento'}[account.subtype] || null;
}

const categoryPalette = ['#78A9FF','#FF896B','#64C6AE','#C69AF5','#FFD147','#75C9E6','#E897B5','#A8CA75'];

const categoryColors = new Map(Object.entries({
  'saude':'#69CA92', 'pet':'#A3D47C', 'pets':'#A3D47C', 'pet shop':'#A3D47C', 'animais de estimacao':'#A3D47C', 'salario':'#F77F71',
  'transferencias':'#8EAABD', 'mercado':'#C3D46B', 'alimentacao':'#F3A46D',
  'transporte':'#75B9EF', 'moradia':'#AA9DEB', 'investimentos':'#69C8AE',
  'educacao':'#79AFDE', 'pagamento de fatura':'#FFE699'
}));

function validColor(color) {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) bad('Escolha uma cor válida.');
  return color.toUpperCase();
}

export function overview(db) {
  const categories = db.prepare('SELECT * FROM categories WHERE deleted=0 ORDER BY name').all()
    .map(c => ({...c,color:c.color ?? categoryColors.get(c.key) ?? categoryPalette[(c.id-1) % categoryPalette.length]}));
  const rules = db.prepare('SELECT * FROM rules ORDER BY id').all()
    .map(({definition,...rule}) => ({...rule,...(definition ? JSON.parse(definition) : {})}));
  const inherited = catalogRules(db, categories);
  const notes = new Map(db.prepare('SELECT * FROM notes').all().map(r => [r.tx,r.note]));
  const history = new Map(db.prepare('SELECT tx,category FROM rule_history').all().map(row => [row.tx,row.category]));
  const internalCategories = new Set(categories.filter(c => c.internal).map(c => c.id));
  const normalizedRules = rules.map(rule => ({...rule,matches:rule.conditions ? condition({op:rule.mode,conditions:rule.conditions}) : tx => fold(tx.description).includes(fold(rule.term))}));
  const manual = new Map(db.prepare('SELECT * FROM assignments').all().map(x => [x.tx, x.category]));
  const aliases = new Map();
  for (const [name,...others] of templates) {
    const id = categories.find(x => x.key === fold(name))?.id;
    for (const alias of [name,...others]) aliases.set(fold(alias),id);
  }
  const accounts = [], holdings = [], transactions = [], bills = [];
  function append(data) {
    accounts.push(...data.accounts.map(a => ({...a,kind:accountKind(a,data.transactions)})));
    holdings.push(...data.holdings);
    bills.push(...(data.bills || []));
    const creditAccounts = new Set(data.accounts.filter(a => a.type === 'CREDIT').map(a => a.id));
    for (const tx of data.transactions) {
      const description = fold(tx.description);
      const rule = normalizedRules.find(r => r.active !== false && r.matches?.(tx));
      const automatic = history.has(tx.id) ? history.get(tx.id) : inherited.find(r => r.matches?.(tx))?.category;
      const cardPayment = creditAccounts.has(tx.account) && tx.amount > 0 && /^(?:pagamento (?:efetuado|recebido)|pagamentos validos normais)$/.test(description);
      const movement = cardPayment ? 'Pagamento de fatura' : investmentCategory(tx);
      const classified = automatic ?? aliases.get(fold(tx.providerCategory));
      const internal = internalCategories.has(classified);
      const fallback = movement ? aliases.get(categoryKey(movement)) : null;
      const category = manual.get(tx.id) ?? rule?.category ?? (internal && movement ? fallback : automatic) ?? fallback ?? classified ?? null;
      const displayTx = {...tx};
      delete displayTx.receiverDocument;
      transactions.push({...displayTx, note:notes.get(tx.id) || '', category, manual:manual.has(tx.id)});
    }
  }
  const sources = db.prepare('SELECT * FROM snapshots ORDER BY item').all().map(row => {
    const snapshot = JSON.parse(row.payload);
    append(snapshot);
    return {item:row.item, updated:row.updated,needsCardSync:!Array.isArray(snapshot.bills) && snapshot.accounts.some(a => a.type === 'CREDIT')};
  });
  const balances = new Map();
  const cash = db.prepare('SELECT * FROM wallet').all().map(row => {
    balances.set(row.currency,(balances.get(row.currency) || 0)+row.amount);
    return {...row,account:'wallet-'+row.currency,pending:false,providerCategory:row.kind === 'adjustment' ? 'Transfer between own accounts' : ''};
  });
  append({holdings:[],transactions:cash,accounts:[...balances].map(([currency,balance]) =>
    ({id:'wallet-'+currency,type:'CASH',name:'Carteira',currency,balance,auto:0}))});
  transactions.sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const currency = db.prepare("SELECT value FROM preferences WHERE name='currency'").get()?.value || 'BRL';
  return {currency,bills,categories,rules,catalogRules:inherited.map(({matches,...rule}) => rule),accounts,holdings,transactions,sources};
}
export function editFinance(db, path, body) {
  if (path === '/api/wallet') {
    if (!/^wallet-[0-9a-f-]{36}$/.test(body.id) || !Intl.supportedValuesOf('currency').includes(body.currency) ||
        !Number.isSafeInteger(body.amount) || !body.amount || !['adjustment','income','expense'].includes(body.kind) ||
        (body.kind === 'income' && body.amount < 0) || (body.kind === 'expense' && body.amount > 0)) bad('Movimentação inválida.');
    const date = new Date(body.date+'T12:00:00Z');
    if (!Number.isFinite(+date) || date.toISOString().slice(0,10) !== body.date) bad('Data inválida.');
    const description = label(body.description);
    const previous = db.prepare('SELECT * FROM wallet WHERE id=?').get(body.id);
    if (previous) {
      if (['date','currency','amount','kind'].some(k => body[k] !== previous[k]) || description !== previous.description) bad('Movimentação já registrada.');
      return;
    }
    db.prepare('INSERT INTO wallet VALUES(?,?,?,?,?,?)').run(body.id,body.date,body.currency,body.amount,body.kind,description);
    return;
  }
  if (path === '/api/transaction') {
    if (typeof body.note !== 'string' || body.note.length > 2000) bad('A nota deve ter até 2.000 caracteres.');
    db.exec('BEGIN IMMEDIATE');
    try {
      editFinance(db,'/api/assignment',body);
      if (body.note.trim()) db.prepare('INSERT OR REPLACE INTO notes VALUES (?,?)').run(body.id,body.note.trim());
      else db.prepare('DELETE FROM notes WHERE tx=?').run(body.id);
      if (body.ruleTerm != null) editFinance(db,'/api/rules',{term:body.ruleTerm,category:body.category});
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return;
  }
  if (path === '/api/settings/currency') {
    if (!Intl.supportedValuesOf('currency').includes(body.currency)) bad('Moeda inválida.');
    db.prepare("INSERT OR REPLACE INTO preferences VALUES ('currency',?)").run(body.currency);
    return;
  }
  if (path === '/api/rules/apply') {
    if (body.confirmed !== true) bad('Confirme a aplicação das regras.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const before = new Map(overview(db).transactions.map(tx => [tx.id, tx.category]));
      // Remove classificações congeladas por importações limitadas a lançamentos novos.
      db.exec('DELETE FROM rule_history');
      const { transactions } = overview(db);
      const changed = transactions.filter(tx => tx.category !== before.get(tx.id)).length;
      db.exec('COMMIT');
      return { total: transactions.length, changed };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (path === '/api/rules/import') return importRuleCatalog(db, body);
  const category = body.category;
  if (category != null && (!Number.isInteger(category) || !db.prepare('SELECT 1 FROM categories WHERE id=? AND deleted=0').get(category))) bad('Categoria inválida.');
  if (path === '/api/rules' || path === '/api/rules/edit') {
    if (body.key != null) return editCatalogRule(db,body);
    if (!category) bad('Selecione uma categoria.');
    const advanced = body.conditions != null;
    const name = label(advanced ? body.name : body.term);
    const definition = advanced ? JSON.stringify({name,mode:body.mode,active:body.active !== false,
      conditions:validateConditions(body.conditions,body.mode)}) : null;
    if (path === '/api/rules/edit') {
      if (!Number.isSafeInteger(body.id) || !db.prepare('UPDATE rules SET term=?,category=?,definition=? WHERE id=?').run(name,category,definition,body.id).changes) bad('Regra desconhecida.');
    } else db.prepare('INSERT INTO rules(term,category,definition) VALUES(?,?,?)').run(name,category,definition);
    return;
  }
  if (path === '/api/categories/edit') {
    const name = label(body.name);
    const existing = db.prepare('SELECT id FROM categories WHERE deleted=0 AND lower(name)=lower(?) AND id<>?').get(name,body.id);
    if (existing) bad('Essa categoria já existe.');
    if (!db.prepare('UPDATE categories SET name=?, color=?, internal=? WHERE id=? AND deleted=0').run(name,validColor(body.color),Number(body.internal === true),body.id).changes) bad('Categoria inválida.');
    return;
  }
  if (path === '/api/categories/remove') {
    if (!Number.isSafeInteger(body.id)) bad('Categoria inválida.');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE categories SET deleted=1 WHERE id=?').run(body.id);
      for (const table of ['rules','assignments','rule_history']) db.prepare('DELETE FROM '+table+' WHERE category=?').run(body.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return;
  }
  if (path === '/api/categories/color') {
    const color = validColor(body.color);
    if (!Number.isSafeInteger(body.id) || !db.prepare('UPDATE categories SET color=? WHERE id=?').run(color,body.id).changes) bad('Categoria inválida.');
    return;
  }
  if (path === '/api/categories') {
    const name = label(body.name);
    const key = categoryKey(name);
    const existing = db.prepare('SELECT id FROM categories WHERE deleted=0 AND (key=? OR lower(name)=lower(?))').get(key,name);
    if (existing) bad('Essa categoria já existe.');
    db.prepare(`INSERT INTO categories(name,key,custom,internal,color) VALUES(?,?,1,?,?)
      ON CONFLICT(key) DO UPDATE SET name=excluded.name,internal=excluded.internal,color=excluded.color,deleted=0`)
      .run(name,key,Number(body.internal === true),body.color == null ? null : validColor(body.color));
  } else if (path === '/api/rules/remove') {
    if (body.key != null) return removeCatalogRule(db,body.key);
    if (!Number.isInteger(body.id)) bad('Regra inválida.');
    db.prepare('DELETE FROM rules WHERE id=?').run(body.id);
  } else {
    const id = label(body.id);
    const exists = db.prepare(`
      SELECT 1 FROM snapshots, json_each(snapshots.payload, '$.transactions') AS tx
      WHERE json_extract(tx.value, '$.id') = ? UNION ALL SELECT 1 FROM wallet WHERE id=? LIMIT 1
    `).get(id,id);
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

// O número de transferência documentado é <COMPE>/<agência>/<conta>. Como a agência tem
// quatro dígitos, um primeiro segmento de três dígitos identifica o banco.
function bankCode(transferNumber) {
  const [first, ...rest] = String(transferNumber ?? '').split('/');
  return rest.length && /^\d{3}$/.test(first) ? first : undefined;
}

// Limite total do contrato do cartão, preferindo a visão consolidada quando a instituição
// também informa linhas individuais.
function totalCreditLine(credit) {
  const lines = (credit.disaggregatedCreditLimits || []).filter(l => l.creditLineLimitType === 'LIMITE_CREDITO_TOTAL');
  return lines.find(l => /^CONSOLIDA/i.test(l.consolidationType ?? ''));
}

function accountRecord(itemId, institution, a) {
  const credit = a.creditData || {};
  const line = totalCreditLine(credit);
  const balance = cents(a.balance);
  const limit = cents(credit.creditLimit ?? line?.customizedLimitAmount ?? line?.limitAmount);
  // Pela documentação, limite = disponível + saldo da fatura + dívida anterior.
  const used = cents(line?.usedAmount) ??
    (credit.creditLimit != null && credit.availableCreditLimit != null ? cents(credit.creditLimit)-cents(credit.availableCreditLimit) : null);
  return {id:a.id, institution, name:a.name || a.subtype, last4:String(a.number || '').slice(-4),
    bankCode:bankCode(a.bankData?.transferNumber), subtype:a.subtype,
    close:credit.balanceCloseDate?.slice(0,10), due:credit.balanceDueDate?.slice(0,10),
    openAmount:a.type === 'CREDIT' && credit.balanceCloseDate && credit.balanceDueDate ? balance : null,
    used, type:a.type, currency:a.currencyCode, balance, limit,
    // Cartões do mesmo contrato na mesma conexão informam o mesmo limite e o mesmo saldo.
    // O patrimônio conta essa dívida uma vez só.
    shared:a.type === 'CREDIT' && limit != null && balance ? JSON.stringify([itemId,a.currencyCode,limit,balance]) : undefined,
    // Valor aplicado automaticamente, como a instituição o informa (nulo quando ela não informa).
    auto:cents(a.bankData?.automaticallyInvestedBalance) || 0};
}
export async function synchronize(db, get) {
  const records = [];
  for (const item of db.prepare('SELECT * FROM connections').all()) {
    const accounts = [], bills = new Map(), transactions = new Map();
    const sourceAccounts = await collect(get,'/accounts',{itemId:item.id});
    const institution = bankName(item.institution, sourceAccounts);
    for (const a of sourceAccounts) {
      accounts.push(accountRecord(item.id,institution,a));
      if (a.type === 'CREDIT') {
        for (const b of await collect(get,'/bills',{accountId:a.id})) {
          if (!b.id || !b.dueDate || b.totalAmount == null) throw new Error('Fatura incompleta.');
          bills.set(b.id,{id:b.id,account:a.id,close:b.billClosingDate?.slice(0,10),due:b.dueDate.slice(0,10),amount:cents(b.totalAmount),
            currency:b.totalAmountCurrencyCode || a.currencyCode, payments:(b.payments || []).map(p => ({
              date:p.paymentDate?.slice(0,10), amount:cents(p.amount),currency:p.currencyCode || b.totalAmountCurrencyCode
            }))});
        }
      }
      for (const t of await collect(get,'/v2/transactions',{accountId:a.id},true)) {
        const currency = t.amountInAccountCurrency != null ? a.currencyCode : t.currencyCode || a.currencyCode;
        const amount = cents(t.amountInAccountCurrency ?? t.amount);
        if (!t.id || amount == null || !t.date) throw new Error('Transação incompleta.');
        const debit = t.type ? t.type === 'DEBIT' : (a.type === 'CREDIT' ? amount > 0 : amount < 0);
        transactions.set(t.id,{id:t.id, account:a.id, date:t.date.slice(0,10), description:t.description || t.descriptionRaw || 'Sem descrição',
          receiverDocument:receiverDocument(t.paymentData?.receiver?.documentNumber?.value), operation:t.operationType,installment:t.creditCardMetadata?.installmentNumber,installments:t.creditCardMetadata?.totalInstallments,
          forecast:t.creditCardMetadata?.billForecastDate, billPostDate:t.creditCardMetadata?.billPostDate?.slice(0,10),
          purchaseDate:t.creditCardMetadata?.purchaseDate?.slice(0,10),billId:t.creditCardMetadata?.billId || null,
          providerCategory:t.operationType === 'PAGAMENTO_FATURA' ? 'Pagamento de fatura' : t.category || '', pending:t.status === 'PENDING', currency, amount:Math.abs(amount)*(debit?-1:1)});
      }
    }
    // Keep previously imported closed statements when the provider's history window shrinks.
    const saved = db.prepare('SELECT payload FROM snapshots WHERE item=?').get(item.id);
    const prior = saved ? JSON.parse(saved.payload) : null;
    if (prior) {
      const active = new Set(accounts.map(a => a.id));
      const returned = [...bills.values()];
      const archived = new Set();
      for (const b of prior.bills || []) {
        if (!active.has(b.account) || bills.has(b.id) ||
            returned.some(current => current.account === b.account && current.due === b.due && current.currency === b.currency)) continue;
        bills.set(b.id,b);
        archived.add(b.id);
      }
      for (const t of prior.transactions) {
        if (archived.has(t.billId) && !transactions.has(t.id)) transactions.set(t.id,t);
      }
    }
    const positions = await collect(get,'/investments',{itemId:item.id});
    const previous = new Map((prior?.holdings || []).map(h => [h.id,h]));
    const holdings = [];
    for (const p of positions) {
      if (!p.id) throw new Error('Posição de investimento incompleta.');
      const cached = previous.get(p.id);
      previous.delete(p.id);
      // Posição totalmente resgatada: a Pluggy a mantém na lista com saldo zero.
      if (p.status === 'TOTAL_WITHDRAWAL') continue;
      holdings.push({id:p.id,name:p.name || cached?.name || 'Investimento',currency:p.currencyCode || cached?.currency,
        net:cents(p.balance) ?? cached?.net ?? null,gross:cents(p.amount) ?? cached?.gross ?? null,
        stale:p.balance == null, lastSeen:p.balance == null ? cached?.lastSeen ?? saved?.updated : new Date().toISOString()});
    }
    for (const h of previous.values()) {
      if (h.net !== 0 || h.gross !== 0) holdings.push({...h,stale:true,lastSeen:h.lastSeen || saved.updated});
    }
    records.push([item.id,institution,JSON.stringify({accounts,bills:[...bills.values()],transactions:[...transactions.values()],holdings})]);
  }
  const stamp = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const put = db.prepare('INSERT OR REPLACE INTO snapshots VALUES(?,?,?)');
    const recordHistory = db.prepare(`INSERT INTO portfolio_history VALUES (?,?,?)
      ON CONFLICT(item,day) DO UPDATE SET payload=excluded.payload`);
    const rename = db.prepare('UPDATE connections SET institution=? WHERE id=?');
    for (const [id,institution,payload] of records) {
      put.run(id,payload,stamp);
      const {accounts,holdings} = JSON.parse(payload);
      recordHistory.run(id,localDay(stamp),JSON.stringify({accounts,holdings}));
      rename.run(institution,id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
