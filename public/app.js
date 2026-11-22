import { setupPeers } from "./peer-ui.mjs";
import { refresh as refreshFinance, initializeFinance, navigate, syncFinance } from './finance.js';
import { registerGuideWidget } from './guide.js';
import { biometricState, biometricPassword, enrollBiometric, forgetBiometric, installUpdate } from './device-unlock.mjs';
const $ = selector => document.querySelector(selector);
const message = text => { $('#message').textContent = text; };
async function request(path, body) {
  const options = body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch('/api/' + path, options);
  // Sem o cookie de acesso, mostra como entrar em vez de uma tela vazia.
  if (response.status === 401) $('#locked').hidden = false;
  // Trancada (por senha ou sem a chave): a tela certa cobre os dados.
  if (response.status === 423) showLock();
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
const protections = {
  'systemd-creds': 'lacradas pelo sistema (systemd-creds, presas a este usuário e, com TPM, a este computador)',
  dpapi: 'protegidas pelo cofre do Windows (DPAPI) do seu usuário',
  ambiente: 'definidas pelas variáveis de ambiente PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET',
};
const keyProtections = {
  'systemd-creds': 'lacrada pelo sistema (systemd-creds, presa a este usuário e, com TPM, a este computador)',
  dpapi: 'protegida pelo cofre do Windows (DPAPI) do seu usuário',
};
let pluggy = { configured: false, connections: 0 };
async function refresh() {
  const { configured, connections, protection, credentialsError } = await request('connections');
  $('#config').textContent = credentialsError || (configured
    ? 'Credenciais salvas, ' + (protections[protection] || 'em arquivo que só o seu usuário consegue ler') + '.'
    : 'Credenciais pendentes.');
  $('#hint').textContent = !configured ? 'Abra Configuração para habilitar a conexão via Pluggy. O Guia, no menu, mostra o passo a passo.' : connections.length ? '' : 'Nenhuma instituição vinculada à Moneta. A sincronização começa após o vínculo.';
  pluggy = { configured, connections: connections.length };
  reflectGuideCredentials();
  $('#connect').disabled = !configured;
  $('#sync').disabled = !configured || !connections.length;
  $('#items').replaceChildren(...connections.map(item => {
    const row = document.createElement('li');
    row.textContent = item.institution + ' · Status ao conectar: ' + item.status;
    return row;
  }));
}
const form = $('#credentials-form');
const restart = $('#restart');
const save = form.querySelector('button');
// Valida e salva as chaves da Pluggy; usado pela Configuração e pelo quadro da Etapa 5 do guia.
async function saveCredentials(target, buttons, say) {
  for (const button of buttons) button.disabled = true;
  say('Validando credenciais com a Pluggy…');
  try {
    await request('settings/pluggy', Object.fromEntries(new FormData(target)));
    target.reset();
    await refresh();
    say('Credenciais salvas. Você já pode conectar uma instituição.');
    return true;
  } catch (error) { say(error.message); return false; }
  finally { for (const button of buttons) button.disabled = false; }
}
form.onsubmit = event => {
  event.preventDefault();
  saveCredentials(form, [save, restart], message);
};

// Etapa 5 do guia: cola as chaves sem sair do guia e leva direto para Conexões.
let guideCredentials;
function field(label, attributes) {
  const wrapper = document.createElement('label'), input = document.createElement('input');
  for (const [name, value] of Object.entries(attributes)) input.setAttribute(name, value);
  wrapper.append(label, input);
  return wrapper;
}
registerGuideWidget('credenciais', () => {
  const box = document.createElement('form');
  box.className = 'guide-widget';
  const title = document.createElement('strong');
  title.textContent = 'Cole as chaves aqui';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const fields = document.createElement('div');
  fields.className = 'guide-widget-fields';
  const button = document.createElement('button');
  button.textContent = 'Validar e salvar';
  fields.append(
    field('Client ID', { name: 'clientId', required: '', spellcheck: 'false', autocapitalize: 'none', autocomplete: 'off' }),
    field('Client Secret', { name: 'clientSecret', type: 'password', required: '', autocomplete: 'off' }),
    button,
  );
  const next = document.createElement('p');
  next.className = 'guide-widget-next';
  const link = document.createElement('a');
  link.href = '#conexoes';
  link.textContent = 'Ir para Conexões e conectar o Meu Pluggy →';
  next.append(link);
  const other = document.createElement('p');
  other.className = 'guide-widget-alt';
  const settings = document.createElement('a');
  settings.href = '#configuracao';
  settings.textContent = 'Configuração';
  other.append('Prefere colar pela página de configurações? Abra ', settings, ' e depois volte aqui.');
  box.append(title, status, fields, next, other);
  box.onsubmit = async event => {
    event.preventDefault();
    if (await saveCredentials(box, [button], text => { status.textContent = text; })) link.focus();
  };
  guideCredentials = { status, next, other };
  reflectGuideCredentials();
  return box;
});
function reflectGuideCredentials() {
  if (!guideCredentials) return;
  const { status, next, other } = guideCredentials;
  next.hidden = !pluggy.configured;
  other.hidden = pluggy.configured;
  status.textContent = pluggy.configured
    ? 'As credenciais já estão salvas. Para trocar, cole as novas e salve de novo.'
    : 'Cole o Client ID e o Client Secret que você copiou na Etapa 4.';
}
restart.onclick = async () => {
  save.disabled = restart.disabled = true;
  message('Reiniciando o servidor…');
  try {
    const { instance } = await request('restart', {});
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      let status;
      try { status = await request('status'); } catch { continue; }
      if (status.instance !== instance) {
        await refresh();
        message('Servidor reiniciado.');
        return;
      }
    }
    message('O servidor ainda não respondeu. Atualize a página em instantes.');
  } catch (error) { message(error.message); }
  finally { save.disabled = restart.disabled = false; }
};
async function loadWidget() {
  if (window.PluggyConnect) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.pluggy.ai/pluggy-connect/v2.7.0/pluggy-connect.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Não foi possível carregar o Pluggy Connect.'));
    document.head.append(script);
  });
}
$('#connect').onclick = async () => {
  $('#connect').disabled = true;
  message('');
  try {
    await loadWidget();
    const { accessToken } = await request('connect-token', {});
    let registration;
    let candidate;
    let widgetError = false;
    function register(item) {
      if (!item?.id || registration) return registration;
      message('Salvando a conexão autorizada…');
      const first = !pluggy.connections;
      registration = (async () => {
        try {
          await request('connections', { itemId: item.id, connectToken: accessToken });
          await refresh();
          $('#connect').disabled = true;
          await syncFinance();
          await refresh();
          if (first) message('Primeira conexão salva. A Pluggy pode levar de alguns minutos a algumas horas para entregar todo o histórico, então nem todas as transações aparecem de imediato. A Moneta sincroniza sozinha a cada 6 horas, e você pode clicar em Sincronizar mais tarde para trazer o que faltou.');
        } catch (error) {
          message('Falha ao registrar a conexão. ' + error.message);
        } finally {
          $('#connect').disabled = false;
        }
      })();
      return registration;
    }
    const widget = new window.PluggyConnect({
      connectToken: accessToken,
      onEvent: ({ event, item }) => {
        if (event !== 'ITEM_RESPONSE' || !item?.id) return;
        candidate = item;
        if (item.status === 'UPDATED') return register(item);
      },
      onSuccess: ({ item }) => register(item),
      onClose: () => {
        if (registration) return;
        if (!widgetError && candidate?.id) return register(candidate);
        $('#connect').disabled = false;
        if (!widgetError) message('A Pluggy fechou sem enviar uma conexão à Moneta.');
      },
      onError: () => {
        widgetError = true;
        if (!registration) message('A Pluggy não concluiu a conexão.');
        $('#connect').disabled = false;
      },
    });
    await widget.init();
  } catch (error) {
    message(error.message);
    $('#connect').disabled = false;
  }
};
// Rodapé do menu: versão do app e, quando houver, o botão para instalar a nova (Linux, Windows e Android).
async function waitForRestart(instance) {
  for (let attempt = 0; attempt < 360; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const status = await fetch('/api/status').then(r => r.json()).catch(() => null);
    if (status?.instance && status.instance !== instance) return location.reload();
  }
  $('#app-version').textContent = 'A atualização está demorando. Abra a Moneta de novo em instantes.';
}
// No Android, o servidor baixa e confere o APK, e o instalador do sistema pede a confirmação.
// Na primeira vez, o Android pede para permitir que a Moneta instale apps.
async function installOnAndroid(latest, current, label, button) {
  if (!confirm('Baixar e instalar a Moneta ' + latest + '? O Android pede a confirmação, e seus dados continuam no aparelho.')) return;
  button.disabled = true;
  label.textContent = 'Baixando a versão ' + latest + '…';
  try {
    await request('update/install', {});
    await installUpdate();
    label.textContent = 'Confirme a instalação da versão ' + latest + ' na janela do Android.';
  } catch (error) {
    label.textContent = 'Moneta ' + current + ' · nova versão ' + latest;
    message(error.message === 'permission'
      ? 'Permita que a Moneta instale apps na tela que abriu, volte e toque em instalar de novo.'
      : 'Não foi possível atualizar. ' + error.message);
  } finally { button.disabled = false; }
}
addEventListener('moneta-update-failed', () => message('A instalação da atualização não foi concluída. Tente de novo pelo botão no menu.'));
async function checkUpdate() {
  const label = $('#app-version'), button = $('#app-update');
  let update;
  try { update = await request('update'); }
  catch { label.textContent = 'Moneta'; return; }
  const { supported, platform, current, latest, available, installing, error } = update;
  label.textContent = !current ? 'Moneta (versão de desenvolvimento)'
    : installing ? 'Instalando a atualização…'
    : available ? 'Moneta ' + current + ' · nova versão ' + latest
    : supported && error ? 'Moneta ' + current + ' · não foi possível verificar atualizações'
    : 'Moneta ' + current + (supported ? ' · atualizada' : '');
  label.title = error || '';
  button.hidden = !available || installing;
  button.textContent = 'Instalar a versão ' + latest;
  button.onclick = async () => {
    if (platform === 'android') return installOnAndroid(latest, current, label, button);
    if (!confirm('Instalar a Moneta ' + latest + '? A Moneta fecha por alguns instantes e abre de novo já atualizada. Seus dados não são alterados.')) return;
    button.disabled = true;
    label.textContent = 'Baixando e instalando a versão ' + latest + '…';
    try {
      const { instance } = await request('update/install', {});
      label.textContent = 'Instalando a versão ' + latest + '. A Moneta reinicia sozinha.';
      button.hidden = true;
      await waitForRestart(instance);
    } catch (error) {
      label.textContent = 'Moneta ' + current;
      message('Não foi possível atualizar. ' + error.message);
      button.disabled = false;
    }
  };
}
const shutdown = $('#shutdown');
let unlocked = false;
async function showLock() {
  const { lock } = await fetch('/api/status').then(r => r.json()).catch(() => ({}));
  if (lock === 'senha') {
    $('#unlock').hidden = false;
    // No Android com o desbloqueio ativado, pede a digital logo ao abrir; a senha continua valendo.
    if (biometricState() === 'enrolled') { $('#unlock-biometric').hidden = false; void unlockByDevice(); }
    else $('#unlock-form').elements.password.focus();
  }
  else if (lock) $('#recovery').hidden = false;
}
request('status').then(({ desktop, locked }) => {
  shutdown.hidden = !desktop;
  if (locked) return showLock();
  unlocked = true;
  return loadVault();
}).catch(() => {});
// Se a Moneta trancar por inatividade, a página recarrega e some com os dados da tela.
setInterval(async () => {
  if (!unlocked) return;
  try { if ((await fetch('/api/status').then(r => r.json())).locked) location.reload(); } catch {}
}, 20_000);
// No modo cofre, mexer na página conta como uso (no máximo um aviso por minuto ao servidor).
let passwordMode = false, lastPing = Date.now();
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  addEventListener(type, () => {
    if (!passwordMode || Date.now() - lastPing < 60_000) return;
    lastPing = Date.now();
    fetch('/api/vault').catch(() => {});
  }, { passive: true });
}
async function waitRestart(instance, ready = status => !status.locked) {
  for (let attempt = 0; attempt < 80; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try { const status = await fetch('/api/status').then(r => r.json()); if (status.instance !== instance && ready(status)) return true; } catch {}
  }
  return false;
}

