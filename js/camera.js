// AR-Modus: Live-Bild einer Kamera (z. B. Logitech StreamCam) von oben auf die echte Tastatur,
// darüber Fingernummern, Zielkreise und Pfeile – passend zu den Tasten im Bild.
//
// Kalibrierung: Vier Ecken des sichtbaren Tastenbereichs im Bild (hinten links, hinten rechts,
// vorne rechts, vorne links) plus die äußerste linke und rechte weiße Taste im Bild (per MIDI
// oder von Hand). Daraus berechnet eine Perspektiv-Abbildung, wo jede Taste im Bild liegt.

import { FINGER, isBlack } from './keyboard.js';

const WHITE_OF = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
const whiteAbs = (m) => Math.floor(m / 12) * 7 + WHITE_OF[((m % 12) + 12) % 12];
const LH_COLOR = '#94A3B8';
const NAMES_DE = ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H'];
export const DEFAULT_CALIB = { pts: [[0.12, 0.3], [0.88, 0.3], [0.9, 0.78], [0.1, 0.78]], lo: 48, hi: 71 }; // C3 bis H4 – dort liegen die Akkordlagen der App

/** Einheitsquadrat (0,0)(1,0)(1,1)(0,1) → Viereck p0..p3 (Heckbert). */
function squareToQuad(p) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const det = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };
}

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

/** Kameraliste (Namen gibt iOS erst nach einer Erlaubnis heraus). */
export async function listCameras(askPermission = false) {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  let devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  if (askPermission && devs.length && !devs.some((d) => d.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach((t) => t.stop());
      devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    } catch { /* abgelehnt */ }
  }
  return devs.map((d, i) => ({ id: d.deviceId, label: d.label || `Kamera ${i + 1}`, external: isExternal(d.label) }));
}
export function isExternal(label) {
  label = (label || '').toLowerCase();
  return !!label && !/(front|back|rück|vorder|ultra|tele|weitwinkel|wide|true ?depth|facetime|integriert|built-in)/.test(label);
}
export const cameraSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

