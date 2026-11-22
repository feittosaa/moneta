// Mostra os guias oficiais dentro do app, um por aba: conectar bancos (docs/guia/conectar-bancos.md)
// e celular e tablet (docs/guia-celular.md). Lê só o subconjunto de Markdown que os guias usam e
// monta o DOM sem innerHTML.
// Relativo à página: /guia/ no computador e no Android, ./guia/ na Moneta Web.
const base = 'guia/';
const guides = { bancos:'conectar-bancos.md', celular:'celular.md' };
const docs = 'https://github.com/feittosaa/moneta/blob/main/docs/';
// Aba sendo montada: os links para seções apontam para a mesma aba.
let tab = 'bancos';
const guideLink = (name, section) => '#guia' + (name === 'bancos' && !section ? '' :
  '?' + new URLSearchParams({ ...(name !== 'bancos' && { aba:name }), ...(section && { secao:section }) }));
// Links relativos do Markdown: os outros guias viram abas; os demais documentos abrem no GitHub.
function relative(href) {
  const [file, section] = href.split('#');
  if (/(^|\/)conectar-bancos\.md$/.test(file)) return guideLink('bancos', section);
  if (/(^|\/)guia-celular\.md$/.test(file)) return guideLink('celular', section);
  return /^[a-z0-9/-]+\.md$/.test(file) ? new URL(file + (section ? '#' + section : ''), docs).href : null;
}
// Quadros interativos que o app encaixa no guia, marcados no Markdown com <!-- moneta:nome -->.
// No GitHub o comentário não aparece; aqui ele vira o quadro registrado com esse nome.
const widgets = new Map();
export function registerGuideWidget(name, build) { widgets.set(name, build); }
const slug = text => text.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

function inline(text) {
  const nodes = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) nodes.push(document.createTextNode(text.slice(last, match.index)));
    const [, bold, code, label, href] = match;
    let node;
    if (bold != null) { node = document.createElement('strong'); node.append(...inline(bold)); }
    else if (code != null) { node = document.createElement('code'); node.textContent = code; }
    else {
      node = document.createElement('a');
      node.append(...inline(label));
      const target = href.startsWith('#') ? guideLink(tab, href.slice(1)) : /^https:\/\//.test(href) ? href : relative(href) || '#guia';
      node.href = target;
      if (/^https:\/\//.test(target)) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
    }
    nodes.push(node);
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

export function renderMarkdown(source) {
  const root = document.createDocumentFragment();
  const lines = source.replace(/\r/g,'').split('\n');
  let list = null, quote = null, paragraph = null;
  const close = () => { list = quote = paragraph = null; };
  for (const line of lines) {
    if (!line.trim()) { close(); continue; }
    const comment = /^<!--\s*(?:moneta:([a-z-]+))?.*-->$/.exec(line.trim());
    if (comment) {
      close();
      const widget = comment[1] && widgets.get(comment[1]);
      if (widget) root.append(widget());
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const image = /^!\[([^\]]*)\]\(([a-z0-9-]+\.(?:svg|png))\)$/.exec(line.trim());
    const item = /^\s*(?:(\d+)\.|-)\s+(.*)$/.exec(line);
    const quoted = /^>\s?(.*)$/.exec(line);
    if (heading) {
      close();
      // O título principal já aparece no topo da página do app.
      if (heading[1].length === 1) continue;
      const h = document.createElement('h' + heading[1].length);
      h.append(...inline(heading[2]));
      h.id = 'guia-' + slug(heading[2]);
      root.append(h);
    } else if (image) {
      close();
      const figure = document.createElement('figure'), img = document.createElement('img');
      img.src = base + image[2]; img.alt = image[1]; img.loading = 'lazy';
      figure.append(img);
      root.append(figure);
    } else if (quoted) {
      list = paragraph = null;
      if (!quote) { quote = document.createElement('div'); quote.className = 'guide-note'; root.append(quote); quote.append(document.createElement('p')); }
      const p = quote.lastElementChild;
      if (p.childNodes.length) p.append(' ');
      p.append(...inline(quoted[1]));
    } else if (item) {
      quote = paragraph = null;
      const tag = item[1] ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = document.createElement(tag);
        if (item[1] && item[1] !== '1') list.start = Number(item[1]);
        root.append(list);
      }
      const li = document.createElement('li');
      li.append(...inline(item[2]));
      list.append(li);
    } else if (list && /^\s+\S/.test(line)) {
      list.lastElementChild.append(' ', ...inline(line.trim()));
    } else {
      list = quote = null;
      if (!paragraph) { paragraph = document.createElement('p'); root.append(paragraph); }
      else paragraph.append(' ');
      paragraph.append(...inline(line.trim()));
    }
  }
  return root;
}

// Cada aba guarda a própria leitura do Markdown; um erro libera a aba para tentar de novo.
const loaded = new Map();
function load(name) {
  if (!loaded.has(name)) loaded.set(name, fetch(base + guides[name]).then(response => {
    if (!response.ok) throw new Error('Não foi possível abrir o guia.');
    return response.text();
  }).catch(error => { loaded.delete(name); throw error; }));
  return loaded.get(name);
}
let shown, wanted;
export async function showGuide(container, section, name = 'bancos') {
  if (!guides[name]) name = 'bancos';
  wanted = name;
  for (const button of document.querySelectorAll('[data-guide]')) {
    button.setAttribute('aria-pressed', String(button.dataset.guide === name));
    button.onclick = () => { location.hash = guideLink(button.dataset.guide); };
  }
  if (shown !== name) {
    try {
      const text = await load(name);
      // Outra aba foi escolhida enquanto esta carregava.
      if (wanted !== name) return;
      tab = name;
      container.replaceChildren(renderMarkdown(text));
      shown = name;
      if (!section) scrollTo({ top: 0 });
    } catch (error) {
      if (wanted !== name) return;
      shown = null;
      const p = document.createElement('p');
      p.textContent = error.message;
      container.replaceChildren(p);
      return;
    }
  }
  if (section) container.querySelector('#guia-' + CSS.escape(section))?.scrollIntoView({ block: 'start' });
}
