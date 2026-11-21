const format = new TextEncoder().encode('MONETAWEB1\n');
const saltSize = 16;
const ivSize = 12;
const headerSize = format.length + saltSize;
export const maxBackupSize = 64 * 1024 * 1024;

async function derive(password, salt) {
  const secret = await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},secret,
    {name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}

function writer(key, header) {
  return async bytes => {
    if (bytes.length + headerSize + ivSize + 16 > maxBackupSize) throw Error('O cofre atingiu o tamanho máximo desta versão.');
    const iv = crypto.getRandomValues(new Uint8Array(ivSize));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:header},key,bytes));
    const result = new Uint8Array(headerSize + ivSize + cipher.length);
    result.set(header);
    result.set(iv,headerSize);
    result.set(cipher,headerSize+ivSize);
    return result;
  };
}

export async function createCipher(password) {
  const header = new Uint8Array(headerSize);
  header.set(format);
  const salt = header.subarray(format.length);
  crypto.getRandomValues(salt);
  return writer(await derive(password,salt),header);
}

export async function decryptVault(password, envelope) {
  if (envelope.length < headerSize + ivSize + 16 || envelope.length > maxBackupSize ||
      format.some((byte,i) => byte !== envelope[i])) throw Error('Escolha um backup válido da Moneta Web.');
  const header = envelope.subarray(0,headerSize);
  const key = await derive(password,header.subarray(format.length));
  const iv = envelope.subarray(headerSize,headerSize + ivSize);
  let bytes;
  try {
    bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:header},key,envelope.subarray(headerSize+ivSize));
  } catch { throw Error('Senha incorreta ou cofre danificado.'); }
  return {bytes:new Uint8Array(bytes),encrypt:writer(key,header)};
}

export function vaultStorage() {
  return new Promise((resolve,reject) => {
    const opening = indexedDB.open('moneta-web:'+new URL('.',location.href).pathname,1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('vault');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      db.onversionchange = () => db.close();
      resolve({
        read: () => transaction('readonly', store => store.get('local')),
        save(bytes, expected, settings = {}) {
          const value = {revision:crypto.randomUUID(),bytes,...settings};
          return transaction('readwrite',store => {
            const current = store.get('local');
            current.onsuccess = () => {
              if (current.result?.revision === expected) store.put(value,'local');
              else store.transaction.abort();
            };
            return current;
          }).then(() => value);
        },
      });
      function transaction(mode,operation) {
        return new Promise((done,fail) => {
          const tx = db.transaction('vault',mode);
          const request = operation(tx.objectStore('vault'));
          tx.onabort = () => fail(tx.error || Error('O cofre mudou em outra tela. Tranque e abra o cofre novamente.'));
          tx.oncomplete = () => done(request.result);
        });
      }
    };
  });
}
