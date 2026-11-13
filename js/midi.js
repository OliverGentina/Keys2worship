// MIDI-Keyboard (z. B. Roland-Digitalpiano per USB): gedrückte Tasten live lesen.
// Safari auf iPad/iPhone kann kein Web MIDI – dafür die App im „MIDIWeb Browser“ öffnen.
// Am Mac/PC funktioniert es in Chrome und Edge direkt.

export class MidiInput {
  constructor() {
    this.held = new Set();      // gerade gedrückte Tasten (MIDI-Nummern)
    this.devices = [];
    this.listeners = new Set();
    this.access = null;
    this.state = 'idle';        // idle | unsupported | denied | ready
    this.sustain = false;
  }

  get supported() { return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess; }
  get connected() { return this.devices.length > 0; }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  // Kopie der Liste: Ein Zuhörer darf sich währenddessen ab- oder neu anmelden, ohne eine Endlosschleife
  emit(ev) { for (const fn of [...this.listeners]) { try { fn(ev, this); } catch (e) { console.error(e); } } }

  async start() {
    if (!this.supported) { this.state = 'unsupported'; this.emit({ type: 'state' }); return false; }
    if (this.access) return true;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.state = 'denied'; this.emit({ type: 'state' }); return false;
    }
    this.state = 'ready';
    this.access.onstatechange = () => this.bind();
    this.bind();
    return true;
  }

  bind() {
    if (!this.access) return;
    const ins = [];
    const inputs = this.access.inputs;
    const each = (fn) => (inputs.forEach ? inputs.forEach(fn) : [...inputs.values()].forEach(fn));
    each((inp) => {
      if (inp.state === 'disconnected') return;
      ins.push(inp.name || 'MIDI-Gerät');
      inp.onmidimessage = (e) => this.message(e.data);
    });
    const changed = ins.join('|') !== this.devices.join('|');
    this.devices = ins;
    if (!ins.length) this.held.clear();
    if (changed) this.emit({ type: 'devices' });
  }

  message(data) {
    if (!data || data.length < 2) return;
    const cmd = data[0] & 0xf0, note = data[1], vel = data[2] || 0;
    if (cmd === 0x90 && vel > 0) { this.held.add(note); this.emit({ type: 'on', note, vel }); }
    else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) { this.held.delete(note); this.emit({ type: 'off', note }); }
    else if (cmd === 0xb0 && note === 123) { this.held.clear(); this.emit({ type: 'off' }); } // All Notes Off
  }
}

/** Sind alle Töne des Akkords (als Tonklassen, Oktave egal) gedrückt? Liefert auch falsche Töne. */
export function checkChord(held, target) {
  const need = new Set(target.map((n) => ((n % 12) + 12) % 12));
  const have = new Set([...held].map((n) => n % 12));
  const missing = [...need].filter((pc) => !have.has(pc));
  const wrong = [...held].filter((n) => !need.has(n % 12));
  return { ok: missing.length === 0 && wrong.length === 0 && held.size > 0, missing, wrong, any: held.size > 0 };
}
