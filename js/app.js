import { planProgression, splitChords, parseChord, movesBetween, noteName, noteLabel, transposeSymbol,
  prefersFlats, keyIsEasy, candidateVoicings, fingering, FINGER_NAMES } from './music.js';
import { SoundEngine, Transport } from './sound.js';
import { Keyboard, FINGER, REAL_KEY_MM, estimatePxPerMm } from './keyboard.js';
import * as store from './store.js';
import { VERSION } from './version.js';
import { initSplash } from './splash.js';

const app = document.getElementById('app');
const engine = new SoundEngine();
let settings = store.loadSettings();
settings.zoom = Object.assign({ rechts: 1, links: 1, beide: 0 }, settings.zoom || {});
const pxPerMm = () => settings.pxPerMm || estimatePxPerMm();
const realKeyPx = () => pxPerMm() * REAL_KEY_MM;
const withBass = (s) => [s.bass, ...s.notes];
engine.setVolume(settings.volume);
let cleanup = null; // räumt die aktuelle Ansicht auf (Metronom stoppen usw.)

// ---------- kleine Helfer ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = app) => root.querySelector(sel);
const $$ = (sel, root = app) => [...root.querySelectorAll(sel)];
const icon = {
  back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
const beatsPerBar = (meter) => ({ '3/4': 3, '6/8': 6 })[meter] || 4;
const voice = () => (settings.sound === 'rhodes' ? 'rhodes' : 'piano');
const tapNote = (m) => { if (!engine.running) engine.unlock(); engine.note(voice(), m, null, 0.3, 1.4); };

function setSettings(patch) {
  settings = Object.assign({}, settings, patch);
  store.saveSettings(settings);
  engine.setVolume(settings.volume);
}

// ---------- Router ----------
function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, query] = hash.split('?');
  const q = Object.fromEntries(new URLSearchParams(query || ''));
  const parts = path.split('/').filter(Boolean);
  window.scrollTo(0, 0);
  if (parts[0] === 'song' && parts[2] === 'practice') return viewPractice(parts[1], q);
  if (parts[0] === 'song' && parts[2] === 'edit') return viewEditor(parts[1]);
  if (parts[0] === 'new') return viewEditor(null);
  if (parts[0] === 'library') return viewLibrary();
  return viewHome();
}
window.addEventListener('hashchange', route);

