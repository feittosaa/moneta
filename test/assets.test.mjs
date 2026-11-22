// Todo módulo que a interface importa precisa estar na lista de arquivos que o servidor entrega.
// Um import fora da lista quebra a interface inteira no computador e no Android.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('o servidor entrega todos os módulos importados pela interface', () => {
  const backend = readFileSync(new URL('../backend.mjs', import.meta.url), 'utf8');
  const served = new Set([...backend.matchAll(/\['(\/[^']+)',\s*\[/g)].map(match => match[1]));
  const folder = new URL('../public/', import.meta.url);
  const pending = ['app.js'];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(served.has('/' + file), '/' + file + ' não está na lista de arquivos do servidor');
    const code = readFileSync(new URL(file, folder), 'utf8');
    for (const [, path] of code.matchAll(/(?:from|import)\s*\(?\s*['"]\.\/([^'"]+)['"]/g)) pending.push(path);
  }
  assert.ok(seen.has('drawer.mjs') && seen.has('device-unlock.mjs'));
  assert.ok(readdirSync(folder).length > 0);
});
