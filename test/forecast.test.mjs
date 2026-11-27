import test from 'node:test';
import assert from 'node:assert/strict';
import { installmentPlan, simulate, bestMoment, availableLimit, addDays } from '../public/forecast.mjs';

// Cartão que fecha no dia 3 e vence no dia 10, com uma compra de R$ 600 em 2x feita em 20/11.
const card = {id:'c',type:'CREDIT',institution:'Banco',currency:'BRL',close:'2026-12-03',due:'2026-12-10',limit:500000,used:100000,balance:60000};
const data = {accounts:[card],categories:[],bills:[],transactions:[
  {id:'t1',account:'c',currency:'BRL',date:'2026-11-20',purchaseDate:'2026-11-20',description:'LOJA',amount:-30000,installment:1,installments:2,pending:true,providerCategory:''},
]};
const today = '2026-11-27';

test('parcelas sem juros põem a sobra na primeira; com juros seguem a tabela Price', () => {
  assert.deepEqual(installmentPlan(100000,3),[33334,33333,33333]);
  assert.deepEqual(installmentPlan(5000,1),[5000]);
  const price = installmentPlan(100000,10,0.02);
  assert.equal(price.length,10);
  assert.ok(price.every(value => value === 11133));
  assert.deepEqual(installmentPlan(0,3),[]);
  assert.equal(addDays('2026-12-31',1),'2027-01-01');
});

test('a simulação soma a compra às faturas já previstas', () => {
  const result = simulate(data,card,{amount:120000,installments:3,date:today},today);
  assert.deepEqual(result.months,['2026-12','2027-01','2027-02']);
  assert.equal(result.firstDue,'2026-12-10');
  assert.equal(result.days,13);
  assert.deepEqual(result.rows.map(r => [r.month,r.before,r.purchase,r.total]),
    [['2026-12',30000,40000,70000],['2027-01',30000,40000,70000],['2027-02',0,40000,40000]]);
  assert.equal(result.peak,70000);
  assert.equal(result.interest,0);
  assert.equal(availableLimit(card),400000);
});

test('o melhor dia é logo depois do fechamento, e esperar mais vale quando a maior fatura cai', () => {
  const moment = bestMoment(data,card,{amount:120000,installments:3,date:today},today);
  assert.deepEqual(moment.candidates.map(c => c.date),['2026-11-27','2026-12-04','2027-01-04','2027-02-04']);
  assert.equal(moment.best.date,'2026-12-04');
  assert.equal(moment.best.firstDue,'2027-01-10');
  assert.equal(moment.best.days,37);
  // Depois do fechamento de janeiro, a parcela 2/2 da LOJA já passou: a maior fatura fica só com a compra.
  assert.equal(moment.later.date,'2027-01-04');
  assert.equal(moment.later.peak,40000);
  // Comprando no dia seguinte ao fechamento, o próprio dia é o melhor.
  assert.equal(bestMoment(data,card,{amount:120000,installments:3,date:'2026-12-04'},today).best.chosen,true);
});

test('sem fechamento conhecido, a primeira parcela vai para o mês seguinte', () => {
  const loose = {...card,close:undefined,due:undefined};
  const result = simulate({...data,accounts:[loose]},loose,{amount:10000,installments:2,date:today},today);
  assert.deepEqual(result.months,['2026-12','2027-01']);
  assert.equal(bestMoment({...data,accounts:[loose]},loose,{amount:10000,installments:2,date:today},today),null);
});
