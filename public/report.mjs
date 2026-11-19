const sum = (list, value) => list.reduce((total,row) => total + value(row),0);
const total = values => values.includes(null) ? null : sum(values,v => v);
export function summarize(data, month, currency) {
  const internal = new Set(data.categories.filter(c => c.internal).map(c => c.id));
  const rows = data.transactions.filter(t => t.date.startsWith(month) && t.currency === currency).filter(t => !t.pending && !internal.has(t.category));
  const expenses = rows.filter(t => t.amount < 0);
  const income = sum(rows.filter(t => t.amount > 0),t => t.amount);
  const spent = -sum(expenses,t => t.amount);
  const byCategory = new Map();
  for (const t of expenses) byCategory.set(t.category,(byCategory.get(t.category)||0)-t.amount);
  const positions = data.holdings.filter(p => p.currency === currency);
  const accounts = data.accounts.filter(a => a.currency === currency);
  const assets = [], debts = [], shared = new Set();
  const credit = [];
  for (const a of accounts) {
    if (a.shared && shared.has(a.shared)) continue;
    shared.add(a.shared);
    if (a.balance == null) {
      assets.push(null); debts.push(null);
      if (a.type === 'CREDIT') credit.push(null);
      continue;
    }
    const balance = a.type === 'CREDIT' ? -a.balance : a.balance - Math.min(Math.max(a.balance,0),Math.max(a.auto,0));
    assets.push(Math.max(0,balance)); debts.push(Math.max(0,-balance));
    if (a.type === 'CREDIT') credit.push(Math.max(0,-balance));
  }
  const invested = total(positions.map(p => p.net));
  const gross = total([...assets,...positions.map(p => p.gross)]);
  const netAssets = total([...assets,invested]);
  const debt = total(debts);
  return {income,spent,byCategory,gross,net:netAssets == null || debt == null ? null : netAssets-debt,credit:total(credit),invested};
}
