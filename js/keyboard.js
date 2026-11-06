// Klaviatur mit Fingersatz-Markierungen, Bewegungspfeilen, gleitenden Fingernummern,
// Zoom (bis echte Tastengröße) und mitlaufendem Ausschnitt.

export const FINGER = {
  dark:   { 1: '#C2410C', 2: '#15803D', 3: '#1D4ED8', 4: '#7E22CE', 5: '#BE185D' },
  tint:   { 1: '#FFE4D3', 2: '#D7F5E1', 3: '#DCE6FF', 4: '#F0E1FF', 5: '#FFDDEB' },
  bright: { 1: '#FB923C', 2: '#4ADE80', 3: '#60A5FA', 4: '#C084FC', 5: '#F472B6' },
};
const LH = { dark: '#334155', tint: '#CBD5E1', bright: '#94A3B8' };

/** Breite einer weißen Taste am echten Klavier (Oktave ≈ 165 mm). */
export const REAL_KEY_MM = 23.5;

const WHITE_OF = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
export const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
const whiteAbs = (m) => Math.floor(m / 12) * 7 + WHITE_OF[((m % 12) + 12) % 12];

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

export class Keyboard {
  /**
   * @param {HTMLElement} root  Container
   * @param {object} opts { lo, hi (MIDI, lo = ein C), arrows, labels, onKey(midi), keyName(midi), onZoom(scale) }
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = Object.assign({ lo: 36, hi: 76, arrows: true, labels: true, onKey: null, keyName: (m) => String(m), onZoom: null }, opts);
    this.view = { cur: null, next: null, glide: false, dur: 0, aids: true, showLH: true, showRH: true, focus: 'rh' };
    this.keyWidth = 0;      // gewünschte Tastenbreite in px (0 = ganze Klaviatur einpassen)
    this.offset = 0;
    this.build();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.root);
    this.bindPinch();
  }

  destroy() { this.ro.disconnect(); this.root.innerHTML = ''; }

  /** Tastenbreite setzen (px). 0 oder kleiner als "einpassen" → ganze Klaviatur sichtbar. */
  setKeyWidth(px) {
    this.keyWidth = px || 0;
    this.layout();
  }

  /** Breite einer weißen Taste, wenn die ganze Klaviatur ins Bild passt (kleinste Darstellung). */
  get fitWidth() { return (this.viewport.clientWidth || 1) / this.whiteCount; }

  build() {
    const { lo, hi } = this.opts;
    this.root.innerHTML = '';
    this.root.classList.add('kb');
    this.viewport = el('div', 'kb-viewport', this.root);
    this.track = el('div', 'kb-track', this.viewport);
    this.arrowLayer = this.opts.arrows ? el('div', 'kb-arrows', this.track) : null;
    if (this.arrowLayer) this.arrowLayer.setAttribute('aria-hidden', 'true');
    this.keysEl = el('div', 'kb-keys', this.track);
    this.keysEl.setAttribute('role', 'group');
    this.keysEl.setAttribute('aria-label', 'Klaviatur');
    this.keys = new Map();
    const whites = [], blacks = [];
    for (let m = lo; m <= hi; m++) (isBlack(m) ? blacks : whites).push(m);
    for (const m of whites.concat(blacks)) {
      const b = el('button', 'key ' + (isBlack(m) ? 'black' : 'white'), this.keysEl);
      b.type = 'button';
      b.setAttribute('aria-label', this.opts.keyName(m));
      if (this.opts.labels && !isBlack(m) && m % 12 === 0) b.textContent = this.opts.keyName(m);
      b.addEventListener('pointerdown', (e) => {
        if (this.pinching) return;
        e.preventDefault(); b.classList.add('down'); this.opts.onKey && this.opts.onKey(m);
      });
      const up = () => b.classList.remove('down');
      b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
      this.keys.set(m, b);
    }
    this.whiteCount = whites.length;
    this.overlay = el('div', 'kb-overlay', this.keysEl);
    this.overlay.setAttribute('aria-hidden', 'true');
    this.pillLayer = el('div', 'kb-layer', this.overlay);
    this.ghostLayer = el('div', 'kb-layer', this.overlay);
    this.markerLayer = el('div', 'kb-layer', this.overlay);
    this.markers = [0, 1, 2, 3].map((i) => el('div', 'kb-marker' + (i === 3 ? ' lh' : ''), this.markerLayer));
    this.layout();
  }

  layout() {
    const vw = this.viewport.clientWidth;
    const h = this.keysEl.clientHeight;
    if (!vw || !h) return;
    const fit = vw / this.whiteCount;
    // So groß wie gewünscht – aber ein ganzer Akkordwechsel muss ins Bild passen (iPhone!)
    const minKeys = this.view.focus === 'lh' ? 5 : 8;
    this.W = Math.max(fit, Math.min(this.keyWidth || 0, vw / minKeys));
    this.H = h;
    this.HB = Math.round(h * 0.62);
    this.BW = Math.round(this.W * 0.58);
    this.S = Math.round(Math.max(20, Math.min(40, this.W * 0.62)));
    this.trackWidth = this.W * this.whiteCount;
    this.track.style.width = this.trackWidth + 'px';
    const base = whiteAbs(this.opts.lo);
    for (const [m, b] of this.keys) {
      if (isBlack(m)) {
        const x = (whiteAbs(m - 1) - base + 1) * this.W - this.BW / 2;
        Object.assign(b.style, { left: x + 'px', width: this.BW + 'px', height: this.HB + 'px' });
      } else {
        const x = (whiteAbs(m) - base) * this.W;
        Object.assign(b.style, { left: x + 'px', width: (this.W - 1.5) + 'px', height: this.H + 'px' });
      }
    }
    this.root.style.setProperty('--marker', this.S + 'px');
    this.paint(true);
  }

