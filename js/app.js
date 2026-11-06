import { planProgression, splitChords, parseChord, movesBetween, noteName, noteLabel, transposeSymbol,
  prefersFlats, keyIsEasy, candidateVoicings, fingering, FINGER_NAMES } from './music.js';
import { SoundEngine, Transport } from './sound.js';
import { Keyboard, FINGER, REAL_KEY_MM, estimatePxPerMm } from './keyboard.js';
import * as store from './store.js';
import { VERSION } from './version.js';
import { initSplash } from './splash.js';
import * as pco from './pco.js';

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
  mute: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
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
  if (parts[0] === 'song' && parts[2] === 'practice') return viewPractice(decodeURIComponent(parts[1]), q);
  if (parts[0] === 'song' && parts[2] === 'edit') return viewEditor(decodeURIComponent(parts[1]));
  if (parts[0] === 'new') return viewEditor(null);
  if (parts[0] === 'library') return viewLibrary();
  return viewHome();
}
window.addEventListener('hashchange', route);

// ---------- Einstellungen (wie Ambientpad: Menü mit Unterseiten) ----------
const SOUND_NAMES = { piano: 'Klavier', rhodes: 'Rhodes', off: 'Aus' };
const HAND_NAMES = { rechts: 'Rechte Hand', links: 'Linke Hand', beide: 'Beide Hände' };

