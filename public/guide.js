// Mostra o guia oficial (docs/guia/conectar-bancos.md) dentro do app.
// Lê só o subconjunto de Markdown que o guia usa e monta o DOM sem innerHTML.
const base = '/guia/';
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
      if (/^https:\/\//.test(href)) { node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
      else if (href.startsWith('#')) node.href = '#guia?secao=' + href.slice(1);
      else node.href = '#guia';
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

let loaded;
export async function showGuide(container, section) {
  loaded ||= fetch(base + 'conectar-bancos.md').then(response => {
    if (!response.ok) throw new Error('Não foi possível abrir o guia.');
    return response.text();
  }).then(text => { container.replaceChildren(renderMarkdown(text)); }).catch(error => {
    loaded = null;
    const p = document.createElement('p');
    p.textContent = error.message;
    container.replaceChildren(p);
  });
  await loaded;
  if (section) container.querySelector('#guia-' + CSS.escape(section))?.scrollIntoView({ block: 'start' });
}
