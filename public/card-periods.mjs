// Use civil dates: the statement month is the month of its due date.
export function shift(date, months) {
  const [y,m,d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y,m+months,0));
  last.setUTCDate(Math.min(d || 1,last.getUTCDate()));
  return last.toISOString().slice(0,10);
}
const monthOf = day => day?.slice(0,7);
export const unlistedDescription = 'Compra ainda não detalhada pela instituição';
// Lançamento provisório com o valor que a instituição já soma no saldo do cartão sem ter listado
// a compra (finance.mjs). Fica pendente, na data em que apareceu, até ela detalhar o lançamento.
export const unlistedRow = card => ({id:'unlisted-'+card.id,account:card.id,currency:card.currency,date:card.unlisted.since,
  description:unlistedDescription,amount:-card.unlisted.amount,pending:true,unlisted:true,category:null});
export const unlistedRows = (data, currency) =>
  data.accounts.filter(a => a.type === 'CREDIT' && a.currency === currency && a.unlisted?.amount > 0).map(unlistedRow);
// A Pluggy às vezes repete uma compra pendente: no XP veio uma vez como "MULTIMIX" e outra como
// "MULTIMIX  PETROPOLIS  BR". Enquanto nenhuma fatura confirma, pendentes de mesma data e valor cuja
// descrição é igual ao começo da outra contam uma vez só, ficando a descrição mais completa.
export function cardRows(data, card, byId = new Map((data.bills || []).map(b => [b.id,b]))) {
  const words = t => (t.description || '').trim().replace(/\s+/g,' ').toLowerCase();
  const own = data.transactions.filter(t => t.account === card.id && t.currency === card.currency);
  const loose = own.filter(t => t.pending && !byId.has(t.billId)).sort((a,b) => words(b).length - words(a).length);
  const kept = [], repeated = new Set();
  for (const t of loose) {
    const text = words(t);
    const twin = kept.find(k => k.date === t.date && k.amount === t.amount && (k.installment ?? null) === (t.installment ?? null) &&
      (words(k) === text || words(k).startsWith(text+' ')));
    if (twin) repeated.add(t); else kept.push(t);
  }
  return own.filter(t => !repeated.has(t));
}
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
  const transactions = cardRows(data, card, byId);
  // O mês previsto pela Pluggy nem sempre é o do vencimento: no XP vem um mês antes. As compras à vista
  // já vinculadas a faturas fechadas mostram o deslocamento de cada cartão; sem maioria clara, nenhum.
  const offsets = new Map();
  for (const t of transactions) {
    const bill = byId.get(t.billId);
    if (!bill?.due || !t.forecast || t.installments > 1) continue;
    const [by,bm] = bill.due.split('-').map(Number), [fy,fm] = t.forecast.split('-').map(Number);
    const offset = (by-fy)*12+bm-fm;
    offsets.set(offset,(offsets.get(offset) || 0)+1);
  }
  const counted = [...offsets.values()].reduce((s,n) => s+n,0);
  const [offset = 0] = [...offsets].find(([,n]) => counted >= 3 && n > counted*0.6) || [];
  const forecastMonth = t => t.forecast && monthOf(shift(t.forecast.slice(0,7),offset));
  const pendingMonth = transactions.filter(t => t.pending && t.date <= today && !byId.has(t.billId))
    .map(forecastMonth).filter(m => m >= monthOf(today) && !bills.some(b => monthOf(b.due) === m)).sort()[0];
  const openMonth = card.due && (!card.close || today <= card.close) && today <= card.due ? monthOf(card.due) : pendingMonth || cycle(today);
  const rows = [], series = new Map();
  let paid = 0;
  for (const tx of transactions) {
    if (/^(pagamento de fatura|credit card payment)$/i.test(tx.providerCategory) ||
        (tx.amount > 0 && /^(?:pagamento\b|pagamentos v[aá]lidos normais\s*$)/i.test(tx.description))) {
      if (!tx.pending && tx.amount > 0 && monthOf(tx.date) === month && !byId.has(tx.billId)) paid += tx.amount;
      continue;
    }
    const linked = byId.get(tx.billId);
    const n = tx.installment, count = tx.installments;
    const firstMonth = tx.purchaseDate && cycle(tx.purchaseDate);
    let target = monthOf(linked?.due) || forecastMonth(tx);
    if (!target && n > 1 && tx.billPostDate) target = monthOf(tx.billPostDate);
    if (!target && firstMonth && n > 0) target = monthOf(shift(firstMonth,n-1));
    target ||= cycle(tx.date);
    // Without a closing day only an identified open, pending charge can be placed.
    if (!target && tx.pending && tx.date <= today && (!n || n === 1)) target = openMonth;
    if (target === month) rows.push(tx);
    if (target && Number.isInteger(n) && n >= 1 && Number.isInteger(count) && count >= n && tx.amount < 0) {
      // O Itaú cola o número da parcela no nome ("LOJA02/07"): sem isso, cada parcela virava outra compra.
      const merchant = (tx.description || '').replace(/(?<!\d)\d{1,3}\s*\/\s*\d{1,3}(?!\d)/g,'').trim().toLowerCase();
      // O valor fica fora da chave: a sobra do arredondamento costuma cair numa só parcela (em geral a
      // primeira), e com o valor na chave essa parcela virava uma compra à parte, projetada de novo todo mês.
      const key = JSON.stringify([merchant,tx.purchaseDate || shift(target,1-n).slice(0,7),count]);
      if (!series.has(key)) series.set(key,[]);
      series.get(key).push({tx,target});
    }
  }
  if (!official.length && month >= monthOf(today)) {
    const [year,number] = month.split('-').map(Number);
    for (const group of series.values()) {
      // Compras iguais no mesmo dia (mesma loja e número de parcelas) seguem separadas: cada parcela
      // entra na primeira compra que ainda não tem esse número e cujo valor difere no máximo da sobra
      // do arredondamento (menos de um centavo por parcela).
      const purchases = [];
      for (const entry of group) {
        const {installment:n,installments:count,amount} = entry.tx;
        const same = purchases.find(list => !list.some(e => e.tx.installment === n) &&
          Math.abs(list[0].tx.amount - amount) <= count);
        if (same) same.push(entry); else purchases.push([entry]);
      }
      for (const installments of purchases) {
        if (installments.some(entry => entry.target === month)) continue;
        const prior = installments.filter(entry => entry.target < month)
          .sort((a,b) => b.target.localeCompare(a.target) || b.tx.installment - a.tx.installment);
        if (!prior.length) continue;
        const {tx,target} = prior[0];
        const [y,m] = target.split('-').map(Number);
        const installment = tx.installment + (year-y)*12 + number-m;
        if (installment > tx.installments || installments.some(entry => entry.tx.installment === installment)) continue;
        // A parcela 1 pode carregar a sobra; as seguintes repetem o valor de qualquer outra parcela.
        // Parcela 1 deduzida do saldo (finance.mjs): o valor das seguintes vem calculado junto.
        const amount = prior.find(entry => entry.tx.installment > 1)?.tx.amount ?? prior[0].tx.laterAmount ?? prior[0].tx.amount;
        rows.push({...tx,amount,installment,projected:true});
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
  const reportedOpen = open && monthOf(card.due) === month && card.openAmount != null;
  // O que a instituição já soma no saldo do cartão sem ter listado a compra (finance.mjs) entra na
  // fatura em aberto até ela detalhar o lançamento.
  if (open && !reportedOpen && card.unlisted?.amount > 0) rows.push(unlistedRow(card));
  let amount = null;
  if (official.length) amount = official.reduce((s,b) => s+Math.max(0,b.amount),0);
  else if (reportedOpen) amount = Math.max(0,card.openAmount);
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
  const estimated = amount != null && !official.length && !reportedOpen;
  return {amount,paid,rows:statementRows,official,openMonth,open,estimated,closingDate,dueDate};
}
