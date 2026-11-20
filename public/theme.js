// Aplica o tema antes da primeira pintura, para não piscar o tema errado.
(()=>{const c=localStorage.getItem("moneta-theme");document.documentElement.dataset.theme=c==="light"||(c!=="dark"&&matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark"})();