// Cofre do banco: situação, chave de recuperação e troca da chave.
const when = iso => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const size = bytes => bytes < 1024 * 1024 ? Math.ceil(bytes / 1024) + ' KB' : (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
async function loadVault() {
  const { protection, pending, password, idle, backups } = await request('vault');
  passwordMode = password;
  $('#vault-status').textContent = 'O banco fica cifrado com AES-256-GCM no arquivo moneta.cofre. A chave está ' +
    (password ? 'cifrada com a sua senha e ' : '') + (keyProtections[protection] || 'num arquivo que só o seu usuário consegue ler') + '.';
  $('#vault-pending').hidden = !pending;
  $('#password-status').textContent = password
    ? 'Ligado. A Moneta sobe trancada e tranca de novo depois de ' + $('#password-idle').querySelector(`option[value="${idle}"]`)?.textContent + ' sem uso. Enquanto estiver trancada, a sincronização automática fica parada.'
    : 'Desligado. Com o modo cofre, a Moneta pede uma senha para abrir e tranca sozinha depois de um tempo sem uso. Enquanto estiver trancada, o banco fica protegido até de programas rodando com o seu usuário; em troca, a sincronização automática só acontece com ele aberto.';
  $('#password-on').hidden = password;
  $('#password-settings').hidden = !password;
  reflectBiometric(password);
  $('#password-idle').value = String(idle);
  $('#backup-list').replaceChildren(...backups.map(backup => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = 'Automático de ' + when(backup.created) + ' ';
    const small = document.createElement('small');
    small.textContent = size(backup.size);
    label.append(small);
    const get = document.createElement('button');
    get.type = 'button'; get.textContent = 'Baixar';
    get.onclick = () => saveFile('/api/backups/' + backup.name);
    const put = document.createElement('button');
    put.type = 'button'; put.textContent = 'Restaurar';
    put.onclick = () => restore({ name: backup.name });
    row.append(label, get, put);
    return row;
  }));
}
function saveFile(href) {
  const link = document.createElement('a');
  link.href = href;
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}
$('#backup-download').onclick = () => {
  saveFile('/api/backup');
  message('Backup gerado e testado. Guarde o arquivo fora deste computador.');
};
// Restauração em duas etapas: o servidor abre e testa o arquivo, mostra o resumo e só troca o banco
// depois da confirmação.
async function restore(source) {
  try {
    let response = await fetch('/api/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(source) });
    let data = await response.json();
    if (response.status === 409 && data.needsCode) {
      $('#backup-code').hidden = false;
      $('#backup-code').querySelector('input').focus();
      return message(data.error);
    }
    if (!response.ok) throw new Error(data.error);
    const { created, summary = {} } = data.manifest;
    const counts = [summary.transactions != null && summary.transactions + ' transações', summary.categories != null && summary.categories + ' categorias', summary.connections != null && summary.connections + ' conexões'].filter(Boolean).join(', ');
    if (!confirm('Restaurar o backup de ' + when(created) + (counts ? ' (' + counts + ')' : '') + '? O banco atual é substituído; antes disso, a Moneta guarda um backup automático dele.')) return;
    message('Restaurando o backup…');
    const { instance } = await request('backup/restore', { ...source, confirm: true });
    if (await waitRestart(instance)) location.reload();
    else message('O backup foi restaurado, mas o servidor ainda não voltou. Atualize a página em instantes.');
  } catch (error) { message(error.message); }
}
$('#backup-restore').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget, file = form.elements.file.files[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await restore({ data: btoa(binary), code: form.elements.code.value.trim() || undefined });
};
$('#password-on').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget, { password, repeat, idle } = form.elements;
  if (password.value !== repeat.value) return message('As senhas não são iguais.');
  if (!confirm('Ligar o modo cofre? A chave do banco é trocada, e a chave de recuperação atual deixa de valer: anote a nova que vai aparecer. Sem a senha e sem a chave de recuperação, não há como abrir o banco.')) return;
  try {
    const secret = password.value;
    const { code } = await request('vault/password', { password: secret, idle: Number(idle.value) });
    forgetBiometric();
    form.reset();
    await loadVault();
    showCode(code);
    await offerDevice(secret);
    reflectBiometric(passwordMode);
    message('Modo cofre ligado. Anote a nova chave de recuperação.');
  } catch (error) { message(error.message); }
};
$('#password-idle').onchange = async event => {
  try { await request('vault/password/idle', { idle: Number(event.target.value) }); await loadVault(); message('Tempo de inatividade salvo.'); }
  catch (error) { message(error.message); }
};
$('#password-lock').onclick = async () => {
  try { const { instance } = await request('vault/lock', {}); await waitRestart(instance, () => true); location.reload(); }
  catch (error) { message(error.message); }
};
$('#password-off').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try { await request('vault/password/remove', { password: form.elements.password.value }); forgetBiometric(); form.reset(); await loadVault(); message('Modo cofre desligado.'); }
  catch (error) { message(error.message); }
};
async function unlockWith(password) {
  const response = await fetch('/api/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
  await offerDevice(password);
  location.reload();
}
// No Android, depois de usar a senha, pergunta uma vez se a pessoa quer usar a biometria.
async function offerDevice(password) {
  if (biometricState() !== 'available' || localStorage.getItem('biometric-offer') === 'no') return;
  if (!confirm('Destrancar a Moneta com a digital, o rosto ou o bloqueio de tela da próxima vez? A senha continua funcionando.')) {
    localStorage.setItem('biometric-offer', 'no');
    return;
  }
  try { await enrollBiometric(password); message('Desbloqueio pelo aparelho ativado.'); }
  catch (error) { if (!error.cancel) alert(error.message); }
}
$('#unlock-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button');
  button.disabled = true;
  $('#unlock-error').textContent = 'Abrindo o cofre…';
  try { await unlockWith(form.elements.password.value); }
  catch (error) { $('#unlock-error').textContent = error.message; form.elements.password.select(); button.disabled = false; }
};
let unlocking = false;
async function unlockByDevice() {
  if (unlocking) return;
  unlocking = true;
  const button = $('#unlock-biometric');
  button.disabled = true;
  try {
    const password = await biometricPassword();
    $('#unlock-error').textContent = 'Abrindo o cofre…';
    await unlockWith(password);
  } catch (error) {
    // Senha guardada que não abre mais (trocada em outro lugar): apaga e volta para a senha.
    if (error.status === 403) { forgetBiometric(); error.message = 'A senha guardada no aparelho não vale mais. Digite a senha e ative o desbloqueio de novo em Configuração.'; }
    if (error.status === 403 || error.missing) button.hidden = true;
    $('#unlock-error').textContent = error.cancel ? '' : error.message;
    $('#unlock-form').elements.password.focus();
  } finally { unlocking = false; button.disabled = false; }
}
$('#unlock-biometric').onclick = () => unlockByDevice();
function reflectBiometric(password) {
  if (!password && biometricState() === 'enrolled') forgetBiometric();
  const state = biometricState();
  $('#biometric').hidden = !password || state === 'unavailable';
  $('#biometric-on').hidden = state === 'enrolled';
  $('#biometric-off').hidden = state !== 'enrolled';
  $('#biometric-status').textContent = state === 'enrolled'
    ? 'Ativado. Ao abrir, a Moneta pede a digital, o rosto ou o bloqueio de tela deste aparelho. A senha continua funcionando.'
    : 'Destranque a Moneta com a digital, o rosto ou o bloqueio de tela deste aparelho. A senha fica guardada pelo Android e só sai depois da confirmação.';
}
$('#biometric-on').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button');
  button.disabled = true;
  try {
    const password = form.elements.password.value;
    await request('vault/password/check', { password });
    await enrollBiometric(password);
    form.reset();
    message('Desbloqueio pelo aparelho ativado.');
  } catch (error) { if (!error.cancel) message(error.message); }
  finally { button.disabled = false; reflectBiometric(passwordMode); }
};
$('#biometric-off').onclick = () => {
  forgetBiometric();
  reflectBiometric(passwordMode);
  message('Desbloqueio pelo aparelho desativado.');
};
$('#unlock-forgot').onclick = () => {
  $('#recovery-text').textContent = 'Sem a senha, a chave de recuperação que você anotou também abre o cofre. Ao usá-la, o modo cofre é desligado; você pode ligá-lo de novo, com uma senha nova, em Configuração.';
  $('#unlock').hidden = true;
  $('#recovery').hidden = false;
};
function showCode(code) {
  $('#vault-code-text').textContent = code;
  $('#vault-code').hidden = false;
  $('#vault-pending').hidden = true;
}
$('#vault-show').onclick = async () => {
  try { showCode((await request('vault/code', {})).code); } catch (error) { message(error.message); }
};
$('#vault-copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#vault-code-text').textContent); message('Chave copiada. Cole no gerenciador de senhas e limpe a área de transferência.'); }
  catch { message('Não foi possível copiar. Selecione a chave e copie manualmente.'); }
};
$('#vault-confirm').onclick = async () => {
  try {
    await request('vault/confirm', {});
    $('#vault-code').hidden = true;
    $('#vault-code-text').textContent = '';
    message('Chave de recuperação marcada como guardada.');
  } catch (error) { message(error.message); }
};
$('#vault-rotate').onclick = async () => {
  if (!confirm('Gerar uma nova chave de recuperação? A chave atual deixa de valer, e o banco é cifrado de novo com a nova.')) return;
  try { showCode((await request('vault/rotate', {})).code); } catch (error) { message(error.message); }
};
$('#recovery-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button');
  button.disabled = true;
  $('#recovery-error').textContent = 'Abrindo o cofre…';
  try {
    const { instance } = await request('recovery', { code: form.elements.code.value });
    // A chave de recuperação desliga o modo cofre: a senha guardada para a biometria deixa de valer.
    forgetBiometric();
    form.reset();
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try { const status = await request('status'); if (status.instance !== instance && !status.locked) return location.reload(); } catch {}
    }
    $('#recovery-error').textContent = 'O cofre abriu, mas o servidor ainda não voltou. Atualize a página em instantes.';
  } catch (error) { $('#recovery-error').textContent = error.message; button.disabled = false; }
};
shutdown.onclick = async () => {
  if (!confirm('Encerrar a Moneta? A sincronização automática para até você abrir a Moneta de novo.')) return;
  save.disabled = restart.disabled = shutdown.disabled = true;
  try {
    await request('shutdown', {});
    message('A Moneta foi encerrada. Você já pode fechar esta aba.');
  } catch (error) {
    message(error.message);
    save.disabled = restart.disabled = shutdown.disabled = false;
  }
};
window.addEventListener('hashchange', navigate);
initializeFinance(request, message);
navigate();
refresh().catch(error => message(error.message));
// Verifica ao abrir e, com o app aberto por muito tempo, de novo a cada 6 horas.
checkUpdate();
setInterval(checkUpdate, 6 * 60 * 60_000);

setupPeers(request, () => Promise.all([refreshFinance(),refresh()]));
