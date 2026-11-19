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
  $('#hint').textContent = !configured ? 'Abra Configuração para habilitar a conexão via Pluggy.' : connections.length ? '' : 'Nenhuma instituição conectada.';
  $('#connect').disabled = !configured;
  $('#sync').disabled = !configured || !connections.length;
  $('#items').replaceChildren(...connections.map(item => {
    const row = document.createElement('li');
    row.textContent = item.institution + ' · Status ao conectar: ' + item.status;
    return row;
  }));
}
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
    const widget = new window.PluggyConnect({
      connectToken: accessToken,
      onSuccess: async ({ item }) => {
        try {
          await request('connections', { itemId: item.id });
          await refresh();
          message('Instituição conectada.');
          await syncFinance();
        } catch (error) { message(error.message); }
        finally { $('#connect').disabled = false; }
      },
      onClose: () => { $('#connect').disabled = false; },
      onError: () => { message('A conexão não foi concluída.'); $('#connect').disabled = false; },
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
