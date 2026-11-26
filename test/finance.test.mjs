import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initFinance, synchronize, overview, portfolioHistory, editFinance } from '../finance.mjs';
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
  const open = cardPeriod(data,a,'2026-12',day);
  assert.equal(open.open,true);
  assert.equal(open.estimated,true);
  const reported = cardPeriod(data,{...a,openAmount:9000},'2026-12',day);
  assert.deepEqual([reported.amount,reported.estimated],[9000,false]);
  assert.equal(cardPeriod(data,b,'2026-12',day).amount,10000);
  assert.equal(summarize(data,'2026-12','BRL',day).invoices,20000);
  const jan = cardPeriod(data,a,'2027-01',day);
  assert.equal(jan.rows[0].installment,2);
  assert.equal(jan.rows[0].projected,true);
  assert.equal(cardPeriod(data,a,'2027-02',day).rows.length,1);
  assert.equal(cardPeriod(data,a,'2027-03',day).amount,null);
  data.bills.push({id:'closed',account:'a',due:'2027-01-02',amount:8000,currency:'BRL'});
  assert.equal(cardPeriod(data,a,'2027-01',day).estimated,false);
  assert.equal(summarize(data,'2027-01','BRL',day).invoices,8000);
});

test('fatura aberta não duplica parcela quando a primeira leva a sobra do arredondamento', async () => {
  const {cardPeriod} = await import('../public/card-periods.mjs');
  const card = {id:'c',type:'CREDIT',currency:'BRL',close:'2026-11-03',due:'2026-11-10'};
  const base = {description:'Loja X',currency:'BRL',account:'c',installments:4,purchaseDate:'2026-09-20',date:'2026-09-20'};
  const transactions = [
    {...base,installment:1,amount:-3334,forecast:'2026-10'},
    {...base,installment:2,amount:-3333,forecast:'2026-11'},
    {...base,installment:3,amount:-3333,forecast:'2026-12',pending:true},
    // Outra compra igual no mesmo dia, de valor diferente, continua sendo projetada à parte.
    {...base,installment:2,amount:-5000,forecast:'2026-11'},
  ];
  const day = '2026-11-22';
  const dec = cardPeriod({bills:[],transactions},card,'2026-12',day);
  assert.equal(dec.open,true);
  assert.equal(dec.amount,3333+5000);
  // Sem a parcela 3 informada, a projeção usa o valor das parcelas seguintes, não o da primeira.
  const jan = cardPeriod({bills:[],transactions},card,'2027-01',day);
  assert.deepEqual(jan.rows.map(r => [r.installment,r.amount]).sort(),[[4,-3333],[4,-5000]]);
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
  db.prepare('INSERT INTO snapshots VALUES (?,?,?)').run('i',JSON.stringify({accounts:[],transactions:[],holdings}),new Date(Date.now()-5*86400000).toISOString());
  initFinance(db);
  let positions = [{id:'y',name:'Tesouro',currencyCode:'BRL',balance:25,amount:25,status:'ACTIVE'}];
  const get = async path => ({results:path.startsWith('/investments?') ? positions : []});
  await synchronize(db,get);
  assert.deepEqual(overview(db).holdings.map(h => [h.id,h.net,h.stale]),[['y',2500,false],['x',9000,true]]);
  positions = [...positions,{id:'x',status:'TOTAL_WITHDRAWAL'}];
  await synchronize(db,get);
  // Resgate total sem rastro: mantém o último saldo conhecido.
  assert.deepEqual(overview(db).holdings.map(h => [h.id,h.net,h.stale]),[['y',2500,false],['x',9000,true]]);
  // Com a venda no extrato do investimento, o resgate vale.
  const sold = async path => ({results:path.startsWith('/investments?') ? positions :
    path.startsWith('/investments/x/transactions') ? [{type:'SELL',date:new Date().toISOString()}] : []});
  await synchronize(db,sold);
  assert.deepEqual(overview(db).holdings.map(h => h.id),['y']);
  assert.deepEqual(portfolioHistory(db).map(point => point.holdings.map(h => h.id)),[['x'],['y']]);
  // Confirmado o resgate, o histórico recente não traz a posição de volta.
  await synchronize(db,async path => ({results:path.startsWith('/investments?') ? positions.slice(0,1) : []}));
  assert.deepEqual(overview(db).holdings.map(h => h.id),['y']);
  db.close();
});

