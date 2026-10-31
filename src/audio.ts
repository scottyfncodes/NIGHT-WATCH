import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Fully procedural audio. Every sound is synthesized into an
// AudioBuffer at startup — no audio files to download.
// ─────────────────────────────────────────────────────────────

const SR = 22050;
type Synth = (t: number, i: number, n: number) => number;

class Biquad {
  b0 = 0; b1 = 0; b2 = 0; a1 = 0; a2 = 0;
  x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  constructor(type: 'lp' | 'hp' | 'bp', freq: number, q = 0.707) {
    this.set(type, freq, q);
  }
  set(type: 'lp' | 'hp' | 'bp', freq: number, q = 0.707) {
    const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
    const cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0; this.a2 = (1 - al) / a0;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const noise = () => Math.random() * 2 - 1;
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));
const TAU = Math.PI * 2;

export type SoundName =
  | 'shot' | 'pump' | 'dry' | 'hopper' | 'reload' | 'splat' | 'hitfur' | 'yelp' | 'yelp2'
  | 'chitter' | 'chitter2' | 'chitter3' | 'growl' | 'roar' | 'can' | 'scratch' | 'crinkle'
  | 'rustle' | 'crack' | 'step' | 'owl' | 'zipper' | 'lid' | 'thunk' | 'swish' | 'heart'
  | 'clang' | 'sting' | 'bossSting' | 'sunrise' | 'bird' | 'beep' | 'snore' | 'click'
  | 'buy' | 'flash' | 'tear' | 'tape' | 'drop' | 'trap' | 'thump' | 'chime' | 'lose' | 'eat';

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  amb!: GainNode;
  radioBus!: GainNode;
  buffers = new Map<string, AudioBuffer>();
  private loops: { src: AudioBufferSourceNode; gain: GainNode; name: string }[] = [];
  private cricketGain!: GainNode;
  private cicadaGain!: GainNode;
  private windGain!: GainNode;
  private droneGain!: GainNode;
  private radioGain!: GainNode;
  private nextOwl = 12;
  private nextCrack = 6;
  private nextSnore = 8;
  private nextBird = 0;
  ready = false;
  volume = 0.85;
  ambience = 0.8;
  radioOn = false;
  dayMix = 0;
  camper = new THREE.Vector3(-7.5, 1.2, 4.5);

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.amb = this.ctx.createGain();
      this.amb.gain.value = this.ambience;
      this.amb.connect(this.master);
      this.radioBus = this.ctx.createGain();
      this.radioBus.connect(this.master);
      this.build();
      this.startLoops();
      this.ready = true;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // iOS: play a silent buffer inside the gesture to fully unlock
    const b = this.ctx.createBuffer(1, 1, SR);
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.master);
    s.start();
  }

  setVolume(v: number, a: number) {
    this.volume = v;
    this.ambience = a;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    this.amb.gain.setTargetAtTime(a, this.ctx.currentTime, 0.05);
  }

  suspend(paused: boolean) {
    if (!this.ctx) return;
    if (paused) this.sfx.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.05);
    else this.sfx.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
  }

  private mk(name: string, dur: number, fn: Synth, norm = 0.9) {
    const n = Math.floor(dur * SR);
    const buf = this.ctx!.createBuffer(1, n, SR);
    const d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = fn(i / SR, i, n);
      d[i] = v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    if (peak > 0) {
      const k = norm / peak;
      for (let i = 0; i < n; i++) d[i] *= k;
    }
    this.buffers.set(name, buf);
  }

  private build() {
    // ── Marker ──
    {
      const lp = new Biquad('lp', 2400);
      this.mk('shot', 0.38, (t) => {
        lp.set('lp', 300 + 3200 * Math.exp(-t * 30));
        const body = lp.run(noise()) * env(t, 0.002, 0.05);
        const thump = Math.sin(TAU * (45 + 90 * Math.exp(-t * 40)) * t) * env(t, 0.001, 0.06) * 1.2;
        const hiss = noise() * 0.12 * env(t, 0.01, 0.12);
        return body + thump + hiss;
      });
    }
    const click = (t: number, at: number, f: number, dec = 0.012) =>
      t < at ? 0 : (noise() * 0.6 + Math.sin(TAU * f * (t - at))) * Math.exp(-(t - at) / dec);
    this.mk('pump', 0.34, (t) => click(t, 0.0, 2300) * 0.8 + click(t, 0.16, 1700, 0.02));
    this.mk('dry', 0.12, (t) => click(t, 0.0, 3100, 0.008));
    this.mk('flash', 0.08, (t) => click(t, 0.0, 4200, 0.005));
    {
      const ticks: number[] = [];
      for (let k = 0; k < 14; k++) ticks.push(Math.random() * 0.24);
      this.mk('hopper', 0.28, (t) => {
        let v = 0;
        for (const a of ticks) v += click(t, a, 3500 + a * 3000, 0.004) * 0.5;
        return v;
      });
    }
    {
      const ticks: number[] = [];
      for (let k = 0; k < 60; k++) ticks.push(0.05 + Math.pow(Math.random(), 0.7) * 0.7);
      this.mk('reload', 1.0, (t) => {
        let v = 0;
        for (const a of ticks) v += click(t, a, 2600 + Math.random() * 400, 0.005) * 0.35;
        v += click(t, 0.86, 1500, 0.02) * 1.4;
        return v;
      });
    }
    // ── Impacts ──
    {
      const lp = new Biquad('lp', 1800);
      this.mk('splat', 0.28, (t) => {
        lp.set('lp', 500 + 2500 * Math.exp(-t * 25));
        return lp.run(noise()) * env(t, 0.001, 0.05) + Math.sin(TAU * (90 + 200 * Math.exp(-t * 30)) * t) * env(t, 0.001, 0.04) * 0.8;
      });
      const lp2 = new Biquad('lp', 900);
      this.mk('hitfur', 0.3, (t) => lp2.run(noise()) * env(t, 0.001, 0.06) * 1.3 + Math.sin(TAU * (70 + 120 * Math.exp(-t * 20)) * t) * env(t, 0.002, 0.08));
      const lp3 = new Biquad('lp', 500);
      this.mk('thump', 0.3, (t) => lp3.run(noise()) * env(t, 0.002, 0.07) + Math.sin(TAU * 60 * t) * env(t, 0.002, 0.09));
      this.mk('drop', 0.25, (t) => lp3.run(noise()) * env(t, 0.002, 0.04));
    }
    // ── Raccoon voices ──
    const squeal = (base: number, dur: number, rough: number) => (t: number) => {
      const p = t / dur;
      const f = base * (1 + 0.6 * Math.sin(Math.PI * p)) * (1 + 0.04 * Math.sin(TAU * 38 * t));
      const ph = TAU * f * t;
      const s = Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph + noise() * rough);
      return s * Math.sin(Math.PI * Math.min(1, p)) * (0.85 + 0.15 * noise());
    };
    this.mk('yelp', 0.3, squeal(1150, 0.3, 0.6));
    this.mk('yelp2', 0.22, squeal(1500, 0.22, 0.9));
    const chitter = (seed: number, count: number, base: number) => {
      const starts: number[] = [];
      let t0 = 0;
      for (let k = 0; k < count; k++) { starts.push(t0); t0 += 0.035 + ((seed * (k + 3)) % 7) * 0.006; }
      const bp = new Biquad('bp', 2400, 3);
      return (t: number) => {
        let v = 0;
        for (const s of starts) {
          const u = t - s;
          if (u < 0 || u > 0.05) continue;
          const f = base * (1 + 0.5 * Math.sin(u * 60)) + 400 * Math.sin(TAU * 70 * u);
          v += Math.sin(TAU * f * u) * Math.sin((Math.PI * u) / 0.05);
        }
        return v + bp.run(noise()) * 0.15 * (v !== 0 ? 1 : 0.2);
      };
    };
    this.mk('chitter', 0.5, chitter(3, 10, 1900));
    this.mk('chitter2', 0.42, chitter(5, 8, 2300));
    this.mk('chitter3', 0.62, chitter(2, 13, 1600));
    {
      const lp = new Biquad('lp', 600, 2);
      this.mk('growl', 0.9, (t) => {
        const f = 85 + 15 * Math.sin(TAU * 3 * t);
        const saw = ((f * t) % 1) * 2 - 1;
        const am = 0.6 + 0.4 * Math.sin(TAU * 23 * t + noise() * 0.5);
        return lp.run(saw * am + noise() * 0.3) * Math.sin(Math.PI * Math.min(1, t / 0.9));
      });
      const lp2 = new Biquad('lp', 900, 3);
      const ch = chitter(7, 14, 1300);
      this.mk('roar', 1.7, (t) => {
        const f = 60 + 25 * Math.sin(TAU * 1.4 * t);
        const saw = ((f * t) % 1) * 2 - 1;
        const am = 0.6 + 0.4 * Math.sin(TAU * 19 * t);
        const g = lp2.run(saw * am + noise() * 0.4) * Math.sin(Math.PI * Math.min(1, t / 1.7));
        return g * 1.4 + (t > 0.9 ? ch(t - 0.9) * 0.5 : 0);
      });
    }
    // ── Foley ──
    {
      const partials = [523, 1187, 1794, 2911, 4120];
      const hits = [0, 0.13, 0.31];
      this.mk('can', 0.7, (t) => {
        let v = 0;
        for (const h of hits) {
          const u = t - h;
          if (u < 0) continue;
          for (let k = 0; k < partials.length; k++) v += Math.sin(TAU * partials[k] * (1 + h * 0.1) * u) * Math.exp(-u / (0.06 + 0.03 * k)) / (k + 1);
          v += noise() * Math.exp(-u / 0.01) * 0.8;
        }
        return v;
      });
      const cp = [311, 739, 1203, 1680, 2490, 3333];
      const ch = [0, 0.22, 0.42, 0.6, 0.82];
      this.mk('clang', 1.4, (t) => {
        let v = 0;
        for (const h of ch) {
          const u = t - h;
          if (u < 0) continue;
          for (let k = 0; k < cp.length; k++) v += Math.sin(TAU * cp[k] * u) * Math.exp(-u / (0.25 - k * 0.025)) / (1 + k * 0.6);
          v += noise() * Math.exp(-u / 0.01);
        }
        return v;
      });
    }
    {
      const bp = new Biquad('bp', 3000, 1.5);
      this.mk('scratch', 0.5, (t) => {
        const stroke = Math.max(0, Math.sin(TAU * 9 * t));
        return bp.run(noise()) * Math.pow(stroke, 3);
      });
      const bp2 = new Biquad('bp', 2000, 0.8);
      this.mk('tear', 0.45, (t) => bp2.run(noise() * (Math.random() < 0.3 ? 2 : 0.4)) * env(t, 0.01, 0.15));
      const bp3 = new Biquad('bp', 1600, 4);
      this.mk('tape', 0.6, (t) => bp3.run(noise()) * (0.6 + 0.4 * Math.sin(TAU * 31 * t)) * Math.sin(Math.PI * t / 0.6));
    }
    {
      const hp = new Biquad('hp', 3000);
      this.mk('crinkle', 0.7, (t) => hp.run(Math.random() < 0.08 ? noise() * 3 : noise() * 0.05) * Math.sin(Math.PI * t / 0.7));
      this.mk('eat', 0.8, (t) => {
        const chew = Math.max(0, Math.sin(TAU * 6 * t));
        return hp.run(Math.random() < 0.12 ? noise() * 2 : noise() * 0.1) * chew;
      });
    }
    {
      const lp = new Biquad('lp', 1400);
      this.mk('rustle', 0.8, (t) => lp.run(noise() * (Math.random() < 0.2 ? 1.6 : 0.6)) * Math.sin(Math.PI * t / 0.8) * (0.6 + 0.4 * Math.sin(TAU * 7 * t)));
      const lp2 = new Biquad('lp', 2600);
      this.mk('step', 0.14, (t) => lp2.run(noise() * (Math.random() < 0.3 ? 1.5 : 0.3)) * env(t, 0.005, 0.03));
      const snaps = [0, 0.05, 0.09, 0.16];
      this.mk('crack', 0.4, (t) => {
        let v = 0;
        for (const s of snaps) {
          const u = t - s;
          if (u >= 0) v += noise() * Math.exp(-u / (s === 0 ? 0.012 : 0.006)) * (s === 0 ? 1.4 : 0.6);
        }
        return lp2.run(v) + Math.sin(TAU * 180 * t) * Math.exp(-t / 0.02) * 0.4;
      });
      const bp = new Biquad('bp', 900, 0.7);
      this.mk('swish', 0.35, (t) => bp.run(noise()) * Math.sin(Math.PI * t / 0.35));
    }
    this.mk('owl', 1.9, (t) => {
      const notes = [[0, 0.32], [0.55, 0.18], [0.8, 0.55]];
      let v = 0;
      for (const [s, d] of notes) {
        const u = t - s;
        if (u < 0 || u > d) continue;
        const f = 390 - u * 40;
        v += (Math.sin(TAU * f * u) + noise() * 0.08) * Math.sin(Math.PI * u / d);
      }
      return v;
    });
    {
      const bp = new Biquad('bp', 2800, 2);
      this.mk('zipper', 0.55, (t) => {
        const rate = 40 + t * 90;
        const ph = (t * rate) % 1;
        return bp.run(noise()) * (ph < 0.25 ? 1 : 0.15) * Math.sin(Math.PI * t / 0.55);
      });
    }
    {
      const lp = new Biquad('lp', 1200, 4);
      this.mk('lid', 0.7, (t) => {
        const f = 260 + 140 * Math.sin(TAU * 2.2 * t) + 40 * noise();
        const saw = ((f * t) % 1) * 2 - 1;
        return lp.run(saw * 0.5 + noise() * 0.2) * Math.sin(Math.PI * t / 0.7);
      });
      const lp2 = new Biquad('lp', 400);
      this.mk('thunk', 0.25, (t) => lp2.run(noise()) * env(t, 0.002, 0.04) + Math.sin(TAU * 110 * t) * env(t, 0.002, 0.05));
    }
    this.mk('heart', 0.6, (t) => {
      const b = (s: number) => (t < s ? 0 : Math.sin(TAU * 52 * (t - s)) * Math.exp(-(t - s) / 0.05));
      return b(0) + b(0.2) * 0.7;
    });
    // ── Musical stings ──
    this.mk('sting', 2.8, (t) => {
      const fr = [55, 58.3, 82.4, 110.5];
      let v = 0;
      for (const f of fr) v += Math.sin(TAU * f * t + Math.sin(TAU * 0.3 * t));
      return v * Math.min(1, t / 0.9) * Math.exp(-Math.max(0, t - 1.4) / 0.6) + noise() * 0.04 * Math.min(1, t);
    }, 0.6);
    {
      const lp = new Biquad('lp', 800, 1.2);
      this.mk('bossSting', 3.2, (t) => {
        const fr = [65.4, 77.8, 98, 130.8, 155.6];
        let v = 0;
        for (const f of fr) v += (((f * t) % 1) * 2 - 1) * 0.5;
        lp.set('lp', 300 + 1600 * Math.exp(-t * 1.5), 1.2);
        const timp = Math.sin(TAU * (50 + 30 * Math.exp(-t * 8)) * t) * Math.exp(-t / 0.4) * 2;
        return lp.run(v) * Math.min(1, t / 0.05) * Math.exp(-t / 1.4) + timp;
      });
    }
    this.mk('sunrise', 4.5, (t) => {
      const fr = [220, 277.2, 329.6, 440, 554.4];
      let v = 0;
      fr.forEach((f, k) => {
        const s = k * 0.25;
        if (t > s) v += Math.sin(TAU * f * t) * Math.min(1, (t - s) / 0.6) * (1 - k * 0.1);
      });
      return v * Math.exp(-Math.max(0, t - 2.5) / 0.8);
    }, 0.55);
    this.mk('lose', 2.4, (t) => {
      const f = 220 * Math.pow(0.5, t / 2.4);
      return (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 1.5 * t)) * Math.exp(-t / 1.2);
    }, 0.55);
    this.mk('bird', 0.5, (t) => {
      let v = 0;
      for (const s of [0, 0.15, 0.28]) {
        const u = t - s;
        if (u < 0 || u > 0.09) continue;
        v += Math.sin(TAU * (3000 + 18000 * u) * u) * Math.sin(Math.PI * u / 0.09);
      }
      return v;
    }, 0.4);
    this.mk('beep', 0.25, (t) => ((t < 0.07 || (t > 0.12 && t < 0.19)) ? (Math.sin(TAU * 2900 * t) > 0 ? 1 : -1) * 0.5 : 0), 0.3);
    this.mk('chime', 0.6, (t) => Math.sin(TAU * 1320 * t) * Math.exp(-t / 0.15) + Math.sin(TAU * 1760 * t) * (t > 0.12 ? Math.exp(-(t - 0.12) / 0.2) : 0), 0.4);
    {
      const lp = new Biquad('lp', 500, 3);
      this.mk('snore', 2.6, (t) => {
        const inhale = t < 1.4 ? Math.sin(Math.PI * t / 1.4) : 0;
        const rattle = 0.5 + 0.5 * Math.sin(TAU * 28 * t);
        return lp.run(noise()) * inhale * rattle + Math.sin(TAU * 70 * t) * inhale * rattle * 0.4;
      });
    }
    this.mk('click', 0.05, (t) => click(t, 0, 2000, 0.004), 0.4);
    this.mk('buy', 0.6, (t) => {
      let v = 0;
      [523, 659, 784, 1046].forEach((f, k) => {
        const u = t - k * 0.07;
        if (u > 0) v += Math.sin(TAU * f * u) * Math.exp(-u / 0.18);
      });
      return v;
    }, 0.45);
    this.mk('trap', 0.5, (t) => Math.sin(TAU * (180 - 80 * t) * t) * Math.exp(-t / 0.15) + (t > 0.04 ? noise() * Math.exp(-(t - 0.04) / 0.05) : 0));

    // ── Ambience loops ──
    this.mk('crickets', 4, (t) => {
      // chirp every ~0.55s; each chirp = 3 pulses of 4.6kHz
      const period = 0.5;
      const ph = t % period;
      let a = 0;
      for (let k = 0; k < 3; k++) {
        const u = ph - k * 0.03;
        if (u > 0 && u < 0.018) a += Math.sin((Math.PI * u) / 0.018);
      }
      return Math.sin(TAU * 4600 * t) * a;
    }, 0.5);
    {
      const bp = new Biquad('bp', 5200, 6);
      const dur = 6;
      this.mk('cicada', dur, (t) => {
        const swell = Math.pow(Math.sin(Math.PI * t / dur), 2);
        return bp.run(noise()) * (0.6 + 0.4 * Math.sin(TAU * 42 * t)) * swell;
      }, 0.4);
    }
    {
      const lp = new Biquad('lp', 380, 0.8);
      const dur = 8;
      let b0 = 0, b1 = 0, b2 = 0;
      this.mk('wind', dur, (t) => {
        const w = noise();
        b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
        const pink = (b0 + b1 + b2 + w * 0.1848) * 0.2;
        const gust = 0.55 + 0.45 * Math.sin(TAU * t / dur) * Math.sin(TAU * 2 * t / dur + 1);
        lp.set('lp', 250 + 350 * gust, 0.8);
        return lp.run(pink) * gust;
      }, 0.6);
    }
    this.mk('drone', 8, (t) => {
      const fr = [41.2, 61.7, 82.4, 87.3];
      let v = 0;
      for (const f of fr) v += Math.sin(TAU * f * t + 0.6 * Math.sin(TAU * t / 8));
      return v;
    }, 0.5);
    {
      // tinny late-90s radio — a little shuffling melody through a tiny speaker
      const bp = new Biquad('bp', 1400, 0.9);
      const mel = [64, 67, 69, 67, 64, 62, 60, 62, 64, 64, 67, 72, 69, 67, 64, 62];
      const bass = [40, 40, 45, 45, 43, 43, 38, 43];
      const beat = 60 / 112 / 2;
      this.mk('radio', mel.length * beat * 2, (t) => {
        const step = Math.floor(t / beat);
        const u = t - step * beat;
        const m = mel[(step >> 1) % mel.length];
        const f = 440 * Math.pow(2, (m - 69) / 12);
        const bf = 440 * Math.pow(2, (bass[(step >> 2) % bass.length] - 69) / 12);
        const sq = (Math.sin(TAU * f * t) > 0 ? 1 : -1) * 0.25 * Math.exp(-u / 0.18);
        const bs = Math.sin(TAU * bf * t) * 0.5;
        const hat = step % 2 === 1 ? noise() * Math.exp(-u / 0.02) * 0.3 : 0;
        return bp.run(sq + bs + hat + noise() * 0.03);
      }, 0.5);
    }
  }

  private startLoop(name: string, bus: AudioNode, vol: number, rate = 1, pan = 0): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers.get(name)!;
    src.loop = true;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vol;
    let node: AudioNode = g;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      node = p;
    }
    src.connect(g);
    node.connect(bus);
    src.start(ctx.currentTime + Math.random() * 0.5, Math.random() * src.buffer.duration);
    this.loops.push({ src, gain: g, name });
    return g;
  }

  private startLoops() {
    this.cricketGain = this.ctx!.createGain();
    this.cricketGain.connect(this.amb);
    this.startLoop('crickets', this.cricketGain, 0.22, 1.0, -0.7);
    this.startLoop('crickets', this.cricketGain, 0.18, 1.07, 0.6);
    this.startLoop('crickets', this.cricketGain, 0.14, 0.93, 0.1);
    this.startLoop('crickets', this.cricketGain, 0.1, 1.13, -0.2);
    this.cicadaGain = this.startLoop('cicada', this.amb, 0.25, 1, 0.3);
    this.windGain = this.startLoop('wind', this.amb, 0.55);
    this.droneGain = this.startLoop('drone', this.amb, 0.0);
    this.radioGain = this.startLoop('radio', this.radioBus, 0.0);
  }

  /** danger 0..1: crickets fall silent when raccoons are close. tension 0..1 swells the drone. */
  setMood(danger: number, tension: number, dt: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const radioDuck = this.radioOn ? 0.35 : 1;
    this.cricketGain.gain.setTargetAtTime((1 - danger * 0.85) * (1 - this.dayMix) * radioDuck, now, 0.4);
    this.cicadaGain.gain.setTargetAtTime(0.25 * (1 - tension * 0.7) * (1 - this.dayMix) * radioDuck, now, 1);
    this.droneGain.gain.setTargetAtTime(tension * 0.35 * radioDuck, now, 1.2);
    this.windGain.gain.setTargetAtTime((0.45 + tension * 0.25) * radioDuck, now, 1.5);
    this.radioGain.gain.setTargetAtTime(this.radioOn ? 0.5 : 0, now, 0.1);
  }

  setListener(pos: THREE.Vector3, fwd: THREE.Vector3) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else {
      (L as any).setPosition(pos.x, pos.y, pos.z);
      (L as any).setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  play(name: SoundName, opts: { pos?: THREE.Vector3; vol?: number; rate?: number; jitter?: number; muffle?: boolean } = {}) {
    if (!this.ctx || !this.ready) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const j = opts.jitter ?? 0.06;
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * j);
    const g = ctx.createGain();
    let vol = opts.vol ?? 1;
    if (this.radioOn && opts.muffle) vol *= 0.3;
    g.gain.value = vol;
    src.connect(g);
    if (opts.pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 2.2;
      p.rolloffFactor = 1.1;
      p.maxDistance = 80;
      if (p.positionX) {
        p.positionX.value = opts.pos.x; p.positionY.value = opts.pos.y; p.positionZ.value = opts.pos.z;
      } else (p as any).setPosition(opts.pos.x, opts.pos.y, opts.pos.z);
      g.connect(p);
      p.connect(this.sfx);
    } else g.connect(this.sfx);
    src.start();
  }

  /** Random woodland events: owls, distant snaps, dad snoring in the camper, dawn birds. */
  update(dt: number, inGame: boolean, nightProgress: number) {
    if (!this.ctx) return;
    this.nextOwl -= dt;
    this.nextCrack -= dt;
    this.nextSnore -= dt;
    const rnd = (r: number) => new THREE.Vector3((Math.random() - 0.5) * r * 2, 6 + Math.random() * 8, (Math.random() - 0.5) * r * 2);
    if (this.nextOwl <= 0) {
      this.nextOwl = 18 + Math.random() * 26;
      if (this.dayMix < 0.5) this.play('owl', { pos: rnd(40), vol: 0.5, jitter: 0.03 });
    }
    if (this.nextCrack <= 0) {
      this.nextCrack = 7 + Math.random() * 14 - nightProgress * 4;
      const p = rnd(30); p.y = 0.5;
      this.play(Math.random() < 0.5 ? 'crack' : 'rustle', { pos: p, vol: 0.35 + nightProgress * 0.3 });
    }
    if (this.nextSnore <= 0) {
      this.nextSnore = 5 + Math.random() * 5;
      this.play('snore', { pos: this.camper, vol: inGame ? 0.55 : 0.4, jitter: 0.08 });
    }
    if (this.dayMix > 0.2) {
      this.nextBird -= dt;
      if (this.nextBird <= 0) {
        this.nextBird = 0.6 + Math.random() * 1.5;
        this.play('bird', { pos: rnd(25), vol: 0.5 * this.dayMix, jitter: 0.2 });
      }
    }
  }
}

export const audio = new AudioEngine();
