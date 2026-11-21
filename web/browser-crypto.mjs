import { sha256 } from './hashes/sha256.js';
import { bytesToHex } from './hashes/utils.js';

export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw Error('Algoritmo desconhecido.');
  const hash = sha256.create();
  return {
    update(text) { hash.update(text); return this; },
    digest(encoding) {
      if (encoding === 'base64url') return btoa(String.fromCharCode(...hash.digest())).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
      if (encoding !== 'hex') throw Error('Formato desconhecido.');
      return bytesToHex(hash.digest());
    },
  };
}

export function randomInt(min, max) {
  if (max === undefined) { max=min; min=0; }
  const range = max-min;
  const limit = 2**48 - 2**48 % range;
  const words = new Uint32Array(2);
  let number;
  do {
    crypto.getRandomValues(words);
    number = (words[0] & 65535)*2**32 + words[1];
  } while (number >= limit);
  return min + number % range;
}
