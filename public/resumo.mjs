// Resumo de leitura para programas locais (a Ayla): as mesmas contas da interface, prontas para
// responder perguntas como "qual o valor da minha fatura em aberto?". Valores em centavos.
import {cardPeriod} from './card-periods.mjs';
import {summarize} from './report.mjs';

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
  const recent = data.transactions.filter(t => t.date <= today).sort((a,b) => byDate(b.date,a.date)).slice(0,20)
    .map(t => ({date:t.date,description:t.description,amount:t.amount,currency:t.currency,pending:Boolean(t.pending),
      account:names.get(t.account) ?? null,category:categories.get(t.category) ?? null}));
  return {
    today, currency:data.currency,
    accounts:data.accounts.filter(a => a.type !== 'CREDIT').map(a => ({name:a.name,institution:a.institution,type:a.type,
      balance:a.balance ?? null,currency:a.currency})),
    cards, totals, recent,
    connected:data.sources.length > 0,
  };
}
