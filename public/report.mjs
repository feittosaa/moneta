import {investmentCategory} from './movement.mjs';
import {cardPeriod, cardRows, shift, unlistedDescription} from './card-periods.mjs';
const sum = (list, value) => list.reduce((total,row) => total + value(row),0);
const total = values => values.includes(null) ? null : sum(values,v => v);
// Legacy snapshots can lack both bill IDs and cycle dates. Only attribute purchases
// common to every plausible monthly statement whose net total matches the payment.
function reconcilePaidRows(transactions, paid, date) {
  const end = Date.parse(date);
  const days = Array.from({length:56},() => []);
  for (const tx of transactions) {
    const age = (end-Date.parse(tx.date))/86400000;
    if (Number.isInteger(age) && days[age] && !tx.billId && !tx.forecast) days[age].push(tx);
  }
  const totals = days.map(rows => -sum(rows,t => t.amount));
  let first = 0, last = days.length, found = false;
  for (let gap=0; gap<=16; gap++) {
    let value = 0;
    for (let length=1; length<=40; length++) {
      value += totals[gap+length-1];
      if (length < 23 || value !== paid) continue;
      first = Math.max(first,gap);
      last = Math.min(last,gap+length);
      found = true;
    }
  }
  return found ? days.slice(first,last).flat() : [];
}
// Pagamentos de fatura, dos dois lados: o recebimento no cartão e o débito correspondente na conta.
function payments(data, currency) {
  const internal = new Set(data.categories.filter(c => c.internal).map(c => c.id));
  const cards = new Set(data.accounts.filter(a => a.type === 'CREDIT').map(a => a.id));
  const paymentCategory = data.categories.find(c => c.key === 'pagamento de fatura')?.id;
  const institution = new Map(data.accounts.map(a => [a.id,a.institution]));
  const explicitPayment = t => (paymentCategory != null && t.category === paymentCategory) ||
    ['Pagamento de fatura','Credit card payment'].includes(t.providerCategory) ||
    (cards.has(t.account) && t.amount > 0 && /^(?:pagamento\b|pagamentos v[aá]lidos normais\s*$)/i.test(t.description));
  const cardReceipts = data.transactions.filter(t => cards.has(t.account) && t.currency === currency && !t.pending && explicitPayment(t));
  const isPayment = t => explicitPayment(t) || (!cards.has(t.account) && t.amount < 0 &&
    /^pagamento para banco /i.test(t.description) && cardReceipts.some(p =>
      p.amount === -t.amount && institution.get(p.account) === institution.get(t.account) &&
      Math.abs(Date.parse(p.date)-Date.parse(t.date)) <= 3*86400000));
  return {internal,cards,institution,isPayment};
}