export class CameraView {
  /**
   * @param {HTMLElement} root
   * @param {object} o { getCam(): Kamera-Einstellungen, saveCam(patch), keyName(midi), blackRatio }
   */
  constructor(root, o) {
    this.root = root;
    this.o = o;
    this.view = {};
    this.held = new Set();
    this.targetPcs = null;
    this.glideStart = 0;
    this.stream = null;
    this.calibrating = null;
    root.innerHTML = '';
    root.classList.add('cam');
    this.stage = el('div', 'cam-stage', root);
    this.video = el('video', 'cam-video', this.stage);
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('autoplay', '');
    this.video.muted = true;
    this.canvas = el('canvas', 'cam-overlay', this.stage);
    this.canvas.setAttribute('aria-hidden', 'true');
    this.badge = el('div', 'cam-badge', this.stage, '<span class="cam-dot"></span><span class="cam-name">Kamera wird gestartet …</span>');
    this.msg = el('div', 'cam-msg', this.stage);
    this.msg.hidden = true;
    this.calibLayer = el('div', 'cam-calib', this.stage);
    this.calibLayer.hidden = true;
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.stage);
    this.video.addEventListener('loadedmetadata', () => this.layout());
    this.applyTransform();
  }

  get cam() { return this.o.getCam(); }

  async start() {
    this.stop();
    if (!cameraSupported()) return this.fail('Dieser Browser gibt Webseiten keinen Kamerazugriff.');
    const id = this.cam.deviceId;
    const want = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    try {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: id ? { ...want, deviceId: { exact: id } } : want });
      } catch (e) {
        if (!id || e.name === 'NotAllowedError') throw e;
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: want }); // gespeicherte Kamera fehlt
      }
      // Noch keine Kamera gewählt: externe bevorzugen
      if (!id) {
        const ext = (await listCameras()).find((c) => c.external);
        const curId = this.stream.getVideoTracks()[0]?.getSettings?.().deviceId;
        if (ext && ext.id !== curId) {
          this.stream.getTracks().forEach((t) => t.stop());
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...want, deviceId: { exact: ext.id } } });
        }
      }
      const track = this.stream.getVideoTracks()[0];
      const sid = track?.getSettings?.().deviceId;
      if (sid && sid !== this.cam.deviceId) this.o.saveCam({ deviceId: sid });
      this.video.srcObject = this.stream;
      try { await this.video.play(); } catch { /* autoplay */ }
      this.badge.querySelector('.cam-name').textContent = 'Live · ' + (track?.label || 'Kamera');
      this.badge.classList.add('live');
      this.msg.hidden = true;
      this.layout();
      return true;
    } catch (e) {
      const n = e && e.name;
      this.fail(n === 'NotAllowedError' ? 'Kein Zugriff auf die Kamera. In den iPad-Einstellungen unter Datenschutz › Kamera den Browser erlauben, dann neu laden.'
        : n === 'NotReadableError' ? 'Die Kamera wird gerade von einer anderen App benutzt (z. B. FaceTime). Diese schließen und erneut versuchen.'
        : n === 'NotFoundError' ? 'Keine Kamera gefunden. USB-C-Kabel prüfen.'
        : 'Kamera startet nicht: ' + (e && e.message || e));
      return false;
    }
  }

  fail(text) {
    this.badge.querySelector('.cam-name').textContent = 'Keine Kamera';
    this.badge.classList.remove('live');
    this.msg.hidden = false;
    this.msg.innerHTML = '';
    el('p', '', this.msg).textContent = text;
    const b = el('button', 'btn primary', this.msg, 'Erneut versuchen');
    b.type = 'button';
    b.onclick = () => this.start();
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  destroy() { this.stop(); cancelAnimationFrame(this.raf); this.ro.disconnect(); this.root.innerHTML = ''; this.root.classList.remove('cam'); }

  applyTransform() {
    const c = this.cam;
    const t = [];
    if (c.rotate) t.push('rotate(180deg)');
    if (c.mirror) t.push('scaleX(-1)');
    this.video.style.transform = t.join(' ');
  }

  /** Bildbereich des Videos im Rahmen (object-fit: contain). */
  videoRect() {
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    const vw = this.video.videoWidth || 16, vh = this.video.videoHeight || 9;
    const s = Math.min(W / vw, H / vh);
    const w = vw * s, h = vh * s;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  layout() {
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.placeHandles();
    this.draw();
  }

  calib() { return this.calibrating ? this.calibrating.draft : (this.cam.calib || null); }

  /** Abbildung Tastatur-Koordinaten (u: 0 = linker Rand der linken Taste … 1, v: 0 = hinten … 1 = vorne) → Pixel. */
  mapper() {
    const c = this.calib();
    if (!c) return null;
    const r = this.videoRect();
    const pts = c.pts.map(([x, y]) => [r.x + x * r.w, r.y + y * r.h]);
    const f = squareToQuad(pts);
    const wlo = whiteAbs(c.lo), count = whiteAbs(c.hi) - wlo + 1;
    return { f, wlo, count, c };
  }

  keyU(mp, m) {
    if (isBlack(m)) return (whiteAbs(m - 1) - mp.wlo + 1) / mp.count;
    return (whiteAbs(m) - mp.wlo + 0.5) / mp.count;
  }
  inView(mp, m) { return m >= mp.c.lo && m <= mp.c.hi; }

  /** Ansicht wie bei der Klaviatur: { cur, next, glide, dur, aids, showRH, showLH } */
  update(v) {
    const wasGlide = this.view.glide;
    this.view = Object.assign({}, this.view, v);
    if (this.view.glide && !wasGlide) { this.glideStart = performance.now(); this.animate(); }
    else this.draw();
  }

  setHeld(held, targetPcs) { this.held = new Set(held); this.targetPcs = targetPcs; this.draw(); }

  animate() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      this.draw();
      if (this.view.glide && performance.now() - this.glideStart < (this.view.dur || 0) + 50) this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  draw() {
    const ctx = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mp = this.mapper();
    if (!mp) return;
    const cam = this.cam;
    const vBlack = Math.max(0.35, Math.min(0.75, this.o.blackRatio ? this.o.blackRatio() : 0.6));

    if (this.calibrating) return this.drawCalibGrid(ctx, mp, vBlack);

    ctx.globalAlpha = cam.opacity ?? 0.8;
    // Am MIDI-Keyboard gedrückte Tasten: grün = richtig, rot = falscher Ton
    for (const m of this.held) {
      if (!this.inView(mp, m)) continue;
      const ok = !this.targetPcs || this.targetPcs.has(m % 12);
      ctx.fillStyle = ok ? 'rgba(74,222,128,.5)' : 'rgba(248,113,113,.55)';
      this.keyPoly(ctx, mp, m, vBlack);
      ctx.fill();
    }

    const { cur, next, glide, dur, aids, showRH, showLH } = this.view;
    if (!cur || cam.fingers === false) { this.outOfView(mp, cur); return; }
    const t = glide && next ? Math.min(1, (performance.now() - this.glideStart) / Math.max(1, dur || 1)) : 0;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const voices = [];
    if (showRH) cur.notes.forEach((m, i) => voices.push({ from: m, to: next ? next.notes[i] : m, f: cur.fingers[i], f2: next ? next.fingers[i] : cur.fingers[i], lh: false }));
    if (showLH) voices.push({ from: cur.bass, to: next ? next.bass : cur.bass, f: 'L', f2: 'L', lh: true });

    const showAids = aids && cam.aids !== false && next;
    // Zielkreise, Pfeile, „bleibt“
    if (showAids) for (const vc of voices) {
      if (vc.from === vc.to) {
        if (!glide && this.inView(mp, vc.from)) this.pill(ctx, mp, vc.from, vBlack);
        continue;
      }
      if (!this.inView(mp, vc.to)) continue;
      const col = vc.lh ? LH_COLOR : FINGER.bright[vc.f2];
      ctx.globalAlpha = (cam.opacity ?? 0.8) * (glide ? 0.5 : 1);
      this.ghost(ctx, mp, vc.to, String(vc.f2), col, vBlack);
      ctx.globalAlpha = cam.opacity ?? 0.8;
      if (!glide && this.inView(mp, vc.from)) this.arrow(ctx, mp, vc.from, vc.to, col, vBlack);
    }
    // Fingernummern (gleiten während des Wechsels zur Zieltaste)
    for (const vc of voices) {
      const a = this.anchor(mp, vc.from, vBlack), b = this.anchor(mp, vc.to, vBlack);
      if (!this.inView(mp, vc.from) && !(glide && this.inView(mp, vc.to))) continue;
      const k = glide ? ease : 0;
      const u = a.u + (b.u - a.u) * k, vv = a.v + (b.v - a.v) * k;
      const f = glide && t > 0.5 ? vc.f2 : vc.f;
      const col = vc.lh ? LH_COLOR : FINGER.bright[f];
      this.dot(ctx, mp, u, vv, String(f), col, glide && vc.from !== vc.to);
    }
    ctx.globalAlpha = 1;
    this.outOfView(mp, cur, next);
  }

  /** Wo eine Fingernummer auf der Taste sitzt: weiß knapp unter den schwarzen Tasten, schwarz in deren Mitte. */
  anchor(mp, m, vBlack) {
    return { u: this.keyU(mp, m), v: isBlack(m) ? vBlack * 0.55 : vBlack + (1 - vBlack) * 0.28 };
  }

  keyPoly(ctx, mp, m, vBlack) {
    const w = 1 / mp.count;
    let u0, u1, v0, v1;
    if (isBlack(m)) { const uc = this.keyU(mp, m); u0 = uc - w * 0.3; u1 = uc + w * 0.3; v0 = 0; v1 = vBlack; }
    else { u0 = (whiteAbs(m) - mp.wlo) * w; u1 = u0 + w; v0 = vBlack; v1 = 1; }
    const p = [mp.f(u0, v0), mp.f(u1, v0), mp.f(u1, v1), mp.f(u0, v1)];
    ctx.beginPath();
    ctx.moveTo(...p[0]); ctx.lineTo(...p[1]); ctx.lineTo(...p[2]); ctx.lineTo(...p[3]); ctx.closePath();
  }

  /** Radius einer Markierung: passend zur Tastenbreite an dieser Stelle im Bild. */
  radius(mp, u, v) {
    const w = 1 / mp.count;
    const a = mp.f(u - w / 2, v), b = mp.f(u + w / 2, v);
    return Math.max(9, Math.min(34, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.44));
  }

  dot(ctx, mp, u, v, text, col, moving) {
    const [x, y] = mp.f(u, v), r = this.radius(mp, u, v);
    if (moving) { ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2); ctx.fillStyle = col + '55'; ctx.fill(); }
    ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(11,18,32,.6)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    this.label(ctx, x, y, r, text, '#0B1220');
  }

  ghost(ctx, mp, m, text, col, vBlack) {
    const a = this.anchor(mp, m, vBlack);
    const [x, y] = mp.f(a.u, a.v), r = this.radius(mp, a.u, a.v);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11,18,32,.35)'; ctx.fill();
    ctx.setLineDash([r * 0.45, r * 0.3]); ctx.lineWidth = Math.max(2.5, r * 0.16); ctx.strokeStyle = col; ctx.stroke();
    ctx.setLineDash([]);
    this.label(ctx, x, y, r, text, col);
  }

  label(ctx, x, y, r, text, color) {
    ctx.fillStyle = color;
    ctx.font = `800 ${Math.round(r * 1.05)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + r * 0.04);
  }

  arrow(ctx, mp, from, to, col, vBlack) {
    const a = this.anchor(mp, from, vBlack), b = this.anchor(mp, to, vBlack);
    const r = this.radius(mp, a.u, a.v);
    const lift = 0.16;
    const p0 = mp.f(a.u, Math.min(a.v, b.v) - lift), p1 = mp.f(b.u, Math.min(a.v, b.v) - lift);
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy);
    if (len < 4) return;
    const ux = dx / len, uy = dy / len, head = Math.max(10, r * 0.7);
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.lineWidth = Math.max(4, r * 0.28); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(...p0); ctx.lineTo(p1[0] - ux * head * 0.8, p1[1] - uy * head * 0.8); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(...p1);
    ctx.lineTo(p1[0] - ux * head - uy * head * 0.6, p1[1] - uy * head + ux * head * 0.6);
    ctx.lineTo(p1[0] - ux * head + uy * head * 0.6, p1[1] - uy * head - ux * head * 0.6);
    ctx.closePath(); ctx.fill();
  }

  pill(ctx, mp, m, vBlack) {
    const a = this.anchor(mp, m, vBlack);
    const r = this.radius(mp, a.u, a.v);
    const [x, y] = mp.f(a.u, a.v);
    const fs = Math.max(10, Math.round(r * 0.6));
    ctx.font = `700 ${fs}px -apple-system, system-ui, sans-serif`;
    const w = ctx.measureText('bleibt').width + fs, h = fs * 1.6, top = y + r + 6;
    ctx.fillStyle = '#E8EDF5';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - w / 2, top, w, h, h / 2); else ctx.rect(x - w / 2, top, w, h);
    ctx.fill();
    ctx.fillStyle = '#0B1220'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('bleibt', x, top + h / 2 + 0.5);
  }

  outOfView(mp, cur, next) {
    const need = [];
    if (cur) { if (this.view.showRH) need.push(...cur.notes); if (this.view.showLH) need.push(cur.bass); }
    if (next) { if (this.view.showRH) need.push(...next.notes); }
    const out = need.filter((m) => !this.inView(mp, m));
    this.badge.classList.toggle('warn', out.length > 0);
    let hint = this.stage.querySelector('.cam-out');
    if (!out.length || this.calibrating) { if (hint) hint.remove(); return; }
    if (!hint) hint = el('div', 'cam-out', this.stage);
    const name = this.o.keyName || ((m) => NAMES_DE[m % 12] + (Math.floor(m / 12) - 1));
    const left = out.some((m) => m < mp.c.lo);
    hint.textContent = `${[...new Set(out)].map(name).join(', ')} ${out.length === 1 ? 'liegt' : 'liegen'} außerhalb des Kamerabilds (${left ? 'links' : 'rechts'}) – Kamera verschieben und neu kalibrieren.`;
  }

  // ---------- Kalibrierung ----------
  startCalibration(onDone) {
    const base = this.cam.calib || DEFAULT_CALIB;
    this.calibrating = { draft: structuredClone(base), step: 'corners', side: 'lo', onDone };
    this.calibLayer.hidden = false;
    this.renderCalib();
    this.layout();
  }

  endCalibration(save) {
    const c = this.calibrating;
    if (!c) return;
    if (save) this.o.saveCam({ calib: c.draft, calibRotate: !!this.cam.rotate, calibMirror: !!this.cam.mirror });
    this.calibrating = null;
    this.calibLayer.hidden = true;
    this.calibLayer.innerHTML = '';
    this.layout();
    c.onDone && c.onDone(save);
  }

  /** MIDI während der Kalibrierung: gedrückte Taste = äußerste Taste links bzw. rechts im Bild. */
  onMidi(ev) {
    const c = this.calibrating;
    if (!c || c.step !== 'keys' || ev.type !== 'on') return false;
    let m = ev.note;
    if (isBlack(m)) m = c.side === 'lo' ? m - 1 : m + 1;
    if (c.side === 'lo') { c.draft.lo = m; c.side = 'hi'; if (c.draft.hi <= m) c.draft.hi = m + 12; }
    else { if (m > c.draft.lo) { c.draft.hi = m; c.side = 'done'; } }
    this.renderCalib();
    this.draw();
    return true;
  }

  stepWhite(m, d) { let x = m + d; while (isBlack(x)) x += d; return x; }

  renderCalib() {
    const c = this.calibrating;
    const L = this.calibLayer;
    const name = this.o.keyName || ((m) => NAMES_DE[m % 12] + (Math.floor(m / 12) - 1));
    L.innerHTML = '';
    this.handles = [];
    if (c.step === 'corners') {
      const tips = ['hinten links', 'hinten rechts', 'vorne rechts', 'vorne links'];
      c.draft.pts.forEach((p, i) => {
        const h = el('button', 'cam-handle', L, '<span></span>');
        h.type = 'button';
        h.setAttribute('aria-label', 'Ecke ' + tips[i] + ' verschieben');
        this.bindDrag(h, i);
        this.handles.push(h);
      });
      this.placeHandles();
    }
    const panel = el('div', 'cam-panel', L);
    if (c.step === 'corners') {
      panel.innerHTML = `<span class="eyebrow accent">Schritt 1 von 2</span>
        <b>Ecken auf die Tastatur ziehen</b>
        <span class="small">Die vier gelben Punkte auf die Ecken des sichtbaren Tastenbereichs: oben an die hintere Tastenkante, unten an die Vorderkante der weißen Tasten. Links und rechts jeweils an den Rand einer weißen Taste.</span>
        <div class="row-gap"><button type="button" class="btn ghost" data-cal="cancel">Abbrechen</button><button type="button" class="btn primary" data-cal="next">Weiter</button></div>`;
    } else {
      const midiHint = c.side === 'lo' ? 'Drück am Piano die <b>ganz linke</b> weiße Taste im Bild.' : c.side === 'hi' ? 'Jetzt die <b>ganz rechte</b> weiße Taste im Bild drücken.' : 'Erkannt. Passt das Raster auf die Tasten?';
      panel.innerHTML = `<span class="eyebrow accent">Schritt 2 von 2</span>
        <b>Welche Tasten liegen im Bild?</b>
        <span class="small">${midiHint} Ohne MIDI-Keyboard: mit − / + einstellen, bis die Linien auf den Tasten liegen.</span>
        <div class="cam-range">
          <span class="small muted">Links</span>
          <button type="button" class="icon-btn small" data-cal="lo-" aria-label="Linke Taste tiefer">−</button><b class="cam-note">${name(c.draft.lo)}</b><button type="button" class="icon-btn small" data-cal="lo+" aria-label="Linke Taste höher">+</button>
          <span class="small muted">Rechts</span>
          <button type="button" class="icon-btn small" data-cal="hi-" aria-label="Rechte Taste tiefer">−</button><b class="cam-note">${name(c.draft.hi)}</b><button type="button" class="icon-btn small" data-cal="hi+" aria-label="Rechte Taste höher">+</button>
        </div>
        <div class="row-gap"><button type="button" class="btn ghost" data-cal="back">Zurück</button><button type="button" class="btn primary" data-cal="done">Fertig</button></div>`;
    }
    panel.onclick = (e) => {
      const b = e.target.closest('[data-cal]'); if (!b) return;
      const a = b.dataset.cal, d = c.draft;
      if (a === 'cancel') return this.endCalibration(false);
      if (a === 'next') { c.step = 'keys'; c.side = 'lo'; }
      if (a === 'back') c.step = 'corners';
      if (a === 'done') return this.endCalibration(true);
      if (a === 'lo-') d.lo = this.stepWhite(d.lo, -1);
      if (a === 'lo+' && this.stepWhite(d.lo, 1) < d.hi) d.lo = this.stepWhite(d.lo, 1);
      if (a === 'hi-' && this.stepWhite(d.hi, -1) > d.lo) d.hi = this.stepWhite(d.hi, -1);
      if (a === 'hi+') d.hi = this.stepWhite(d.hi, 1);
      this.renderCalib();
      this.draw();
    };
    this.placeHandles();
  }

  placeHandles() {
    if (!this.calibrating || !this.handles) return;
    const r = this.videoRect();
    this.handles.forEach((h, i) => {
      const [x, y] = this.calibrating.draft.pts[i];
      h.style.transform = `translate(${r.x + x * r.w - 22}px, ${r.y + y * r.h - 22}px)`;
    });
    // Hinweisfeld in eine Ecke schieben, in der kein Ziehpunkt liegt
    const panel = this.calibLayer.querySelector('.cam-panel');
    if (!panel) return;
    const W = this.stage.clientWidth, H = this.stage.clientHeight, pw = panel.offsetWidth + 24, ph = panel.offsetHeight + 24;
    const pts = this.calibrating.draft.pts.map(([x, y]) => [r.x + x * r.w, r.y + y * r.h]);
    const spots = [['tr', W - pw, 0], ['tl', 0, 0], ['br', W - pw, H - ph], ['bl', 0, H - ph], ['tc', (W - pw) / 2, 0], ['bc', (W - pw) / 2, H - ph]];
    const free = spots.find(([, sx, sy]) => !pts.some(([x, y]) => x > sx - 30 && x < sx + pw + 30 && y > sy - 30 && y < sy + ph + 30)) || spots[0];
    panel.dataset.pos = free[0];
  }

  bindDrag(h, i) {
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      h.classList.add('drag');
    });
    h.addEventListener('pointermove', (e) => {
      if (!h.hasPointerCapture(e.pointerId)) return;
      const box = this.stage.getBoundingClientRect(), r = this.videoRect();
      const x = Math.max(0, Math.min(1, (e.clientX - box.left - r.x) / r.w));
      const y = Math.max(0, Math.min(1, (e.clientY - box.top - r.y) / r.h));
      this.calibrating.draft.pts[i] = [x, y];
      this.placeHandles();
      this.draw();
    });
    const up = () => h.classList.remove('drag');
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  }

  drawCalibGrid(ctx, mp, vBlack) {
    this.stage.querySelector('.cam-out')?.remove();
    const { f, count } = mp;
    ctx.globalAlpha = 1;
    const quad = [f(0, 0), f(1, 0), f(1, 1), f(0, 1)];
    ctx.fillStyle = 'rgba(245,184,61,.1)';
    ctx.beginPath(); ctx.moveTo(...quad[0]); quad.slice(1).forEach((p) => ctx.lineTo(...p)); ctx.closePath(); ctx.fill();
    ctx.setLineDash([10, 7]); ctx.lineWidth = 3; ctx.strokeStyle = '#F5B83D'; ctx.stroke(); ctx.setLineDash([]);
    // Trennlinien der weißen Tasten
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(245,184,61,.85)';
    for (let i = 1; i < count; i++) {
      ctx.beginPath(); ctx.moveTo(...f(i / count, 0)); ctx.lineTo(...f(i / count, 1)); ctx.stroke();
    }
    // Schwarze Tasten als Umriss
    ctx.strokeStyle = 'rgba(96,165,250,.9)'; ctx.lineWidth = 2;
    for (let m = mp.c.lo + 1; m < mp.c.hi; m++) {
      if (!isBlack(m)) continue;
      this.keyPoly(ctx, mp, m, vBlack); ctx.stroke();
    }
    // Gedrückte Tasten auch beim Kalibrieren zeigen – so sieht man, ob das Raster passt
    for (const m of this.held) {
      if (!this.inView(mp, m)) continue;
      ctx.fillStyle = 'rgba(74,222,128,.55)'; this.keyPoly(ctx, mp, m, vBlack); ctx.fill();
    }
    // C-Tasten beschriften
    const name = this.o.keyName || ((m) => NAMES_DE[m % 12] + (Math.floor(m / 12) - 1));
    for (let m = mp.c.lo; m <= mp.c.hi; m++) {
      if (m % 12 !== 0 && m !== mp.c.lo && m !== mp.c.hi) continue;
      if (isBlack(m)) continue;
      const u = this.keyU(mp, m), [x, y] = f(u, 0.9), r = this.radius(mp, u, 0.9);
      ctx.fillStyle = '#F5B83D';
      ctx.font = `700 ${Math.max(11, Math.round(r * 0.75))}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(name(m), x, y);
    }
  }
}
