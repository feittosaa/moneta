// Guarda segredos lacrados pelo sistema operacional, nunca em texto puro quando dá.
// Linux: systemd-creds --user, que cifra com uma chave presa ao usuário e, havendo TPM 2.0, à máquina.
//        O arquivo lacrado não abre em outro computador, com outro usuário ou com outro nome.
// Windows: DPAPI do usuário atual (o mesmo cofre que o Windows usa para senhas salvas).
// Sem nenhum dos dois (por exemplo, dentro do Docker), o segredo fica num arquivo com permissão 0600.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync, openSync, writeSync, closeSync, fsyncSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const run = (command, args, input) => spawnSync(command, args, { input, timeout: 15000, windowsHide: true, maxBuffer: 1 << 20 });

const sealers = {
  'systemd-creds': {
    extension: 'cred',
    available: () => process.platform === 'linux' && run('systemd-creds', ['--user', 'encrypt', '--name=moneta-teste', '-', '-'], 'teste').status === 0,
    seal: (name, data) => run('systemd-creds', ['--user', 'encrypt', '--name=' + name, '-', '-'], data),
    unseal: (name, data) => run('systemd-creds', ['--user', 'decrypt', '--name=' + name, '--newline=no', '-', '-'], data),
  },
  dpapi: {
    extension: 'dpapi',
    available: () => process.platform === 'win32' && powershell('Protect', Buffer.from('teste')).status === 0,
    seal: (name, data) => powershell('Protect', data),
    unseal: (name, data) => powershell('Unprotect', Buffer.from(data.toString().trim(), 'base64')),
  },
};

// Entrada e saída em base64 pela entrada padrão; o segredo nunca passa pela linha de comando.
function powershell(operation, data) {
  const script = 'Add-Type -AssemblyName System.Security;' +
    '$in=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());' +
    `$out=[Security.Cryptography.ProtectedData]::${operation}($in,$null,'CurrentUser');` +
    '[Console]::Out.Write([Convert]::ToBase64String($out))';
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], Buffer.from(data).toString('base64'));
  // Protect devolve o lacre em base64 (é o que vai para o arquivo); Unprotect devolve os bytes originais.
  if (result.status === 0 && operation === 'Unprotect') result.stdout = Buffer.from(result.stdout.toString().trim(), 'base64');
  return result;
}

// Grava de forma atômica, com permissão 0600 desde a criação e com os dados no disco antes da troca.
export function writePrivate(file, data) {
  const tmp = file + '.' + randomUUID();
  try {
    const fd = openSync(tmp, 'wx', 0o600);
    try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}

// Sobrescreve o conteúdo antes de apagar. Em SSD e em sistemas de arquivos copy-on-write isso
// não garante que os blocos antigos sumam, mas tira o segredo do caminho óbvio.
export function wipe(file) {
  try {
    const size = statSync(file).size;
    const fd = openSync(file, 'r+');
    try { writeSync(fd, Buffer.alloc(size), 0, size, 0); fsyncSync(fd); } finally { closeSync(fd); }
  } catch {}
  rmSync(file, { force: true });
}

let detected;
export function detectSealer() {
  if (detected === undefined) {
    detected = process.env.MONETA_SECRET_STORE === 'arquivo' ? null
      : Object.keys(sealers).find(key => { try { return sealers[key].available(); } catch { return false; } }) ?? null;
  }
  return detected;
}

export const protectionLabel = sealer => sealer || 'arquivo 0600';

// Um segredo em bytes, com nome próprio. Sem lacre disponível, fica em <base>.key com 0600.
export function createSecret(dataDir, { name, base, sealer = detectSealer() }) {
  const plain = join(dataDir, base + '.key');
  const sealed = sealer && join(dataDir, base + '.' + sealers[sealer].extension);
  return {
    sealer,
    exists: () => Boolean(sealed && existsSync(sealed)) || existsSync(plain),
    load() {
      if (sealed && existsSync(sealed)) {
        const result = sealers[sealer].unseal(name, readFileSync(sealed));
        if (result.status !== 0) throw Object.assign(new Error('O sistema não conseguiu abrir o segredo ' + name + '.'), { code: 'UNSEAL_FAILED' });
        return Buffer.from(result.stdout);
      }
      if (!existsSync(plain)) return null;
      const data = readFileSync(plain);
      // Segredo vindo de onde não havia lacre (por exemplo, do Docker): lacra e apaga o arquivo comum.
      if (sealed) this.save(data);
      return data;
    },
    save(data) {
      data = Buffer.from(data);
      if (!sealed) return writePrivate(plain, data);
      const result = sealers[sealer].seal(name, data);
      if (result.status !== 0) throw new Error('O sistema não conseguiu proteger o segredo ' + name + '.');
      // Só troca depois de conferir que o lacre abre e devolve o mesmo conteúdo.
      const check = sealers[sealer].unseal(name, result.stdout);
      if (check.status !== 0 || !Buffer.from(check.stdout).equals(data)) throw new Error('O sistema não conseguiu proteger o segredo ' + name + '.');
      writePrivate(sealed, result.stdout);
      if (existsSync(plain)) wipe(plain);
    },
    remove() {
      for (const file of [sealed, plain]) if (file && existsSync(file)) wipe(file);
    },
  };
}

// Credenciais da Pluggy em JSON. Um pluggy.json antigo em texto puro é lacrado na primeira leitura.
export function createSecretStore(dataDir, { sealer = detectSealer() } = {}) {
  const legacy = join(dataDir, 'pluggy.json');
  const secret = createSecret(dataDir, { name: 'moneta-pluggy', base: 'pluggy', sealer });
  function save(pair) {
    const text = JSON.stringify(pair);
    if (!sealer) return writePrivate(legacy, text);
    secret.save(text);
    if (existsSync(legacy)) wipe(legacy);
  }
  function load() {
    if (sealer && existsSync(join(dataDir, 'pluggy.' + sealers[sealer].extension))) {
      try { return JSON.parse(secret.load().toString()); }
      catch { throw new Error('Não foi possível abrir as credenciais protegidas da Pluggy. Cadastre-as de novo em Configuração.'); }
    }
    if (!existsSync(legacy)) return null;
    const pair = JSON.parse(readFileSync(legacy, 'utf8'));
    if (sealer) save(pair);
    return pair;
  }
  return { load, save, protection: protectionLabel(sealer) };
}
