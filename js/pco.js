// Planning Center Services: Anmeldung (OAuth 2.0 + PKCE, ohne Server), Setlists, Liedsuche,
// Akkorde aus „Lyrics & Chords“. Nutzt dieselbe registrierte Planning-Center-App wie Ambientpad.

import { parseChord, convertSymbol, prefersFlats } from './music.js';

const PCO_DEFAULT_CLIENT_ID = '75c62ac2b92e87a487723cfefdc07df4b4cf8b9de96c6cdd3ce32bbfeec635a8';
const PCO_BASE = 'https://api.planningcenteronline.com';
const K = { cfg: 'keys2worship:pco', token: 'keys2worship:pcotoken', pkce: 'keys2worship:pkce' };

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* voll */ } };
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

let CFG = Object.assign({ clientId: '' }, load(K.cfg, {}));
let TOK = load(K.token, null); // {at, atExp, rt, rtExp, user}

export const clientId = () => (CFG.clientId || PCO_DEFAULT_CLIENT_ID || '').trim();
export function setClientId(v) { CFG.clientId = (v || '').trim(); save(K.cfg, CFG); }
export const customClientId = () => CFG.clientId || '';
export const isConnected = () => !!(TOK && TOK.rt && Date.now() < TOK.rtExp);
export const userName = () => (TOK && TOK.user) || '';
export function disconnect() { TOK = null; save(K.token, null); }

/** Zur Anmeldung bei Planning Center weiterleiten. `afterwards` sagt, was nach der Rückkehr passieren soll. */
export async function login(afterwards = 'setlist') {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  save(K.pkce, { verifier, state, afterwards, back: location.hash, t: Date.now() });
  const q = new URLSearchParams({ client_id: clientId(), response_type: 'code', redirect_uri: redirectUri(), scope: 'services', state, code_challenge: challenge, code_challenge_method: 'S256' });
  location.href = `${PCO_BASE}/oauth/authorize?${q}`;
}

function storeToken(j) {
  const now = Date.now();
  TOK = { at: j.access_token, atExp: now + (j.expires_in || 7200) * 1000 - 60000, rt: j.refresh_token || (TOK && TOK.rt),
    rtExp: now + 89 * 24 * 3600 * 1000, user: (TOK && TOK.user) || '' };
  save(K.token, TOK);
}

async function tokenRequest(params) {
  const res = await fetch(`${PCO_BASE}/oauth/token`, { method: 'POST', body: new URLSearchParams(Object.assign({ client_id: clientId() }, params)) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw Object.assign(new Error(j.error_description || j.error || ('HTTP ' + res.status)), { status: res.status });
  return j;
}

/**
 * Rückkehr von der Anmeldung (…/Keys2worship/?code=…&state=…) verarbeiten.
 * Liefert null (nichts zu tun) oder { ok, afterwards, back, error }.
 */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  history.replaceState(null, '', location.pathname);
  const pk = load(K.pkce, null); save(K.pkce, null);
  if (q.has('error')) return { ok: false, error: 'Anmeldung abgebrochen.' };
  if (!pk || pk.state !== q.get('state')) return { ok: false, error: 'Anmeldung ungültig – bitte erneut verbinden.' };
  try {
    storeToken(await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: pk.verifier }));
    whoAmI();
    return { ok: true, afterwards: pk.afterwards, back: pk.back };
  } catch (e) {
    const m = String(e.message || e);
    return { ok: false, error: /invalid_client|client authentication/i.test(m)
      ? 'Planning Center verlangt ein Secret – die App ist dort als „vertraulich“ angelegt. Bitte auf „öffentlich“ (PKCE ohne Secret) umstellen.'
      : `Anmeldung fehlgeschlagen (${m.slice(0, 120)}). Ist bei der Planning-Center-App die Callback-URL „${redirectUri()}“ eingetragen?` };
  }
}

