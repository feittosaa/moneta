import { initializeFinance, navigate, refresh } from './finance.js';
import { openFinance } from './local-finance.mjs';
import { createCipher, decryptVault, maxBackupSize, vaultStorage } from './vault-web.mjs';

import { setupPairing } from './web-pairing.mjs';
import { createPluggy } from './web-pluggy.mjs';
import { setupConnections } from './web-connections.mjs';
import { biometricPassword, biometricSupported, deviceLabel, enrollBiometric } from './web-biometric.mjs';

const $ = selector => document.querySelector(selector);
const say = text => { $('#message').textContent = text; };
const form = $('#unlock-form');
const unlockError = $('#unlock-error');
const backupName = () => 'moneta-web-'+new Date().toISOString().slice(0,10)+'.monetaweb';
let queue = Promise.resolve();
let session, pluggy, connections;
const localData = ['peers','pluggy','profile'];

const plain = bytes => bytes;
function enqueue(operation) {
  const task = queue.then(operation);
  queue = task.catch(() => {});
  return task;
}

function writeLocal(operation) {
  return enqueue(async () => {
    const {SQL,finance,encrypt,store,saved} = session;
    const before = finance.snapshot();
    const count = finance.changes();
    try {
      const result = await operation(finance);
      // Marca a hora de cada alteração para a sincronização entre aparelhos.
      finance.track();
      if (finance.changes() === count) return result;
      const after = finance.snapshot();
      session.saved = await store.save(await encrypt(after),saved.revision,settings(saved));
      return result;
    } catch (error) {
      session.finance = openFinance(SQL,before);
      finance.close();
      throw error;
    }
  });
}
async function request(path,body) {
  if (pluggy.handles(path)) return pluggy.call(path,body);
  if (!body) return enqueue(() => session.finance.read(path));
  return writeLocal(finance => finance.edit(path,body));
}
function startSync() {
  setupPairing(() => session.finance, writeLocal, refresh);
  const update = async () => { if (await pluggy.maybeSync()) { await refresh(); await connections.refresh(); } };
  void update();
  setInterval(() => { if (!document.hidden) void update(); },60000);
}

async function readBackup(file) {
  if (file.size > maxBackupSize) throw Error('O arquivo de backup excede 64 MB.');
  return new Uint8Array(await file.arrayBuffer());
}

const settings = ({unlocked = false} = {}) => ({unlocked});

function reflectMode() {
  const {unlocked} = session.saved;
  $('#web-vault-status').textContent = unlocked ? 'Modo cofre desativado. Qualquer pessoa com acesso a este app pode ver seus lançamentos.' :
    'Modo cofre ativado. A senha protege os lançamentos neste aparelho.';
  const mode = $('#web-mode');
  mode.elements.password.autocomplete = unlocked ? 'new-password' : 'current-password';
  mode.elements.repeat.disabled = !unlocked;
  mode.elements.repeat.required = Boolean(unlocked);
  $('#web-mode-repeat').hidden = !unlocked;
  mode.querySelector('button').textContent = unlocked ? 'Ativar modo cofre' : 'Desativar modo cofre';
  $('#web-lock').hidden = Boolean(unlocked);
  $('#web-backup-password').hidden = !unlocked;
  $('#web-backup').elements.password.disabled = !unlocked;
  $('#web-backup').elements.password.required = Boolean(unlocked);
  void reflectBiometric();
}

async function reflectBiometric() {
  const box = $('#web-biometric-settings');
  const supported = !session.saved.unlocked && await biometricSupported();
  box.hidden = !supported;
  if (!supported) return;
  const enrolled = Boolean(await session.store.extra('biometric'));
  $('#web-biometric-title').textContent = 'Destravar com '+deviceLabel();
  $('#web-biometric-status').textContent = enrolled ?
    'Ativado. Ao abrir, toque em Usar '+deviceLabel()+'. A senha continua funcionando.' :
    'Abra o cofre com '+deviceLabel()+' em vez de digitar a senha. A senha fica cifrada neste aparelho e só abre depois da verificação.';
  $('#web-biometric-on').hidden = enrolled;
  $('#web-biometric-off').hidden = !enrolled;
}

