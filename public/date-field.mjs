// Campos de data no padrão brasileiro (dd/mm/aaaa e mm/aaaa), independentes do idioma do navegador.
// O campo original continua guardando o valor ISO que o resto do app lê e escreve; um campo de texto
// mostra e recebe a data no formato local, e um botão abre o calendário nativo quando ele existe.
const parts = {date:[2,2,4], month:[2,4]};
const examples = {date:'dd/mm/aaaa', month:'mm/aaaa'};
const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');

export function toLocal(value, kind) {
  const match = kind === 'month' ? /^(\d{4})-(\d{2})$/.exec(value) : /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? match.slice(1).reverse().join('/') : '';
}

export function toIso(text, kind) {
  const digits = text.replace(/\D/g,'');
  if (digits.length !== parts[kind].reduce((a,b) => a+b)) return null;
  const day = kind === 'date' ? Number(digits.slice(0,2)) : 1;
  const month = Number(kind === 'date' ? digits.slice(2,4) : digits.slice(0,2));
  const year = Number(digits.slice(-4));
  const date = new Date(Date.UTC(year,month-1,day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month-1 || date.getUTCDate() !== day) return null;
  return digits.slice(-4)+'-'+String(month).padStart(2,'0')+(kind === 'date' ? '-'+String(day).padStart(2,'0') : '');
}

// Coloca as barras enquanto a pessoa digita só os números.
function mask(text, kind) {
  let digits = text.replace(/\D/g,''), out = '';
  for (const [index,size] of parts[kind].entries()) {
    if (!digits) break;
    out += (index ? '/' : '')+digits.slice(0,size);
    digits = digits.slice(size);
  }
  return out;
}

export function localDateField(input, kind = 'date') {
  const text = document.createElement('input');
  text.type = 'text';
  text.inputMode = 'numeric';
  text.autocomplete = 'off';
  text.placeholder = examples[kind];
  text.maxLength = examples[kind].length;
  text.required = input.required;
  if (input.getAttribute('aria-label')) text.setAttribute('aria-label',input.getAttribute('aria-label'));
  input.required = false;
  const wrap = document.createElement('span');
  wrap.className = 'date-field';
  input.before(wrap);
  wrap.append(text);
  const show = () => { text.value = toLocal(native.get.call(input),kind); text.setCustomValidity(''); };
  // Escritas feitas pelo código (input.value = ...) também atualizam o texto.
  Object.defineProperty(input,'value',{configurable:true,get() { return native.get.call(this); },set(value) { native.set.call(this,value); show(); }});
  if (kind === 'month') input.type = 'hidden';
  else {
    input.tabIndex = -1;
    input.setAttribute('aria-hidden','true');
    const picker = document.createElement('button');
    picker.type = 'button';
    picker.className = 'date-picker';
    picker.title = 'Abrir calendário';
    picker.setAttribute('aria-label','Abrir calendário');
    picker.innerHTML = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
    picker.hidden = typeof input.showPicker !== 'function';
    picker.onclick = () => { try { input.showPicker(); } catch { text.focus(); } };
    wrap.append(picker);
  }
  wrap.append(input);
  const publish = value => {
    native.set.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  };
  text.addEventListener('input',event => {
    if (event.inputType?.startsWith('insert')) text.value = mask(text.value,kind);
    const iso = toIso(text.value,kind);
    if (iso) { text.setCustomValidity(''); if (iso !== native.get.call(input)) publish(iso); }
    else if (!text.value.trim() && kind === 'date') { text.setCustomValidity(''); if (native.get.call(input)) publish(''); }
    else text.setCustomValidity('Use o formato '+examples[kind]+'.');
  });
  // O mês nunca fica vazio: ao sair do campo incompleto, volta ao mês selecionado.
  text.addEventListener('blur',() => { if (kind === 'month' && !toIso(text.value,kind)) show(); });
  input.addEventListener('input',show);
  input.addEventListener('change',show);
  input.form?.addEventListener('reset',() => setTimeout(show));
  show();
  return text;
}