async function token() {
  if (!TOK) return null;
  if (TOK.at && Date.now() < TOK.atExp) return TOK.at;
  if (!isConnected()) return null;
  try { storeToken(await tokenRequest({ grant_type: 'refresh_token', refresh_token: TOK.rt })); return TOK.at; }
  catch (e) { if (e.status === 400 || e.status === 401) { TOK.rtExp = 0; save(K.token, TOK); } return null; }
}

async function api(path) {
  const t = await token();
  if (!t) throw Object.assign(new Error('Nicht angemeldet'), { status: 401 });
  const res = await fetch(path.startsWith('http') ? path : PCO_BASE + path, { headers: { Authorization: 'Bearer ' + t } });
  if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
  return res.json();
}

async function whoAmI() {
  try {
    const j = await api('/services/v2/me');
    const a = (j.data && j.data.attributes) || {};
    TOK.user = a.full_name || [a.first_name, a.last_name].filter(Boolean).join(' ') || TOK.user;
    save(K.token, TOK);
  } catch { /* egal */ }
}

export function errorText(e) {
  if (!navigator.onLine) return 'Kein Internet.';
  if (e && e.status === 401) return 'Anmeldung abgelaufen – bitte neu verbinden.';
  if (e && e.status === 403) return 'Kein Zugriff darauf.';
  if (e && e.status === 404) return 'Nicht gefunden – stimmt der Link?';
  return 'Planning Center gerade nicht erreichbar.';
}

// ---------- Veranstaltungen ----------

/** Kommende Veranstaltungen aller Gottesdienst-Typen, nach Datum sortiert. */
export async function upcomingPlans(perType = 6) {
  const types = (await api('/services/v2/service_types?per_page=100')).data || [];
  const rows = [];
  await Promise.all(types.map(async (t) => {
    try {
      const j = await api(`/services/v2/service_types/${t.id}/plans?filter=future&order=sort_date&per_page=${perType}`);
      for (const p of j.data || []) rows.push({ stId: t.id, stName: t.attributes.name, plan: p, sort: p.attributes.sort_date || '' });
    } catch (e) { if (e.status === 401) throw e; }
  }));
  rows.sort((a, b) => a.sort.localeCompare(b.sort));
  return rows;
}

/** Plan aus einem Link „…/plans/12345“ oder einer Nummer finden. */
export async function planFromLink(text) {
  const m = String(text).match(/plans\/(\d+)/) || String(text).trim().match(/^(\d+)$/);
  if (!m) throw Object.assign(new Error('Kein Plan-Link'), { status: 404 });
  const types = (await api('/services/v2/service_types?per_page=100')).data || [];
  for (const t of types) {
    try { const j = await api(`/services/v2/service_types/${t.id}/plans/${m[1]}`); return { stId: t.id, stName: t.attributes.name, plan: j.data }; }
    catch (e) { if (e.status === 401) throw e; }
  }
  throw Object.assign(new Error('Plan nicht gefunden'), { status: 404 });
}

/** Lieder eines Plans als fertige Übungs-Lieder (mit Akkorden, falls „Lyrics & Chords“ gepflegt sind). */
export async function loadPlan(row, notation) {
  const j = await api(`/services/v2/service_types/${row.stId}/plans/${row.plan.id}/items?per_page=100&include=arrangement,song`);
  const arr = {};
  for (const x of j.included || []) if (x.type === 'Arrangement') arr[x.id] = x.attributes || {};
  const items = (j.data || []).filter((x) => x.attributes && x.attributes.item_type === 'song')
    .sort((a, b) => (a.attributes.sequence || 0) - (b.attributes.sequence || 0));
  const songs = items.map((x) => {
    const rel = x.relationships || {};
    const songId = rel.song && rel.song.data && rel.song.data.id;
    const arrId = rel.arrangement && rel.arrangement.data && rel.arrangement.data.id;
    return buildSong({ songId, arrId, title: x.attributes.title, keyName: x.attributes.key_name, arrangement: arr[arrId] || {}, notation });
  });
  const a = row.plan.attributes || {};
  return {
    planId: row.plan.id, stId: row.stId,
    title: [row.stName, a.title || a.series_title].filter(Boolean).join(' · ') || 'Setlist',
    date: a.dates || '', loaded: Date.now(), songs,
  };
}

