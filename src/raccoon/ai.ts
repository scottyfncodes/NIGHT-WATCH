import * as THREE from 'three';
import { Archetype, ArchetypeId, ARCHETYPES, LAYOUT, AmmoType } from '../config';
import { RaccoonModel } from './model';
import { Tent, Opening } from '../world/tent';
import { Cooler, Campsite, LootKind, makeLoot, Lantern } from '../world/campsite';
import { Environment } from '../world/environment';
import { Loadout } from '../save';
import { audio, SoundName } from '../audio';

export type RState =
  | 'enter' | 'lurk' | 'peek' | 'investigate' | 'sneak' | 'approach' | 'distract' | 'attack' | 'charge'
  | 'steal' | 'retreat' | 'stunned' | 'escape' | 'frozen' | 'climb' | 'roof' | 'enterTent' | 'inside'
  | 'exitTent' | 'bossIntro' | 'gone';

export interface Lure { pos: THREE.Vector3; time: number; radius: number; kind: 'decoy' | 'hotdog'; mesh?: THREE.Object3D }
export interface DroppedLoot { kind: LootKind; amount: number; pos: THREE.Vector3; mesh: THREE.Object3D; time: number; claimed: Raccoon | null }

export interface RaccoonWorld {
  time: number;
  playerPos: THREE.Vector3; // feet
  playerInTent: boolean;
  cooler: Cooler;
  tent: Tent;
  camp: Campsite;
  env: Environment;
  loadout: Loadout;
  lures: Lure[];
  drops: DroppedLoot[];
  raccoons: Raccoon[];
  speedScale: number;
  isInBeam(p: THREE.Vector3): boolean;
  isLit(p: THREE.Vector3): boolean;
  addNerve(n: number): void;
  onFoodStolen(r: Raccoon, amount: number): void;
  onLootEscaped(r: Raccoon): void;
  onDeterred(r: Raccoon): void;
  dropLoot(r: Raccoon): void;
  onBreach(r: Raccoon, op: Opening): void;
  onBossCommand(r: Raccoon): void;
  onBossHalf(r: Raccoon): void;
  hint(id: string, text: string): void;
  scene: THREE.Scene;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
let uid = 0;

const VOICE: Record<ArchetypeId, SoundName[]> = {
  visitor: ['chitter', 'chitter2'],
  scout: ['chitter2', 'chitter2', 'chitter'],
  bandit: ['chitter', 'chitter3'],
  sneak: ['chitter3'],
  tank: ['growl', 'chitter3'],
  acrobat: ['chitter2', 'chitter'],
  distraction: ['chitter3', 'chitter'],
  boss: ['growl', 'chitter3'],
};

export class Raccoon {
  id = ++uid;
  def: Archetype;
  model: RaccoonModel;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3(); // knockback / external
  heading = 0;
  state: RState = 'enter';
  stateTime = 0;
  target = new THREE.Vector3();
  waypoints: THREE.Vector3[] = [];
  plan: 'cooler' | 'tent' | 'distract' | 'roof' = 'cooler';
  resolve: number;
  raids = 0;
  carrying: LootKind | null = null;
  carryAmount = 0;
  lootMesh: THREE.Object3D | null = null;
  slow = 0;
  glow = 0;
  stun = 0;
  rally = 0;
  fearCooldown = 0;
  beamTime = 0;
  frozeOnce = false;
  progress = 0; // generic progress (lid opening, tearing)
  opening: Opening | null = null;
  lure: Lure | null = null;
  lanternTarget: Lantern | null = null;
  dropTarget: DroppedLoot | null = null;
  side: number; // spawn angle (rad)
  role?: string;
  voiceT = 2 + Math.random() * 4;
  stepT = 0;
  hitsSinceStagger = 0;
  halfCalled = false;
  commandT = 8;
  deterred = false;
  removed = false;
  returnDelay = 0;
  speed = 0;
  airborne = 0;
  airFrom = new THREE.Vector3();
  airTo = new THREE.Vector3();
  roofSpot = new THREE.Vector3();
  eyeBoost = 0;
  peekDone = false;
  investigated = false;
  stuckT = 0;
  scares = 0;

  constructor(type: ArchetypeId, public w: RaccoonWorld, side: number, role?: string) {
    this.def = ARCHETYPES[type];
    this.model = new RaccoonModel(this.def);
    this.resolve = this.def.resolve;
    this.side = side;
    this.role = role;
    w.scene.add(this.model.root);
  }

  get alive() { return !this.removed; }
  get active() { return !this.removed && this.state !== 'escape' && this.state !== 'gone'; }
  get isBoss() { return this.def.id === 'boss'; }

