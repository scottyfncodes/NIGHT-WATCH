import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, pineStrawTexture, clearingTexture, barkTexture, glowTexture, moonTexture, grassTexture } from '../textures';

export interface TreeCollider { x: number; z: number; r: number }

/** Colour a geometry with a flat vertex colour (for merging differently coloured parts). */
export function tint(geo: THREE.BufferGeometry, color: number, jitter = 0, seed = 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const k = 1 + (r() - 0.5) * jitter;
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv === undefined) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

function jitterGeo(geo: THREE.BufferGeometry, amt: number, seed: number) {
  const p = geo.attributes.position;
  const r = rng(seed);
  const map = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let d = map.get(key);
    if (!d) { d = [(r() - 0.5) * amt, (r() - 0.5) * amt * 0.6, (r() - 0.5) * amt]; map.set(key, d); }
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
}

/** Loblolly pine crown: clumpy tufts at the top of a tall bare trunk. */
function loblollyCrown(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const greens = [0x1f3a24, 0x274a2b, 0x1a321f, 0x2d5232];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.IcosahedronGeometry(1.2 + r() * 0.9, 1);
    jitterGeo(g, 0.7, seed * 31 + i);
    g.scale(1.3, 0.7, 1.3);
    const a = r() * Math.PI * 2, d = i === 0 ? 0 : 0.9 + r() * 1.6;
    g.translate(Math.cos(a) * d, (r() - 0.3) * 2.2, Math.sin(a) * d);
    parts.push(tint(g, greens[(r() * greens.length) | 0], 0.25, seed + i));
  }
  // a few bare branch stubs
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.05, 0.09, 2.4, 4);
    b.rotateZ(Math.PI / 2 - 0.3);
    b.rotateY(r() * Math.PI * 2);
    b.translate(0, -1.6 - r() * 1.5, 0);
    parts.push(tint(b, 0x3a2a1f));
  }
  return mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); p.deleteAttribute('normal'); return p; }))!;
}

/** Young pine: classic stacked cones close to the ground (gives raccoons cover). */
function youngPine(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const layers = 5;
  for (let i = 0; i < layers; i++) {
    const rad = 1.8 - i * 0.3;
    const g = new THREE.ConeGeometry(rad, 1.8, 9, 1, true);
    jitterGeo(g, 0.35, seed * 7 + i);
    g.translate(0, 1.2 + i * 0.95, 0);
    parts.push(tint(g, [0x1d3a22, 0x24452a, 0x19331e][i % 3], 0.3, seed + i));
  }
  const trunk = new THREE.CylinderGeometry(0.08, 0.14, 1.4, 5);
  trunk.translate(0, 0.7, 0);
  parts.push(tint(trunk, 0x3b2a1e));
  return mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); p.deleteAttribute('normal'); return p; }))!;
}

/** Yaupon holly / understory shrub. */
function shrub(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.IcosahedronGeometry(0.45 + r() * 0.35, 1);
    jitterGeo(g, 0.25, seed * 13 + i);
    g.translate((r() - 0.5) * 1.1, 0.35 + r() * 0.5, (r() - 0.5) * 1.1);
    parts.push(tint(g, [0x20381f, 0x2a4423, 0x1a2e1a][(r() * 3) | 0], 0.3, seed + i));
  }
  return mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); p.deleteAttribute('normal'); return p; }))!;
}

export class Environment {
  group = new THREE.Group();
  trees: TreeCollider[] = [];
  cover: { x: number; z: number }[] = []; // hiding spots
  moonLight: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  skyMat: THREE.ShaderMaterial;
  moon: THREE.Sprite;
  stars: THREE.Points;
  fireflies: THREE.Points;
  private fireflyBase: Float32Array;
  fog: THREE.FogExp2;
  dayMix = 0;

