import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initFinance, overview, editFinance, voucherDates } from '../finance.mjs';
import { summarize } from '../public/report.mjs';

test('datas dos vales por recorrência', () => {
  assert.deepEqual(voucherDates({frequency:'monthly',start_date:'2026-01-31',end_date:null},'2026-04-30'),
    ['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
  assert.deepEqual(voucherDates({frequency:'weekly',start_date:'2026-11-06',end_date:'2026-11-19'},'2026-12-31'),
    ['2026-11-06','2026-11-13']);
  // 13/11/2026 é sexta-feira: o fim de semana fica de fora.
  assert.deepEqual(voucherDates({frequency:'daily',weekdays:1,start_date:'2026-11-13',end_date:null},'2026-11-17'),
    ['2026-11-13','2026-11-16','2026-11-17']);
  assert.equal(voucherDates({frequency:'daily',weekdays:0,start_date:'2026-11-13',end_date:null},'2026-11-17').length,5);
  assert.deepEqual(voucherDates({frequency:'once',start_date:'2026-11-01',end_date:null},'2026-11-20'),['2026-11-01']);
  assert.deepEqual(voucherDates({frequency:'once',start_date:'2026-12-01',end_date:null},'2026-11-20'),[]);
});

test('vale gera receita em Benefícios e despesa na categoria escolhida', () => {
  const db = new DatabaseSync(':memory:');
  initFinance(db);
  const food = overview(db).categories.find(c => c.name === 'Alimentação').id;
  const voucher = {name:'Vale-alimentação',amount:80000,currency:'BRL',category:food,frequency:'monthly',start:'2026-01-05',end:'2026-03-05'};
  assert.throws(() => editFinance(db,'/api/vouchers',{...voucher,amount:0}),/maior que zero/);
  assert.throws(() => editFinance(db,'/api/vouchers',{...voucher,frequency:'yearly'}),/Recorrência/);
  assert.throws(() => editFinance(db,'/api/vouchers',{...voucher,end:'2025-12-31'}),/data final/);
  editFinance(db,'/api/vouchers',voucher);
  let data = overview(db);
  const benefits = data.categories.find(c => c.key === 'beneficios');
  assert.equal(benefits.name,'Benefícios');
  const [saved] = data.vouchers;
  const rows = data.transactions.filter(t => t.account === 'voucher-'+saved.id);
  assert.equal(rows.length,6);
  assert.ok(rows.filter(t => t.amount > 0).every(t => t.category === benefits.id && t.amount === 80000));
  assert.ok(rows.filter(t => t.amount < 0).every(t => t.category === food && t.amount === -80000));
  assert.ok(data.accounts.some(a => a.id === 'voucher-'+saved.id && a.type === 'VOUCHER' && a.balance === 0));

  const month = summarize(data,'2026-02','BRL','2026-11-20');
  assert.equal(month.income,80000);
  assert.equal(month.voucherSpent,80000);
  assert.equal(month.spent,80000);
  assert.equal(month.debit,0);
  assert.equal(month.byCategory.get(food),80000);
  assert.equal(month.income-month.spent,0,'o vale não muda o resultado do mês');

  // Bônus de uso único e reclassificação de um crédito.
  editFinance(db,'/api/vouchers',{...voucher,name:'Bônus',amount:30000,frequency:'once',start:'2026-02-10',end:'2026-05-01'});
  data = overview(db);
  assert.equal(data.vouchers.find(v => v.name === 'Bônus').end_date,null);
  assert.equal(summarize(data,'2026-02','BRL','2026-11-20').voucherSpent,110000);
  const out = 'voucher-'+saved.id+'-2026-02-05-out';
  const leisure = data.categories.find(c => c.name === 'Lazer').id;
  editFinance(db,'/api/transaction',{id:out,category:leisure,note:'jantar'});
  assert.throws(() => editFinance(db,'/api/assignment',{id:'voucher-'+saved.id+'-2026-02-06-out',category:leisure}),/desconhecida/);
  data = overview(db);
  assert.equal(data.transactions.find(t => t.id === out).category,leisure);

  // Edição muda o histórico; excluir a categoria deixa o vale sem categoria.
  editFinance(db,'/api/vouchers',{...voucher,id:saved.id,amount:50000});
  assert.equal(overview(db).transactions.find(t => t.id === 'voucher-'+saved.id+'-2026-01-05-in').amount,50000);
  editFinance(db,'/api/categories/remove',{id:food});
  assert.equal(overview(db).vouchers.find(v => v.id === saved.id).category,null);

  editFinance(db,'/api/vouchers/remove',{id:saved.id});
  data = overview(db);
  assert.ok(!data.transactions.some(t => t.account === 'voucher-'+saved.id));
  assert.equal(db.prepare("SELECT count(*) n FROM assignments WHERE tx GLOB 'voucher-*'").get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM notes WHERE tx GLOB 'voucher-*'").get().n,0);
});
