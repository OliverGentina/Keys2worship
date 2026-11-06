// Lieder und Einstellungen lokal im Browser speichern (localStorage).
// Später: Import aus Chara Technics und Planning Center.

const SONGS_KEY = 'keys2worship:songs';
const SETTINGS_KEY = 'keys2worship:settings';
const LAST_KEY = 'keys2worship:last';

export const DEFAULT_SETTINGS = {
  notation: 'de',     // 'de' (H, Fis …) oder 'en' (B, F# …)
  hand: 'rechts',     // Übungsansicht: 'rechts' | 'links' | 'beide'
  zoom: { rechts: 1, links: 1, beide: 0 }, // Anteil der echten Tastengröße (1 = 100 %), 0 = ganze Klaviatur
  pxPerMm: null,      // eigene Kalibrierung (null = Schätzung nach Gerät)
  glideBeats: 1,      // wie viele Schläge vor dem Wechsel die Finger losgleiten
  sound: 'piano',     // 'piano' | 'rhodes' | 'off'
  volume: 0.8,
};

const DEMO_SONGS = [
  {
    id: 'demo-g',
    title: 'Übungslied in G',
    key: 'G', bpm: 72, meter: '4/4',
    sections: [
      { name: 'Strophe', chords: 'G D Em C' },
      { name: 'Refrain', chords: 'C G D/Fis Em' },
      { name: 'Bridge', chords: 'Em C G D' },
    ],
  },
  {
    id: 'demo-c',
    title: 'Vier Akkorde in C',
    key: 'C', bpm: 68, meter: '4/4',
    sections: [{ name: 'Strophe', chords: 'C G Am F' }],
  },
];

function read(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Speicher voll oder privat */ }
}

export function loadSongs() {
  const s = read(SONGS_KEY, null);
  if (!Array.isArray(s) || !s.length) { write(SONGS_KEY, DEMO_SONGS); return structuredClone(DEMO_SONGS); }
  return s;
}
export function saveSongs(songs) { write(SONGS_KEY, songs); }
export function getSong(id) { return loadSongs().find((s) => s.id === id) || null; }
export function upsertSong(song) {
  const songs = loadSongs();
  const i = songs.findIndex((s) => s.id === song.id);
  song.updated = Date.now();
  if (i >= 0) songs[i] = song; else songs.unshift(song);
  saveSongs(songs);
}
export function deleteSong(id) { saveSongs(loadSongs().filter((s) => s.id !== id)); }
export function newSong() {
  return { id: 's' + Date.now().toString(36), title: '', key: 'G', bpm: 72, meter: '4/4', sections: [{ name: 'Strophe', chords: '' }] };
}

export function loadSettings() { return Object.assign({}, DEFAULT_SETTINGS, read(SETTINGS_KEY, {})); }
export function saveSettings(s) { write(SETTINGS_KEY, s); }

export function getLast() { return read(LAST_KEY, null); }
export function setLast(id) { write(LAST_KEY, id); }
