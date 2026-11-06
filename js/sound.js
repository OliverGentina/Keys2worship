// Klangerzeugung mit der Web Audio API: Klavier, Rhodes-ähnliches E-Piano und Metronom-Klick.
// Alles wird im Browser synthetisiert – keine Sounddateien nötig, funktioniert offline.

export class SoundEngine {
  constructor() {
    this.ac = null;
    this.out = null;
    this.volume = 0.8;
  }

  /** AudioContext erst bei einer Nutzeraktion starten (iOS verlangt das). */
  ensure() {
    if (!this.ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ac = new AC({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.ac.state === 'suspended') this.ac.resume();
    return this.ac;
  }

  get now() { return this.ac ? this.ac.currentTime : 0; }

  setVolume(v) {
    this.volume = v;
    if (this.out) this.out.master.gain.value = v;
  }

  build() {
    const ac = this.ac;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    const master = ac.createGain(); master.gain.value = this.volume;
    const dry = ac.createGain();
    const wet = ac.createGain(); wet.gain.value = 0.25;
    const conv = ac.createConvolver();
    conv.buffer = this.impulse(1.8);
    dry.connect(comp); wet.connect(conv); conv.connect(comp);
    comp.connect(master); master.connect(ac.destination);

    // Kurzes Rauschen für den Hammeranschlag des Klaviers
    const nl = Math.floor(ac.sampleRate * 0.04);
    const noise = ac.createBuffer(1, nl, ac.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;

    // Rhodes-Bus: leichte Sättigung → Tonblende → Tremolo + Stereo-Pan (wie beim Suitcase-Rhodes)
    const rIn = ac.createGain(); rIn.gain.value = 0.9;
    const shaper = ac.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let c = 0; c < 1024; c++) { const x = c / 512 - 1; curve[c] = Math.tanh(1.6 * x) / Math.tanh(1.6); }
    shaper.curve = curve;
    const tone = ac.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 5200; tone.Q.value = 0.5;
    const trem = ac.createGain();
    const lfo = ac.createOscillator(); lfo.frequency.value = 4.6;
    const lfoAmt = ac.createGain(); lfoAmt.gain.value = 0.22;
    lfo.connect(lfoAmt); lfoAmt.connect(trem.gain); lfo.start();
    const rWet = ac.createGain(); rWet.gain.value = 0.12;
    rIn.connect(shaper); shaper.connect(tone); tone.connect(trem);
    if (ac.createStereoPanner) {
      const pan = ac.createStereoPanner();
      const panAmt = ac.createGain(); panAmt.gain.value = 0.45;
      lfo.connect(panAmt); panAmt.connect(pan.pan);
      trem.connect(pan); pan.connect(dry); pan.connect(rWet);
    } else {
      trem.connect(dry); trem.connect(rWet);
    }
    rWet.connect(conv);

    // Metronom bekommt einen eigenen Weg ohne Hall
    const clickBus = ac.createGain(); clickBus.connect(master);

    this.out = { master, dry, wet, noise, rhodes: rIn, click: clickBus };
  }

  impulse(seconds) {
    const ac = this.ac;
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  /** Einen Ton spielen. kind: 'piano' | 'rhodes'; t: Startzeit (AudioContext-Zeit); hold: Haltedauer in s. */
  note(kind, midi, t, vel = 0.25, hold = 1.5) {
    if (!this.ensure()) return;
    if (t == null) t = this.ac.currentTime + 0.005;
    if (kind === 'rhodes') this.rhodes(midi, t, vel * 0.9, hold); else this.piano(midi, t, vel, hold);
  }

  /** Mehrere Töne leicht versetzt (wie beim echten Anschlag). */
  chord(kind, notes, t, vel = 0.24, hold = 2, strum = 0.012) {
    if (!this.ensure()) return;
    if (t == null) t = this.ac.currentTime + 0.01;
    notes.forEach((n, i) => this.note(kind, n, t + i * strum, vel, hold));
  }

  piano(midi, t, vel, hold) {
    const ac = this.ac, out = this.out;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const decay = Math.max(1.2, 4.2 - (midi - 48) * 0.05); // tiefe Töne klingen länger
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(Math.min(f * 12, 12000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2.5, 450), t + Math.min(decay, 2.5));
    lp.connect(out.dry); lp.connect(out.wet);
    // [Teilton, Lautstärke, Verstimmung] – leicht verstimmte Doppelsaite gibt Lebendigkeit
    const P = [[1, 1, 1], [1, 0.35, 1.0013], [2, 0.5, 1], [3, 0.28, 1], [4, 0.16, 1], [5, 0.09, 1], [6, 0.05, 1], [7, 0.03, 1]];
    for (const [h, a, det] of P) {
      const fr = f * h * det * Math.sqrt(1 + 0.00015 * h * h); // Saiten-Inharmonizität
      if (fr > 15000) continue;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = fr;
      const amp = a * vel, tc = decay / (3 + (h - 1) * 1.6);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.005);
      g.gain.setTargetAtTime(0, t + 0.005, tc);
      g.gain.setTargetAtTime(0, t + hold, 0.08);
      o.connect(g); g.connect(lp); o.start(t); o.stop(t + hold + 0.6);
    }
    const ns = ac.createBufferSource(), bp = ac.createBiquadFilter(), ng = ac.createGain();
    ns.buffer = out.noise; bp.type = 'bandpass'; bp.frequency.value = Math.min(f * 4, 6000); bp.Q.value = 1.2;
    ng.gain.setValueAtTime(vel * 0.25, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    ns.connect(bp); bp.connect(ng); ng.connect(out.dry); ns.start(t);
  }

  // FM-Synthese wie beim klassischen DX7-E-Piano: weicher Körper + "Bark" beim Anschlag + glockiger Tine-Ton.
  rhodes(midi, t, vel, hold) {
    const ac = this.ac, out = this.out;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const v = Math.min(1, vel * 3.2);
    const sustainTc = Math.max(0.9, 2.6 - (midi - 48) * 0.035);
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vel * 1.3, t + 0.004);
    env.gain.setTargetAtTime(vel * 0.55, t + 0.004, 0.18);
    env.gain.setTargetAtTime(0, t + 0.3, sustainTc);
    env.gain.setTargetAtTime(0, t + hold, 0.12);
    env.connect(out.rhodes);

    const car = ac.createOscillator(), mod = ac.createOscillator(), modG = ac.createGain();
    car.frequency.value = f; mod.frequency.value = f * 1.0008;
    modG.gain.setValueAtTime(f * (0.6 + 2.4 * v), t);
    modG.gain.setTargetAtTime(f * 0.18, t, 0.22);
    mod.connect(modG); modG.connect(car.frequency); car.connect(env);

    const tine = ac.createOscillator(), tMod = ac.createOscillator(), tModG = ac.createGain(), tG = ac.createGain();
    tine.frequency.value = f * 4; tMod.frequency.value = f * 14;
    tModG.gain.setValueAtTime(f * 3 * v, t); tModG.gain.setTargetAtTime(0, t, 0.05);
    tG.gain.setValueAtTime(0.0001, t);
    tG.gain.exponentialRampToValueAtTime(0.18 * v, t + 0.002);
    tG.gain.setTargetAtTime(0, t + 0.002, 0.07);
    tMod.connect(tModG); tModG.connect(tine.frequency); tine.connect(tG); tG.connect(env);

    const end = t + hold + 0.8;
    for (const o of [car, mod, tine, tMod]) { o.start(t); o.stop(end); }
  }

  /** Metronom-Klick. level: 2 = Takt-Eins, 1 = Nebenbetonung (6/8), 0 = normal. */
  click(t, level = 0, gain = 0.25) {
    if (!this.ensure()) return;
    const ac = this.ac;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square';
    o.frequency.value = level === 2 ? 1760 : level === 1 ? 1320 : 1100;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
    g.gain.setValueAtTime(gain * (level === 2 ? 1 : 0.7), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(lp); lp.connect(g); g.connect(this.out.click);
    o.start(t); o.stop(t + 0.06);
  }
}

/**
 * Präziser Takt: plant Klicks und Akkorde etwas im Voraus auf der Audio-Uhr
 * (setTimeout allein wäre auf dem iPad zu ungenau) und meldet jeden Schlag an die Oberfläche,
 * genau dann, wenn er erklingt.
 */
export class Transport {
  constructor(engine, { getBpm, getBeatsPerBar, onSchedule, onBeat }) {
    this.engine = engine;
    this.getBpm = getBpm;
    this.getBeatsPerBar = getBeatsPerBar;
    this.onSchedule = onSchedule; // (beat, bar, time) – hier Audio planen
    this.onBeat = onBeat;         // (beat, bar, time) – hier Oberfläche aktualisieren
    this.running = false;
    this.queue = [];
  }

  start() {
    const ac = this.engine.ensure();
    if (!ac) return;
    this.running = true;
    this.beat = 0;
    this.bar = 0;
    this.next = ac.currentTime + 0.08;
    this.queue = [];
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
    const loop = () => {
      if (!this.running) return;
      const now = this.engine.now;
      while (this.queue.length && this.queue[0].time <= now + 0.01) {
        const ev = this.queue.shift();
        this.onBeat(ev.beat, ev.bar, ev.time);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  schedule() {
    const ac = this.engine.ac;
    while (this.next < ac.currentTime + 0.12) {
      const bpb = this.getBeatsPerBar();
      this.onSchedule(this.beat, this.bar, this.next);
      this.queue.push({ beat: this.beat, bar: this.bar, time: this.next });
      this.next += 60 / this.getBpm();
      this.beat += 1;
      if (this.beat >= bpb) { this.beat = 0; this.bar += 1; }
    }
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.queue = [];
  }
}
