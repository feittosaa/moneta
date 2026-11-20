import {cardPeriod} from './card-periods.mjs';
import { renderPortfolio } from './portfolio.js';
import { summarize } from './report.mjs';
const $ = selector => document.querySelector(selector);
const month = $('#month'), currency = $('#currency');
function currentMonth() {
  const now = new Date();
  return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
}
month.value = currentMonth();
let data, request, notify;
let portfolioTab = false, historyRequest, ledgerScope, ledgerLink;
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
let hiddenAmounts = localStorage.getItem('moneta-hide-amounts') === 'true';
const money = n => hiddenAmounts ? '••••' : n == null ? 'Indisponível' : (n === 0 ? 0 : n/100).toLocaleString('pt-BR',{style:'currency',currency:currency.value});
const accountName = a => [a.institution,a.name,a.last4 && '•• '+a.last4].filter(Boolean).join(' · ');
const categoryName = id => id === 'invoice' ? 'Fatura sem detalhamento' : id === 'invoices' ? 'Faturas de cartão' : data.categories.find(c => c.id === id)?.name || 'Sem categoria';
function categoryColor(id) {
  return data.categories.find(c => c.id === id)?.color || (id === 'invoice' || id === 'invoices' ? 'var(--invoice)' : 'var(--muted)');
}
function categoryLabel(id) {
  const label = tag('span',categoryName(id));
  label.className = 'category-label';
  label.style.setProperty('--category-color',categoryColor(id));
  return label;
}
function metrics(values) {
  const grid = tag('div');
  grid.className = 'metrics';
  for (const [title,amount,tone] of values) {
    const box = tag('article');
    if (tone) box.className = tone;
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
// Ordenação por coluna: crescente, decrescente e de volta à ordem padrão a cada clique.
const sorting = new Map();
const collator = new Intl.Collator('pt-BR',{numeric:true,sensitivity:'base'});
const compare = (a,b) => typeof a === 'number' && typeof b === 'number' ? a-b : collator.compare(String(a ?? ''),String(b ?? ''));
function sortableTable(id, columns, items, empty, render) {
  const state = sorting.get(id);
  const key = state && columns[state.column]?.sort;
  const ordered = key ? [...items].sort((a,b) => compare(key(a),key(b))*state.direction) : items;
  const wrap = table(columns.map(c => c.title),ordered.map(item => columns.map(c => c.cell(item))),empty);
  const heading = wrap.querySelector('thead tr');
  if (!heading) return wrap;
  wrap.dataset.table = id;
  columns.forEach((column,index) => {
    if (!column.sort) return;
    const th = heading.children[index], active = state?.column === index;
    const direction = active ? (state.direction > 0 ? 'ascending' : 'descending') : 'none';
    th.setAttribute('aria-sort',direction);
    const control = tag('button',column.title), arrow = tag('span',{ascending:'↑',descending:'↓',none:'↕'}[direction]);
    arrow.setAttribute('aria-hidden','true');
    control.type = 'button';
    control.className = 'sort';
    control.title = !active ? 'Ordenar por '+column.title.toLocaleLowerCase('pt-BR') : state.direction > 0 ? 'Ordenar de forma decrescente' : 'Voltar à ordem padrão';
    control.append(arrow);
    control.onclick = () => {
      if (!active) sorting.set(id,{column:index,direction:1});
      else if (state.direction > 0) sorting.set(id,{column:index,direction:-1});
      else sorting.delete(id);
      render();
      document.querySelector(`[data-table="${id}"] th:nth-child(${index+1}) .sort`)?.focus();
    };
    th.replaceChildren(control);
  });
  return wrap;
}
function hue(color) {
  const [r,g,b] = [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255);
  const max = Math.max(r,g,b), range = max-Math.min(r,g,b);
  if (!range) return -1;
  const h = max === r ? (g-b)/range : max === g ? (b-r)/range+2 : (r-g)/range+4;
  return (h*60+360)%360;
}
const periodRows = () => data.transactions.filter(t => t.date.startsWith(month.value || 'invalid') && t.currency === currency.value);
const allMonths = () => $('#ledger-period').value === 'all';
const sum = (list, value) => list.reduce((total,row) => total + value(row),0);
function report() {
  const loaded = data.sources.length > 0 || data.accounts.some(a => a.type === 'CASH' && a.currency === currency.value);
  const period = month.value || 'invalid';
  const summary = summarize(data,period,currency.value);
  const amount = value => loaded ? money(value) : '—';
  $('#net-worth').textContent = amount(summary.net);
  const result = summary.income - summary.spent;
  const indicators = metrics([
    ['Receita', loaded ? summary.income : null],
    ['Despesas', loaded ? summary.spent : null],
    ['Resultado do mês', loaded ? result : null,loaded && result ? (result > 0 ? 'result-positive' : 'result-negative') : null],
  ]);
  const detail = tag('small');
  detail.className = 'expense-detail';
  detail.append(tag('b','Débito '+amount(summary.debit)),tag('i','+'),tag('b','Faturas '+amount(summary.invoices)));
  if (summary.cashSpent) detail.append(tag('i','+'),tag('b','Dinheiro '+amount(summary.cashSpent)));
  indicators.children[1].append(detail);
  $('#month-metrics').replaceChildren(indicators);
  $('#bill-note').textContent = !loaded ? '' : [
    summary.projected ? 'O total inclui '+money(summary.projected)+' em faturas estimadas.' : '',
    summary.inferred ? 'Parte da composição da fatura foi estimada pelas compras do cartão e pelo valor pago.' : '',
    summary.invoiceFallback ? 'Para faturas sem total disponível, usamos o pagamento identificado.' : '',
    summary.missingBills ? 'Há cartão sem fatura informada para o mês. O resultado inclui apenas os valores disponíveis.' : ''
  ].filter(Boolean).join(' ');
  const flow = $('#flow');
  flow.replaceChildren();
  if (month.value) {
    const [year,number] = month.value.split('-').map(Number);
    const series = Array.from({length:6}, (_,i) => {
      const date = new Date(year,number-6+i,1);
      const key = date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0');
      const values = summarize(data,key,currency.value);
      return {date, income:values.income, spent:values.spent,invoices:values.invoices,cashSpent:values.cashSpent};
    });
    $('.legend span:nth-child(2)').textContent = series.some(p => p.cashSpent) ? 'Débito e dinheiro' : 'Débito';
    const peak = Math.max(1,...series.flatMap(point => [point.income,point.spent]));
    for (const point of series) {
      const col = tag('div'), bars = tag('div');
      const label = point.date.toLocaleDateString('pt-BR',{month:'short'}).replace('.','');
      col.title = label+' · Receitas '+amount(point.income)+' · Despesas '+amount(point.spent)+' · Faturas '+amount(point.invoices);
      col.setAttribute('aria-label',col.title);
    col.tabIndex = 0;
      bars.className = 'bars';
      for (const [index,value] of [point.income,point.spent].entries()) {
        const bar = tag('i');
        bar.style.height = (value/peak*100)+'%';
        if (index === 1 && value > 0) {
          const invoice = tag('b');
          invoice.className = 'flow-invoice';
          invoice.style.height = (100*point.invoices/value)+'%';
          bar.append(invoice);
        }
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
  const invoicesOnly = $('#expense-scope').value === 'invoice';
  const categories = invoicesOnly ? summary.invoiceByCategory : summary.byCategory;
  for (const [id,value] of [...categories].filter(([,v]) => v !== 0).sort((a,b) => b[1]-a[1])) {
    const row = tag('div'), track = tag('progress');
    track.max = Math.max(1,invoicesOnly ? summary.invoices : summary.spent); track.value = Math.max(0,value);
    track.style.setProperty('--category-color',categoryColor(id));
    track.setAttribute('aria-label',categoryName(id));
    const link = tag('a');
    const invoiceTotal = id === 'invoices';
    link.href = '#transacoes?'+new URLSearchParams(invoiceTotal ? {mes:period,origem:'faturas'} :
      {mes:period,categoria:String(id ?? 'none'),origem:invoicesOnly ? 'faturas' : 'despesas'});
    link.title = invoiceTotal ? 'Ver as compras das faturas deste mês' : 'Ver lançamentos de '+categoryName(id)+' no resumo deste mês';
    link.append(categoryLabel(id));
    row.append(link,tag('strong',money(value)),track);
    breakdown.append(row);
  }
  if (!breakdown.childElementCount) breakdown.append(tag('p',invoicesOnly ? 'Nenhuma fatura neste mês.' : 'Nenhuma despesa efetivada neste mês.'));
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
  let transactions = allMonths() ? data.transactions.filter(t => t.currency === currency.value) : periodRows();
  if (ledgerScope) {
    const summary = summarize(data,month.value,currency.value);
    transactions = ledgerScope === 'faturas' ? summary.invoiceRows : summary.expenses;
    if (selected === 'invoice') {
      transactions = summary.invoiceByCategory.has('invoice') ? [{
        date:month.value+'-01',description:'Fatura sem detalhamento',category:'invoice',amount:-summary.invoiceByCategory.get('invoice'),projected:true
      }] : [];
    }
    transactions.sort((a,b) => b.date.localeCompare(a.date));
  }
  $('#ledger-context').hidden = !ledgerScope;
  $('#ledger-context-label').textContent = ledgerScope === 'faturas' ? 'Compras das faturas do mês selecionado.' : 'Despesas do mês selecionado fora das faturas de cartão.';
  const rows = transactions.filter(t => (!$('#account').value || t.account === $('#account').value) &&
    (!selected || String(t.category ?? 'none') === selected) && t.description.toLocaleLowerCase().includes(query));
  const accounts = new Map(data.accounts.map(a => [a.id,accountName(a)]));
  const records = rows.slice(0,ledgerLimit).map(t => {
    const open = tag('button',t.description);
    open.className = 'transaction-link';
    open.onclick = () => openTransaction(t);
    const value = tag('span',money(t.amount));
    if (t.amount > 0) value.className = 'amount-income';
    return [t.category === 'invoice' || t.projected ? '—' : formatDate(t.date),t.projected ? t.description : open,
      accounts.get(t.account) || '—',categoryLabel(t.category),t.projected ? (t.category === 'invoice' ? 'Sem detalhamento' : 'Prevista') : t.pending?'Pendente':'Efetivada',value];
  });
  $('#ledger').replaceChildren(table(['Data','Descrição','Conta','Categoria','Situação','Valor'],records,'Nenhuma transação para estes filtros.'));
  if (rows.length > ledgerLimit) {
    const more = tag('button','Mostrar mais'); more.onclick = () => {ledgerLimit += 100; ledger();}; $('#ledger').append(more);
  }
}
const formatDate = value => value.split('-').reverse().join('/');
function openTransaction(tx) {
  const dialog = $('#tx-dialog'), form = $('#tx-form');
  const {category,note,createRule,term} = form.elements;
  form.reset();
  $('#tx-error').textContent = '';
  $('#tx-title').textContent = tx.description;
  const account = data.accounts.find(a => a.id === tx.account);
  $('#tx-details').textContent = [formatDate(tx.date),account && accountName(account),money(tx.amount)].filter(Boolean).join(' · ');
  choices(category,[['','Seguir regras'+(tx.manual ? '' : ' · '+categoryName(tx.category))],...data.categories.map(c => [c.id,c.name])]);
  category.value = tx.manual ? String(tx.category) : '';
  note.value = tx.note || '';
  term.value = tx.description.slice(0,100);
  function toggleRule() {
    $('#tx-term').hidden = !createRule.checked;
    category.required = term.required = createRule.checked;
    if (createRule.checked && !category.value && tx.category) category.value = String(tx.category);
  }
  createRule.onchange = toggleRule;
  toggleRule();
  $('#tx-cancel').onclick = () => dialog.close();
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('button:not([type])');
    submit.disabled = true;
    try {
      await request('transaction',{id:tx.id,note:note.value,category:Number(category.value)||null,ruleTerm:createRule.checked ? term.value : null});
      dialog.close();
      await refresh();
      notify('Transação salva.');
    } catch (error) { $('#tx-error').textContent = error.message; notify(error.message); }
    finally { submit.disabled = false; }
  };
  dialog.showModal();
}
function cardAmount(tx) {
  const value = tag('span',money(tx.amount));
  if (tx.amount < 0) value.className = 'purchase-amount';
  return value;
}
function cards() {
  const list = data.accounts.filter(a => ['CREDIT','BANK'].includes(a.type) && a.currency === currency.value);
  const cardName = a => [a.type === 'BANK' ? 'Débito' : 'Crédito',a.institution,a.kind || (a.name !== a.institution ? a.name : ''),a.last4 && '•• '+a.last4].filter(Boolean).join(' · ');
  choices($('#card'),list.map(a => [a.id,cardName(a)]));
  const card = list.find(a => a.id === $('#card').value);
  const pane = $('#card-detail');
  if (!card) {pane.replaceChildren(tag('p','Nenhum cartão ou conta sincronizada nesta moeda.')); return;}
  pane.replaceChildren(tag('h2',cardName(card)));
  if (!month.value) return;
  if (card.type === 'BANK') {
    const accountDebits = periodRows().filter(t => t.account === card.id && t.amount < 0);
    const debitPurchases = accountDebits.filter(t => /^(?:CARTAO|COMPRA_CARTAO|CARTAO_(?:DE_)?DEBITO|COMPRA_CARTAO_(?:DE_)?DEBITO)$/.test(t.operation) ||
      /^(?:compra (?:no |com )?(?:cartão (?:de )?)?d[eé]bito|compra cart[aã]o|rshop)\b/i.test(t.description));
    pane.append(metrics([['Saldo atual da conta',card.balance],['Compras no débito no mês',-sum(debitPurchases.filter(t => !t.pending),t => t.amount),'purchase-metric']]),
      tag('h2','Compras identificadas no débito'),table(['Data','Descrição','Categoria','Situação','Valor'],debitPurchases.map(t =>
        [formatDate(t.date),t.description,categoryName(t.category),t.pending?'Pendente':'Efetivada',cardAmount(t)]),'Nenhuma compra no cartão de débito identificada neste mês.'));
    return;
  }
  const day = new Date().toLocaleDateString('en-CA');
  const period = cardPeriod(data,card,month.value,day);
  const open = period.openMonth && cardPeriod(data,card,period.openMonth,day);
  const openLabel = open?.open ? 'Fatura em aberto · '+period.openMonth.split('-').reverse().join('/') : 'Fatura atual em aberto';
  pane.append(metrics([[openLabel,open?.open ? open.amount : null,'invoice-metric'],['Limite total',card.limit],['Limite utilizado',card.used]]));
  const status = period.official.length ? 'fechada' : period.open ? 'em aberto' : 'estimada';
  const [year,number] = month.value.split('-');
  pane.append(tag('h2','Fatura de '+number+'/'+year+(period.amount == null ? '' : ' · '+status)),
    tag('p',period.amount == null ? (period.paid ? 'Pagamento de fatura identificado no mês · '+money(period.paid) : 'Fatura indisponível para este período.') : money(period.amount)));
  if (!period.official.length && period.amount != null && period.dueDate) {
    pane.append(tag('p',[period.closingDate && 'Fechamento previsto em '+formatDate(period.closingDate),'Vencimento previsto em '+formatDate(period.dueDate)].filter(Boolean).join(' · ')));
  }
  for (const bill of period.official) {
    pane.append(tag('p',[bill.close && 'Fechamento em '+formatDate(bill.close),'Vencimento em '+formatDate(bill.due)].filter(Boolean).join(' · ')));
  }
  pane.append(table(['Data','Descrição','Parcela','Categoria','Valor'],period.rows.map(t => [
    t.projected ? 'Prevista' : formatDate(t.date),t.description,t.installment ? t.installment+'/'+t.installments : '—',categoryName(t.category),cardAmount(t)
  ]),'Nenhum lançamento vinculado a esta fatura.'));
}
function editRule(rule = {}) {
  const dialog = $('#rule-editor'), form = $('#edit-rule-form');
  const field = name => form.elements.namedItem(name);
  const editing = rule.id != null || rule.key != null;
  $('#rule-heading').textContent = editing ? 'Editar regra' : 'Criar regra';
  form.reset();
  field('title').value = rule.name || '';
  choices(field('category'),data.categories.map(c => [c.id,c.name]));
  field('category').value = rule.category ?? '';
  field('priority').value = rule.priority ?? 0;
  field('priority').closest('label').hidden = rule.key == null;
  field('mode').value = rule.mode || 'and';
  field('active').checked = rule.active ?? true;
  const root = $('#edit-conditions');
  root.replaceChildren();
  const fields = [['description','Descrição'],['receiver_document','CPF ou CNPJ do destinatário'],['amount','Valor'],['date','Data'],['status','Situação'],['type','Tipo'],['payee_id','Favorecido importado']];
  const operators = [['contains','contém'],['not_contains','não contém'],['starts_with','começa com'],['ends_with','termina com'],['equals','igual a'],['not_equals','diferente de'],['regex','corresponde à expressão'],['lt','menor que'],['lte','menor ou igual a'],['gt','maior que'],['gte','maior ou igual a']];
  const conditions = structuredClone(rule.conditions || [{field:'description',op:'contains',value:rule.term || ''}]);
  function button(title,action) {
    const control = tag('button',title);
    control.type = 'button';
    control.onclick = action;
    return control;
  }
  function renderGroup(container, nodes) {
    container.replaceChildren();
    for (const node of nodes) {
      const row = tag('fieldset');
      const remove = button('Remover',() => {
        nodes.splice(nodes.indexOf(node),1);
        row.remove();
      });
      if (Array.isArray(node.conditions)) {
        const mode = tag('select'), inner = tag('div');
        choices(mode,[['and','Todas (E)'],['or','Qualquer (OU)']]);
        mode.value = node.op;
        mode.setAttribute('aria-label','Combinação do grupo');
        mode.onchange = () => { node.op = mode.value; };
        row.append(tag('legend','Grupo de condições'),mode,inner,remove);
        renderGroup(inner,node.conditions);
      } else {
        const key = tag('select'), op = tag('select'), value = tag('input');
        choices(key,fields.some(([id]) => id === node.field) ? fields : [...fields,[node.field,node.field]]);
        key.value = node.field;
        key.setAttribute('aria-label','Campo da condição');
        op.setAttribute('aria-label','Operador');
        value.setAttribute('aria-label','Valor da condição');
        value.required = true;
        value.value = node.value ?? '';
        function updateOperators() {
          const options = node.field === 'receiver_document' ? operators.filter(([id]) => id === 'equals') : operators;
          choices(op,options);
          if (!options.some(([id]) => id === node.op)) node.op = options[0][0];
          op.value = node.op;
        }
        updateOperators();
        key.onchange = () => { node.field = key.value; updateOperators(); };
        op.onchange = () => { node.op = op.value; };
        value.oninput = () => { node.value = value.value; };
        row.append(tag('legend','Condição'),key,op,value,remove);
      }
      container.append(row);
    }
    container.append(button('Adicionar condição',() => {
      nodes.push({field:'description',op:'contains',value:''});
      renderGroup(container,nodes);
    }),button('Adicionar grupo',() => {
      nodes.push({op:'or',conditions:[{field:'description',op:'contains',value:''}]});
      renderGroup(container,nodes);
    }));
  }
  renderGroup(root,conditions);
  $('#edit-error').textContent = '';
  $('#edit-cancel').onclick = () => dialog.close();
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      await request(editing ? 'rules/edit' : 'rules',{key:rule.key,id:rule.id,name:field('title').value,
        active:field('active').checked,mode:field('mode').value,priority:Number(field('priority').value),
        conditions,category:Number(field('category').value)});
      dialog.close(); await refresh(); notify('Regra salva.');
    } catch (error) { $('#edit-error').textContent = error.message; }
    finally { submit.disabled = false; }
  };
  dialog.showModal();
}
function editCategory(category) {
  const dialog = $('#category-editor'), form = $('#edit-category-form');
  const {name,color,internal} = form.elements;
  name.value = category.name;
  color.value = category.color;
  internal.checked = Boolean(category.internal);
  $('#cancel-category').onclick = () => dialog.close();
  form.onsubmit = async event => {
    event.preventDefault();
    try {
      await request('categories/edit',{id:category.id,name:name.value,color:color.value,internal:internal.checked});
      dialog.close(); await refresh(); notify('Categoria salva.');
    } catch (error) { notify(error.message); }
  };
  dialog.showModal();
}
const mine = 'Criada por mim';
function originCell(label, detail) {
  const cell = tag('span',label);
  if (detail) cell.append(' ',tag('small',detail));
  return cell;
}
function manage(page) {
  const render = () => manage(page);
  if (page === 'categorias') {
    const origin = $('#category-origin').value;
    const categories = data.categories.filter(c => !origin || (origin === 'mine') === Boolean(c.custom));
    $('#category-list').replaceChildren(sortableTable('categorias',[
      {title:'Categoria',sort:c => c.name,cell:c => categoryLabel(c.id)},
      {title:'Cor',sort:c => hue(c.color),cell:c => {
        const picker = tag('input');
        picker.type = 'color'; picker.value = c.color;
        picker.setAttribute('aria-label','Cor de '+c.name);
        picker.onchange = async () => {
          picker.disabled = true;
          try { await save('/categories/color',{id:c.id,color:picker.value}); }
          finally { picker.disabled = false; }
        };
        return picker;
      }},
      {title:'Origem',sort:c => c.custom ? mine : 'Moneta',cell:c => c.custom ? mine : 'Moneta'},
      {title:'Participa do fluxo mensal',sort:c => c.internal ? 'Não' : 'Sim',cell:c => c.internal ? 'Não' : 'Sim'},
      {title:'Ações',cell:c => {
        const actions = tag('div'), edit = tag('button','Editar'), remove = tag('button','Excluir');
        actions.className = 'rule-actions';
        edit.onclick = () => editCategory(c);
        remove.onclick = () => {
          if (confirm('Excluir a categoria '+c.name+'? As classificações e regras locais associadas serão removidas.')) save('/categories/remove',{id:c.id});
        };
        actions.append(edit,remove);
        return actions;
      }},
    ],categories,origin ? 'Nenhuma categoria com esta origem.' : 'Nenhuma categoria.',render));
  } else {
    const normalize = value => value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
    const query = normalize($('#rule-search').value.trim());
    const origin = $('#rule-origin').value;
    const matches = (...values) => normalize(values.join(' ')).includes(query);
    // Regras importadas também são do usuário; só o catálogo padrão é da Moneta.
    const rules = [...data.rules.map(r => ({...r,name:r.name || r.term,mine:true,status:r.active === false ? 'Desativada' : 'Ativa'})),
      ...data.catalogRules.map(r => ({...r,mine:r.imported}))].map((r,index) => ({...r,order:index+1}));
    const visible = rules.filter(r => (!origin || (origin === 'mine') === r.mine) &&
      matches(r.name,r.mine ? mine : 'Moneta',r.imported ? 'importada' : '',categoryName(r.category),r.status,r.terms ?? ''));
    $('#rule-list').replaceChildren(sortableTable('regras',[
      {title:'Ordem',sort:r => r.order,cell:r => r.order},
      {title:'Regra',sort:r => r.name,cell:r => r.name},
      {title:'Origem',sort:r => r.mine ? mine : 'Moneta',cell:r => r.mine ? originCell(mine,r.imported && 'importada') : 'Moneta'},
      {title:'Categoria',sort:r => categoryName(r.category),cell:r => categoryName(r.category)},
      {title:'Situação',sort:r => r.status,cell:r => r.status},
      {title:'Ações',cell:r => {
        const actions = tag('div'), edit = tag('button','Editar'), remove = tag('button','Excluir');
        actions.className = 'rule-actions';
        edit.onclick = () => editRule(r);
        remove.onclick = () => {
          if (confirm('Excluir a regra '+r.name+'?')) save('/rules/remove',{id:r.id,key:r.key});
        };
        actions.append(edit,remove);
        return actions;
      }},
    ],visible,'Nenhuma regra encontrada.',render));
  }
}
export function navigate() {
  const [hash,search] = location.hash.split('?');
  const page = [...document.querySelectorAll('main > section')].find(s => '#'+s.id === hash)?.id || 'relatorio';
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== page;
  for (const a of document.querySelectorAll('nav a')) a.setAttribute('aria-current',a.hash === '#'+page ? 'page' : 'false');
  $('#page-title').textContent = document.querySelector('nav a[aria-current=page]').lastChild.textContent;
  $('.toolbar').hidden = !['relatorio','transacoes','cartoes','carteira','conexoes'].includes(page);
  $('#current-month').hidden = page !== 'relatorio';
  $('#period').hidden = page === 'conexoes' || (page === 'relatorio' && portfolioTab) || (page === 'transacoes' && allMonths());
  if (!data) return;
  if (page !== 'transacoes' || !search) {
    ledgerScope = ledgerLink = null;
    const synthetic = $('#filter-category option[value=invoice]');
    if (synthetic) synthetic.remove();
  }
  if (page === 'transacoes' && search && search !== ledgerLink) {
    ledgerLink = search;
    const params = new URLSearchParams(search);
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('mes'))) {
      month.value = params.get('mes');
      $('#ledger-period').value = 'month';
      $('#period').hidden = false;
    }
    ledgerScope = ['despesas','faturas'].includes(params.get('origem')) ? params.get('origem') : null;
    const category = $('#filter-category');
    if (params.get('categoria') === 'invoice' && ![...category.options].some(o => o.value === 'invoice'))
      category.add(new Option('Fatura sem detalhamento','invoice'));
    category.value = params.get('categoria') || '';
    if (category.selectedIndex < 0) category.value = '';
    $('#account').value = $('#search').value = '';
    ledgerLimit = 100;
  }
  if (page === 'relatorio') {
    $('#report').hidden = portfolioTab;
    $('#portfolio').hidden = !portfolioTab;
    $('#monthly-tab').setAttribute('aria-pressed',String(!portfolioTab));
    $('#portfolio-tab').setAttribute('aria-pressed',String(portfolioTab));
    if (portfolioTab) showPortfolio();
    else report();
  }
  if (page === 'carteira') {
    const id = 'wallet-'+currency.value;
    const account = data.accounts.find(a => a.id === id);
    $('#wallet-balance').replaceChildren(metrics([['Saldo em dinheiro',account?.balance ?? 0]]));
    $('#wallet-list').replaceChildren(table(['Data','Descrição','Valor'],periodRows().filter(t => t.account === id)
      .map(t => [formatDate(t.date),t.description,money(t.amount)]),'Nenhuma movimentação neste mês.'));
  }
  if (page === 'cartoes') cards();
  if (page === 'transacoes') ledger();
  if (['categorias','regras'].includes(page)) manage(page);
}
async function showPortfolio() {
  const target = $('#portfolio-content');
  const pending = historyRequest ??= request('portfolio');
  try {
    const history = await pending;
    if (historyRequest === pending && !$('#relatorio').hidden && !$('#portfolio').hidden)
      renderPortfolio(history,data.transactions,currency.value,target,money);
  } catch (error) {
    if (historyRequest !== pending) return;
    historyRequest = null;
    target.textContent = error.message;
  }
}
async function refresh() {
  data = await request('finance');
  historyRequest = null;
  const units = new Set([data.currency,'BRL','USD','EUR',...Intl.supportedValuesOf('currency'),...[...data.accounts,...data.transactions,...data.holdings].map(row => row.currency).filter(Boolean)]);
  choices(currency,[...units].sort().map(u => [u,u]));
  currency.value = data.currency;
  choices($('#account'),[['','Todas'],...data.accounts.map(a => [a.id,accountName(a)])]);
  choices($('#filter-category'),[['','Todas'],['none','Sem categoria'],...(ledgerScope ? [['invoice','Fatura sem detalhamento']] : []),...data.categories.map(c => [c.id,c.name])]);
  const latest = data.sources.map(s => s.updated).sort().at(-1);
  $('#fresh').textContent = latest ? 'Atualizado em '+new Date(latest).toLocaleString('pt-BR') : 'Nenhum dado importado';
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
  $('#expense-scope').onchange = navigate;
  $('#monthly-tab').onclick = () => { portfolioTab = false; navigate(); };
  $('#portfolio-tab').onclick = () => { portfolioTab = true; navigate(); };
  $('#clear-ledger-context').onclick = () => { location.hash = 'transacoes'; };
  for (const id of ['portfolio-range','portfolio-year','portfolio-from','portfolio-to']) $('#'+id).onchange = showPortfolio;
  $('#sync').title = 'Atualizar agora os dados disponíveis no MeuPluggy';
  const privacy = $('#privacy');
  function reflectPrivacy() {
    privacy.title = hiddenAmounts ? 'Mostrar valores' : 'Ocultar valores';
    privacy.setAttribute('aria-label',privacy.title);
    privacy.setAttribute('aria-pressed',String(hiddenAmounts));
  }
  reflectPrivacy();
  privacy.onclick = () => {
    hiddenAmounts = !hiddenAmounts;
    localStorage.setItem('moneta-hide-amounts', String(hiddenAmounts));
    reflectPrivacy();
    navigate();
  };
  currency.onchange = async () => {
    currency.disabled = true;
    try {
      await request('settings/currency',{currency:currency.value});
      data.currency = currency.value;
      notify('Moeda padrão salva.');
    } catch (error) { currency.value = data.currency; notify(error.message); }
    finally { currency.disabled = false; navigate(); }
  };
  $('#sync').onclick = syncFinance;
  $('#current-month').onclick = () => {
    month.value = currentMonth();
    month.dispatchEvent(new Event('input'));
  };
  for (const button of document.querySelectorAll('[data-month-step]')) {
    button.onclick = () => {
      const [year, number] = (month.value || currentMonth()).split('-').map(Number);
      const offset = year * 12 + number - 1 + Number(button.dataset.monthStep);
      if (offset < 12 || offset >= 120000) return;
      month.value = String(Math.floor(offset / 12)).padStart(4,'0') + '-' + String(offset % 12 + 1).padStart(2,'0');
      month.dispatchEvent(new Event('input'));
    };
  }
  for (const id of ['month','account','filter-category','card','search','rule-search','rule-origin','category-origin']) {
    $('#'+id).oninput = () => {ledgerLimit=100; navigate();};
  }
  // Os recortes vindos do relatório dependem do mês; ao ver todos os meses, volta à lista completa.
  $('#ledger-period').oninput = () => {
    ledgerLimit = 100;
    if (ledgerScope && allMonths()) location.hash = 'transacoes';
    else navigate();
  };
  const dialog = $('#apply-dialog'), apply = $('#apply-rules'), confirmApply = $('#confirm-apply');
  let preview, previewTicket = 0;
  // A prévia lista o que muda; a confirmação envia a assinatura dela para aplicar exatamente isso.
  apply.onclick = async () => {
    const ticket = ++previewTicket;
    preview = null;
    confirmApply.disabled = true;
    confirmApply.textContent = 'Confirmar e aplicar';
    $('#apply-summary').textContent = 'Calculando quais lançamentos mudam de categoria…';
    $('#apply-preview').replaceChildren();
    dialog.showModal();
    try {
      const result = await request('rules/preview');
      if (ticket !== previewTicket || !dialog.open) return;
      preview = result;
      const count = result.changes.length;
      $('#apply-summary').textContent = count ? count+' de '+result.total+' lançamentos mudam de categoria:' :
        'Nenhum lançamento muda de categoria agora. Ao aplicar, mudanças futuras nas regras também passam a valer para o histórico.';
      const accounts = new Map(data.accounts.map(a => [a.id,accountName(a)]));
      const value = t => hiddenAmounts ? '••••' : (t.amount/100).toLocaleString('pt-BR',{style:'currency',currency:t.currency || currency.value});
      if (count) $('#apply-preview').replaceChildren(table(['Data','Descrição','Conta','Valor','Categoria atual','Nova categoria'],
        result.changes.map(t => [formatDate(t.date),t.description,accounts.get(t.account) || '—',value(t),categoryLabel(t.from),categoryLabel(t.to)]),''));
      confirmApply.textContent = count ? 'Confirmar e aplicar '+count+' alteraç'+(count > 1 ? 'ões' : 'ão') : 'Confirmar e aplicar';
      confirmApply.disabled = false;
    } catch (error) {
      if (ticket === previewTicket) $('#apply-summary').textContent = error.message;
    }
  };
  $('#cancel-apply').onclick = () => dialog.close();
  dialog.onclose = () => { previewTicket++; };
  confirmApply.onclick = async () => {
    if (!preview) return;
    const {token} = preview;
    dialog.close();
    apply.disabled = true;
    notify('Reavaliando lançamentos…');
    try {
      const { total, changed } = await request('rules/apply', {confirmed:true,token});
      await refresh();
      notify(`Histórico reavaliado. Lançamentos: ${total}. Categorias alteradas: ${changed}.`);
    } catch (error) { notify(error.message); }
    finally { apply.disabled = false; }
  };
  $('#rules-import').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const payload = JSON.parse(await form.elements.file.files[0].text());
      const applyExisting = form.elements.applyExisting.checked;
      await request('rules/import',{...payload,applyExisting});
      form.reset();
      await refresh();
      notify(applyExisting ? 'Regras importadas e histórico reavaliado.' : 'Regras importadas para novos lançamentos.');
    } catch (error) { notify(error instanceof SyntaxError ? 'O arquivo contém JSON inválido.' : error.message); }
  };
  $('#category-form').onsubmit = e => {
    e.preventDefault(); const form = e.currentTarget;
    save('/categories',{name:form.elements.name.value,color:form.elements.color.value,internal:form.elements.internal.checked},form);
  };
  $('#new-rule').onclick = () => editRule();
  const walletForm = $('#wallet-form');
  const walletDate = walletForm.elements.date;
  walletDate.value = new Date().toLocaleDateString('en-CA');
  let draftId;
  walletForm.oninput = () => { draftId = null; };
  walletForm.onsubmit = async event => {
    event.preventDefault();
    const {operation,amount,date,description} = walletForm.elements;
    const outgoing = ['remove','expense'].includes(operation.value);
    const kind = ['add','remove'].includes(operation.value) ? 'adjustment' : operation.value;
    const submit = walletForm.querySelector('button');
    submit.disabled = true;
    try {
      draftId ||= 'wallet-'+crypto.randomUUID();
      await request('wallet',{id:draftId,currency:currency.value,kind,date:date.value,
        amount:Math.round(Number(amount.value)*100)*(outgoing ? -1 : 1),
        description:description.value.trim() || operation.selectedOptions[0].textContent});
      month.value = date.value.slice(0,7);
      draftId = null; amount.value = description.value = '';
      await refresh(); notify('Movimentação registrada.');
    } catch (error) { notify(error.message); }
    finally { submit.disabled = false; }
  };
  refresh().catch(e => notify(e.message));
  setInterval(async () => {
    if (document.hidden || !data || document.querySelector('dialog[open]')) return;
    try {
      const {updated} = await request('status');
      if (updated && data.sources.every(s => s.updated < updated)) await refresh();
    } catch { /* The displayed local copy remains available while the server reconnects. */ }
  },60_000);
}
