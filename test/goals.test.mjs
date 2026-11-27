import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initFinance, overview, editFinance } from '../finance.mjs';
import { snapshot, merge, revision, track } from '../peer-data.mjs';

const id = n => 'goal-'+String(n).padStart(8,'0')+'-0000-4000-8000-000000000000';
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE connections (id TEXT PRIMARY KEY, institution TEXT NOT NULL, status TEXT NOT NULL)');
  initFinance(db);
  return db;
}

test('meta de economia soma aportes e não deixa retirar mais do que foi guardado', () => {
  const db = setup();
  assert.throws(() => editFinance(db,'/api/goals',{kind:'save',name:'Viagem',amount:0,currency:'BRL'}),/maior que zero/);
  assert.throws(() => editFinance(db,'/api/goals',{kind:'save',name:'Viagem',amount:100,currency:'BRL',deadline:'2027-02-30'}),/Data inválida/);
  editFinance(db,'/api/goals',{kind:'save',name:'Viagem',amount:500000,currency:'BRL',deadline:'2027-06-30',category:3});
  let [goal] = overview(db).goals;
  assert.equal(goal.category,null,'meta de economia não tem categoria');
  assert.equal(goal.saved,0);
  const deposit = {id:id(1),goal:goal.id,date:'2026-11-27',amount:120000,description:''};
  editFinance(db,'/api/goals/deposit',deposit);
  editFinance(db,'/api/goals/deposit',deposit);
  assert.throws(() => editFinance(db,'/api/goals/deposit',{...deposit,amount:1}),/já registrado/);
  assert.throws(() => editFinance(db,'/api/goals/deposit',{...deposit,id:id(2),amount:-130000}),/maior que o valor guardado/);
  editFinance(db,'/api/goals/deposit',{...deposit,id:id(2),amount:-20000,description:'Passagem'});
  [goal] = overview(db).goals;
  assert.equal(goal.saved,100000);
  assert.deepEqual(goal.deposits.map(d => d.description).sort(),['Aporte','Passagem']);
  // Editar não muda o tipo nem a moeda.
  editFinance(db,'/api/goals',{id:goal.id,kind:'limit',name:'Viagem',amount:600000,currency:'USD',deadline:null});
  [goal] = overview(db).goals;
  assert.deepEqual([goal.kind,goal.currency,goal.amount,goal.deadline],['save','BRL',600000,null]);
  editFinance(db,'/api/goals/deposit/remove',{id:id(2)});
  assert.equal(overview(db).goals[0].saved,120000);
  editFinance(db,'/api/goals/remove',{id:goal.id});
  assert.equal(overview(db).goals.length,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM goal_deposits').get().n,0);
});

test('limite de gasto: um por categoria, nunca em categoria fora do fluxo, e sai com a categoria', () => {
  const db = setup();
  const {categories} = overview(db);
  const food = categories.find(c => c.name === 'Alimentação').id;
  const internal = categories.find(c => c.internal).id;
  assert.throws(() => editFinance(db,'/api/goals',{kind:'limit',name:'Fatura',amount:100,currency:'BRL',category:internal}),/categoria/);
  editFinance(db,'/api/goals',{kind:'limit',name:'Alimentação',amount:80000,currency:'BRL',category:food,deadline:'2027-01-01'});
  editFinance(db,'/api/goals',{kind:'limit',name:'Total',amount:500000,currency:'BRL',category:null});
  assert.throws(() => editFinance(db,'/api/goals',{kind:'limit',name:'Comida',amount:1,currency:'BRL',category:food}),/essa categoria/);
  assert.throws(() => editFinance(db,'/api/goals',{kind:'limit',name:'Tudo',amount:1,currency:'BRL'}),/total de despesas/);
  editFinance(db,'/api/goals',{kind:'limit',name:'Comida em dólar',amount:1,currency:'USD',category:food});
  const saved = overview(db).goals.find(g => g.category === food && g.currency === 'BRL');
  assert.equal(saved.deadline,null);
  editFinance(db,'/api/goals',{id:saved.id,name:'Alimentação',amount:90000,category:food});
  assert.throws(() => editFinance(db,'/api/goals/deposit',{id:id(3),goal:saved.id,date:'2026-11-27',amount:100}),/Meta desconhecida/);
  editFinance(db,'/api/categories/remove',{id:food});
  assert.deepEqual(overview(db).goals.map(g => g.name),['Total']);
});

test('metas sincronizam entre aparelhos e um aparelho sem elas continua compatível', () => {
  const pc = setup(), phone = setup();
  track(pc); track(phone);
  // Pacote de uma versão anterior: sem as tabelas de metas.
  const old = snapshot(phone);
  for (const part of ['state','rows']) { delete old[part].goals; delete old[part].goal_deposits; }
  assert.doesNotThrow(() => merge(pc,old));
  assert.equal(revision(track(pc).state),revision(old.state),'sem metas, as revisões coincidem com a versão anterior');

  const food = overview(pc).categories.find(c => c.name === 'Alimentação').id;
  editFinance(pc,'/api/goals',{kind:'limit',name:'Alimentação',amount:80000,currency:'BRL',category:food});
  editFinance(pc,'/api/goals',{kind:'save',name:'Reserva',amount:1000000,currency:'BRL'});
  const reserve = overview(pc).goals.find(g => g.kind === 'save');
  editFinance(pc,'/api/goals/deposit',{id:id(4),goal:reserve.id,date:'2026-11-27',amount:50000});
  track(pc);
  assert.equal(merge(phone,snapshot(pc)),true);
  const goals = overview(phone).goals;
  assert.equal(goals.find(g => g.kind === 'save').saved,50000);
  const phoneFood = overview(phone).categories.find(c => c.name === 'Alimentação').id;
  assert.equal(goals.find(g => g.kind === 'limit').category,phoneFood);
});