export function summarize(data, month, currency, today = new Date().toLocaleDateString('en-CA')) {
  const {internal,cards,institution,isPayment} = payments(data,currency);
  const rows = data.transactions.filter(t => t.date.startsWith(month) && t.currency === currency && !t.pending);
  const bankRows = rows.filter(t => {
    if (t.account.startsWith('wallet-')) return t.kind !== 'adjustment';
    if (cards.has(t.account) || isPayment(t) || internal.has(t.category)) return false;
    const movement = investmentCategory(t);
    return movement !== 'Transferência interna' && movement !== 'Movimentação de investimentos';
  });
  const expenses = bankRows.filter(t => t.amount < 0);
  const income = sum(bankRows.filter(t => t.amount > 0),t => t.amount);
  const cashSpent = -sum(expenses.filter(t => t.account.startsWith('wallet-')),t => t.amount);
  const voucherSpent = -sum(expenses.filter(t => t.account.startsWith('voucher-')),t => t.amount);
  const debit = -sum(expenses,t => t.amount) - cashSpent - voucherSpent;
  const bills = [...new Map((data.bills || []).filter(b => b.currency === currency).map(b => [b.id,b])).values()];
  const due = bills.filter(b => b.due.startsWith(month));
  const paidThisMonth = bills.flatMap(b => (b.payments || []).filter(p => p.currency === currency && p.date?.startsWith(month))
    .map(p => ({...p,account:b.account})));
  const creditPayments = rows.filter(t => cards.has(t.account) && isPayment(t) && t.amount > 0);
  const fallback = creditPayments.filter(t => !due.some(b => b.account === t.account) &&
    !bills.some(b => b.id === t.billId) &&
    !paidThisMonth.some(p => p.account === t.account && p.amount === t.amount && p.date === t.date));
  // Cada pagamento identificado no cartão ou na fatura cobre no máximo um débito correspondente.
  const mirrors = creditPayments.map(t => ({amount:t.amount,date:t.date}));
  for (const p of paidThisMonth) {
    if (!creditPayments.some(t => t.account === p.account && t.amount === p.amount && t.date === p.date)) mirrors.push(p);
  }
  for (const b of due) {
    if (!paidThisMonth.some(p => p.account === b.account) && !creditPayments.some(t => t.account === b.account))
      mirrors.push({amount:b.amount,date:b.due});
  }
  const paymentsByCard = new Map();
  function recordPayment(account, amount, date) {
    const payments = paymentsByCard.get(account) || [];
    payments.push({amount,date});
    paymentsByCard.set(account,payments);
  }
  for (const t of fallback) recordPayment(t.account,t.amount,t.date);
  let bankPayments = 0;
  const paidFromBank = new Set();
  for (const t of rows.filter(t => !cards.has(t.account) && !t.account.startsWith('wallet-') && t.amount < 0 && isPayment(t))) {
    const index = mirrors.findIndex(p => p.amount === -t.amount && Math.abs(Date.parse(p.date)-Date.parse(t.date)) <= 3*86400000);
    if (index >= 0) mirrors.splice(index,1);
    else {
      const localCards = data.accounts.filter(a => cards.has(a.id) && a.currency === currency && a.institution === institution.get(t.account));
      const knownBill = b => localCards.some(a => a.id === b.account);
      if (localCards.length ? due.some(knownBill) || paidThisMonth.some(knownBill) : due.length || paidThisMonth.length) continue;
      bankPayments -= t.amount;
      if (localCards.length === 1) {
        paidFromBank.add(localCards[0].id);
        recordPayment(localCards[0].id,-t.amount,t.date);
      }
    }
  }
  const invoiceFallback = sum(fallback,t => t.amount) + bankPayments;
  let projected = 0, inferred = false;
  const estimatedCards = new Set();
  const invoiceByCategory = new Map();
  const invoiceRows = [];
  function allocate(amount, charges) {
    if (!amount) return;
    const detail = -sum(charges,t => t.amount);
    // A partial payment does not identify which of the purchases it covered.
    if (detail > amount) charges = [];
    invoiceRows.push(...charges);
    for (const t of charges) {
      invoiceByCategory.set(t.category,(invoiceByCategory.get(t.category)||0)-t.amount);
    }
    const remainder = amount + sum(charges,t => t.amount);
    if (remainder) invoiceByCategory.set('invoice',(invoiceByCategory.get('invoice')||0)+remainder);
  }
  let allocated = 0;
  for (const card of data.accounts.filter(a => a.type === 'CREDIT' && a.currency === currency)) {
    const period = cardPeriod(data,card,month,today);
    const charges = period.rows.filter(t => !isPayment(t));
    const official = due.filter(b => b.account === card.id);
    if (official.length) {
      for (const bill of official) {
        allocate(Math.max(0,bill.amount),charges.filter(t => t.billId === bill.id || (!t.billId && official.length === 1)));
      }
      continue;
    }
    const payments = paymentsByCard.get(card.id);
    if (payments) {
      const paid = sum(payments,p => p.amount);
      let detail = charges;
      if (!detail.length && payments.length === 1 && !period.closingDate) {
        const purchases = data.transactions.filter(t => t.account === card.id && t.currency === currency && !isPayment(t));
        detail = reconcilePaidRows(purchases,paid,payments[0].date);
        if (detail.length && -sum(detail,t => t.amount) <= paid) inferred = true;
      }
      allocate(paid,detail);
      allocated += paid;
    } else if (month >= today.slice(0,7) && period.amount != null) {
      projected += period.amount;
      estimatedCards.add(card.id);
      allocate(period.amount,charges);
    }
  }
  allocate(invoiceFallback-allocated,[]);
  const invoices = projected + sum(due,b => Math.max(0,b.amount)) + invoiceFallback;
  const spent = debit + cashSpent + voucherSpent + invoices;
  // Na visão geral as faturas formam uma linha só; a composição por categoria fica em invoiceByCategory.
  const byCategory = new Map();
  for (const t of expenses) byCategory.set(t.category,(byCategory.get(t.category)||0)-t.amount);
  if (invoices) byCategory.set('invoices',invoices);
  const missingBills = data.accounts.some(a => a.type === 'CREDIT' && a.currency === currency &&
    !estimatedCards.has(a.id) && !paidFromBank.has(a.id) && !due.some(b => b.account === a.id) && !creditPayments.some(t => t.account === a.id));
  return {income,debit,cashSpent,voucherSpent,projected,invoices,invoiceFallback,missingBills,spent,byCategory,invoiceByCategory,inferred,invoiceRows,expenses,...portfolio(data,currency)};
}

