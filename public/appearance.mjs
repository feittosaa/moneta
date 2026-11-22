// Tema e cor de destaque: o seletor da Configuração, as amostras de cor e o atalho de claro e
// escuro no menu. As cores são calculadas pelo theme.js, que já roda antes da página aparecer.
const presets = [
  ['Moneta', '#ff4814'], ['Vermelho', '#e5383b'], ['Rosa', '#e0457b'], ['Roxo', '#8b5cf6'], ['Azul', '#3b82f6'],
  ['Ciano', '#0ea5b7'], ['Verde', '#22a06b'], ['Âmbar', '#e8a317'],
];

export function setupAppearance(onChange = () => {}) {
  const theme = globalThis.MonetaTheme;
  if (!theme) return;
  const palette = document.querySelector('#accent');
  const swatches = presets.map(([name,color]) => {
    const button = document.createElement('button');
    Object.assign(button,{type:'button',title:name,className:'swatch'});
    button.setAttribute('role','radio');
    button.setAttribute('aria-label',name+(color === theme.defaultAccent ? ' (padrão)' : ''));
    button.style.setProperty('--swatch',color);
    button.dataset.color = color;
    button.onclick = () => theme.setAccent(color);
    return button;
  });
  const custom = document.createElement('label');
  custom.className = 'swatch custom';
  custom.title = 'Outra cor';
  const picker = Object.assign(document.createElement('input'),{type:'color'});
  picker.setAttribute('aria-label','Escolher outra cor');
  picker.oninput = () => theme.setAccent(picker.value);
  custom.append(picker);
  palette?.replaceChildren(...swatches,custom);

  const choices = document.querySelectorAll('[data-theme-choice]');
  for (const button of choices) button.onclick = () => theme.setTheme(button.dataset.themeChoice);

  function reflect() {
    const choice = theme.theme(), shown = document.documentElement.dataset.theme, color = theme.accent();
    for (const button of choices) {
      // No menu só há claro e escuro, então ele marca o que está na tela; a Configuração marca a escolha.
      const active = button.closest('#theme-switch') ? button.dataset.themeChoice === shown : button.dataset.themeChoice === choice;
      button.setAttribute(button.getAttribute('role') === 'radio' ? 'aria-checked' : 'aria-pressed',String(active));
    }
    let matched = false;
    for (const button of swatches) {
      const active = button.dataset.color === color;
      matched ||= active;
      button.setAttribute('aria-checked',String(active));
    }
    custom.classList.toggle('active',!matched);
    custom.style.setProperty('--swatch',matched ? 'transparent' : color);
    picker.value = color;
  }
  reflect();
  addEventListener('moneta-appearance',() => { reflect(); onChange(); });
}
