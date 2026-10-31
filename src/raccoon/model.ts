import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Archetype } from '../config';
import { rng, glowTexture } from '../textures';

function colored(geo: THREE.BufferGeometry, color: number | ((p: THREE.Vector3) => number), jitter = 0.12, seed = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const r = rng(seed);
  const c = new THREE.Color();
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i);
    c.setHex(typeof color === 'number' ? color : color(p));
    const k = 1 + (r() - 0.5) * jitter * 2;
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const merge = (gs: THREE.BufferGeometry[]) => {
  const m = mergeGeometries(gs)!;
  m.computeVertexNormals();
  return m;
};

interface Geos { torso: THREE.BufferGeometry; head: THREE.BufferGeometry; legF: THREE.BufferGeometry; legB: THREE.BufferGeometry; tail: THREE.BufferGeometry }
const cache = new Map<string, Geos>();
let glowTex: THREE.Texture | null = null;

function buildGeos(a: Archetype): Geos {
  const key = a.id;
  const hit = cache.get(key);
  if (hit) return hit;
  const lanky = a.id === 'acrobat' ? 1.18 : 1;
  const bulk = a.id === 'tank' || a.id === 'boss' ? 1.18 : 1;
  // torso (hip origin at 0,0,0 → children offset so hips are pivot)
  const hind = new THREE.SphereGeometry(0.22, 14, 10);
  hind.scale(1.05 * bulk, 0.95, 1.18);
  hind.translate(0, 0.04, -0.02);
  const chest = new THREE.SphereGeometry(0.17, 12, 9);
  chest.scale(1 * bulk, 0.95, 1.1);
  chest.translate(0, -0.03, 0.24);
  const furFn = (p: THREE.Vector3) => (p.y < -0.1 ? a.furB : a.furA);
  const torso = merge([colored(hind, furFn, 0.14, 2), colored(chest, furFn, 0.14, 3)]);

  // head (pivot at neck)
  const parts: THREE.BufferGeometry[] = [];
  const skull = new THREE.SphereGeometry(0.13, 14, 10);
  skull.scale(1.12, 0.95, 1.0);
  skull.translate(0, 0, 0.08);
  parts.push(colored(skull, (p) => (p.y > 0.06 ? a.furA : p.y < -0.05 ? a.furB : a.furA), 0.12, 4));
  const snout = new THREE.ConeGeometry(0.065, 0.16, 10);
  snout.rotateX(Math.PI / 2);
  snout.translate(0, -0.035, 0.24);
  parts.push(colored(snout, (p) => (p.z > 0.27 ? 0x2a2420 : 0xd9d2c4), 0.06, 5));
  const nose = new THREE.SphereGeometry(0.024, 8, 6);
  nose.translate(0, -0.03, 0.315);
  parts.push(colored(nose, 0x0a0908, 0, 6));
  // the bandit mask
  const mask = new THREE.SphereGeometry(0.137, 18, 6, Math.PI / 2 - 1.35, 2.7, 1.25, 0.5);
  mask.scale(1.12, 0.95, 1.0);
  mask.translate(0, 0, 0.085);
  parts.push(colored(mask, a.mask, 0.04, 7));
  const brow = new THREE.SphereGeometry(0.136, 16, 4, Math.PI / 2 - 0.9, 1.8, 1.02, 0.24);
  brow.scale(1.12, 0.95, 1.0);
  brow.translate(0, 0, 0.085);
  parts.push(colored(brow, 0xe8e2d6, 0.05, 8));
  for (const s of [-1, 1]) {
    const cheek = new THREE.SphereGeometry(0.05, 8, 6);
    cheek.scale(1, 0.8, 1);
    cheek.translate(s * 0.07, -0.06, 0.15);
    parts.push(colored(cheek, 0xe2dccf, 0.05, 9));
    const ear = new THREE.ConeGeometry(0.052, 0.085, 7);
    ear.scale(1, 1, 0.55);
    ear.rotateZ(-s * 0.35);
    ear.translate(s * 0.085, 0.13, 0.04);
    parts.push(colored(ear, (p) => (p.y > 0.165 ? 0xe8e2d6 : a.furA), 0.05, 10));
    const inner = new THREE.ConeGeometry(0.03, 0.05, 6);
    inner.scale(1, 1, 0.4);
    inner.rotateZ(-s * 0.35);
    inner.translate(s * 0.085, 0.125, 0.055);
    parts.push(colored(inner, 0x1a1412, 0, 11));
    const eye = new THREE.SphereGeometry(0.019, 8, 6);
    eye.translate(s * 0.052, 0.025, 0.205);
    parts.push(colored(eye, 0x050505, 0, 12));
  }
  if (a.id === 'boss') {
    // torn ear notch + scar
    const scar = new THREE.BoxGeometry(0.008, 0.07, 0.01);
    scar.rotateZ(0.4);
    scar.translate(-0.06, 0.06, 0.2);
    parts.push(colored(scar, 0xcf9f9a, 0, 13));
  }
  const head = merge(parts);

  // legs (pivot at top)
  const legGeo = (len: number, rad: number) => {
    const l = new THREE.CylinderGeometry(rad, rad * 0.8, len, 7);
    l.translate(0, -len / 2, 0);
    const paw = new THREE.SphereGeometry(rad * 1.25, 7, 5);
    paw.scale(1, 0.6, 1.5);
    paw.translate(0, -len, rad * 0.5);
    return merge([colored(l, (p) => (p.y > -len * 0.35 ? a.furA : 0x1d1915), 0.1, 14), colored(paw, 0x15110f, 0.05, 15)]);
  };
  const legF = legGeo(0.25 * lanky, 0.042 * bulk);
  const legB = legGeo(0.29 * lanky, 0.05 * bulk);

  // ringed tail
  const tailParts: THREE.BufferGeometry[] = [];
  const segs = 7;
  const tlen = 0.52 * lanky;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const r0 = 0.072 - t0 * 0.02, r1 = 0.072 - (i + 1) / segs * 0.02;
    const seg = new THREE.CylinderGeometry(r1, r0, tlen / segs + 0.005, 9);
    seg.rotateX(-Math.PI / 2 - 0.35);
    const z = -(t0 + 0.5 / segs) * tlen;
    seg.translate(0, -z * 0.36, z);
    tailParts.push(colored(seg, i % 2 === 0 ? a.furB : 0x231d19, 0.08, 16 + i));
  }
  const tip = new THREE.SphereGeometry(0.052, 8, 6);
  tip.translate(0, tlen * 0.36, -tlen);
  tailParts.push(colored(tip, 0x1c1714, 0.05, 30));
  const tail = merge(tailParts);
  const geos = { torso, head, legF, legB, tail };
  cache.set(key, geos);
  return geos;
}

