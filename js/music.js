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
 * Akkordsymbol lesen, z. B. "G", "Em", "D/Fis", "C#m7", "Hm", "Asus4", "G2", "Gsus7", "Amaj7", "Dadd9".
 * Rückgabe: { symbol, root, pcs:[3–4 Tonklassen, Grundton zuerst], bass, triad } oder null.
 * Die rechte Hand spielt höchstens vier Töne: Bei 9er-Akkorden fällt die Quinte weg.
 * Worship-Schreibweise: „G2“ = G ohne Terz mit None (wie sus2), „Gsus7“ = G7sus4.
 */
export function parseChord(symbol, notation = 'de') {
  const s = String(symbol).trim();
  if (!s) return null;
  const [main, slash] = s.split('/');
  const r = readRoot(main, notation);
  if (!r) return null;
  const rest = main.slice(r.len).replace(/[()]/g, '');
  const iv = chordIntervals(rest, r.lower && notation === 'de');
  if (!iv) return null;
  let bass = r.pc;
  if (slash) {
    const b = readRoot(slash, notation);
    if (b) bass = b.pc;
  }
  return { symbol: s, root: r.pc, pcs: iv.map((x) => (r.pc + x) % 12), bass, triad: iv.length <= 3 };
}

/** Intervalle (Halbtöne über dem Grundton) aus dem Akkordzusatz, z. B. "m7" → [0, 3, 7, 10]. */
function chordIntervals(rest, lowerMinor) {
  let t = rest.replace(/\s/g, '');
  // Dreiklang
  let third = 4, fifth = 7;
  let m;
  if ((m = /^(dim7|°7|o7)/.exec(t))) return [0, 3, 6, 9];
  if ((m = /^(m7b5|m7-5|ø7?|min7b5)/.exec(t))) return [0, 3, 6, 10];
  if ((m = /^(dim|°|o(?![a-z]))/.exec(t))) { third = 3; fifth = 6; t = t.slice(m[0].length); }
  else if ((m = /^(aug|\+)/.exec(t))) { fifth = 8; t = t.slice(m[0].length); }
  else if ((m = /^(maj|Maj|MAJ|M(?!i)|Δ|j)/.exec(t))) { t = 'maj' + t.slice(m[0].length); }
  else if ((m = /^(min|mi|m|-)/.exec(t))) { third = 3; t = t.slice(m[0].length); }
  else if (lowerMinor) third = 3;
  if (/^5$/.test(t)) return [0, 7, 12];

  const ext = [];
  let dropFifth = false;
  // Septime
  if (/^maj(7|9|11|13)/.test(t)) { ext.push(11); if (/^maj9/.test(t)) { ext.push(2); dropFifth = true; } }
  else if (/^maj$/.test(t)) { /* „Amaj“ = A-Dur */ }
  else if (/(^|[^d])7/.test(t.replace(/add\d+/, '')) || /sus7/.test(t)) ext.push(third === 3 && fifth === 6 ? 9 : 10);
  else if (/^(9|11|13)/.test(t)) ext.push(10);
  // 9 / 11 / 13 als Erweiterung
  if (/^9|^m?9|[^d]9$/.test(t.replace(/add\d+/, '')) && !ext.includes(2)) {
    if (/^(9|maj9)/.test(t) || /^9/.test(t)) { ext.push(2); dropFifth = true; }
  }
  if (/^11/.test(t)) { third = 5; } // 11er = 7sus4-Klang
  if (/^13/.test(t)) { ext.push(9); dropFifth = true; }
  // add / 2 / 6
  if (/add(9|2)/.test(t)) ext.push(2);
  if (/add4|add11/.test(t)) ext.push(5);
  if (/^6|[^\d]6/.test(t.replace(/\/.*/, '')) && !/add/.test(t)) ext.push(9);
  // sus
  if (/sus2/.test(t)) third = 2;
  else if (/sus/.test(t)) third = 5;
  else if (/^2$/.test(t)) { if (third === 3) ext.push(2); else third = 2; } // Worship: „G2“ = sus2, „Em2“ = Em add9
  let iv = [0, third, fifth, ...ext];
  if (dropFifth) iv = iv.filter((x) => x !== 7);
  iv = [...new Set(iv.map((x) => ((x % 12) + 12) % 12))];
  if (iv.length > 4) iv = iv.filter((x) => x !== 7).slice(0, 4);
  return iv;
}

