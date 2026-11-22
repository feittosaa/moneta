import { portfolio } from './report.mjs';

const $ = selector => document.querySelector(selector);
function element(tag,text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}
// Cores do gráfico vêm do tema ativo (variáveis CSS), para servir no escuro e no claro.
const themeColor = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// Todos os investimentos aparecem no gráfico; guarda só os que a pessoa desmarcou.
const hiddenInvestments = new Set();
const localDay = () => new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
const dateLabel = day => day.split('-').reverse().join('/');

function historyPoints(history,transactions,currency,from,to) {
  const snapshots = new Map(), points = [];
  const wallet = transactions.filter(t => t.account === 'wallet-'+currency);
  const days = new Map();
  for (const record of history) {
    if (!days.has(record.day)) days.set(record.day,[]);
    days.get(record.day).push(record);
  }
  for (const t of wallet) if (!days.has(t.date)) days.set(t.date,[]);
  for (const day of [...days.keys()].sort()) {
    for (const record of days.get(day)) snapshots.set(record.item,record);
    if (day < from || day > to) continue;
    const records = [...snapshots.values()];
    const accounts = records.flatMap(record => record.accounts);
    const holdings = records.flatMap(record => record.holdings).filter(h => h.currency === currency);
    const cash = wallet.filter(t => t.date <= day);
    if (!holdings.length && !accounts.some(a => a.currency === currency) && !cash.length) continue;
    if (cash.length) accounts.push({type:'CASH',currency,auto:0,balance:cash.reduce((sum,t) => sum+t.amount,0)});
    points.push({day,holdings,...portfolio({accounts,holdings},currency)});
  }
  return points;
}