function openSettings(onChange, startPage = 'main') {
  const d = document.getElementById('settings');
  let page = startPage;
  const changed = () => { onChange && onChange(); };
  const pct = (z) => (z ? Math.round(z * 100) + ' %' : 'Alles');

  const pages = {
    main: { title: 'Einstellungen', html: () => `
      <button class="mrow feature" data-go="pco"><span class="mi">🎵</span><span class="mt"><b>Planning Center</b>
        <small>${pco.isConnected() ? `Verbunden${pco.userName() ? ' als ' + esc(pco.userName()) : ''} · Setlist & Lieder` : 'Setlist laden, Lieder holen'}</small></span><span class="mc">›</span></button>
      <div class="menu">
        <button class="mrow" data-go="keys"><span class="mi">🎹</span><span class="mt"><b>Klaviatur</b><small>${HAND_NAMES[settings.hand]} · ${pct(settings.zoom[settings.hand])}</small></span><span class="mc">›</span></button>
        <button class="mrow" data-go="metro"><span class="mi">♩</span><span class="mt"><b>Metronom &amp; Gleiten</b><small>Klick ${settings.click !== false ? 'an' : 'aus'} · Finger gleiten ${settings.glideBeats} ${settings.glideBeats === 1 ? 'Schlag' : 'Schläge'} vorher</small></span><span class="mc">›</span></button>
        <button class="mrow" data-go="sound"><span class="mi">🎚</span><span class="mt"><b>Klang</b><small>${SOUND_NAMES[settings.sound]} · ${Math.round(settings.volume * 100)} %</small></span><span class="mc">›</span></button>
        <button class="mrow" data-go="notation"><span class="mi">Aa</span><span class="mt"><b>Notenschrift</b><small>${settings.notation === 'de' ? 'Deutsch (H, Fis, B)' : 'Englisch (B, F#, Bb)'}</small></span><span class="mc">›</span></button>
        <a class="mrow" href="anleitung.html"><span class="mi">📖</span><span class="mt"><b>Anleitung</b><small>Schritt für Schritt mit Bildern</small></span><span class="mc">›</span></a>
        <button class="mrow" data-go="app"><span class="mi">ⓘ</span><span class="mt"><b>App &amp; Speicher</b><small>Version ${VERSION}</small></span><span class="mc">›</span></button>
      </div>` },

    pco: { title: 'Planning Center', html: () => `
      <p>${pco.isConnected() ? `Verbunden${pco.userName() ? ' als <b>' + esc(pco.userName()) + '</b>' : ''}.` : 'Noch nicht verbunden. Du meldest dich einmal mit deinem Planning-Center-Konto an – die App liest nur Lieder und Setlists, sie ändert nichts.'}</p>
      <div class="group">
        <button class="btn primary big" data-pco="next">⚡ Nächste Veranstaltung laden</button>
        <button class="btn" data-pco="plans">Veranstaltung auswählen …</button>
        <button class="btn" data-pco="search">Lied aus Planning Center holen …</button>
      </div>
      ${pco.isConnected() ? '<button class="btn ghost danger" data-pco="logout">Verbindung trennen</button>' : '<button class="btn" data-pco="login">Mit Planning Center verbinden</button>'}
      <details><summary>Erweitert</summary>
        <div class="group">
          <label class="field"><span>Client-ID der Planning-Center-App (leer = wie Ambientpad)</span>
            <input class="input" id="pcoClient" value="${esc(pco.customClientId())}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
          <p class="small muted">Callback-URL, die bei der App in Planning Center eingetragen sein muss:<br><code>${esc(pco.redirectUri())}</code></p>
        </div>
      </details>` },

    keys: { title: 'Klaviatur', html: () => `
      <div class="group">
        <span class="field-label">Ansicht beim Öffnen</span>
        <div class="seg" role="group" aria-label="Hand">${Object.entries(HAND_NAMES).map(([k, v]) => `<button data-set-hand="${k}" aria-pressed="${settings.hand === k}">${v}</button>`).join('')}</div>
        <p class="small muted">Gemerkter Zoom: Rechte Hand ${pct(settings.zoom.rechts)} · Linke Hand ${pct(settings.zoom.links)} · Beide ${pct(settings.zoom.beide)}. Ändern über − / + über der Klaviatur.</p>
        <button class="btn" data-zoom-reset>Zoom zurücksetzen (100 % / Beide: alles)</button>
      </div>
      <div class="group calib">
        <span class="field-label">Echte Tastengröße kalibrieren</span>
        <span class="small muted">Leg eine Bankkarte (8,56 cm breit) auf den Balken und stell ihn mit −/+ gleich lang ein. Dann entspricht „100 %“ genau einer echten Klaviertaste.</span>
        <div class="calib-bar" id="calibBar"></div>
        <div class="row-gap">
          <button type="button" class="icon-btn small" data-cal="-1" aria-label="Kürzer">−</button>
          <button type="button" class="icon-btn small" data-cal="1" aria-label="Länger">+</button>
          <button type="button" class="btn ghost" data-cal="0">Automatisch</button>
          <span class="muted small" id="calibInfo"></span>
        </div>
      </div>` },

    metro: { title: 'Metronom & Gleiten', html: () => `
      <div class="group">
        <span class="field-label">Finger gleiten los …</span>
        <div class="seg" role="group" aria-label="Gleiten">${[1, 2, 3].map((n) => `<button data-glide="${n}" aria-pressed="${settings.glideBeats === n}">${n} ${n === 1 ? 'Schlag' : 'Schläge'} vorher</button>`).join('')}</div>
        <p class="small muted">So lange vor dem Akkordwechsel wandern die Fingernummern zur nächsten Taste. Am Anfang lieber 2 oder 3 Schläge – dann hast du mehr Zeit.</p>
      </div>
      <div class="group">
        <label class="trow"><input type="checkbox" id="clickOn" ${settings.click !== false ? 'checked' : ''}><span><b>Klick hörbar</b><small>Aus: Das Metronom zählt nur sichtbar mit, Akkorde erklingen weiter.</small></span></label>
      </div>
      <p class="small muted">Tempo und Taktart stellst du pro Lied im Lied-Editor ein; Lieder aus Planning Center bringen sie mit.</p>` },

    sound: { title: 'Klang', html: () => `
      <div class="group">
        <div class="seg" role="group" aria-label="Klang">${Object.entries(SOUND_NAMES).map(([k, v]) => `<button data-snd="${k}" aria-pressed="${settings.sound === k}">${v}</button>`).join('')}</div>
        <label class="field"><span>Lautstärke · ${Math.round(settings.volume * 100)} %</span><input type="range" id="vol" min="0" max="1" step="0.05" value="${settings.volume}"></label>
        <button class="btn" data-try>🔊 Probehören</button>
      </div>
      <p class="small muted">Klavier und Rhodes werden im Gerät erzeugt – es braucht kein Internet. Kein Ton? Lautstärke am iPad hochdrehen.</p>` },

    notation: { title: 'Notenschrift', html: () => `
      <div class="group">
        <label class="trow"><input type="radio" name="nt" value="de" ${settings.notation === 'de' ? 'checked' : ''}><span><b>Deutsch</b><small>H, Hm, Fis, B (= englisch Bb)</small></span></label>
        <label class="trow"><input type="radio" name="nt" value="en" ${settings.notation === 'en' ? 'checked' : ''}><span><b>Englisch</b><small>B, Bm, F#, Bb – wie in Planning Center</small></span></label>
      </div>
      <p class="small muted">Lieder aus Planning Center werden beim Holen in diese Schreibweise umgerechnet.</p>` },

    app: { title: 'App & Speicher', html: () => `
      <div class="group">
        <p>Keys2Worship · Version <b>${VERSION}</b></p>
        <p>Ton: <b>${engine.running ? 'aktiv' : 'gesperrt – „Start“ bzw. ▶ antippen'}</b></p>
        <p>${store.loadSongs().length} Lieder in „Zu übende Lieder“${store.loadSetlist() ? ' · Setlist geladen' : ''}</p>
        <button class="btn" data-update>Nach Update suchen</button>
      </div>
      <p class="small muted">Alle Lieder und Einstellungen liegen nur auf diesem Gerät. Die App funktioniert nach dem ersten Öffnen auch ohne Internet.</p>` },
  };

  const render = () => {
    const pg = pages[page];
    d.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <button class="linkbtn" data-back ${page === 'main' ? 'style="visibility:hidden"' : ''}>‹ Zurück</button>
          <h2>${esc(pg.title)}</h2>
          <button class="linkbtn strong" data-close>Fertig</button>
        </div>
        <section class="spage">${pg.html()}</section>
      </div>`;
    if (page === 'keys') paintCalib();
  };
  const paintCalib = () => {
    const bar = d.querySelector('#calibBar'); if (!bar) return;
    bar.style.width = (85.6 * pxPerMm()) + 'px';
    d.querySelector('#calibInfo').textContent = settings.pxPerMm ? 'eigene Einstellung' : 'automatisch geschätzt';
  };

  d.onclick = (e) => {
    if (e.target === d) return d.close();
    const b = e.target.closest('button, input[type=radio]');
    if (!b) return;
    if (b.dataset.close != null) return d.close();
    if (b.dataset.back != null) { page = 'main'; return render(); }
    if (b.dataset.go) { page = b.dataset.go; return render(); }
    if (b.dataset.pco) {
      const a = b.dataset.pco;
      if (a === 'logout') { pco.disconnect(); render(); return changed(); }
      if (a === 'login') return pco.login('settings');
      d.close();
      return a === 'next' ? loadNextPlan() : a === 'plans' ? openPlanPicker() : openSongSearch();
    }
    if (b.dataset.setHand) { setSettings({ hand: b.dataset.setHand }); render(); return changed(); }
    if (b.dataset.zoomReset != null) { setSettings({ zoom: { rechts: 1, links: 1, beide: 0 } }); render(); return changed(); }
    if (b.dataset.cal != null) {
      const k = +b.dataset.cal;
      setSettings({ pxPerMm: k === 0 ? null : pxPerMm() * (k > 0 ? 1.01 : 1 / 1.01) });
      paintCalib(); return changed();
    }
    if (b.dataset.glide) { setSettings({ glideBeats: +b.dataset.glide }); render(); return changed(); }
    if (b.dataset.snd) { setSettings({ sound: b.dataset.snd }); render(); changed(); if (b.dataset.snd !== 'off') engine.chord(voice(), [55, 59, 62, 67], null, 0.2, 1.4, 0.05); return; }
    if (b.dataset.try != null) { engine.unlock(); return engine.chord(voice(), [43, 55, 59, 62, 67], null, 0.22, 1.8, 0.04); }
    if (b.dataset.update != null) { b.textContent = 'Lade neu …'; return navigator.serviceWorker?.getRegistration().then((r) => r && r.update()).finally(() => location.reload()); }
    if (b.name === 'nt') { setSettings({ notation: b.value }); render(); return changed(); }
  };
  d.oninput = (e) => {
    if (e.target.id === 'vol') { setSettings({ volume: +e.target.value }); e.target.previousElementSibling.textContent = `Lautstärke · ${Math.round(settings.volume * 100)} %`; changed(); }
    if (e.target.id === 'pcoClient') pco.setClientId(e.target.value);
    if (e.target.id === 'clickOn') { setSettings({ click: e.target.checked }); changed(); }
  };
  render();
  if (!d.open) d.showModal();
}

// ---------- Planning Center: Auswahl-Dialoge ----------
function sheet(title, bodyHtml) {
  const d = document.getElementById('sheet2');
  d.innerHTML = `<div class="sheet"><div class="sheet-head"><span></span><h2>${esc(title)}</h2><button class="linkbtn strong" data-close>Fertig</button></div><section class="spage">${bodyHtml}</section></div>`;
  d.onclick = (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); };
  if (!d.open) d.showModal();
  return d;
}
function toast(text) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = text; t.classList.add('on');
  clearTimeout(t.timer); t.timer = setTimeout(() => t.classList.remove('on'), 3200);
}
const needLogin = (afterwards) => { if (pco.isConnected()) return false; pco.login(afterwards); return true; };

async function applyPlan(row) {
  const sl = await pco.loadPlan(row, settings.notation);
  store.saveSetlist(sl);
  const n = sl.songs.length, nc = sl.songs.filter((s) => s.noChords).length;
  toast(n ? `Setlist geladen: ${n} Lieder${nc ? ` · ${nc} ohne Akkorde` : ''}` : 'Diese Veranstaltung enthält keine Lieder.');
  if (!location.hash || location.hash === '#/' || location.hash === '#') viewHome(); else location.hash = '#/';
}

async function loadNextPlan() {
  if (needLogin('next')) return;
  toast('Lade nächste Veranstaltung …');
  try {
    const rows = await pco.upcomingPlans(2);
    if (!rows.length) return toast('Keine kommende Veranstaltung gefunden.');
    await applyPlan(rows[0]);
  } catch (e) { if (e.status === 401) return pco.login('next'); toast(pco.errorText(e)); }
}

async function openPlanPicker() {
  if (needLogin('plans')) return;
  const d = sheet('Veranstaltung auswählen', `
    <div class="pick-list" id="planList"><p class="muted">Lade kommende Veranstaltungen …</p></div>
    <div class="group">
      <label class="field"><span>Oder Link zu einem Plan einfügen</span>
        <div class="row-gap"><input class="input" id="planLink" placeholder="https://services.planningcenteronline.com/plans/…" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn primary" data-link>Laden</button></div></label>
    </div>`);
  const list = d.querySelector('#planList');
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-link]'); if (!b) return;
    b.disabled = true; b.textContent = 'Lade …';
    try { await applyPlan(await pco.planFromLink(d.querySelector('#planLink').value)); d.close(); }
    catch (err) { toast(pco.errorText(err)); b.disabled = false; b.textContent = 'Laden'; }
  });
  try {
    const rows = await pco.upcomingPlans(6);
    list.innerHTML = rows.length ? '' : '<p class="muted">Keine kommenden Veranstaltungen gefunden.</p>';
    rows.slice(0, 20).forEach((r) => {
      const a = r.plan.attributes || {};
      const b = document.createElement('button');
      b.className = 'pick';
      b.innerHTML = `<span><b>${esc(a.dates || 'ohne Datum')}</b><small>${esc([r.stName, a.title || a.series_title].filter(Boolean).join(' · '))}${a.items_count ? ` · ${a.items_count} Punkte` : ''}</small></span><span class="mc">›</span>`;
      b.onclick = async () => { b.disabled = true; try { await applyPlan(r); d.close(); } catch (err) { toast(pco.errorText(err)); b.disabled = false; } };
      list.appendChild(b);
    });
  } catch (e) { if (e.status === 401) return pco.login('plans'); list.innerHTML = `<p class="muted">${esc(pco.errorText(e))}</p>`; }
}

async function openSongSearch() {
  if (needLogin('search')) return;
  const d = sheet('Lied aus Planning Center', `
    <div class="row-gap"><input class="input" id="songQ" placeholder="Titel oder Autor" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search"><button class="btn primary" data-search>Suchen</button></div>
    <div class="pick-list" id="songList"><p class="muted">Zuletzt eingeplante Lieder werden geladen …</p></div>`);
  const list = d.querySelector('#songList');
  const showSongs = async (q) => {
    list.innerHTML = '<p class="muted">Suche …</p>';
    try {
      const songs = await pco.searchSongs(q);
      list.innerHTML = songs.length ? '' : '<p class="muted">Nichts gefunden.</p>';
      songs.forEach((s) => {
        const b = document.createElement('button');
        b.className = 'pick';
        b.innerHTML = `<span><b>${esc(s.title)}</b><small>${esc([s.author, s.last && 'zuletzt ' + s.last].filter(Boolean).join(' · '))}</small></span><span class="mc">›</span>`;
        b.onclick = () => showArrangements(s);
        list.appendChild(b);
      });
    } catch (e) { if (e.status === 401) return pco.login('search'); list.innerHTML = `<p class="muted">${esc(pco.errorText(e))}</p>`; }
  };
  const showArrangements = async (s) => {
    list.innerHTML = `<p class="muted">Lade Arrangements von „${esc(s.title)}“ …</p>`;
    try {
      const arrs = await pco.songArrangements(s.id);
      list.innerHTML = `<button class="pick back" data-back-search>‹ Zurück zur Liste</button>`;
      list.querySelector('[data-back-search]').onclick = () => showSongs(d.querySelector('#songQ').value);
      arrs.forEach((a) => {
        const song = pco.songFromArrangement(s, a, settings.notation);
        const saved = store.isSaved(song.id);
        const row = document.createElement('div');
        row.className = 'pick static';
        row.innerHTML = `<span><b>${esc(a.name)}</b><small>Tonart ${esc(song.key)} · ${song.bpm} BPM · ${esc(song.meter)}${song.noChords ? ' · <em>keine Akkorde hinterlegt</em>' : ' · ' + song.sections.map((x) => esc(x.name)).join(', ')}</small></span>
          <span class="row-gap"><button class="btn ${saved ? 'ghost' : 'primary'}" data-add>${saved ? '✓ Gemerkt' : '+ Merken'}</button><button class="btn ghost" data-go>Üben</button></span>`;
        row.querySelector('[data-add]').onclick = (ev) => { store.upsertSong(song); ev.target.textContent = '✓ Gemerkt'; ev.target.className = 'btn ghost'; toast(`„${song.title}“ steht jetzt in „Zu übende Lieder“`); if (location.hash === '#/' || !location.hash) viewHome(); };
        row.querySelector('[data-go]').onclick = () => { store.upsertSong(song); d.close(); location.hash = song.noChords ? `#/song/${song.id}/edit` : `#/song/${song.id}/practice`; };
        list.appendChild(row);
      });
      if (!arrs.length) list.insertAdjacentHTML('beforeend', '<p class="muted">Dieses Lied hat noch kein Arrangement.</p>');
    } catch (e) { if (e.status === 401) return pco.login('search'); list.innerHTML = `<p class="muted">${esc(pco.errorText(e))}</p>`; }
  };
  d.querySelector('[data-search]').onclick = () => showSongs(d.querySelector('#songQ').value);
  d.querySelector('#songQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') showSongs(e.target.value); });
  showSongs('');
}

