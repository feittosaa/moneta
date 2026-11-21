// Ponte com o app Android: a senha do modo cofre fica guardada pelo Keystore e só sai depois da
// digital, do rosto ou do bloqueio de tela. Em outros aparelhos, MonetaDevice não existe.
const bridge = globalThis.MonetaDevice;

export function biometricState() {
  try { return bridge ? bridge.biometric() : 'unavailable'; } catch { return 'unavailable'; }
}

function call(method, ...args) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const listener = event => {
      let detail;
      try { detail = JSON.parse(event.detail); } catch { return; }
      if (detail.id !== id) return;
      window.removeEventListener('moneta-device', listener);
      if (detail.ok) resolve(detail.value);
      else reject(Object.assign(new Error(detail.value === 'cancel' ? 'Cancelado.' : detail.value), { cancel: detail.value === 'cancel', missing: detail.value === 'missing' }));
    };
    window.addEventListener('moneta-device', listener);
    bridge[method](...args, id);
  });
}

export const enrollBiometric = password => call('enroll', password);
export const biometricPassword = () => call('unlock');
export function forgetBiometric() { try { bridge?.forget(); } catch {} }
