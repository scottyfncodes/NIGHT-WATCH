import * as THREE from 'three';
import { splatTexture, glowTexture } from './textures';

/** Ring-buffered instanced paint decals on world surfaces. */
export class Splats {
  mesh: THREE.InstancedMesh;
  private i = 0;
  private count = 260;
  private q = new THREE.Quaternion();
  private m = new THREE.Matrix4();
  private z = new THREE.Vector3(0, 0, 1);
  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({
      map: splatTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
      alphaTest: 0.1,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < this.count; k++) { this.mesh.setMatrixAt(k, zero); this.mesh.setColorAt(k, new THREE.Color(0xffffff)); }
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  add(p: THREE.Vector3, n: THREE.Vector3, color: number, size = 0.32) {
    this.q.setFromUnitVectors(this.z, n.clone().normalize());
    const spin = new THREE.Quaternion().setFromAxisAngle(this.z, Math.random() * Math.PI * 2);
    this.q.multiply(spin);
    const s = size * (0.75 + Math.random() * 0.5);
    this.m.compose(p.clone().addScaledVector(n, 0.012), this.q, new THREE.Vector3(s, s, s));
    this.mesh.setMatrixAt(this.i, this.m);
    // paint reads vivid at night: slightly boosted colour
    const c = new THREE.Color(color).multiplyScalar(0.85);
    this.mesh.setColorAt(this.i, c);
    this.i = (this.i + 1) % this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < this.count; k++) this.mesh.setMatrixAt(k, zero);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Paint droplets / crumbs / sparks. */
export class Particles {
  points: THREE.Points;
  private n = 400;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private i = 0;
  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.n * 3);
    this.col = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.life = new Float32Array(this.n);
    for (let k = 0; k < this.n; k++) this.pos[k * 3 + 1] = -100;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, map: glowTexture(), transparent: true, depthWrite: false, alphaTest: 0.05 }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  burst(p: THREE.Vector3, n: THREE.Vector3, color: number, count = 14, speed = 3) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const j = this.i;
      this.i = (this.i + 1) % this.n;
      this.pos[j * 3] = p.x; this.pos[j * 3 + 1] = p.y; this.pos[j * 3 + 2] = p.z;
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2).add(n).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.vel[j * 3] = v.x; this.vel[j * 3 + 1] = v.y + 1; this.vel[j * 3 + 2] = v.z;
      this.col[j * 3] = c.r; this.col[j * 3 + 1] = c.g; this.col[j * 3 + 2] = c.b;
      this.life[j] = 0.5 + Math.random() * 0.5;
    }
  }
  update(dt: number) {
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      this.vel[k * 3 + 1] -= 9.8 * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      if (this.pos[k * 3 + 1] < 0.01) { this.pos[k * 3 + 1] = 0.01; this.vel[k * 3] *= 0.3; this.vel[k * 3 + 2] *= 0.3; this.vel[k * 3 + 1] = 0; }
      if (this.life[k] <= 0) this.pos[k * 3 + 1] = -100;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Cosmetic eye pairs between the pines — the "they're all out there" moment. */
export class WatcherEyes {
  group = new THREE.Group();
  pairs: { g: THREE.Group; t0: number; life: number; mat: THREE.SpriteMaterial }[] = [];
  private tex = glowTexture();
  constructor(scene: THREE.Scene) { scene.add(this.group); }
  spawn(count: number, t: number, center = 0, spread = Math.PI * 2) {
    for (let k = 0; k < count; k++) {
      const a = center + (Math.random() - 0.5) * spread;
      const d = 14 + Math.random() * 12;
      const g = new THREE.Group();
      const mat = new THREE.SpriteMaterial({ map: this.tex, color: 0xd8ff6a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 });
      for (const s of [-1, 1]) {
        const e = new THREE.Sprite(mat);
        e.position.set(s * 0.055, 0, 0);
        e.scale.set(0.13, 0.13, 1);
        g.add(e);
      }
      g.position.set(Math.sin(a) * d + 0.4, 0.35 + Math.random() * 0.5, -Math.cos(a) * d - 2);
      g.lookAt(0, g.position.y, 0);
      this.group.add(g);
      this.pairs.push({ g, t0: t + k * 0.12 + Math.random() * 0.4, life: 4 + Math.random() * 3, mat });
    }
  }
  update(t: number) {
    for (let i = this.pairs.length - 1; i >= 0; i--) {
      const p = this.pairs[i];
      const age = t - p.t0;
      if (age < 0) continue;
      const blink = Math.sin(age * 3 + i) > 0.97 ? 0 : 1;
      p.mat.opacity = Math.min(1, age * 2) * Math.min(1, (p.life - age) * 1.5) * blink * 0.85;
      if (age > p.life) { p.g.removeFromParent(); p.mat.dispose(); this.pairs.splice(i, 1); }
    }
  }
  clear() { for (const p of this.pairs) { p.g.removeFromParent(); p.mat.dispose(); } this.pairs = []; }
}
