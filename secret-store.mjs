// Guarda as credenciais da Pluggy lacradas pelo sistema operacional, nunca em texto puro quando dá.
// Linux: systemd-creds --user, que cifra com uma chave presa ao usuário e, havendo TPM 2.0, à máquina.
//        O arquivo lacrado não abre em outro computador, com outro usuário ou com outro nome.
// Windows: DPAPI do usuário atual (o mesmo cofre que o Windows usa para senhas salvas).
// Sem nenhum dos dois (por exemplo, dentro do Docker), o arquivo continua em JSON com permissão 0600.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync, openSync, writeSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const name = 'moneta-pluggy';
const run = (command, args, input) => spawnSync(command, args, { input, timeout: 15000, windowsHide: true, maxBuffer: 1 << 20 });

const sealers = {
  'systemd-creds': {
    file: 'pluggy.cred',
    available: () => process.platform === 'linux' && run('systemd-creds', ['--user', 'encrypt', '--name=moneta-teste', '-', '-'], 'teste').status === 0,
    seal: text => run('systemd-creds', ['--user', 'encrypt', '--name=' + name, '-', '-'], text),
    unseal: data => run('systemd-creds', ['--user', 'decrypt', '--name=' + name, '--newline=no', '-', '-'], data),
  },
  dpapi: {
    file: 'pluggy.dpapi',
    available: () => process.platform === 'win32' && powershell('Protect', 'dGVzdGU=').status === 0,
    seal: text => powershell('Protect', Buffer.from(text).toString('base64')),
    unseal: data => {
      const result = powershell('Unprotect', data.toString().trim());
      return result.status === 0 ? { ...result, stdout: Buffer.from(result.stdout.toString().trim(), 'base64') } : result;
    },
  },
};

// Lê base64 da entrada padrão e devolve base64; o segredo nunca passa pela linha de comando.
function powershell(operation, base64) {
  const script = 'Add-Type -AssemblyName System.Security;' +
    '$in=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());' +
    `$out=[Security.Cryptography.ProtectedData]::${operation}($in,$null,'CurrentUser');` +
    '[Console]::Out.Write([Convert]::ToBase64String($out))';
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], base64);
}

// Grava de forma atômica, com permissão 0600 desde a criação.
function writePrivate(file, data) {
  const tmp = file + '.' + randomUUID();
  try {
    writeFileSync(tmp, data, { mode: 0o600, flag: 'wx' });
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}

// Sobrescreve o conteúdo antes de apagar. Em SSD e em sistemas de arquivos copy-on-write isso
// não garante que os blocos antigos sumam, mas tira o segredo do caminho óbvio.
function wipe(file) {
  try {
    const size = statSync(file).size;
    const fd = openSync(file, 'r+');
    try { writeSync(fd, Buffer.alloc(size), 0, size, 0); } finally { closeSync(fd); }
  } catch {}
  rmSync(file, { force: true });
}

export function createSecretStore(dataDir, { sealer = detect() } = {}) {
  const plain = join(dataDir, 'pluggy.json');
  const sealed = sealer && join(dataDir, sealers[sealer].file);

  function load() {
    if (sealed && existsSync(sealed)) {
      const result = sealers[sealer].unseal(readFileSync(sealed));
      if (result.status !== 0) throw new Error('Não foi possível abrir as credenciais protegidas da Pluggy. Cadastre-as de novo em Configuração.');
      return JSON.parse(result.stdout.toString());
    }
    if (!existsSync(plain)) return null;
    const pair = JSON.parse(readFileSync(plain, 'utf8'));
    // Migra o arquivo antigo em texto puro assim que houver como lacrar.
    if (sealed) save(pair);
    return pair;
  }

  function save(pair) {
    const text = JSON.stringify(pair);
    if (!sealed) return writePrivate(plain, text);
    const result = sealers[sealer].seal(text);
    if (result.status !== 0) throw new Error('O sistema não conseguiu proteger as credenciais.');
    // Só apaga o texto puro depois de conferir que o lacre abre e devolve o mesmo conteúdo.
    const check = sealers[sealer].unseal(result.stdout);
    if (check.status !== 0 || check.stdout.toString() !== text) throw new Error('O sistema não conseguiu proteger as credenciais.');
    writePrivate(sealed, result.stdout);
    if (existsSync(plain)) wipe(plain);
  }

  return { load, save, protection: sealer || 'arquivo 0600' };
}

let detected;
function detect() {
  if (detected === undefined) {
    detected = process.env.MONETA_SECRET_STORE === 'arquivo' ? null
      : Object.keys(sealers).find(key => { try { return sealers[key].available(); } catch { return false; } }) ?? null;
  }
  return detected;
}
