import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { openFinance } from '../dist/web/local-finance.mjs';
import { createCipher, decryptVault } from './vault-web.mjs';

test('o cofre web restaura os lançamentos e rejeita senha errada ou backup alterado', async () => {
  const SQL = await initSqlJs();
  const finance = openFinance(SQL);
  const transaction = {
    id:'wallet-'+crypto.randomUUID(),description:'Mercado offline',amount:-1250,
    currency:'BRL',kind:'expense',date:'2026-11-20',
  };
  finance.edit('wallet',transaction);
  const category = finance.read('finance').categories.find(row => row.key === 'mercado').id;
  finance.edit('transaction',{id:transaction.id,category,note:'Compra da semana'});
  assert.match(finance.read('rules/preview').token,/^[a-f0-9]{64}$/);
  const encrypt = await createCipher('teste-controlado');
  const backup = await encrypt(finance.snapshot());
  assert.ok(Buffer.from(backup).indexOf(transaction.description) < 0);
  finance.close();

  await assert.rejects(decryptVault('senha-errada',backup),/Senha incorreta/);
  const tampered = backup.slice();
  tampered[tampered.length-1] ^= 1;
  await assert.rejects(decryptVault('teste-controlado',tampered),/cofre danificado/);
  const {bytes} = await decryptVault('teste-controlado',backup);
  const restored = openFinance(SQL,bytes);
  try {
    const [row] = restored.read('finance').transactions;
    assert.equal(row.description,transaction.description);
    assert.equal(row.amount,transaction.amount);
    assert.equal(row.note,'Compra da semana');
    assert.equal(row.category,category);
  } finally { restored.close(); }
});
