import qrcode from './vendor/qrcode.mjs';
const el = id => document.getElementById('peer-'+id);
export function setupPeers(request, refresh) {
  let stream, previous = 0, until = 0, decoder;
  const say = text => { el('status').textContent = text; };
  function stop() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    el('video').srcObject = null;
    el('video').hidden = el('stop').hidden = true;
  }
  el('stop').onclick = stop;
  el('later').onclick = () => { localStorage.setItem('peer-welcome','done'); el('welcome').hidden = true; };
  el('config').onclick = () => setTimeout(() => el('title').scrollIntoView(),0);
  async function status(check = false) {
    if (document.hidden) return;
    try {
      const info = await (check ? request('peer/check',{}) : request('peer'));
      el('welcome').hidden = info.paired || Boolean(localStorage.getItem('peer-welcome'));
      el('forget').hidden = !info.paired && !info.pending;
      if (info.pending) say('Vínculo pendente. Confira a rede e, se o QR expirou, leia um novo código.');
      el('setup').hidden = info.paired;
      if (info.paired || Date.now() > until) {
        el('network').hidden = el('qr').hidden = true; el('qr').removeAttribute('src'); el('address').onchange = null;
      }
      if (info.paired) say(info.error || (info.last ? 'Última troca em '+new Date(info.last).toLocaleString('pt-BR') : 'Vinculado. Aguardando o outro aparelho.'));
      if (info.change !== previous) { await refresh(); previous = info.change; }
    } catch { stop(); }
  }
  el('show').onclick = async () => {
    try {
      const info = await request('peer/invite',{});
      const address = el('address');
      address.replaceChildren(...info.addresses.map(ip => new Option(ip,ip)));
      el('network').hidden = info.addresses.length < 2;
      const draw = () => {
        const qr = qrcode(0,'M');
        const [protocol,,key] = info.code.split('|');
        qr.addData([protocol,address.value,key].join('|')); qr.make();
        el('qr').src = qr.createDataURL(6); el('qr').hidden = false;
      };
      until = info.until; address.onchange = draw; draw();
      say('Leia este QR no outro aparelho em até dois minutos.');
    } catch (e) { say(e.message); }
  };
  async function scan(source,w,h) {
    if (!decoder) decoder = import('./vendor/jsQR.js');
    await decoder;
    const scale = Math.min(1,1400/Math.max(w,h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w*scale); canvas.height = Math.round(h*scale);
    const ctx = canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(source,0,0,canvas.width,canvas.height);
    const pixels = ctx.getImageData(0,0,canvas.width,canvas.height);
    return globalThis.jsQR(pixels.data,pixels.width,pixels.height)?.data;
  }
  async function join(code) {
    if (!code) throw Error('QR não encontrado. Tente uma foto mais próxima.');
    stop();
    if (!confirm('Vincular este aparelho e sincronizar os dados financeiros dos dois cofres?')) return;
    await request('peer/join',{code}); await status();
  }
  el('file').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const pic = await createImageBitmap(file);
      try { await join(await scan(pic,pic.width,pic.height)); } finally { pic.close(); }
    } catch (err) { say(err.message); }
  };
  el('camera').onclick = async () => {
    stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
      const video = el('video');
      video.hidden = el('stop').hidden = false;
      video.srcObject = stream; await video.play();
      while (stream) {
        const code = await scan(video,video.videoWidth,video.videoHeight);
        if (code) { await join(code); break; }
        await new Promise(resolve => setTimeout(resolve,180));
      }
    } catch { stop(); say('Não foi possível ler pela câmera. Selecione uma foto do QR.'); }
  };
  el('forget').onclick = async () => {
    if (!confirm('Encerrar o vínculo neste aparelho? As cópias locais serão preservadas.')) return;
    try { await request('peer/forget',{}); say('Vínculo encerrado.'); await status(); } catch(e) { say(e.message); }
  };
  document.addEventListener('visibilitychange',() => { if (document.hidden) stop(); else void status(true); });
  window.addEventListener('hashchange',stop);
  void status(true); setInterval(status,10000);
}
