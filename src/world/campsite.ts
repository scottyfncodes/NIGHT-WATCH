import * as THREE from 'three';
import { LAYOUT } from '../config';
import { camperCanvasTexture, woodTexture, glowTexture } from '../textures';

export type LootKind = 'marshmallows' | 'chips' | 'hotdogs' | 'bread' | 'soda';

const std = (color: number, rough = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = (x + y) % 2 ? '#e8e0d0' : '#a3282a';
    g.fillRect(x * 16, y * 16, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  return t;
}

export function makeLoot(kind: LootKind): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'chips') {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.12), std(0xf2c230, 0.4, { emissive: 0x3a2a00 }));
    bag.scale.set(1, 1, 1);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.125), std(0xc42a1e, 0.4));
    band.position.y = 0.04;
    const crimp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.03), std(0xd9b22a, 0.4));
    crimp.position.y = 0.25;
    g.add(bag, band, crimp);
  } else if (kind === 'hotdogs') {
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.14), std(0xe5d7c8, 0.3, { transparent: true, opacity: 0.85 }));
    g.add(pack);
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.24, 3, 6).rotateZ(Math.PI / 2), std(0xc0574a, 0.5));
      d.position.set(0, 0.01, -0.045 + i * 0.03);
      g.add(d);
    }
  } else if (kind === 'marshmallows') {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.1), std(0xf4f1ea, 0.5));
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.225, 0.08, 0.105), std(0x2f6fbf, 0.5));
    g.add(bag, label);
  } else if (kind === 'bread') {
    const loaf = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.26, 4, 8).rotateZ(Math.PI / 2), std(0xd9a85e, 0.7));
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 8).rotateZ(Math.PI / 2), std(0xe0412f, 0.5));
    wrap.position.x = 0.1;
    g.add(loaf, wrap);
  } else {
    for (let i = 0; i < 3; i++) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10), std([0xc8202a, 0x2b5fbf, 0x2ea84a][i], 0.3, { metalness: 0.6 }));
      can.position.set(-0.04 + i * 0.04, 0.06, (i % 2) * 0.03);
      g.add(can);
    }
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

export class Cooler {
  group = new THREE.Group();
  lid: THREE.Group;
  food = 100;
  lidOpen = 0; // 0..1 animated
  lidTarget = 0;
  strap = 0; // seconds of bungee remaining
  strapCooldown = 0;
  straps: THREE.Group;
  items: THREE.Object3D[] = [];
  shake = 0;
  pos: THREE.Vector3;

