import * as THREE from 'three';
import { Loadout } from './save';
import { PostDef, POSTS } from './config';

export class Player {
  pos = new THREE.Vector3(0, 0, 0.1); // feet
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

  /** Where the kid is holding the line tonight. */
  post: PostDef = POSTS.tent;

  reset(L: Loadout, post: PostDef = POSTS.tent) {
    this.post = post;
    this.pos.set(...post.pos);
    this.yaw = post.yaw;
    this.pitch = post.pos[1] > 1.5 ? -0.28 : -0.05;
    this.eye = post.eye;
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

  /** The kid holds their post: aim and shoot, no walking around. */
  update(dt: number, L: Loadout) {
    this.pos.set(...this.post.pos);
    this.moving = 0;
    this.inTent = this.post.inTent;
    this.eye = this.post.eye;
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.camera.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
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
