import * as THREE from 'three';
import { Loadout } from './save';

export class Player {
  pos = new THREE.Vector3(0, 0, 0.1); // feet (fixed)
  yaw = 0;
  pitch = -0.04;
  eye = 0.95;
  camera: THREE.PerspectiveCamera;
  flashlight: THREE.SpotLight;
  flashOn = false;
  battery = 70;
  inTent = true;
  moving = 0;
  recoil = 0;
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
    this.pos.copy(Player.POST);
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

  /** The kid holds their post in the middle of the tent: aim and shoot, no walking around. */
  static readonly POST = new THREE.Vector3(0, 0, 0.1);

  update(dt: number, L: Loadout) {
    this.pos.copy(Player.POST);
    this.moving = 0;
    this.inTent = true;
    this.eye = 0.95;
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.camera.position.set(this.pos.x, this.eye, this.pos.z);
    this.camera.rotation.set(this.pitch + this.recoil * 0.035, this.yaw, 0);

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
