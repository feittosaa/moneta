import http from 'node:http';
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { randomBytes, createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readJsonObject } from './request-body.mjs';
import { capture, signatures, merge } from './peer-data.mjs';

const token = () => randomBytes(24).toString('base64url');
const version = 'moneta-local-1';
const limit = 64 * 1024 * 1024;
const lan = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every(x => +x <= 255);
function validEndpoint(address) {
  const match = /^(\d+(?:\.\d+){3}):(\d{1,5})$/.exec(address);
  return match && lan(match[1]) && Number(match[2]) > 0 && Number(match[2]) <= 65535;
}
const revision = sig => createHash('sha256').update(JSON.stringify(Object.entries(sig).map(([k,v]) => [k,Object.entries(v).sort()]))).digest('base64url');
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

export function createPeer({ database, store, persist, port = 4174, addresses = () =>
  Object.values(networkInterfaces()).flat().filter(x => x.family === 'IPv4' && lan(x.address)).map(x => x.address) }) {
  let peer = JSON.parse(store.load()?.toString() || 'null');
  let invite, listener, discovery, opening, running, last = null, error = null, change = 0;
  const challenges = new Map();
  const save = next => { if (next) store.save(Buffer.from(JSON.stringify(next))); else store.remove(); peer = next; };
  const available = () => invite && invite.until > Date.now();
  const identity = key => createHash('sha256').update(version+key).digest('hex').slice(0,32);
  function baseline(db) {
    db.exec('CREATE TABLE IF NOT EXISTS peer_checkpoint (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    const row = db.prepare('SELECT value FROM peer_checkpoint WHERE id=1').get();
    const checkpoint = row && JSON.parse(row.value);
    return checkpoint?.id === identity(peer.key) ? checkpoint.base : {};
  }
  function stopNetwork() {
    listener?.close(); listener?.closeAllConnections(); listener = null;
    discovery?.close(); discovery = null; challenges.clear();
  }
  async function serve() {
    if (opening) return opening;
    if (listener) return;
    listener = http.createServer({requestTimeout:15000,headersTimeout:10000}, async (req,res) => {
      const send = (code,data) => { res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); };
      try {
        if (!lan(req.socket.remoteAddress || '') || !database() || req.headers.origin || req.headers.cookie || (!peer && !available())) return send(403,{});
        if (req.method === 'GET' && req.url === '/challenge') {
          const nonce = token();
          challenges.set(nonce,Date.now()+60000);
          if (challenges.size > 64) challenges.delete(challenges.keys().next().value);
          return send(200,{nonce,id:identity(peer?.key || invite.key)});
        }
        if (req.method !== 'POST' || req.url !== '/exchange') return send(404,{});
        const nonce = req.headers['x-moneta-nonce'];
        const key = peer?.key || (available() && invite.key);
        const auth = req.headers['x-moneta-proof'];
        if (!key || !challenges.has(nonce) || !/^[a-f0-9]{64}$/.test(auth) ||
            !timingSafeEqual(Buffer.from(proof(key,nonce)),Buffer.from(auth))) return send(403,{});
        const expiry = challenges.get(nonce);
        challenges.delete(nonce);
        if (!(expiry > Date.now())) return send(403,{});
        const {packet} = await readJsonObject(req,limit);
        const db = database();
        if (!db || key !== (peer?.key || (available() && invite.key))) return send(403,{});
        const body = open(key,'request'+nonce,packet);
        if (!peer) {
          if (!/^[\w-]{43}$/.test(body.pairKey)) throw Error();
          save({key:body.pairKey,role:'host',port:listener.address().port}); invite = null;
          return send(200,{packet:seal(body.pairKey,'reply'+nonce,{paired:true})});
        }
        let rows = capture(db);
        const old = revision(signatures(rows));
        if (body.rows) {
          merge(db,body.base,body.rows,{initial:!Object.keys(body.base).length});
          rows = capture(db);
        }
        persist();
        const current = revision(signatures(rows));
        if (old !== current) change++;
        last = Date.now(); error = null;
        send(200,{packet:seal(key,'reply'+nonce,{rows:current === body.revision ? null : rows})});
      } catch { send(400,{}); }
    });
    const listen = number => new Promise((resolve,reject) => {
      const server = listener;
      const failed = err => { server.removeListener('listening',ready); reject(err); };
      const ready = () => { server.removeListener('error',failed); resolve(); };
      server.once('error',failed);
      server.listen(number,'0.0.0.0',ready);
    });
    opening = listen(peer?.port || port).catch(err => {
      if (err.code !== 'EADDRINUSE') throw err;
      return listen(0);
    });
    try { await opening; }
    catch (err) { stopNetwork(); throw err; }
    finally { opening = null; }
    if (peer && peer.port !== listener.address().port) save({...peer,port:listener.address().port});
    discovery = dgram.createSocket({type:'udp4',reuseAddr:true});
    discovery.on('error',() => {});
    discovery.on('message',(msg,from) => {
      if (peer && database() && msg.toString() === version+identity(peer.key)) discovery.send(msg.toString()+'|'+listener.address().port,from.port,from.address);
    });
    discovery.bind(port);
  }
  function locate(key) {
    return new Promise(resolve => {
      const socket = dgram.createSocket('udp4');
      const tag = Buffer.from(version+identity(key));
      let finished = false;
      const done = ip => {
        if (finished) return;
        finished = true; clearTimeout(timer); socket.close(); resolve(ip);
      };
      const timer = setTimeout(() => done(null),1200);
      socket.once('error',() => done(null));
      socket.on('message',(msg,from) => {
        const [id,number] = msg.toString().split('|');
        const target = from.address+':'+number;
        if (id === tag.toString() && validEndpoint(target)) done(target);
      });
      socket.bind(0,() => { socket.setBroadcast(true); socket.send(tag,port,'255.255.255.255'); });
    });
  }
  async function exchange() {
    const current = peer;
    if (!current || !database()) return;
    if (current.role === 'host') return serve();
    const challenge = async endpoint => {
      const res = await fetch('http://'+endpoint+'/challenge',{redirect:'error',signal:AbortSignal.timeout(2500)});
      if (!res.ok) throw Error();
      const {nonce,id} = await readJsonObject(res.body,4096);
      if (id !== identity(current.key) && (!current.invitation || id !== identity(current.invitation))) throw Error();
      if (!/^[\w-]{32}$/.test(nonce)) throw Error();
      return nonce;
    };
    let endpoint = current.endpoint, nonce;
    try { nonce = await challenge(endpoint); }
    catch {
      endpoint = await locate(current.key);
      if (!endpoint) throw Error();
      nonce = await challenge(endpoint);
    }
    if (current.invitation) {
      const handshake = await fetch('http://'+endpoint+'/exchange',{method:'POST',redirect:'error',
        headers:headers(current.invitation,nonce),signal:AbortSignal.timeout(5000),body:JSON.stringify({packet:seal(current.invitation,'request'+nonce,{pairKey:current.key})})});
      // Se a resposta anterior se perdeu, o anfitrião já usa a chave definitiva.
      if (handshake.ok) {
        const reply = await readJsonObject(handshake.body,4096);
        if (!open(current.key,'reply'+nonce,reply.packet).paired) throw Error();
      }
      nonce = await challenge(endpoint);
    }
    const db = database();
    if (!db || peer !== current) return;
    const base = baseline(db), sent = capture(db), sig = signatures(sent);
    const id = revision(sig);
    const body = revision(base) === id ? {revision:id} : {revision:id,base,rows:sent};
    const res = await fetch('http://'+endpoint+'/exchange',{method:'POST',redirect:'error',
      headers:headers(current.key,nonce),signal:AbortSignal.timeout(30000),body:JSON.stringify({packet:seal(current.key,'request'+nonce,body)})});
    if (!res.ok || Number(res.headers.get('content-length')) > limit) throw Error();
    const {packet} = await readJsonObject(res.body,limit);
    const {rows} = open(current.key,'reply'+nonce,packet);
    if (database() !== db || peer !== current) return;
    if (rows) { merge(db,sig,rows); change++; }
    const next = rows ? signatures(rows) : sig;
    if (revision(base) !== revision(next)) db.prepare('INSERT OR REPLACE INTO peer_checkpoint VALUES (1,?)')
      .run(JSON.stringify({id:identity(current.key),base:next}));
    persist();
    if (endpoint !== current.endpoint || current.invitation) save({endpoint,key:current.key,role:'client'});
    last = Date.now(); error = null;
  }
  function tick() {
    if (!running) running = exchange().catch(() => { error = 'Aguardando o outro aparelho na rede local.'; }).finally(() => { running = null; });
    return running;
  }
  const timer = setInterval(() => {
    if (!peer && invite && !available()) { invite = null; stopNetwork(); }
    if (peer) void tick();
  },15000);
  timer.unref();
  void tick();
  return {
    status:() => ({paired:Boolean(peer && !peer.invitation),pending:Boolean(peer?.invitation),last,error,change}),
    async invite() {
      if (peer) throw Error('Já existe um vínculo.');
      const ips = addresses().filter(lan);
      if (!ips.length) throw Error('Conecte-se à rede Wi-Fi local para gerar o QR.');
      await serve();
      invite = {key:randomBytes(32).toString('base64url'),until:Date.now()+120000};
      const endpoints = ips.map(ip => ip+':'+listener.address().port);
      return {code:[version,endpoints[0],invite.key].join('|'),addresses:endpoints,until:invite.until};
    },
    async join(code) {
      if (peer && !peer.invitation) throw Error('Já existe um vínculo.');
      const [kind,endpoint,key,...extra] = String(code).split('|');
      if (kind !== version || !validEndpoint(endpoint) || !/^[\w-]{43}$/.test(key) || extra.length) throw Error('QR da Moneta inválido.');
      invite = null; stopNetwork();
      save({endpoint,key:randomBytes(32).toString('base64url'),invitation:key,role:'client'});
      await tick();
      return this.status();
    },
    tick,
    forget() { save(null); invite = null; last = null; error = null; stopNetwork(); },
    close() { clearInterval(timer); stopNetwork(); },
  };
}