/** Akkordsymbol transponieren, Zusätze (m, 7, sus4, /Bass) bleiben erhalten. */
export function transposeSymbol(symbol, semis, notation = 'de', flats = false, outNotation = notation) {
  const nm = names(outNotation, flats);
  return String(symbol).split('/').map((part) => {
    const r = readRoot(part, notation);
    if (!r) return part;
    let name = nm[(r.pc + semis + 120) % 12];
    if (r.lower && notation === 'de' && outNotation === 'de') name = name.toLowerCase();
    return name + part.slice(r.len);
  }).join('/');
}

/** Alle Lagen (Grundstellung + Umkehrungen) eines Drei- oder Vierklangs im Bereich der rechten Hand. */
export function candidateVoicings(pcs, lowMin = 53, lowMax = 65, topMax = 77) {
  const out = [];
  const n = pcs.length;
  const order0 = n === 3 && pcs[2] === pcs[0] ? [pcs[0], pcs[1], pcs[0]] : sortFromRoot(pcs);
  for (let k = 0; k < n; k++) {
    const order = order0.slice(k).concat(order0.slice(0, k));
    for (let low = lowMin; low <= lowMax; low++) {
      if (low % 12 !== order[0]) continue;
      const notes = [low];
      for (let i = 1; i < n; i++) {
        let x = notes[i - 1] + 1;
        while (x % 12 !== order[i]) x++;
        notes.push(x);
      }
      if (notes[n - 1] <= topMax && notes[n - 1] - notes[0] <= 12) out.push({ notes, inversion: k });
    }
  }
  return out.filter((v, i, a) => a.findIndex((w) => w.notes.join() === v.notes.join()) === i);
}

// Akkordtöne vom Grundton aus aufsteigend ordnen (C E G H, nicht C G E H)
function sortFromRoot(pcs) {
  const r = pcs[0];
  return [...pcs].sort((a, b) => ((a - r + 12) % 12) - ((b - r + 12) % 12));
}

const CENTER = 62; // um D4 herum liegt die Hand bequem vor dem Körper

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function cost(prev, notes) {
  const mean = avg(notes);
  const drift = Math.abs(mean - CENTER) * 0.25; // verhindert, dass die Hand immer weiter wandert
  if (!prev) return Math.abs(mean - CENTER);
  return pairUp(prev, notes).reduce((sum, p) => sum + (p.to == null || p.from == null ? 1.5 : Math.abs(p.to - p.from)), 0) + drift;
}

/**
 * Stimmen zweier Griffe einander zuordnen (beide aufsteigend). Gleiche Anzahl: Stimme für Stimme.
 * Sonst die Zuordnung mit dem kürzesten Gesamtweg, ohne dass sich Finger kreuzen.
 * Ergebnis: [{ i, j, from, to }] – i/j sind Indizes in a/b, fehlt einer, ist er null.
 */
export function pairUp(a, b) {
  if (a.length === b.length) return a.map((x, i) => ({ i, j: i, from: x, to: b[i] }));
  const [small, big, flip] = a.length < b.length ? [a, b, false] : [b, a, true];
  // Welche Stimmen des größeren Griffs bekommen keinen Partner? (höchstens eine bei 3↔4)
  let best = null;
  const choose = (start, left, picked) => {
    if (left === 0) {
      const used = big.filter((_, k) => !picked.includes(k));
      const d = used.reduce((s, x, k) => s + Math.abs(x - small[k]), 0);
      if (!best || d < best.d) best = { d, skip: picked.slice() };
      return;
    }
    for (let k = start; k < big.length; k++) choose(k + 1, left - 1, picked.concat(k));
  };
  choose(0, big.length - small.length, []);
  const res = [];
  let k = 0;
  big.forEach((x, bi) => {
    if (best.skip.includes(bi)) { res.push(flip ? { i: bi, j: null, from: x, to: null } : { i: null, j: bi, from: null, to: x }); return; }
    const si = k++;
    res.push(flip ? { i: bi, j: si, from: x, to: small[si] } : { i: si, j: bi, from: small[si], to: x });
  });
  return res;
}

