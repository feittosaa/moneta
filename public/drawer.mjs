// No celular, a navegação fica numa aba lateral aberta pelo botão de menu.
export function setupDrawer() {
  const aside = document.querySelector('aside');
  const toggle = document.querySelector('#menu-toggle');
  const backdrop = document.querySelector('#drawer-backdrop');
  if (!aside || !toggle || !backdrop) return;
  const set = open => {
    aside.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    backdrop.hidden = !open;
    document.documentElement.classList.toggle('drawer-open', open);
  };
  toggle.addEventListener('click', () => set(!aside.classList.contains('open')));
  backdrop.addEventListener('click', () => set(false));
  aside.querySelector('nav').addEventListener('click', event => { if (event.target.closest('a')) set(false); });
  addEventListener('keydown', event => { if (event.key === 'Escape' && aside.classList.contains('open')) { set(false); toggle.focus(); } });
  addEventListener('hashchange', () => set(false));
  matchMedia('(min-width:781px)').addEventListener('change', event => { if (event.matches) set(false); });
  // No celular, o olho e a sincronização moram na barra do topo; no computador, na barra da página.
  const actions = document.querySelector('#header-actions'), toolbar = document.querySelector('.toolbar');
  const mobile = matchMedia('(max-width:780px)');
  const place = () => { for (const id of ['#sync','#privacy']) (mobile.matches ? actions : toolbar).append(document.querySelector(id)); };
  if (actions && toolbar) { place(); mobile.addEventListener('change',place); }
}
