import { readFileSync } from 'node:fs';

const defaults = JSON.parse(readFileSync(new URL('./default-rules.json', import.meta.url)));
const fold = value => String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const supported = new Set(['contains','not_contains','starts_with','ends_with','equals','not_equals','regex','lt','lte','gt','gte']);

export function categoryKey(value) {
  const key = fold(value).trim();
  if (['salario & renda','salario e renda'].includes(key)) return 'salario';
  if (['transferencias bancarias','transferencia interna'].includes(key)) return 'transferencias';
  return key;
}

export function receiverDocument(value) {
  if (typeof value !== 'string') return null;
  const document = value.toUpperCase().replace(/[.\/ -]/g,'');
  return /^(?:\d{11}|[A-Z0-9]{12}\d{2})$/.test(document) ? document : null;
}

function categoryName(rule) {
  return rule.actions.find(action => action.op === 'set_category')?.value;
}

function ensureCategory(db, name, personal) {
  if (!name) return;
  const key = categoryKey(name);
  if (key === 'salario') name = 'Salário';
  if (key === 'transferencias') name = 'Transferências';
  db.prepare('INSERT OR IGNORE INTO categories(name,key,custom,internal) VALUES (?,?,?,?)')
    .run(name, key, Number(personal), Number(name === 'Investimentos'));
}

export function initRuleCatalog(db) {
  const previous = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB '*_personal_rules'").get();
  if (previous && /^[a-z]+_personal_rules$/.test(previous.name)) {
    db.exec('ALTER TABLE "' + previous.name + '" RENAME TO personal_rules');
  }
  db.exec('CREATE TABLE IF NOT EXISTS rule_history(tx TEXT PRIMARY KEY, category INTEGER)');
  db.exec('CREATE TABLE IF NOT EXISTS personal_rules(name TEXT PRIMARY KEY, definition TEXT NOT NULL, position INTEGER NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS rule_edits(key TEXT PRIMARY KEY, definition TEXT NOT NULL)');
  for (const name of new Set(defaults.map(categoryName))) ensureCategory(db, name, false);
}

