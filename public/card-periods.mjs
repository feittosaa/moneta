// Use civil dates: the statement month is the month of its due date.
function shift(date, months) {
  const [y,m,d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y,m+months,0));
  last.setUTCDate(Math.min(d || 1,last.getUTCDate()));
  return last.toISOString().slice(0,10);
}
const monthOf = day => day?.slice(0,7);
export function cardPeriod(data, card, month, today) {
  const bills = (data.bills || []).filter(b => b.account === card.id && b.currency === card.currency);
  const official = bills.filter(b => monthOf(b.due) === month);
  const byId = new Map(bills.map(b => [b.id,b]));
  const dated = bills.filter(b => b.close).sort((a,b) => a.close.localeCompare(b.close));
  const last = dated.at(-1);
  const close = card.close && card.due ? card.close : last?.close;
  const due = card.close && card.due ? card.due : last?.due;
  function cycle(day) {
    const index = dated.findIndex(b => day <= b.close);
    if (index >= 0) {
      const bill = dated[index];
      const previous = dated[index-1]?.close || shift(bill.close,-1);
      if (day > previous && day > shift(bill.close,-2)) return monthOf(bill.due);
    }
    if (!close || !due) return null;
    const [y,m] = day.split('-').map(Number);
    const [cy,cm] = close.split('-').map(Number);
    const offset = (y-cy)*12+m-cm;
    return monthOf(shift(due,offset + Number(day > shift(close,offset))));
  }
  const transactions = data.transactions.filter(t => t.account === card.id && t.currency === card.currency);
  const pendingMonth = transactions.filter(t => t.pending && t.date <= today && !byId.has(t.billId))
    .map(t => monthOf(t.forecast)).filter(m => m >= monthOf(today) && !bills.some(b => monthOf(b.due) === m)).sort()[0];
  const openMonth = card.due && (!card.close || today <= card.close) && today <= card.due ? monthOf(card.due) : pendingMonth || cycle(today);
  const rows = [], series = new Map();
  let paid = 0;
  for (const tx of transactions) {
    if (/^(pagamento de fatura|credit card payment)$/i.test(tx.providerCategory) ||
        (tx.amount > 0 && /^(?:pagamento (?:recebido|efetuado)|pagamentos v[aá]lidos normais)\s*$/i.test(tx.description))) {
      if (!tx.pending && tx.amount > 0 && monthOf(tx.date) === month && !byId.has(tx.billId)) paid += tx.amount;
      continue;
    }
    const linked = byId.get(tx.billId);
    const n = tx.installment, count = tx.installments;
    const firstMonth = tx.purchaseDate && cycle(tx.purchaseDate);
    let target = monthOf(linked?.due) || monthOf(tx.forecast);
    if (!target && n > 1 && tx.billPostDate) target = monthOf(tx.billPostDate);
    if (!target && firstMonth && n > 0) target = monthOf(shift(firstMonth,n-1));
    target ||= cycle(tx.date);
    // Without a closing day only an identified open, pending charge can be placed.
    if (!target && tx.pending && tx.date <= today && (!n || n === 1)) target = openMonth;
    if (target === month) rows.push(tx);
    if (target && Number.isInteger(n) && n >= 1 && Number.isInteger(count) && count >= n && tx.amount < 0) {
      const merchant = (tx.description || '').replace(/\b\d+\s*\/\s*\d+\b/g,'').trim().toLowerCase();
      const key = JSON.stringify([merchant,tx.purchaseDate || shift(target,1-n).slice(0,7),count,tx.amount]);
      if (!series.has(key)) series.set(key,[]);
      series.get(key).push({tx,target});
    }
  }
  if (!official.length && month >= monthOf(today)) {
    const [year,number] = month.split('-').map(Number);
    for (const installments of series.values()) {
      if (installments.some(entry => entry.target === month)) continue;
      const prior = installments.filter(entry => entry.target < month).sort((a,b) => b.target.localeCompare(a.target));
      for (const {tx,target} of prior) {
        if (target !== prior[0].target) break;
        const [y,m] = target.split('-').map(Number);
        const installment = tx.installment + (year-y)*12 + number-m;
        if (installment <= tx.installments) rows.push({...tx,installment,projected:true});
      }
    }
  }
  // A conta pode confirmar o débito antes que o cartão confirme o recebimento.
  if (!paid && !official.length && data.accounts && data.categories) {
    const payment = data.categories.find(c => c.key === 'pagamento de fatura');
    const local = data.accounts.filter(a => a.institution === card.institution && a.currency === card.currency);
    if (payment && local.filter(a => a.type === 'CREDIT').length === 1) {
      const banks = new Set(local.filter(a => a.type === 'BANK').map(a => a.id));
      paid = -data.transactions.filter(t => banks.has(t.account) && t.currency === card.currency &&
        monthOf(t.date) === month && !t.pending && t.amount < 0 && t.category === payment.id)
        .reduce((total,t) => total+t.amount,0);
    }
  }
  const open = month === openMonth && !official.length;
  let amount = null;
  if (official.length) amount = official.reduce((s,b) => s+Math.max(0,b.amount),0);
  else if (open && monthOf(card.due) === month && card.openAmount != null) amount = Math.max(0,card.openAmount);
  else if (rows.length) amount = Math.max(0,-rows.reduce((s,t) => s+t.amount,0));
  let closingDate, dueDate;
  if (due && close) {
    const [y,m] = month.split('-').map(Number);
    const [dy,dm] = due.split('-').map(Number);
    const offset = (y-dy)*12 + m-dm;
    closingDate = shift(close,offset);
    dueDate = shift(due,offset);
  } else if (monthOf(card.due) === month) dueDate = card.due;
  // Prefer explicit membership when the bank supplies it for a closed statement.
  const linkedRows = rows.filter(t => official.some(b => b.id === t.billId));
  const statementRows = linkedRows.length ? linkedRows : rows;
  return {amount,paid,rows:statementRows,official,openMonth,open,closingDate,dueDate};
}
