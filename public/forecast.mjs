// Previsão de compras no cartão: em que faturas cai uma compra, como elas ficam com as parcelas e qual
// o melhor dia para comprar. Valores em centavos e datas civis (AAAA-MM-DD), como no resto da Moneta.
import {cardCycle, cardPeriod, shift} from './card-periods.mjs';

const monthOf = day => day.slice(0,7);
export function addDays(day, days) {
  const date = new Date(day+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}
const daysBetween = (from, to) => Math.round((Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000);

// Valor de cada parcela. Sem juros, a primeira leva a sobra do arredondamento, como fazem os bancos.
// Com juros ao mês, parcelas iguais pela tabela Price.
export function installmentPlan(total, count, monthlyRate = 0) {
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isInteger(count) || count < 1) return [];
  if (monthlyRate > 0 && count > 1) {
    const value = Math.round(total*monthlyRate/(1-(1+monthlyRate)**-count));
    return Array(count).fill(value);
  }
  const value = Math.floor(total/count);
  return [total-value*(count-1),...Array(count-1).fill(value)];
}

// Limite que ainda cabe uma compra, quando a instituição informa o limite e o quanto já foi usado.
export function availableLimit(card) {
  if (card.limit == null) return null;
  const used = Math.max(card.used ?? 0,card.balance ?? 0);
  return card.limit-used;
}

// Faturas da compra: a fatura em que cai a compra feita em `date` e as seguintes, uma por parcela.
// Sem o fechamento do cartão, a primeira parcela vai para o mês seguinte ao da compra.
function placement(data, card, date, count) {
  const {cycle,dates,known} = cardCycle(data,card);
  const first = (known && cycle(date)) || monthOf(shift(date,1));
  const months = Array.from({length:count},(_,i) => monthOf(shift(first+'-01',i)));
  return {months,firstDue:dates(first).dueDate,dates,known};
}

// Simula a compra: as faturas previstas de cada mês, a parte desta compra e o total. Os meses vão da
// fatura em aberto hoje até a última parcela.
export function simulate(data, card, {amount, installments, rate = 0, date}, today) {
  const plan = installmentPlan(amount,installments,rate);
  if (!plan.length) return null;
  const {months,firstDue,dates,known} = placement(data,card,date,plan.length);
  const current = cardPeriod(data,card,monthOf(today),today).openMonth;
  const start = current && current < months[0] ? current : months[0];
  const rows = [];
  for (let month = start; month <= months.at(-1); month = monthOf(shift(month+'-01',1))) {
    const index = months.indexOf(month);
    const before = cardPeriod(data,card,month,today).amount ?? 0;
    const purchase = index >= 0 ? plan[index] : 0;
    rows.push({month,dueDate:dates(month).dueDate,before,purchase,total:before+purchase,installment:index >= 0 ? index+1 : null});
  }
  const total = plan.reduce((sum,value) => sum+value,0);
  const peak = Math.max(...rows.filter(row => row.purchase).map(row => row.total));
  return {plan,total,interest:total-amount,months,rows,firstDue,known,peak,
    days:firstDue ? daysBetween(date,firstDue) : null};
}

// Melhor momento para comprar: no dia seguinte ao fechamento, a compra cai na fatura seguinte e a primeira
// parcela só é paga cerca de 40 dias depois. Compara comprar no dia escolhido com o dia seguinte aos
// próximos fechamentos e aponta se esperar diminui a maior fatura (quando parcelas atuais terminam).
export function bestMoment(data, card, purchase, today) {
  const {cycle,dates,known} = cardCycle(data,card);
  if (!known) return null;
  const date = purchase.date < today ? today : purchase.date;
  const candidates = [{date,chosen:true}];
  const closing = dates(cycle(date)).closingDate;
  for (let i = 0; i < 3; i++) {
    const next = addDays(shift(closing,i),1);
    if (next > date) candidates.push({date:next,afterClosing:shift(closing,i)});
  }
  for (const candidate of candidates) {
    const result = simulate(data,card,{...purchase,date:candidate.date},today);
    Object.assign(candidate,{firstDue:result.firstDue,days:result.days,peak:result.peak,firstMonth:result.months[0]});
  }
  // O primeiro dia depois do fechamento é o que dá mais prazo sem esperar além do necessário. Se o dia
  // escolhido já é logo depois de um fechamento, ele mesmo é o melhor.
  const chosen = candidates[0];
  const next = candidates.find(c => c.afterClosing);
  const best = !next || chosen.days >= next.days-3 ? chosen : next;
  // Esperar mais um ciclo só vale a pena se a maior fatura cair de forma relevante (10% ou mais).
  const later = candidates.filter(c => c.date > best.date && c.peak <= best.peak*0.9).sort((a,b) => a.peak-b.peak || a.date.localeCompare(b.date))[0];
  return {candidates,best,later:later ?? null};
}
