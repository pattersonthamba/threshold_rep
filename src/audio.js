// Every sound is synthesised with WebAudio: no audio files to download.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.startAmbience();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  startAmbience() {
    const c = this.ctx;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = c.createGain();
    g.gain.value = 0.035;
    lp.connect(g).connect(this.master);
    for (const f of [55, 55.4, 82.5]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
  }

  tone({ type = 'sine', f0, f1 = f0, dur = 0.2, gain = 0.25, delay = 0 }) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.2, gain = 0.2, freq = 1200, q = 1, type = 'bandpass' }) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  play(e) {
    switch (e.type) {
      case 'shoot':
        this.tone({ type: 'square', f0: e.i ? 760 : 520, f1: e.i ? 380 : 260, dur: 0.1, gain: 0.08 });
        this.noise({ dur: 0.08, gain: 0.08, freq: 3000 });
        break;
      case 'place':
        this.tone({ f0: e.i ? 420 : 300, f1: e.i ? 840 : 600, dur: 0.22, gain: 0.18 });
        break;
      case 'reject':
        this.tone({ type: 'sawtooth', f0: 180, f1: 70, dur: 0.18, gain: 0.08 });
        break;
      case 'teleport':
        this.tone({ f0: 900, f1: 160, dur: 0.25, gain: 0.1 });
        break;
      case 'portalsCleared':
        this.noise({ dur: 0.3, gain: 0.15, freq: 4200, q: 2 });
        break;
      case 'grab':
        this.tone({ type: 'triangle', f0: 330, f1: 500, dur: 0.12, gain: 0.12 });
        break;
      case 'drop':
        this.tone({ type: 'triangle', f0: 400, f1: 250, dur: 0.12, gain: 0.1 });
        break;
      case 'dissolve':
        this.noise({ dur: 0.5, gain: 0.2, freq: 2500, q: 4 });
        this.tone({ type: 'sawtooth', f0: 600, f1: 90, dur: 0.5, gain: 0.08 });
        break;
      case 'button':
        this.tone({ type: 'triangle', f0: e.on ? 440 : 660, f1: e.on ? 660 : 440, dur: 0.15, gain: 0.16 });
        break;
      case 'door':
        this.noise({ dur: 0.6, gain: 0.25, freq: 300, type: 'lowpass' });
        this.tone({ f0: 90, f1: e.open ? 140 : 70, dur: 0.6, gain: 0.12 });
        break;
      case 'launch':
        this.tone({ f0: 120, f1: 700, dur: 0.35, gain: 0.25 });
        this.noise({ dur: 0.3, gain: 0.15, freq: 800 });
        break;
      case 'death':
        this.tone({ type: 'sawtooth', f0: 300, f1: 40, dur: 0.9, gain: 0.2 });
        break;
      case 'complete':
        [523, 659, 784, 1047].forEach((f, k) => this.tone({ type: 'triangle', f0: f, dur: 0.35, gain: 0.14, delay: k * 0.09 }));
        break;
      case 'jump':
        this.tone({ f0: 200, f1: 260, dur: 0.06, gain: 0.04 });
        break;
    }
  }
}
