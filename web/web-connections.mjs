// Conexões e credenciais da Pluggy na Moneta Web, no mesmo fluxo do painel do computador.
import { syncFinance } from './finance.js';

const $ = selector => document.querySelector(selector);

export function setupConnections(request, say, vaultOff) {
  let state = {configured:false,connections:[]};
  async function refresh() {
    state = await request('connections');
    const off = vaultOff();
    $('#config').textContent = off ? 'Para conectar bancos neste aparelho, ative o modo cofre acima. As credenciais da Pluggy só ficam guardadas com senha.' :
      state.configured ? 'Credenciais salvas no cofre cifrado deste aparelho.' : 'Credenciais pendentes.';
    $('#credentials-form').hidden = off;
    $('#pluggy-remove').hidden = !state.configured;
    $('#hint').textContent = off ? 'Ative o modo cofre em Configuração para conectar bancos neste aparelho.' :
      !state.configured ? 'Cadastre as credenciais da Pluggy em Configuração. O Guia de conexão, no GitHub, mostra o passo a passo.' :
      state.connections.length ? 'A Moneta atualiza os bancos ao abrir e a cada 6 horas enquanto estiver aberta.' :
      'Nenhuma instituição vinculada a este aparelho.';
    $('#connect').disabled = off || !state.configured;
    $('#sync').hidden = !state.configured;
    $('#sync').disabled = !state.configured || !state.connections.length;
    $('#items').replaceChildren(...state.connections.map(item => {
      const row = document.createElement('li');
      row.textContent = item.institution+' · Status ao conectar: '+item.status;
      return row;
    }));
  }
  const form = $('#credentials-form');
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    say('Validando credenciais com a Pluggy…');
    try {
      await request('settings/pluggy',Object.fromEntries(new FormData(form)));
      form.reset();
      await refresh();
      say('Credenciais salvas. Você já pode conectar uma instituição.');
    } catch (error) { say(error.message); }
    finally { button.disabled = false; }
  };
  $('#pluggy-remove').onclick = async () => {
    if (!confirm('Apagar as credenciais da Pluggy deste aparelho? Os dados já importados continuam aqui.')) return;
    try { await request('pluggy/remove',{}); await refresh(); say('Credenciais apagadas.'); } catch (error) { say(error.message); }
  };
  async function loadWidget() {
    if (window.PluggyConnect) return;
    await new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.pluggy.ai/pluggy-connect/v2.7.0/pluggy-connect.js';
      script.onload = resolve;
      script.onerror = () => reject(Error('Não foi possível carregar o Pluggy Connect. Confira a internet.'));
      document.head.append(script);
    });
  }
  $('#connect').onclick = async () => {
    $('#connect').disabled = true;
    say('');
    try {
      await loadWidget();
      const {accessToken} = await request('connect-token',{});
      let registration, candidate, widgetError = false;
      const register = item => {
        if (!item?.id || registration) return registration;
        say('Salvando a conexão autorizada…');
        registration = (async () => {
          try {
            await request('connections',{itemId:item.id,connectToken:accessToken});
            await refresh();
            await syncFinance();
            await refresh();
          } catch (error) { say('Falha ao registrar a conexão. '+error.message); }
          finally { $('#connect').disabled = false; }
        })();
        return registration;
      };
      const widget = new window.PluggyConnect({
        connectToken:accessToken,
        onEvent:({event,item}) => {
          if (event !== 'ITEM_RESPONSE' || !item?.id) return;
          candidate = item;
          if (item.status === 'UPDATED') return register(item);
        },
        onSuccess:({item}) => register(item),
        onClose:() => {
          if (registration) return;
          if (!widgetError && candidate?.id) return register(candidate);
          $('#connect').disabled = false;
          if (!widgetError) say('A Pluggy fechou sem enviar uma conexão à Moneta.');
        },
        onError:() => {
          widgetError = true;
          if (!registration) say('A Pluggy não concluiu a conexão.');
          $('#connect').disabled = false;
        },
      });
      await widget.init();
    } catch (error) { say(error.message); $('#connect').disabled = false; }
  };
  return {refresh,configured:() => state.configured};
}
