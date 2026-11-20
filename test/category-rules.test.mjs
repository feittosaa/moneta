import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { initFinance, overview, editFinance } from '../finance.mjs';

const catalogSize = JSON.parse(readFileSync(new URL('../default-rules.json', import.meta.url))).length;

test('catálogo completo, prioridade pessoal e reimportação sem duplicatas', () => {
  const db = new DatabaseSync(':memory:');
  initFinance(db);
  const tx = {id:'test', description:'NETFLIX mensal', amount:-1900, date:'2026-04-10', providerCategory:''};
  db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run('item', JSON.stringify({accounts:[],holdings:[],transactions:[tx]}),tx.date);
  const category = data => data.categories.find(c => c.id === data.transactions[0].category)?.name;
  const initial = overview(db);
  assert.equal(initial.catalogRules.length,catalogSize);
  assert.ok(initial.catalogRules.every(r => r.status === 'Ativa'));
  assert.equal(category(initial),'Assinaturas');
  const rule = {name:'Streaming pessoal',conditions_op:'and',priority:1,is_active:true,
    conditions:[{field:'amount',op:'lt',value:'0'},{field:'description',op:'starts_with',value:'netflix'}],
    actions:[{op:'set_category',value:'Cinema em casa'}]};
  const payload = {format:'moneta-categorization-rules',version:1,rules:[rule]};
  editFinance(db,'/api/rules/import',{...payload,applyExisting:false});
  assert.equal(category(overview(db)),'Assinaturas');
  const later = {...tx,id:'later',date:'2026-03-01'};
  db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run('second',JSON.stringify({accounts:[],holdings:[],transactions:[later]}),tx.date);
  const before = overview(db);
  const newCategory = before.categories.find(c => c.name === 'Cinema em casa').id;
  assert.equal(before.transactions.find(t => t.id === later.id).category,newCategory);
  editFinance(db,'/api/assignment',{id:later.id,category:initial.categories.find(c => c.name === 'Compras').id});
  assert.throws(() => editFinance(db,'/api/rules/apply',{}), /Confirme/);
  assert.equal(category(overview(db)),'Assinaturas');
  assert.deepEqual(editFinance(db,'/api/rules/apply',{confirmed:true}),{total:2,changed:1});
  assert.equal(category(overview(db)),'Cinema em casa');
  assert.deepEqual(editFinance(db,'/api/rules/apply',{confirmed:true}),{total:2,changed:0});
  editFinance(db,'/api/rules/import',{...payload,applyExisting:true});
  assert.ok(overview(db).transactions.find(t => t.id === later.id).manual);
  editFinance(db,'/api/rules/import',payload);
  initFinance(db);
  assert.equal(overview(db).catalogRules.length,catalogSize+1);
  assert.equal(category(overview(db)),'Cinema em casa');
  rule.is_active=false;
  editFinance(db,'/api/rules/import',payload);
  assert.equal(category(overview(db)),'Assinaturas');
  db.close();
});

test('uma alternativa por descrição basta para OU com favorecido indisponível, mas não para E', () => {
  const db = new DatabaseSync(':memory:');
  initFinance(db);
  const tx = {id:'one',description:'Fibra local',amount:-1234,date:'2026-11-02',providerCategory:''};
  db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run('item',JSON.stringify({accounts:[],holdings:[],transactions:[tx]}),tx.date);
  const rule = {name:'Internet',conditions_op:'or',conditions:[
    {field:'payee_id',op:'equals',value:'external-id'}, {field:'description',op:'contains',value:'fibra'}],
    priority:1,is_active:true,actions:[{op:'set_category',value:'Moradia'}]};
  const payload = {format:'moneta-categorization-rules',version:1,rules:[rule]};
  editFinance(db,'/api/rules/import',payload);
  assert.equal(overview(db).transactions[0].category,overview(db).categories.find(c=>c.name==='Moradia').id);
  rule.conditions_op='and';
  editFinance(db,'/api/rules/import',payload);
  assert.equal(overview(db).transactions[0].category,null);
  editFinance(db,'/api/settings/currency',{currency:'EUR'});
  initFinance(db);
  assert.equal(overview(db).currency,'EUR');
  db.close();
});

