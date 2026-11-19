import { fork } from 'node:child_process';

let child;
let stopping = false;

function start() {
  child = fork(new URL('./backend.mjs', import.meta.url), [], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  let restarting = false;
  child.on('message', message => {
    if (message === 'restart') restarting = true;
  });
  child.once('exit', (code, signal) => {
    if (restarting && !stopping && code === 0) start();
    else process.exitCode = stopping ? 0 : code ?? (signal ? 1 : 0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    child.kill(signal);
  });
}
start();
