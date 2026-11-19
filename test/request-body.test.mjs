import test from 'node:test';
import assert from 'node:assert/strict';
import { readJsonObject } from '../request-body.mjs';

test('preserva texto UTF-8 dividido entre pacotes', async () => {
  const bytes = Buffer.from('{"name":"Saúde"}');
  const cut = bytes.indexOf(Buffer.from('ú')) + 1;
  assert.deepEqual(await readJsonObject([bytes.subarray(0, cut), bytes.subarray(cut)]), { name: 'Saúde' });
});

test('valida o tamanho em bytes, a codificação e o formato do corpo', async () => {
  const bytes = Buffer.from('{"name":"Saúde"}');
  await assert.rejects(readJsonObject([bytes], bytes.length - 1), { status: 413 });
  for (const invalid of [Buffer.from([0xff]), Buffer.from('[]'), Buffer.from('null'), Buffer.from('{')]) {
    await assert.rejects(readJsonObject([invalid]), { status: 400 });
  }
});