// ---------- Liedsuche ----------

/** Lieder aus der Planning-Center-Liederdatenbank suchen. */
export async function searchSongs(query) {
  const qs = query.trim();
  let list = [];
  if (qs) {
    try { list = (await api(`/services/v2/songs?per_page=25&order=title&where[title]=${encodeURIComponent(qs)}`)).data || []; }
    catch (e) { if (e.status === 401) throw e; }
  }
  if (!list.length) {
    // Teilwort-Suche: die zuletzt eingeplanten Lieder holen und selbst filtern
    const j = await api('/services/v2/songs?per_page=100&order=-last_scheduled_at');
    const low = qs.toLowerCase();
    list = (j.data || []).filter((s) => !low || (s.attributes.title || '').toLowerCase().includes(low) || (s.attributes.author || '').toLowerCase().includes(low));
  }
  return list.slice(0, 40).map((s) => ({ id: s.id, title: s.attributes.title || 'Lied', author: s.attributes.author || '', last: s.attributes.last_scheduled_short_dates || '' }));
}

/** Arrangements eines Lieds (mit Tonart, Tempo, Akkord-Chart). */
export async function songArrangements(songId) {
  const j = await api(`/services/v2/songs/${songId}/arrangements?per_page=25`);
  return (j.data || []).map((a) => ({ id: a.id, name: a.attributes.name || 'Arrangement', attrs: a.attributes || {} }));
}

export function songFromArrangement(song, arr, notation) {
  return buildSong({ songId: song.id, arrId: arr.id, title: song.title, keyName: arr.attrs.chord_chart_key, arrangement: arr.attrs, notation, arrName: arr.name });
}

// ---------- Umwandlung in ein Übungs-Lied ----------

function meterOf(m) {
  const s = String(m || '').replace(/\s/g, '');
  return ['4/4', '3/4', '6/8'].includes(s) ? s : (s === '12/8' ? '6/8' : '4/4');
}

