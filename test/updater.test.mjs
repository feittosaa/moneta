import test from 'node:test';
import assert from 'node:assert/strict';
import { newer, createUpdater } from '../updater.mjs';

test('compara versões numericamente', () => {
  assert.equal(newer('1.3.10','1.3.9'),true);
  assert.equal(newer('1.4.0','1.3.9'),true);
  assert.equal(newer('2.0.0','10.0.0'),false);
  assert.equal(newer('1.3.3','1.3.3'),false);
  assert.equal(newer('v1.3.4','1.3.3'),true);
  assert.equal(newer(null,'1.3.3'),false);
  assert.equal(newer('beta','1.3.3'),false);
});

test('sem versão empacotada ou fora do desktop, não oferece nem instala atualização', async () => {
  const updater = createUpdater({ dataDir:'.', desktop:false, stop() {} });
  const status = await updater.status();
  assert.equal(status.supported,false);
  assert.equal(status.available,false);
  await assert.rejects(updater.install(),/Linux e Windows/);
});