/** Fingersatz für drei oder vier Töne der rechten Hand (1 = Daumen … 5 = kleiner Finger). */
export function fingering(notes) {
  if (notes.length === 4) return fingering4(notes);
  const low = notes[1] - notes[0];
  const high = notes[2] - notes[1];
  if (high <= 2) return [1, 4, 5];          // z. B. Sus-Akkorde mit enger oberer Lücke
  if (low <= 2) return [1, 2, 5];
  if (high > low && high >= 5) return [1, 2, 5]; // große Lücke oben → Finger 3/4 bleibt frei
  return [1, 3, 5];                          // Grundstellung oder große Lücke unten
}

// Bequemer Abstand (Halbtöne) zwischen zwei benachbarten Fingern der rechten Hand
const REACH = { 1: 2.5, 2: 1.5, 3: 1.5, 4: 1.5 };
const reach = (f1, f2) => { let r = 0; for (let f = f1; f < f2; f++) r += REACH[f]; return r; };

/** Vier Töne: Daumen und kleiner Finger außen, die zwei Finger dazwischen nach den Lücken wählen. */
function fingering4(notes, prevNotes = null, prevFingers = null) {
  let best = null;
  for (const mid of [[2, 3], [2, 4], [3, 4]]) {
    const f = [1, ...mid, 5];
    let c = 0;
    for (let i = 0; i < 3; i++) c += Math.abs((notes[i + 1] - notes[i]) - reach(f[i], f[i + 1]));
    // Liegt ein Ton schon unter einem Finger, soll derselbe Finger drauf bleiben
    if (prevNotes) notes.forEach((n, i) => { const k = prevNotes.indexOf(n); if (k >= 0 && prevFingers[k] !== f[i]) c += 2.5; });
    if (!best || c < best.c - 1e-9) best = { c, f };
  }
  return best.f;
}

const INV_NAMES = ['Grundstellung', '1. Umkehrung', '2. Umkehrung', '3. Umkehrung'];

/**
 * Für eine Folge von Akkordsymbolen die Griffe mit dem kürzesten Weg berechnen.
 * Rückgabe pro Schritt: { symbol, notes:[3–4 MIDI], fingers:[3–4], bass:MIDI, inversion, inversionName, tones }
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
    const fingers = best.notes.length === 4 && prev ? fingering4(best.notes, prev, prevFingers) : fingering(best.notes);
    // Liegt der mittlere Ton schon, bleibt auch derselbe Finger drauf (2 oder 3) – kein unnötiger Fingerwechsel.
    if (prev && prevFingers && prev.length === 3 && best.notes.length === 3 && best.notes[1] === prev[1] && [2, 3].includes(prevFingers[1])) fingers[1] = prevFingers[1];
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

/**
 * Bewegungen zwischen zwei Griffen. Zuerst ein Eintrag pro Finger des alten Griffs (in Reihenfolge),
 * dann Finger, die neu dazukommen. `lift`: Finger hebt ab (neuer Griff hat weniger Töne);
 * `add`: Finger kommt dazu (startet beim nächstgelegenen alten Ton).
 */
export function movesBetween(a, b) {
  const pairs = pairUp(a.notes, b.notes);
  const res = [];
  for (const p of pairs.filter((x) => x.i != null).sort((x, y) => x.i - y.i)) {
    res.push(p.j == null
      ? { from: p.from, to: p.from, fingerFrom: a.fingers[p.i], finger: a.fingers[p.i], delta: 0, lift: true }
      : { from: p.from, to: p.to, fingerFrom: a.fingers[p.i], finger: b.fingers[p.j], delta: p.to - p.from });
  }
  for (const p of pairs.filter((x) => x.i == null)) {
    const near = a.notes.reduce((n, x) => (Math.abs(x - p.to) < Math.abs(n - p.to) ? x : n), a.notes[0]);
    res.push({ from: near, to: p.to, fingerFrom: null, finger: b.fingers[p.j], delta: p.to - near, add: true });
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

/** Akkordsymbol aus einer Schreibweise in die andere bringen (z. B. Planning Center „Bm“ → deutsch „Hm“). */
export function convertSymbol(symbol, from, to, flats = false, semis = 0) {
  return transposeSymbol(symbol, semis, from, flats, to);
}