  constructor(scene: THREE.Scene, quality: 'low' | 'medium' | 'high') {
    scene.add(this.group);
    const night = new THREE.Color(0x0a1420);
    this.fog = new THREE.FogExp2(night.getHex(), 0.03);
    scene.fog = this.fog;
    scene.background = night;

    // Sky dome
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x02060d) },
        mid: { value: new THREE.Color(0x0c1a2c) },
        horizon: { value: new THREE.Color(0x1b2a3a) },
        day: { value: 0 },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform float day; varying vec3 vP;
        void main(){ float h = clamp(vP.y,0.0,1.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0,0.25,h)); c = mix(c, top, smoothstep(0.25,0.9,h));
          vec3 dawnTop = vec3(0.32,0.45,0.66); vec3 dawnH = vec3(1.0,0.62,0.42); vec3 dawnM = vec3(0.86,0.6,0.62);
          vec3 d = mix(dawnH, dawnM, smoothstep(0.0,0.3,h)); d = mix(d, dawnTop, smoothstep(0.3,0.9,h));
          gl_FragColor = vec4(mix(c,d,day),1.0); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), this.skyMat);
    sky.renderOrder = -10;
    this.group.add(sky);

    // Stars
    {
      const r = rng(99);
      const n = 900;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const th = r() * Math.PI * 2, ph = Math.acos(1 - r() * 0.95);
        pos[i * 3] = Math.sin(ph) * Math.cos(th) * 170;
        pos[i * 3 + 1] = Math.cos(ph) * 170;
        pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 170;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 0.9, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
      this.group.add(this.stars);
    }
    // Moon
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), fog: false, transparent: true, depthWrite: false }));
    this.moon.scale.set(38, 38, 1);
    this.moon.position.set(-60, 95, -110);
    this.group.add(this.moon);

    // Lights
    this.hemi = new THREE.HemisphereLight(0x5674a6, 0x2a1d12, 1.05);
    scene.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight(0xa9bde6, 1.15);
    this.moonLight.position.set(-18, 30, -22);
    if (quality === 'high') {
      this.moonLight.castShadow = true;
      this.moonLight.shadow.mapSize.set(1024, 1024);
      const s = this.moonLight.shadow.camera;
      s.left = -14; s.right = 14; s.top = 14; s.bottom = -14; s.near = 5; s.far = 70;
      this.moonLight.shadow.bias = -0.0015;
    }
    scene.add(this.moonLight);
    scene.add(this.moonLight.target);

    // Ground
    const groundTex = pineStrawTexture();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240, 1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, color: 0xb8a690 }),
    );
    ground.receiveShadow = true;
    this.group.add(ground);
    const clearing = new THREE.Mesh(
      new THREE.CircleGeometry(9, 40).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: clearingTexture(), transparent: true, roughness: 1, depthWrite: false }),
    );
    clearing.position.set(0.3, 0.01, -2.4);
    clearing.receiveShadow = true;
    this.group.add(clearing);

    this.buildForest(quality);
    this.buildGroundCover(quality);

    // Fireflies
    {
      const n = 46;
      const r = rng(4);
      this.fireflyBase = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = 8 + r() * 22;
        this.fireflyBase[i * 3] = Math.cos(a) * d;
        this.fireflyBase[i * 3 + 1] = 0.4 + r() * 2.2;
        this.fireflyBase[i * 3 + 2] = Math.sin(a) * d;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.fireflyBase.slice(), 3));
      this.fireflies = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8ff6a, size: 0.16, map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      this.group.add(this.fireflies);
    }
  }

  private buildForest(quality: string) {
    const r = rng(1998);
    const bark = barkTexture();
    const trunkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 1, color: 0x9a8676 });
    const crownMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });

    // Place trees with Poisson-ish rejection; keep the campsite clear.
    const placed: TreeCollider[] = [];
    const tooClose = (x: number, z: number, min: number) => placed.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < min * min);
    const inCamp = (x: number, z: number) => {
      if (Math.hypot(x - 0.3, z + 2.4) < 9.5) return true;
      if (Math.hypot(x + 7.5, z - 4.5) < 4.5) return true; // camper
      return false;
    };
    const target = quality === 'low' ? 260 : 380;
    let tries = 0;
    while (placed.length < target && tries < 8000) {
      tries++;
      const a = r() * Math.PI * 2;
      const d = 9 + Math.pow(r(), 0.8) * 70;
      const x = Math.cos(a) * d, z = Math.sin(a) * d - 2;
      if (inCamp(x, z)) continue;
      if (tooClose(x, z, d < 25 ? 3.2 : 2.6)) continue;
      placed.push({ x, z, r: 0.3 + r() * 0.18 });
    }
    // A couple of hero pines close to camp framing the view
    for (const [x, z] of [[-4.6, -9.6], [6.4, -9.2], [7.6, 1.2], [-5.0, 0.6], [2.6, 5.4], [-1.8, -11.5]] as [number, number][]) {
      placed.push({ x, z, r: 0.42 });
    }
    this.trees = placed;

    const trunkGeo = new THREE.CylinderGeometry(0.75, 1, 1, 7, 1);
    trunkGeo.translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, placed.length);
    const crownGeos = [loblollyCrown(1), loblollyCrown(2), loblollyCrown(3)];
    const youngGeo = youngPine(5);
    const crownsCount = [0, 0, 0];
    const assign: number[] = [];
    const youngIdx: number[] = [];
    placed.forEach((t, i) => {
      const young = r() < 0.16 && i < placed.length - 6;
      if (young) { youngIdx.push(i); assign.push(-1); return; }
      const k = (r() * 3) | 0;
      assign.push(k);
      crownsCount[k]++;
    });
    const crowns = crownGeos.map((g, k) => new THREE.InstancedMesh(g, crownMat, Math.max(1, crownsCount[k])));
    const young = new THREE.InstancedMesh(youngGeo, crownMat, Math.max(1, youngIdx.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const ci = [0, 0, 0];
    let yi = 0;
    placed.forEach((t, i) => {
      if (assign[i] === -1) {
        const s = 0.8 + r() * 0.7;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
        m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(s, s, s));
        young.setMatrixAt(yi++, m);
        t.r = 0.2 * s;
        this.cover.push({ x: t.x, z: t.z });
        // short trunk instance hidden inside
        m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(0.12 * s, 1.5 * s, 0.12 * s));
        trunks.setMatrixAt(i, m);
        return;
      }
      const h = 14 + r() * 12;
      const lean = (r() - 0.5) * 0.05;
      q.setFromEuler(new THREE.Euler(lean, r() * 6.28, (r() - 0.5) * 0.05));
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.r, h, t.r));
      trunks.setMatrixAt(i, m);
      const k = assign[i];
      const cs = 0.9 + r() * 0.6;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      m.compose(new THREE.Vector3(t.x, h - 0.6, t.z), q, new THREE.Vector3(cs, cs, cs));
      crowns[k].setMatrixAt(ci[k]++, m);
      if (Math.hypot(t.x, t.z) < 40) this.cover.push({ x: t.x, z: t.z });
    });
    trunks.castShadow = true;
    trunks.receiveShadow = true;
    young.castShadow = true;
    this.group.add(trunks, young, ...crowns);
    crowns.forEach((c) => (c.castShadow = true));

    // Shrubs — more cover in the 10-25m band
    const shrubGeos = [shrub(1), shrub(2)];
    const nShrub = quality === 'low' ? 70 : 120;
    const shrubs = shrubGeos.map((g) => new THREE.InstancedMesh(g, crownMat, nShrub / 2));
    for (let i = 0; i < nShrub; i++) {
      let x = 0, z = 0;
      for (let k = 0; k < 20; k++) {
        const a = r() * Math.PI * 2, d = 9.5 + r() * 30;
        x = Math.cos(a) * d; z = Math.sin(a) * d - 2;
        if (!inCamp(x, z)) break;
      }
      const s = 0.8 + r() * 0.9;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.8 + r() * 0.5), s));
      shrubs[i % 2].setMatrixAt((i / 2) | 0, m);
      if (Math.hypot(x, z) < 32) this.cover.push({ x, z });
    }
    this.group.add(...shrubs);
  }

  private buildGroundCover(quality: string) {
    const r = rng(42);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    // Fallen branches
    const branchGeo = new THREE.CylinderGeometry(0.03, 0.05, 1.6, 5).rotateZ(Math.PI / 2);
    const branchMat = new THREE.MeshStandardMaterial({ color: 0x3e2d20, roughness: 1 });
    const nb = 70;
    const branches = new THREE.InstancedMesh(branchGeo, branchMat, nb);
    for (let i = 0; i < nb; i++) {
      const a = r() * 6.28, d = 4 + r() * 35;
      q.setFromEuler(new THREE.Euler(0, r() * 6.28, (r() - 0.5) * 0.1));
      m.compose(v.set(Math.cos(a) * d, 0.04, Math.sin(a) * d - 2), q, s.set(0.6 + r() * 1.2, 1, 1));
      branches.setMatrixAt(i, m);
    }
    // Pine cones
    const coneGeo = new THREE.ConeGeometry(0.05, 0.12, 6).rotateZ(Math.PI / 2);
    const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 }), 220);
    for (let i = 0; i < 220; i++) {
      const a = r() * 6.28, d = 2.5 + r() * 30;
      q.setFromEuler(new THREE.Euler(0, r() * 6.28, 0));
      m.compose(v.set(Math.cos(a) * d, 0.04, Math.sin(a) * d - 2), q, s.set(1, 1, 1));
      cones.setMatrixAt(i, m);
    }
    // Rocks
    const rockGeo = new THREE.DodecahedronGeometry(0.22, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x55534d, roughness: 1, flatShading: true }), 60);
    for (let i = 0; i < 60; i++) {
      const a = r() * 6.28, d = 6 + r() * 30;
      q.setFromEuler(new THREE.Euler(r(), r() * 6, r()));
      const k = 0.5 + r() * 1.5;
      m.compose(v.set(Math.cos(a) * d, 0.05, Math.sin(a) * d - 2), q, s.set(k, k * 0.6, k));
      rocks.setMatrixAt(i, m);
    }
    // Exposed roots near big trees
    const rootGeo = new THREE.CylinderGeometry(0.04, 0.12, 1.4, 5).rotateZ(Math.PI / 2 - 0.1).translate(0.7, 0.03, 0);
    const near = this.trees.filter((t) => Math.hypot(t.x, t.z) < 30);
    const roots = new THREE.InstancedMesh(rootGeo, new THREE.MeshStandardMaterial({ color: 0x3a2b20, roughness: 1 }), near.length * 3);
    let ri = 0;
    near.forEach((t) => {
      for (let k = 0; k < 3; k++) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
        m.compose(v.set(t.x, 0, t.z), q, s.set(1 + r(), 1, 1));
        roots.setMatrixAt(ri++, m);
      }
    });
    // Grass tufts (alpha cards, crossed)
    const gt = grassTexture();
    const grassGeo = mergeGeometries([
      new THREE.PlaneGeometry(0.6, 0.45).translate(0, 0.22, 0),
      new THREE.PlaneGeometry(0.6, 0.45).rotateY(Math.PI / 2).translate(0, 0.22, 0),
    ])!;
    const ng = quality === 'low' ? 160 : 320;
    const grass = new THREE.InstancedMesh(grassGeo, new THREE.MeshStandardMaterial({ map: gt, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, color: 0x9aa070 }), ng);
    for (let i = 0; i < ng; i++) {
      const a = r() * 6.28, d = 5 + r() * 28;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      const k = 0.7 + r() * 0.8;
      m.compose(v.set(Math.cos(a) * d, 0, Math.sin(a) * d - 2), q, s.set(k, k, k));
      grass.setMatrixAt(i, m);
    }
    branches.receiveShadow = rocks.receiveShadow = true;
    this.group.add(branches, cones, rocks, roots, grass);
  }

  update(t: number, dt: number, dayMix: number) {
    this.dayMix = dayMix;
    // fireflies drift + blink
    const p = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const b = i * 3;
      p.setXYZ(i,
        this.fireflyBase[b] + Math.sin(t * 0.3 + i) * 0.8,
        this.fireflyBase[b + 1] + Math.sin(t * 0.7 + i * 2.1) * 0.35,
        this.fireflyBase[b + 2] + Math.cos(t * 0.25 + i * 1.3) * 0.8);
    }
    p.needsUpdate = true;
    (this.fireflies.material as THREE.PointsMaterial).opacity = (0.55 + 0.45 * Math.sin(t * 2.3)) * (1 - dayMix);

    // dawn
    this.skyMat.uniforms.day.value = dayMix;
    const night = new THREE.Color(0x0a1420), dawn = new THREE.Color(0x6a7890);
    const fc = night.clone().lerp(dawn, dayMix);
    this.fog.color.copy(fc);
    this.fog.density = 0.03 - dayMix * 0.014;
    this.hemi.intensity = 1.05 + dayMix * 1.2;
    this.hemi.color.setHex(0x5674a6).lerp(new THREE.Color(0xffd6b0), dayMix);
    this.moonLight.intensity = 1.15 + dayMix * 0.9;
    this.moonLight.color.setHex(0xa9bde6).lerp(new THREE.Color(0xffb27a), dayMix);
    (this.stars.material as THREE.PointsMaterial).opacity = 0.9 * (1 - dayMix);
    (this.moon.material as THREE.SpriteMaterial).opacity = 1 - dayMix * 0.8;
  }
}
