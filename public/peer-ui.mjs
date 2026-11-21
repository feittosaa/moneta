import qrcode from './vendor/qrcode.mjs';
const el = id => document.getElementById('peer-'+id);
const welcome = 'peer-welcome';
const time = value => new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});

// Sincronização entre aparelhos no painel do computador ou do Android: lista os vínculos,
// mostra o QR (com o perfil do iPhone ou iPad antes, quando é a primeira vez) e lê o QR de outro.
export function setupPeers(request, refresh) {
  let stream, decoder, last, change = 0, invite = null, step = null, known = 0, poll;
  const dialog = el('qr-dialog');
  const say = text => { el('status').textContent = text; };
  const note = text => { el('qr-status').textContent = text; };
  function stop() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null; el('video').hidden = el('stop').hidden = true;
  }
  el('stop').onclick = stop;

  function renderDevices(devices) {
    el('devices').replaceChildren(...devices.map(device => {
      const row = document.createElement('li');
      const text = document.createElement('span');
      const kind = device.kind === 'web' ? 'Moneta Web' : 'Moneta';
      text.textContent = device.name+' · '+kind+' · '+(device.error || (device.last ? 'última troca em '+time(device.last) : 'aguardando a primeira troca'));
      const forget = document.createElement('button');
      forget.type = 'button';
      forget.textContent = 'Desvincular';
      forget.onclick = async () => {
        if (!confirm('Desvincular '+device.name+'? Os lançamentos já sincronizados ficam nos dois aparelhos.')) return;
        try { await request('peer/forget',{id:device.id,kind:device.kind}); await status(); } catch (error) { say(error.message); }
      };
      row.append(text,forget);
      return row;
    }));
  }
  async function status(check) {
    if (document.hidden) return;
    try {
      const info = await (check ? request('peer/check',{}) : request('peer'));
      const first = !last;
      last = info;
      renderDevices(info.devices);
      say(info.devices.length ? '' : info.pending ? 'Vínculo em andamento.' : 'Nenhum aparelho vinculado. Esta Moneta funciona sozinha.');
      if (invite && info.devices.length > known) finish(info.devices.at(-1));
      else if (invite && Date.now() > invite.until && step !== 'profile') expire();
      if (info.change !== change) { change = info.change; await refresh(); }
      if (first && !info.devices.length && !localStorage.getItem(welcome)) choose();
    } catch {}
  }

  function show(text, label) {
    const qr = qrcode(0,'M');
    qr.addData(text); qr.make();
    el('qr').src = qr.createDataURL(6);
    el('qr').alt = label;
    el('qr').hidden = false;
  }
  function steps(lines) {
    el('qr-steps').replaceChildren(...lines.map(line => {
      const item = document.createElement('li');
      item.textContent = line;
      return item;
    }));
    el('qr-steps').hidden = !lines.length;
  }
  function layout({title, text, list = [], next = false, back = true, close = 'Fechar'}) {
    el('qr-title').textContent = title;
    el('qr-instructions').textContent = text;
    el('qr-types').hidden = step !== null;
    steps(list);
    el('qr-next').hidden = !next;
    el('qr-back').hidden = !back;
    el('qr-refresh').hidden = true;
    el('qr-close').textContent = close;
    if (!dialog.open) dialog.showModal();
  }
  function choose() {
    invite = null; step = null;
    el('qr').hidden = el('network').hidden = true;
    note('');
    layout({title:'Usar a Moneta em outro aparelho?',back:false,close:'Agora não',
      text:'Vincule um celular, tablet ou computador para sincronizar pela rede Wi-Fi. Cada aparelho continua funcionando sozinho.'});
  }
  // Os QRs mudam com o endereço escolhido quando o computador está em mais de uma rede.
  function draw() {
    if (!invite) return;
    const index = Number(el('address').value) || 0;
    if (step === 'profile') show(invite.profiles[index],'QR para baixar o perfil da Moneta no iPhone ou iPad');
    else show(invite.codes[index],'QR de vínculo válido por dois minutos');
  }
  async function generate(kind) {
    known = last?.devices.length || 0;
    note('Preparando o QR…');
    el('qr').hidden = true;
    try {
      invite = await request('peer/invite',kind === 'web' ? {kind} : {});
      const select = el('address');
      const previous = select.value;
      select.replaceChildren(...invite.addresses.map((address,i) => new Option(address.replace(/^https:\/\//,'').replace(/:\d+$/,''),String(i))));
      if (previous && previous < invite.addresses.length) select.value = previous;
      el('network').hidden = invite.addresses.length < 2;
      note('');
      draw();
      clearInterval(poll);
      poll = setInterval(() => void status(),3000);
    } catch (error) { invite = null; note(error.message); el('qr-refresh').hidden = false; }
  }
  function profile() {
    step = 'profile';
    layout({title:'1. Confiar na Moneta neste iPhone ou iPad',next:true,
      text:'Faça isto uma vez em cada iPhone ou iPad. Se já fez, toque em “Já instalei”.',
      list:['No iPhone ou iPad, abra o app Câmera, aponte para o QR e toque no aviso para abrir no Safari. Toque em Permitir para baixar o perfil.',
        'Abra Ajustes e toque em Perfil Baixado, no topo. Toque em Instalar e confirme com o código do aparelho.',
        'Em Ajustes → Geral → Sobre → Ajustes de Confiança de Certificados, ative a Moneta e toque em Continuar.']});
    void generate('web');
  }
  function pairWeb() {
    step = 'web';
    layout({title:'2. Vincular o iPhone ou iPad',
      text:'Use o mesmo Wi-Fi nos dois aparelhos e deixe a Moneta aberta aqui.',
      list:['Abra a Moneta no iPhone ou iPad. Na primeira abertura, toque em “Sim, ler QR Code”. Depois, use Configuração → Sincronização → Ler QR Code.',
        'Permita o uso da câmera e aponte para este QR.']});
    if (invite && Date.now() < invite.until) draw(); else void generate('web');
  }
  function pairLocal() {
    step = 'local';
    layout({title:'Vincular Android ou computador',
      text:'Use o mesmo Wi-Fi nos dois aparelhos e deixe a Moneta aberta nos dois.',
      list:['No outro aparelho, abra Configuração → Sincronização entre aparelhos.',
        'Toque em “Ler QR de outro aparelho” e aponte a câmera para este QR. Sem câmera, use uma foto do QR.']});
    void generate('local');
  }
  function expire() {
    el('qr').hidden = true;
    note('O QR expirou. Gere outro para vincular.');
    el('qr-refresh').hidden = false;
  }
  function finish(device) {
    invite = null; clearInterval(poll);
    el('qr').hidden = el('network').hidden = true;
    el('qr-next').hidden = el('qr-back').hidden = el('qr-steps').hidden = true;
    el('qr-title').textContent = 'Aparelhos vinculados';
    el('qr-instructions').textContent = device.name+' agora sincroniza com esta Moneta pela rede Wi-Fi.';
    note('');
    el('qr-close').textContent = 'Concluir';
  }
  el('address').onchange = draw;
  el('qr-ios').onclick = profile;
  el('qr-android').onclick = pairLocal;
  el('qr-scan').onclick = () => { dialog.close(); location.hash = '#configuracao'; void camera(); };
  el('qr-next').onclick = pairWeb;
  el('qr-back').onclick = () => step === 'web' ? profile() : choose();
  el('qr-refresh').onclick = () => step === 'local' ? pairLocal() : step === 'profile' ? profile() : void generate('web');
  el('qr-close').onclick = () => dialog.close();
  dialog.onclose = () => {
    invite = null; step = null; clearInterval(poll);
    el('qr').removeAttribute('src');
    localStorage.setItem(welcome,'done');
  };
  el('show').onclick = choose;

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
    if (!confirm('Vincular este aparelho e sincronizar os dados financeiros dos dois?')) return;
    say('Vinculando…');
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
  async function camera() {
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
    } catch (error) { stop(); say(error.message && !/getUserMedia|NotAllowed|NotFound/.test(error.name+error.message) ? error.message : 'Não foi possível usar a câmera. Selecione uma foto do QR.'); }
  }
  el('camera').onclick = camera;
  document.addEventListener('visibilitychange',() => { if (document.hidden) stop(); else void status(true); });
  window.addEventListener('hashchange',() => { if (location.hash !== '#configuracao') stop(); });
  void status(true); setInterval(status,10000);
}
