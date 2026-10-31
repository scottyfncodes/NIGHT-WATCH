import * as THREE from 'three';
import { AmmoType, AMMO_COLORS } from './config';
import { Loadout } from './save';
import { audio } from './audio';

export interface Projectile {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  type: AmmoType;
  color: number;
  life: number;
  alive: boolean;
  thrown?: 'hotdog';
}

export const GRAVITY = 5.2;

/** The kid's paintball marker, rendered as a first-person view model. */
export class Marker {
  scene = new THREE.Scene();
  root = new THREE.Group(); // follows camera
  gun = new THREE.Group();
  pump: THREE.Group;
  hopperBalls: THREE.InstancedMesh;
  hopperShell: THREE.Mesh;
  barrel: THREE.Mesh;
  lens: THREE.Mesh;
  flashBeam: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  muzzleFlash: THREE.Mesh;
  private ballMat: THREE.MeshStandardMaterial;
  private hopperCap = 12;

  // state
  hopper = 12;
  reserve = 110;
  specials = { glow: 0, sticky: 0, burst: 0, decoy: 0 };
  ammo: AmmoType = 'standard';
  cooldown = 0;
  reloading = 0;
  reloadTotal = 1;
  pumpT = 1;
  kick = 0;
  sway = new THREE.Vector2();
  bob = 0;
  shots = 0;
  hits = 0;
  lowered = 0;

