import { initializeFinance, navigate } from './finance.js';
import { openFinance } from './local-finance.mjs';
import { createCipher, decryptVault, maxBackupSize, vaultStorage } from './vault-web.mjs';

const $ = selector => document.querySelector(selector);
const say = text => { $('#message').textContent = text; };
const form = $('#unlock-form');
const unlockError = $('#unlock-error');
const backupName = () => 'moneta-web-'+new Date().toISOString().slice(0,10)+'.monetaweb';
let queue = Promise.resolve();
let session;

async function request(path,body) {
  const task = queue.then(async () => {
    if (!session) throw Error('Abra o cofre.');
    if (!body) return session.finance.read(path);
    const {SQL,finance,encrypt,store} = session;
    const before = finance.snapshot();
    try {
      const result = finance.edit(path,body);
      session.saved = await store.save(await encrypt(finance.snapshot()),session.saved.revision);
      return result;
    } catch (error) {
      session.finance = openFinance(SQL,before);
      finance.close();
      throw error;
    }
  });
  queue = task.catch(() => {});
  return task;
}

async function readBackup(file) {
  if (file.size > maxBackupSize) throw Error('O arquivo de backup excede 64 MB.');
  return new Uint8Array(await file.arrayBuffer());
}

async function prepare() {
  if (!crypto.subtle || !('serviceWorker' in navigator)) throw Error('Abra a Moneta em um endereço HTTPS no Safari.');
  const [store,SQL] = await Promise.all([
    vaultStorage(),
    globalThis.initSqlJs({locateFile: name => new URL(name,import.meta.url).href}),
  ]);
  const saved = await store.read();
  const {password,repeat,backup} = form.elements;
  const button = form.querySelector('button');
  $('#web-intro').textContent = saved ? 'Digite sua senha para abrir o cofre deste aparelho.' :
    'Crie uma senha para guardar os lançamentos neste aparelho ou restaure um backup.';
  password.autocomplete = saved ? 'current-password' : 'new-password';
  $('#web-import').hidden = Boolean(saved);
  function reflect() {
    const creating = !saved && !backup.files.length;
    $('#web-repeat').hidden = !creating;
    repeat.disabled = !creating;
    repeat.required = creating;
    button.textContent = saved ? 'Abrir cofre' : creating ? 'Criar cofre' : 'Restaurar backup';
  }
  backup.onchange = reflect;
  reflect();
  password.disabled = button.disabled = false;
  form.onsubmit = async event => {
    event.preventDefault();
    button.disabled = true;
    unlockError.textContent = '';
    let finance;
    try {
      const file = backup.files[0];
      let record = saved;
      let encrypt;
      if (record || file) {
        const data = await decryptVault(password.value,record?.bytes || await readBackup(file));
        finance = openFinance(SQL,data.bytes); encrypt = data.encrypt;
        if (!record) record = await store.save(await encrypt(finance.snapshot()));
      } else {
        if (password.value !== repeat.value) throw Error('As senhas precisam ser iguais.');
        finance = openFinance(SQL);
        encrypt = await createCipher(password.value);
        record = await store.save(await encrypt(finance.snapshot()));
      }
      session = {SQL,finance,encrypt,store,saved:record};
      form.reset();
      $('#unlock').hidden = true;
      for (const element of document.querySelectorAll('aside, main')) element.inert = false;
      window.addEventListener('hashchange',navigate);
      initializeFinance(request,say);
      navigate();
      navigator.storage?.persist?.().catch(() => {});
    } catch (error) {
      finance?.close();
      unlockError.textContent = error.message;
    } finally { button.disabled = false; }
  };
}

$('#web-lock').onclick = () => location.reload();
$('#web-backup').onclick = async () => {
  try {
    await queue;
    const url = URL.createObjectURL(new Blob([session.saved.bytes],{type:'application/octet-stream'}));
    const link = document.createElement('a');
    link.href = url; link.download = backupName();
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url),60000);
  } catch (error) { say(error.message); }
};
$('#web-restore').onsubmit = async event => {
  event.preventDefault();
  const target = event.currentTarget;
  const button = target.querySelector('button');
  if (!confirm('Substituir o cofre deste aparelho pelo backup? A senha passará a ser a do backup.')) return;
  button.disabled = true;
  const restore = queue.then(async () => {
    const {backup,password} = target.elements;
    const {SQL,store,saved} = session;
    const {bytes,encrypt} = await decryptVault(password.value,await readBackup(backup.files[0]));
    const finance = openFinance(SQL,bytes);
    try { await store.save(await encrypt(finance.snapshot()),saved.revision); }
    finally { finance.close(); }
    location.reload();
  });
  queue = restore.catch(() => {});
  try { await restore; }
  catch (error) { say(error.message); }
  finally { button.disabled = false; target.elements.password.value = ''; }
};

prepare().catch(error => { unlockError.textContent = error.message; });
async function prepareOffline() {
  const indicator = $('#app-version');
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    indicator.textContent = 'Disponível offline';
  } catch { indicator.textContent = 'Acesso offline indisponível'; }
}
void prepareOffline();