export function portfolio(data,currency) {
  const positions = data.holdings.filter(p => p.currency === currency);
  const accounts = data.accounts.filter(a => a.currency === currency);
  const assets = [], debts = [], shared = new Set();
  const credit = [], cash = [];
  for (const a of accounts) {
    if (a.shared && shared.has(a.shared)) continue;
    shared.add(a.shared);
    if (a.balance == null) {
      assets.push(null); debts.push(null);
      (a.type === 'CREDIT' ? credit : cash).push(null);
      continue;
    }
    // No cartão, o saldo é só a fatura atual (no XP, zero depois do pagamento). O limite usado também
    // conta as parcelas futuras e as compras da fatura aberta: é o que ainda sairá das contas.
    // O saldo aplicado automaticamente só sai da conta quando aparece também entre as posições (mesmo
    // valor). No Itaú e no XP ele não aparece, e descontá-lo zerava as contas no patrimônio.
    const auto = Math.min(Math.max(a.balance,0),Math.max(a.auto,0));
    const invested = auto > 0 && positions.some(p => [p.net,p.gross].some(v => v != null && Math.abs(v-auto) <= 1));
    const balance = a.type === 'CREDIT' ? -Math.max(a.balance,a.used ?? 0) : a.balance - (invested ? auto : 0);
    assets.push(Math.max(0,balance)); debts.push(Math.max(0,-balance));
    if (a.type === 'CREDIT') credit.push(Math.max(0,-balance)); else cash.push(balance);
  }
  const invested = total(positions.map(p => p.net));
  const gross = total([...assets,...positions.map(p => p.gross)]);
  const netAssets = total([...assets,invested]);
  const debt = total(debts);
  return {gross,net:netAssets == null || debt == null ? null : netAssets-debt,credit:total(credit),invested,
    investedGross:total(positions.map(p => p.gross)),cash:total(cash)};
}

// Gasto do mês pela data da compra (e não pelo vencimento da fatura, como no fluxo mensal): cada compra
// conta no mês em que foi feita, inclusive no cartão; parceladas entram com o valor total no mês da compra;
// estornos no cartão abatem. Ficam de fora pagamentos de fatura, transferências internas, investimentos e
// categorias excluídas do fluxo. Pendentes contam: a compra já foi feita.
export function purchases(data, currency, today = new Date().toLocaleDateString('en-CA')) {
  const {internal,cards,isPayment} = payments(data,currency);
  const counted = t => !internal.has(t.category) && !isPayment(t) &&
    !['Transferência interna','Movimentação de investimentos'].includes(investmentCategory(t));
  const out = [];
  for (const t of data.transactions) {
    if (t.currency !== currency || cards.has(t.account) || !counted(t) || t.amount >= 0) continue;
    if (t.account.startsWith('wallet-') && t.kind === 'adjustment') continue;
    out.push({date:t.date,description:t.description,category:t.category,amount:-t.amount,account:t.account});
  }
  const groups = new Map();
  for (const card of data.accounts.filter(a => a.type === 'CREDIT' && a.currency === currency)) {
    // Compra que a instituição já cobra no saldo, mas ainda não listou: conta no dia em que apareceu.
    if (card.unlisted?.amount > 0) out.push({date:card.unlisted.since,description:unlistedDescription,category:null,
      amount:card.unlisted.amount,account:card.id,unlisted:true});
    for (const t of cardRows(data,card)) {
      if (!counted(t)) continue;
      const n = t.installment, count = t.installments;
      if (t.amount < 0 && Number.isInteger(n) && Number.isInteger(count) && count > 1 && n >= 1 && n <= count) {
        const date = t.purchaseDate || shift(t.date,1-n);
        const merchant = (t.description || '').replace(/(?<!\d)\d{1,3}\s*\/\s*\d{1,3}(?!\d)/g,'').trim().toLowerCase();
        const key = JSON.stringify([card.id,merchant,date,count]);
        if (!groups.has(key)) groups.set(key,[]);
        groups.get(key).push({t,date});
        continue;
      }
      out.push({date:t.purchaseDate || t.date,description:t.description,category:t.category,amount:-t.amount,account:t.account});
    }
  }
  for (const group of groups.values()) {
    // Compras iguais no mesmo dia seguem separadas, como no cartão (card-periods.mjs).
    const list = [];
    for (const entry of group) {
      const same = list.find(p => !p.some(e => e.t.installment === entry.t.installment) && Math.abs(p[0].t.amount - entry.t.amount) <= entry.t.installments);
      if (same) same.push(entry); else list.push([entry]);
    }
    for (const purchase of list) {
      purchase.sort((a,b) => a.t.installment - b.t.installment);
      const {t,date} = purchase[0], count = t.installments;
      const first = purchase.find(e => e.t.installment === 1)?.t.amount;
      const typical = purchase.find(e => e.t.installment > 1)?.t.amount ?? purchase[0].t.laterAmount ?? purchase[0].t.amount;
      const amount = -((first ?? typical) + typical*(count-1));
      out.push({date,description:t.description.replace(/(?<!\d)\d{1,3}\s*\/\s*\d{1,3}(?!\d)/g,'').trim(),category:t.category,amount,account:t.account,installments:count});
    }
  }
  return out.filter(p => p.date <= today);
}

export function spending(data, month, currency, today = new Date().toLocaleDateString('en-CA'), all = purchases(data,currency,today)) {
  const rows = all.filter(p => p.date.startsWith(month)).sort((a,b) => b.amount-a.amount || b.date.localeCompare(a.date));
  const byCategory = new Map();
  for (const p of rows) byCategory.set(p.category ?? null,(byCategory.get(p.category ?? null) || 0)+p.amount);
  return {total:sum(rows,p => p.amount),byCategory,rows};
}
