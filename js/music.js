// Musik-Logik: Akkorde lesen, Umkehrungen mit kurzem Weg wählen, Fingersätze bestimmen.
// Alle Töne sind MIDI-Nummern (C4 = 60).

const SPELL = {
  de: { sharp: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H'],
        flat:  ['C', 'Des', 'D', 'Es', 'E', 'F', 'Ges', 'G', 'As', 'A', 'B', 'H'] },
  en: { sharp: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
        flat:  ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] },
};
const FLAT_KEYS = [5, 10, 3, 8, 1, 6]; // F, B/Bb, Es, As, Des, Ges

function names(notation, flats) {
  return SPELL[notation === 'en' ? 'en' : 'de'][flats ? 'flat' : 'sharp'];
}

/** Soll in dieser Tonart mit b (statt #) geschrieben werden? Moll-Tonarten zählen wie ihre Dur-Parallele. */
export function prefersFlats(keySymbol, notation = 'de') {
  const ch = parseChord(keySymbol, notation);
  if (!ch) return false;
  const major = ch.pcs[1] - ch.root === 3 || ch.pcs[1] - ch.root === -9 ? (ch.root + 3) % 12 : ch.root;
  return FLAT_KEYS.includes(major);
}

export const FINGER_NAMES = { 1: 'Daumen', 2: 'Zeigefinger', 3: 'Mittelfinger', 4: 'Ringfinger', 5: 'Kleiner Finger' };

/** Name eines Tons (ohne Oktave). */
export function noteName(midi, notation = 'de', flats = false) {
  return names(notation, flats)[((midi % 12) + 12) % 12];
}

/** Name mit Oktave, z. B. "C4". */
export function noteLabel(midi, notation = 'de', flats = false) {
  return noteName(midi, notation, flats) + (Math.floor(midi / 12) - 1);
}

const LETTER_EN = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };
const LETTER_DE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 10, H: 11 };

