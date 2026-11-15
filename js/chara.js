// Chara Technics: Anmeldung mit OAuth 2.1 + PKCE (öffentlicher Client, kein Secret), Pläne, Setlisten
// und Lieder mit Akkorden (ChordPro). Jeder meldet sich mit seinem eigenen Konto an; was er sehen darf,
// entscheidet der Server – die App filtert nichts.
//
// Sicherheit: Tokens stehen nie in der Adresse und nie im Log. Standard ist „angemeldet bleiben“
// (localStorage), abschaltbar → dann nur sessionStorage (weg, sobald die App/der Tab geschlossen wird).
// Es werden keine fremden Skripte eingebunden.

import { convertSymbol } from './music.js';
import { makeSong, firstKey } from './pco.js';

const BASE = 'https://technics.chara.church';
const API = BASE + '/api/v1';
const CLIENT_ID = 'olivergentina-github-io';
const K = {
  token: 'keys2worship:chara:token',
  pkce: 'keys2worship:chara:pkce',
  persist: 'keys2worship:chara:persist',
  docs: 'keys2worship:chara:docs',
};
const LOCK = 'keys2worship-chara-refresh';

// ---------- Speicher ----------

const readJson = (store, k) => { try { return JSON.parse(store.getItem(k)); } catch { return null; } };
const writeJson = (store, k, v) => { try { v == null ? store.removeItem(k) : store.setItem(k, JSON.stringify(v)); } catch { /* voll/gesperrt */ } };

export const persists = () => { try { return localStorage.getItem(K.persist) !== '0'; } catch { return false; } };
const tokenStore = () => (persists() ? localStorage : sessionStorage);

/** Angemeldet bleiben an/aus. Der vorhandene Token zieht in den jeweils anderen Speicher um. */
export function setPersist(on) {
  const tok = readTok();
  try { localStorage.setItem(K.persist, on ? '1' : '0'); } catch { /* egal */ }
  writeJson(localStorage, K.token, null); writeJson(sessionStorage, K.token, null);
  if (tok) writeJson(tokenStore(), K.token, tok);
}

const readTok = () => readJson(tokenStore(), K.token); // {at, atExp, rt, user}
let TOK = readTok();

// Andere offene Tabs über neue Tokens informieren (gleiche Herkunft, verlässt das Gerät nicht).
// So benutzt kein Tab einen Refresh-Token, der schon ersetzt wurde.
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('keys2worship-chara') : null;
if (bc) bc.onmessage = (e) => { TOK = e.data || null; writeJson(tokenStore(), K.token, TOK); };

function setTok(t, announce = true) {
  TOK = t;
  writeJson(tokenStore(), K.token, t);
  if (announce && bc) bc.postMessage(t);
}

export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
export const isConnected = () => !!(TOK && (TOK.rt || (TOK.at && Date.now() < TOK.atExp)));
export const userName = () => (TOK && TOK.user) || '';
export function disconnect() { setTok(null); }

// ---------- Anmeldung ----------

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
function randomString(n) {
  let out = '';
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < 198) out += UNRESERVED[b % 66]; // 198 = 3·66 → gleichverteilt
      if (out.length === n) break;
    }
  }
  return out;
}
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Zur Anmeldung bei Chara Technics weiterleiten. `afterwards` sagt, was nach der Rückkehr passieren soll. */
export async function login(afterwards = 'settings') {
  const verifier = randomString(64);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = randomString(32);
  writeJson(sessionStorage, K.pkce, { verifier, state, afterwards, back: location.hash, t: Date.now() });
  const q = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri(),
    code_challenge: challenge, code_challenge_method: 'S256', state,
  });
  location.href = `${BASE}/oauth/authorize?${q}`;
}

function storeToken(j) {
  setTok({
    at: j.access_token,
    atExp: Date.now() + (j.expires_in || 3600) * 1000 - 60000, // eine Minute Puffer
    rt: j.refresh_token || null,
    user: (TOK && TOK.user) || '',
  });
}

