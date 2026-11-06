// Klaviatur mit Fingersatz-Markierungen, Bewegungspfeilen und gleitenden Fingernummern.

export const FINGER = {
  dark:   { 1: '#C2410C', 2: '#15803D', 3: '#1D4ED8', 4: '#7E22CE', 5: '#BE185D' },
  tint:   { 1: '#FFE4D3', 2: '#D7F5E1', 3: '#DCE6FF', 4: '#F0E1FF', 5: '#FFDDEB' },
  bright: { 1: '#FB923C', 2: '#4ADE80', 3: '#60A5FA', 4: '#C084FC', 5: '#F472B6' },
};
const LH = { dark: '#334155', tint: '#CBD5E1' };

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
   * @param {object} opts { lo, hi (MIDI, lo = ein C), arrows: bool, labels: bool, onKey(midi), keyName(midi) }
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = Object.assign({ lo: 36, hi: 72, arrows: true, labels: true, onKey: null, keyName: (m) => String(m) }, opts);
    this.view = { cur: null, next: null, glide: false, dur: 0, aids: true, showLH: true };
    this.build();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.root);
  }

  destroy() { this.ro.disconnect(); this.root.innerHTML = ''; }

  setRange(lo, hi) {
    if (lo === this.opts.lo && hi === this.opts.hi) return;
    this.opts.lo = lo; this.opts.hi = hi;
    this.build();
  }

  build() {
    const { lo, hi } = this.opts;
    this.root.innerHTML = '';
    this.root.classList.add('kb');
    this.arrowLayer = this.opts.arrows ? el('div', 'kb-arrows', this.root) : null;
    if (this.arrowLayer) this.arrowLayer.setAttribute('aria-hidden', 'true');
    this.keysEl = el('div', 'kb-keys', this.root);
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
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('down'); this.opts.onKey && this.opts.onKey(m); });
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
    const w = this.keysEl.clientWidth || this.root.clientWidth;
    const h = this.keysEl.clientHeight;
    if (!w || !h) return;
    this.W = w / this.whiteCount;
    this.H = h;
    this.HB = Math.round(h * 0.62);
    this.BW = Math.round(this.W * 0.62);
    this.S = Math.round(Math.max(20, Math.min(36, this.W * 0.68)));
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

  /** Ansicht aktualisieren. v: { cur:{notes,fingers,bass}, next, glide, dur(ms), aids, showLH } */
  update(v) {
    Object.assign(this.view, v);
    this.paint(false);
  }

  paint(instant) {
    if (!this.W) return;
    const { cur, next, glide, dur, aids, showLH } = this.view;
    const shown = glide && next ? next : cur;
    const showBass = showLH && cur && this.inRange(cur.bass);

    // Tasten einfärben
    for (const [m, b] of this.keys) { b.style.background = ''; b.classList.remove('lit'); }
    if (aids && shown) {
      shown.notes.forEach((m, i) => {
        const b = this.keys.get(m); if (!b) return;
        b.style.background = isBlack(m) ? FINGER.dark[shown.fingers[i]] : FINGER.tint[shown.fingers[i]];
        b.classList.add('lit');
      });
      if (showBass) {
        const bm = shown.bass, b = this.keys.get(bm);
        if (b) { b.style.background = isBlack(bm) ? LH.dark : LH.tint; b.classList.add('lit'); }
      }
    }

    // Gleitende Fingernummern: ein Marker pro Stimme, damit er von Taste zu Taste wandern kann
    const ms = instant || !glide ? 0 : Math.max(0, dur || 0);
    const trans = ms ? `transform ${ms}ms cubic-bezier(.45,.05,.35,1), background-color ${ms}ms, color ${ms}ms, border-color ${ms}ms, box-shadow ${ms}ms` : 'none';
    this.markers.forEach((mk, i) => {
      const isLH = i === 3;
      if (!aids || !cur || (isLH && !showBass)) { mk.style.display = 'none'; return; }
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
      mk.style.boxShadow = moving ? `0 0 0 6px ${(isLH ? '#94A3B8' : FINGER.bright[f])}66` : 'none';
    });

    // Landeplätze (gestrichelt) und "bleibt"-Hinweise
    this.ghostLayer.innerHTML = '';
    this.pillLayer.innerHTML = '';
    if (aids && cur && next) {
      next.notes.forEach((m, i) => {
        if (cur.notes.includes(m)) return;
        this.ghost(m, String(next.fingers[i]), FINGER.dark[next.fingers[i]], glide);
      });
      if (showBass && next.bass !== cur.bass && this.inRange(next.bass)) this.ghost(next.bass, 'L', LH.dark, glide);
      if (!glide) cur.notes.forEach((m, i) => {
        if (next.notes[i] !== m) return;
        const p = this.markerPos(m);
        const pill = el('div', 'kb-pill', this.pillLayer);
        pill.textContent = 'bleibt';
        pill.style.transform = `translate(${this.center(m) - 24}px, ${p.y - 22}px)`;
      });
    }

    this.paintArrows();
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
    const { cur, next, aids } = this.view;
    if (!aids || !cur || !next) return;
    for (let i = 0; i < 3; i++) {
      const a = cur.notes[i], b = next.notes[i];
      if (a === b) continue;
      const x1 = this.center(a), x2 = this.center(b), f = next.fingers[i], col = FINGER.bright[f];
      const top = 10 + i * 18;
      const line = el('div', 'kb-arrow', this.arrowLayer);
      Object.assign(line.style, { left: Math.min(x1, x2) + 'px', width: Math.abs(x2 - x1) + 'px', top: top + 'px', background: col });
      const head = el('div', 'kb-arrowhead ' + (x2 > x1 ? 'right' : 'left'), this.arrowLayer);
      Object.assign(head.style, { left: (x2 > x1 ? x2 - 12 : x2) + 'px', top: (top - 5.5) + 'px', color: col });
      const chip = el('div', 'kb-chip', this.arrowLayer);
      chip.textContent = String(f);
      Object.assign(chip.style, { left: (x1 - 10) + 'px', top: (top - 8.5) + 'px', background: col });
    }
  }
}
