// Sincronização local entre aparelhos. Cada vínculo tem chave própria; um aparelho pode ter
// vários. Quem mostrou o QR espera conexões (anfitrião); quem leu se conecta (cliente).
// Os pacotes são cifrados e autenticados com AES-256-GCM sobre HTTP na rede local. A Moneta Web
// usa HTTPS, exigido pelo navegador, com o certificado da autoridade local (local-ca.mjs).
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import { networkInterfaces, hostname } from 'node:os';
import { randomBytes, createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readJsonObject } from './request-body.mjs';
import { snapshot, merge, revision, track } from './peer-data.mjs';

const token = () => randomBytes(24).toString('base64url');
const limit = 64 * 1024 * 1024;
export const lan = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every(x => +x <= 255);
// Redes de contêineres e máquinas virtuais não alcançam o celular. O Wi-Fi doméstico vem primeiro.
const virtual = /^(docker|br-|veth|virbr|vmnet|vboxnet|lxc|lxd|cni|flannel|podman|kube)/;
const rank = ip => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2;
export const localAddresses = () => Object.entries(networkInterfaces())
  .filter(([name]) => !virtual.test(name)).flatMap(([,list]) => list)
  .filter(x => x.family === 'IPv4' && lan(x.address)).map(x => x.address)
  .sort((a,b) => rank(a)-rank(b));
function validEndpoint(address) {
  const match = /^(\d+(?:\.\d+){3}):(\d{1,5})$/.exec(address);
  return match && lan(match[1]) && Number(match[2]) > 0 && Number(match[2]) <= 65535;
}
const label = name => String(name || '').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,40) || 'Aparelho';
export const deviceName = () => label(process.env.MONETA_DEVICE_NAME || (process.env.MONETA_ANDROID_PARENT ? 'Android' : hostname()));

