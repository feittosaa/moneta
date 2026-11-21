// Desbloqueio pelo Face ID, Touch ID, digital ou senha do aparelho, com uma passkey e a extensão
// PRF do WebAuthn. A passkey devolve um segredo só depois da verificação do usuário; dele sai a
// chave AES que guarda a senha do cofre neste aparelho. Sem a passkey, o registro não abre.
const random = size => crypto.getRandomValues(new Uint8Array(size));
const info = new TextEncoder().encode('moneta-web-biometria-1');
const label = 'Moneta neste aparelho';

export function deviceLabel() {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|Macintosh/.test(agent)) return 'Face ID ou Touch ID';
  return 'digital ou bloqueio de tela';
}

export async function biometricSupported() {
  try {
    if (!globalThis.PublicKeyCredential || !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return false;
    const capabilities = await PublicKeyCredential.getClientCapabilities?.().catch(() => null);
    return capabilities?.['extension:prf'] !== false;
  } catch { return false; }
}

async function keyFrom(output) {
  const material = await crypto.subtle.importKey('raw',output,'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(32),info},material,
    {name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}

function unsupported() {
  return Error('Este aparelho não permite destravar sites com a biometria. Atualize o sistema ou continue usando a senha.');
}

async function evaluate(credential, salt) {
  const result = await navigator.credentials.get({publicKey:{
    challenge:random(32),rpId:location.hostname,userVerification:'required',timeout:60000,
    allowCredentials:[{type:'public-key',id:credential}],extensions:{prf:{eval:{first:salt}}},
  }});
  const output = result?.getClientExtensionResults().prf?.results?.first;
  if (!output) throw unsupported();
  return output;
}

function friendly(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') return Object.assign(Error('Cancelado.'),{cancel:true});
  return error;
}

// Cria a passkey e devolve o registro a guardar. Pode pedir a verificação duas vezes, quando o
// sistema só entrega o segredo PRF na leitura.
export async function enrollBiometric(password) {
  try {
    const salt = random(32);
    const created = await navigator.credentials.create({publicKey:{
      challenge:random(32),rp:{name:'Moneta',id:location.hostname},
      user:{id:random(16),name:label,displayName:label},
      pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
      authenticatorSelection:{authenticatorAttachment:'platform',residentKey:'preferred',userVerification:'required'},
      timeout:60000,extensions:{prf:{eval:{first:salt}}},
    }});
    const prf = created.getClientExtensionResults().prf;
    if (prf?.enabled === false) throw unsupported();
    const credential = new Uint8Array(created.rawId);
    const output = prf?.results?.first || await evaluate(credential,salt);
    const iv = random(12);
    const data = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await keyFrom(output),new TextEncoder().encode(password)));
    return {credential,salt,iv,data};
  } catch (error) { throw friendly(error); }
}

export async function biometricPassword(record) {
  let output;
  try { output = await evaluate(record.credential,record.salt); }
  catch (error) { throw friendly(error); }
  try {
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv},await keyFrom(output),record.data);
    return new TextDecoder().decode(plain);
  } catch { throw Object.assign(Error('A passkey não abre mais este registro. Ative o desbloqueio de novo em Configuração.'),{stale:true}); }
}