async function tokenRequest(params) {
  const res = await fetch(`${BASE}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_id: CLIENT_ID }, params)),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw Object.assign(new Error(j.message || j.error_description || j.error || ('HTTP ' + res.status)), { status: res.status, code: j.error || '' });
  }
  return j;
}

/**
 * Rückkehr von der Anmeldung verarbeiten (…?code=…&state=… bzw. ?error=…).
 * Liefert null, wenn die Rückkehr nicht zu Chara gehört (z. B. Planning Center), sonst { ok, afterwards, back, error }.
 */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  const pk = readJson(sessionStorage, K.pkce);
  if (!pk) return null;
  const mine = q.get('state') ? q.get('state') === pk.state : Date.now() - pk.t < 15 * 60000;
  if (!mine) return null;
  writeJson(sessionStorage, K.pkce, null);
  history.replaceState(null, '', location.pathname + location.hash); // code & state sofort aus der Adresse
  if (q.has('error')) {
    return { ok: false, back: pk.back, error: q.get('error') === 'access_denied' ? 'Anmeldung bei Chara Technics abgelehnt.' : 'Anmeldung bei Chara Technics abgebrochen.' };
  }
  try {
    storeToken(await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: pk.verifier }));
    await whoAmI();
    fetchDocsOnce();
    return { ok: true, afterwards: pk.afterwards, back: pk.back };
  } catch (e) {
    return { ok: false, back: pk.back, error: `Anmeldung bei Chara Technics fehlgeschlagen: ${String(e.message || e).slice(0, 140)}` };
  }
}

// ---------- Token erneuern: nie zwei Erneuerungen gleichzeitig ----------

let refreshing = null;

function refresh() {
  if (refreshing) return refreshing; // gemeinsames Promise innerhalb dieses Tabs
  const before = TOK && TOK.rt;
  const run = async () => {
    // Hat ein anderer Tab in der Zwischenzeit schon erneuert? Dann dessen Token übernehmen.
    const stored = readTok();
    if (stored && stored.rt && stored.rt !== before && Date.now() < stored.atExp) { TOK = stored; return; }
    if (!TOK || !TOK.rt) throw Object.assign(new Error('Nicht angemeldet'), { status: 401, relogin: true });
    try {
      storeToken(await tokenRequest({ grant_type: 'refresh_token', refresh_token: TOK.rt }));
    } catch (e) {
      if (e.code === 'invalid_grant' || e.status === 400 || e.status === 401) {
        setTok(null);
        throw Object.assign(new Error('Bitte neu anmelden.'), { status: 401, relogin: true });
      }
      throw e;
    }
  };
  // Web Locks sperren auch über mehrere Tabs hinweg
  const p = navigator.locks ? navigator.locks.request(LOCK, run) : run();
  refreshing = p.finally(() => { refreshing = null; });
  return refreshing;
}

async function accessToken() {
  if (!TOK) throw Object.assign(new Error('Nicht angemeldet'), { status: 401, relogin: true });
  if (TOK.at && Date.now() < TOK.atExp) return TOK.at;
  await refresh();
  return TOK.at;
}

// ---------- API ----------

async function request(path, params, retried = false) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') url.searchParams.set(k, v);
  const t = await accessToken();
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + t, Accept: 'application/json, text/markdown;q=0.9' } });
  if (res.status === 401 && !retried) { await refresh(); return request(path, params, true); }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw Object.assign(new Error(j.message || 'HTTP ' + res.status), { status: res.status, server: j.message || '' });
  }
  return res;
}
const api = async (path, params) => (await request(path, params)).json();

export function errorText(e) {
  if (!navigator.onLine) return 'Kein Internet.';
  if (e && e.relogin) return 'Bitte neu bei Chara Technics anmelden.';
  if (e && e.server) return e.server; // Der Server antwortet schon auf Deutsch
  if (e && e.status === 401) return 'Anmeldung abgelaufen – bitte neu anmelden.';
  if (e && e.status === 403) return 'Keine Freigabe dafür (nur Musiker, Manager und Admins).';
  if (e && e.status === 404) return 'Nicht gefunden oder für dich nicht sichtbar.';
  return 'Chara Technics gerade nicht erreichbar.';
}

/** Version und angemeldetes Konto – zum Testen der Verbindung. */
export const info = () => api('');

async function whoAmI() {
  try {
    const j = await info();
    const acc = pick(j, 'account', 'user', 'me', 'data.account', 'data.user') || {};
    const name = typeof acc === 'string' ? acc : pick(acc, 'name', 'displayName', 'fullName', 'username');
    if (TOK && name) setTok(Object.assign({}, TOK, { user: String(name) }));
  } catch { /* egal */ }
}

/** Die API-Doku (Markdown) nach dem ersten Login einmal holen und merken – enthält keine Zugangsdaten. */
async function fetchDocsOnce() {
  try { if (!localStorage.getItem(K.docs)) localStorage.setItem(K.docs, await (await request('/docs')).text()); } catch { /* egal */ }
}
export async function docs(force = false) {
  if (!force) { try { const d = localStorage.getItem(K.docs); if (d) return d; } catch { /* egal */ } }
  const d = await (await request('/docs')).text();
  try { localStorage.setItem(K.docs, d); } catch { /* egal */ }
  return d;
}

// ---------- Hilfen zum Lesen der Antworten ----------

/** Erstes vorhandenes Feld (auch verschachtelt mit Punkt, z. B. 'song.title'). */
function pick(o, ...keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((x, p) => (x == null ? x : x[p]), o);
    if (v != null && v !== '') return v;
  }
  return undefined;
}
const listOf = (j) => (Array.isArray(j) ? j : Array.isArray(j && j.data) ? j.data
  : (j && j.data && (j.data.items || j.data.songs || j.data.setlist)) || (j && (j.items || j.songs || j.setlist)) || []);
const objOf = (j) => (j && j.data && !Array.isArray(j.data) ? j.data : j);

/** Alle Seiten einer Liste holen ({ data, nextCursor }), höchstens `max` Einträge. */
async function all(path, params, max = 100) {
  const out = [];
  let cursor = null;
  do {
    const j = await api(path, Object.assign({}, params, cursor ? { cursor } : {}));
    out.push(...listOf(j));
    cursor = j && j.nextCursor;
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

function niceDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}
const isoDay = (d) => d.toISOString().slice(0, 10);

// ---------- Pläne ----------

function planRow(p) {
  const st = pick(p, 'serviceType.name', 'serviceTypeName', 'serviceType.title', 'service_type.name') || '';
  const date = pick(p, 'date', 'startsAt', 'startAt', 'startDate', 'serviceDate', 'start', 'dateTime');
  return {
    id: pick(p, 'id', 'planId'),
    date: niceDate(date), sort: String(date || ''),
    title: pick(p, 'title', 'name', 'theme') || '',
    stName: typeof st === 'string' ? st : '',
    count: pick(p, 'songCount', 'itemsCount', 'setlistCount'),
  };
}

/** Kommende Pläne (ab heute), nach Datum sortiert. */
export async function upcomingPlans(limit = 20) {
  const rows = (await all('/plans', { from: isoDay(new Date()), limit }, limit)).map(planRow);
  rows.sort((a, b) => a.sort.localeCompare(b.sort));
  return rows;
}

export const serviceTypes = async () => listOf(await api('/service-types'));

/** Plan aus einem Chara-Link (…/plans/<id>) oder einer ID. */
export async function planFromLink(text) {
  const t = String(text || '').trim();
  const m = t.match(/plans\/([\w-]+)/) || t.match(/^([\w-]+)$/);
  if (!m) throw Object.assign(new Error('Kein Plan-Link'), { status: 404, server: 'Das sieht nicht nach einem Plan-Link aus.' });
  return planRow(objOf(await api(`/plans/${encodeURIComponent(m[1])}`)));
}

/**
 * Setlist eines Plans als fertige Übungs-Lieder. Versucht zuerst mit Akkorden (include=chart);
 * ohne Music-Stand-Freigabe (403) kommt die Setlist ohne Akkorde.
 */
export async function loadPlan(row, notation) {
  let items, noChartRight = false;
  try { items = listOf(await api(`/plans/${encodeURIComponent(row.id)}/setlist`, { include: 'chart' })); }
  catch (e) {
    if (e.status !== 403) throw e;
    items = listOf(await api(`/plans/${encodeURIComponent(row.id)}/setlist`));
    noChartRight = true;
  }
  const songs = items.filter(isSongItem).map((it) => songFromItem(it, notation));
  return {
    source: 'chara', planId: row.id,
    title: [row.stName, row.title].filter(Boolean).join(' · ') || 'Setlist',
    date: row.date || '', loaded: Date.now(), songs, noChartRight,
  };
}

/**
 * Ist dieser Plan-Eintrag ein Lied? Nur dann, wenn er auf ein Lied verweist (song / songId) oder als Lied
 * markiert ist oder Akkorde (ChordPro) enthält. Punkte wie „Begrüßung“ oder „Küche aufräumen“ fallen raus.
 */
function isSongItem(it) {
  if (!it || typeof it !== 'object') return false;
  const type = String(pick(it, 'type', 'kind', 'itemType', 'item_type', 'category') || '').toLowerCase();
  if (/song|lied/.test(type)) return true;
  const ref = it.song && typeof it.song === 'object' ? pick(it.song, 'id', 'title') : it.song;
  if (ref || pick(it, 'songId', 'song_id')) return true;
  if (type) return false; // anderer Typ (Element, Überschrift, Medien …)
  return !!findChordPro(it);
}

/** Rohantwort der Setlist (für die Fehlersuche, enthält keine Tokens). */
export async function rawSetlist(planId) {
  const path = `/plans/${encodeURIComponent(planId)}/setlist`;
  try { return await api(path, { include: 'chart' }); }
  catch (e) { if (e.status !== 403) throw e; return { hinweis: '403 mit include=chart', ohneChart: await api(path) }; }
}

// ---------- Lieder ----------

/** Lieder suchen (Titel/Autor), mit Akkorden wenn erlaubt. */
export async function searchSongs(q, notation) {
  const params = { q: (q || '').trim(), limit: 40, include: 'chart' };
  let list, noChartRight = false;
  try { list = await all('/songs', params, 40); }
  catch (e) {
    if (e.status !== 403) throw e;
    delete params.include; list = await all('/songs', params, 40); noChartRight = true;
  }
  return { songs: list.map((s) => songFromItem(s, notation)), noChartRight };
}

export async function getSong(id, notation) {
  try { return songFromItem(objOf(await api(`/songs/${encodeURIComponent(id)}`, { include: 'chart' })), notation); }
  catch (e) { if (e.status !== 403) throw e; return songFromItem(objOf(await api(`/songs/${encodeURIComponent(id)}`)), notation); }
}

/** Ein Setlist-Eintrag oder ein Lied → Übungs-Lied. */
function songFromItem(it, notation) {
  const song = it.song && typeof it.song === 'object' ? it.song : it;
  const chartObj = pick(it, 'chart', 'song.chart', 'charts.0', 'song.charts.0');
  const chordpro = typeof chartObj === 'string' ? chartObj
    : pick(chartObj || {}, 'chordpro', 'chordPro', 'content', 'text', 'body', 'source') || pick(it, 'chordpro', 'chordPro') || findChordPro(it) || '';
  const pro = parseChordPro(chordpro);
  const keyItem = pick(it, 'key', 'keyName', 'songKey');
  const chartKey = pick(chartObj || {}, 'key') || pro.key || pick(song, 'key', 'defaultKey', 'originalKey');
  const keyEn = toEnKey(keyItem || chartKey);
  const songId = pick(song, 'id') || pick(it, 'songId') || pick(it, 'id') || 'x';
  return makeSong({
    id: `chara-${songId}${keyItem ? '-' + keyEn : ''}`,
    title: pick(it, 'title', 'name') || pick(song, 'title', 'name'),
    keyEn, chartKeyEn: toEnKey(chartKey) || keyEn,
    bpm: pick(it, 'tempo', 'bpm') || pick(song, 'tempo', 'bpm') || pro.tempo,
    meter: pick(it, 'timeSignature', 'meter', 'time') || pick(song, 'timeSignature', 'meter', 'time') || pro.time,
    chart: pro.chart, notation, source: 'chara',
    extra: { chara: { songId: String(songId), author: String(pick(song, 'author', 'authors', 'artist', 'copyright') || '') } },
  });
}

// ---------- ChordPro ----------

/** Rückfall: irgendwo im Eintrag nach einem Text suchen, der wie ChordPro aussieht (Feldname egal). */
const LOOKS_PRO = /\[[A-Ha-h][#b]?[^\]\s]{0,10}\]|\{\s*(start_of_|so[cvb]\b|title|key)/;
function findChordPro(o, depth = 0) {
  if (o == null || depth > 5) return '';
  if (typeof o === 'string') return LOOKS_PRO.test(o) ? o : '';
  if (typeof o !== 'object') return '';
  for (const v of Array.isArray(o) ? o : Object.values(o)) { const f = findChordPro(v, depth + 1); if (f) return f; }
  return '';
}

const DE_HINT = /^(H|h)|^[A-Ha-h](is|es)|^(As|Es|as|es)\b/;
const isGerman = (sym) => DE_HINT.test(String(sym || '').trim());
const toEn = (sym, de) => (de ? convertSymbol(sym, 'de', 'en') : sym);
function toEnKey(k) {
  if (!k) return '';
  const s = String(k).trim().replace(/-?\s*(dur|major)$/i, '').replace(/\s*(moll|minor)$/i, 'm').trim();
  return firstKey(toEn(s, isGerman(s)));
}

const ENV = { start_of_verse: 'Verse', sov: 'Verse', start_of_chorus: 'Chorus', soc: 'Chorus', start_of_bridge: 'Bridge', sob: 'Bridge', start_of_part: '', sop: '' };
const COMMENT = /^(c|comment|ci|comment_italic|cb|comment_box|label)$/;
const KNOWN = /^\s*(verse|vers|strophe|chorus|refrain|pre[\s-]?chorus|prechorus|bridge|intro|outro|tag|ending|interlude|instrumental|turnaround|vamp|coda|zwischenspiel|ende|post[\s-]?chorus|breakdown|hook)\b/i;

/**
 * ChordPro lesen: Metadaten ({key}, {tempo}, {time}) und eine vereinfachte Akkord-Fassung in englischer
 * Schreibweise mit Teil-Überschriften, die parseChordChart versteht.
 */
export function parseChordPro(text) {
  const meta = { key: '', tempo: '', time: '' };
  const raw = String(text || '');
  const chords = [...raw.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
  const de = chords.some(isGerman);
  const lines = [];
  for (const r of raw.split(/\r?\n/)) {
    const t = r.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}$/i);
    if (m) {
      const k = m[1].toLowerCase(), v = (m[2] || '').trim();
      if (k === 'key' || k === 'k') meta.key = meta.key || v;
      else if (k === 'tempo' || k === 'bpm') meta.tempo = meta.tempo || v;
      else if (k === 'time') meta.time = meta.time || v;
      else if (k in ENV) lines.push(header(v, ENV[k]));
      else if (COMMENT.test(k) && KNOWN.test(v) && v.length <= 30) lines.push(v);
      continue;
    }
    lines.push(t.replace(/\[([^\]]+)\]/g, (_, c) => `[${toEn(c.trim(), de)}]`));
  }
  return { key: meta.key, tempo: meta.tempo, time: meta.time, chart: lines.filter(Boolean).join('\n') };
}

function header(label, base) {
  if (label && KNOWN.test(label)) return label;
  const num = (String(label).match(/\d+/) || [])[0];
  if (!base) return 'Teil' + (num ? ' ' + num : ''); // unbekannter Teil
  return num ? `${base} ${num}` : base;
}
