// Atualização do Moneta pelo próprio app (instalações de desktop no Linux e no Windows).
//
// - Consulta a última release no GitHub e compara com a versão empacotada (package.json, escrito
//   por packaging/build.sh; no checkout ele não existe e a atualização fica desligada).
// - Baixa o instalador da plataforma, confere o SHA-256 com o SHA256SUMS.txt da mesma release e o
//   executa fora do processo do Moneta, que é encerrado e volta já na versão nova.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const repo = 'feittosaa/moneta';
const download = 'https://github.com/' + repo + '/releases/latest/download/';
const checkEvery = 60 * 60_000;

function packagedVersion() {
  try { return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version || null; }
  catch { return null; }
}

export function newer(candidate, current) {
  const parse = value => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? ''))?.slice(1).map(Number);
  const a = parse(candidate), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

async function get(url, type) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Moneta' }, redirect: 'follow', signal: AbortSignal.timeout(type === 'binary' ? 300_000 : 15_000) });
  if (!response.ok) throw new Error('O GitHub respondeu ' + response.status + '.');
  return type === 'text' ? response.text() : Buffer.from(await response.arrayBuffer());
}

// O endereço releases/latest redireciona para a página da última versão (…/releases/tag/1.3.3).
// Diferente da API do GitHub, não tem limite de consultas por hora.
async function latestVersion() {
  const response = await fetch('https://github.com/' + repo + '/releases/latest', { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'Moneta' }, signal: AbortSignal.timeout(15_000) });
  const tag = /\/releases\/tag\/v?(\d+\.\d+\.\d+)$/.exec(response.headers.get('location') || '')?.[1];
  if (!tag) throw new Error('O GitHub respondeu ' + response.status + '.');
  return tag;
}

// Serviço de usuário do systemd: o instalador reinicia o serviço, então precisa rodar fora dele.
function insideService() {
  try { return /\/moneta\.service$/m.test(readFileSync('/proc/self/cgroup', 'utf8')); }
  catch { return false; }
}

export function createUpdater({ dataDir, desktop, stop }) {
  const current = packagedVersion();
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : null;
  const supported = Boolean(desktop && current && platform);
  const file = platform === 'windows' ? 'Moneta-Setup.exe' : 'install.sh';
  let latest = null, checked = 0, checking = null, error = null, installing = false;

  async function check(force = false) {
    if (!supported) return;
    if (!force && Date.now() - checked < checkEvery) return;
    checking ||= latestVersion().then(version => {
      latest = version;
      error = null;
    }, failure => { error = 'Não foi possível verificar atualizações agora. ' + failure.message; })
      .finally(() => { checked = Date.now(); checking = null; });
    await checking;
  }

  async function status() {
    await check();
    return { supported, current, latest, available: supported && newer(latest, current), installing, error };
  }

  async function install() {
    if (!supported) throw Object.assign(new Error('A atualização pelo app existe só nas instalações para Linux e Windows.'), { status: 409 });
    if (installing) throw Object.assign(new Error('A atualização já está em andamento.'), { status: 409 });
    await check(true);
    if (!newer(latest, current)) throw Object.assign(new Error('O Moneta já está na versão mais recente.'), { status: 409 });
    installing = true;
    try {
      const [sums, content] = await Promise.all([get(download + 'SHA256SUMS.txt', 'text'), get(download + file, 'binary')]);
      const expected = sums.split('\n').map(line => line.trim().split(/\s+/)).find(([, name]) => name === file)?.[0];
      if (!expected || createHash('sha256').update(content).digest('hex') !== expected)
        throw new Error('O arquivo baixado não confere com a versão publicada. Tente de novo.');
      // Na pasta de dados: é o único lugar gravável no sandbox do serviço e é visível fora dele.
      const folder = join(dataDir, 'atualizacao');
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const path = join(folder, file);
      writeFileSync(path, content, { mode: 0o700 });
      if (platform === 'windows') {
        // O instalador encerra o Moneta (gravando o cofre), atualiza em silêncio e abre a versão nova.
        spawn(path, ['/S', '/abrir'], { detached: true, stdio: 'ignore' }).unref();
      } else if (insideService()) {
        // Fora do sandbox e do grupo do serviço, que o instalador reinicia ao terminar.
        await run('systemd-run', ['--user', '--collect', '--quiet', '--unit=moneta-atualizacao-' + Date.now(), 'sh', path]);
      } else {
        // Aberto pela janela ou pelo atalho: instala, encerra este Moneta e abre o novo.
        await run('sh', [path]);
        const moneta = join(process.env.XDG_BIN_HOME || join(homedir(), '.local', 'bin'), 'moneta');
        spawn('sh', ['-c', 'sleep 3; exec "$0"', moneta], { detached: true, stdio: 'ignore' }).unref();
        setTimeout(() => stop('shutdown'), 500);
      }
      return { version: latest };
    } catch (failure) {
      installing = false;
      throw failure;
    }
  }

  return { status, install };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', error => reject(new Error('Não foi possível iniciar a atualização: ' + error.message)));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('A instalação da atualização falhou (código ' + code + ').')));
  });
}
