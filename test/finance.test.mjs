import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initFinance, synchronize, overview, editFinance } from '../finance.mjs';
import { summarize } from '../public/report.mjs';

test('sincronização paginada, classificação e patrimônio por moeda', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE connections(id TEXT, institution TEXT); INSERT INTO connections VALUES('item','Banco')");
  initFinance(db);
  const tx = (id,amount,extra={}) => ({id, amount, description:'Café', date:'2026-11-03',currencyCode:'BRL',...extra});
  const account = (id,type,balance,extra={}) => ({id,type,balance,currencyCode:'BRL',...extra});
  const line = {consolidationType:'CONSOLIDADO',creditLineLimitType:'LIMITE_CREDITO_TOTAL',usedAmount:20,limitAmount:200};
  async function get(path) {
    const {pathname,searchParams:q} = new URL(path,'https://example.test');
    if (pathname === '/accounts') return {results:[
      account('bank','BANK',200,{bankData:{automaticallyInvestedBalance:50}}),
      ...['card','extra'].map(id => account(id,'CREDIT',20,{creditData:{disaggregatedCreditLimits:[line]}})),
      account('foreign','BANK',300,{currencyCode:'USD'})]};
    if (pathname === '/bills') return {results:[]};
    if (pathname === '/investments') return {results:[{id:'p',currencyCode:'BRL',balance:50,amount:55}]};
    if (q.get('accountId') === 'card') return {results:[
      tx('purchase',10,{category:'Groceries',type:'DEBIT'}),tx('bill',-10,{operationType:'PAGAMENTO_FATURA'}),
      tx('future',5,{status:'PENDING'})]};
    if (q.get('accountId') !== 'bank') return {results:[]};
    if (q.has('after')) return {results:[tx('lastmonth',-20,{date:'2026-10-31'})]};
    return {results:[tx('income',100,{description:'Salário'})],next:'?accountId=bank&after=page2'};
  }
  await synchronize(db,get);
  let data = overview(db);
  const summary = summarize(data,'2026-11','BRL');
  assert.deepEqual([summary.income,summary.spent,summary.gross,summary.net,summary.credit,summary.invested],[10000,1000,20500,18000,2000,5000]);
  assert.equal(data.transactions.length,5);
  const purchase = () => overview(db).transactions.find(t => t.id === 'purchase');
  const defaultId = purchase().category;
  editFinance(db,'/api/categories',{name:'Cafeterias'});
  const category = overview(db).categories.find(c => c.name === 'Cafeterias').id;
  editFinance(db,'/api/rules',{term:'CAFE',category});
  assert.equal(purchase().category,category);
  editFinance(db,'/api/assignment',{id:'purchase',category:defaultId});
  await synchronize(db,get);
  assert.equal(purchase().category,defaultId);
  assert.equal(overview(db).transactions.length,5);
  await assert.rejects(synchronize(db,async path => {
    if (path.startsWith('/investments')) throw Error('offline');
    return get(path);
  }));
  assert.equal(purchase().manual,true);
  editFinance(db,'/api/assignment',{id:'purchase',category:null});
  assert.equal(purchase().category,category);
  db.close();
});

test('fluxo mensal soma débito e faturas no vencimento, inclusive parcelas, sem duplicar pagamentos', () => {
  const accounts = [{id:'b',type:'BANK',currency:'BRL'},{id:'c',type:'CREDIT',currency:'BRL'}];
  const tx = (account,date,amount,extra={}) => ({account,date,amount,currency:'BRL',...extra});
  const data = {categories:[],holdings:[],accounts,transactions:[
    tx('b','2026-11-01',180000),tx('b','2026-11-02',-80000),
    tx('c','2026-10-26',-40000,{billId:'nov'}),
    tx('c','2026-11-26',-20000,{billId:'dec'}),
    tx('b','2026-11-10',-40000,{providerCategory:'Credit card payment'}),
    tx('c','2026-11-10',40000,{providerCategory:'Credit card payment',billId:'nov'})
  ],bills:[{id:'nov',account:'c',due:'2026-11-10',amount:40000,currency:'BRL'},
    {id:'dec',account:'c',due:'2026-12-10',amount:20000,currency:'BRL'}]};
  const result = summarize(data,'2026-11','BRL');
  assert.deepEqual([result.debit,result.invoices,result.spent,result.income-result.spent],[80000,40000,120000,60000]);
  assert.equal(summarize(data,'2026-12','BRL').spent,20000);
  assert.equal(summarize({...data,bills:[]},'2026-11','BRL').spent,120000);
});