// ---------- Einstellungen (Dialog) ----------
function openSettings(onChange) {
  const d = document.getElementById('settings');
  d.innerHTML = `
    <form method="dialog" class="sheet">
      <h2>Einstellungen</h2>
      <label class="row"><span>Notenschrift</span>
        <select name="notation">
          <option value="de" ${settings.notation === 'de' ? 'selected' : ''}>Deutsch (H, Fis, B)</option>
          <option value="en" ${settings.notation === 'en' ? 'selected' : ''}>Englisch (B, F#, Bb)</option>
        </select></label>
      <div class="calib">
        <span>Echte Tastengröße kalibrieren</span>
        <span class="muted small">Leg eine Bankkarte (8,56 cm breit) auf den Balken und stell ihn mit −/+ gleich lang ein.</span>
        <div class="calib-bar" id="calibBar"></div>
        <div class="row-gap">
          <button type="button" class="icon-btn small" data-cal="-1" aria-label="Kürzer">−</button>
          <button type="button" class="icon-btn small" data-cal="1" aria-label="Länger">+</button>
          <button type="button" class="btn ghost" data-cal="0">Automatisch</button>
          <span class="muted small" id="calibInfo"></span>
        </div>
      </div>
      <label class="row"><span>Finger gleiten los … Schläge vor dem Wechsel</span>
        <select name="glideBeats">${[1, 2, 3].map((n) => `<option ${settings.glideBeats === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="row"><span>Lautstärke</span><input type="range" name="volume" min="0" max="1" step="0.05" value="${settings.volume}"></label>
      <p class="muted small">Keys2Worship · Version ${VERSION} · Ton: ${engine.running ? 'aktiv' : 'gesperrt – „Start“ bzw. ▶ antippen'}</p>
      <div class="sheet-actions"><button class="btn primary" value="ok">Fertig</button></div>
    </form>`;
  const form = d.querySelector('form');
  form.addEventListener('input', () => {
    const f = new FormData(form);
    setSettings({ notation: f.get('notation'), glideBeats: +f.get('glideBeats'), volume: +f.get('volume') });
    onChange && onChange();
  });
  const paintCalib = () => {
    d.querySelector('#calibBar').style.width = (85.6 * pxPerMm()) + 'px';
    d.querySelector('#calibInfo').textContent = settings.pxPerMm ? 'eigene Einstellung' : 'automatisch geschätzt';
  };
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cal]'); if (!b) return;
    const k = +b.dataset.cal;
    setSettings({ pxPerMm: k === 0 ? null : pxPerMm() * (k > 0 ? 1.01 : 1 / 1.01) });
    paintCalib(); onChange && onChange();
  });
  paintCalib();
  d.showModal();
}

// ---------- Startseite ----------
function viewHome() {
  document.title = 'Keys2Worship';
  const songs = store.loadSongs();
  const lastId = store.getLast();
  const last = songs.find((s) => s.id === lastId) || songs[0];
  let pairs = [];
  if (last) {
    const flats = prefersFlats(last.key, settings.notation);
    const plan = planProgression(splitChords(last.sections[0]?.chords), settings.notation, flats).filter((s) => !s.invalid);
    const seen = new Set();
    for (let i = 0; i < plan.length; i++) {
      const a = plan[i], b = plan[(i + 1) % plan.length];
      const k = a.symbol + '>' + b.symbol;
      if (plan.length < 2 || a.symbol === b.symbol || seen.has(k)) continue;
      seen.add(k);
      const stay = movesBetween(a, b).filter((m) => m.delta === 0).length;
      pairs.push({ i, label: `${a.symbol} → ${b.symbol}`, note: stay ? `${stay} ${stay === 1 ? 'Finger bleibt' : 'Finger bleiben'} liegen` : 'alle Finger rutschen' });
    }
    pairs = pairs.slice(0, 4);
  }
  app.innerHTML = `
  <div class="page">
    <header class="topbar">
      <div><h1 class="h1">Keys2Worship</h1><p class="muted">Was möchtest du heute üben?</p></div>
      <div class="row-gap">
        <a class="btn ghost" href="#/library">Akkorde</a>
        <button class="icon-btn" data-act="settings" aria-label="Einstellungen">${icon.gear}</button>
      </div>
    </header>
    ${last ? `
    <section class="hero">
      <div>
        <span class="eyebrow dark">Weiter üben</span>
        <h2 class="hero-title">${esc(last.title || 'Ohne Titel')}</h2>
        <p class="hero-sub">${esc(last.sections.map((s) => s.name).join(' · '))} — ${last.bpm} BPM · ${esc(last.meter)} · Tonart ${esc(last.key)}</p>
      </div>
      <a class="btn dark big" href="#/song/${last.id}/practice">${icon.play} Üben</a>
    </section>` : ''}
    ${pairs.length ? `
    <h2 class="h2">Akkordwechsel trainieren <span class="muted small">aus „${esc(last.title)}“</span></h2>
    <section class="tiles">
      ${pairs.map((p) => `<a class="tile" href="#/song/${last.id}/practice?sec=0&mode=wechsel&at=${p.i}">
        <span class="tile-title chord-font">${esc(p.label)}</span><span class="muted small">${p.note}</span></a>`).join('')}
    </section>` : ''}
    <div class="h2-row"><h2 class="h2">Meine Lieder</h2><a class="btn ghost" href="#/new">+ Lied anlegen</a></div>
    <ul class="list">
      ${songs.map((s) => `<li class="list-item">
        <div><span class="li-title">${esc(s.title || 'Ohne Titel')}</span>
        <span class="muted small">${esc(s.key)} · ${s.bpm} BPM · ${s.sections.length} ${s.sections.length === 1 ? 'Teil' : 'Teile'}</span></div>
        <div class="row-gap"><a class="btn ghost" href="#/song/${s.id}/edit">Bearbeiten</a><a class="btn primary" href="#/song/${s.id}/practice">Üben</a></div>
      </li>`).join('')}
    </ul>
    <section class="card dashed">
      <span class="eyebrow">Bald</span>
      <p class="muted">Lieder und Tonarten direkt aus <strong>Planning Center</strong> und <strong>Chara Technics</strong> übernehmen.</p>
    </section>
    <p class="app-footer">Keys2Worship · Version ${VERSION}</p>
  </div>`;
  $('[data-act=settings]').onclick = () => openSettings(() => viewHome());
}

// ---------- Lied-Editor ----------
function viewEditor(id) {
  const song = id ? store.getSong(id) : store.newSong();
  if (!song) { location.hash = '#/'; return; }
  const isNew = !id;
  document.title = 'Lied bearbeiten – Keys2Worship';

  const preview = (text) => {
    const syms = splitChords(text);
    if (!syms.length) return '<span class="muted small">Akkorde mit Leerzeichen trennen, z. B. <code>G D Em C</code>. Zwei Takte: <code>G*2</code></span>';
    return syms.map((s) => `<span class="chip ${parseChord(s, settings.notation) ? '' : 'bad'}">${esc(s)}</span>`).join('');
  };
  const sectionHtml = (sec, i) => `
    <div class="card section" data-i="${i}">
      <div class="section-head">
        <input class="input small-input" data-f="name" value="${esc(sec.name)}" aria-label="Name des Teils" placeholder="z. B. Refrain">
        <button class="icon-btn small" data-act="del-sec" aria-label="Teil löschen">${icon.x}</button>
      </div>
      <label class="sr-only" for="ch-${i}">Akkorde für ${esc(sec.name)}</label>
      <input id="ch-${i}" class="input chord-font" data-f="chords" value="${esc(sec.chords)}" placeholder="G D Em C" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="chips" data-preview>${preview(sec.chords)}</div>
    </div>`;

  const render = () => {
    app.innerHTML = `
    <div class="page">
      <header class="topbar">
        <div class="row-gap"><a class="back" href="#/">${icon.back} Übersicht</a><h1 class="h1">${isNew ? 'Neues Lied' : 'Lied bearbeiten'}</h1></div>
        <div class="row-gap">
          ${isNew ? '' : '<button class="btn ghost danger" data-act="delete">Löschen</button>'}
          <button class="btn primary big" data-act="save-practice">${icon.play} Speichern &amp; üben</button>
        </div>
      </header>
      <div class="editor">
        <section class="card form">
          <label class="field"><span>Titel</span><input class="input" id="title" value="${esc(song.title)}" placeholder="Liedtitel"></label>
          <div class="field"><span>Tonart</span>
            <div class="stepper">
              <button class="icon-btn small" data-act="tr" data-d="-1" aria-label="Einen Halbton tiefer">−</button>
              <input class="input center chord-font" id="key" value="${esc(song.key)}" aria-label="Tonart">
              <button class="icon-btn small" data-act="tr" data-d="1" aria-label="Einen Halbton höher">+</button>
            </div>
            <span class="small ${keyIsEasy(song.key, settings.notation) ? 'ok' : 'muted'}">${keyIsEasy(song.key, settings.notation) ? 'Gut für den Anfang: wenig schwarze Tasten.' : 'Tipp: C, G, D oder A sind für den Start am leichtesten.'} Mit −/+ wandern alle Akkorde mit.</span>
          </div>
          <div class="field"><span>Tempo</span>
            <div class="stepper">
              <button class="icon-btn small" data-act="bpm" data-d="-2" aria-label="Langsamer">−</button>
              <input class="input center" id="bpm" type="number" min="30" max="200" value="${song.bpm}" aria-label="Tempo in BPM">
              <button class="icon-btn small" data-act="bpm" data-d="2" aria-label="Schneller">+</button>
            </div></div>
          <div class="field"><span>Taktart</span>
            <div class="seg" role="group" aria-label="Taktart">
              ${['4/4', '3/4', '6/8'].map((m) => `<button data-act="meter" data-m="${m}" aria-pressed="${song.meter === m}">${m}</button>`).join('')}
            </div></div>
        </section>
        <div class="sections">
          ${song.sections.map(sectionHtml).join('')}
          <button class="btn ghost wide" data-act="add-sec">+ Teil hinzufügen</button>
        </div>
      </div>
    </div>`;
  };

  const collect = () => {
    song.title = $('#title').value.trim();
    song.key = $('#key').value.trim() || song.key;
    song.bpm = Math.max(30, Math.min(200, +$('#bpm').value || song.bpm));
    $$('.section').forEach((el) => {
      const i = +el.dataset.i;
      song.sections[i].name = $('[data-f=name]', el).value.trim() || 'Teil ' + (i + 1);
      song.sections[i].chords = $('[data-f=chords]', el).value.trim();
    });
  };

  render();
  app.oninput = (e) => {
    const t = e.target;
    if (t.dataset.f === 'chords') t.closest('.section').querySelector('[data-preview]').innerHTML = preview(t.value);
  };
  app.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    collect();
    const act = b.dataset.act;
    if (act === 'tr') {
      const d = +b.dataset.d;
      const flats = prefersFlats(transposeSymbol(song.key, d, settings.notation), settings.notation);
      song.key = transposeSymbol(song.key, d, settings.notation, flats);
      song.sections.forEach((s) => { s.chords = splitChords(s.chords).map((c) => transposeSymbol(c, d, settings.notation, flats)).join(' '); });
      render();
    } else if (act === 'bpm') { song.bpm = Math.max(30, Math.min(200, song.bpm + +b.dataset.d)); render(); }
    else if (act === 'meter') { song.meter = b.dataset.m; render(); }
    else if (act === 'add-sec') { song.sections.push({ name: ['Strophe', 'Refrain', 'Bridge', 'Intro', 'Outro'][song.sections.length] || 'Teil ' + (song.sections.length + 1), chords: '' }); render(); $$('[data-f=chords]').pop()?.focus(); }
    else if (act === 'del-sec') { if (song.sections.length > 1) { song.sections.splice(+b.closest('.section').dataset.i, 1); render(); } }
    else if (act === 'delete') { if (confirm('Dieses Lied wirklich löschen?')) { store.deleteSong(song.id); location.hash = '#/'; } }
    else if (act === 'save-practice') {
      if (!song.title) song.title = 'Ohne Titel';
      store.upsertSong(song);
      location.hash = `#/song/${song.id}/practice`;
    }
  };
  cleanup = () => { app.oninput = null; app.onclick = null; };
}

