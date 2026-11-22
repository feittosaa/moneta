import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(web, '..');
const out = resolve(process.argv[2] || join(root, 'dist/web'));
await mkdir(out, {recursive:true});
const assets = new Map();
async function emit(name, data) {
  assets.set(name, data);
  await writeFile(join(out,name),data);
}
const read = location => readFile(join(root,location),'utf8');
function replace(source, pattern, value) {
  if (!source.match(pattern)) throw Error('Trecho ausente no build web: '+pattern);
  return source.replace(pattern,() => value);
}

let html = await read('public/index.html');
html = replace(html,/<h2>Credenciais Pluggy<\/h2>[\s\S]*?<\/section>/,await read('web/settings.html'));
html = replace(html,/<dialog id="peer-qr-dialog"[\s\S]*?<\/dialog>/,'');
html = replace(html,/<div id="recovery" hidden>[\s\S]*?<\/body>/,await read('web/unlock.html'));
html = replace(html,/<title>/,`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.pluggy.ai; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.pluggy.ai; connect-src 'self' https:; frame-src https://*.pluggy.ai; object-src 'none'; base-uri 'none'; form-action 'none'"><title>`);
html = html.replace(/((?:src|href)=")\//g,'$1./');
html = html.replace('Verificando atualizações…','Preparando acesso offline…');
html = html.replace('<button id="sync" disabled>','<button id="sync" hidden disabled>');
html = html.replace('<aside>','<aside inert>').replace('<main>','<main inert>');
await emit('index.html',html);
let manifest = JSON.parse(await read('public/site.webmanifest'));
for (const icon of manifest.icons) {
  icon.src = '.'+icon.src;
  icon.purpose = 'any maskable';
}
await emit('site.webmanifest',JSON.stringify({...manifest,id:'./',scope:'./',start_url:'./'},null,2));
await mkdir(join(out,'fonts'),{recursive:true});
await emit('style.css',(await read('public/style.css')).replace('url(/fonts/','url(./fonts/'));
for (const file of ['theme.js','finance.js','drawer.mjs','appearance.mjs','portfolio.js','date-field.mjs','card-periods.mjs','movement.mjs','report.mjs',
  'logo.png','favicon.svg','favicon.ico','favicon-96x96.png','apple-touch-icon.png','web-app-manifest-192x192.png',
  'web-app-manifest-512x512.png','fonts/GoudyBookletter1911.ttf','fonts/OFL.txt']) {
  await emit(file,await readFile(join(root,'public',file)));
}
// Os guias vão junto e ficam disponíveis offline, como no computador e no Android.
await emit('guide.js',await read('public/guide.js'));
await mkdir(join(out,'guia'),{recursive:true});
for (const name of await readdir(join(root,'docs/guia'))) await emit('guia/'+name,await readFile(join(root,'docs/guia',name)));
await emit('guia/celular.md',await read('docs/guia-celular.md'));
const finance = replace(await read('finance.mjs'),"'node:crypto'","'./browser-crypto.mjs'")
  .replace("'./public/movement.mjs'","'./movement.mjs'");
await emit('finance.mjs',finance);
await emit('peer-data.mjs',replace(await read('peer-data.mjs'),"'node:crypto'","'./browser-crypto.mjs'"));
await mkdir(join(out,'vendor'),{recursive:true});
for (const name of ['jsQR.js','jsQR.LICENSE']) await emit('vendor/'+name,await read('public/vendor/'+name));
let rules = replace(await read('category-rules.mjs'),"import { readFileSync } from 'node:fs';",'');
rules = replace(rules,/const defaults = .*;\n/,'const defaults = '+JSON.stringify(JSON.parse(await read('default-rules.json')))+';\n');
await emit('category-rules.mjs',rules);
for (const name of ['browser-crypto.mjs','local-finance.mjs','vault-web.mjs','web-app.mjs','peer-client.mjs','web-pairing.mjs','web-pluggy.mjs','web-connections.mjs','web-biometric.mjs']) await emit(name,await read('web/'+name));
for (const name of ['sql-wasm-browser.js','sql-wasm-browser.wasm']) await emit(name,await readFile(join(web,'node_modules/sql.js/dist',name)));
await emit('sql.js.LICENSE',await read('web/node_modules/sql.js/LICENSE'));
const noble = join(web,'node_modules/@noble/hashes');
await mkdir(join(out,'hashes'),{recursive:true});
await cp(join(noble,'LICENSE'),join(out,'hashes/LICENSE'));
const modules = ['sha256.js','sha2.js','_md.js','utils.js','_u64.js','crypto.js'];
for (const name of modules) {
  const code = (await readFile(join(noble,'esm',name),'utf8')).replaceAll('@noble/hashes/crypto','./crypto.js');
  await emit('hashes/'+name,code);
}
const hash = createHash('sha256').update(await read('web/sw.js'));
for (const [name,data] of assets) hash.update(name).update(data);
await emit('sw.js',(await read('web/sw.js'))
  .replace('BUILD_VERSION',hash.digest('hex').slice(0,24))
  .replace('BUILD_ASSETS',JSON.stringify([...assets.keys()])));
await writeFile(join(out,'.nojekyll'),'');
console.log('Moneta Web disponível em '+out);
