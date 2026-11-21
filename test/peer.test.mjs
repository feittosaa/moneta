import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { initFinance, editFinance } from '../finance.mjs';
import { createPeer } from '../peer-sync.mjs';
import { capture, signatures, merge } from '../peer-data.mjs';

function instance() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE connections(id TEXT PRIMARY KEY,institution TEXT NOT NULL,status TEXT NOT NULL)');
  initFinance(db);
  let secret = null;
  return {db,database:() => db,persist:() => {},store:{
    load:() => secret, save:value => { secret = value; }, remove:() => { secret = null; },
  }};
}
const add = (db,name) => editFinance(db,'/api/wallet',{id:'wallet-'+randomUUID(),description:name,
  currency:'BRL',amount:100,kind:'income',date:'2026-11-20'});

test('mescla carteiras independentes e mantém a categoria certa mesmo com IDs locais iguais',() => {
  const a=instance().db,b=instance().db;
  editFinance(a,'/api/categories',{name:'Casa A'});
  editFinance(b,'/api/categories',{name:'Casa B'});
  add(a,'valor A'); add(b,'valor B');
  for (const db of [a,b]) editFinance(db,'/api/assignment',{id:db.prepare('SELECT id FROM wallet').get().id,category:db.prepare('SELECT id FROM categories WHERE custom=1').get().id});
  const before=signatures(capture(b));
  merge(a,{},capture(b),{initial:true}); merge(b,before,capture(a));
  assert.deepEqual(signatures(capture(a)),signatures(capture(b)));
  for (const db of [a,b]) {
    assert.deepEqual(db.prepare('SELECT c.name,w.description FROM assignments a JOIN wallet w ON w.id=a.tx JOIN categories c ON c.id=a.category ORDER BY name').all().map(x=>[x.name,x.description]),[['Casa A','valor A'],['Casa B','valor B']]);
  }
  const base=signatures(capture(b));
  a.prepare("DELETE FROM assignments WHERE tx=(SELECT id FROM wallet WHERE description='valor A')").run();
  b.prepare("INSERT INTO notes SELECT id,'nova' FROM wallet WHERE description='valor B'").run();
  const request=signatures(capture(b));
  merge(a,base,capture(b)); merge(b,request,capture(a));
  assert.deepEqual(signatures(capture(a)),signatures(capture(b)));
  assert.equal(b.prepare('SELECT COUNT(*) n FROM assignments').get().n,1);
});

test('QR inicial, réplica bidirecional, reinício, cofre fechado e retomada',async t => {
  const ip=Object.values(networkInterfaces()).flat().find(x=>x.family==='IPv4' && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(x.address))?.address;
  if (!ip) { t.skip('precisa de uma interface de rede local'); return; }
  const a=instance(),b=instance();
  const opts={port:24174,addresses:()=>[ip]};
  let unlocked=true;
  let host=createPeer({...a,...opts,database:()=>unlocked?a.db:null});
  let client=createPeer({...b,...opts});
  t.after(()=>{host.close();client.close();a.db.close();b.db.close();});
  add(a.db,'PC');add(b.db,'celular');
  const qr=await host.invite();
  assert.ok((await client.join(qr.code)).last);
  assert.deepEqual(signatures(capture(a.db)),signatures(capture(b.db)));
  unlocked=false; add(b.db,'offline');
  await client.tick();
  assert.ok(client.status().error);
  assert.equal(a.db.prepare('SELECT COUNT(*) n FROM wallet').get().n,2);
  host.close();client.close();unlocked=true;
  host=createPeer({...a,...opts});client=createPeer({...b,...opts});
  await client.tick();
  assert.ok(client.status().last);
  assert.deepEqual(signatures(capture(a.db)),signatures(capture(b.db)));
  host.forget(); add(b.db,'desvinculado');
  await client.tick();
  assert.equal(a.db.prepare('SELECT COUNT(*) n FROM wallet').get().n,3);
});