// ---------- Startseite ----------
function viewHome() {
  document.title = 'Keys2Worship';
  const songs = store.loadSongs();
  const sl = store.loadSetlist();
  const lastId = store.getLast();
  const last = store.getSong(lastId) || songs[0];
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
  const songMeta = (s) => `${esc(s.key)} · ${s.bpm} BPM · ${s.noChords && !store.isSaved(s.id) ? '<span class="warn-text">keine Akkorde</span>' : `${s.sections.length} ${s.sections.length === 1 ? 'Teil' : 'Teile'}`}`;

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
      <a class="btn dark big" href="#/song/${encodeURIComponent(last.id)}/practice${sl && sl.songs.some((x) => x.id === last.id) ? '?sl=1' : ''}">${icon.play} Üben</a>
    </section>` : ''}

    <div class="h2-row"><h2 class="h2">Setlist aus Planning Center ${sl ? `<span class="muted small">${esc(sl.title)}${sl.date ? ' · ' + esc(sl.date) : ''}</span>` : ''}</h2>
      ${sl ? '<div class="row-gap"><button class="btn ghost" data-act="pco-reload">Aktualisieren</button><button class="btn ghost" data-act="pco-plans">Andere wählen</button></div>' : ''}</div>
    ${sl ? `
    <ol class="list setlist">
      ${sl.songs.map((s, i) => `<li class="list-item">
        <div><span class="li-title"><span class="num">${i + 1}</span>${esc(s.title)}</span><span class="muted small">${songMeta(s)}</span></div>
        <div class="row-gap">
          ${store.isSaved(s.id) ? '<span class="small ok">✓ gemerkt</span>' : `<button class="btn ghost" data-save="${esc(s.id)}">+ Merken</button>`}
          <a class="btn primary" href="#/song/${encodeURIComponent(s.id)}/${s.noChords && !store.isSaved(s.id) ? 'edit' : 'practice?sl=1'}">${s.noChords && !store.isSaved(s.id) ? 'Akkorde eintragen' : 'Üben'}</a>
        </div></li>`).join('') || '<li class="muted">Diese Veranstaltung enthält keine Lieder.</li>'}
    </ol>` : `
    <section class="card dashed pco-card">
      <p class="muted">Hol dir die Lieder des nächsten Gottesdienstes – mit Tonart, Tempo und (falls in Planning Center gepflegt) den Akkorden.</p>
      <div class="row-gap wrap">
        <button class="btn primary" data-act="pco-next">⚡ Nächste Veranstaltung laden</button>
        <button class="btn ghost" data-act="pco-plans">Veranstaltung auswählen …</button>
      </div>
    </section>`}

    ${pairs.length ? `
    <h2 class="h2">Akkordwechsel trainieren <span class="muted small">aus „${esc(last.title)}“</span></h2>
    <section class="tiles">
      ${pairs.map((p) => `<a class="tile" href="#/song/${encodeURIComponent(last.id)}/practice?sec=0&mode=wechsel&at=${p.i}">
        <span class="tile-title chord-font">${esc(p.label)}</span><span class="muted small">${p.note}</span></a>`).join('')}
    </section>` : ''}

    <div class="h2-row"><h2 class="h2">Zu übende Lieder</h2>
      <div class="row-gap"><button class="btn ghost" data-act="pco-search">+ Aus Planning Center</button><a class="btn ghost" href="#/new">+ Lied anlegen</a></div></div>
    <ul class="list">
      ${songs.map((s) => `<li class="list-item">
        <div><span class="li-title">${esc(s.title || 'Ohne Titel')}${s.source === 'pco' ? ' <span class="tag">PCO</span>' : ''}</span>
        <span class="muted small">${songMeta(s)}</span></div>
        <div class="row-gap"><a class="btn ghost" href="#/song/${encodeURIComponent(s.id)}/edit">Bearbeiten</a><a class="btn primary" href="#/song/${encodeURIComponent(s.id)}/practice">Üben</a></div>
      </li>`).join('') || '<li class="muted">Noch keine Lieder – leg eins an oder hol es aus Planning Center.</li>'}
    </ul>
    <p class="app-footer">Keys2Worship · Version ${VERSION} · <a href="anleitung.html">Anleitung</a></p>
  </div>`;
  app.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.save) {
      const s = (store.loadSetlist()?.songs || []).find((x) => x.id === b.dataset.save);
      if (s) { store.upsertSong(structuredClone(s)); toast(`„${s.title}“ steht jetzt in „Zu übende Lieder“`); viewHome(); }
      return;
    }
    switch (b.dataset.act) {
      case 'settings': return openSettings(() => viewHome());
      case 'pco-next': return loadNextPlan();
      case 'pco-plans': return openPlanPicker();
      case 'pco-search': return openSongSearch();
      case 'pco-reload': return reloadSetlist();
    }
  };
  cleanup = () => { app.onclick = null; };
}

