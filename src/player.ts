import * as THREE from 'three';
import { LAYOUT } from './config';
import { Tent } from './world/tent';
import { Campsite } from './world/campsite';
import { Loadout } from './save';

export class Player {
  pos = new THREE.Vector3(0, 0, 0.3); // feet
  yaw = 0;
  pitch = -0.04;
  eye = 0.95;
  camera: THREE.PerspectiveCamera;
  flashlight: THREE.SpotLight;
  flashOn = false;
  battery = 70;
  inTent = true;
  moving = 0;
  bob = 0;
  recoil = 0;
  boundsHit = 0;
  private flicker = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(72, aspect, 0.03, 260);
    this.camera.rotation.order = 'YXZ';
    this.flashlight = new THREE.SpotLight(0xfff0d0, 0, 20, 0.4, 0.5, 1.15);
    this.flashlight.position.set(0.12, -0.1, 0);
    this.flashlight.target.position.set(0.05, -0.12, -5);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlight.target);
  }

  reset(L: Loadout) {
    this.pos.set(0.15, 0, 0.35);
    this.yaw = 0.12;
    this.pitch = -0.05;
    this.eye = 0.95;
    this.flashOn = false;
    this.battery = L.battery;
    this.inTent = true;
    this.recoil = 0;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  get eyePos() { return this.camera.position; }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0024;
    this.pitch -= dy * 0.0024;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.35, 1.35);
  }

  update(dt: number, move: THREE.Vector2, tent: Tent, camp: Campsite, L: Loadout) {
    const speed = this.inTent ? 1.5 : 3.1;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const d = new THREE.Vector3().addScaledVector(right, move.x).addScaledVector(fwd, move.y).multiplyScalar(speed * dt);
    this.moving = move.length();
    const tryMove = (delta: THREE.Vector3) => {
      const next = this.pos.clone().add(delta);
      if (!tent.canPass(this.pos, next, 0.5, false)) return false;
      this.pos.copy(next);
      return true;
    };
    if (d.lengthSq() > 0) {
      if (!tryMove(d)) {
        // slide along the wall
        if (!tryMove(new THREE.Vector3(d.x, 0, 0))) tryMove(new THREE.Vector3(0, 0, d.z));
      }
    }
    this.inTent = Math.abs(this.pos.x) < LAYOUT.tentHalf && Math.abs(this.pos.z) < LAYOUT.tentHalf;
    // door corridor: within the doorway of an unzipped front/back door
    const doorOpen = (z: number) => {
      const op = tent.openings.find((o) => o.id === (z < 0 ? 'front' : 'rear'))!;
      return op.state !== 'mesh';
    };
    const inCorridor = Math.abs(this.pos.x) < 0.45 && doorOpen(this.pos.z);
    if (this.inTent) {
      const lim = LAYOUT.tentHalf - 0.22;
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim, lim);
      if (!inCorridor) this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim, lim);
    } else {
      // keep outside the tent walls (when not passing a door)
      const H = LAYOUT.tentHalf + 0.2;
      const ax = Math.abs(this.pos.x), az = Math.abs(this.pos.z);
      if (ax < H && az < H && !(inCorridor && az > ax)) {
        if (H - ax < H - az) this.pos.x = Math.sign(this.pos.x) * H; else this.pos.z = Math.sign(this.pos.z) * H;
      }
      for (const c of camp.circles) {
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const dd = Math.hypot(dx, dz), rr = c.r + 0.3;
        if (dd < rr && dd > 1e-4) { this.pos.x = c.x + (dx / dd) * rr; this.pos.z = c.z + (dz / dd) * rr; }
      }
      const b = LAYOUT.bounds;
      const bx = this.pos.x - b.x, bz = this.pos.z - b.z;
      const bd = Math.hypot(bx, bz);
      if (bd > b.r) {
        this.pos.x = b.x + (bx / bd) * b.r;
        this.pos.z = b.z + (bz / bd) * b.r;
        this.boundsHit += dt;
      }
    }
    const targetEye = this.inTent ? 0.95 : 1.38;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 6);
    this.bob += dt * this.moving * (this.inTent ? 6 : 10);
    const bobY = Math.sin(this.bob) * 0.025 * Math.min(1, this.moving);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.camera.position.set(this.pos.x, this.eye + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch + this.recoil * 0.035, this.yaw, Math.sin(this.bob * 0.5) * 0.006 * this.moving);

    // flashlight
    const f = this.flashlight;
    f.distance = L.beamRange;
    f.angle = L.beamAngle;
    if (this.flashOn) {
      this.battery = Math.max(0, this.battery - dt);
      if (this.battery <= 0) this.flashOn = false;
    }
    let intensity = this.flashOn ? 26 : 0;
    if (this.flashOn && this.battery < 12) {
      this.flicker -= dt;
      if (this.flicker <= 0) this.flicker = Math.random() * 0.3;
      if (this.flicker < 0.06) intensity *= 0.15;
      intensity *= 0.5 + this.battery / 24;
    }
    f.intensity += (intensity - f.intensity) * Math.min(1, dt * 30);
  }

  isInBeam(p: THREE.Vector3, L: Loadout): boolean {
    if (!this.flashOn || this.flashlight.intensity < 3) return false;
    const to = p.clone().sub(this.camera.position);
    const d = to.length();
    if (d > L.beamRange || d < 0.01) return false;
    const fwd = this.forward();
    return to.dot(fwd) / d > Math.cos(L.beamAngle * 0.9);
  }
}
