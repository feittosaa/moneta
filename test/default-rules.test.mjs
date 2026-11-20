import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { initFinance, overview } from '../finance.mjs';

const samples = [
  ['IFD*IFOOD CLUB', -3990, 'Alimentação'],
  ['UBER * EATS PENDING', -4500, 'Alimentação'],
  ['UBER *TRIP HELP.UBER.COM', -1875, 'Transporte'],
  ['99APP *99APP', -1520, 'Transporte'],
  ['PADARIA SÃO JORGE', -1200, 'Alimentação'],
  ['NETFLIX.COM', -5590, 'Assinaturas'],
  ['AMAZONPRIMEBR', -1990, 'Assinaturas'],
  ['AMAZON MARKETPLACE', -8900, 'Compras'],
  ['MERCADOLIVRE*LOJAX', -12000, 'Compras'],
  ['MERCADO SÃO JOSÉ', -6400, 'Mercado'],
  ['MERCADO PAGO*LOJA', -1500, null],
  ['ASSAI ATACADISTA', -25000, 'Mercado'],
  ['POSTO IPIRANGA CENTRO', -20000, 'Transporte'],
  ['DROGASIL 1234', -3500, 'Saúde'],
  ['DROGARIAS PACHECO PETROPOLIS BR', -3500, 'Saúde'],
  ['FARMACIAS SAO JOAO', -2000, 'Saúde'],
  ['CLINICA VETERINARIA BICHOS', -18000, 'Pet'],
  ['CLINICA SORRISO', -30000, 'Saúde'],
  ['SMART FIT', -12990, 'Saúde'],
  ['STEAMPOWERED.COM', -4999, 'Lazer'],
  ['ENEL DISTRIBUICAO', -21000, 'Moradia'],
  ['TARIFA BANCARIA', -2500, 'Impostos & Taxas'],
  ['IMPOSTO DE RENDA', -50000, 'Impostos & Taxas'],
  ['DARF IRPF', -30000, 'Impostos & Taxas'],
  ['Pix recebido SECR. DA RECEITA FEDERAL', 150000, 'Transferências'],
  ['SALARIO EMPRESA', 500000, 'Salário'],
  ['SALARIO EMPRESA', -500000, null],
  ['RENDIMENTOS DE CLIENTES XPLG11', 410, 'Rendimentos'],
  ['APLICACAO CDB BANCO', -100000, 'Movimentação de investimentos'],
  ['RESGATE TESOURO DIRETO', 100000, 'Movimentação de investimentos'],
  ['Pagamento de fatura', -400000, 'Pagamento de fatura'],
  ['Pagamento para BANCO XP S.A', -400000, 'Pagamento de fatura'],
  ['PIX ENVIADO JOAO SILVA', -5000, 'Transferências'],
  ['PIX para Banco XP', -350, 'Transferências'],
  ['COMPRA SEM PADRAO CONHECIDO', -1000, null],
];

test('catálogo padrão classifica descrições comuns sem falsos positivos', () => {
  const db = new DatabaseSync(':memory:');
  initFinance(db);
  const transactions = samples.map(([description,amount],i) => ({id:'t'+i,description,amount,date:'2026-11-01',providerCategory:''}));
  db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run('i',JSON.stringify({accounts:[],holdings:[],transactions}),'2026-11-01');
  const data = overview(db);
  const name = id => data.categories.find(c => c.id === id)?.name ?? null;
  const defaults = JSON.parse(readFileSync(new URL('../default-rules.json', import.meta.url)));
  assert.equal(data.catalogRules.length, defaults.length);
  assert.ok(data.catalogRules.every(r => r.status === 'Ativa'));
  const got = samples.map(([description,amount],i) => [description,amount,name(data.transactions.find(t => t.id === 't'+i).category)]);
  assert.deepEqual(got, samples);
  db.close();
});
