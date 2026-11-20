import { initializeFinance, navigate, syncFinance } from './finance.js';
const $ = selector => document.querySelector(selector);
const message = text => { $('#message').textContent = text; };
async function request(path, body) {
  const options = body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch('/api/' + path, options);
  // Sem o cookie de acesso, mostra como entrar em vez de uma tela vazia.
  if (response.status === 401) $('#locked').hidden = false;
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
async function refresh() {
  const { configured, connections, protection, credentialsError } = await request('connections');
  $('#config').textContent = credentialsError || (configured
    ? 'Credenciais salvas, ' + (protections[protection] || 'em arquivo que só o seu usuário consegue ler') + '.'
    : 'Credenciais pendentes.');
  $('#hint').textContent = !configured ? 'Abra Configuração para habilitar a conexão via Pluggy. O Guia, no menu, mostra o passo a passo.' : connections.length ? '' : 'Nenhuma instituição vinculada ao Moneta. A sincronização começa após o vínculo.';
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
form.onsubmit = async event => {
  event.preventDefault();
  save.disabled = restart.disabled = true;
  message('Validando credenciais com a Pluggy…');
  try {
    await request('settings/pluggy', Object.fromEntries(new FormData(form)));
    form.reset();
    await refresh();
    message('Credenciais salvas. Você já pode conectar uma instituição.');
  } catch (error) { message(error.message); }
  finally { save.disabled = restart.disabled = false; }
};
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
      registration = (async () => {
        try {
          await request('connections', { itemId: item.id, connectToken: accessToken });
          await refresh();
          $('#connect').disabled = true;
          await syncFinance();
          await refresh();
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
        if (!widgetError) message('A Pluggy fechou sem enviar uma conexão ao Moneta.');
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
const shutdown = $('#shutdown');
request('status').then(({ desktop, locked }) => {
  shutdown.hidden = !desktop;
  if (locked) $('#recovery').hidden = false;
  else return loadVault();
}).catch(() => {});

// Cofre do banco: situação, chave de recuperação e troca da chave.
async function loadVault() {
  const { protection, pending } = await request('vault');
  $('#vault-status').textContent = 'O banco fica cifrado com AES-256-GCM no arquivo moneta.cofre. A chave está ' +
    (keyProtections[protection] || 'num arquivo que só o seu usuário consegue ler') + '.';
  $('#vault-pending').hidden = !pending;
}
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
    form.reset();
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try { const status = await request('status'); if (status.instance !== instance && !status.locked) return location.reload(); } catch {}
    }
    $('#recovery-error').textContent = 'O cofre abriu, mas o servidor ainda não voltou. Atualize a página em instantes.';
  } catch (error) { $('#recovery-error').textContent = error.message; button.disabled = false; }
};
shutdown.onclick = async () => {
  if (!confirm('Encerrar o Moneta? A sincronização automática para até você abrir o Moneta de novo.')) return;
  save.disabled = restart.disabled = shutdown.disabled = true;
  try {
    await request('shutdown', {});
    message('O Moneta foi encerrado. Você já pode fechar esta aba.');
  } catch (error) {
    message(error.message);
    save.disabled = restart.disabled = shutdown.disabled = false;
  }
};
window.addEventListener('hashchange', navigate);
initializeFinance(request, message);
navigate();
refresh().catch(error => message(error.message));