test('ciclos por cartão, fatura fechada e projeção sem duplicar parcelas informadas', async () => {
  const {cardPeriod} = await import('../public/card-periods.mjs');
  const a = {id:'a',type:'CREDIT',currency:'BRL',close:'2026-11-20',due:'2026-12-02'};
  const b = {...a,id:'b',close:'2026-11-12',due:'2026-11-25'};
  const tx = {description:'Loja',date:'2026-11-14',currency:'BRL',amount:-10000,account:'a',installment:1,installments:3,purchaseDate:'2026-11-14'};
  const data = {categories:[],holdings:[],accounts:[a,b],bills:[],transactions:[tx,{...tx,account:'b',installments:1},
    {...tx,installment:3,forecast:'2027-02',date:'2027-02-01'}]};
  const day = '2026-11-15';
  assert.equal(cardPeriod(data,a,'2026-12',day).open,true);
  assert.equal(cardPeriod(data,b,'2026-12',day).amount,10000);
  assert.equal(summarize(data,'2026-12','BRL',day).invoices,20000);
  const jan = cardPeriod(data,a,'2027-01',day);
  assert.equal(jan.rows[0].installment,2);
  assert.equal(jan.rows[0].projected,true);
  assert.equal(cardPeriod(data,a,'2027-02',day).rows.length,1);
  assert.equal(cardPeriod(data,a,'2027-03',day).amount,null);
  data.bills.push({id:'closed',account:'a',due:'2027-01-02',amount:8000,currency:'BRL'});
  assert.equal(summarize(data,'2027-01','BRL',day).invoices,8000);
});

test('movimentos de principal preservam receitas de rendimentos e despesas de imposto', () => {
  const tx = (description,amount,providerCategory) => ({description,amount,providerCategory,date:'2026-11-18',currency:'BRL',account:'b'});
  const data = {categories:[],accounts:[{id:'b',type:'BANK'}],holdings:[],transactions:[
    tx('Resgate res aplic aut',10000,'Automatic investment'),tx('TED aplicação fundo',-15000,'Transfer - TED'),
    tx('Transferência enviada para a conta digital',-5000,'Transfer - TED'),
    tx('IRRF s/resgate fundos',-200,'Mutual funds'),tx('Rendimentos CDB',400,'Fixed income'),tx('Padaria',-700,'Shopping')
  ]};
  const result = summarize(data,'2026-11','BRL');
  assert.deepEqual([result.debit,result.income],[900,400]);
});

test('edição conjunta de nota, categoria e regra é persistida e revertida em caso de erro', () => {
  const db = new DatabaseSync(':memory:');
  initFinance(db);
  const tx = {id:'1',date:'2026-11-01',description:'Mercadinho',providerCategory:'Groceries'};
  db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run('i',JSON.stringify({accounts:[],holdings:[],transactions:[tx]}),'2026-11-01');
  const category = overview(db).transactions[0].category;
  const edit = values => editFinance(db,'/api/transaction',{id:'1',category,note:'Compra da semana',ruleTerm:'Mercadinho',...values});
  edit({});
  assert.throws(() => edit({note:'Não salvar',ruleTerm:' '}));
  const saved = overview(db);
  assert.deepEqual([saved.transactions[0].note,saved.transactions[0].manual,saved.rules.length],['Compra da semana',true,1]);
  edit({category:null,note:'',ruleTerm:null});
  assert.equal(overview(db).transactions[0].note,'');
  db.close();
});

test('previsão enviada pelo banco localiza a fatura mesmo sem dia de fechamento', async () => {
  const {cardPeriod} = await import('../public/card-periods.mjs');
  const card = {id:'c',type:'CREDIT',currency:'BRL',balance:90000};
  const tx = {account:'c',currency:'BRL',date:'2026-12-20',forecast:'2027-01',pending:true,amount:-1600};
  const data = {transactions:[tx],bills:[]};
  const period = cardPeriod(data,card,'2027-01','2026-12-23');
  assert.equal(period.open,true);
  assert.equal(period.amount,1600);
  assert.equal(cardPeriod(data,card,'2026-12','2026-12-23').amount,null);
});