// ---------- Übungsansicht ----------
function viewPractice(id, q) {
  const song = store.getSong(id);
  if (!song) { location.hash = '#/'; return; }
  store.setLast(id);
  document.title = `${song.title} – Keys2Worship`;
  const notation = settings.notation;
  const flats = prefersFlats(song.key, notation);

  const P = {
    sec: q.sec != null ? (q.sec === 'all' ? 'all' : Math.min(+q.sec, song.sections.length - 1)) : 0,
    mode: q.mode === 'wechsel' ? 'wechsel' : 'lied',
    idx: 0, pair: 0, playing: false, beat: 0, glide: false, glideDur: 0,
    bpm: song.bpm, anchorIdx: 0, steps: [], invalid: [],
  };
  const bpb = beatsPerBar(song.meter);

  function computeSteps() {
    const syms = P.sec === 'all' ? song.sections.flatMap((s) => splitChords(s.chords)) : splitChords(song.sections[P.sec]?.chords);
    const plan = planProgression(syms, notation, flats);
    P.invalid = plan.filter((s) => s.invalid).map((s) => s.symbol);
    P.steps = plan.filter((s) => !s.invalid);
    P.idx = Math.min(P.idx, Math.max(0, P.steps.length - 1));
  }
  computeSteps();
  if (q.at != null) P.idx = Math.min(+q.at, P.steps.length - 1);
  P.pair = P.idx;

  const N = () => P.steps.length;
  const nextOf = (i) => (P.mode === 'wechsel' ? (i === P.pair ? (P.pair + 1) % N() : P.pair) : (i + 1) % N());
  const stepAt = (k) => { let i = P.anchorIdx; for (let j = 0; j < k; j++) i = nextOf(i); return i; };

  app.innerHTML = `
  <div class="practice">
    <header class="p-top">
      <div class="row-gap">
        <a class="back" href="#/">${icon.back} <span class="hide-narrow">Übersicht</span></a>
        <div class="p-title"><strong>${esc(song.title)}</strong><span class="muted small">Tonart ${esc(song.key)} · ${esc(song.meter)} · 1 Takt pro Akkord</span></div>
      </div>
      <div class="row-gap wrap">
        <div class="seg" role="group" aria-label="Liedteil" data-group="sec">
          ${song.sections.map((s, i) => `<button data-sec="${i}">${esc(s.name)}</button>`).join('')}
          ${song.sections.length > 1 ? '<button data-sec="all">Ganzes Lied</button>' : ''}
        </div>
        <div class="seg" role="group" aria-label="Übungsmodus" data-group="mode">
          <button data-mode="lied">Liedmodus</button><button data-mode="wechsel">Wechsel üben</button><button data-mode="ohne">Ohne Hilfe</button>
        </div>
        <button class="icon-btn" data-act="settings" aria-label="Einstellungen">${icon.gear}</button>
      </div>
    </header>

    <section class="strip">
      <button class="icon-btn tall" data-act="prev" aria-label="Vorheriger Akkord">${icon.prev}</button>
      <div class="strip-scroll" id="strip"></div>
      <button class="icon-btn tall" data-act="next" aria-label="Nächster Akkord">${icon.next}</button>
    </section>

    <section class="p-mid">
      <div class="card now">
        <div class="now-col"><span class="eyebrow accent">Jetzt</span><span class="now-name chord-font" id="curName"></span>
          <span class="muted small" id="curInfo"></span><span class="small strong" id="curTones"></span></div>
        <span class="muted">${icon.arrow}</span>
        <div class="now-col"><span class="eyebrow">Danach</span><span class="next-name chord-font" id="nextName"></span></div>
      </div>
      <div class="card moves hide-short">
        <div class="moves-head"><strong id="movesTitle"></strong><span class="muted small" id="movesSummary"></span></div>
        <div id="moves"></div>
      </div>
      <div class="card metro">
        <div class="metro-row">
          <span class="eyebrow">${icon.speaker} Klang</span>
          <div class="seg small" role="group" aria-label="Klang" data-group="sound">
            <button data-sound="off">Aus</button><button data-sound="piano">Klavier</button><button data-sound="rhodes">Rhodes</button>
          </div>
        </div>
        <div class="metro-row"><div class="beats" id="beats" aria-hidden="true"></div><strong class="small" id="count" aria-live="polite"></strong></div>
        <div class="metro-row">
          <div class="row-gap">
            <button class="icon-btn" data-act="slower" aria-label="Langsamer">−</button>
            <div class="bpm"><span class="chord-font" id="bpm"></span><span class="muted tiny">BPM</span></div>
            <button class="icon-btn" data-act="faster" aria-label="Schneller">+</button>
          </div>
          <button class="play" data-act="play" id="playBtn"></button>
        </div>
      </div>
    </section>

    ${P.invalid.length ? `<p class="warn">Nicht erkannt und übersprungen: ${P.invalid.map(esc).join(', ')}</p>` : ''}
    <section class="kb-area">
      <div class="kb-tools">
        <div class="seg small" role="group" aria-label="Hand" data-group="hand">
          <button data-hand="rechts">Rechte Hand</button><button data-hand="links">Linke Hand</button><button data-hand="beide">Beide</button>
        </div>
        <div class="zoom" role="group" aria-label="Zoom">
          <button class="icon-btn small" data-act="zoom-out" aria-label="Verkleinern">−</button>
          <button class="btn ghost zoom-label" data-act="zoom-real" id="zoomLabel" aria-label="Echte Tastengröße"></button>
          <button class="icon-btn small" data-act="zoom-in" aria-label="Vergrößern">+</button>
        </div>
      </div>
      <div class="kb-wrap" id="kbWrap"></div>
    </section>
    <footer class="legend hide-short">
      <div class="row-gap">${[1, 2, 3, 4, 5].map((n) => `<span class="lg"><span class="dot" style="background:${FINGER.bright[n]}">${n}</span>${FINGER_NAMES[n]}</span>`).join('')}</div>
      <div class="row-gap"><span class="lg"><span class="dot solid"></span>jetzt drücken</span><span class="lg"><span class="dot dashed"></span>als Nächstes</span><span class="lg"><span class="dot lh">L</span>linke Hand</span></div>
    </footer>
  </div>`;

  const kbWrap = $('#kbWrap');
  const kb = new Keyboard(kbWrap, { lo: 36, hi: 76, onKey: tapNote, keyName: (m) => noteLabel(m, notation, flats), onZoom: (w) => setZoomPx(w) });

  // Zoom: gespeichert als Anteil der echten Tastengröße, je Hand-Ansicht
  function applyZoom() {
    const z = settings.zoom[settings.hand] || 0;
    kb.setKeyWidth(z ? realKeyPx() * z : 0);
    const pct = Math.round(kb.W / realKeyPx() * 100);
    const lbl = $('#zoomLabel');
    lbl.textContent = (kb.W <= kb.fitWidth + 0.5 ? 'Alles · ' : '') + pct + ' %';
    lbl.title = '100 % = echte Tastengröße';
    lbl.classList.toggle('real', Math.abs(pct - 100) <= 2);
  }
  function setZoomPx(w) {
    const fit = kb.fitWidth, real = realKeyPx();
    w = Math.min(w, real * 1.4);
    const z = w <= fit * 1.02 ? 0 : w / real;
    settings.zoom = Object.assign({}, settings.zoom, { [settings.hand]: z });
    setSettings({ zoom: settings.zoom });
    applyZoom();
  }
  const ro = new ResizeObserver(() => applyZoom());
  ro.observe(kbWrap);
  requestAnimationFrame(applyZoom);

  const transport = new Transport(engine, {
    getBpm: () => P.bpm,
    getBeatsPerBar: () => bpb,
    onSchedule: (beat, bar, time) => {
      const level = beat === 0 ? 2 : (bpb === 6 && beat === 3 ? 1 : 0);
      engine.click(time, level, settings.sound === 'off' ? 0.25 : 0.12);
      if (beat === 0 && settings.sound !== 'off' && N()) {
        const s = P.steps[stepAt(bar)];
        const notes = withBass(s);
        engine.chord(voice(), notes, time, 0.24, bpb * 60 / P.bpm);
      }
    },
    onBeat: (beat, bar) => {
      P.beat = beat;
      const gb = Math.min(settings.glideBeats, bpb - 1);
      if (beat === 0) { P.idx = stepAt(bar); P.glide = false; }
      else if (beat === bpb - gb) { P.glide = true; P.glideDur = gb * 60000 / P.bpm * 0.9; }
      update();
    },
  });

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
      else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { /* nicht unterstützt */ }
  }

  function start() {
    if (!N()) return;
    P.anchorIdx = P.idx; P.beat = 0; P.glide = false; P.playing = true;
    transport.start();
    keepAwake(true);
    update();
  }
  function stop() {
    transport.stop();
    P.playing = false; P.glide = false; P.beat = 0;
    keepAwake(false);
    update();
  }
  function restartIfPlaying() { if (P.playing) { transport.stop(); start(); } else update(); }

  let glideTimer = null;
  function stepManually() {
    if (P.playing || P.glide || N() < 2) return;
    const target = nextOf(P.idx);
    P.glide = true; P.glideDur = 60000 / P.bpm;
    update();
    glideTimer = setTimeout(() => {
      P.idx = target; P.glide = false; update();
      if (settings.sound !== 'off') {
        const s = P.steps[target];
        engine.chord(voice(), withBass(s), null, 0.24, 3 * 60 / P.bpm);
      }
    }, P.glideDur + 30);
  }
  function jump(i) {
    clearTimeout(glideTimer);
    P.idx = (i + N()) % N(); P.pair = P.idx; P.glide = false;
    if (!P.playing && settings.sound !== 'off' && N()) {
      const s = P.steps[P.idx];
      engine.chord(voice(), withBass(s), null, 0.24, 2.5 * 60 / P.bpm);
    }
    restartIfPlaying();
  }

  function renderStrip() {
    $('#strip').innerHTML = P.steps.map((s, i) => `<button class="chord-card" data-i="${i}"><span class="chord-font cc-name">${esc(s.symbol)}</span><span class="cc-meta"><span class="cc-tag"></span><span class="cc-inv">${s.inversionName}</span></span></button>`).join('')
      || '<p class="muted">Dieser Teil hat noch keine Akkorde. Tippe oben auf „Übersicht“ und bearbeite das Lied.</p>';
  }

  function update() {
    if (!N()) { kb.update({ cur: null, next: null }); return; }
    const aids = P.mode !== 'ohne';
    const showRH = settings.hand !== 'links', showLH = settings.hand !== 'rechts';
    const cur = P.steps[P.idx], nIdx = nextOf(P.idx), next = P.steps[nIdx];
    // Leiste
    $$('.chord-card').forEach((c) => {
      const i = +c.dataset.i;
      c.classList.toggle('cur', i === P.idx);
      c.classList.toggle('nxt', i === nIdx && i !== P.idx);
      $('.cc-tag', c).textContent = i === P.idx ? 'Jetzt' : i === nIdx ? 'Als Nächstes' : 'Takt ' + (i + 1);
    });
    const curCard = $(`.chord-card[data-i="${P.idx}"]`);
    if (curCard) curCard.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    // Jetzt / Danach
    $('#curName').textContent = cur.symbol;
    $('#curInfo').textContent = (showRH ? cur.inversionName : 'Grundton') + (showLH ? ` · links ${noteName(cur.bass, notation, flats)}` : '');
    $('#curTones').textContent = cur.tones;
    $('#nextName').textContent = next.symbol;
    // Bewegungen
    const mv = movesBetween(cur, next);
    const moving = mv.filter((m) => m.delta !== 0).length, stay = 3 - moving;
    $('#movesTitle').textContent = `So wechselst du: ${cur.symbol} → ${next.symbol}`;
    $('#movesSummary').textContent = settings.hand === 'links'
      ? (next.bass === cur.bass ? 'Linke Hand bleibt liegen' : 'Linke Hand wechselt den Grundton')
      : `${moving} ${moving === 1 ? 'Finger bewegt sich' : 'Finger bewegen sich'}${stay ? `, ${stay} ${stay === 1 ? 'bleibt' : 'bleiben'} liegen` : ''}`;
    const lhLine = () => {
      const d = next.bass - cur.bass, k = Math.abs(d);
      if (!d) return `<div class="mv"><span class="dot lh">L</span><span class="mv-t">Linke Hand bleibt auf ${noteName(cur.bass, notation, flats)}</span><span class="small accent-text">nicht bewegen</span></div>`;
      return `<div class="mv"><span class="dot lh">L</span><span class="mv-t">Linke Hand: ${noteName(cur.bass, notation, flats)} → ${noteName(next.bass, notation, flats)}</span><span class="small muted">${k} ${k === 1 ? 'Taste' : 'Tasten'} nach ${d > 0 ? 'rechts' : 'links'} · kleiner Finger</span></div>`;
    };
    $('#moves').innerHTML = aids ? (showRH ? mv : []).map((m) => {
      if (m.delta === 0) return `<div class="mv"><span class="dot" style="background:${FINGER.bright[m.fingerFrom]}">${m.fingerFrom}</span><span class="mv-t">${FINGER_NAMES[m.fingerFrom]} bleibt auf ${noteName(m.from, notation, flats)}</span><span class="small accent-text">nicht bewegen</span></div>`;
      const k = Math.abs(m.delta);
      const sub = `${k} ${k === 1 ? 'Taste' : 'Tasten'} nach ${m.delta > 0 ? 'rechts' : 'links'}${m.fingerFrom !== m.finger ? ` · statt Finger ${m.fingerFrom}` : ''}`;
      return `<div class="mv"><span class="dot" style="background:${FINGER.bright[m.finger]}">${m.finger}</span><span class="mv-t">${FINGER_NAMES[m.finger]}: ${noteName(m.from, notation, flats)} → ${noteName(m.to, notation, flats)}</span><span class="small muted">${sub}</span></div>`;
    }).join('') + (showLH ? lhLine() : '') : `<p class="muted">Ohne Hilfe: Spiel ${esc(cur.symbol)} und ${esc(next.symbol)} aus dem Kopf. Wähle „Liedmodus“, um die Fingersätze wieder zu sehen.</p>`;
    // Metronom
    $('#beats').innerHTML = Array.from({ length: bpb }, (_, i) => `<span class="beat ${i === 0 || (bpb === 6 && i === 3) ? 'big' : ''} ${P.playing && i === P.beat ? (i === 0 ? 'on accent' : 'on') : ''}"></span>`).join('');
    $('#count').textContent = P.glide ? 'Finger rutschen …' : P.playing ? `Wechsel in ${bpb - P.beat}` : 'Bereit';
    $('#count').classList.toggle('accent-text', P.glide);
    $('#bpm').textContent = P.bpm;
    const pb = $('#playBtn');
    pb.innerHTML = P.playing ? icon.pause : icon.play;
    pb.setAttribute('aria-label', P.playing ? 'Metronom anhalten' : 'Metronom starten');
    // Segmente
    $$('[data-group=sec] button').forEach((b) => b.setAttribute('aria-pressed', String(String(P.sec) === b.dataset.sec)));
    $$('[data-group=mode] button').forEach((b) => b.setAttribute('aria-pressed', String(P.mode === b.dataset.mode)));
    $$('[data-group=sound] button').forEach((b) => b.setAttribute('aria-pressed', String(settings.sound === b.dataset.sound)));
    // Klaviatur
    $$('[data-group=hand] button').forEach((b) => b.setAttribute('aria-pressed', String(settings.hand === b.dataset.hand)));
    kb.update({ cur, next: N() > 1 ? next : null, glide: P.glide, dur: P.glideDur, aids, showRH, showLH,
      focus: settings.hand === 'rechts' ? 'rh' : settings.hand === 'links' ? 'lh' : 'both' });
  }

  app.onclick = (e) => {
    const card = e.target.closest('.chord-card');
    if (card) return jump(+card.dataset.i);
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sec != null) { P.sec = b.dataset.sec === 'all' ? 'all' : +b.dataset.sec; P.idx = 0; P.pair = 0; computeSteps(); renderStrip(); return restartIfPlaying(); }
    if (b.dataset.mode) { P.mode = b.dataset.mode; P.pair = P.idx; return restartIfPlaying(); }
    if (b.dataset.hand) { setSettings({ hand: b.dataset.hand }); update(); return applyZoom(); }
    if (b.dataset.sound) {
      setSettings({ sound: b.dataset.sound });
      if (b.dataset.sound !== 'off' && !P.playing && N()) { const s = P.steps[P.idx]; engine.chord(voice(), withBass(s), null, 0.24, 2); }
      return update();
    }
    switch (b.dataset.act) {
      case 'play': engine.unlock(); return P.playing ? stop() : start();
      case 'next': engine.unlock(); return P.playing ? jump(nextOf(P.idx)) : stepManually();
      case 'prev': return jump(P.idx - 1);
      case 'slower': P.bpm = Math.max(30, P.bpm - 4); return update();
      case 'faster': P.bpm = Math.min(200, P.bpm + 4); return update();
      case 'zoom-in': return setZoomPx(kb.W * 1.15);
      case 'zoom-out': return setZoomPx(kb.W / 1.15);
      case 'zoom-real': return setZoomPx(realKeyPx());
      case 'settings': return openSettings(() => { applyZoom(); update(); });
    }
  };
  const onKey = (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); engine.unlock(); P.playing ? stop() : start(); }
    if (e.code === 'ArrowRight') { P.playing ? jump(nextOf(P.idx)) : stepManually(); }
    if (e.code === 'ArrowLeft') jump(P.idx - 1);
  };
  document.addEventListener('keydown', onKey);
  const onHide = () => { if (document.hidden && P.playing) stop(); };
  document.addEventListener('visibilitychange', onHide);

  renderStrip();
  update();

  cleanup = () => {
    transport.stop(); clearTimeout(glideTimer); keepAwake(false);
    ro.disconnect(); kb.destroy();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    app.onclick = null;
  };
}

