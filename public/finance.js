import { summarize } from './report.mjs';
const $ = selector => document.querySelector(selector);
const month = $('#month'), currency = $('#currency');
const today = new Date();
month.value = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0');
let data, request, notify;
const tag = (name, text) => {
  const element = document.createElement(name);
  if (text != null) element.textContent = text;
  return element;
};
function choices(select, options) {
  const before = select.value;
  select.replaceChildren(...options.map(([value,title]) => new Option(title,String(value))));
  if (options.some(([value]) => String(value) === before)) select.value = before;
}
const money = n => n == null ? 'Indisponível' : (n/100).toLocaleString('pt-BR',{style:'currency',currency:currency.value});
const accountName = a => [a.institution,a.name,a.last4 && '•• '+a.last4].filter(Boolean).join(' · ');
const categoryName = id => data.categories.find(c => c.id === id)?.name || 'Sem categoria';
function metrics(values) {
  const grid = tag('div');
  grid.className = 'metrics';
  for (const [title,amount] of values) {
    const box = tag('article');
    box.append(tag('span',title),tag('strong',money(amount)));
    grid.append(box);
  }
  return grid;
}
function table(headers, rows, empty) {
  if (!rows.length) return tag('p',empty);
  const wrap = tag('div'), t = tag('table'), heading = t.createTHead().insertRow();
  wrap.className = 'scroll'; wrap.append(t);
  for (const h of headers) heading.append(tag('th',h));
  const body = t.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const v of row) tr.insertCell().append(v instanceof Node ? v : String(v));
  }
  return wrap;
}
const periodRows = () => data.transactions.filter(t => t.date.startsWith(month.value || 'invalid') && t.currency === currency.value);
const sum = (list, value) => list.reduce((total,row) => total + value(row),0);
function report() {
  const loaded = data.sources.length > 0;
  const period = month.value || 'invalid';
  const summary = summarize(data,period,currency.value);
  const amount = value => loaded ? money(value) : '—';
  $('#net-worth').textContent = amount(summary.net);
  $('#month-metrics').replaceChildren(metrics([
    ['Receitas do mês', loaded ? summary.income : null],
    ['Despesas do mês', loaded ? summary.spent : null],
    ['Resultado do mês', loaded ? summary.income-summary.spent : null],
  ]));
  const flow = $('#flow');
  flow.replaceChildren();
  if (month.value) {
    const [year,number] = month.value.split('-').map(Number);
    const series = Array.from({length:6}, (_,i) => {
      const date = new Date(year,number-6+i,1);
      const key = date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0');
      const values = summarize(data,key,currency.value);
      return {date, income:values.income, spent:values.spent};
    });
    const peak = Math.max(1,...series.flatMap(point => [point.income,point.spent]));
    for (const point of series) {
      const col = tag('div'), bars = tag('div');
      const label = point.date.toLocaleDateString('pt-BR',{month:'short'}).replace('.','');
      col.title = label+' · Receitas '+amount(point.income)+' · Despesas '+amount(point.spent);
      col.setAttribute('aria-label',col.title);
      bars.className = 'bars';
      for (const value of [point.income,point.spent]) {
        const bar = tag('i');
        bar.style.height = (value/peak*100)+'%';
        bars.append(bar);
      }
      col.append(bars,tag('small',label)); flow.append(col);
    }
  }
  if (!loaded) {
    const link = tag('a','Configurar conexões ↗');
    link.href = '#conexoes';
    flow.append(link);
  }
  const breakdown = $('#breakdown');
  breakdown.replaceChildren();
  for (const [id,value] of [...summary.byCategory].sort((a,b) => b[1]-a[1])) {
    const row = tag('div'), track = tag('progress');
    track.max = summary.spent; track.value = value;
    track.setAttribute('aria-label',categoryName(id));
    row.append(tag('span',categoryName(id)),tag('strong',money(value)),track);
    breakdown.append(row);
  }
  if (!breakdown.childElementCount) breakdown.append(tag('p','Nenhuma despesa efetivada neste mês.'));
  $('#recent').replaceChildren(table(['Data','Descrição','Valor'],periodRows().slice(0,5).map(t =>
    [formatDate(t.date),t.description,money(t.amount)]),'Nenhum lançamento neste período.'));
  const position = $('#position'); position.replaceChildren();
  for (const [name,value] of [['Patrimônio bruto',summary.gross],['Investimentos líquidos',summary.invested],['Dívida de cartões',summary.credit]]) {
    position.append(tag('dt',name),tag('dd',amount(value)));
  }
}
let ledgerLimit = 100;
function ledger() {
  const query = $('#search').value.trim().toLocaleLowerCase();
  const selected = $('#filter-category').value;
  const rows = periodRows().filter(t => (!$('#account').value || t.account === $('#account').value) &&
    (!selected || String(t.category ?? 'none') === selected) && t.description.toLocaleLowerCase().includes(query));
  const accounts = new Map(data.accounts.map(a => [a.id,accountName(a)]));
  const records = rows.slice(0,ledgerLimit).map(t => {
    const select = tag('select');
    select.setAttribute('aria-label','Categoria de '+t.description);
    choices(select,[['','Automática'+(t.manual ? '' : ' · '+categoryName(t.category))],...data.categories.map(c => [c.id,c.name])]);
    select.value = t.manual ? String(t.category) : '';
    select.onchange = () => save('/assignment',{id:t.id,category:Number(select.value)||null});
    return [formatDate(t.date),t.description,accounts.get(t.account),select,t.pending?'Pendente':'Efetivada',money(t.amount)];
  });
  $('#ledger').replaceChildren(table(['Data','Descrição','Conta','Categoria','Situação','Valor'],records,'Nenhuma transação para estes filtros.'));
  if (rows.length > ledgerLimit) {
    const more = tag('button','Mostrar mais'); more.onclick = () => {ledgerLimit += 100; ledger();}; $('#ledger').append(more);
  }
}
const formatDate = value => value.split('-').reverse().join('/');
function cards() {
  const list = data.accounts.filter(a => a.type === 'CREDIT' && a.currency === currency.value);
  choices($('#card'),list.map(a => [a.id,accountName(a)]));
  const card = list.find(a => a.id === $('#card').value);
  const pane = $('#card-detail');
  if (!card) {pane.replaceChildren(tag('p','Nenhum cartão sincronizado nesta moeda.')); return;}
  const rows = periodRows().filter(t => t.account === card.id);
  pane.replaceChildren(tag('h2',accountName(card)),metrics([['Saldo usado atual',card.balance],['Limite informado',card.limit],['Débitos efetivados no mês',-sum(rows.filter(t => !t.pending && t.amount<0),t => t.amount)]]),
    tag('h2','Lançamentos do mês'),table(['Data','Descrição','Categoria','Situação','Valor'],rows.map(t => [formatDate(t.date),t.description,categoryName(t.category),t.pending?'Pendente':'Efetivada',money(t.amount)]),'Nenhum lançamento neste mês.'));
}
function manage(page) {
  if (page === 'categorias') {
    $('#category-list').replaceChildren(table(['Categoria','Modelo','Participa do fluxo mensal'],data.categories.map(c => [c.name,c.custom?'Personalizada':'Padrão',c.internal?'Não':'Sim']),'Nenhuma categoria.'));
  } else {
    choices($('#rule-category'),data.categories.map(c => [c.id,c.name]));
    $('#rule-list').replaceChildren(table(['Prioridade','Descrição contém','Categoria',''],data.rules.map((r,i) => {
      const remove = tag('button','Excluir'); remove.onclick = () => save('/rules/remove',{id:r.id});
      return [i+1,r.term,categoryName(r.category),remove];
    }),'Nenhuma regra criada.'));
  }
}
export function navigate() {
  const page = [...document.querySelectorAll('main > section')].find(s => '#'+s.id === location.hash)?.id || 'relatorio';
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== page;
  for (const a of document.querySelectorAll('nav a')) a.setAttribute('aria-current',a.hash === '#'+page ? 'page' : 'false');
  $('#page-title').textContent = document.querySelector('nav a[aria-current=page]').lastChild.textContent;
  $('.toolbar').hidden = !['relatorio','transacoes','cartoes','conexoes'].includes(page);
  $('#period').hidden = $('#unit').hidden = page === 'conexoes';
  if (!data) return;
  if (page === 'relatorio') report();
  if (page === 'cartoes') cards();
  if (page === 'transacoes') ledger();
  if (['categorias','regras'].includes(page)) manage(page);
}
async function refresh() {
  data = await request('finance');
  const units = new Set(['BRL',...[...data.accounts,...data.transactions,...data.holdings].map(row => row.currency).filter(Boolean)]);
  choices(currency,[...units].map(u => [u,u]));
  choices($('#account'),[['','Todas'],...data.accounts.map(a => [a.id,accountName(a)])]);
  choices($('#filter-category'),[['','Todas'],['none','Sem categoria'],...data.categories.map(c => [c.id,c.name])]);
  $('#fresh').textContent = data.sources.length ? 'Atualizado em '+new Date(data.sources[0].updated).toLocaleString('pt-BR') : 'Aguardando sincronização';
  navigate();
}
async function save(path,body,form) {
  try {
    await request(path.slice(1),body);
    form?.reset(); await refresh(); notify('Alteração salva.');
  } catch (e) { navigate(); notify(e.message); }
}
export async function syncFinance() {
  $('#sync').disabled = true; notify('Sincronizando com a Pluggy…');
  try {await request('sync',{}); await refresh(); notify('Sincronização concluída.');}
  catch (e) {notify('Falha ao sincronizar. '+e.message);}
  finally {$('#sync').disabled = false;}
}
export function initializeFinance(api, message) {
  request = api; notify = message;
  $('#sync').onclick = syncFinance;
  for (const id of ['month','currency','account','filter-category','card','search']) {
    $('#'+id).oninput = () => {ledgerLimit=100; navigate();};
  }
  $('#category-form').onsubmit = e => {
    e.preventDefault(); const form = e.currentTarget;
    save('/categories',{name:form.elements.name.value,internal:form.elements.internal.checked},form);
  };
  $('#rule-form').onsubmit = e => {
    e.preventDefault(); const form = e.currentTarget;
    save('/rules',{term:form.elements.term.value,category:Number(form.elements.category.value)},form);
  };
  refresh().catch(e => notify(e.message));
}
