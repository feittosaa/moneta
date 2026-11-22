// Vínculos da Moneta Web com outras Monetas (computador ou Android). Pergunta na primeira
// abertura, lê o QR pela câmera e sincroniza a cada 15 segundos enquanto a Moneta está aberta.
import { preparePair, confirmPair, syncPair } from './peer-client.mjs';

const time = value => new Date(value).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
// Marca que a pergunta da primeira abertura já foi respondida.
export const pairWelcome = 'moneta-web:pair-welcome';
let decoder;

// Abre a câmera traseira e devolve o texto do primeiro QR lido, ou nulo se active() ficar falso.
export async function scanCode(video, active) {
  const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
  try {
    if (!active()) return null;
    video.srcObject = stream;
    video.hidden = false;
    await video.play();
    decoder ||= import('./vendor/jsQR.js');
    await decoder;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d',{willReadFrequently:true});
    while (active()) {
      if (video.videoWidth && video.videoHeight) {
        const scale = Math.min(1,760/Math.max(video.videoWidth,video.videoHeight));
        canvas.width = Math.round(video.videoWidth*scale); canvas.height = Math.round(video.videoHeight*scale);
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const pixels = ctx.getImageData(0,0,canvas.width,canvas.height);
        const code = globalThis.jsQR(pixels.data,pixels.width,pixels.height)?.data;
        if (code) return code;
      }
      await new Promise(resolve => setTimeout(resolve,160));
    }
    return null;
  } finally {
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    video.hidden = true;
  }
}

// finance(): banco aberto; write(op): grava no cofre; refresh(): redesenha o painel.
export const offline = 'Não encontrei a outra Moneta. Confira se os dois estão no mesmo Wi-Fi, se a Moneta está aberta no outro aparelho e se você instalou e ativou o perfil da Moneta neste iPhone ou iPad.';

export function setupPairing(finance, write, refresh) {
  const el = name => document.getElementById('web-peer-'+name);
  const dialog = el('dialog'), video = el('video');
  const seen = new Map();
  let scanId = 0, polling = false;
  const feedback = message => { el('feedback').textContent = message; };
  const status = message => { el('status').textContent = message; };
  const remember = () => { localStorage.setItem(pairWelcome,'done'); };
  // A câmera fecha sozinha na próxima volta da leitura.
  function stop() {
    scanId++;
    el('yes').disabled = false;
  }
  function reflect() {
    const peers = finance().peers();
    el('retry').hidden = !peers.length;
    el('devices').replaceChildren(...peers.map(peer => {
      const row = document.createElement('li');
      const text = document.createElement('span');
      const state = seen.get(peer.id);
      text.textContent = peer.name+' · '+(state?.error || (state?.last ? 'sincronizado às '+time(state.last) : 'aguardando a primeira troca'));
      const forget = document.createElement('button');
      forget.type = 'button';
      forget.textContent = 'Desvincular';
      forget.onclick = async () => {
        if (!confirm('Desvincular '+peer.name+'? Os lançamentos já sincronizados ficam nos dois aparelhos.')) return;
        try { await write(f => f.savePeers(f.peers().filter(p => p.id !== peer.id))); seen.delete(peer.id); reflect(); }
        catch (error) { status(error.message); }
      };
      row.append(text,forget);
      return row;
    }));
    if (!peers.length) status('Nenhum aparelho vinculado. Esta Moneta funciona sozinha.');
    else status('');
  }
  function show(text) {
    el('instructions').textContent = text;
    feedback('');
    if (!dialog.open) dialog.showModal();
  }
  async function exchange(peer) {
    const mine = await write(f => f.syncState());
    const reply = await syncPair(peer,mine,finance().agreed(peer.id));
    let changed = false;
    await write(f => {
      if (!f.peers().some(p => p.id === peer.id)) return;
      if (reply.state) changed = f.merge(reply);
      const agreed = reply.state ? f.revision() : reply.revision;
      if (f.agreed(peer.id) !== agreed) f.agreed(peer.id,agreed);
    });
    seen.set(peer.id,{last:Date.now(),error:null});
    return changed;
  }
  async function sync(candidate) {
    if (polling || document.hidden || (!candidate && !finance().peers().length)) return false;
    polling = true;
    let ok = false, changed = false;
    try {
      if (candidate) {
        const {peer} = await confirmPair(candidate);
        await write(f => f.savePeers([...f.peers(),peer]));
      }
      for (const peer of finance().peers()) {
        try { changed = await exchange(peer) || changed; ok = true; }
        catch (error) {
          seen.set(peer.id,{...seen.get(peer.id),error:error.offline ? 'aguardando na rede Wi-Fi' : error.message});
          if (candidate) throw error;
        }
      }
      if (changed) await refresh();
      return ok;
    } finally { polling = false; reflect(); }
  }
  async function useCamera() {
    stop();
    const id = scanId;
    el('yes').disabled = true;
    feedback('');
    try {
      const code = await scanCode(video,() => id === scanId && dialog.open);
      if (!code) return;
      stop();
      let candidate;
      try { candidate = preparePair(code); }
      catch (error) { feedback(error.message); return; }
      feedback('Vinculando…');
      try {
        await sync(candidate);
        if (dialog.open) dialog.close();
        status('Aparelhos vinculados.');
      } catch (error) {
        feedback(error.offline ? offline : error.message);
      }
    } catch (error) {
      if (id !== scanId) return;
      stop();
      feedback(error.name === 'NotAllowedError' ? 'Permita o acesso à câmera em Ajustes para ler o QR.' : error.message);
    }
  }
  el('open').onclick = () => {
    show('No outro aparelho, abra a Moneta e toque em Configuração → Mostrar QR de vínculo → iPhone ou iPad. Depois, toque em “Sim, ler QR Code” e aponte a câmera.');
  };
  el('yes').onclick = () => { remember(); void useCamera(); };
  el('no').onclick = () => dialog.close();
  dialog.onclose = () => { stop(); remember(); };
  el('retry').onclick = async () => {
    status('Sincronizando…');
    try { await sync(); } catch (error) { status(error.message); }
  };
  document.addEventListener('visibilitychange',() => { if (document.hidden) stop(); else void sync().catch(() => {}); });
  setInterval(() => void sync().catch(() => {}),15000);
  reflect();
  if (!finance().peers().length && !localStorage.getItem(pairWelcome)) { dialog.showModal(); return {first:Promise.resolve(false)}; }
  // Primeira troca: quem acabou de vincular espera por ela numa tela de carregamento.
  const first = sync();
  first.catch(() => {});
  return {first};
}
