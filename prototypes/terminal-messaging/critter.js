// Random running critter — mirrors the live app (Branding.swift `Critters`):
// pick one of the six per task, cycle its 4 run-cycle frames. Uses the real
// PNGs from Resources/Critters so the prototypes show the actual animation.
window.IDCritter = (function () {
  const names = ["fox", "cat", "bunny", "dog", "duck", "hedgehog"];
  const base = "../../Resources/Critters/";
  const FPS_MS = 120;

  // Preload every frame once so cycling never flickers or hits disk mid-run.
  const cache = {};
  names.forEach(n => {
    cache[n] = [1, 2, 3, 4].map(i => {
      const im = new Image(); im.src = `${base}critter_${n}_${i}.png`; return im.src;
    });
  });

  // Mount a running critter into `el`. Random critter unless one is named.
  function mount(el, size = 22, name = null) {
    name = name || names[Math.floor(Math.random() * names.length)];
    const img = document.createElement('img');
    img.alt = name; img.className = 'id-critter';
    img.style.height = size + 'px'; img.style.width = 'auto';
    img.style.verticalAlign = '-0.32em';
    img.style.imageRendering = '-webkit-optimize-contrast';
    let f = 0;
    img.src = cache[name][f];
    el.appendChild(img);
    const timer = setInterval(() => { f = (f + 1) % 4; img.src = cache[name][f]; }, FPS_MS);
    return { el: img, name, stop: () => clearInterval(timer) };
  }

  // Mount into every element matching `sel` (each gets its own random critter).
  function mountAll(sel, size = 22) {
    document.querySelectorAll(sel).forEach(e => { e.innerHTML = ''; mount(e, size); });
  }

  return { mount, mountAll, names };
})();