function start(store,SQL,finance,encrypt,saved) {
  session = {SQL,finance,encrypt,store,saved};
  form.reset();
  $('#unlock').hidden = true;
  for (const element of document.querySelectorAll('aside, main')) element.inert = false;
  window.addEventListener('hashchange',navigate);
  pluggy = createPluggy({finance:() => session.finance,write:writeLocal,vaultOff:() => Boolean(session.saved.unlocked)});
  initializeFinance(request,say);
  connections = setupConnections(request,say,() => Boolean(session.saved.unlocked));
  navigate();
  reflectMode();
  void connections.refresh().catch(() => {});
  startSync();
  navigator.storage?.persist?.().catch(() => {});
}

async function prepare() {
  if (!crypto.subtle || !('serviceWorker' in navigator)) throw Error('Abra a Moneta em um endereço HTTPS no Safari.');
  const [store,SQL] = await Promise.all([
    vaultStorage(),
    globalThis.initSqlJs({locateFile: name => new URL(name,import.meta.url).href}),
  ]);
  const saved = await store.read();
  if (saved?.unlocked) return start(store,SQL,openFinance(SQL,saved.bytes),plain,saved);
  // No iOS, o Safari e o app da Tela de Início têm armazenamentos separados: o cofre criado
  // numa aba do Safari não aparece no app. Antes de criar o cofre, orienta a instalar.
  if (!saved && navigator.standalone === false && !sessionStorage.getItem('web-install-skip')) {
    form.hidden = true;
    $('#web-install').hidden = false;
    await new Promise(resolve => { $('#web-install-skip').onclick = resolve; });
    sessionStorage.setItem('web-install-skip','1');
    $('#web-install').hidden = true;
    form.hidden = false;
  }
  const {password,repeat,backup} = form.elements;
  const button = form.querySelector('button');
  const biometric = saved && !saved.unlocked && await biometricSupported() ? await store.extra('biometric') : null;
  const deviceButton = $('#web-biometric');
  let viaDevice = false;
  if (biometric) {
    deviceButton.textContent = 'Usar '+deviceLabel();
    deviceButton.hidden = false;
    deviceButton.onclick = async () => {
      if (button.disabled) return;
      unlockError.textContent = '';
      try {
        password.value = await biometricPassword(biometric);
        viaDevice = true;
        form.requestSubmit();
      } catch (error) {
        if (error.stale) { await store.setExtra('biometric',null); deviceButton.hidden = true; }
        if (!error.cancel) unlockError.textContent = error.message;
      }
    };
  }
  $('#web-intro').textContent = saved ? 'Digite sua senha para abrir o cofre deste aparelho.' :
    'Crie uma senha para guardar os lançamentos neste aparelho ou restaure um backup.';
  password.autocomplete = saved ? 'current-password' : 'new-password';
  $('#web-import').hidden = Boolean(saved);
  function reflect() {
    const creating = !saved && !backup.files.length;
    $('#web-repeat').hidden = !creating;
    repeat.disabled = !creating;
    repeat.required = creating;
    $('#web-skip-password').hidden = !creating;
    button.textContent = saved ? 'Abrir cofre' : creating ? 'Criar cofre' : 'Restaurar backup';
  }
  backup.onchange = reflect;
  reflect();
  password.disabled = button.disabled = false;
  $('#web-skip-password').onclick = async () => {
    const skip = $('#web-skip-password');
    if (button.disabled) return;
    skip.disabled = button.disabled = true;
    let finance;
    try {
      finance = openFinance(SQL);
      const record = await store.save(finance.snapshot(),undefined,{unlocked:true});
      start(store,SQL,finance,plain,record);
    } catch (error) {
      finance?.close();
      unlockError.textContent = error.message;
    } finally { skip.disabled = button.disabled = false; }
  };
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
        if (file) finance.stripLocal();
        if (!record) record = await store.save(await encrypt(finance.snapshot()));
      } else {
        if (password.value !== repeat.value) throw Error('As senhas precisam ser iguais.');
        finance = openFinance(SQL);
        encrypt = await createCipher(password.value);
        record = await store.save(await encrypt(finance.snapshot()));
      }
      start(store,SQL,finance,encrypt,record);
    } catch (error) {
      finance?.close();
      unlockError.textContent = error.message;
      // A senha guardada para a biometria não abre mais o cofre: apaga e volta para a senha.
      if (viaDevice) {
        await store.setExtra('biometric',null).catch(() => {});
        deviceButton.hidden = true;
        password.value = '';
        unlockError.textContent = 'A senha guardada no aparelho não vale mais. Digite a senha e ative o desbloqueio de novo em Configuração.';
      }
    } finally { button.disabled = false; viaDevice = false; }
  };
}

