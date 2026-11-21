import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { initFinance, editFinance } from '../finance.mjs';
import { createPeer } from '../peer-sync.mjs';
import { snapshot, merge, track } from '../peer-data.mjs';

function instance() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE connections(id TEXT PRIMARY KEY,institution TEXT NOT NULL,status TEXT NOT NULL)');
  initFinance(db);
  let secret = null;
  return {db,database:() => db,persist:() => track(db),store:{
    load:() => secret, save:value => { secret = value; }, remove:() => { secret = null; },
  }};
}
const add = (db,name) => editFinance(db,'/api/wallet',{id:'wallet-'+randomUUID(),description:name,
  currency:'BRL',amount:100,kind:'income',date:'2026-11-20'});
const category = (db,key) => db.prepare('SELECT id FROM categories WHERE key=?').get(key).id;
const same = (...dbs) => {
  const [first,...rest] = dbs.map(db => snapshot(db).revision);
  for (const other of rest) assert.equal(other,first);
};
// Troca completa nos dois sentidos, como faz a rede.
const exchange = (a,b) => { merge(b,snapshot(a)); merge(a,snapshot(b)); };

test('mescla carteiras independentes e mantém a categoria certa mesmo com IDs locais iguais',() => {
  const a=instance().db,b=instance().db;
  editFinance(a,'/api/categories',{name:'Casa A'});
  editFinance(b,'/api/categories',{name:'Casa B'});
  add(a,'valor A'); add(b,'valor B');
  for (const db of [a,b]) editFinance(db,'/api/assignment',{id:db.prepare('SELECT id FROM wallet').get().id,category:db.prepare('SELECT id FROM categories WHERE custom=1').get().id});
  exchange(a,b);
  same(a,b);
  for (const db of [a,b]) {
    assert.deepEqual(db.prepare('SELECT c.name,w.description FROM assignments a JOIN wallet w ON w.id=a.tx JOIN categories c ON c.id=a.category ORDER BY name').all().map(x=>[x.name,x.description]),[['Casa A','valor A'],['Casa B','valor B']]);
  }
  a.prepare("DELETE FROM assignments WHERE tx=(SELECT id FROM wallet WHERE description='valor A')").run();
  b.prepare("INSERT INTO notes SELECT id,'nova' FROM wallet WHERE description='valor B'").run();
  exchange(a,b);
  same(a,b);
  assert.equal(b.prepare('SELECT COUNT(*) n FROM assignments').get().n,1);
  assert.equal(a.prepare('SELECT COUNT(*) n FROM notes').get().n,1);
});

test('na mesma regra editada nos dois aparelhos, a edição mais recente vence nos dois sentidos',() => {
  for (const order of ['a primeiro','b primeiro']) {
    const a=instance().db,b=instance().db;
    editFinance(a,'/api/rules',{term:'padaria',category:category(a,'mercado')});
    exchange(a,b);
    const id = b.prepare('SELECT id FROM rules').get().id;
    editFinance(b,'/api/rules/edit',{id,term:'padaria',category:category(b,'alimentacao')});
    track(b,Date.now()+1000);
    editFinance(a,'/api/rules/edit',{id,term:'padaria',category:category(a,'lazer')});
    track(a,Date.now()+5000);
    if (order === 'a primeiro') exchange(a,b); else exchange(b,a);
    same(a,b);
    for (const db of [a,b]) assert.equal(db.prepare('SELECT c.key FROM rules r JOIN categories c ON c.id=r.category').get().key,'lazer',order);
  }
});

test('exclusão mais recente vence uma edição antiga e se propaga',() => {
  const a=instance().db,b=instance().db;
  add(a,'aluguel');
  exchange(a,b);
  const id = a.prepare('SELECT id FROM wallet').get().id;
  b.prepare("UPDATE wallet SET description='aluguel editado' WHERE id=?").run(id);
  track(b,Date.now()+1000);
  a.prepare('DELETE FROM wallet WHERE id=?').run(id);
  track(a,Date.now()+5000);
  exchange(b,a);
  same(a,b);
  for (const db of [a,b]) assert.equal(db.prepare('SELECT COUNT(*) n FROM wallet').get().n,0);
});

test('três aparelhos convergem por um anfitrião e categorias padrão personalizadas vencem',() => {
  const pc=instance().db,android=instance().db,iphone=instance().db;
  pc.prepare("UPDATE categories SET color='#123456' WHERE key='mercado'").run();
  add(android,'android'); add(iphone,'iphone');
  exchange(iphone,pc); exchange(android,pc); exchange(iphone,pc);
  same(pc,android,iphone);
  for (const db of [pc,android,iphone]) {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM wallet').get().n,2);
    assert.equal(db.prepare("SELECT color FROM categories WHERE key='mercado'").get().color,'#123456');
  }
});

test('QR inicial, vários aparelhos, cofre fechado, reinício e desvínculo',async t => {
  const ip=Object.values(networkInterfaces()).flat().find(x=>x.family==='IPv4' && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(x.address))?.address;
  if (!ip) { t.skip('precisa de uma interface de rede local'); return; }
  const a=instance(),b=instance(),c=instance();
  const opts={port:24174,addresses:()=>[ip]};
  let unlocked=true;
  let host=createPeer({...a,...opts,name:'PC',database:()=>unlocked?a.db:null});
  let phone=createPeer({...b,...opts,name:'Android'});
  let tablet=createPeer({...c,...opts,name:'Tablet'});
  t.after(()=>{host.close();phone.close();tablet.close();});
  add(a.db,'PC');add(b.db,'celular');add(c.db,'tablet');
  await phone.join((await host.invite()).codes[0]);
  assert.equal(phone.status().devices[0].name,'PC');
  await tablet.join((await host.invite()).codes[0]);
  assert.deepEqual(host.status().devices.map(d=>d.name).sort(),['Android','Tablet']);
  await phone.tick();
  same(a.db,b.db,c.db);
  assert.equal(b.db.prepare('SELECT COUNT(*) n FROM wallet').get().n,3);
  unlocked=false; add(b.db,'offline');
  await phone.tick();
  assert.ok(phone.status().devices[0].error);
  host.close();phone.close();unlocked=true;
  host=createPeer({...a,...opts});phone=createPeer({...b,...opts});
  await phone.tick(); await tablet.tick();
  same(a.db,b.db,c.db);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM wallet').get().n,4);
  host.forget(host.status().devices.find(d=>d.name==='Tablet').id);
  add(c.db,'desvinculado');
  await tablet.tick();
  assert.equal(a.db.prepare('SELECT COUNT(*) n FROM wallet').get().n,4);
  await assert.rejects(phone.join('moneta-local-1|'+ip+':1|'+'a'.repeat(43)),/QR da Moneta inválido/);
});