/** Erste Tonart aus Angaben wie „G“, „Bb“, „C - D“, „Em“ (englische Schreibweise von Planning Center). */
function firstKey(name) {
  const m = String(name || '').replace(/♯/g, '#').replace(/♭/g, 'b').match(/[A-G](#|b)?m?/);
  return m ? m[0] : '';
}

function buildSong({ songId, arrId, title, keyName, arrangement, notation, arrName }) {
  const keyEn = firstKey(keyName) || firstKey(arrangement.chord_chart_key) || '';
  const chartKeyEn = firstKey(arrangement.chord_chart_key) || keyEn;
  // Akkord-Chart steht in der Tonart des Charts; der Plan kann eine andere Tonart vorgeben → transponieren
  const kc = parseChord(chartKeyEn, 'en'), kp = parseChord(keyEn, 'en');
  const semis = kc && kp ? ((kp.root - kc.root) + 12) % 12 : 0;
  const keyOut = keyEn ? convertSymbol(keyEn, 'en', notation, prefersFlats(keyEn, 'en')) : '';
  const flats = keyEn ? prefersFlats(keyEn, 'en') : false;
  const sections = parseChordChart(arrangement.chord_chart || '').map((sec) => ({
    name: sec.name,
    chords: sec.chords.map((c) => convertSymbol(c, 'en', notation, flats, semis > 6 ? semis - 12 : semis)).join(' '),
  }));
  const bpm = Math.round(+arrangement.bpm || 0) || 72;
  return {
    id: `pco-${songId || 'x'}-${arrId || 'x'}`,
    title: title || 'Lied',
    key: keyOut || 'C',
    bpm: Math.max(30, Math.min(200, bpm)),
    meter: meterOf(arrangement.meter),
    sections: sections.length ? sections : [{ name: 'Lied', chords: '' }],
    source: 'pco',
    pco: { songId, arrId, arrName: arrName || '' },
    noChords: !sections.length,
  };
}

// ---------- „Lyrics & Chords“ lesen ----------

const SECTION_RE = /^\s*(verse|vers|strophe|chorus|refrain|pre[\s-]?chorus|prechorus|bridge|intro|outro|tag|ending|interlude|instrumental|turnaround|vamp|coda|zwischenspiel|ende|post[\s-]?chorus|breakdown|hook)\b[^\n]{0,20}$/i;
const IGNORE_RE = /^\s*(COLUMN_BREAK|PAGE_BREAK|\{.*\})\s*$/i;
const CHORD_TOKEN = /^[A-G](#|b)?(m|maj|min|dim|aug|sus|add|\+|°|-)?[0-9]*(sus[24]?|add[0-9]+|maj[0-9]*|[0-9])*(\/[A-G](#|b)?)?$/;

function niceName(raw) {
  const t = raw.replace(/\(.*?\)/g, '').replace(/[:\-–]+\s*$/, '').trim().toLowerCase();
  const map = [[/^pre[\s-]?chorus|^prechorus/, 'Pre-Chorus'], [/^post[\s-]?chorus/, 'Post-Chorus'], [/^(verse|vers|strophe)/, 'Strophe'], [/^(chorus|refrain)/, 'Refrain'],
    [/^bridge/, 'Bridge'], [/^intro/, 'Intro'], [/^(outro|ending|ende|coda)/, 'Outro'], [/^tag/, 'Tag'], [/^(interlude|zwischenspiel|instrumental|turnaround|vamp|breakdown|hook)/, 'Zwischenspiel']];
  let base = 'Teil';
  for (const [re, n] of map) if (re.test(t)) { base = n; break; }
  const num = (t.match(/(\d+)/) || [])[1];
  return num ? `${base} ${num}` : base;
}

/**
 * Akkorde aus einem Planning-Center-Chart lesen. Versteht beide Schreibweisen:
 * Akkorde in Klammern im Text („[G]Amazing [C]grace“) und Akkordzeilen über dem Text („G     C“).
 * Ergebnis: [{ name, chords:[…] }] – ein Akkord pro Takt, Wiederholungen direkt hintereinander zusammengefasst.
 */
export function parseChordChart(text) {
  const out = [];
  let cur = null;
  const push = (name) => { cur = { name, chords: [] }; out.push(cur); };
  const addChord = (c) => {
    c = c.trim().replace(/[()]/g, '');
    if (!CHORD_TOKEN.test(c)) return;
    if (!cur) push('Lied');
    if (cur.chords[cur.chords.length - 1] !== c) cur.chords.push(c);
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || IGNORE_RE.test(line)) continue;
    if (SECTION_RE.test(line) && line.length <= 30 && !/\[/.test(line)) { push(niceName(line)); continue; }
    const brackets = [...line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    if (brackets.length) { brackets.forEach(addChord); continue; }
    const tokens = line.split(/\s+/).filter((t) => !/^(\||x\d+|\d+x|-+|\/+|%)$/i.test(t));
    if (tokens.length && tokens.every((t) => CHORD_TOKEN.test(t.replace(/[()|]/g, '')))) tokens.forEach((t) => addChord(t.replace(/\|/g, '')));
  }
  // Leere Teile weg, gleiche Wiederholungen (z. B. Strophe 2 = Strophe 1) nur einmal
  const seen = new Set();
  return out.filter((s) => s.chords.length).filter((s) => {
    const k = s.name.replace(/\s\d+$/, '') + ':' + s.chords.join(' ');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, 8);
}
