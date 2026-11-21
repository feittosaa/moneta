import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

// O .dockerignore exclui tudo e libera o que a imagem usa. Um arquivo copiado pelo Dockerfile e
// esquecido aqui quebra o build (aconteceu com updater.mjs na 1.3.5).
test('tudo o que o Dockerfile copia está liberado no .dockerignore', () => {
  const allowed = read('.dockerignore').split('\n').map(line => line.trim())
    .filter(line => line.startsWith('!')).map(line => line.slice(1).replace(/\/(\*\*)?$/, ''));
  const copied = read('Dockerfile').split('\n').filter(line => line.startsWith('COPY '))
    .flatMap(line => line.slice(5).trim().split(/\s+/).slice(0, -1)).map(path => path.replace(/\/$/, ''));
  assert.ok(copied.includes('updater.mjs'));
  for (const path of copied) assert.ok(allowed.includes(path), path + ' falta no .dockerignore');
});