  constructor(scene: THREE.Scene) {
    const { x, z } = LAYOUT.cooler;
    this.pos = new THREE.Vector3(x, 0, z);
    this.group.position.copy(this.pos);
    this.group.rotation.y = 0.18;
    scene.add(this.group);
    const red = std(0xb5262b, 0.45);
    const white = std(0xece8df, 0.4);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.36, 0.42), red);
    body.position.y = 0.2;
    body.castShadow = body.receiveShadow = true;
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.36), std(0xdcd8cf, 0.6));
    inner.position.y = 0.06;
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.03, 0.44), white);
    rim.position.y = 0.38;
    // handles
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.16), white);
      h.position.set(s * 0.345, 0.3, 0);
      this.group.add(h);
    }
    // hollow look: inner walls dark
    const cavity = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.36), std(0x3a3a3a, 0.9, { side: THREE.BackSide }));
    cavity.position.y = 0.23;
    this.group.add(body, inner, rim, cavity);
    // lid hinged at the far (-z) edge, opens away from the tent
    this.lid = new THREE.Group();
    this.lid.position.set(0, 0.395, -0.22);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.07, 0.44), white);
    lidMesh.position.set(0, 0.035, 0.22);
    lidMesh.castShadow = true;
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.02), std(0x888888, 0.4, { metalness: 0.5 }));
    latch.position.set(0, 0.0, 0.44);
    this.lid.add(lidMesh, latch);
    this.group.add(this.lid);
    // food inside, visible when lid is open; hidden one by one as food drops
    const kinds: [LootKind, number, number, number][] = [
      ['chips', -0.14, 0.27, 0.0], ['hotdogs', 0.13, 0.13, -0.08], ['marshmallows', 0.15, 0.22, 0.08],
      ['bread', -0.05, 0.12, 0.1], ['soda', 0.0, 0.08, -0.08], ['marshmallows', -0.18, 0.2, -0.1],
    ];
    for (const [k, ix, iy, iz] of kinds) {
      const it = makeLoot(k);
      it.position.set(ix, iy, iz);
      it.scale.setScalar(0.7);
      if (k === 'chips') it.rotation.x = -0.3;
      this.group.add(it);
      this.items.push(it);
    }
    // bungee straps
    this.straps = new THREE.Group();
    const strapMat = std(0xff6a1a, 0.6, { emissive: 0x401400 });
    for (const sx of [-0.18, 0.18]) {
      const s = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.012, 4, 20, Math.PI), strapMat);
      s.rotation.y = Math.PI / 2;
      s.position.set(sx, 0.2, 0);
      s.scale.set(1, 1.0, 1);
      this.straps.add(s);
    }
    this.straps.visible = false;
    this.group.add(this.straps);
  }

  reset() {
    this.food = 100;
    this.lidOpen = 0;
    this.lidTarget = 0;
    this.strap = 0;
    this.strapCooldown = 0;
    this.refreshItems();
  }

  refreshItems() {
    const n = Math.ceil((this.food / 100) * this.items.length);
    this.items.forEach((it, i) => (it.visible = i < n));
  }

  update(dt: number, t: number) {
    this.lidOpen += (this.lidTarget - this.lidOpen) * Math.min(1, dt * 8);
    this.lid.rotation.x = -this.lidOpen * 1.9;
    this.strap = Math.max(0, this.strap - dt);
    this.strapCooldown = Math.max(0, this.strapCooldown - dt);
    this.straps.visible = this.strap > 0;
    this.shake = Math.max(0, this.shake - dt * 2);
    this.group.position.x = this.pos.x + Math.sin(t * 40) * this.shake * 0.02;
  }
}

export interface Lantern {
  id: string;
  pos: THREE.Vector3;
  on: boolean;
  light: THREE.PointLight;
  globe: THREE.Mesh;
  halo: THREE.Sprite;
  label: string;
  knocked: number;
}

export class Campsite {
  group = new THREE.Group();
  circles: { x: number; z: number; r: number }[] = [];
  boxes: THREE.Box3[] = [];
  lanterns: Lantern[] = [];
  fireLight!: THREE.PointLight;
  embers!: THREE.Mesh;
  camperLight: THREE.PointLight | null = null;
  radio: { pos: THREE.Vector3; on: boolean; battery: number; mesh: THREE.Group; led: THREE.Mesh };
  spareBatteries: { pos: THREE.Vector3; uses: number; mesh: THREE.Group };
  chairs: THREE.Group[] = [];
  chairTip: number[] = [];
  tripwires: { a: THREE.Vector3; b: THREE.Vector3; armed: boolean; line: THREE.Line; group: THREE.Group }[] = [];