$('#web-lock').onclick = () => location.reload();
$('#web-biometric-on').onsubmit = async event => {
  event.preventDefault();
  const target = event.currentTarget;
  const button = target.querySelector('button');
  button.disabled = true;
  try {
    const secret = target.elements.password.value;
    await decryptVault(secret,session.saved.bytes);
    await session.store.setExtra('biometric',await enrollBiometric(secret));
    say('Desbloqueio com '+deviceLabel()+' ativado.');
  } catch (error) { if (!error.cancel) say(error.message); }
  finally { target.reset(); button.disabled = false; void reflectBiometric(); }
};
$('#web-biometric-off').onclick = async () => {
  try {
    await session.store.setExtra('biometric',null);
    say('Desbloqueio com '+deviceLabel()+' desativado. Para apagar a passkey, use o app Senhas do aparelho.');
  } catch (error) { say(error.message); }
  void reflectBiometric();
};
$('#web-mode').onsubmit = async event => {
  event.preventDefault();
  const mode = event.currentTarget;
  const {password,repeat} = mode.elements;
  const secret = password.value;
  const confirmation = repeat.value;
  const withCredentials = !session.saved.unlocked && pluggy.configured();
  if (!session.saved.unlocked && !confirm(withCredentials ?
    'Desativar a senha? As credenciais da Pluggy serão apagadas deste aparelho, porque só ficam guardadas com o modo cofre.' :
    'Desativar a senha e abrir a Moneta direto neste aparelho?')) return;
  const button = mode.querySelector('button');
  button.disabled = true;
  try {
    await enqueue(async () => {
      const {finance,store,saved} = session;
      const unlocked = !saved.unlocked;
      if (unlocked) await decryptVault(secret,saved.bytes);
      else if (secret !== confirmation) throw Error('As senhas precisam ser iguais.');
      if (unlocked) finance.saveLocal('pluggy',null);
      const encrypt = unlocked ? plain : await createCipher(secret);
      session.saved = await store.save(await encrypt(finance.snapshot()),saved.revision,{...settings(saved),unlocked});
      session.encrypt = encrypt;
      await store.setExtra('biometric',null);
    });
    reflectMode();
    await connections.refresh();
    say(session.saved.unlocked ? 'Modo cofre desativado.' : 'Modo cofre ativado.');
  } catch (error) { say(error.message); }
  finally { mode.reset(); button.disabled = false; }
};
$('#web-backup').onsubmit = async event => {
  event.preventDefault();
  const target = event.currentTarget;
  try {
    await queue;
    const {SQL,finance,saved} = session;
    const copy = openFinance(SQL,finance.snapshot());
    let bytes;
    try {
      copy.stripLocal();
      const encrypt = saved.unlocked ? await createCipher(target.elements.password.value) : session.encrypt;
      bytes = await encrypt(copy.snapshot());
    } finally { copy.close(); }
    const url = URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
    const link = document.createElement('a');
    link.href = url; link.download = backupName();
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url),60000);
  } catch (error) { say(error.message); }
  finally { target.reset(); }
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
    // O backup traz os dados; vínculos e credenciais continuam os deste aparelho.
    finance.stripLocal();
    for (const name of localData) {
      if (name !== 'pluggy' || !saved.unlocked) finance.saveLocal(name,session.finance.local(name));
    }
    try {
      await store.save(await (saved.unlocked ? plain : encrypt)(finance.snapshot()),saved.revision,settings(saved));
      await store.setExtra('biometric',null);
    }
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
