/* MÚSICA: synthwave cyberpunk 100% procedural.
   Sin assets: osciladores, ruido y filtros sobre el mismo AudioContext del juego.
   Secuenciador con lookahead para que no se desmonte cuando baja el framerate. */

const NOTE = (semi, base = 55) => base * Math.pow(2, semi / 12);

export class Music {
  constructor(audio) {
    this.a = audio;
    this.playing = false;
    this.step = 0;
    this.next = 0;
    this.bpm = 128;
    this.intensity = 1;
    this.out = null;
    this.delay = null;
    this.noiseBuf = null;
    this.stepDur = 60 / this.bpm / 4; // semicorchea
  }

  _ctx() { return this.a && this.a.ctx; }

  _noise() {
    const ctx = this._ctx();
    if (!this.noiseBuf) {
      const n = ctx.sampleRate * 1.0;
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    return this.noiseBuf;
  }

  start() {
    const ctx = this._ctx();
    if (!ctx || this.playing) return;
    this._build();
    this.step = 0;
    this.next = ctx.currentTime + 0.12;
    this.playing = true;
    this.out.gain.cancelScheduledValues(ctx.currentTime);
    this.out.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.out.gain.setTargetAtTime(0.5, ctx.currentTime, 1.4);
  }

  stop() {
    const ctx = this._ctx();
    if (!ctx || !this.playing) return;
    this.playing = false;
    this.out.gain.cancelScheduledValues(ctx.currentTime);
    this.out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
  }

  _build() {
    const ctx = this._ctx();
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    out.connect(comp);
    comp.connect(this.a.master);
    this.out = out;

    // eco para arpegio
    const d = ctx.createDelay(1.5);
    d.delayTime.value = this.stepDur * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const wet = ctx.createGain(); wet.gain.value = 0.42;
    d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(out);
    this.delay = d;

    // reverb corta por convolución improvisada (delay múltiple)
    const rv = ctx.createDelay(0.5);
    rv.delayTime.value = 0.07;
    const rvf = ctx.createGain(); rvf.gain.value = 0.22;
    rv.connect(rvf); rvf.connect(rv); rvf.connect(out);
    this.verb = rv;
  }

  setIntensity(v) { this.intensity = Math.max(0, Math.min(2, v)); }

  update() {
    const ctx = this._ctx();
    if (!ctx || !this.playing) return;
    const horizon = ctx.currentTime + 0.35;
    let guard = 0;
    while (this.next < horizon && guard++ < 64) {
      this._play(this.step, this.next);
      this.next += this.stepDur;
      this.step = (this.step + 1) % 32;
    }
  }

  _play(i, t) {
    const s = i % 16;
    const I = this.intensity;

    // --- batería
    if (s % 4 === 0) this._kick(t);
    if (s === 4 || s === 12) this._snare(t, s === 12 ? 0.9 : 0.7);
    if (I > 1 && (s === 2 || s === 10)) this._snare(t, 0.35);
    if (s % 2 === 1) this._hat(t, I > 1 ? 0.16 : 0.1);

    // --- bajo (A menor)
    const bass = [0, 0, 12, 0, 0, 0, 7, 0, 0, 0, 12, 0, 3, 0, 7, 10];
    if (s % 2 === 0) this._bass(t, NOTE(bass[s]), I > 1 ? 0.36 : 0.28);

    // --- arpegio
    const arp = [0, 7, 12, 15, 3, 10, 15, 19, 5, 12, 17, 20, 3, 10, 15, 12];
    this._arp(t, NOTE(arp[s], 220), 0.09 + 0.02 * I);

    // --- pad cada dos compases
    if (i % 32 === 0) this._pad(t, [0, 3, 7, 10]);

    // --- stabs en intensidad alta
    if (I > 1 && (s === 0 || s === 6)) this._stab(t, NOTE(12, 110));
  }

  _kick(t) {
    const ctx = this._ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(148, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.3);
    o.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + 0.32);
  }

  _snare(t, v) {
    const ctx = this._ctx();
    const src = ctx.createBufferSource();
    src.buffer = this._noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.34 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.17);
    src.connect(bp); bp.connect(g); g.connect(this.out);
    src.start(t); src.stop(t + 0.2);
  }

  _hat(t, v) {
    const ctx = this._ctx();
    const src = ctx.createBufferSource();
    src.buffer = this._noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.13 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.05);
    src.connect(hp); hp.connect(g); g.connect(this.out);
    src.start(t); src.stop(t + 0.07);
  }

  _bass(t, f, v) {
    const ctx = this._ctx();
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    o2.type = 'sine'; o2.frequency.value = f / 2;
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(720, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.22);
    lp.Q.value = 6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.24);
    o.connect(lp); o2.connect(lp);
    lp.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + 0.26);
    o2.start(t); o2.stop(t + 0.26);
  }

  _arp(t, f, v) {
    const ctx = this._ctx();
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'square'; o.frequency.value = f;
    lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.13);
    o.connect(lp); lp.connect(g); g.connect(this.out);
    g.connect(this.delay);
    o.start(t); o.stop(t + 0.15);
  }

  _pad(t, semis) {
    const ctx = this._ctx();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 1.1);
    g.gain.linearRampToValueAtTime(0.0001, t + 3.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 780; lp.Q.value = 0.7;
    lp.connect(g); g.connect(this.out); g.connect(this.verb);
    for (const s of semis) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(s, 110);
        o.detune.value = det;
        o.connect(lp);
        o.start(t); o.stop(t + 3.5);
      }
    }
  }

  _stab(t, f) {
    const ctx = this._ctx();
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.25);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.28);
    o.connect(lp); lp.connect(g); g.connect(this.out); g.connect(this.verb);
    o.start(t); o.stop(t + 0.3);
  }
}
