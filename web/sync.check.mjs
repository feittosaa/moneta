// A Moneta Web sincroniza com o servidor de uma Moneta por HTTPS, com o certificado da autoridade
// local. O fetch abaixo confia só nessa autoridade e manda Origin como o navegador.
import assert from 'node:assert/strict';
import test from 'node:test';
import https from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { networkInterfaces } from 'node:os';
import initSqlJs from 'sql.js';
import { initFinance, editFinance } from '../finance.mjs';
import { createPeer } from '../peer-sync.mjs';
import { localAuthority } from '../local-ca.mjs';
import { snapshot, track } from '../peer-data.mjs';
import { openFinance } from '../dist/web/local-finance.mjs';
import { preparePair, confirmPair, syncPair, verifyPair } from '../dist/web/peer-client.mjs';

const memory = () => { let value = null; return {load:() => value,save:v => { value = v; },remove:() => { value = null; }}; };

function browserFetch(ca, origin) {
  return (url, options = {}) => new Promise((resolve, reject) => {
    const request = https.request(url,{method:options.method || 'GET',ca,
      headers:{...options.headers,Origin:origin,...(options.body && {'Content-Type':'text/plain'})}},response => {
      const chunks = [];
      response.on('data',chunk => chunks.push(chunk));
      response.on('end',() => {
        const body = Buffer.concat(chunks).toString();
        resolve({ok:response.statusCode < 300,status:response.statusCode,json:async () => JSON.parse(body)});
      });
    });
    request.on('error',reject);
    request.end(options.body);
  });
}

test('iPhone e computador sincronizam por HTTPS com a autoridade local, nos dois sentidos', async t => {
  const ip = Object.values(networkInterfaces()).flat().find(x => x.family === 'IPv4' && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(x.address))?.address;
  if (!ip) { t.skip('precisa de uma interface de rede local'); return; }
  const origin = 'https://moneta.example';
  const ca = localAuthority(memory(),'PC de teste');
  const pc = new DatabaseSync(':memory:');
  pc.exec('CREATE TABLE connections(id TEXT PRIMARY KEY,institution TEXT NOT NULL,status TEXT NOT NULL)');
  initFinance(pc);
  const host = createPeer({database:() => pc,persist:() => track(pc),store:memory(),name:'PC',port:24175,
    addresses:() => [ip],web:{tls:ips => ca.issue(ips),origins:() => [origin]},
    vault:() => ({password:true,idle:30}),verify:password => ({valid:password === 'senha do PC',idle:30})});
  t.after(() => host.close());
  const realFetch = globalThis.fetch;
  globalThis.fetch = browserFetch(ca.certificate,origin);
  t.after(() => { globalThis.fetch = realFetch; });

  const SQL = await initSqlJs();
  const phone = openFinance(SQL);
  const spend = (finance, description) => finance.edit('wallet',{id:'wallet-'+crypto.randomUUID(),description,amount:-500,currency:'BRL',kind:'expense',date:'2026-11-21'});
  spend(phone,'café no iPhone'); phone.track();
  editFinance(pc,'/api/wallet',{id:'wallet-'+crypto.randomUUID(),description:'mercado no PC',amount:-900,currency:'BRL',kind:'expense',date:'2026-11-21'});
  track(pc);

  const {codes} = await host.invite();
  assert.match(codes[0],/^moneta-web-2\|https:\/\//);
  const {peer:pair,vault} = await confirmPair(preparePair(codes[0]));
  assert.equal(pair.name,'PC');
  // O PC usa senha: o iPhone confere a senha com ele para criar o cofre com a mesma.
  assert.deepEqual(vault,{password:true});
  assert.deepEqual(await verifyPair(pair,'outra senha'),{valid:false,error:null});
  assert.deepEqual(await verifyPair(pair,'senha do PC'),{valid:true,error:null});
  phone.savePeers([pair]);
  assert.equal(host.status().devices.length,1);

  async function sync() {
    const reply = await syncPair(pair,phone.syncState(),phone.agreed(pair.id));
    if (reply.state) phone.merge(reply);
    phone.agreed(pair.id,reply.state ? phone.revision() : reply.revision);
  }
  await sync();
  assert.equal(phone.revision(),snapshot(pc).revision);
  assert.deepEqual(phone.read('finance').transactions.map(row => row.description).sort(),['café no iPhone','mercado no PC']);

  // Regra criada no PC e editada depois no iPhone: a edição do iPhone, mais recente, vale nos dois.
  const category = (db,key) => db.prepare('SELECT id FROM categories WHERE key=?').get(key).id;
  editFinance(pc,'/api/rules',{term:'padaria',category:category(pc,'mercado')});
  track(pc);
  await sync();
  const rule = phone.db.prepare('SELECT id FROM rules').get().id;
  phone.edit('rules/edit',{id:rule,term:'padaria',category:category(phone.db,'alimentacao')});
  track(phone.db,Date.now()+1000);
  await sync();
  assert.equal(pc.prepare('SELECT c.key FROM rules r JOIN categories c ON c.id=r.category').get().key,'alimentacao');
  assert.equal(phone.revision(),snapshot(pc).revision);

  // Outro site não fala com a Moneta, mesmo com o certificado certo.
  globalThis.fetch = browserFetch(ca.certificate,'https://golpe.example');
  await assert.rejects(syncPair(pair,phone.syncState(),undefined),/recusou/);
  phone.close();
});