async function reloadSetlist() {
  const sl = store.loadSetlist(); if (!sl) return;
  if (needLogin('reload')) return;
  toast('Aktualisiere Setlist …');
  try { await applyPlan(await pco.planFromLink(String(sl.planId))); }
  catch (e) { if (e.status === 401) return pco.login('reload'); toast(pco.errorText(e)); }
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

  // Aus der Setlist geöffnet? Dann Vor/Zurück zum nächsten Lied anbieten
  const sl = q.sl ? store.loadSetlist() : null;
  const slPos = sl ? sl.songs.findIndex((x) => x.id === id) : -1;
  const slLink = (i) => { const t = sl.songs[i]; const own = store.getSong(t.id); return `#/song/${encodeURIComponent(t.id)}/${own && !own.noChords ? 'practice?sl=1' : (t.noChords ? 'edit' : 'practice?sl=1')}`; };
  const slNav = slPos >= 0 ? `<div class="sl-nav" aria-label="Setlist">
      ${slPos > 0 ? `<a class="icon-btn small" href="${slLink(slPos - 1)}" aria-label="Vorheriges Lied">${icon.prev}</a>` : ''}
      <span class="small muted">Lied ${slPos + 1}/${sl.songs.length}</span>
      ${slPos < sl.songs.length - 1 ? `<a class="icon-btn small" href="${slLink(slPos + 1)}" aria-label="Nächstes Lied">${icon.next}</a>` : ''}
    </div>` : '';

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
    const rh = P.steps.flatMap((x) => x.notes), lh = P.steps.map((x) => x.bass);
    P.frame = P.steps.length ? { rh: [Math.min(...rh), Math.max(...rh)], lh: [Math.min(...lh), Math.max(...lh)] } : null;
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
        ${slNav}
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
        <div class="metro-row"><div class="beats" id="beats" aria-hidden="true"></div>
          <button class="click-btn" data-act="click" id="clickBtn"></button>
          <strong class="small" id="count" aria-live="polite"></strong></div>
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
        <div class="row-gap bk-tools">
          <button class="btn ghost small-btn" data-act="bk-edit" id="bkBtn" aria-pressed="false">⇕ Schwarze Tasten</button>
          <span class="bk-extra" hidden><button class="icon-btn small" data-act="bk-up" aria-label="Schwarze Tasten kürzer">▲</button><button class="icon-btn small" data-act="bk-down" aria-label="Schwarze Tasten länger">▼</button></span>
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
  const kb = new Keyboard(kbWrap, { lo: 36, hi: 76, onKey: tapNote, keyName: (m) => noteLabel(m, notation, flats) });
  kb.setBlackRatio(settings.blackRatio || 0.55);

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
  applyZoom();
  requestAnimationFrame(applyZoom);

  const transport = new Transport(engine, {
    getBpm: () => P.bpm,
    getBeatsPerBar: () => bpb,
    onSchedule: (beat, bar, time) => {
      const level = beat === 0 ? 2 : (bpb === 6 && beat === 3 ? 1 : 0);
      if (settings.click !== false) engine.click(time, level, settings.sound === 'off' ? 0.25 : 0.12);
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
      || `<p class="muted">${song.noChords ? 'Für dieses Lied sind in Planning Center keine Akkorde hinterlegt.' : 'Dieser Teil hat noch keine Akkorde.'} <a href="#/song/${encodeURIComponent(song.id)}/edit">Akkorde eintragen ›</a></p>`;
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
    const cb = $('#clickBtn');
    cb.innerHTML = settings.click !== false ? `${icon.speaker} Klick` : `${icon.mute} Klick aus`;
    cb.setAttribute('aria-pressed', String(settings.click !== false));
    cb.classList.toggle('off', settings.click === false);
    kb.update({ frame: P.frame, cur, next: N() > 1 ? next : null, glide: P.glide, dur: P.glideDur, aids, showRH, showLH,
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
      case 'click': setSettings({ click: settings.click === false }); return update();
      case 'bk-edit': {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        $('.bk-extra').hidden = !on;
        kb.setBlackEdit(on, (r) => setSettings({ blackRatio: r }));
        return;
      }
      case 'bk-up': kb.setBlackRatio(kb.blackRatio - 0.03); setSettings({ blackRatio: kb.blackRatio }); return;
      case 'bk-down': kb.setBlackRatio(kb.blackRatio + 0.03); setSettings({ blackRatio: kb.blackRatio }); return;
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
(async () => {
  const r = await pco.handleRedirect();
  route();
  if (!r) return;
  if (!r.ok) { toast(r.error); return openSettings(null, 'pco'); }
  toast('Mit Planning Center verbunden');
  if (r.back && r.back !== location.hash) location.hash = r.back;
  if (r.afterwards === 'next') loadNextPlan();
  else if (r.afterwards === 'plans') openPlanPicker();
  else if (r.afterwards === 'search') openSongSearch();
  else if (r.afterwards === 'reload') reloadSetlist();
  else openSettings(null, 'pco');
})();
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