test('posição que some só sai com vencimento ou dinheiro de resgate na conta', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE connections(id TEXT, institution TEXT); INSERT INTO connections VALUES('i','XP')");
  initFinance(db);
  const now = new Date().toISOString(), today = new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  let positions = [{id:'ntnb',name:'NTNB PRINC',currencyCode:'BRL',balance:7000,amount:7000,status:'ACTIVE',dueDate:'2035-05-15'},
    {id:'cdb',name:'CDB',currencyCode:'BRL',balance:1000,amount:1000,status:'ACTIVE'}];
  let credits = [];
  const get = async path => ({results:path.startsWith('/investments?') ? positions :
    path.startsWith('/accounts?') ? [{id:'conta',type:'BANK',currencyCode:'BRL',balance:0}] :
    path.startsWith('/v2/transactions') ? credits : []});
  await synchronize(db,get);
  positions = [{id:'ntnb',status:'TOTAL_WITHDRAWAL'}];
  await synchronize(db,get);
  assert.deepEqual(overview(db).holdings.map(h => [h.id,h.stale,h.due]),[['ntnb',true,'2035-05-15'],['cdb',true,undefined]]);
  credits = [{id:'t',date:now,description:'Resgate de CDB',type:'CREDIT',amount:1000,category:'Fixed income'}];
  await synchronize(db,get);
  assert.deepEqual(overview(db).holdings.map(h => h.id),['ntnb']);
  positions = [{id:'ntnb',status:'TOTAL_WITHDRAWAL',dueDate:today}];
  await synchronize(db,get);
  assert.deepEqual(overview(db).holdings.map(h => h.id),[]);
  db.close();
});

test('posição descartada sem rastro por versão anterior volta pelo histórico recente', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE connections(id TEXT, institution TEXT); INSERT INTO connections VALUES('i','XP')");
  initFinance(db);
  const yesterday = new Date(Date.now()-86400000);
  const day = yesterday.toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  db.prepare('INSERT INTO portfolio_history VALUES (?,?,?)').run('i',day,
    JSON.stringify({accounts:[],holdings:[{id:'ntnb',name:'NTNB PRINC',currency:'BRL',net:714366,gross:714366,lastSeen:yesterday.toISOString()}]}));
  db.prepare('INSERT INTO snapshots VALUES (?,?,?)').run('i',JSON.stringify({accounts:[],transactions:[],holdings:[]}),new Date().toISOString());
  await synchronize(db,async () => ({results:[]}));
  assert.deepEqual(overview(db).holdings.map(h => [h.id,h.net,h.stale]),[['ntnb',714366,true]]);
  db.close();
});

test('posição sumida sem rastro sai depois de 15 dias com o último saldo conhecido', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE connections(id TEXT, institution TEXT); INSERT INTO connections VALUES('i','XP')");
  initFinance(db);
  const ago = days => new Date(Date.now()-days*86400000).toISOString();
  const holdings = [{id:'recente',name:'CDB',currency:'BRL',net:1000,gross:1000,stale:true,lastSeen:ago(14)},
    {id:'antiga',name:'LCI',currency:'BRL',net:2000,gross:2000,stale:true,lastSeen:ago(16)}];
  db.prepare('INSERT INTO snapshots VALUES (?,?,?)').run('i',JSON.stringify({accounts:[],transactions:[],holdings}),ago(1));
  await synchronize(db,async () => ({results:[]}));
  assert.deepEqual(overview(db).holdings.map(h => h.id),['recente']);
  db.close();
});

test('mês previsto pela Pluggy deslocado do vencimento é calibrado pelas faturas fechadas', async () => {
  const {cardPeriod} = await import('../public/card-periods.mjs');
  const card = {id:'x',type:'CREDIT',currency:'BRL',due:'2026-11-10'};
  const bills = [{id:'out',account:'x',currency:'BRL',due:'2026-10-10',amount:300},{id:'nov',account:'x',currency:'BRL',due:'2026-11-10',amount:500}];
  const tx = {account:'x',currency:'BRL',amount:-100};
  const transactions = [
    {...tx,date:'2026-09-15',forecast:'2026-09',billId:'out'},{...tx,date:'2026-09-20',forecast:'2026-09',billId:'out'},
    {...tx,date:'2026-10-15',forecast:'2026-10',billId:'nov'},{...tx,date:'2026-10-20',forecast:'2026-10',billId:'nov'},
    {...tx,date:'2026-11-12',forecast:'2026-11',pending:true,amount:-4000},
  ];
  const dec = cardPeriod({bills,transactions},card,'2026-12','2026-11-22');
  assert.equal(dec.open,true);
  assert.equal(dec.amount,4000);
  assert.equal(cardPeriod({bills,transactions},card,'2026-11','2026-11-22').amount,500);
});

test('pendente repetido pela Pluggy conta uma vez na fatura aberta', async () => {
  const {cardPeriod} = await import('../public/card-periods.mjs');
  const card = {id:'x',type:'CREDIT',currency:'BRL',close:'2026-11-03',due:'2026-11-10'};
  const tx = {account:'x',currency:'BRL',date:'2026-11-12',description:'MULTIMIX',amount:-37519,pending:true};
  const transactions = [tx,{...tx,description:'MULTIMIX                 PETROPOLIS   BR'},{...tx,date:'2026-11-13'},
    {...tx,description:'MULTIMIXX'}];
  const dec = cardPeriod({bills:[],transactions},card,'2026-12','2026-11-22');
  assert.equal(dec.amount,3*37519);
  assert.ok(dec.rows.some(t => t.description.includes('PETROPOLIS')));
});