  constructor() {
    this.scene.add(this.root);
    this.root.add(this.gun);
    const hemi = new THREE.HemisphereLight(0x6a7fa8, 0x20160e, 1.1);
    this.scene.add(hemi);
    const key = new THREE.PointLight(0xffc890, 1.2, 3);
    key.position.set(0.4, 0.3, 0.2);
    this.root.add(key);

    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.45, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.6, metalness: 0.3 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x2257c9, roughness: 0.3, metalness: 0.7 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });
    const tape = new THREE.MeshStandardMaterial({ color: 0x9a9c9e, roughness: 0.7, metalness: 0.2 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.3), this.bodyMat);
    body.position.set(0, 0, 0);
    const gripM = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.05), grip);
    gripM.position.set(0, -0.085, 0.07);
    gripM.rotation.x = -0.25;
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 4, 10, Math.PI), dark);
    guard.rotation.set(Math.PI, Math.PI / 2, 0);
    guard.position.set(0, -0.04, 0.015);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 12).rotateX(Math.PI / 2), blue);
    tank.position.set(0, -0.02, 0.24);
    const tapeRing = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12).rotateX(Math.PI / 2), tape);
    tapeRing.position.set(0, -0.02, 0.2);
    this.barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.36, 10).rotateX(Math.PI / 2), dark);
    this.barrel.position.set(0, 0.012, -0.32);
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.06, 8), dark);
    feed.position.set(0, 0.065, -0.04);
    // pump forend
    this.pump = new THREE.Group();
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.12), grip);
    this.pump.add(fore);
    this.pump.position.set(0, -0.025, -0.24);
    // hopper: smoky see-through shell with real balls inside that drain as you shoot
    this.hopperShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x39424c, transparent: true, opacity: 0.55, roughness: 0.2, metalness: 0.2, depthWrite: false }),
    );
    this.hopperShell.scale.set(0.7, 0.62, 1.0);
    this.hopperShell.position.set(0, 0.12, -0.03);
    this.ballMat = new THREE.MeshStandardMaterial({ color: 0xff2e88, roughness: 0.25, emissive: 0xff2e88, emissiveIntensity: 0.35 });
    this.hopperBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0085, 8, 6), this.ballMat, 48);
    this.hopperBalls.position.copy(this.hopperShell.position);
    // under-barrel flashlight
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.12, 10).rotateX(Math.PI / 2), dark);
    fl.position.set(0.0, -0.045, -0.36);
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), new THREE.MeshBasicMaterial({ color: 0x333333 }));
    this.lens.position.set(0, -0.045, -0.421);
    this.lens.rotation.y = Math.PI;
    const beamGeo = new THREE.ConeGeometry(0.25, 2.2, 16, 1, true);
    beamGeo.translate(0, -1.1, 0);
    beamGeo.rotateX(-Math.PI / 2);
    this.flashBeam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.flashBeam.position.set(0, -0.045, -0.43);
    this.flashBeam.visible = false;
    this.muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
    this.muzzleFlash.position.set(0, 0.012, -0.52);
    this.gun.add(body, gripM, guard, tank, tapeRing, this.barrel, feed, this.pump, this.hopperShell, this.hopperBalls, fl, this.lens, this.flashBeam, this.muzzleFlash);
    // right hand / sleeve (striped flannel sleeve)
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.32, 10).rotateX(Math.PI / 2 - 0.3), new THREE.MeshStandardMaterial({ color: 0x7a2a2a, roughness: 0.95 }));
    sleeve.position.set(0.04, -0.15, 0.25);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.8 }));
    hand.scale.set(1, 1.2, 1.3);
    hand.position.set(0.0, -0.09, 0.08);
    const lhand = hand.clone();
    lhand.position.set(0, -0.055, -0.24);
    this.pump.add(lhand);
    lhand.position.set(0, -0.03, 0);
    // left forearm reaching up to the pump
    const from = new THREE.Vector3(-0.2, -0.34, 0.06), to = new THREE.Vector3(0, -0.07, -0.24);
    const fore2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, from.distanceTo(to), 10), sleeve.material);
    fore2.position.copy(from).add(to).multiplyScalar(0.5);
    fore2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    this.gun.add(sleeve, hand, fore2);
    this.gun.position.set(0.2, -0.2, -0.46);
    this.gun.rotation.y = 0.04;
  }

  configure(L: Loadout) {
    this.hopperCap = L.hopper;
    this.hopper = L.hopper;
    this.reserve = L.reserve;
    this.specials = { ...L.specials };
    this.ammo = 'standard';
    this.cooldown = 0;
    this.reloading = 0;
    this.shots = 0;
    this.hits = 0;
    this.pumpT = 1;
    // visible upgrades
    this.bodyMat.color.setHex(L.semiAuto ? 0x8a1f24 : 0x2b2d33);
    this.pump.visible = true;
    const blen = [0.36, 0.48, 0.6][L.muzzle >= 56 ? 2 : L.muzzle >= 48 ? 1 : 0];
    this.barrel.scale.set(1, 1, blen / 0.36);
    this.barrel.position.z = -0.15 - blen / 2;
    this.muzzleFlash.position.z = -0.15 - blen;
    const hs = 1 + (L.hopper - 12) / 60;
    this.hopperShell.scale.set(0.7 * hs, 0.62 * hs, 1.0 * hs);
    this.ballMat.color.setHex(L.paint);
    this.ballMat.emissive.setHex(L.paint);
    this.updateHopperBalls();
  }

  get color(): number {
    return this.ammo === 'standard' ? this.ballMat.color.getHex() : AMMO_COLORS[this.ammo];
  }

  updateHopperBalls(fill = this.hopper) {
    const m = new THREE.Matrix4();
    const shown = Math.min(48, Math.round((fill / Math.max(1, this.hopperCap)) * Math.min(48, this.hopperCap + 6)));
    const hs = this.hopperShell.scale;
    let k = 0;
    for (let layer = 0; k < shown; layer++) {
      const ring = 7;
      for (let j = 0; j < ring && k < shown; j++, k++) {
        const a = (j / ring) * Math.PI * 2 + layer * 0.45;
        const r = 0.03 + (layer % 2) * 0.012;
        m.makeTranslation(Math.cos(a) * r * hs.x / 0.7, -0.035 * hs.y / 0.62 + layer * 0.0145, Math.sin(a) * r * hs.z);
        this.hopperBalls.setMatrixAt(k, m);
      }
    }
    this.hopperBalls.count = shown;
    this.hopperBalls.instanceMatrix.needsUpdate = true;
  }

  cycleAmmo(): AmmoType {
    const order: AmmoType[] = ['standard', 'glow', 'sticky', 'burst', 'decoy'];
    let i = order.indexOf(this.ammo);
    for (let k = 0; k < order.length; k++) {
      i = (i + 1) % order.length;
      const a = order[i];
      if (a === 'standard' || this.specials[a] > 0) { this.ammo = a; break; }
    }
    audio.play('click', { vol: 0.8 });
    return this.ammo;
  }

  get totalAmmo() { return this.hopper + this.reserve; }

  startReload(L: Loadout): boolean {
    if (this.reloading > 0 || this.hopper >= L.hopper || this.reserve <= 0) return false;
    this.reloading = L.reload;
    this.reloadTotal = L.reload;
    audio.play('reload', { vol: 0.9, rate: 1.0 / Math.max(0.6, L.reload / 2.3) });
    return true;
  }

  /** Returns ammo type fired, or null. */
  tryFire(L: Loadout): AmmoType | null {
    if (this.reloading > 0 || this.cooldown > 0) return null;
    if (this.hopper <= 0) {
      if (this.reserve > 0) this.startReload(L);
      else { audio.play('dry', { vol: 0.8 }); this.cooldown = 0.3; }
      return null;
    }
    const type = this.ammo;
    if (type !== 'standard') {
      this.specials[type]--;
      if (this.specials[type] <= 0) this.ammo = 'standard';
    }
    this.hopper--;
    this.cooldown = L.fireInterval;
    this.kick = 1;
    this.pumpT = 0;
    this.shots++;
    audio.play('shot', { vol: 0.9, jitter: 0.05 });
    if (!L.semiAuto) setTimeout(() => audio.play('pump', { vol: 0.7 }), 160);
    if (this.hopper % 4 === 0) audio.play('hopper', { vol: 0.35 });
    this.updateHopperBalls();
    (this.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = 0.9;
    (this.muzzleFlash.material as THREE.MeshBasicMaterial).color.setHex(this.color === 0 ? 0xffffff : this.color);
    return type;
  }

  update(dt: number, L: Loadout, moving: number, lookDelta: THREE.Vector2, flash: boolean) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      const prog = 1 - Math.max(0, this.reloading) / this.reloadTotal;
      const target = Math.min(L.hopper, this.hopper + this.reserve);
      this.updateHopperBalls(this.hopper + (target - this.hopper) * prog);
      if (this.reloading <= 0) {
        const need = L.hopper - this.hopper;
        const take = Math.min(need, this.reserve);
        this.hopper += take;
        this.reserve -= take;
        this.reloading = 0;
        this.updateHopperBalls();
      }
    }
    this.kick = Math.max(0, this.kick - dt * 7);
    this.pumpT = Math.min(1, this.pumpT + dt / Math.max(0.15, L.fireInterval * 0.8));
    const fm = this.muzzleFlash.material as THREE.MeshBasicMaterial;
    fm.opacity = Math.max(0, fm.opacity - dt * 14);
    // sway & bob
    this.sway.x += (-lookDelta.x * 0.0009 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (lookDelta.y * 0.0009 - this.sway.y) * Math.min(1, dt * 10);
    this.bob += dt * (moving > 0.1 ? 9 : 1.6);
    const bobA = moving > 0.1 ? 0.012 : 0.003;
    const reloadDip = this.reloading > 0 ? Math.sin(Math.min(1, 1 - this.reloading / this.reloadTotal) * Math.PI) : 0;
    this.gun.position.set(
      0.2 + this.sway.x + Math.cos(this.bob) * bobA,
      -0.2 + this.sway.y + Math.abs(Math.sin(this.bob)) * bobA - reloadDip * 0.08 - this.lowered * 0.3,
      -0.46 + this.kick * 0.05,
    );
    this.gun.rotation.set(this.kick * 0.12 + reloadDip * 0.5, 0.04 + this.sway.x * 2, reloadDip * 0.6);
    // pump stroke: back then forward
    if (!L.semiAuto) {
      const p = this.pumpT < 1 ? Math.sin(this.pumpT * Math.PI) : 0;
      this.pump.position.z = -0.24 + p * 0.08;
    } else this.pump.position.z = -0.24;
    (this.lens.material as THREE.MeshBasicMaterial).color.setHex(flash ? 0xfff6d8 : 0x333333);
    this.flashBeam.visible = flash;
  }
}

/** Pool of live paintballs, rendered as instanced emissive spheres. */
export class ProjectilePool {
  list: Projectile[] = [];
  mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.032, 8, 6), new THREE.MeshBasicMaterial({ fog: false }), 96);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < 96; i++) this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  spawn(pos: THREE.Vector3, vel: THREE.Vector3, type: AmmoType, color: number, thrown?: 'hotdog') {
    let p = this.list.find((q) => !q.alive);
    if (!p) {
      if (this.list.length >= 96) return null;
      p = { pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), type, color, life: 0, alive: false };
      this.list.push(p);
    }
    p.pos.copy(pos);
    p.prev.copy(pos);
    p.vel.copy(vel);
    p.type = type;
    p.color = color;
    p.life = 4;
    p.alive = true;
    p.thrown = thrown;
    return p;
  }
  sync() {
    let n = 0;
    for (const p of this.list) {
      if (!p.alive) continue;
      const s = p.thrown ? 3.5 : 1;
      this.m.makeScale(s, p.thrown ? 1.2 : s, s).setPosition(p.pos);
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, this.c.setHex(p.thrown ? 0xc0574a : p.color));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { for (const p of this.list) p.alive = false; this.sync(); }
}