test('pagamento da XP entra na fatura mesmo com recebimento pendente no cartão', async () => {
  const {summarize} = await import('../public/report.mjs');
  const {cardPeriod} = await import('../public/card-periods.mjs');
  const db = new DatabaseSync(':memory:');
  initFinance(db);
  const day = '2026-11-10', month = '2026-11';
  const accounts = ['BANK','CREDIT'].map(type => ({id:type,type,currency:'BRL',institution:'XP'}));
  const bank = {id:'p',description:'Pagamento para BANCO XP S.A',date:day,currency:'BRL',amount:-40000,account:'BANK',providerCategory:'Transfers'};
  const receipt = {...bank,id:'r',account:'CREDIT',amount:40000,description:'Pagamento Efetuado  ',pending:true};
  const write = db.prepare('INSERT OR REPLACE INTO snapshots VALUES(?,?,?)');
  for (const pending of [true,false]) {
    for (const description of ['Pagamento para BANCO XP S.A','Pagamento para BANCO XP S A']) {
      write.run('xp',JSON.stringify({accounts,holdings:[],transactions:[{...bank,description},{...receipt,pending},
        {...bank,id:'pix',description:'PIX para Banco XP',amount:-350}]}),day);
      const data = overview(db);
      const category = data.categories.find(c => c.key === 'pagamento de fatura').id;
      assert.equal(data.transactions.find(t => t.id === 'p').category,category);
      assert.equal(data.transactions.find(t => t.id === 'r').category,category);
      const summary = summarize(data,month,'BRL',day);
      assert.deepEqual([summary.invoices,summary.debit,summary.spent],[40000,350,40350]);
      assert.equal(cardPeriod(data,accounts[1],month,day).paid,40000);
    }
  }
  db.close();
});

test('editar uma regra padrão preserva sua identidade e aplica a nova condição', () => {
  const db = new DatabaseSync(':memory:');
  initFinance(db);
  const tx = {id:'one',description:'Corrida local',date:'2026-11-01',amount:-1000,providerCategory:''};
  db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run('i',JSON.stringify({accounts:[],holdings:[],transactions:[tx]}),tx.date);
  const before = overview(db);
  const rule = before.catalogRules.find(r => r.name === 'Aplicativos de transporte');
  const category = before.categories.find(c => c.name === 'Lazer').id;
  const update = {key:rule.key,name:'Corridas locais',category,active:true,priority:1,mode:'or',values:['Corrida local']};
  editFinance(db,'/api/rules/edit',update);
  initFinance(db);
  const after = overview(db);
  assert.equal(after.catalogRules.length,before.catalogRules.length);
  assert.equal(after.catalogRules.find(r => r.key === rule.key).name,update.name);
  assert.equal(after.transactions[0].category,category);
  editFinance(db,'/api/rules/edit',{...update,active:false});
  assert.equal(overview(db).transactions[0].category,null);
  editFinance(db,'/api/rules',{term:'Padaria',category});
  const local = overview(db).rules[0];
  editFinance(db,'/api/rules/edit',{id:local.id,term:'Corrida',category});
  assert.equal(overview(db).transactions[0].category,category);
  db.close();
});

test('regras combinam documento do destinatário e grupos E/OU', () => {
  const db = new DatabaseSync(':memory:');
  initFinance(db);
  editFinance(db,'/api/categories',{name:'Saúde por documento'});
  const category = overview(db).categories.find(c => c.name === 'Saúde por documento').id;
  const rows = [
    ['a','Farmácia',-1000,'12345678901'],
    ['b','Consulta',-1000,'12345678901'],
    ['c','Farmácia',1000,'12345678901'],
    ['d','Farmácia',-1000,'12345678902'],
    ['e','Supermercado',-1000,'12345678901'],
  ].map(([id,description,amount,receiverDocument]) => ({id,description,amount,receiverDocument,providerCategory:'',date:'2026-11-01'}));
  db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run('i',JSON.stringify({accounts:[],holdings:[],transactions:rows}),'2026-11-01');
  const conditions = [{field:'receiver_document',op:'equals',value:'123.456.789-01'},
    {op:'or',conditions:['farmacia','consulta'].map(value => ({field:'description',op:'contains',value}))}];
  editFinance(db,'/api/rules',{name:'Despesas de saúde',category,mode:'and',conditions});
  assert.deepEqual(overview(db).transactions.filter(t => t.category === category).map(t => t.id),['a','b']);
  assert.ok(overview(db).transactions.every(t => !Object.hasOwn(t,'receiverDocument')));
  db.close();
});

test('categorias duplicadas mesclam atribuições e exclusões permanecem após reiniciar', () => {
  const db = new DatabaseSync(':memory:');
  initFinance(db);
  const duplicate = db.prepare('INSERT INTO categories(name,key,custom,internal) VALUES(?,?,0,0)').run('Salário & Renda','salario & renda').lastInsertRowid;
  db.prepare('INSERT INTO assignments VALUES(?,?)').run('tx',duplicate);
  initFinance(db);
  const data = overview(db);
  const salary = data.categories.find(c => c.key === 'salario');
  assert.equal(db.prepare('SELECT category FROM assignments WHERE tx=?').get('tx').category,salary.id);
  assert.equal(data.categories.filter(c => /salário/i.test(c.name)).length,1);
  assert.equal(data.categories.filter(c => /transferências/i.test(c.name)).length,1);
  const rule = data.catalogRules.find(r => r.category === salary.id);
  editFinance(db,'/api/rules/remove',{key:rule.key});
  editFinance(db,'/api/categories/remove',{id:salary.id});
  initFinance(db);
  assert.ok(!overview(db).categories.some(c => c.id === salary.id));
  assert.ok(!overview(db).catalogRules.some(r => r.key === rule.key));
  db.close();
});