export class RaccoonModel {
  root = new THREE.Group();
  body = new THREE.Group();
  headPivot = new THREE.Group();
  tailPivot = new THREE.Group();
  legs: THREE.Group[] = [];
  eyes: THREE.Sprite[] = [];
  mouth = new THREE.Group();
  mat: THREE.MeshStandardMaterial;
  eyeMat: THREE.SpriteMaterial;
  splats: THREE.Mesh[] = [];
  phase = Math.random() * 10;
  look = new THREE.Vector2();
  stand = 0;
  reach = 0;
  stunWobble = 0;
  extra: THREE.Object3D | null = null;
  scale: number;

  constructor(public arch: Archetype) {
    const g = buildGeos(arch);
    this.scale = arch.scale;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, emissive: 0x000000 });
    if (!glowTex) glowTex = glowTexture();
    this.eyeMat = new THREE.SpriteMaterial({ map: glowTex, color: arch.eye, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.3 });

    this.root.add(this.body);
    this.body.position.set(0, 0.3, -0.12);
    const torso = new THREE.Mesh(g.torso, this.mat);
    torso.castShadow = true;
    this.body.add(torso);

    this.headPivot.position.set(0, 0.04, 0.36);
    this.body.add(this.headPivot);
    const head = new THREE.Mesh(g.head, this.mat);
    head.castShadow = true;
    this.headPivot.add(head);
    for (const s of [-1, 1]) {
      const e = new THREE.Sprite(this.eyeMat);
      e.position.set(s * 0.054, 0.027, 0.222);
      e.scale.set(0.085, 0.085, 1);
      this.headPivot.add(e);
      this.eyes.push(e);
    }
    this.mouth.position.set(0, -0.08, 0.3);
    this.headPivot.add(this.mouth);

    const legPos: [number, number, number, boolean][] = [
      [-0.1, -0.02, 0.28, true], [0.1, -0.02, 0.28, true], [-0.12, 0.0, 0.0, false], [0.12, 0.0, 0.0, false],
    ];
    for (const [x, y, z, front] of legPos) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      const leg = new THREE.Mesh(front ? g.legF : g.legB, this.mat);
      leg.castShadow = true;
      pivot.add(leg);
      this.body.add(pivot);
      this.legs.push(pivot);
    }
    this.tailPivot.position.set(0, 0.06, -0.2);
    this.body.add(this.tailPivot);
    const tail = new THREE.Mesh(g.tail, this.mat);
    tail.castShadow = true;
    this.tailPivot.add(tail);

    if (arch.id === 'boss') {
      // a stolen trucker cap, bill to the side
      const cap = new THREE.Group();
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc23a2a, roughness: 0.8 }));
      crown.scale.set(1.15, 0.9, 1.1);
      const front = new THREE.Mesh(new THREE.SphereGeometry(0.112, 12, 8, Math.PI / 2 - 0.8, 1.6, 0.2, 1.3), new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.8 }));
      front.scale.set(1.15, 0.9, 1.1);
      const bill = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 12, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0xc23a2a, roughness: 0.8 }));
      bill.position.set(0, 0.0, 0.06);
      bill.rotation.y = Math.PI / 2;
      cap.add(crown, front, bill);
      cap.position.set(0, 0.09, 0.07);
      cap.rotation.y = 0.9;
      cap.rotation.z = -0.15;
      this.headPivot.add(cap);
    }
    if (arch.id === 'distraction') {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 10), new THREE.MeshStandardMaterial({ color: 0xbfc4c8, metalness: 0.8, roughness: 0.35 }));
      can.rotation.z = Math.PI / 2;
      this.mouth.add(can);
      this.extra = can;
    }
    this.root.scale.setScalar(arch.scale);
  }

  addSplat(worldPoint: THREE.Vector3, color: number, glow: boolean) {
    const local = this.body.worldToLocal(worldPoint.clone());
    // push to surface-ish
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.05 + Math.random() * 0.025, 7, 5),
      new THREE.MeshBasicMaterial({ color, fog: !glow }),
    );
    m.scale.set(1, 0.45, 1);
    m.position.copy(local).multiplyScalar(0.95);
    m.lookAt(new THREE.Vector3(0, 0, 0));
    this.body.add(m);
    this.splats.push(m);
    if (this.splats.length > 8) {
      const old = this.splats.shift()!;
      old.removeFromParent();
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
    }
  }

  /**
   * Procedural animation. speed: m/s ground speed. Flags drive poses.
   */
  animate(dt: number, t: number, o: { speed: number; stand: number; reach: number; stun: number; tailUp: number; sniff: number; lookYaw: number; lookPitch: number; crouch: number }) {
    const s = this.scale;
    const gaitSpeed = o.speed / s;
    this.phase += dt * (3 + gaitSpeed * 5.5);
    const amp = Math.min(1, o.speed * 0.7) * 0.75;
    this.stand += (o.stand - this.stand) * Math.min(1, dt * 7);
    this.reach += (o.reach - this.reach) * Math.min(1, dt * 9);
    const st = this.stand;
    const ph = this.phase;
    // legs: diagonal gait
    const swing = [Math.sin(ph), Math.sin(ph + Math.PI), Math.sin(ph + Math.PI), Math.sin(ph)];
    this.legs.forEach((l, i) => {
      const front = i < 2;
      let rx = swing[i] * amp;
      if (front) {
        rx += -this.reach * (1.3 + Math.sin(t * 14 + i * 2) * 0.35) - st * 0.6;
      } else {
        rx += st * 1.05; // stay planted while rearing
      }
      l.rotation.x = rx;
    });
    // body: bob, rear-up, crouch
    const bob = Math.abs(Math.sin(ph)) * 0.025 * Math.min(1, o.speed);
    this.body.position.y = 0.3 - o.crouch * 0.08 + bob;
    this.body.rotation.x = -st * 1.05 + Math.sin(ph * 2) * 0.03 * amp + o.crouch * 0.05;
    this.stunWobble += (o.stun - this.stunWobble) * Math.min(1, dt * 10);
    this.body.rotation.z = Math.sin(t * 17) * 0.45 * this.stunWobble;
    // head
    this.look.x += (o.lookYaw - this.look.x) * Math.min(1, dt * 6);
    this.look.y += (o.lookPitch - this.look.y) * Math.min(1, dt * 6);
    this.headPivot.rotation.y = this.look.x + Math.sin(t * 9) * 0.6 * this.stunWobble;
    this.headPivot.rotation.x = this.look.y + st * 0.9 + o.sniff * (0.45 + Math.sin(t * 16) * 0.1);
    // tail
    this.tailPivot.rotation.y = Math.sin(t * 2.6 + this.phase * 0.2) * (0.25 + amp * 0.3);
    this.tailPivot.rotation.x = -o.tailUp * 0.6 + st * 0.7;
  }

  setEyes(opacity: number, squint: number) {
    this.eyeMat.opacity = opacity;
    for (const e of this.eyes) e.scale.set(0.085 + opacity * 0.05, (0.085 + opacity * 0.05) * (1 - squint * 0.85), 1);
  }

  dispose() {
    this.mat.dispose();
    this.eyeMat.dispose();
    for (const sp of this.splats) { sp.geometry.dispose(); (sp.material as THREE.Material).dispose(); }
  }
}