  center(m) {
    const base = whiteAbs(this.opts.lo);
    if (isBlack(m)) return (whiteAbs(m - 1) - base + 1) * this.W;
    return (whiteAbs(m) - base) * this.W + this.W / 2;
  }

  markerPos(m) {
    const S = this.S;
    return { x: this.center(m) - S / 2, y: isBlack(m) ? this.HB - S - 10 : this.H - S - 14 };
  }

  inRange(m) { return m >= this.opts.lo && m <= this.opts.hi; }

  /** Ansicht aktualisieren. v: { cur:{notes,fingers,bass}, next, glide, dur(ms), aids, showLH, showRH, focus:'rh'|'lh'|'both' } */
  update(v) {
    const focusChanged = v.focus && v.focus !== this.view.focus;
    Object.assign(this.view, v);
    if (focusChanged) this.layout(); else this.paint(false);
  }

  /** Ausschnitt so verschieben, dass die gerade wichtigen Tasten mittig zu sehen sind. */
  pan(instant) {
    const vw = this.viewport.clientWidth;
    const { cur, next, focus, showLH, showRH } = this.view;
    let target = 0;
    if (this.trackWidth > vw + 1 && cur) {
      const set = [];
      const add = (c) => {
        if (!c) return;
        if (focus !== 'lh' && showRH) set.push(...c.notes);
        if (focus !== 'rh' && showLH) set.push(c.bass);
      };
      add(cur); add(next);
      if (!set.length) set.push(...cur.notes);
      let lo = Math.min(...set), hi = Math.max(...set);
      let x0 = this.center(lo) - this.W, x1 = this.center(hi) + this.W;
      // Passen nicht beide Hände ins Bild, hat die rechte Hand Vorrang
      if (x1 - x0 > vw && focus === 'both') {
        const r = [...cur.notes, ...(next ? next.notes : [])];
        x0 = this.center(Math.min(...r)) - this.W; x1 = this.center(Math.max(...r)) + this.W;
      }
      target = (x0 + x1) / 2 - vw / 2;
      target = Math.max(0, Math.min(this.trackWidth - vw, target));
    }
    this.track.style.transition = instant ? 'none' : 'transform 650ms cubic-bezier(.45,.05,.35,1)';
    this.offset = target;
    this.track.style.transform = `translateX(${-target}px)`;
  }

  paint(instant) {
    if (!this.W) return;
    const { cur, next, glide, dur, aids, showLH, showRH } = this.view;
    const shown = glide && next ? next : cur;
    const lhOn = showLH && cur && this.inRange(cur.bass);

    // Tasten einfärben
    for (const [, b] of this.keys) { b.style.background = ''; }
    if (aids && shown) {
      if (showRH) shown.notes.forEach((m, i) => {
        const b = this.keys.get(m); if (!b) return;
        b.style.background = isBlack(m) ? FINGER.dark[shown.fingers[i]] : FINGER.tint[shown.fingers[i]];
      });
      if (lhOn) {
        const bm = shown.bass, b = this.keys.get(bm);
        if (b) b.style.background = isBlack(bm) ? LH.dark : LH.tint;
      }
    }

    // Gleitende Fingernummern: ein Marker pro Stimme, damit er von Taste zu Taste wandern kann
    const ms = instant || !glide ? 0 : Math.max(0, dur || 0);
    const trans = ms ? `transform ${ms}ms cubic-bezier(.45,.05,.35,1), background-color ${ms}ms, color ${ms}ms, border-color ${ms}ms, box-shadow ${ms}ms` : 'none';
    this.markers.forEach((mk, i) => {
      const isLH = i === 3;
      const visible = aids && cur && (isLH ? lhOn : showRH);
      if (!visible) { mk.style.display = 'none'; return; }
      mk.style.display = '';
      const from = isLH ? cur.bass : cur.notes[i];
      const to = next ? (isLH ? next.bass : next.notes[i]) : from;
      const m = glide && next ? to : from;
      const f = isLH ? null : (glide && next ? next.fingers[i] : cur.fingers[i]);
      const p = this.markerPos(m);
      mk.style.transition = trans;
      mk.style.transform = `translate(${p.x}px, ${p.y}px)`;
      mk.textContent = isLH ? 'L' : String(f);
      const dark = isLH ? LH.dark : FINGER.dark[f];
      const onBlack = isBlack(m);
      mk.style.background = onBlack ? '#fff' : dark;
      mk.style.color = onBlack ? dark : '#fff';
      mk.style.borderColor = dark;
      const moving = glide && next && from !== to;
      mk.style.boxShadow = moving ? `0 0 0 6px ${(isLH ? LH.bright : FINGER.bright[f])}66` : 'none';
    });

    // Landeplätze (gestrichelt) und "bleibt"-Hinweise
    this.ghostLayer.innerHTML = '';
    this.pillLayer.innerHTML = '';
    if (aids && cur && next) {
      if (showRH) next.notes.forEach((m, i) => {
        if (cur.notes.includes(m)) return;
        this.ghost(m, String(next.fingers[i]), FINGER.dark[next.fingers[i]], glide);
      });
      if (lhOn && next.bass !== cur.bass && this.inRange(next.bass)) this.ghost(next.bass, 'L', LH.dark, glide);
      if (!glide && showRH) cur.notes.forEach((m, i) => {
        if (next.notes[i] !== m) return;
        this.pill(m);
      });
      if (!glide && lhOn && next.bass === cur.bass) this.pill(cur.bass);
    }

    this.paintArrows();
    // Ausschnitt mitführen: beim Gleiten so schnell wie die Finger, sonst sanft
    this.pan(instant);
  }