export function renderPortfolio(history,transactions,currency,target,money) {
  const colors = themeColor('--chart-palette').split(',').map(c => c.trim());
  const today = localDay(), now = today.slice(0,4);
  const year = $('#portfolio-year'), from = $('#portfolio-from'), to = $('#portfolio-to');
  const previous = year.value;
  const years = new Set([now,...history.map(row => row.day.slice(0,4)),...transactions.filter(t => t.account === 'wallet-'+currency).map(t => t.date.slice(0,4))]);
  year.replaceChildren(...[...years].sort().reverse().map(y => new Option(y,y)));
  year.value = years.has(previous) ? previous : now;
  from.value ||= now+'-01-01';
  to.value ||= today;
  const custom = $('#portfolio-range').value === 'custom';
  $('#portfolio-year-label').hidden = custom;
  document.querySelectorAll('.portfolio-custom').forEach(field => { field.hidden = !custom; });
  const start = custom ? from.value : year.value+'-01-01';
  const end = custom ? to.value : year.value+'-12-31';
  target.replaceChildren();
  if (!start || !end || start > end) { target.textContent = 'Selecione um intervalo válido.'; return; }
  const points = historyPoints(history,transactions,currency,start,end);
  if (!points.length) { target.textContent = 'Nenhuma posição registrada nessa moeda e nesse período.'; return; }

  const panel = element('div'), canvas = element('canvas'), detail = element('output');
  panel.className = 'panel portfolio-chart';
  canvas.setAttribute('aria-label','Evolução do patrimônio e dos investimentos');
  canvas.setAttribute('role','img');
  const slider = element('input');
  slider.type = 'range'; slider.min = 0; slider.max = points.length-1;
  slider.value = points.length-1;
  slider.setAttribute('aria-label','Consultar valores em uma data do gráfico');
  slider.hidden = points.length < 2;
  const chartHeading = element('h2','Evolução do patrimônio');
  panel.append(chartHeading,canvas,slider,detail);
  if (points.at(-1).holdings.some(h => h.stale)) {
    panel.append(element('p','A posição mais recente inclui investimentos com o último saldo conhecido.'));
  }
  if (points.length === 1) panel.append(element('p','Há uma posição registrada neste período. A linha aparecerá quando houver mais registros.'));
  const list = element('div');
  list.className = 'panel portfolio-investments';
  list.append(element('h2','Investimentos no período'));
  const investments = new Map();
  for (const point of points) for (const holding of point.holdings) investments.set(holding.id,holding);
  const latest = new Map(points.at(-1).holdings.map(h => [h.id,h]));
  const added = [];
  for (const holding of investments.values()) {
    const current = latest.get(holding.id);
    const line = element('label'), checkbox = element('input');
    const color = colors[added.length % colors.length];
    const key = currency+'-'+holding.id;
    checkbox.type = 'checkbox'; checkbox.checked = !hiddenInvestments.has(key);
    checkbox.style.accentColor = color;
    line.title = current?.stale ? 'Último saldo conhecido'+(current.lastSeen ? ' em '+dateLabel(current.lastSeen.slice(0,10)) : '') : 'Mostrar ou ocultar este investimento no gráfico';
    line.append(checkbox,element('span',holding.name),element('strong',current ? money(current.net)+(current.stale ? ' · Último saldo conhecido' : '') : 'Fora da última posição'));
    list.append(line);
    added.push({key,holding,color,checkbox});
    checkbox.onchange = () => {
      if (checkbox.checked) hiddenInvestments.delete(key);
      else hiddenInvestments.add(key);
      draw();
    };
  }
  if (!added.length) list.append(element('p','Nenhum investimento registrado no período.'));
  target.append(panel,list);
  // O desenho acompanha a largura real do painel, em pixels de tela: sem esticar nem encolher.
  // Assim fica nítido no computador e legível no celular, e se ajusta quando a janela muda.
  const ctx = canvas.getContext('2d');
  let W, H, narrow, left, width;
  const top = 16;
  let height;
  function size() {
    W = Math.max(280,Math.round(canvas.clientWidth || panel.clientWidth || 980));
    narrow = W < 600;
    H = narrow ? 250 : Math.min(360,Math.max(280,Math.round(W*.3)));
    const ratio = Math.min(devicePixelRatio || 1,3);
    canvas.width = Math.round(W*ratio); canvas.height = Math.round(H*ratio);
    ctx.setTransform(ratio,0,0,ratio,0,0);
    left = narrow ? 8 : 24; width = W-2*left; height = H-60;
  }
  const first = Date.parse(points[0].day), duration = Date.parse(points.at(-1).day)-first;
  const x = point => duration ? left+width*(Date.parse(point.day)-first)/duration : left+width/2;
  function draw() {
    const series = [
      {name:'Patrimônio líquido',color:themeColor('--chart-net'),values:points.map(p => p.net)},
      {name:'Investimentos líquidos',color:themeColor('--positive'),values:points.map(p => p.invested)},
      ...added.filter(a => a.checkbox.checked).map(({holding,color}) => ({name:holding.name,color,
        values:points.map(p => p.holdings.find(h => h.id === holding.id)?.net)})),
    ];
    const values = series.flatMap(s => s.values).filter(Number.isFinite);
    const min = values.reduce((low,n) => Math.min(low,n),0);
    const max = values.reduce((high,n) => Math.max(high,n),min+1);
    const y = value => top + height*(1-(value-min)/(max-min));
    const index = Number(slider.value);
    ctx.clearRect(0,0,W,H);
    ctx.strokeStyle = themeColor('--chart-grid');
    ctx.lineWidth = 1;
    for (let i=0; i<=4; i++) {
      const tick = top+height*i/4;
      ctx.beginPath(); ctx.moveTo(left,tick); ctx.lineTo(left+width,tick); ctx.stroke();
    }
    ctx.fillStyle = themeColor('--muted');
    ctx.font = (narrow ? 12 : 14)+'px system-ui';
    // Com uma só posição, a data já aparece na legenda abaixo do gráfico.
    if (duration) {
      const base = H-18;
      ctx.fillText(dateLabel(points[0].day),left,base);
      const last = dateLabel(points.at(-1).day);
      ctx.fillText(last,left+width-ctx.measureText(last).width,base);
    }
    ctx.beginPath(); ctx.moveTo(x(points[index]),top); ctx.lineTo(x(points[index]),top+height); ctx.stroke();
    for (const s of series) {
      ctx.beginPath(); ctx.strokeStyle = s.color; ctx.lineWidth = 2.5;
      let started = false;
      s.values.forEach((value,i) => {
        if (!Number.isFinite(value)) { started = false; return; }
        if (started) ctx.lineTo(x(points[i]),y(value));
        else ctx.moveTo(x(points[i]),y(value));
        started = true;
      });
      ctx.stroke();
      if (!Number.isFinite(s.values[index])) continue;
      ctx.beginPath(); ctx.fillStyle = s.color;
      ctx.arc(x(points[index]),y(s.values[index]),4,0,Math.PI*2); ctx.fill();
    }
    detail.replaceChildren(element('strong',dateLabel(points[index].day)));
    for (const s of series) {
      const label = element('span',s.name+' · '+money(s.values[index]));
      label.style.setProperty('--series-color',s.color);
      detail.append(label);
    }
  }
  canvas.onpointermove = canvas.onclick = event => {
    const bounds = canvas.getBoundingClientRect();
    const cursor = (event.clientX-bounds.left)*W/bounds.width;
    let closest = 0;
    for (let i=1; i<points.length; i++) if (Math.abs(x(points[i])-cursor) < Math.abs(x(points[closest])-cursor)) closest = i;
    if (Number(slider.value) !== closest) { slider.value = closest; draw(); }
  };
  slider.oninput = draw;
  size(); draw();
  let last = W;
  const observer = new ResizeObserver(() => {
    if (!canvas.isConnected) { observer.disconnect(); return; }
    if (Math.round(canvas.clientWidth) === last) return;
    size(); last = W; draw();
  });
  observer.observe(panel);
}