  constructor(scene: THREE.Scene, quality: string) {
    scene.add(this.group);
    this.buildCamper(quality);
    this.buildTable();
    this.buildFire();
    this.buildChairs();
    const glow = glowTexture();
    this.lanterns.push(this.buildLantern('table', new THREE.Vector3(LAYOUT.table.x - 0.3, 0.86, LAYOUT.table.z + 0.1), true, glow, 'table lantern'));
    // shepherd's hook by the tent
    const hookPos = new THREE.Vector3(-1.75, 0, -1.7);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.7, 5), std(0x222222, 0.5, { metalness: 0.6 }));
    pole.position.set(hookPos.x, 0.85, hookPos.z);
    const arm = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 4, 10, Math.PI), pole.material);
    arm.position.set(hookPos.x + 0.12, 1.7, hookPos.z);
    this.group.add(pole, arm);
    this.lanterns.push(this.buildLantern('hook', new THREE.Vector3(hookPos.x + 0.24, 1.42, hookPos.z), false, glow, 'tent lantern'));
    this.circles.push({ x: hookPos.x, z: hookPos.z, r: 0.12 });

    // radio on a stump beside the tent door
    {
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.38, 9), std(0x4a3626, 1));
      stump.position.set(1.65, 0.19, -1.55);
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12).rotateX(-Math.PI / 2), std(0x9a7a52, 1));
      top.position.set(1.65, 0.381, -1.55);
      this.group.add(stump, top);
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.1), std(0x2b2b2e, 0.5));
      const spk = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 12).rotateX(Math.PI / 2), std(0x111111, 0.9));
      const spk2 = spk.clone();
      spk.position.set(-0.1, 0, 0.05); spk2.position.set(0.1, 0, 0.05);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.01, 4, 10, Math.PI), std(0x555555, 0.4, { metalness: 0.5 }));
      handle.position.y = 0.09;
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.4, 3), std(0xaaaaaa, 0.3, { metalness: 0.8 }));
      ant.position.set(0.14, 0.27, 0);
      ant.rotation.z = -0.4;
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.01), new THREE.MeshBasicMaterial({ color: 0x331100 }));
      led.position.set(0, 0.05, 0.051);
      mesh.add(body, spk, spk2, handle, ant, led);
      mesh.position.set(1.65, 0.47, -1.55);
      mesh.rotation.y = Math.PI + 0.5;
      this.group.add(mesh);
      this.radio = { pos: mesh.position.clone(), on: false, battery: 60, mesh, led };
      this.circles.push({ x: 1.65, z: -1.55, r: 0.28 });
    }
    // spare-battery flashlight on the table
    {
      const mesh = new THREE.Group();
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.22, 8).rotateZ(Math.PI / 2), std(0x1e3fa0, 0.4));
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.12), std(0xd9a51e, 0.5));
      pack.position.set(0.1, -0.01, 0.12);
      mesh.add(fl, pack);
      mesh.position.set(LAYOUT.table.x + 0.35, 0.8, LAYOUT.table.z - 0.15);
      this.group.add(mesh);
      this.spareBatteries = { pos: mesh.position.clone(), uses: 2, mesh };
    }
    // cooler collider
    this.circles.push({ x: LAYOUT.cooler.x, z: LAYOUT.cooler.z, r: 0.42 });
    this.boxes.push(new THREE.Box3(new THREE.Vector3(LAYOUT.cooler.x - 0.36, 0, LAYOUT.cooler.z - 0.26), new THREE.Vector3(LAYOUT.cooler.x + 0.36, 0.45, LAYOUT.cooler.z + 0.26)));

    // Tripwires (built hidden; enabled by upgrade)
    const trips: [THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(-3.6, 0.12, -8.8), new THREE.Vector3(-1.2, 0.12, -9.6)],
      [new THREE.Vector3(4.4, 0.12, -9.4), new THREE.Vector3(6.6, 0.12, -7.6)],
    ];
    for (const [a, b] of trips) {
      const g = new THREE.Group();
      for (const p of [a, b]) {
        const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.01, 0.3, 4), std(0x8a6a3a));
        stake.position.set(p.x, 0.15, p.z);
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), std(0x5aa83a, 0.5));
        can.position.set(p.x, 0.32, p.z);
        g.add(stake, can);
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xe8e0c0 }));
      g.add(line);
      g.visible = false;
      this.group.add(g);
      this.tripwires.push({ a, b, armed: false, line, group: g });
    }
  }

  private buildLantern(id: string, pos: THREE.Vector3, on: boolean, glow: THREE.Texture, label: string): Lantern {
    const g = new THREE.Group();
    const green = std(0x2f5a32, 0.5, { metalness: 0.3 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.08, 12), green);
    base.position.y = 0.04;
    const globe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 12), new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffb050, emissiveIntensity: on ? 2.2 : 0, transparent: true, opacity: 0.9 }));
    globe.position.y = 0.15;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.07, 12), green);
    cap.position.y = 0.26;
    const bail = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 4, 10, Math.PI), std(0x666666, 0.4, { metalness: 0.7 }));
    bail.position.y = 0.3;
    g.add(base, globe, cap, bail);
    g.position.copy(pos);
    this.group.add(g);
    const light = new THREE.PointLight(0xffa64a, on ? 14 : 0, 12, 1.4);
    light.position.copy(pos).add(new THREE.Vector3(0, 0.18, 0));
    this.group.add(light);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffb35a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: on ? 0.6 : 0 }));
    halo.scale.set(0.9, 0.9, 1);
    halo.position.copy(light.position);
    this.group.add(halo);
    return { id, pos: light.position.clone(), on, light, globe, halo, label, knocked: 0 };
  }

  setLantern(l: Lantern, on: boolean) {
    l.on = on;
  }

  private buildCamper(quality: string) {
    const { x, z } = LAYOUT.camper;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = 0.55;
    const white = std(0xd9d4c7, 0.5);
    const stripe = std(0x6b3a22, 0.6);
    const L = 3.6, Wd = 2.0;
    const box = new THREE.Mesh(new THREE.BoxGeometry(Wd, 0.95, L), white);
    box.position.y = 0.85;
    const st = new THREE.Mesh(new THREE.BoxGeometry(Wd + 0.01, 0.12, L + 0.01), stripe);
    st.position.y = 0.95;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(Wd + 0.1, 0.16, L + 0.1), white);
    roof.position.y = 2.25;
    const canvasTex = camperCanvasTexture();
    const canvasMat = new THREE.MeshStandardMaterial({ map: canvasTex, emissiveMap: canvasTex, emissive: 0xffb060, emissiveIntensity: 0.55, roughness: 1, side: THREE.DoubleSide });
    const sides = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.05, 0.9, L - 0.05), canvasMat);
    sides.position.y = 1.75;
    // bunk ends
    for (const s of [-1, 1]) {
      const bunk = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, Wd - 0.1, 14, 1, true, 0, Math.PI), canvasMat);
      bunk.rotation.z = Math.PI / 2;
      bunk.rotation.y = s > 0 ? 0 : Math.PI;
      bunk.position.set(0, 1.6, s * (L / 2 + 0.05));
      bunk.scale.set(1, 1, 1.1);
      const plat = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.05, 0.08, 1.2), white);
      plat.position.set(0, 1.55, s * (L / 2 + 0.6));
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), std(0x777777, 0.4, { metalness: 0.7 }));
      brace.position.set(0, 0.85, s * (L / 2 + 0.6));
      brace.rotation.x = s * 0.6;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.05, 0.75, 0.04), canvasMat);
      cap.position.set(0, 1.95, s * (L / 2 + 1.2));
      g.add(plat, brace, cap);
      const tent = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.06, 0.72, 1.15), canvasMat);
      tent.position.set(0, 1.95, s * (L / 2 + 0.6));
      g.add(tent);
    }
    // wheels, tongue, jack, propane
    for (const s of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 14).rotateZ(Math.PI / 2), std(0x151515, 0.9));
      wheel.position.set(s * (Wd / 2 + 0.05), 0.34, 0.2);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.21, 10).rotateZ(Math.PI / 2), std(0xbbbbbb, 0.3, { metalness: 0.8 }));
      hub.position.copy(wheel.position);
      g.add(wheel, hub);
    }
    const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.5), std(0x2a2a2a, 0.6));
    tongue.position.set(0, 0.45, -L / 2 - 0.7);
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.25, 4, 10), std(0xe8e8e0, 0.4));
    tank.position.set(0, 0.75, -L / 2 - 0.4);
    const jack = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6), std(0x777777, 0.4, { metalness: 0.7 }));
    jack.position.set(0, 0.22, -L / 2 - 1.3);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.85, 0.6), std(0xcfc8b8, 0.5));
    door.position.set(Wd / 2 + 0.01, 0.85, 0.7);
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.5), std(0x555555, 0.5, { metalness: 0.6 }));
    step.position.set(Wd / 2 + 0.2, 0.3, 0.7);
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8).rotateX(-Math.PI / 2), std(0x3e6a4a, 1));
    mat.position.set(Wd / 2 + 0.75, 0.015, 0.7);
    g.add(box, st, roof, sides, tongue, tank, jack, door, step, mat);
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.group.add(g);
    if (quality !== 'low') {
      this.camperLight = new THREE.PointLight(0xffa860, 5, 10, 1.6);
      this.camperLight.position.set(x + 1.6, 1.6, z - 0.3);
      this.group.add(this.camperLight);
    }
    this.circles.push({ x, z, r: 2.6 });
    const b = new THREE.Box3().setFromObject(g);
    this.boxes.push(b);
  }

  private buildTable() {
    const { x, z } = LAYOUT.table;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = -0.35;
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.9, color: 0xb0906a });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.8), wood);
    top.position.y = 0.75;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.012, 0.82), std(0xffffff, 0.6, { map: checkerTexture() }));
    cloth.position.y = 0.78;
    const drape = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.18), std(0xffffff, 0.6, { map: checkerTexture(), side: THREE.DoubleSide }));
    drape.position.set(0, 0.69, 0.41);
    const drape2 = drape.clone();
    drape2.position.z = -0.41;
    g.add(top, cloth, drape, drape2);
    for (const s of [-1, 1]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 0.26), wood);
      bench.position.set(0, 0.44, s * 0.62);
      g.add(bench);
      for (const lx of [-0.7, 0.7]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 0.07), wood);
        leg.position.set(lx, 0.4, s * 0.35);
        leg.rotation.x = s * 0.5;
        g.add(leg);
      }
    }
    // stove + plates + bug spray
    const stove = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.25), std(0x2e5a2c, 0.5, { metalness: 0.3 }));
    stove.position.set(0.45, 0.83, 0.05);
    const plates = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 14), std(0xf2eee0, 0.8));
    plates.position.set(-0.1, 0.8, -0.2);
    const spray = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), std(0xe5c22a, 0.4, { metalness: 0.4 }));
    spray.position.set(0.1, 0.86, 0.22);
    const buns = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.14), std(0xd8a660, 0.7));
    buns.position.set(-0.55, 0.82, 0.1);
    g.add(stove, plates, spray, buns);
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.group.add(g);
    this.circles.push({ x, z, r: 1.0 });
    this.boxes.push(new THREE.Box3().setFromObject(top).expandByScalar(0.05));
  }

  private buildFire() {
    const { x, z } = LAYOUT.fire;
    const stoneMat = std(0x5d5a54, 1, { flatShading: true });
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.05, 0), stoneMat);
      s.position.set(x + Math.cos(a) * 0.62, 0.08, z + Math.sin(a) * 0.62);
      s.rotation.set(Math.random(), Math.random(), Math.random());
      s.scale.y = 0.7;
      s.castShadow = true;
      this.group.add(s);
    }
    const ash = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16).rotateX(-Math.PI / 2), std(0x2a2522, 1));
    ash.position.set(x, 0.02, z);
    this.group.add(ash);
    const logMat = std(0x2a1a12, 1);
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.75, 6).rotateZ(Math.PI / 2 - 0.35), logMat);
      log.rotation.y = (i / 4) * Math.PI * 2;
      log.position.set(x, 0.14, z);
      this.group.add(log);
    }
    this.embers = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff4a10, emissiveIntensity: 1.4, roughness: 1 }));
    this.embers.position.set(x, 0.03, z);
    this.embers.scale.y = 0.4;
    this.group.add(this.embers);
    this.fireLight = new THREE.PointLight(0xff5a1a, 5, 8, 1.6);
    this.fireLight.position.set(x, 0.45, z);
    this.group.add(this.fireLight);
    this.circles.push({ x, z, r: 0.8 });
  }

  private buildChairs() {
    const spots: [number, number, number, number][] = [
      [LAYOUT.fire.x + 1.1, LAYOUT.fire.z + 0.7, -2.2, 0x2f5b8f],
      [LAYOUT.fire.x - 0.4, LAYOUT.fire.z + 1.2, -3.0, 0x8f3a2f],
    ];
    for (const [x, z, ry, col] of spots) {
      const g = new THREE.Group();
      const fabric = std(col, 0.9, { side: THREE.DoubleSide });
      const metal = std(0x9a9a9a, 0.4, { metalness: 0.7 });
      const seat = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42).rotateX(-Math.PI / 2 + 0.15), fabric);
      seat.position.y = 0.42;
      const back = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), fabric);
      back.position.set(0, 0.72, 0.22);
      back.rotation.x = -0.2;
      g.add(seat, back);
      for (const sx of [-0.25, 0.25]) {
        for (const r of [0.6, -0.6]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 4), metal);
          leg.position.set(sx, 0.28, 0);
          leg.rotation.x = r;
          g.add(leg);
        }
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.45), fabric);
        arm.position.set(sx, 0.58, 0.02);
        g.add(arm);
      }
      // cup holder w/ soda
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8), std(0xc8202a, 0.3, { metalness: 0.6 }));
      cup.position.set(0.29, 0.62, -0.1);
      g.add(cup);
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.group.add(g);
      this.chairs.push(g);
      this.chairTip.push(0);
      this.circles.push({ x, z, r: 0.35 });
    }
  }

  reset() {
    for (const l of this.lanterns) l.on = l.id === 'table';
    this.radio.on = false;
    this.radio.battery = 60;
    this.spareBatteries.uses = 2;
    this.chairTip = this.chairTip.map(() => 0);
  }

  update(dt: number, t: number) {
    // fire flicker
    const fl = 0.75 + Math.sin(t * 11) * 0.08 + Math.sin(t * 23.7) * 0.06 + Math.random() * 0.08;
    this.fireLight.intensity = 5 * fl;
    (this.embers.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.1 + fl * 0.6;
    for (const l of this.lanterns) {
      const target = l.on ? 14 * (0.95 + Math.sin(t * 17 + l.pos.x) * 0.03) : 0;
      l.light.intensity += (target - l.light.intensity) * Math.min(1, dt * 12);
      (l.globe.material as THREE.MeshStandardMaterial).emissiveIntensity = l.on ? 2.2 : 0.02;
      (l.halo.material as THREE.SpriteMaterial).opacity = l.on ? 0.55 : 0;
    }
    (this.radio.led.material as THREE.MeshBasicMaterial).color.setHex(this.radio.on ? 0xff3a1a : 0x331100);
    if (this.radio.on) {
      this.radio.battery -= dt;
      this.radio.mesh.position.y = this.radio.pos.y + Math.abs(Math.sin(t * 11)) * 0.006;
      if (this.radio.battery <= 0) { this.radio.battery = 0; this.radio.on = false; }
    }
    this.spareBatteries.mesh.visible = this.spareBatteries.uses > 0;
    this.chairs.forEach((c, i) => {
      const tip = this.chairTip[i];
      c.rotation.z += ((tip ? 1.45 : 0) - c.rotation.z) * Math.min(1, dt * 10);
    });
  }
}
