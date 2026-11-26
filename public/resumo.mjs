// Resumo de leitura para programas locais (a Ayla): as mesmas contas da interface, prontas para
// responder perguntas como "qual o valor da minha fatura em aberto?". Valores em centavos.
import {cardPeriod} from './card-periods.mjs';
import {summarize, purchases, spending} from './report.mjs';

const byDate = (a,b) => a.localeCompare(b);

export function resumo(data, today = new Date().toLocaleDateString('en-CA')) {
  const month = today.slice(0,7);
  const categories = new Map(data.categories.map(c => [c.id,c.name]));
  const names = new Map(data.accounts.map(a => [a.id,a.name]));
  const cards = data.accounts.filter(a => a.type === 'CREDIT').map(card => {
    // Igual ao indicador "Fatura em aberto" da Visão geral.
    const current = cardPeriod(data,card,month,today);
    const bill = current.openMonth && cardPeriod(data,card,current.openMonth,today);
    const upcoming = (data.bills || []).filter(b => b.account === card.id && b.due >= today)
      .sort((a,b) => byDate(a.due,b.due)).slice(0,3)
      .map(b => ({due:b.due,close:b.close ?? null,amount:b.amount,currency:b.currency,
        paid:(b.payments || []).reduce((total,p) => total+(p.amount || 0),0)}));
    return {
      id:card.id, name:card.name, institution:card.institution, last4:card.last4 ?? null, currency:card.currency,
      balance:card.balance ?? null, limit:card.limit ?? null,
      openInvoice:bill?.open && bill.amount != null ? {month:current.openMonth,amount:bill.amount,
        closingDate:bill.closingDate ?? null,dueDate:bill.dueDate ?? null,estimated:!bill.official.length} : null,
      upcomingBills:upcoming,
      // Já somado na fatura em aberto: valor no saldo do cartão que a instituição ainda não listou.
      unlisted:card.unlisted ?? null,
    };
  });
  const currencies = [...new Set([data.currency, ...data.accounts.map(a => a.currency)].filter(Boolean))];
  const totals = currencies.map(currency => {
    const summary = summarize(data,month,currency,today);
    const open = cards.filter(c => c.currency === currency && c.openInvoice).map(c => c.openInvoice.amount);
    return {currency,month,income:summary.income,spent:summary.spent,result:summary.income-summary.spent,
      invoices:summary.invoices,openInvoices:open.length ? open.reduce((a,b) => a+b,0) : null,
      netWorth:summary.net ?? null};
  });
  // Despesas por categoria nos últimos 12 meses, de dois jeitos. `spent`/`categories`: fluxo mensal, como
  // no Resumo mensal (compras no cartão entram pela fatura que vence no mês; a parte sem detalhamento vira
  // "Fatura sem detalhamento"). `purchases`: gasto mensal, como na aba Gasto mensal (cada compra no mês
  // em que foi feita; parceladas com o valor total).
  const months = [];
  const bought = new Map(currencies.map(currency => [currency, purchases(data,currency,today)]));
  for (let back = 11; back >= 0; back--) {
    const [year, number] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, number - 1 - back, 1));
    const key = date.toISOString().slice(0,7);
    for (const currency of currencies) {
      const summary = summarize(data,key,currency,today);
      const spent = new Map();
      const add = (category, amount) => {
        const name = category === 'invoice' ? 'Fatura sem detalhamento' : categories.get(category) ?? 'Sem categoria';
        spent.set(name,(spent.get(name) || 0)+amount);
      };
      for (const [category, amount] of summary.byCategory) if (category !== 'invoices') add(category, amount);
      for (const [category, amount] of summary.invoiceByCategory) add(category, amount);
      const list = [...spent].filter(([,amount]) => amount).map(([name,amount]) => ({name,amount}))
        .sort((a,b) => b.amount-a.amount || a.name.localeCompare(b.name));
      const made = spending(data,key,currency,today,bought.get(currency));
      const madeList = [...made.byCategory].filter(([,amount]) => amount)
        .map(([category,amount]) => ({name:categories.get(category) ?? 'Sem categoria',amount}))
        .sort((a,b) => b.amount-a.amount || a.name.localeCompare(b.name));
      if (summary.spent || summary.income || list.length || made.total)
        months.push({month:key,currency,income:summary.income,spent:summary.spent,categories:list,
          purchases:{total:made.total,categories:madeList}});
    }
  }
  const recent = data.transactions.filter(t => t.date <= today).sort((a,b) => byDate(b.date,a.date)).slice(0,20)
    .map(t => ({date:t.date,description:t.description,amount:t.amount,currency:t.currency,pending:Boolean(t.pending),
      account:names.get(t.account) ?? null,category:categories.get(t.category) ?? null}));
  return {
    today, currency:data.currency,
    accounts:data.accounts.filter(a => a.type !== 'CREDIT').map(a => ({name:a.name,institution:a.institution,type:a.type,
      balance:a.balance ?? null,currency:a.currency})),
    cards, totals, months, recent,
    connected:data.sources.length > 0,
  };
}