  /** world-space hit spheres: [center, radius][] */
  hitSpheres(): [THREE.Vector3, number][] {
    const s = this.def.scale;
    const body = this.model.body.getWorldPosition(new THREE.Vector3());
    body.y += 0.02 * s;
    const head = this.model.headPivot.getWorldPosition(new THREE.Vector3());
    head.addScaledVector(new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)), 0.08 * s);
    const mid = body.clone().add(new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(0.18 * s));
    return [[body, 0.25 * s], [mid, 0.21 * s], [head, 0.15 * s]];
  }

  spawnAt(p: THREE.Vector3) {
    this.pos.copy(p);
    this.heading = Math.atan2(-p.x, -p.z);
    this.model.root.position.copy(p);
  }

  setState(s: RState) {
    this.state = s;
    this.stateTime = 0;
    this.progress = 0;
  }

  // ─── helpers ────────────────────────────────────────────
  private dirFromCamp(angle = this.side, r = 14): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(angle) * r + LAYOUT.bounds.x, 0, -Math.cos(angle) * r + LAYOUT.bounds.z);
  }

  private nearestCover(near: THREE.Vector3, maxD: number, minCampD: number): THREE.Vector3 | null {
    let best: { x: number; z: number } | null = null;
    let bd = maxD * maxD;
    for (const c of this.w.env.cover) {
      const dc = Math.hypot(c.x - LAYOUT.bounds.x, c.z - LAYOUT.bounds.z);
      if (dc < minCampD) continue;
      const d = (c.x - near.x) ** 2 + (c.z - near.z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    // stand on the side of the cover away from the player
    const away = new THREE.Vector3(best.x - this.w.playerPos.x, 0, best.z - this.w.playerPos.z).normalize();
    return new THREE.Vector3(best.x, 0, best.z).addScaledVector(away, 0.8);
  }

  private coolerSpot(): THREE.Vector3 {
    const c = this.w.cooler.pos;
    const away = tmp.set(c.x - this.w.playerPos.x, 0, c.z - this.w.playerPos.z);
    if (away.lengthSq() < 0.01) away.set(0, 0, -1);
    away.normalize();
    // bias toward the raccoon's own side so several can crowd in
    const mine = tmp2.set(this.pos.x - c.x, 0, this.pos.z - c.z).normalize();
    away.lerp(mine, 0.5).normalize();
    return new THREE.Vector3(c.x, 0, c.z).addScaledVector(away, 0.62 * Math.max(0.9, this.def.scale));
  }

  private pickOpening(): Opening {
    const ops = this.w.tent.openings.filter((o) => !o.occupant || o.occupant === this);
    const pool = ops.length ? ops : this.w.tent.openings;
    // prefer the opening facing away from the player, torn/open ones even more
    let best = pool[0], bs = -1e9;
    for (const o of pool) {
      const opos = o.center.clone().setY(0);
      const toPlayer = this.w.playerPos.clone().sub(opos).setY(0).normalize();
      let score = -o.normal.dot(toPlayer) * 2 - opos.distanceTo(this.pos) * 0.12 + Math.random() * 0.6;
      if (o.state !== 'mesh') score += 1.5;
      if (this.w.playerInTent) score += 0.5;
      if (score > bs) { bs = score; best = o; }
    }
    return best;
  }

  private radioNear(p: THREE.Vector3) {
    const r = this.w.camp.radio;
    return r.on && p.distanceTo(r.pos) < 5.5;
  }

  private moveToward(dest: THREE.Vector3, speed: number, dt: number, avoidTent = true, face = true): boolean {
    const d = tmp.set(dest.x - this.pos.x, 0, dest.z - this.pos.z);
    const dist = d.length();
    if (dist < 0.12) { this.speed = 0; return true; }
    d.divideScalar(dist);
    // steering: avoid trees, props and the tent body
    const avoid = tmp2.set(0, 0, 0);
    const R = 0.35 * this.def.scale;
    for (const t of this.w.env.trees) {
      const dx = this.pos.x - t.x, dz = this.pos.z - t.z;
      const dd = dx * dx + dz * dz;
      const rr = t.r + R + 0.5;
      if (dd < rr * rr && dd > 1e-4) {
        const k = (rr - Math.sqrt(dd)) / rr;
        avoid.x += (dx / Math.sqrt(dd)) * k * 2; avoid.z += (dz / Math.sqrt(dd)) * k * 2;
      }
    }
    for (const c of this.w.camp.circles) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const dd = Math.sqrt(dx * dx + dz * dz);
      const rr = c.r + R + 0.15;
      // don't avoid the thing we're trying to reach
      if (Math.hypot(dest.x - c.x, dest.z - c.z) < c.r + 0.9) continue;
      if (dd < rr && dd > 1e-3) { const k = (rr - dd) / rr; avoid.x += (dx / dd) * k * 3; avoid.z += (dz / dd) * k * 3; }
    }
    if (avoidTent) {
      const dd = Math.hypot(this.pos.x, this.pos.z);
      const rr = 1.9 + R;
      if (dd < rr && dd > 1e-3) { const k = (rr - dd) / rr; avoid.x += (this.pos.x / dd) * k * 4; avoid.z += (this.pos.z / dd) * k * 4; }
    }
    // other raccoons (light separation)
    for (const o of this.w.raccoons) {
      if (o === this || !o.active || o.airborne > 0) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const dd = Math.sqrt(dx * dx + dz * dz);
      const rr = (o.def.scale + this.def.scale) * 0.3;
      if (dd < rr && dd > 1e-3) { avoid.x += (dx / dd) * 0.8; avoid.z += (dz / dd) * 0.8; }
    }
    const desired = d.clone();
    d.add(avoid).setY(0);
    if (d.lengthSq() < 0.04 || this.stuckT > 0.8) {
      // steering deadlock (e.g. pinned against a trunk): sidestep around it
      const side = this.id % 2 ? 1 : -1;
      d.set(-desired.z * side, 0, desired.x * side).addScaledVector(desired, 0.35);
    }
    d.normalize();
    const step = Math.min(dist, speed * dt);
    const before = this.pos.clone();
    this.pos.addScaledVector(d, step);
    // progress toward the destination; if none for a while we're stuck
    const progress = before.distanceTo(dest) - this.pos.distanceTo(dest);
    if (progress < step * 0.15) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 2.5) this.stuckT = 0;
    this.speed = speed;
    if (face) this.turnTo(Math.atan2(d.x, d.z), dt);
    return dist < 0.18;
  }

  private turnTo(h: number, dt: number, rate = 8) {
    let diff = h - this.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.heading += diff * Math.min(1, dt * rate);
  }

  private faceToward(p: THREE.Vector3, dt: number) {
    this.turnTo(Math.atan2(p.x - this.pos.x, p.z - this.pos.z), dt);
  }

  private say(name?: SoundName, vol = 0.7) {
    const v = VOICE[this.def.id];
    const n = name ?? v[(Math.random() * v.length) | 0];
    audio.play(n, { pos: this.model.root.position.clone().setY(0.4 * this.def.scale), vol, rate: this.def.pitch, jitter: 0.08, muffle: true });
  }

  private walk() { return this.def.walk * this.mods(); }
  private run() { return this.def.run * this.mods(); }
  private mods() { return (this.slow > 0 ? 0.45 : 1) * (this.rally > 0 ? 1.35 : 1) * this.w.speedScale; }

  /** Decide what to go after next. */
  private choosePlan() {
    const id = this.def.id;
    // distractions from lit lanterns
    const lit = this.w.camp.lanterns.filter((l) => l.on);
    if (!this.investigated && lit.length && id !== 'tank' && id !== 'boss' && id !== 'visitor' && Math.random() < 0.4) {
      this.investigated = true;
      this.lanternTarget = lit[(Math.random() * lit.length) | 0];
      this.target.set(this.lanternTarget.pos.x, 0, this.lanternTarget.pos.z).add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(0.8));
      this.setState('investigate');
      return;
    }
    // loose loot on the ground
    const drop = this.w.drops.find((d) => !d.claimed && d.pos.distanceTo(this.pos) < 14);
    if (drop && id !== 'boss') {
      drop.claimed = this;
      this.dropTarget = drop;
      this.target.copy(drop.pos);
      this.setState('approach');
      return;
    }
    if (id === 'distraction' && this.raids === 0 && this.stateTime >= 0 && !this.peekDone) {
      this.peekDone = true;
      this.plan = 'distract';
      // a noisy spot on its own side, near the fire ring or table if close
      const spots = [new THREE.Vector3(LAYOUT.fire.x - 1.6, 0, LAYOUT.fire.z - 1.2), new THREE.Vector3(LAYOUT.table.x + 1.6, 0, LAYOUT.table.z - 1.1), this.dirFromCamp(this.side, 8)];
      spots.sort((a, b) => a.distanceTo(this.pos) - b.distanceTo(this.pos));
      this.target.copy(spots[0]);
      this.setState('approach');
      return;
    }
    if (id === 'scout' && !this.peekDone && Math.random() < 0.45) {
      this.peekDone = true;
      const ops = this.w.tent.openings.filter((o) => !o.isDoor && o.state === 'mesh');
      if (ops.length) {
        this.opening = ops[(Math.random() * ops.length) | 0];
        this.target.copy(this.opening.center).setY(0).addScaledVector(this.opening.normal, 0.55);
        this.plan = 'tent';
        this.setState('sneak');
        this.waypoints = [];
        return;
      }
    }
    if (id === 'acrobat') {
      this.plan = 'roof';
      const op = this.pickOpening();
      this.opening = op;
      this.target.copy(op.center).setY(0).addScaledVector(op.normal, 1.0);
      this.waypoints = this.coverPath(this.target);
      this.setState('sneak');
      return;
    }
    if (id === 'sneak' && !this.radioNear(new THREE.Vector3(0, 0, 0))) {
      this.plan = 'tent';
      this.opening = this.pickOpening();
      this.target.copy(this.opening.center).setY(0).addScaledVector(this.opening.normal, 0.5);
      this.waypoints = this.coverPath(this.target);
      this.setState('sneak');
      return;
    }
    this.plan = 'cooler';
    this.target.copy(this.coolerSpot());
    if (id === 'bandit' || id === 'sneak') {
      this.waypoints = this.coverPath(this.target);
      this.setState('sneak');
    } else this.setState('approach');
  }

  private coverPath(dest: THREE.Vector3): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const from = this.pos.clone();
    const d0 = from.distanceTo(dest);
    if (d0 < 6) return pts;
    for (const frac of [0.4, 0.72]) {
      const p = from.clone().lerp(dest, frac);
      const c = this.nearestCover(p, 5, 6.5);
      if (c && c.distanceTo(dest) < from.distanceTo(dest) - 1) pts.push(c);
    }
    return pts;
  }

  private scared(dropLoot = true) {
    if (this.carrying && dropLoot) this.w.dropLoot(this);
    this.fearCooldown = 4;
    this.scares++;
    // flee to cover 12-16m out
    const away = new THREE.Vector3(this.pos.x - this.w.playerPos.x, 0, this.pos.z - this.w.playerPos.z).normalize();
    const p = this.pos.clone().addScaledVector(away, 9);
    const c = this.nearestCover(p, 7, 10) ?? p;
    this.target.copy(c);
    if (this.opening && this.opening.occupant === this) this.opening.occupant = null;
    this.setState('retreat');
    this.say('yelp2', 0.5);
  }

  // ─── combat ─────────────────────────────────────────────
  hit(point: THREE.Vector3, dir: THREE.Vector3, ammo: AmmoType, color: number) {
    if (this.removed) return;
    this.model.addSplat(point, color, ammo === 'glow');
    if (this.state === 'escape') return;
    const L = this.w.loadout;
    if (ammo === 'glow') this.glow = L.glowTime;
    if (ammo === 'sticky') this.slow = L.stickyTime;
    this.resolve -= 1;
    this.hitsSinceStagger++;
    audio.play('hitfur', { pos: point, vol: 0.9 });
    this.say(this.def.scale > 1.3 ? 'growl' : Math.random() < 0.5 ? 'yelp' : 'yelp2', 0.9);
    if (this.carrying) this.w.dropLoot(this);
    if (this.opening && this.opening.occupant === this) this.opening.occupant = null;
    // knockback
    const kb = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(3.2 * this.def.knockback);
    this.vel.add(kb);
    if (this.state === 'roof' || this.state === 'climb') {
      // tumble off the tent
      this.w.tent.dentStrength = 0;
      this.w.tent.roofWobbleV += 4;
      const out = new THREE.Vector3(this.pos.x, 0, this.pos.z).normalize();
      if (out.lengthSq() < 0.1) out.set(dir.x, 0, dir.z).normalize();
      this.airFrom.copy(this.pos);
      this.airTo.copy(out.multiplyScalar(2.2));
      this.airborne = 0.45;
    }
    if (this.isBoss) {
      if (this.resolve <= this.def.resolve / 2 && !this.halfCalled) {
        this.halfCalled = true;
        this.w.onBossHalf(this);
      }
      if (this.resolve <= 0) {
        this.stun = 1.2;
        this.setState('stunned');
        return;
      }
      if (this.hitsSinceStagger >= 4) {
        this.hitsSinceStagger = 0;
        this.stun = 0.9;
        this.setState('stunned');
      } else if (this.state !== 'stunned') {
        this.vel.multiplyScalar(0.5);
        this.model.stunWobble = 0.6;
      }
      return;
    }
    this.stun = this.def.stun;
    if (this.state === 'inside' || this.state === 'enterTent' || this.state === 'exitTent') {
      // bolt out of the tent through its opening
      this.vel.set(0, 0, 0);
    }
    this.setState('stunned');
  }

  scareNoise() {
    if (!this.active || this.isBoss) return;
    if (this.state === 'stunned') return;
    this.scared(true);
  }

  // ─── main update ───────────────────────────────────────
  update(dt: number, t: number) {
    if (this.removed) return;
    this.stateTime += dt;
    this.slow = Math.max(0, this.slow - dt);
    this.glow = Math.max(0, this.glow - dt);
    this.rally = Math.max(0, this.rally - dt);
    this.fearCooldown = Math.max(0, this.fearCooldown - dt);
    this.voiceT -= dt;
    const w = this.w;
    const distPlayer = Math.hypot(this.pos.x - w.playerPos.x, this.pos.z - w.playerPos.z);

    // knockback integration
    if (this.vel.lengthSq() > 0.0001) {
      this.pos.addScaledVector(this.vel, dt);
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
    }

    // flashlight reaction
    const inBeam = w.isInBeam(this.model.headPivot.getWorldPosition(tmp));
    this.beamTime = inBeam ? this.beamTime + dt : Math.max(0, this.beamTime - dt * 2);
    this.eyeBoost += ((inBeam || w.isLit(this.pos) ? 1 : 0) - this.eyeBoost) * Math.min(1, dt * 8);
    if (inBeam && !this.frozeOnce && this.beamTime > 0.12 && ['enter', 'lurk', 'sneak', 'approach', 'investigate'].includes(this.state) && !this.isBoss && this.def.id !== 'tank') {
      this.frozeOnce = true;
      this.setState('frozen');
      this.say('chitter2', 0.5);
    }
    if (this.def.id === 'scout' && this.beamTime > 0.9 && ['sneak', 'approach', 'lurk', 'peek'].includes(this.state) && this.fearCooldown <= 0) {
      this.scared(false);
    }

    // fear of the kid
    // every scare makes them bolder — they won't be shooed forever
    const fearR = this.def.fear * (this.scares >= 4 ? 0 : this.scares >= 2 ? 0.55 : 1);
    const fearless = fearR === 0 || this.rally > 0;
    if (!fearless && !w.playerInTent && distPlayer < fearR && this.fearCooldown <= 0 &&
      ['approach', 'sneak', 'steal', 'investigate', 'attack', 'peek', 'distract'].includes(this.state)) {
      this.scared(true);
    }

    // lures (decoy rounds / hot dogs)
    if (!this.carrying && !this.isBoss && ['enter', 'lurk', 'sneak', 'approach', 'retreat', 'investigate', 'distract'].includes(this.state) && this.lure === null) {
      for (const l of w.lures) {
        if (l.time > 0 && l.pos.distanceTo(this.pos) < l.radius) {
          this.lure = l;
          this.target.copy(l.pos).add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(0.7));
          this.lanternTarget = null;
          this.setState('investigate');
          break;
        }
      }
    }

    // boss commands
    if (this.isBoss && this.active && this.state !== 'bossIntro') {
      this.commandT -= dt;
      if (this.commandT <= 0) {
        this.commandT = 9;
        this.say('roar', 1.2);
        w.onBossCommand(this);
        for (const o of w.raccoons) if (o !== this && o.active && o.pos.distanceTo(this.pos) < 30) { o.rally = 5; o.voiceT = Math.random() * 0.6; }
      }
    }

    let stand = 0, reach = 0, sniff = 0, tailUp = 0, crouch = 0;
    let lookAtPlayer = false;

    switch (this.state) {
      case 'enter': {
        if (this.stateTime < 0.05) {
          const lurk = this.nearestCover(this.dirFromCamp(this.side, 14), 6, 10) ?? this.dirFromCamp(this.side, 13);
          this.target.copy(lurk);
        }
        if (this.moveToward(this.target, this.walk() * 1.3, dt)) this.setState('lurk');
        break;
      }
      case 'lurk': {
        lookAtPlayer = true;
        stand = this.def.id === 'scout' || Math.sin(this.stateTime * 1.3 + this.id) > 0.4 ? 1 : 0;
        const wait = this.def.id === 'scout' ? 3.2 : this.def.id === 'tank' ? 0.8 : 1.6;
        if (this.stateTime > wait + (this.id % 3) * 0.4) this.choosePlan();
        break;
      }
      case 'frozen': {
        stand = 1;
        lookAtPlayer = true;
        if (this.stateTime > w.loadout.freezeTime) {
          if (this.def.id === 'scout') this.scared(false);
          else this.setState(this.plan === 'cooler' ? 'approach' : 'sneak');
        }
        break;
      }
      case 'investigate': {
        if (this.lure && this.lure.time <= 0) { this.lure = null; this.choosePlan(); break; }
        const arrived = this.moveToward(this.target, this.walk(), dt);
        if (arrived) {
          sniff = 1;
          this.speed = 0;
          if (this.lure) {
            this.faceToward(this.lure.pos, dt);
            if (Math.random() < dt * 1.2) audio.play('eat', { pos: this.pos, vol: 0.4, muffle: true });
          } else if (this.lanternTarget) {
            stand = this.stateTime % 2 > 1 ? 1 : 0;
            reach = stand;
            if (this.stateTime > 3.2 && this.lanternTarget.on) {
              this.lanternTarget.on = false;
              audio.play('can', { pos: this.lanternTarget.pos, vol: 0.6, rate: 1.4 });
              w.hint('lantern-out', 'They knocked out the lantern.');
            }
            if (this.stateTime > 4) { this.lanternTarget = null; this.choosePlan(); }
          } else if (this.stateTime > 2.5) this.choosePlan();
        }
        break;
      }
      case 'sneak': {
        crouch = 1;
        const wp = this.waypoints[0];
        if (wp) {
          if (this.moveToward(wp, this.walk() * 0.9, dt)) {
            // pause behind cover
            if (this.stateTime > 1.2) { this.waypoints.shift(); this.stateTime = 0; }
            else { this.speed = 0; lookAtPlayer = true; }
          } else this.stateTime = 0;
        } else {
          if (this.plan === 'tent' && this.def.id === 'scout' && this.opening) {
            if (this.moveToward(this.target, this.walk(), dt)) this.setState('peek');
          } else if (this.plan === 'roof') {
            if (this.moveToward(this.target, this.run(), dt)) this.startClimb();
          } else if (this.plan === 'tent') {
            if (this.moveToward(this.target, this.walk() * 1.1, dt, false)) this.arriveOpening();
          } else this.setState('approach');
        }
        break;
      }
      case 'peek': {
        // two glowing eyes, right outside the mesh
        stand = 1;
        lookAtPlayer = true;
        if (this.opening) this.faceToward(this.opening.center, dt);
        this.eyeBoost = Math.max(this.eyeBoost, 0.8);
        if (this.stateTime < 0.1) { this.say('chitter2', 0.5); w.hint('peek', 'Something is looking in at you…'); }
        if (this.stateTime > 2.8) { this.plan = 'cooler'; this.target.copy(this.coolerSpot()); this.setState('approach'); }
        break;
      }
      case 'approach': {
        if (this.dropTarget) {
          if (!w.drops.includes(this.dropTarget)) { this.dropTarget = null; this.choosePlan(); break; }
          if (this.moveToward(this.dropTarget.pos, this.run(), dt)) {
            const d = this.dropTarget;
            this.carrying = d.kind;
            this.carryAmount = d.amount;
            w.drops.splice(w.drops.indexOf(d), 1);
            d.mesh.removeFromParent();
            this.attachLoot();
            this.dropTarget = null;
            this.beginRetreatWithLoot();
            audio.play('crinkle', { pos: this.pos, vol: 0.6, muffle: true });
          }
          break;
        }
        if (this.plan === 'distract') {
          if (this.moveToward(this.target, this.run(), dt)) this.setState('distract');
          break;
        }
        if (this.plan === 'tent') {
          if (this.moveToward(this.target, this.run(), dt, false)) this.arriveOpening();
          break;
        }
        // cooler
        if (this.stateTime < 0.05 || this.stateTime % 1.5 < dt) this.target.copy(this.coolerSpot());
        const sp = this.def.id === 'tank' || this.def.id === 'boss' || this.def.id === 'visitor' ? this.walk() * 1.15 : this.run() * 0.8;
        if (this.def.id === 'tank' && this.voiceT < 0) { this.voiceT = 3; this.say('growl', 0.8); }
        if (this.moveToward(this.target, sp, dt)) this.setState('steal');
        // fearless brutes charge a kid who stands too close
        if ((this.def.id === 'tank' || this.isBoss) && !w.playerInTent && distPlayer < 2.3 && this.fearCooldown <= 0) this.setState('charge');
        break;
      }
      case 'charge': {
        tailUp = 1;
        if (this.stateTime < 0.05) this.say(this.isBoss ? 'roar' : 'growl', 1);
        if (this.stateTime < 0.5) { this.faceToward(w.playerPos, dt); stand = 0.6; this.speed = 0; break; }
        const hitP = this.moveToward(w.playerPos, this.run() * 1.4, dt, true);
        if (hitP || distPlayer < 0.7) {
          w.addNerve(this.isBoss ? 30 : 22);
          audio.play('thump', { vol: 1 });
          this.fearCooldown = 6;
          const away = new THREE.Vector3(this.pos.x - w.playerPos.x, 0, this.pos.z - w.playerPos.z).normalize();
          this.target.copy(this.pos).addScaledVector(away, 3);
          this.setState('retreat');
        } else if (this.stateTime > 3 || w.playerInTent) this.setState('approach');
        break;
      }
      case 'distract': {
        // bang the can, rattle the chairs — look over HERE
        stand = this.stateTime % 1.2 < 0.6 ? 1 : 0.3;
        reach = stand;
        if (this.stateTime % 1.2 < dt) {
          audio.play('can', { pos: this.pos, vol: 1.1, jitter: 0.15 });
          if (Math.random() < 0.5) this.say('chitter3', 0.9);
          this.w.camp.chairs.forEach((c, i) => {
            if (c.position.distanceTo(this.pos) < 3 && !this.w.camp.chairTip[i]) {
              this.w.camp.chairTip[i] = 1;
              audio.play('thunk', { pos: c.position, vol: 0.9 });
            }
          });
        }
        if (this.model.extra) this.model.extra.rotation.x = Math.sin(t * 20) * 0.6 * stand;
        if (this.stateTime > 22) { this.plan = 'cooler'; this.target.copy(this.coolerSpot()); this.setState('approach'); this.raids++; }
        break;
      }
      case 'steal': {
        const c = w.cooler;
        this.faceToward(c.pos, dt);
        reach = 1;
        stand = 0.35;
        if (this.isBoss) {
          // Big Earl just sits in the cooler and eats
          c.lidTarget = 1;
          stand = 0.5;
          sniff = 0.5;
          if (this.voiceT < 0) { this.voiceT = 1.1; audio.play('eat', { pos: c.pos, vol: 0.9 }); audio.play('crinkle', { pos: c.pos, vol: 0.7 }); }
          const amt = 3.0 * dt;
          w.onFoodStolen(this, amt);
          c.shake = 1;
          if (!w.playerInTent && distPlayer < 2.3 && this.fearCooldown <= 0) this.setState('charge');
          break;
        }
        if (c.lidOpen < 0.6) {
          const mul = c.strap > 0 ? (this.def.id === 'tank' ? 1.5 : w.loadout.bungeeMul) : 1;
          if (this.stateTime < 0.05) audio.play('scratch', { pos: c.pos, vol: 0.7, muffle: true });
          this.progress += dt / (this.def.openTime * mul);
          c.shake = 0.6;
          if (Math.random() < dt * 2) audio.play('scratch', { pos: c.pos, vol: 0.6, muffle: true });
          if (this.progress >= 1) {
            c.lidTarget = 1;
            if (c.strap > 0) { c.strap = 0; audio.play('tear', { pos: c.pos, vol: 0.6 }); }
            audio.play('lid', { pos: c.pos, vol: 0.9 });
            this.progress = 0;
            this.stateTime = 0.0001;
          }
        } else {
          sniff = 1;
          this.progress += dt;
          if (this.progress > 0.05 && this.progress - dt <= 0.05) audio.play('crinkle', { pos: c.pos, vol: 0.9 });
          if (this.progress > 0.7) {
            const amt = Math.min(c.food, this.def.steal);
            if (amt <= 0) { this.scared(false); break; }
            w.onFoodStolen(this, amt);
            this.carrying = this.def.loot;
            this.carryAmount = amt;
            this.raids++;
            this.attachLoot();
            this.beginRetreatWithLoot();
          }
        }
        break;
      }
      case 'retreat': {
        tailUp = this.carrying ? 0.3 : 1;
        if (this.carrying) {
          const dragging = this.carrying === 'chips' || this.def.id === 'tank';
          const sp = dragging ? this.walk() * 1.35 : this.run() * 0.7;
          const backwards = this.carrying === 'chips';
          const done = this.moveToward(this.target, sp, dt, true, !backwards);
          if (backwards) this.faceToward(new THREE.Vector3(w.cooler.pos.x, 0, w.cooler.pos.z), dt);
          if (this.stepT <= 0 && dragging) { this.stepT = 0.5; audio.play('crinkle', { pos: this.pos, vol: 0.45, muffle: true }); }
          if (done || Math.hypot(this.pos.x, this.pos.z) > LAYOUT.exitR) {
            w.onLootEscaped(this);
            this.detachLoot();
            this.carrying = null;
            if (this.raids >= this.def.maxRaids) { this.setState('gone'); this.leave(); }
            else { this.returnDelay = 3 + Math.random() * 4; this.setState('gone'); }
          }
        } else {
          if (this.moveToward(this.target, this.run(), dt)) this.setState('lurk');
        }
        break;
      }
      case 'stunned': {
        this.stun -= dt;
        this.speed = 0;
        if (this.airborne <= 0 && this.stun <= 0) {
          if (this.resolve <= 0) {
            this.setState('escape');
            this.deterred = true;
            w.onDeterred(this);
            this.say('yelp', 1);
            const away = new THREE.Vector3(this.pos.x - LAYOUT.bounds.x, 0, this.pos.z - LAYOUT.bounds.z).normalize();
            this.target.copy(away.multiplyScalar(34));
          } else if (this.isBoss) {
            const away = new THREE.Vector3(this.pos.x - w.cooler.pos.x, 0, this.pos.z - w.cooler.pos.z).normalize();
            this.target.copy(w.cooler.pos).addScaledVector(away, 7).setY(0);
            this.setState('retreat');
          } else this.scared(false);
        }
        break;
      }
      case 'escape': {
        tailUp = 1;
        if (this.stateTime > 9) { this.leave(); break; }
        if (this.moveToward(this.target, this.run() * 1.15, dt)) this.leave();
        if (Math.hypot(this.pos.x, this.pos.z) > 33) this.leave();
        break;
      }
      case 'climb': {
        // hop up onto the tent
        this.speed = 0;
        stand = 0.4;
        break;
      }
      case 'roof': {
        // thump around on top — the roof sags right over your head
        const tent = w.tent;
        tent.dent.copy(this.pos);
        tent.dentStrength += (1 - tent.dentStrength) * Math.min(1, dt * 5);
        this.pos.y = 1.62 - 0.12;
        const wander = Math.sin(this.stateTime * 1.7) * 0.25;
        this.pos.x = this.roofSpot.x + wander;
        this.pos.z = this.roofSpot.z + Math.cos(this.stateTime * 1.3) * 0.2;
        this.speed = 0.6;
        if (this.stateTime % 0.8 < dt) { audio.play('thump', { pos: this.pos, vol: 0.8 }); tent.roofWobbleV += 1.5; }
        if (this.stateTime % 1.6 < dt) audio.play('scratch', { pos: this.pos, vol: 0.6 });
        if (this.stateTime < 0.05) w.hint('roof', 'Something is ON the tent. Shoot up through the roof!');
        const stay = 5 / w.loadout.tearMul + 1.5;
        if (this.stateTime > stay) {
          tent.dentStrength = 0;
          // drop down at a window
          const op = this.opening ?? this.pickOpening();
          this.opening = op;
          this.airFrom.copy(this.pos);
          this.airTo.copy(op.center).setY(0).addScaledVector(op.normal, 0.5);
          this.airborne = 0.45;
          this.setState('climb');
          this.plan = 'tent';
        }
        break;
      }
      case 'enterTent': {
        // squeeze through the opening
        if (!this.opening) { this.scared(false); break; }
        const inside = this.opening.center.clone().setY(0).addScaledVector(this.opening.normal, -0.75);
        if (this.moveToward(inside, this.walk(), dt, false)) {
          this.setState('inside');
          this.say('chitter3', 0.9);
        }
        break;
      }
      case 'inside': {
        sniff = 1;
        lookAtPlayer = this.stateTime % 3 > 1.5;
        this.speed = 0.3;
        if (Math.random() < dt * 2) audio.play(Math.random() < 0.5 ? 'crinkle' : 'swish', { pos: this.pos, vol: 0.7 });
        if (this.voiceT < 0) { this.voiceT = 1.5 + Math.random(); this.say(undefined, 0.9); }
        if (w.playerInTent) w.addNerve(dt * (distPlayer < 1.3 ? 10 : 6.5));
        if (this.stateTime > 5.5) {
          // made off with your trail mix
          const amt = Math.min(w.cooler.food, 4);
          w.onFoodStolen(this, amt);
          this.carrying = 'marshmallows';
          this.carryAmount = amt;
          this.raids++;
          this.attachLoot();
          this.setState('exitTent');
        }
        break;
      }
      case 'exitTent': {
        if (!this.opening) { this.beginRetreatWithLoot(); break; }
        const out = this.opening.center.clone().setY(0).addScaledVector(this.opening.normal, 0.9);
        if (this.moveToward(out, this.run(), dt, false)) {
          if (this.opening.occupant === this) this.opening.occupant = null;
          if (this.carrying) this.beginRetreatWithLoot();
          else this.scared(false);
        }
        break;
      }
      case 'attack': {
        // scratching at zipped mesh
        const op = this.opening!;
        this.faceToward(op.center, dt);
        reach = 1;
        stand = op.isDoor ? 0.6 : 1;
        if (op.state !== 'mesh') { this.setState('enterTent'); break; }
        if (this.radioNear(this.pos) && this.stateTime > 0.6) { this.scared(false); break; }
        const tearTime = (this.def.id === 'sneak' ? 6 : 7.5) * w.loadout.tearMul * (this.def.id === 'acrobat' ? 0.75 : 1);
        op.tear += dt / tearTime;
        op.occupant = this;
        if (this.stateTime % 0.55 < dt) { audio.play('scratch', { pos: op.center, vol: 0.9 }); w.tent.impact(op.center, 0.3); }
        if (this.stateTime < 0.05) w.hint('scratch', `Something is clawing at the ${op.label}!`);
        if (op.tear >= 1) {
          w.tent.setState(op, 'torn');
          audio.play('tear', { pos: op.center, vol: 1 });
          w.onBreach(this, op);
          this.setState('enterTent');
        }
        break;
      }
      case 'bossIntro': {
        stand = 1;
        lookAtPlayer = true;
        this.eyeBoost = 1;
        if (this.stateTime < 0.05) { audio.play('bossSting', { vol: 1 }); }
        if (this.stateTime > 0.6 && this.stateTime - dt <= 0.6) this.say('roar', 1.3);
        if (this.stateTime > 3) { this.plan = 'cooler'; this.setState('approach'); }
        break;
      }
      case 'gone': {
        this.speed = 0;
        if (this.returnDelay > 0) {
          this.returnDelay -= dt;
          this.model.root.visible = false;
          if (this.returnDelay <= 0) {
            // comes back for more, from a new direction
            this.side += (Math.random() - 0.5) * 2.4;
            this.spawnAt(this.dirFromCamp(this.side, 26));
            this.model.root.visible = true;
            this.resolve = Math.max(this.resolve, 1);
            this.frozeOnce = false;
            this.investigated = false;
            this.setState('enter');
            this.say(undefined, 0.6);
          }
        }
        break;
      }
    }

    // airborne hop (climb / tumble)
    if (this.airborne > 0) {
      this.airborne -= dt;
      const k = 1 - Math.max(0, this.airborne) / 0.45;
      this.pos.lerpVectors(this.airFrom, this.airTo, k);
      this.pos.y += Math.sin(k * Math.PI) * 0.8;
      if (this.airborne <= 0) {
        this.pos.copy(this.airTo);
        audio.play('thump', { pos: this.pos, vol: 0.6 });
        if (this.state === 'climb') {
          if (this.pos.y > 1) { this.setState('roof'); this.roofSpot.copy(this.pos); }
          else this.arriveOpening();
        }
      }
    } else if (this.state !== 'roof') {
      this.pos.y = 0;
    }

    // keep out of the tent unless entering
    if (!['enterTent', 'inside', 'exitTent', 'roof', 'climb'].includes(this.state) && this.airborne <= 0) {
      const ax = Math.abs(this.pos.x), az = Math.abs(this.pos.z);
      const H = LAYOUT.tentHalf + 0.18;
      if (ax < H && az < H) {
        if (H - ax < H - az) this.pos.x = Math.sign(this.pos.x || 1) * H;
        else this.pos.z = Math.sign(this.pos.z || 1) * H;
      }
    }

    // footsteps & chatter
    this.stepT -= dt;
    if (this.speed > 0.5 && this.stepT <= 0 && this.model.root.visible) {
      this.stepT = 0.36 / Math.min(2, this.speed * 0.5 + 0.3);
      audio.play('step', { pos: this.pos, vol: 0.18 * this.def.scale, muffle: true, jitter: 0.2 });
    }
    if (this.voiceT <= 0 && this.active && this.state !== 'gone') {
      this.voiceT = this.def.id === 'scout' ? 2.5 + Math.random() * 3 : 3.5 + Math.random() * 5;
      if (this.rally > 0) this.voiceT *= 0.5;
      this.say(undefined, this.state === 'sneak' ? 0.35 : 0.65);
    }

    // apply to model
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.heading;
    let lookYaw = 0, lookPitch = 0;
    if (lookAtPlayer || this.state === 'frozen') {
      const toP = Math.atan2(w.playerPos.x - this.pos.x, w.playerPos.z - this.pos.z);
      let d = toP - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      lookYaw = THREE.MathUtils.clamp(d, -1.1, 1.1);
      lookPitch = -0.15;
    }
    const isStun = this.state === 'stunned' ? 1 : 0;
    m.animate(dt, t, { speed: this.speed, stand, reach, stun: isStun, tailUp, sniff, lookYaw, lookPitch, crouch });
    this.speed *= 0.8;

    // eyeshine: faint when facing you, blazing when lit
    const toCam = tmp.set(w.playerPos.x - this.pos.x, 0, w.playerPos.z - this.pos.z).normalize();
    const face = Math.max(0, Math.sin(this.heading + m.look.x) * toCam.x + Math.cos(this.heading + m.look.x) * toCam.z);
    let eye = (0.12 + face * 0.3) + this.eyeBoost * 0.65 * (0.4 + face * 0.6);
    if (this.state === 'escape' || this.state === 'stunned') eye *= 0.25;
    if (this.state === 'inside' && w.playerInTent) eye = 0.9;
    m.setEyes(Math.min(1, eye), isStun);
    // glow paint / sticky goo
    const e = m.mat.emissive;
    if (this.glow > 0) { e.setHex(0x5cff2a); m.mat.emissiveIntensity = 0.35 + Math.sin(t * 6) * 0.1; }
    else if (this.slow > 0) { e.setHex(0x6a1aa8); m.mat.emissiveIntensity = 0.25; }
    else if (this.rally > 0 && !this.isBoss) { e.setHex(0x401000); m.mat.emissiveIntensity = 0.5; }
    else m.mat.emissiveIntensity = 0;
    if (this.lootMesh && this.carrying) {
      // dragging the chips bag behind (or in front, walking backwards)
      this.lootMesh.rotation.z = Math.sin(t * 8) * 0.1;
    }
  }

  private arriveOpening() {
    const op = this.opening;
    if (!op) { this.choosePlan(); return; }
    if (op.occupant && op.occupant !== this && (op.occupant as Raccoon).active) {
      this.plan = 'cooler';
      this.target.copy(this.coolerSpot());
      this.setState('approach');
      return;
    }
    op.occupant = this;
    if (op.state === 'mesh') this.setState('attack');
    else this.setState('enterTent');
  }

  private startClimb() {
    this.airFrom.copy(this.pos);
    const peakOff = new THREE.Vector3(this.pos.x, 0, this.pos.z).normalize().multiplyScalar(0.35);
    this.airTo.set(peakOff.x, 1.5, peakOff.z);
    this.airborne = 0.45;
    this.setState('climb');
    this.say('chitter2', 0.8);
    audio.play('swish', { pos: this.pos, vol: 0.8 });
  }

  private beginRetreatWithLoot() {
    if (this.opening && this.opening.occupant === this) this.opening.occupant = null;
    const away = new THREE.Vector3(this.pos.x - LAYOUT.bounds.x, 0, this.pos.z - LAYOUT.bounds.z);
    if (away.lengthSq() < 0.01) away.set(Math.sin(this.side), 0, -Math.cos(this.side));
    away.normalize();
    this.target.copy(away.multiplyScalar(LAYOUT.exitR + 1));
    this.setState('retreat');
    if (this.carrying === 'chips') this.w.hint('chips', 'It’s dragging off the CHIPS — tag it before it reaches the trees!');
  }

  attachLoot() {
    this.detachLoot();
    if (!this.carrying) return;
    const mesh = makeLoot(this.carrying);
    if (this.carrying === 'chips') {
      mesh.scale.setScalar(1.1 / this.def.scale);
      mesh.position.set(0, -0.12, 0.14);
      mesh.rotation.x = 1.2;
    } else {
      mesh.scale.setScalar(0.8 / this.def.scale);
      mesh.position.set(0, -0.02, 0.06);
    }
    this.model.mouth.add(mesh);
    this.lootMesh = mesh;
  }

  detachLoot() {
    if (this.lootMesh) { this.lootMesh.removeFromParent(); this.lootMesh = null; }
  }

  leave() {
    if (this.opening && this.opening.occupant === this) this.opening.occupant = null;
    this.removed = true;
    this.state = 'gone';
    this.model.root.removeFromParent();
    this.model.dispose();
  }
}
