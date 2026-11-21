// Autoridade de certificados da rede local. A Moneta Web no iPhone ou iPad é um site HTTPS, e o
// Safari só deixa um site HTTPS falar com outro HTTPS confiável. Cada instalação cria a própria
// autoridade, o iPhone a instala uma vez por um perfil, e o servidor de sincronização usa um
// certificado emitido por ela para os IPs atuais.
// A autoridade é restrita (nameConstraints) a IPs privados de IPv4. Mesmo com a chave dela em mãos,
// ninguém consegue emitir um certificado válido para um site da internet.
// Montado só com node:crypto: os certificados são escritos em DER à mão, como pede a RFC 5280.
import { generateKeyPairSync, createPrivateKey, createPublicKey, createHash, randomBytes, sign, X509Certificate } from 'node:crypto';

function length(n) {
  if (n < 128) return [n];
  const bytes = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 255);
  return [128 | bytes.length, ...bytes];
}
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts.map(part => Buffer.isBuffer(part) ? part : Buffer.from(part)));
  return Buffer.concat([Buffer.from([tag, ...length(body.length)]), body]);
};
const seq = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
function oid(text) {
  const [a, b, ...rest] = text.split('.').map(Number);
  const bytes = [40 * a + b];
  for (const n of rest) {
    const group = [n & 127];
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) group.unshift((v & 127) | 128);
    bytes.push(...group);
  }
  return tlv(0x06, bytes);
}
const integer = bytes => tlv(0x02, bytes[0] & 128 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
const yes = tlv(0x01, [0xff]);
const octets = bytes => tlv(0x04, bytes);
const bits = (bytes, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), bytes]));
const utf8 = text => tlv(0x0c, Buffer.from(text));
function time(date) {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2))) : tlv(0x18, Buffer.from(iso));
}
const name = common => seq(set(seq(oid('2.5.4.10'), utf8('Moneta'))), set(seq(oid('2.5.4.3'), utf8(common))));
const extension = (id, critical, value) => seq(oid(id), ...(critical ? [yes] : []), octets(value));
const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'));
const ipBytes = ip => Buffer.from(ip.split('.').map(Number));
// Leitor mínimo de DER: devolve onde começa e termina o conteúdo do campo em offset.
function read(der, offset) {
  const first = der[offset + 1];
  const size = first & 128 ? first & 127 : 0;
  let total = size ? 0 : first;
  for (let i = 0; i < size; i++) total = total * 256 + der[offset + 2 + i];
  const start = offset + 2 + size;
  return { start, end: start + total };
}
// Identificador da chave: SHA-1 dos bits da chave pública, como sugere a RFC 5280.
// SubjectPublicKeyInfo = SEQUENCE { algoritmo, BIT STRING }.
function keyId(spki) {
  const outer = read(spki, 0);
  const algorithm = read(spki, outer.start);
  const key = read(spki, algorithm.end);
  return createHash('sha1').update(spki.subarray(key.start + 1, key.end)).digest();
}

function certificate({ subject, issuer, publicKey, signer, days, extensions }) {
  const spki = createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const tbs = seq(tlv(0xa0, integer(Buffer.from([2]))), integer(serial), ecdsaSha256, issuer,
    seq(time(start), time(end)), subject, spki, tlv(0xa3, seq(...extensions(spki))));
  return seq(tbs, ecdsaSha256, bits(sign('sha256', tbs, signer)));
}

const privateRanges = [['10.0.0.0', '255.0.0.0'], ['172.16.0.0', '255.240.0.0'], ['192.168.0.0', '255.255.0.0']];
// Nomes DNS, e-mails e URIs ficam presos a um domínio que não existe; IPs, às redes privadas.
const constraints = seq(tlv(0xa0,
  ...privateRanges.map(([ip, mask]) => seq(tlv(0x87, Buffer.concat([ipBytes(ip), ipBytes(mask)])))),
  seq(tlv(0x82, Buffer.from('moneta.invalid'))),
  seq(tlv(0x81, Buffer.from('moneta.invalid'))),
  seq(tlv(0x86, Buffer.from('.moneta.invalid')))));