export function createPeer({ database, store, persist, web, name = deviceName(), port = web ? 4175 : 4174,
  addresses = localAddresses, profile = () => null }) {
  const version = web ? 'moneta-web-2' : 'moneta-local-2';
  const proof = (key,nonce) => createHmac('sha256',Buffer.from(key,'base64url')).update(version+'proof'+nonce).digest('hex');
  const headers = (key,nonce) => ({'X-Moneta-Nonce':nonce,'X-Moneta-Proof':proof(key,nonce)});
  function seal(key, context, value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm',Buffer.from(key,'base64url'),iv);
    cipher.setAAD(Buffer.from(version+context));
    return Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64');
  }
  function open(key, context, packet) {
    const buf = Buffer.from(packet,'base64');
    const cipher = createDecipheriv('aes-256-gcm',Buffer.from(key,'base64url'),buf.subarray(0,12));
    cipher.setAAD(Buffer.from(version+context));
    cipher.setAuthTag(buf.subarray(-16));
    return JSON.parse(Buffer.concat([cipher.update(buf.subarray(12,-16)),cipher.final()]));
  }
  const identity = key => createHash('sha256').update(version+key).digest('hex').slice(0,32);
  let peers = [];
  try {
    const saved = JSON.parse(store.load()?.toString() || 'null');
    peers = Array.isArray(saved?.peers) ? saved.peers : [];
  } catch {}
  let invite, listener, discovery, opening, change = 0, served = '', keepUntil = 0;
  const runtime = new Map();
  const challenges = new Map();
  const save = () => {
    if (peers.length) store.save(Buffer.from(JSON.stringify({peers})));
    else store.remove();
  };
  const available = () => invite && invite.until > Date.now();
  const hosted = () => peers.some(p => p.role === 'host');
  const info = id => { if (!runtime.has(id)) runtime.set(id,{last:null,error:null}); return runtime.get(id); };
  // Última revisão combinada com cada aparelho; fica no banco, dentro do cofre.
  function agreed(db, id, value) {
    db.exec('CREATE TABLE IF NOT EXISTS sync_peers (id TEXT PRIMARY KEY, revision TEXT NOT NULL)');
    const current = db.prepare('SELECT revision FROM sync_peers WHERE id=?').get(id)?.revision;
    if (value === undefined || value === current) return current;
    db.prepare('INSERT OR REPLACE INTO sync_peers VALUES (?,?)').run(id,value);
  }
  function stopNetwork() {
    listener?.close(); listener?.closeAllConnections(); listener = null; served = '';
    discovery?.close(); discovery = null; challenges.clear();
  }
  // Com o certificado da autoridade local, refaz o certificado do servidor se o IP mudar.
  function refreshTls() {
    if (!web || !listener) return;
    const ips = addresses().filter(lan).sort().join(',');
    if (ips === served) return;
    served = ips;
    listener.setSecureContext(web.tls(ips.split(',').filter(Boolean)));
  }
  const send = (res,code,data) => {
    res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(code === 204 ? undefined : JSON.stringify(data));
  };
  async function handle(req,res) {
    try {
      if (!lan(req.socket.remoteAddress?.replace(/^::ffff:/,'') || '') || req.headers.cookie) return send(res,403,{});
      const url = new URL(req.url,'http://moneta');
      if (!web && req.method === 'GET' && url.pathname === '/moneta.mobileconfig') {
        const file = profile();
        if (!file) return send(res,404,{});
        res.writeHead(200,{'Content-Type':'application/x-apple-aspen-config','Content-Disposition':'attachment; filename="Moneta.mobileconfig"','Cache-Control':'no-store'});
        return res.end(file);
      }
      if (!database() || (!hosted() && !available())) return send(res,403,{});
      if (web) {
        if (!web.origins().includes(req.headers.origin) || !addresses().some(ip => req.headers.host === ip+':'+listener.address().port)) return send(res,403,{});
        res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
        res.setHeader('Vary','Origin');
        if (req.method === 'OPTIONS' && ['/challenge','/exchange'].includes(url.pathname)) {
          res.setHeader('Access-Control-Allow-Methods','GET, POST');
          res.setHeader('Access-Control-Allow-Headers','X-Moneta-Nonce, X-Moneta-Proof, Content-Type');
          res.setHeader('Access-Control-Allow-Private-Network','true');
          res.setHeader('Access-Control-Max-Age','600');
          return send(res,204);
        }
      } else if (req.headers.origin) return send(res,403,{});
      const keyFor = id => peers.find(p => p.role === 'host' && p.id === id)?.key || (available() && identity(invite.key) === id ? invite.key : null);
      if (req.method === 'GET' && url.pathname === '/challenge') {
        const id = url.searchParams.get('id') || '';
        if (!keyFor(id)) return send(res,404,{});
        const nonce = token();
        challenges.set(nonce,{id,until:Date.now()+60000});
        if (challenges.size > 64) challenges.delete(challenges.keys().next().value);
        return send(res,200,{nonce,id});
      }
      if (req.method !== 'POST' || url.pathname !== '/exchange') return send(res,404,{});
      const nonce = req.headers['x-moneta-nonce'];
      const auth = req.headers['x-moneta-proof'];
      const challenge = typeof nonce === 'string' && challenges.get(nonce);
      const key = challenge && keyFor(challenge.id);
      if (!key || !/^[a-f0-9]{64}$/.test(auth || '') ||
          !timingSafeEqual(Buffer.from(proof(key,nonce)),Buffer.from(auth))) return send(res,403,{});
      challenges.delete(nonce);
      if (!(challenge.until > Date.now())) return send(res,403,{});
      const {packet} = await readJsonObject(req,limit);
      const db = database();
      if (!db || key !== keyFor(challenge.id)) return send(res,403,{});
      const body = open(key,'request'+nonce,packet);
      if (invite && key === invite.key) {
        if (!/^[\w-]{43}$/.test(body.pairKey) || peers.some(p => p.key === body.pairKey)) throw Error();
        const id = identity(body.pairKey);
        peers = [...peers,{id,key:body.pairKey,role:'host',name:label(body.name)}];
        save(); invite = null;
        info(id).last = Date.now();
        return send(res,200,{packet:seal(body.pairKey,'reply'+nonce,{paired:true,name})});
      }
      const peer = peers.find(p => p.key === key);
      if (body.packet && merge(db,body.packet)) change++;
      const mine = snapshot(db);
      persist();
      Object.assign(info(peer.id),{last:Date.now(),error:null});
      send(res,200,{packet:seal(key,'reply'+nonce,{revision:mine.revision,
        ...(mine.revision !== body.revision && {state:mine.state,rows:mine.rows})})});
    } catch { send(res,400,{}); }
  }
  async function serve() {
    if (opening) return opening;
    if (listener) return refreshTls();
    const options = {requestTimeout:15000,headersTimeout:10000};
    listener = web ? https.createServer({...options,...web.tls(addresses().filter(lan))},handle) : http.createServer(options,handle);
    served = web ? addresses().filter(lan).sort().join(',') : '';
    const listen = number => new Promise((resolve,reject) => {
      const server = listener;
      const failed = err => { server.removeListener('listening',ready); reject(err); };
      const ready = () => { server.removeListener('error',failed); resolve(); };
      server.once('error',failed);
      server.listen(number,'0.0.0.0',ready);
    });
    opening = listen(port).catch(err => {
      if (err.code !== 'EADDRINUSE') throw err;
      return listen(0);
    });
    try { await opening; }
    catch (err) { stopNetwork(); throw err; }
    finally { opening = null; }
    if (web) return;
    discovery = dgram.createSocket({type:'udp4',reuseAddr:true});
    discovery.on('error',() => {});
    discovery.on('message',(msg,from) => {
      const text = msg.toString();
      if (database() && peers.some(p => p.role === 'host' && text === version+p.id)) discovery.send(text+'|'+listener.address().port,from.port,from.address);
    });
    discovery.bind(port);
  }
  function locate(id) {
    return new Promise(resolve => {
      const socket = dgram.createSocket('udp4');
      const tag = version+id;
      let finished = false;
      const done = ip => {
        if (finished) return;
        finished = true; clearTimeout(timer); socket.close(); resolve(ip);
      };
      const timer = setTimeout(() => done(null),1200);
      socket.once('error',() => done(null));
      socket.on('message',(msg,from) => {
        const [found,number] = msg.toString().split('|');
        const target = from.address+':'+number;
        if (found === tag && validEndpoint(target)) done(target);
      });
      socket.bind(0,() => { socket.setBroadcast(true); socket.send(tag,port,'255.255.255.255'); });
    });
  }
  async function exchange(current) {
    const db = database();
    if (!db) return;
    const challenge = async (endpoint, id) => {
      const res = await fetch('http://'+endpoint+'/challenge?id='+id,{redirect:'error',signal:AbortSignal.timeout(2500)});
      if (!res.ok) throw Error();
      const reply = await readJsonObject(res.body,4096);
      if (reply.id !== id || !/^[\w-]{32}$/.test(reply.nonce)) throw Error();
      return reply.nonce;
    };
    let endpoint = current.endpoint, nonce;
    const first = current.invitation ? identity(current.invitation) : current.id;
    try { nonce = await challenge(endpoint,first); }
    catch {
      if (current.invitation) throw Error();
      endpoint = await locate(current.id);
      if (!endpoint) throw Error();
      nonce = await challenge(endpoint,current.id);
    }
    let peer = current;
    if (current.invitation) {
      const handshake = await fetch('http://'+endpoint+'/exchange',{method:'POST',redirect:'error',
        headers:headers(current.invitation,nonce),signal:AbortSignal.timeout(5000),
        body:JSON.stringify({packet:seal(current.invitation,'request'+nonce,{pairKey:current.key,name})})});
      if (!handshake.ok) throw Error();
      const reply = open(current.key,'reply'+nonce,(await readJsonObject(handshake.body,4096)).packet);
      if (!reply.paired) throw Error();
      peer = {id:current.id,key:current.key,role:'client',endpoint,name:label(reply.name)};
      peers = peers.map(p => p === current ? peer : p);
      save();
      nonce = await challenge(endpoint,peer.id);
    }
    const mine = snapshot(db);
    const body = agreed(db,peer.id) === mine.revision ? {revision:mine.revision} :
      {revision:mine.revision,packet:{state:mine.state,rows:mine.rows}};
    const res = await fetch('http://'+endpoint+'/exchange',{method:'POST',redirect:'error',
      headers:headers(peer.key,nonce),signal:AbortSignal.timeout(30000),body:JSON.stringify({packet:seal(peer.key,'request'+nonce,body)})});
    if (!res.ok || Number(res.headers.get('content-length')) > limit) throw Error();
    const reply = open(peer.key,'reply'+nonce,(await readJsonObject(res.body,limit)).packet);
    if (database() !== db || !peers.includes(peer)) return;
    if (reply.state && merge(db,reply)) change++;
    agreed(db,peer.id,reply.state ? revision(track(db).state) : reply.revision);
    persist();
    if (endpoint !== peer.endpoint) { peers = peers.map(p => p === peer ? {...p,endpoint} : p); save(); }
    Object.assign(info(peer.id),{last:Date.now(),error:null});
  }
  let running;
  function tick() {
    if (running) return running;
    running = (async () => {
      if (hosted() || available()) await serve().catch(() => {});
      for (const peer of peers.filter(p => p.role === 'client')) {
        try { await exchange(peer); }
        catch {
          if (peer.invitation) { peers = peers.filter(p => p !== peer); save(); runtime.delete(peer.id); joinError = 'Não foi possível vincular. Confira se os dois aparelhos estão no mesmo Wi-Fi e gere outro QR.'; }
          else info(peer.id).error = 'Aguardando o aparelho na rede local.';
        }
      }
    })().finally(() => { running = null; });
    return running;
  }
  let joinError = null;
  const timer = setInterval(() => {
    if (invite && !available()) invite = null;
    if (!hosted() && !invite && keepUntil < Date.now() && listener) stopNetwork();
    if (peers.length) void tick();
  },15000);
  timer.unref();
  void tick();
  return {
    status:() => ({
      devices:peers.filter(p => !p.invitation).map(p => ({id:p.id,name:p.name,role:p.role,...info(p.id)})),
      pending:Boolean(available() || peers.some(p => p.invitation)),
      joinError,change,
    }),
    async invite() {
      const ips = addresses().filter(lan);
      if (!ips.length) throw Error('Conecte-se à rede Wi-Fi local para gerar o QR.');
      await serve();
      invite = {key:randomBytes(32).toString('base64url'),until:Date.now()+120000};
      const endpoints = ips.map(ip => (web ? 'https://' : '')+ip+':'+listener.address().port);
      return {codes:endpoints.map(endpoint => [version,endpoint,invite.key].join('|')),addresses:endpoints,until:invite.until};
    },
    async join(code) {
      if (web) throw Error('A Moneta Web lê o QR por conta própria.');
      const [kind,endpoint,key,...extra] = String(code).split('|');
      if (kind !== version || !validEndpoint(endpoint) || !/^[\w-]{43}$/.test(key) || extra.length) throw Error('QR da Moneta inválido. Atualize a Moneta nos dois aparelhos.');
      const pairKey = randomBytes(32).toString('base64url');
      joinError = null;
      peers = [...peers.filter(p => !p.invitation),{id:identity(pairKey),key:pairKey,invitation:key,endpoint,role:'client'}];
      // Uma rodada já em andamento não inclui o vínculo novo.
      if (running) await running;
      await tick();
      if (joinError) throw Error(joinError);
      return this.status();
    },
    tick,
    // Mantém o servidor aberto por um tempo, por exemplo para entregar o perfil do iPhone.
    async share(ms) { keepUntil = Date.now()+ms; await serve(); return listener.address().port; },
    forget(id) {
      peers = peers.filter(p => p.id !== id);
      save(); runtime.delete(id);
      const db = database();
      if (db) { db.exec('CREATE TABLE IF NOT EXISTS sync_peers (id TEXT PRIMARY KEY, revision TEXT NOT NULL)'); db.prepare('DELETE FROM sync_peers WHERE id=?').run(id); }
      if (!hosted() && !available() && keepUntil < Date.now()) stopNetwork();
    },
    close() { clearInterval(timer); stopNetwork(); },
  };
}