// Grundton am Anfang eines Strings lesen: liefert { pc, len, lower } oder null.
function readRoot(str, notation) {
  const m = /^([A-Ha-h])(is|#|es|s|b)?/.exec(str);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  let acc = m[2] || '';
  // "Es"/"As" (deutsch) = Eb/Ab; "Bb" (englisch) = B-Dur-1; deutsches "B" ist schon Bb.
  if (acc === 's' && !(letter === 'E' || letter === 'A')) acc = '';
  let pc = (notation === 'en' ? LETTER_EN : LETTER_DE)[letter];
  if (acc === 'is' || acc === '#') pc += 1;
  if (acc === 'es' || acc === 's' || acc === 'b') pc -= 1;
  // In deutscher Schreibweise wäre "Bb" doppelt erniedrigt – das meint fast immer englisch Bb.
  if (notation === 'de' && letter === 'B' && acc === 'b') pc += 1;
  return { pc: (pc + 12) % 12, len: m[1].length + (acc ? m[2].length : 0), lower: m[1] !== letter };
}

/**
 * Akkordsymbol lesen, z. B. "G", "Em", "D/Fis", "C#m7", "Hm", "Asus4".
 * Rückgabe: { symbol, root, pcs:[3 Tonklassen], bass } oder null.
 * Für Anfänger wird jeder Akkord auf einen Dreiklang reduziert (7, maj7, add9 … werden ignoriert).
 */
export function parseChord(symbol, notation = 'de') {
  const s = String(symbol).trim();
  if (!s) return null;
  const [main, slash] = s.split('/');
  const r = readRoot(main, notation);
  if (!r) return null;
  let rest = main.slice(r.len);
  let iv;
  if (/^(dim|°|o(?!\w))/.test(rest)) iv = [0, 3, 6];
  else if (/^(aug|\+)/.test(rest)) iv = [0, 4, 8];
  else if (/^(maj|Maj|M(?!i))/.test(rest)) iv = [0, 4, 7];
  else if (/^(m|min|-)/.test(rest)) iv = [0, 3, 7];
  else iv = r.lower && notation === 'de' ? [0, 3, 7] : [0, 4, 7];
  if (/sus2/.test(rest)) iv = [0, 2, 7];
  else if (/sus4?/.test(rest)) iv = [0, 5, 7];
  else if (/^5$/.test(rest)) iv = [0, 7, 12];
  let bass = r.pc;
  if (slash) {
    const b = readRoot(slash, notation);
    if (b) bass = b.pc;
  }
  return { symbol: s, root: r.pc, pcs: iv.map((x) => (r.pc + x) % 12), bass };
}

/** Akkordsymbol transponieren, Zusätze (m, 7, sus4, /Bass) bleiben erhalten. */
export function transposeSymbol(symbol, semis, notation = 'de', flats = false) {
  const nm = names(notation, flats);
  return String(symbol).split('/').map((part) => {
    const r = readRoot(part, notation);
    if (!r) return part;
    let name = nm[(r.pc + semis + 120) % 12];
    if (r.lower && notation === 'de') name = name.toLowerCase();
    return name + part.slice(r.len);
  }).join('/');
}

/** Alle Lagen (Grundstellung + Umkehrungen) eines Dreiklangs im Bereich der rechten Hand. */
export function candidateVoicings(pcs, lowMin = 53, lowMax = 65, topMax = 76) {
  const out = [];
  const uniq = [...new Set(pcs)];
  const order0 = pcs.length === 3 && pcs[2] === pcs[0] ? [pcs[0], pcs[1], pcs[0]] : pcs;
  for (let k = 0; k < 3; k++) {
    const order = order0.slice(k).concat(order0.slice(0, k));
    for (let low = lowMin; low <= lowMax; low++) {
      if (low % 12 !== order[0]) continue;
      const notes = [low];
      for (let i = 1; i < 3; i++) {
        let n = notes[i - 1] + 1;
        while (n % 12 !== order[i]) n++;
        notes.push(n);
      }
      if (notes[2] <= topMax && notes[2] - notes[0] <= 12) out.push({ notes, inversion: k });
    }
  }
  if (uniq.length < 3) return out.filter((v, i, a) => a.findIndex((w) => w.notes.join() === v.notes.join()) === i);
  return out;
}

const CENTER = 62; // um D4 herum liegt die Hand bequem vor dem Körper

function cost(prev, notes) {
  const mean = (notes[0] + notes[1] + notes[2]) / 3;
  const drift = Math.abs(mean - CENTER) * 0.25; // verhindert, dass die Hand immer weiter wandert
  if (!prev) return Math.abs(mean - CENTER);
  let move = 0;
  for (let i = 0; i < 3; i++) move += Math.abs(notes[i] - prev[i]);
  return move + drift;
}

/** Fingersatz für drei Töne der rechten Hand (1 = Daumen … 5 = kleiner Finger). */
export function fingering(notes) {
  const low = notes[1] - notes[0];
  const high = notes[2] - notes[1];
  if (high <= 2) return [1, 4, 5];          // z. B. Sus-Akkorde mit enger oberer Lücke
  if (low <= 2) return [1, 2, 5];
  if (high > low && high >= 5) return [1, 2, 5]; // große Lücke oben → Finger 3/4 bleibt frei
  return [1, 3, 5];                          // Grundstellung oder große Lücke unten
}

const INV_NAMES = ['Grundstellung', '1. Umkehrung', '2. Umkehrung'];

/**
 * Für eine Folge von Akkordsymbolen die Griffe mit dem kürzesten Weg berechnen.
 * Rückgabe pro Schritt: { symbol, notes:[3 MIDI], fingers:[3], bass:MIDI, inversion, inversionName, tones }
 */
export function planProgression(symbols, notation = 'de', flats = false) {
  let prev = null;
  let prevFingers = null;
  return symbols.map((sym) => {
    const ch = parseChord(sym, notation);
    if (!ch) return { symbol: sym, invalid: true };
    const cands = candidateVoicings(ch.pcs);
    let best = cands[0];
    let bestCost = Infinity;
    for (const c of cands) {
      const k = cost(prev, c.notes);
      if (k < bestCost - 1e-9) { best = c; bestCost = k; }
    }
    const fingers = fingering(best.notes);
    // Liegt der mittlere Ton schon, bleibt auch derselbe Finger drauf (2 oder 3) – kein unnötiger Fingerwechsel.
    if (prev && prevFingers && best.notes[1] === prev[1] && [2, 3].includes(prevFingers[1])) fingers[1] = prevFingers[1];
    prev = best.notes;
    prevFingers = fingers;
    const bass = 36 + ch.bass; // linke Hand: Grundton (bzw. Basston) in der großen Oktave, C2–H2
    return {
      symbol: sym,
      notes: best.notes,
      fingers,
      bass,
      inversion: best.inversion,
      inversionName: INV_NAMES[best.inversion],
      tones: best.notes.map((n) => noteName(n, notation, flats)).join(' · '),
    };
  });
}

/** Bewegungen zwischen zwei Griffen (Stimme für Stimme, von tief nach hoch). */
export function movesBetween(a, b) {
  const res = [];
  for (let i = 0; i < 3; i++) {
    res.push({
      from: a.notes[i], to: b.notes[i],
      fingerFrom: a.fingers[i], finger: b.fingers[i],
      delta: b.notes[i] - a.notes[i],
    });
  }
  return res;
}

/** Text der Akkordfolge in Takte zerlegen: "G D Em C", "G*2 D", Taktstriche | werden ignoriert. */
export function splitChords(text) {
  const out = [];
  String(text || '').split(/[\s|,]+/).filter(Boolean).forEach((tok) => {
    const m = /^(.+?)\*(\d+)$/.exec(tok);
    if (m) { for (let i = 0; i < Math.min(16, +m[2]); i++) out.push(m[1]); } else out.push(tok);
  });
  return out;
}

/** Tonart-Hinweis für Anfänger. */
export function keyIsEasy(symbol, notation = 'de') {
  const ch = parseChord(symbol, notation);
  return ch ? [0, 2, 7, 9, 4].includes(ch.root) : false;
}
