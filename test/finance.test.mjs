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
