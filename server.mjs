import { fork, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// Tudo o que o Moneta cria (banco, credenciais, chave de acesso) nasce visível só para o dono.
process.umask(0o077);

// --desktop: modo dos instaladores (AppImage e Windows). Guarda os dados na pasta do usuário,
// abre o navegador ao iniciar e, se o Moneta já estiver aberto, só abre o navegador.
// --background: igual, mas sem abrir o navegador; é o modo do serviço que inicia com o sistema.
const background = process.argv.includes('--background');
const desktop = background || process.argv.includes('--desktop');
const port = Number(process.env.PORT || 4173);
const url = 'http://127.0.0.1:' + port;
if (desktop) {
  process.title = 'Moneta';
  process.env.MONETA_DESKTOP = '1';
  process.env.MONETA_DATA_DIR ||= process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Moneta')
    : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'moneta');
}

// Abre o navegador já com a chave de acesso, que o servidor troca por um cookie e tira da URL.
function openBrowser() {
  let target = url;
  try { target = url + '/entrar?chave=' + readFileSync(join(process.env.MONETA_DATA_DIR || 'data', 'acesso.key'), 'utf8').trim(); } catch {}
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
    : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  try {
    const opener = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    opener.on('error', () => console.log('Abra ' + url + ' no navegador.'));
    opener.unref();
  } catch { console.log('Abra ' + url + ' no navegador.'); }
}

async function running() {
  try {
    const response = await fetch(url + '/api/status', { signal: AbortSignal.timeout(1500) });
    return response.ok && Boolean((await response.json()).instance);
  } catch { return false; }
}

let child;
let stopping = false;
let opened = false;

function start() {
  child = fork(new URL('./backend.mjs', import.meta.url), [], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  let restarting = false;
  child.on('message', message => {
    if (message === 'restart') restarting = true;
    if (message === 'shutdown') stopping = true;
    if (message === 'ready' && desktop && !background && !opened) {
      opened = true;
      console.log('Para encerrar, feche esta janela ou use Configuração → Encerrar o Moneta.');
      openBrowser();
    }
  });
  child.once('exit', (code, signal) => {
    if (restarting && !stopping && code === 0) start();
    else process.exitCode = stopping ? 0 : code ?? (signal ? 1 : 0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}
if (desktop && await running()) {
  console.log('O Moneta já está aberto em ' + url + '.');
  if (!background) openBrowser();
} else start();
