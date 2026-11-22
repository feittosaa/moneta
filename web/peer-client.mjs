// Cliente da sincronização local na Moneta Web. O navegador não abre portas, então o iPhone ou
// iPad sempre se conecta a uma Moneta com servidor (computador ou Android), em HTTPS com o
// certificado da autoridade local que o aparelho instalou pelo perfil.
import { createHash } from './browser-crypto.mjs';

const protocol = 'moneta-web-2';
const raw = new TextEncoder();
const text = new TextDecoder();
export const identity = key => createHash('sha256').update(protocol+key).digest('hex').slice(0,32);
const from64 = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c => c.charCodeAt(0));
function to64(bytes) {
  let value = '';
  for (let i=0; i<bytes.length; i+=8192) value += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(value);
}
const url64 = value => to64(value).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const aes = key => crypto.subtle.importKey('raw',from64(key),'AES-GCM',false,['encrypt','decrypt']);
const parameters = (iv, context) => ({name:'AES-GCM',iv,additionalData:raw.encode(protocol+context)});
const lan = host => /^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/.test(host);

export function deviceName() {
  const agent = navigator.userAgent;
  if (/iPad/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(agent)) return 'iPhone';
  if (/Android/.test(agent)) return 'Navegador no Android';
  return 'Navegador';
}

export function preparePair(code) {
  const [version,origin,invitation,...extra] = String(code).split('|');
  let url;
  try { url = new URL(origin); } catch {}
  if (version === 'moneta-local-2') throw Error('Este QR é para Android ou computador. No outro aparelho, escolha “iPhone ou iPad”.');
  if (version !== protocol || url?.protocol !== 'https:' || url.origin !== origin || !lan(url.hostname) ||
      !/^[\w-]{43}$/.test(invitation) || extra.length) throw Error('Este não é um QR de vínculo da Moneta. No outro aparelho, toque em “Mostrar QR de vínculo” e escolha “iPhone ou iPad”.');
  const key = url64(crypto.getRandomValues(new Uint8Array(32)));
  return {id:identity(key),key,origin,invitation};
}

async function request(origin,path,options) {
  let response;
  try {
    response = await fetch(origin+path,{...options,credentials:'omit',redirect:'error',
      cache:'no-store',signal:AbortSignal.timeout(path === '/exchange' ? 30000 : 6000)});
  } catch {
    throw Object.assign(Error('Não encontrei a Moneta na rede.'),{offline:true});
  }
  if (!response.ok) throw Error('A outra Moneta recusou a conexão. Confira se o vínculo ainda existe nela.');
  return response.json();
}

async function challenge(origin, id) {
  const reply = await request(origin,'/challenge?id='+id);
  if (reply.id !== id || !/^[\w-]{32}$/.test(reply.nonce)) throw Error('A outra Moneta não reconheceu o vínculo.');
  return reply.nonce;
}

async function exchange(origin, nonce, key, replyKey, body) {
  const hmac = await crypto.subtle.importKey('raw',from64(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const proof = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',hmac,raw.encode(protocol+'proof'+nonce))),
    byte => byte.toString(16).padStart(2,'0')).join('');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt(parameters(iv,'request'+nonce),await aes(key),raw.encode(JSON.stringify(body))));
  const packet = new Uint8Array(iv.length+cipher.length);
  packet.set(iv); packet.set(cipher,iv.length);
  const reply = await request(origin,'/exchange',{method:'POST',headers:{'X-Moneta-Nonce':nonce,'X-Moneta-Proof':proof},
    body:JSON.stringify({packet:to64(packet)})});
  const bytes = from64(reply.packet);
  return JSON.parse(text.decode(await crypto.subtle.decrypt(parameters(bytes.subarray(0,12),'reply'+nonce),
    await aes(replyKey),bytes.subarray(12))));
}

// Primeiro contato: troca o convite do QR pela chave própria deste vínculo. vault diz se a outra
// Moneta usa senha (nulo nas versões que não informam).
export async function confirmPair(pair) {
  const nonce = await challenge(pair.origin,identity(pair.invitation));
  const reply = await exchange(pair.origin,nonce,pair.invitation,pair.key,{pairKey:pair.key,name:deviceName()});
  if (!reply.paired) throw Error('A outra Moneta não confirmou o vínculo.');
  return {peer:{id:pair.id,key:pair.key,origin:pair.origin,name:String(reply.name || 'Moneta').slice(0,40)},
    vault:reply.vault && typeof reply.vault === 'object' ? {password:reply.vault.password === true} : null};
}

// Confere a senha do cofre da outra Moneta, logo depois do vínculo, para usar a mesma aqui.
export async function verifyPair(pair, password) {
  const nonce = await challenge(pair.origin,pair.id);
  const reply = await exchange(pair.origin,nonce,pair.key,pair.key,{verify:String(password)});
  return {valid:reply.valid === true,error:typeof reply.error === 'string' ? reply.error : null};
}

// mine: {revision,state,rows} deste aparelho; agreed: última revisão combinada com o par.
export async function syncPair(pair, mine, agreed) {
  const nonce = await challenge(pair.origin,pair.id);
  const body = agreed === mine.revision ? {revision:mine.revision} :
    {revision:mine.revision,packet:{state:mine.state,rows:mine.rows}};
  return exchange(pair.origin,nonce,pair.key,pair.key,body);
}
