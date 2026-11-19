import { initializeFinance, navigate, syncFinance } from './finance.js';
const $ = selector => document.querySelector(selector);
const message = text => { $('#message').textContent = text; };
async function request(path, body) {
  const options = body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch('/api/' + path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
async function refresh() {
  const { configured, connections } = await request('connections');
  $('#config').textContent = configured ? 'Credenciais presentes no servidor.' : 'Credenciais pendentes.';
  $('#hint').textContent = !configured ? 'Abra Configuração para habilitar a conexão via Pluggy.' : connections.length ? '' : 'Nenhuma instituição vinculada ao Moneta. A sincronização começa após o vínculo.';
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
window.addEventListener('hashchange', navigate);
initializeFinance(request, message);
navigate();
refresh().catch(error => message(error.message));