test('composição da fatura agrupa compras e estornos e preserva a diferença até o total oficial', () => {
  const accounts = [{id:'card',type:'CREDIT',currency:'BRL'},{id:'bank',type:'BANK',currency:'BRL'}];
  const tx = (account,amount,category,billId) => ({account,amount,category,billId,currency:'BRL',date:'2026-10-20'});
  const data = {accounts,holdings:[],categories:[],bills:[{id:'nov',account:'card',currency:'BRL',amount:5000,due:'2026-11-10'}],
    transactions:[tx('card',-3000,1,'nov'),tx('card',500,1,'nov'),tx('card',-2000,2,'nov'),
      {...tx('bank',-1000,2),date:'2026-11-01'},tx('card',-9000,2,'dez')]};
  const result = summarize(data,'2026-11','BRL','2026-11-19');
  assert.deepEqual(Object.fromEntries(result.invoiceByCategory),{1:2500,2:2000,invoice:500});
  // Fora do filtro de faturas, a fatura aparece como uma linha só ao lado das despesas de débito.
  assert.deepEqual(Object.fromEntries(result.byCategory),{2:1000,invoices:5000});
  assert.equal(result.spent,6000);
});

test('sem fechamento informado só atribui compras comuns aos ciclos que conciliam o pagamento', () => {
  const card = {id:'c',type:'CREDIT',currency:'BRL'};
  const tx = (date,amount,category,description='Loja') => ({date,amount,category,description,account:'c',currency:'BRL'});
  const data = {accounts:[card],holdings:[],categories:[],transactions:[tx('2026-09-29',-1000,1),
    tx('2026-10-15',-4000,2),tx('2026-10-29',-1000,3),tx('2026-11-10',5000,null,'Pagamentos Validos Normais')]};
  const s = summarize(data,'2026-11','BRL','2026-11-19');
  assert.equal(s.inferred,true);
  assert.deepEqual(Object.fromEntries(s.invoiceByCategory),{2:4000,invoice:1000});
  assert.equal(s.spent,5000);
});

test('a fatura fechada conserva categorias mesmo com compras pendentes estimadas no mesmo período', async () => {
  const {cardPeriod} = await import('../public/card-periods.mjs');
  const card = {id:'c',type:'CREDIT',currency:'BRL'};
  const tx = {account:'c',date:'2026-10-29',amount:-7000,category:1,currency:'BRL'};
  const data = {accounts:[card],categories:[],holdings:[],transactions:[{...tx,billId:'closed'},{...tx,forecast:'2026-11',pending:true}],
    bills:[{id:'closed',account:'c',due:'2026-11-10',amount:7000,currency:'BRL'}]};
  assert.equal(cardPeriod(data,card,'2026-11','2026-11-20').rows.length,1);
  assert.deepEqual([...summarize(data,'2026-11','BRL').invoiceByCategory],[[1,7000]]);
});

test('carteira manual persiste entre sincronizações e só receitas e despesas afetam o fluxo', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE connections(id TEXT, institution TEXT)');
  initFinance(db);
  const record = (n,amount,kind) => editFinance(db,'/api/wallet',{id:'wallet-'+String(n).padStart(36,'0'),currency:'BRL',date:'2026-11-20',amount,kind,description:'Dinheiro'});
  record(1,10000,'adjustment');record(1,10000,'adjustment');record(2,-500,'expense');record(3,100,'income');record(4,-1000,'adjustment');
  await synchronize(db,async () => {throw Error('offline')});
  const data = overview(db);
  assert.equal(data.transactions.length,4);
  const summary = summarize(data,'2026-11','BRL');
  assert.deepEqual([summary.net,summary.income,summary.spent,summary.cashSpent],[8600,100,500,500]);
  db.close();
});

test('sincronização preserva posição omitida e remove resgate total confirmado sem apagar histórico', async () => {
  const {portfolioHistory} = await import('../finance.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE connections(id TEXT, institution TEXT); INSERT INTO connections VALUES('i','XP')");
  initFinance(db);
  const holdings = [{id:'x',name:'CDB',currency:'BRL',net:9000,gross:10000}];
  db.prepare('INSERT INTO snapshots VALUES (?,?,?)').run('i',JSON.stringify({accounts:[],transactions:[],holdings}),'2025-02-10T15:00:00.000Z');
  initFinance(db);
  let positions = [{id:'y',name:'Tesouro',currencyCode:'BRL',balance:25,amount:25,status:'ACTIVE'}];
  const get = async path => ({results:path.startsWith('/investments?') ? positions : []});
  await synchronize(db,get);
  assert.deepEqual(overview(db).holdings.map(h => [h.id,h.net,h.stale]),[['y',2500,false],['x',9000,true]]);
  positions = [...positions,{id:'x',status:'TOTAL_WITHDRAWAL'}];
  await synchronize(db,get);
  assert.deepEqual(overview(db).holdings.map(h => h.id),['y']);
  assert.deepEqual(portfolioHistory(db).map(point => point.holdings.map(h => h.id)),[['x'],['y']]);
  db.close();
});
