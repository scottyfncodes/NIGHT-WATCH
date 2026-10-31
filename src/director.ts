import * as THREE from 'three';
import { WAVES, WaveDef, SpawnDef, LAYOUT, ARCHETYPES } from './config';
import { audio } from './audio';

export interface DirectorHost {
  time: number;
  night: number;
  spawnRaccoon(def: SpawnDef, pos: THREE.Vector3, angle: number): void;
  spawnBoss(): void;
  aliveCount(): number;
  bossDeterred(): boolean;
  onWaveStart(w: WaveDef, index: number): void;
  onWaveClear(w: WaveDef, index: number): void;
  onSunrise(): void;
  warnAt(pos: THREE.Vector3, kind: 'approach' | 'noise'): void;
  stallWave(level: 1 | 2): void;
  watcherEyes(count: number): void;
}

/** Runs the night: wave scheduling, spawn warnings, clock, sunrise. */
export class Director {
  waveIndex = 0;
  phase: 'wave' | 'breather' | 'sunrise' | 'idle' = 'idle';
  waveTime = 0;
  breather = 0;
  clock = 0; // minutes after 10 PM
  bossTimer = 0;
  queue: (SpawnDef & { warned: boolean; spawned: boolean })[] = [];
  waves: WaveDef[] = WAVES;
  clearTimer = 0;
  sunriseT = 0;
  bossGoneT = 0;
  stall = 0;

  constructor(private host: DirectorHost) {}

  get wave(): WaveDef { return this.waves[this.waveIndex]; }
  get totalWaves() { return this.waves.length; }

  start() {
    this.waveIndex = 0;
    this.sunriseT = 0;
    this.bossGoneT = 0;
    this.startWave(0);
  }

  /** Extra raccoons on later nights — new combos, not just more health. */
  private scaledSpawns(w: WaveDef): SpawnDef[] {
    const base = w.spawns.map((s) => ({ ...s }));
    const n = this.host.night;
    if (n <= 1 || w.id === 1) return base;
    const extra = Math.floor(base.length * Math.min(1, (n - 1) * 0.35));
    const lastAt = Math.max(...base.map((s) => s.at));
    const pool = base.filter((s) => s.type !== 'boss');
    for (let i = 0; i < extra; i++) {
      const src = pool[i % pool.length];
      let type = src.type;
      // on later nights, scouts get replaced with nastier specialists sometimes
      if (type === 'scout' && n >= 3 && i % 2 === 0) type = 'sneak';
      if (type === 'bandit' && n >= 3 && i % 3 === 0) type = 'acrobat';
      base.push({ type, at: lastAt * ((i + 1) / (extra + 1)) + 1.2, side: ((src.side ?? 0) + 140 + i * 47) % 360 });
    }
    return base.sort((a, b) => a.at - b.at);
  }

  startWave(i: number) {
    this.waveIndex = i;
    const w = this.wave;
    this.phase = 'wave';
    this.waveTime = 0;
    this.clearTimer = 0;
    this.stall = 0;
    this.clock = w.clockStart;
    this.queue = this.scaledSpawns(w).map((s) => ({ ...s, warned: false, spawned: false }));
    this.bossTimer = w.duration ?? 0;
    this.host.onWaveStart(w, i);
    if (w.id === 5) this.host.watcherEyes(18);
  }

  spawnPos(side: number, r = 24): { pos: THREE.Vector3; angle: number } {
    const a = THREE.MathUtils.degToRad(side + (Math.random() - 0.5) * 16);
    return { pos: new THREE.Vector3(Math.sin(a) * r + LAYOUT.bounds.x, 0, -Math.cos(a) * r + LAYOUT.bounds.z), angle: a };
  }

  update(dt: number) {
    if (this.phase === 'idle') return;
    if (this.phase === 'wave') {
      const w = this.wave;
      this.waveTime += dt;
      for (const s of this.queue) {
        if (s.type === 'boss') {
          if (!s.spawned && this.waveTime >= s.at) { s.spawned = true; this.host.spawnBoss(); }
          continue;
        }
        if (!s.warned && this.waveTime >= s.at - 1.6) {
          s.warned = true;
          const { pos } = this.spawnPos(s.side ?? 0, 18);
          // you hear them before you see them
          audio.play(Math.random() < 0.5 ? 'crack' : 'rustle', { pos: pos.clone().setY(0.5), vol: 0.9 });
          const voice = ARCHETYPES[s.type].id === 'tank' ? 'growl' : 'chitter';
          setTimeout(() => audio.play(voice, { pos, vol: 0.6, rate: ARCHETYPES[s.type].pitch, muffle: true }), 500);
          this.host.warnAt(pos, s.role === 'pincer-noise' ? 'noise' : 'approach');
        }
        if (!s.spawned && this.waveTime >= s.at) {
          s.spawned = true;
          const r = w.id === 1 ? 12 : 24;
          const { pos, angle } = this.spawnPos(s.side ?? 0, r);
          this.host.spawnRaccoon(s, pos, angle);
        }
      }
      const allSpawned = this.queue.every((s) => s.spawned);
      if (w.isBoss) {
        this.bossTimer -= dt;
        const k = 1 - Math.max(0, this.bossTimer) / (w.duration ?? 1);
        this.clock = THREE.MathUtils.lerp(w.clockStart, w.clockEnd, k);
        if (this.host.bossDeterred()) {
          this.bossGoneT += dt;
          if (this.bossGoneT > 2.5) this.beginSunrise();
        } else if (this.bossTimer <= 0) this.beginSunrise();
        return;
      }
      const lastAt = Math.max(...this.queue.map((s) => s.at));
      // stragglers: first they get bold, eventually they wander off
      if (this.stall < 1 && this.waveTime > lastAt + 70) { this.stall = 1; this.host.stallWave(1); }
      if (this.stall < 2 && this.waveTime > lastAt + 115) { this.stall = 2; this.host.stallWave(2); }
      const est = lastAt + 30;
      this.clock = THREE.MathUtils.lerp(w.clockStart, w.clockEnd, Math.min(1, this.waveTime / est));
      if (allSpawned && this.host.aliveCount() === 0) {
        this.clearTimer += dt;
        if (this.clearTimer > 1.4) {
          this.phase = 'breather';
          this.breather = this.waveIndex === 0 ? 5 : 6;
          this.host.onWaveClear(w, this.waveIndex);
        }
      } else this.clearTimer = 0;
    } else if (this.phase === 'breather') {
      this.breather -= dt;
      const next = this.waves[this.waveIndex + 1];
      if (next) this.clock += (next.clockStart - this.clock) * Math.min(1, dt * 0.9);
      if (this.breather <= 0) {
        if (next) this.startWave(this.waveIndex + 1);
        else this.beginSunrise();
      }
    } else if (this.phase === 'sunrise') {
      this.sunriseT += dt;
      this.clock = Math.min(482, this.clock + dt * 0.5);
    }
  }

  beginSunrise() {
    if (this.phase === 'sunrise') return;
    this.phase = 'sunrise';
    this.sunriseT = 0;
    this.clock = Math.max(this.clock, 478);
    this.host.onSunrise();
  }

  static clockString(min: number): { time: string; ampm: string } {
    const total = (22 * 60 + Math.floor(min)) % (24 * 60);
    const h24 = Math.floor(total / 60);
    const m = total % 60;
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return { time: `${h}:${m.toString().padStart(2, '0')}`, ampm: h24 >= 12 ? 'PM' : 'AM' };
  }
}