// ---------- Akkord-Bibliothek ----------
function viewLibrary() {
  document.title = 'Akkorde – Keys2Worship';
  const notation = settings.notation;
  const L = { root: 7, q: 'dur' };
  const Q = { dur: ['Dur', [0, 4, 7], ''], moll: ['Moll', [0, 3, 7], 'm'], sus2: ['sus2', [0, 2, 7], 'sus2'], sus4: ['sus4', [0, 5, 7], 'sus4'], dim: ['vermindert', [0, 3, 6], 'dim'] };
  const TITLES = ['Grundstellung', '1. Umkehrung', '2. Umkehrung'];
  let kbs = [];

  const render = () => {
    kbs.forEach((k) => k.destroy()); kbs = [];
    const flats = [5, 10, 3, 8, 1].includes(L.root);
    const pcs = Q[L.q][1].map((x) => (L.root + x) % 12);
    const label = noteName(L.root, notation, flats) + Q[L.q][2];
    const voicings = [0, 1, 2].map((k) => {
      const c = candidateVoicings(pcs).filter((v) => v.inversion === k);
      c.sort((a, b) => Math.abs(a.notes[1] - 62) - Math.abs(b.notes[1] - 62));
      const v = c[0];
      return v ? { k, notes: v.notes, fingers: fingering(v.notes) } : null;
    }).filter(Boolean);
    app.innerHTML = `
    <div class="page">
      <header class="topbar">
        <div class="row-gap"><a class="back" href="#/">${icon.back} Übersicht</a><h1 class="h1">Akkord-Bibliothek</h1></div>
        <div class="seg" role="group" aria-label="Klang" data-group="sound">
          <button data-sound="piano" aria-pressed="${voice() === 'piano'}">Klavier</button><button data-sound="rhodes" aria-pressed="${voice() === 'rhodes'}">Rhodes</button>
        </div>
      </header>
      <div class="row-gap wrap">
        <div class="seg roots" role="group" aria-label="Grundton">
          ${Array.from({ length: 12 }, (_, pc) => `<button data-root="${pc}" aria-pressed="${pc === L.root}">${noteName(pc, notation, [5, 10, 3, 8, 1].includes(pc))}</button>`).join('')}
        </div>
        <div class="seg" role="group" aria-label="Akkordart">
          ${Object.entries(Q).map(([k, v]) => `<button data-q="${k}" aria-pressed="${k === L.q}">${v[0]}</button>`).join('')}
        </div>
      </div>
      <div class="lib-head"><span class="lib-name chord-font">${esc(label)}</span>
        <span class="muted">Töne: ${pcs.map((p) => noteName(p, notation, flats)).join(' · ')} · Linke Hand: Grundton ${noteName(L.root, notation, flats)} mit dem kleinen Finger</span></div>
      <div class="lib-grid">
        ${voicings.map((v, i) => `<div class="card lib-card">
          <div class="lib-row"><strong>${TITLES[v.k]}</strong><span class="muted small">Fingersatz <strong class="strong">${v.fingers.join(' – ')}</strong></span></div>
          <div class="mini-kb" id="mk${i}"></div>
          <div class="lib-row"><span class="strong">${v.notes.map((n) => noteName(n, notation, flats)).join(' · ')}</span>
            <button class="btn ghost" data-play="${i}">${icon.speaker} Anhören</button></div>
        </div>`).join('')}
      </div>
      <section class="card"><span class="eyebrow accent">Merkregel Fingersatz</span>
        <p class="muted">Wo die Lücke zwischen zwei Tönen größer ist, bleibt ein Finger frei: große Lücke oben → 1 – 2 – 5, große Lücke unten → 1 – 3 – 5. Welche Lage du im Lied spielst, sucht die Übungsansicht automatisch nach dem kürzesten Weg aus.</p></section>
    </div>`;
    voicings.forEach((v, i) => {
      const k = new Keyboard($('#mk' + i), { lo: 48, hi: 76, arrows: false, labels: false, onKey: tapNote, keyName: (m) => noteLabel(m, notation, flats) });
      k.update({ cur: { notes: v.notes, fingers: v.fingers, bass: 0 }, next: null, aids: true, showLH: false });
      kbs.push(k);
    });
    app.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.root) { L.root = +b.dataset.root; render(); }
      else if (b.dataset.q) { L.q = b.dataset.q; render(); }
      else if (b.dataset.sound) { setSettings({ sound: b.dataset.sound }); render(); }
      else if (b.dataset.play) engine.chord(voice(), voicings[+b.dataset.play].notes, null, 0.26, 1.8, 0.015);
    };
  };
  render();
  cleanup = () => { kbs.forEach((k) => k.destroy()); app.onclick = null; };
}

// ---------- Start ----------
route();
initSplash({
  engine,
  version: VERSION,
  // Kurzer, leiser Akkord als Bestätigung, dass der Ton jetzt funktioniert
  onStart: () => { if (settings.sound !== 'off') engine.chord(voice(), [55, 59, 62, 67], null, 0.16, 1.6, 0.06); },
});

// Updates: neue Version wird beim nächsten Öffnen automatisch geladen (nicht mitten im Üben)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    })
    .catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (!document.querySelector('.practice') || !document.getElementById('playBtn')?.getAttribute('aria-label')?.includes('anhalten')) location.reload();
  });
}
