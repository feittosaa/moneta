// Aplica o tema e a cor de destaque antes da primeira pintura, para não piscar a aparência errada.
// As escolhas ficam neste navegador. Sem cor escolhida, valem as cores do style.css.
(() => {
  const root = document.documentElement;
  const systemLight = matchMedia('(prefers-color-scheme: light)');
  const defaultAccent = '#ff4814';
  const derived = ['--accent','--accent-ink','--accent-soft','--on-accent','--nav-active','--track','--toast','--toast-line',
    '--hero-line','--hero-bg','--hero-eyebrow','--hero-note','--hero-frame','--orbit','--chart-net'];

  const valid = color => /^#[0-9a-f]{6}$/i.test(color || '');
  const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
  const hex = values => '#'+values.map(v => Math.round(Math.min(255,Math.max(0,v))).toString(16).padStart(2,'0')).join('');
  const mix = (a, b, amount) => hex(rgb(a).map((v,i) => v+(rgb(b)[i]-v)*amount));
  const luminance = color => {
    const [r,g,b] = rgb(color).map(v => { v /= 255; return v <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4; });
    return .2126*r+.7152*g+.0722*b;
  };
  const contrast = (a, b) => { const [x,y] = [luminance(a),luminance(b)].sort((m,n) => n-m); return (x+.05)/(y+.05); };
  // Clareia ou escurece até a cor ser legível como texto sobre o fundo.
  function legible(color, background, toward) {
    for (let step = 0; step <= 20 && contrast(color,background) < 4.5; step++) color = mix(color,toward,.08);
    return color;
  }

  function palette(accent, light) {
    const panel = light ? '#fffdf8' : '#191e22', canvas = light ? '#f4efe6' : '#101316';
    const onAccent = contrast(accent,'#ffffff') >= contrast(accent,'#1a1a1a') ? '#ffffff' : mix(accent,'#000000',.87);
    if (light) {
      const eyebrow = legible(mix(accent,'#000000',.45),'#ffe9dc','#000000');
      return {'--accent':accent,'--accent-ink':legible(accent,panel,'#000000'),'--accent-soft':mix(accent,'#ffffff',.3),
        '--on-accent':onAccent,'--nav-active':mix(panel,accent,.12),'--track':mix(panel,accent,.1),'--toast':mix(panel,accent,.1),
        '--toast-line':mix(panel,accent,.4),'--hero-line':mix(panel,accent,.4),
        '--hero-bg':`linear-gradient(107deg,${mix('#ffffff',accent,.06)} 20%,${mix('#ffffff',accent,.18)} 64%,${mix('#ffffff',accent,.5)})`,
        '--hero-eyebrow':eyebrow,'--hero-note':mix(eyebrow,'#555555',.4),'--hero-frame':eyebrow+'26','--orbit':accent+'55',
        '--chart-net':mix(accent,'#000000',.1)};
    }
    return {'--accent':accent,'--accent-ink':legible(accent,panel,'#ffffff'),'--accent-soft':mix(accent,'#ffffff',.42),
      '--on-accent':onAccent,'--nav-active':mix(panel,accent,.15),'--track':mix(panel,accent,.12),'--toast':mix(panel,accent,.14),
      '--toast-line':mix(panel,accent,.45),'--hero-line':mix(panel,accent,.38),
      '--hero-bg':`linear-gradient(107deg,${mix(canvas,accent,.14)} 20%,${mix(canvas,accent,.3)} 64%,${mix(accent,'#000000',.4)})`,
      '--hero-eyebrow':mix(accent,'#ffffff',.88),'--hero-note':mix(accent,'#e6e6e6',.85),'--hero-frame':mix(accent,'#ffffff',.88)+'30',
      '--orbit':accent+'66','--chart-net':mix(accent,'#ffffff',.15)};
  }

  function theme() {
    const choice = localStorage.getItem('moneta-theme');
    return ['dark','light'].includes(choice) ? choice : 'system';
  }
  function accent() {
    const color = localStorage.getItem('moneta-accent');
    return valid(color) ? color.toLowerCase() : defaultAccent;
  }
  function apply() {
    const choice = theme(), light = choice === 'light' || (choice === 'system' && systemLight.matches);
    root.dataset.theme = light ? 'light' : 'dark';
    const color = accent();
    if (color === defaultAccent) for (const name of derived) root.style.removeProperty(name);
    else for (const [name,value] of Object.entries(palette(color,light))) root.style.setProperty(name,value);
  }
  function save(name, value) {
    if (value) localStorage.setItem(name,value); else localStorage.removeItem(name);
    apply();
    dispatchEvent(new Event('moneta-appearance'));
  }

  globalThis.MonetaTheme = {
    defaultAccent, theme, accent, apply,
    setTheme: choice => save('moneta-theme',['dark','light'].includes(choice) ? choice : ''),
    setAccent: color => save('moneta-accent',valid(color) && color.toLowerCase() !== defaultAccent ? color.toLowerCase() : ''),
  };
  apply();
  systemLight.addEventListener('change',() => { apply(); dispatchEvent(new Event('moneta-appearance')); });
})();
