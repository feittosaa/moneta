import test from 'node:test';
import assert from 'node:assert/strict';
import { resumo } from '../public/resumo.mjs';

const tx = (id, date, amount, extra = {}) => ({id, date, description:'Compra '+id, amount, currency:'BRL', account:'card',
  pending:false, providerCategory:'', category:'food', ...extra});
const data = {
  currency:'BRL',
  categories:[{id:'food', name:'Alimentação'}],
  holdings:[], vouchers:[], rules:[],
  sources:[{item:'x', updated:'2026-11-20'}],
  accounts:[
    {id:'bank', type:'BANK', institution:'Banco', name:'Conta corrente', currency:'BRL', balance:250000},
    {id:'card', type:'CREDIT', institution:'Banco', name:'Cartão', currency:'BRL', balance:-17000, last4:'1234'},
  ],
  bills:[{id:'nov', account:'card', close:'2026-11-03', due:'2026-11-10', amount:50000, currency:'BRL', payments:[{date:'2026-11-10', amount:50000}]}],
  transactions:[
    tx('a', '2026-10-20', -50000, {billId:'nov'}),
    tx('b', '2026-11-12', -12000),
    tx('c', '2026-11-18', -5000),
    tx('d', '2026-11-25', -999),
  ],
};

test('fatura em aberto, contas e lançamentos recentes como na Visão geral', () => {
  const r = resumo(data, '2026-11-20');
  const card = r.cards[0];
  assert.equal(card.last4, '1234');
  // Mesmo valor do indicador da Visão geral: o ciclo inclui a compra já lançada para 25/11.
  assert.deepEqual(card.openInvoice, {month:'2026-12', amount:17999, closingDate:'2026-12-03', dueDate:'2026-12-10', estimated:true});
  assert.equal(r.totals[0].openInvoices, 17999);
  assert.deepEqual(r.accounts.map(a => [a.name, a.balance]), [['Conta corrente', 250000]]);
  assert.deepEqual(r.recent.map(t => t.date), ['2026-11-18', '2026-11-12', '2026-10-20'], 'sem lançamentos futuros');
  assert.equal(r.recent[0].category, 'Alimentação');
  assert.equal(r.connected, true);
});

test('fatura fechada a vencer aparece entre as próximas', () => {
  const r = resumo(data, '2026-11-05');
  assert.deepEqual(r.cards[0].upcomingBills, [{due:'2026-11-10', close:'2026-11-03', amount:50000, currency:'BRL', paid:50000}]);
});

test('despesas por categoria dos últimos 12 meses somam o total do mês', () => {
  const r = resumo({...data, categories:[...data.categories, {id:'market', name:'Mercado'}],
    transactions:[...data.transactions, {id:'e', date:'2026-09-05', description:'Mercado Pix', amount:-3000, currency:'BRL',
      account:'bank', pending:false, providerCategory:'', category:'market'}]}, '2026-11-20');
  assert.deepEqual(r.months.map(m => m.month), ['2026-09', '2026-10', '2026-11'], 'só meses com movimento');
  // Gasto pela data da compra: a compra de outubro fica em outubro, não na fatura de novembro.
  assert.deepEqual(r.months.find(m => m.month === '2026-10').purchases, {total:50000, categories:[{name:'Alimentação', amount:50000}]});
  assert.equal(r.months.find(m => m.month === '2026-10').spent, 0);
  for (const m of r.months) assert.equal(m.purchases.categories.reduce((total, c) => total + c.amount, 0), m.purchases.total, m.month);
  for (const m of r.months) assert.equal(m.categories.reduce((total, c) => total + c.amount, 0), m.spent, m.month);
  assert.deepEqual(r.months[0].categories, [{name:'Mercado', amount:3000}]);
  // A fatura de novembro (paga em 10/11) traz a compra de outubro em Alimentação.
  assert.deepEqual(r.months.find(m => m.month === '2026-11').categories.find(c => c.name === 'Alimentação'), {name:'Alimentação', amount:50000});
});
