// Start-Bildschirm: Nebel-Hintergrund, Schriftzug schreibt sich selbst, Ton freischalten, Versionsnummer.
// Aufbau wie in der Ambientpad-App.

export function initSplash({ engine, version, onStart }) {
  const un = document.getElementById('unlock');
  const btn = document.getElementById('unlockBtn');
  const hint = document.getElementById('unlockHint');
  document.getElementById('unlockVersion').textContent = 'Version ' + version;

  drawNebula(un, document.getElementById('nebel'));
  writeLettering(un.querySelector('.hello'));

  let welcomed = false;
  const hide = () => {
    if (un.classList.contains('hidden')) return;
    un.classList.add('hidden');
    if (!welcomed) { welcomed = true; onStart && onStart(); }
  };
  const check = () => {
    if (engine.running) { hint.textContent = ''; hide(); }
    else hint.textContent = 'Noch gesperrt – bitte nochmal tippen.';
  };

  btn.addEventListener('click', () => {
    engine.unlock();
    // resume() ist asynchron – kurz warten, dann prüfen
    setTimeout(check, 350);
  });

  // iOS gibt Ton bei "touchend" frei – jeder Tipp irgendwo hilft mit
  document.addEventListener('touchend', () => { if (engine.ac && !engine.running) engine.unlock(); }, { passive: true });

  // Nach dem Zurückkehren in die App ist der Ton oft wieder gesperrt → Start-Bildschirm erneut zeigen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    setTimeout(() => { if (engine.ac && !engine.running) { hint.textContent = ''; un.classList.remove('hidden'); } }, 300);
  });
}

// Weicher Nebel in den App-Farben – einmal gezeichnet, mit feinem Rauschen gegen Farbstufen
function drawNebula(un, cv) {
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext('2d', { alpha: false });
  const B = [
    { x: .22, y: .15, r: .95, c: [245, 184, 61], a: .95 },  // Bernstein (Akzentfarbe)
    { x: .98, y: .50, r: .95, c: [190, 24, 93], a: .85 },   // Magenta (kleiner Finger)
    { x: .22, y: .98, r: 1.0, c: [29, 78, 216], a: .95 },   // Blau (Mittelfinger)
    { x: .52, y: .46, r: .62, c: [255, 220, 150], a: .38 },
  ];
  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, un.clientWidth), h = Math.max(1, un.clientHeight);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width === W && cv.height === H) return;
    cv.width = W; cv.height = H;
    const D = Math.hypot(W, H) / 2;
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of B) {
      const cx = b.x * W, cy = b.y * H, r = b.r * D, k = b.a * 1.1;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      for (let i = 0; i <= 12; i++) { const p = i / 12; g.addColorStop(p, `rgba(${b.c},${(.62 * k * Math.exp(-4.2 * p * p) * (1 - p)).toFixed(4)})`); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - .5) * 2.2; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    ctx.putImageData(img, 0, 0);
  }
  draw();
  addEventListener('resize', () => { clearTimeout(draw.t); draw.t = setTimeout(draw, 200); });
}

// „Keys2Worship“ schreibt sich selbst – Buchstabe für Buchstabe, dann füllt er sich
function writeLettering(svg) {
  if (!svg) return;
  const gs = [...svg.querySelectorAll('.g')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !gs.length || !gs[0].animate || !gs[0].getTotalLength) {
    gs.forEach((g) => { g.style.fillOpacity = 1; g.style.strokeOpacity = 0; });
    return;
  }
  const lens = gs.map((g) => g.getTotalLength());
  const sum = lens.reduce((a, b) => a + b, 0);
  const total = 3600;
  let t = 500;
  gs.forEach((g, i) => {
    const d = total * lens[i] / sum;
    g.style.strokeDasharray = lens[i];
    g.style.strokeDashoffset = lens[i];
    g.animate([{ strokeDashoffset: lens[i] }, { strokeDashoffset: 0 }], { duration: d, delay: t, easing: 'ease-in-out', fill: 'forwards' });
    g.animate([{ fillOpacity: 0 }, { fillOpacity: 1 }], { duration: 800, delay: t + d * .55, easing: 'ease-out', fill: 'forwards' });
    t += d * .9;
  });
}
