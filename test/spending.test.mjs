import test from 'node:test';
import assert from 'node:assert/strict';
import { spending, purchases, summarize } from '../public/report.mjs';

const base = {
  currency:'BRL', holdings:[], vouchers:[], rules:[], sources:[{item:'x', updated:'2026-11-20'}],
  categories:[{id:'market', name:'Mercado', key:'mercado'}, {id:'home', name:'Casa', key:'casa'},
    {id:'pay', name:'Pagamento de fatura', key:'pagamento de fatura'}, {id:'own', name:'Entre contas', key:'entre contas', internal:1}],
  accounts:[
    {id:'bank', type:'BANK', institution:'Banco', name:'Conta', currency:'BRL', balance:0},
    {id:'card', type:'CREDIT', institution:'Banco', name:'Cartão', currency:'BRL', balance:0},
  ],
  bills:[{id:'nov', account:'card', close:'2026-11-03', due:'2026-11-10', amount:30000, currency:'BRL', payments:[{date:'2026-11-10', amount:30000}]}],
};
const tx = (id, account, date, amount, extra = {}) => ({id, account, date, amount, currency:'BRL', description:'Compra '+id,
  pending:false, providerCategory:'', category:'market', ...extra});

test('compra no cartão conta no mês da compra, não no da fatura', () => {
  const data = {...base, transactions:[
    tx('a', 'card', '2026-10-20', -30000, {billId:'nov'}),
    tx('p', 'card', '2026-11-10', 30000, {description:'Pagamento recebido', category:'pay'}),
    tx('d', 'bank', '2026-11-10', -30000, {description:'Pagamento de fatura', category:'pay'}),
    tx('b', 'bank', '2026-11-05', -5000),
    tx('t', 'bank', '2026-11-06', -9000, {category:'own'}),
  ]};
  const today = '2026-11-20';
  assert.equal(spending(data, '2026-10', 'BRL', today).total, 30000);
  assert.equal(spending(data, '2026-11', 'BRL', today).total, 5000, 'pagamento de fatura e transferência interna ficam de fora');
  // O fluxo mensal continua contando a fatura em novembro.
  assert.equal(summarize(data, '2026-11', 'BRL', today).spent, 35000);
});

test('parcelada entra com o valor total no mês da compra', () => {
  const parcel = (n, date, amount) => tx('i'+n, 'card', date, amount, {description:`LOJA X ${n}/4`, installment:n, installments:4,
    purchaseDate:'2026-09-20', category:'home'});
  const data = {...base, bills:[], transactions:[parcel(1,'2026-09-20',-2503), parcel(2,'2026-10-20',-2500), parcel(3,'2026-11-20',-2500)]};
  const sep = spending(data, '2026-09', 'BRL', '2026-11-20');
  assert.equal(sep.total, 10003, 'primeira parcela com a sobra + 3 × 25,00');
  assert.deepEqual([...sep.byCategory], [['home', 10003]]);
  assert.equal(sep.rows[0].installments, 4);
  assert.equal(spending(data, '2026-10', 'BRL', '2026-11-20').total, 0);
  assert.equal(spending(data, '2026-11', 'BRL', '2026-11-20').total, 0);
});

test('estorno no cartão abate e pendente repetido conta uma vez', () => {
  const data = {...base, bills:[], transactions:[
    tx('m1', 'card', '2026-11-12', -8000, {pending:true, description:'MULTIMIX'}),
    tx('m2', 'card', '2026-11-12', -8000, {pending:true, description:'MULTIMIX  PETROPOLIS  BR'}),
    tx('e', 'card', '2026-11-14', 2000, {description:'Estorno MULTIMIX'}),
    tx('f', 'bank', '2026-11-25', -999),
  ]};
  const nov = spending(data, '2026-11', 'BRL', '2026-11-20');
  assert.equal(nov.total, 6000);
  assert.equal(purchases(data, 'BRL', '2026-11-20').some(p => p.date > '2026-11-20'), false, 'sem lançamentos futuros');
});
