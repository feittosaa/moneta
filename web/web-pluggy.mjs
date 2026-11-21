// Pluggy na Moneta Web: o iPhone ou iPad conecta os bancos por conta própria, sem computador.
// A API da Pluggy aceita chamadas do navegador (CORS liberado). As credenciais ficam no banco
// cifrado deste aparelho, por isso só existem com o modo cofre ligado.
import { synchronize } from './finance.mjs';

const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const every = 6 * 60 * 60 * 1000;
const fail = message => { throw Error(message); };

async function pluggy(path, apiKey, body) {
  let response;
  try {
    response = await fetch('https://api.pluggy.ai'+path,{method:body ? 'POST' : 'GET',credentials:'omit',
      headers:{'Content-Type':'application/json',...(apiKey && {'X-API-KEY':apiKey})},
      body:body && JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  } catch { fail('Sem conexão com a Pluggy. Confira a internet e tente de novo.'); }
  if (!response.ok) fail('A Pluggy recusou a solicitação. Verifique suas credenciais e tente novamente.');
  return response.json();
}
async function authenticate(pair) {
  const {apiKey} = await pluggy('/auth',null,pair);
  if (!apiKey) fail('Resposta de autenticação inválida.');
  return apiKey;
}

// finance(): banco aberto; write(op): grava no cofre; vaultOff(): modo cofre desligado.
export function createPluggy({finance, write, vaultOff}) {
  let running = null, lastAttempt = 0;
  const credentials = () => finance().local('pluggy');
  const configured = () => Boolean(credentials()?.clientId && credentials()?.clientSecret);
  const connections = () => finance().db.prepare('SELECT * FROM connections ORDER BY institution, id').all();
  function profile() {
    return write(f => {
      let id = f.local('profile');
      if (!id) { id = crypto.randomUUID(); f.saveLocal('profile',id); }
      return id;
    });
  }
  function sync() {
    if (running) return running;
    lastAttempt = Date.now();
    running = (async () => {
      if (!configured()) fail('Cadastre as credenciais da Pluggy em Configuração.');
      const key = await authenticate(credentials());
      await write(f => synchronize(f.db,path => pluggy(path,key)));
    })().finally(() => { running = null; });
    return running;
  }
  const api = {
    handles: path => ['connections','settings/pluggy','connect-token','sync','pluggy/remove'].includes(path),
    async call(path, body) {
      if (path === 'connections' && !body) {
        return {configured:configured(),protection:'cofre-web',credentialsError:null,connections:connections()};
      }
      if (path === 'settings/pluggy') {
        if (vaultOff()) fail('Ative o modo cofre em Configuração antes de salvar as credenciais da Pluggy.');
        const pair = {};
        for (const field of ['clientId','clientSecret']) {
          if (typeof body[field] !== 'string' || !body[field].trim()) fail('Preencha o Client ID e o Client Secret.');
          pair[field] = body[field].trim();
        }
        await authenticate(pair);
        await write(f => f.saveLocal('pluggy',pair));
        return {ok:true};
      }
      if (path === 'pluggy/remove') { await write(f => f.saveLocal('pluggy',null)); return {ok:true}; }
      if (!configured()) fail('Cadastre as credenciais da Pluggy em Configuração.');
      if (path === 'sync') { await sync(); return {ok:true}; }
      const apiKey = await authenticate(credentials());
      const clientUserId = await profile();
      if (path === 'connect-token') {
        const {accessToken} = await pluggy('/connect_token',apiKey,{clientUserId});
        if (!accessToken) fail('Token indisponível.');
        return {accessToken};
      }
      const id = body.itemId;
      if (typeof id !== 'string' || !uuid.test(id)) fail('Identificador inválido.');
      const item = await pluggy('/items/'+id,apiKey);
      if (item.id !== id || (item.clientUserId != null && item.clientUserId !== clientUserId)) fail('Conexão de outro perfil.');
      if (item.clientUserId == null) {
        if (typeof body.connectToken !== 'string' || !body.connectToken) fail('Sessão de conexão ausente.');
        if ((await pluggy('/items/'+id,body.connectToken)).id !== id) fail('Item fora da sessão de conexão.');
      }
      if (item.status !== 'UPDATED') fail('A Pluggy ainda não confirmou a coleta dos dados. Tente conectar novamente quando ela terminar.');
      await write(f => f.db.prepare('INSERT INTO connections VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET institution=excluded.institution, status=excluded.status')
        .run(id,item.connector.name,item.status));
      return {id};
    },
    configured,
    // Sem processo em segundo plano no iPhone: atualiza ao abrir e enquanto a Moneta estiver aberta.
    async maybeSync() {
      if (!configured() || running || !navigator.onLine || Date.now()-lastAttempt < every) return false;
      const count = connections().length;
      if (!count) return false;
      const stats = finance().db.prepare('SELECT count(*) AS total, min(updated) AS oldest FROM snapshots').get();
      if (stats.total >= count && Date.now()-Date.parse(stats.oldest) < every) return false;
      try { await sync(); return true; } catch { return false; }
    },
  };
  return api;
}