test('patrimônio desconta o limite usado do cartão, mesmo com a fatura atual zerada', async () => {
  const {portfolio} = await import('../public/report.mjs');
  const accounts = [
    {id:'b',type:'BANK',currency:'BRL',balance:50000,auto:0},
    {id:'w',type:'CASH',currency:'BRL',balance:160579,auto:0},
    {id:'c',type:'CREDIT',currency:'BRL',balance:0,used:794667},
    {id:'d',type:'CREDIT',currency:'BRL',balance:3000},
  ];
  const result = portfolio({holdings:[],accounts},'BRL');
  assert.deepEqual([result.cash,result.credit,result.net],[210579,797667,210579-797667]);
  // Aplicado automaticamente fica na conta, salvo quando aparece também como posição.
  accounts[0].auto = 50000;
  assert.equal(portfolio({holdings:[],accounts},'BRL').cash,210579);
  const holdings = [{currency:'BRL',net:50000,gross:50000}];
  assert.deepEqual([portfolio({holdings,accounts},'BRL').cash,portfolio({holdings,accounts},'BRL').invested],[160579,50000]);
});

test('XP mostra o último limite utilizado corroborado quando a coleta zera o saldo e mantém o vencimento antigo', () => {
  const db = new DatabaseSync(':memory:');
  initFinance(db);
  const card = {id:'xp',institution:'XP',type:'CREDIT',currency:'BRL',limit:4744000,
    due:'2026-11-10',balance:485439,used:485439};
  const jumped = {...card,balance:0,used:794667,usedFromLimit:true};
  const history = db.prepare('INSERT INTO portfolio_history VALUES(?,?,?)');
  const snapshot = db.prepare('INSERT OR REPLACE INTO snapshots VALUES(?,?,?)');
  const payload = account => JSON.stringify({accounts:[account],holdings:[],transactions:[],bills:[]});
  history.run('xp-item','2026-11-21',payload(card));
  history.run('xp-item','2026-11-22',payload(jumped));
  snapshot.run('xp-item',payload(jumped),'2026-11-23T00:58:13.336Z');
  const data = overview(db);
  assert.deepEqual([data.accounts[0].used,data.accounts[0].usedAsOf,data.accounts[0].reportedUsed],
    [485439,'2026-11-21',794667]);
  assert.equal(summarize(data,'2026-11','BRL').credit,485439);
  assert.equal(portfolioHistory(db).at(-1).accounts[0].used,485439);
  for (const override of [{due:'2026-12-10'},{usedFromLimit:false},{balance:794667}]) {
    snapshot.run('xp-item',payload({...jumped,...override}),'2026-11-23T00:58:13.336Z');
    assert.equal(overview(db).accounts[0].used,794667);
  }
  db.close();
});

test('Itaú: parcela colada no nome não duplica e pagamento da fatura não abate a aberta', async () => {
  const {cardPeriod} = await import('../public/card-periods.mjs');
  const card = {id:'i',type:'CREDIT',currency:'BRL',due:'2026-11-10'};
  const bills = [{id:'out',account:'i',currency:'BRL',due:'2026-10-13',amount:21510},{id:'nov',account:'i',currency:'BRL',due:'2026-11-10',amount:21505}];
  const part = (n, extra) => ({account:'i',currency:'BRL',description:'LOJA*XYZ0'+n+'/07',installment:n,installments:7,
    purchaseDate:'2026-09-17',amount:-21505,...extra});
  const transactions = [
    part(1,{date:'2026-09-17',forecast:'2026-10',billId:'out',amount:-21510}),
    part(2,{date:'2026-09-17',forecast:'2026-11',billId:'nov'}),
    part(3,{date:'2026-11-30',forecast:'2026-12',pending:true}),
    part(4,{date:'2026-12-31',forecast:'2027-01',pending:true}),
    {account:'i',currency:'BRL',description:'PAGAMENTO VIA CONTA',date:'2026-11-05',forecast:'2026-12',pending:true,amount:155000},
    {account:'i',currency:'BRL',description:'MERCADO',date:'2026-11-06',forecast:'2026-12',pending:true,amount:-10000},
  ];
  const day = '2026-11-22';
  assert.equal(cardPeriod({bills,transactions},card,'2026-12',day).amount,21505+10000);
  assert.equal(cardPeriod({bills,transactions},card,'2027-01',day).amount,21505);
  assert.equal(cardPeriod({bills,transactions},card,'2027-02',day).amount,21505);
});