  pill(m) {
    const p = this.markerPos(m);
    const pill = el('div', 'kb-pill', this.pillLayer);
    pill.textContent = 'bleibt';
    pill.style.transform = `translate(${this.center(m) - 24}px, ${p.y - 22}px)`;
  }

  ghost(m, text, color, faded) {
    const p = this.markerPos(m);
    const g = el('div', 'kb-marker ghost', this.ghostLayer);
    g.textContent = text;
    g.style.transform = `translate(${p.x}px, ${p.y}px)`;
    g.style.color = color;
    g.style.borderColor = color;
    if (faded) g.style.opacity = '0.5';
  }

  paintArrows() {
    if (!this.arrowLayer) return;
    this.arrowLayer.innerHTML = '';
    const { cur, next, aids, showRH, showLH } = this.view;
    if (!aids || !cur || !next) return;
    const step = Math.min(18, Math.max(10, (this.arrowLayer.clientHeight - 20) / 2));
    const arrow = (a, b, col, label, row) => {
      if (a === b) return;
      const x1 = this.center(a), x2 = this.center(b), top = 10 + row * step;
      const line = el('div', 'kb-arrow', this.arrowLayer);
      Object.assign(line.style, { left: Math.min(x1, x2) + 'px', width: Math.abs(x2 - x1) + 'px', top: top + 'px', background: col });
      const head = el('div', 'kb-arrowhead ' + (x2 > x1 ? 'right' : 'left'), this.arrowLayer);
      Object.assign(head.style, { left: (x2 > x1 ? x2 - 12 : x2) + 'px', top: (top - 5.5) + 'px', color: col });
      const chip = el('div', 'kb-chip', this.arrowLayer);
      chip.textContent = label;
      Object.assign(chip.style, { left: (x1 - 10) + 'px', top: (top - 8.5) + 'px', background: col });
    };
    if (showRH) for (let i = 0; i < 3; i++) arrow(cur.notes[i], next.notes[i], FINGER.bright[next.fingers[i]], String(next.fingers[i]), i);
    if (showLH && this.inRange(cur.bass) && this.inRange(next.bass)) arrow(cur.bass, next.bass, LH.bright, 'L', showRH ? 1 : 1);
  }

  // Zwei-Finger-Zoom: Safari (iPad) meldet "gesturechange" mit e.scale; am Rechner Strg + Mausrad
  bindPinch() {
    let startW = 0;
    const apply = (w) => { this.opts.onZoom && this.opts.onZoom(w); };
    this.viewport.addEventListener('gesturestart', (e) => { e.preventDefault(); this.pinching = true; startW = this.W; });
    this.viewport.addEventListener('gesturechange', (e) => { e.preventDefault(); apply(startW * e.scale); });
    this.viewport.addEventListener('gestureend', (e) => { e.preventDefault(); setTimeout(() => { this.pinching = false; }, 50); });
    this.viewport.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      apply(this.W * Math.exp(-e.deltaY * 0.01));
    }, { passive: false });
  }
}

/**
 * Wie viele CSS-Pixel entsprechen 1 mm auf diesem Bildschirm? Browser verraten das nicht direkt –
 * daher eine Schätzung nach Gerät (Kalibrierung in den Einstellungen überschreibt sie).
 */
export function estimatePxPerMm() {
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const short = Math.min(screen.width, screen.height), long = Math.max(screen.width, screen.height);
  if (/iPad/.test(ua) || touchMac) {
    if (short === 744 || short === 768 && long === 1024 && devicePixelRatio === 2 && /mini/i.test(ua)) return 163 / 25.4; // iPad mini
    return 132 / 25.4;              // iPad, iPad Air, iPad Pro: 264 ppi bei Faktor 2
  }
  if (/iPhone/.test(ua)) return (devicePixelRatio >= 3 ? 153 : 163) / 25.4;
  if (/Android/.test(ua)) return 160 / 25.4;
  return 96 / 25.4;                 // Rechner
}