export function importRuleCatalog(db, payload) {
  const invalid = message => { throw Object.assign(new Error(message), {status:400}); };
  if (!/^[a-z]+-categorization-rules$/.test(payload.format) || payload.version !== 1 || !Array.isArray(payload.rules))
    invalid('Selecione o JSON exportado pela tela de regras.');
  const put = db.prepare('INSERT INTO personal_rules VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET definition=excluded.definition, position=excluded.position');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (payload.applyExisting === false) {
      const categories = db.prepare('SELECT * FROM categories').all();
      const rules = catalogRules(db, categories);
      const preserve = db.prepare('INSERT OR IGNORE INTO rule_history VALUES (?,?)');
      for (const row of db.prepare('SELECT payload FROM snapshots').iterate()) {
        for (const tx of JSON.parse(row.payload).transactions) {
          preserve.run(tx.id, rules.find(rule => rule.matches?.(tx))?.category ?? null);
        }
      }
    } else {
      db.exec('DELETE FROM rule_history');
    }
    for (const [index, rule] of payload.rules.entries()) {
      if (!rule?.name?.trim?.() || !Array.isArray(rule.conditions) || !Array.isArray(rule.actions) ||
          !['and','or'].includes(rule.conditions_op) || !Number.isInteger(rule.priority) || typeof rule.is_active !== 'boolean')
        invalid('A exportação contém uma regra inválida.');
      const name = categoryName(rule);
      if (name != null && (typeof name !== 'string' || !name.trim())) invalid('Categoria inválida na exportação.');
      ensureCategory(db, name, true);
      put.run(rule.name, JSON.stringify(rule), index);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function condition(node) {
  if (Array.isArray(node?.conditions)) {
    const children = node.conditions.map(condition);
    const usable = children.filter(Boolean);
    if (!usable.length || !['and','or'].includes(node.op)) return null;
    if (node.op === 'and' && usable.length !== children.length) return null;
    return tx => node.op === 'or' ? usable.some(fn => fn(tx)) : usable.every(fn => fn(tx));
  }
  if (node?.field === 'receiver_document') {
    const doc = receiverDocument(node.value);
    return doc && node.op === 'equals' ? tx => tx.amount < 0 && tx.receiverDocument === doc : null;
  }
  if (!node || !['description','amount','type','date','status'].includes(node.field) || !supported.has(node.op) || node.value == null || !String(node.value).trim()) return null;
  const needle = fold(node.value);
  let regex;
  if (node.op === 'regex') {
    try { regex = new RegExp(String(node.value).normalize('NFKD').replace(/\p{M}/gu,''),'iu'); }
    catch { return null; }
    if (regex.test('')) return null;
  }
  return tx => {
    const values = {description:tx.description, amount:tx.amount / 100, date:tx.date, type:tx.amount < 0 ? 'debit' : 'credit', status:tx.pending ? 'pending' : 'posted'};
    const value = values[node.field];
    const text = fold(value);
    const numeric = node.field === 'amount';
    const a = numeric ? Number(value) : text;
    const b = numeric ? Number(node.value) : needle;
    switch (node.op) {
      case 'contains': return text.includes(needle);
      case 'not_contains': return !text.includes(needle);
      case 'starts_with': return text.startsWith(needle);
      case 'ends_with': return text.endsWith(needle);
      case 'equals': return a === b;
      case 'not_equals': return a !== b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'regex': return regex.test(text);
    }
  };
}

function terms(conditions) {
  return conditions.map(c => Array.isArray(c?.conditions) ? terms(c.conditions) : c?.value).join(' ');
}

export function catalogRules(db, categories) {
  const personal = db.prepare('SELECT definition FROM personal_rules ORDER BY position,name').all()
    .map(row => ({...JSON.parse(row.definition), pack:'Perfil pessoal'}));
  const overridden = rule => personal.some(p => p.name === rule.name &&
    (p.is_active === false || (p.conditions_op === rule.conditions_op && JSON.stringify(p.conditions) === JSON.stringify(rule.conditions))));
  const ids = new Map(categories.map(c => [c.key,c.id]));
  const edits = new Map(db.prepare('SELECT * FROM rule_edits').all().map(r => [r.key,JSON.parse(r.definition)]));
  const rules = [...personal,...defaults.filter(rule => !overridden(rule))].map(rule => {
    const imported = personal.includes(rule);
    const key = JSON.stringify([imported ? 'import' : 'default',rule.pack,rule.name]);
    return {...rule,...edits.get(key),key,imported};
  });
  return rules.filter(rule => !rule.deleted)
    .sort((a,b) => a.priority-b.priority)
    .map(rule => {
      const category = ids.get(categoryKey(categoryName(rule)));
      const check = condition({op:rule.conditions_op, conditions:rule.conditions});
      const compatible = Boolean(check && category);
      return {key:rule.key,conditions:rule.conditions,mode:rule.conditions_op,active:rule.is_active !== false,name:rule.name, terms:terms(rule.conditions), pack:rule.pack, imported:rule.imported, category, priority:rule.priority,
        status: rule.is_active === false ? 'Desativada' : !compatible ? 'Requer adaptação' : 'Ativa',
        matches:rule.is_active !== false && compatible ? check : null};
    });
}

export function editCatalogRule(db, body) {
  const invalid = () => { throw Object.assign(new Error('Revise os campos da regra.'), {status:400}); };
  const categories = db.prepare('SELECT * FROM categories').all();
  const old = catalogRules(db,categories).find(r => r.key === body.key);
  const category = categories.find(c => c.id === body.category);
  if (!old || !category || typeof body.name !== 'string' || !body.name.trim() ||
      typeof body.active !== 'boolean' || !['or','and'].includes(body.mode) || !Number.isSafeInteger(body.priority)) invalid();
  let index = 0;
  function editValue(node) {
    if (Array.isArray(node.conditions)) return {...node,conditions:node.conditions.map(editValue)};
    const value = body.values?.[index++];
    if (typeof value !== 'string' || !value.trim()) invalid();
    if (node.op === 'regex' && !condition({...node,value})) invalid();
    return {...node,value:value === String(node.value) ? node.value : value};
  }
  let conditions;
  if (body.conditions != null) conditions = validateConditions(body.conditions,body.mode);
  else {
    if (!Array.isArray(body.values)) invalid();
    conditions = old.conditions.map(editValue);
    if (index !== body.values.length) invalid();
  }
  const definition = {name:body.name.trim(),priority:body.priority,is_active:body.active,conditions_op:body.mode,
    conditions,actions:[{op:'set_category',value:category.key}]};
  db.prepare('INSERT OR REPLACE INTO rule_edits VALUES (?,?)').run(body.key,JSON.stringify(definition));
}

export function validateConditions(nodes, mode) {
  const invalid = () => { throw Object.assign(new Error('Revise as condições. Informe o CPF ou CNPJ completo.'), {status:400}); };
  function validate(group, op) {
    if (!Array.isArray(group) || !group.length || !['and','or'].includes(op)) invalid();
    for (const node of group) {
      if (Array.isArray(node?.conditions)) validate(node.conditions,node.op);
      else if (!condition(node) && !(node?.field === 'payee_id' && String(node.value ?? '').trim())) invalid();
    }
  }
  validate(nodes,mode);
  return nodes;
}

export function removeCatalogRule(db,key) {
  const categories = db.prepare('SELECT * FROM categories WHERE deleted=0').all();
  if (!catalogRules(db,categories).some(r => r.key === key)) return;
  db.prepare('INSERT OR REPLACE INTO rule_edits VALUES (?,?)').run(key,JSON.stringify({deleted:true}));
}