function createAuthority(label) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const subject = name('Moneta sincronização local (' + label + ') ' + randomBytes(3).toString('hex'));
  const der = certificate({
    subject, issuer: subject, publicKey: privateKey, signer: privateKey, days: 20 * 365,
    extensions: spki => [
      extension('2.5.29.19', true, seq(yes, integer(Buffer.from([0])))),
      extension('2.5.29.15', true, bits(Buffer.from([0x06]), 1)),
      extension('2.5.29.30', true, constraints),
      extension('2.5.29.14', false, octets(keyId(spki))),
    ],
  });
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: der.toString('base64'), subject: subject.toString('base64') };
}

// store: createSecret() de secret-store.mjs. A chave da autoridade fica lacrada pelo sistema.
export function localAuthority(store, label) {
  let saved;
  try { saved = JSON.parse(store.load()?.toString() || 'null'); } catch {}
  if (!saved?.key || !saved?.cert || !saved?.subject) {
    saved = createAuthority(label);
    store.save(Buffer.from(JSON.stringify(saved)));
  }
  const der = Buffer.from(saved.cert, 'base64');
  const caKey = createPrivateKey(saved.key);
  const ca = new X509Certificate(der);
  const caId = keyId(createPublicKey(caKey).export({ type: 'spki', format: 'der' }));
  const fingerprint = createHash('sha256').update(der).digest('hex');
  const uuid = salt => {
    const h = createHash('sha256').update(salt + fingerprint).digest('hex');
    return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-').toUpperCase();
  };
  return {
    certificate: ca.toString(),
    fingerprint,
    // Certificado do servidor para os IPs desta rede, renovado a cada início ou troca de IP.
    issue(ips) {
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const der = certificate({
        subject: name('Moneta servidor da rede local'), issuer: Buffer.from(saved.subject, 'base64'),
        publicKey: privateKey, signer: caKey, days: 365,
        extensions: () => [
          extension('2.5.29.19', true, seq()),
          extension('2.5.29.15', true, bits(Buffer.from([0x80]), 7)),
          extension('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),
          extension('2.5.29.17', false, seq(...ips.map(ip => tlv(0x87, ipBytes(ip))))),
          extension('2.5.29.35', false, seq(tlv(0x80, caId))),
        ],
      });
      const pem = '-----BEGIN CERTIFICATE-----\n' + der.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
      return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem + ca.toString() };
    },
    // Perfil de configuração que o iPhone ou iPad instala pelo Safari.
    profile() {
      const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const entry = (key, value) => '<key>' + key + '</key>' + value;
      const string = text => '<string>' + escape(text) + '</string>';
      return Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
        '<plist version="1.0"><dict>' +
        entry('PayloadContent', '<array><dict>' +
          entry('PayloadCertificateFileName', string('moneta.cer')) +
          entry('PayloadContent', '<data>' + saved.cert + '</data>') +
          entry('PayloadDescription', string('Certificado da Moneta para a sincronização pela rede local.')) +
          entry('PayloadDisplayName', string('Moneta (' + label + ')')) +
          entry('PayloadIdentifier', string('br.com.moneta.autoridade.' + uuid('cert'))) +
          entry('PayloadType', string('com.apple.security.root')) +
          entry('PayloadUUID', string(uuid('cert'))) +
          entry('PayloadVersion', '<integer>1</integer>') + '</dict></array>') +
        entry('PayloadDescription', string('Permite que a Moneta no iPhone ou iPad sincronize com ' + label +
          ' pela rede Wi-Fi. O certificado só vale para endereços da rede local.')) +
        entry('PayloadDisplayName', string('Moneta: sincronização com ' + label)) +
        entry('PayloadIdentifier', string('br.com.moneta.sincronizacao.' + uuid('perfil'))) +
        entry('PayloadRemovalDisallowed', '<false/>') +
        entry('PayloadType', string('Configuration')) +
        entry('PayloadUUID', string(uuid('perfil'))) +
        entry('PayloadVersion', '<integer>1</integer>') +
        '</dict></plist>\n');
    },
  };
}
