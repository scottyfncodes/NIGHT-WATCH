import * as THREE from 'three';
import { LAYOUT } from '../config';
import { nylonTexture, meshTexture } from '../textures';

export type OpeningId = 'front' | 'rear' | 'left' | 'right';
export type OpeningState = 'mesh' | 'open' | 'torn';

export interface Opening {
  id: OpeningId;
  label: string;
  isDoor: boolean;
  state: OpeningState;
  tear: number; // 0..1 scratching progress
  repair: number; // 0..1 duct tape progress
  normal: THREE.Vector3; // outward
  center: THREE.Vector3; // world centre of opening
  u0: number; u1: number; v0: number; v1: number; // opening rect along face (u = tangent coord, v = height)
  panel: THREE.Mesh;
  flap: THREE.Mesh;
  shreds: THREE.Group;
  wall: number; // wall index
  bulge: number; // visual push from scratching
  occupant: unknown | null; // raccoon currently attacking it
}

const H = LAYOUT.tentHalf;
const W = LAYOUT.tentWall;
const P = LAYOUT.tentPeak;

/** Height of the tent shell at (x,z) in local coordinates. */
export function tentHeight(x: number, z: number): number {
  const m = Math.max(Math.abs(x), Math.abs(z));
  if (m > H) return 0;
  return W + (P - W) * (1 - m / H);
}

export class Tent {
  group = new THREE.Group();
  openings: Opening[] = [];
  walls: { mesh: THREE.Mesh; normal: THREE.Vector3; w: number; v: number; base: THREE.Vector3 }[] = [];
  roof: THREE.Mesh;
  private roofBase: Float32Array;
  roofWobble = 0;
  roofWobbleV = 0;
  dent = new THREE.Vector3();
  dentStrength = 0;
  private meshMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const wallTex = nylonTexture();
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.75, side: THREE.DoubleSide });
    const roofTex = nylonTexture('#2c6a66', '#2c6a66');
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.7, side: THREE.DoubleSide, color: 0xd8e8e4 });
    this.meshMat = new THREE.MeshBasicMaterial({ map: meshTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false, color: 0xffffff });
    const flapMat = new THREE.MeshStandardMaterial({ color: 0x2b5f5b, roughness: 0.8 });

    // opening rects in face-local (u along face tangent, v up)
    const rects: Record<OpeningId, [number, number, number, number]> = {
      front: [-0.55, 0.55, 0.06, 1.04],
      rear: [-0.55, 0.55, 0.06, 1.04],
      left: [-0.45, 0.45, 0.42, 0.95],
      right: [-0.45, 0.45, 0.42, 0.95],
    };
    const faces: { id: OpeningId; normal: THREE.Vector3; label: string }[] = [
      { id: 'front', normal: new THREE.Vector3(0, 0, -1), label: 'front door' },
      { id: 'right', normal: new THREE.Vector3(1, 0, 0), label: 'right window' },
      { id: 'rear', normal: new THREE.Vector3(0, 0, 1), label: 'back door' },
      { id: 'left', normal: new THREE.Vector3(-1, 0, 0), label: 'left window' },
    ];

    faces.forEach((f, wi) => {
      const [u0, u1, v0, v1] = rects[f.id];
      const shape = new THREE.Shape();
      shape.moveTo(-H, 0); shape.lineTo(H, 0); shape.lineTo(H, W); shape.lineTo(-H, W); shape.lineTo(-H, 0);
      const hole = new THREE.Path();
      hole.moveTo(u0, v0); hole.lineTo(u0, v1); hole.lineTo(u1, v1); hole.lineTo(u1, v0); hole.lineTo(u0, v0);
      shape.holes.push(hole);
      const geo = new THREE.ShapeGeometry(shape);
      const wall = new THREE.Mesh(geo, wallMat);
      // orient: shape lies in XY facing +Z. Rotate so its normal = f.normal, placed at distance H.
      const yaw = Math.atan2(f.normal.x, f.normal.z);
      wall.rotation.y = yaw;
      wall.position.copy(f.normal).multiplyScalar(H);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
      this.walls.push({ mesh: wall, normal: f.normal.clone(), w: 0, v: 0, base: wall.position.clone() });

      // mesh panel
      const pw = u1 - u0, ph = v1 - v0;
      const panelGeo = new THREE.PlaneGeometry(pw, ph, 4, 4);
      const panel = new THREE.Mesh(panelGeo, this.meshMat);
      panel.position.set((u0 + u1) / 2, (v0 + v1) / 2, 0.005);
      wall.add(panel);
      // rolled-up flap (visible when open)
      const flap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, pw * 0.95, 8).rotateZ(Math.PI / 2), flapMat);
      flap.position.set((u0 + u1) / 2, v1 + 0.02, 0.06);
      wall.add(flap);
      // torn shreds
      const shreds = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const len = ph * (0.25 + Math.random() * 0.4);
        const s = new THREE.Mesh(new THREE.PlaneGeometry(pw / 5, len), this.meshMat);
        s.position.set(u0 + pw * (0.12 + k * 0.25), v1 - len / 2, 0.01);
        s.rotation.z = (Math.random() - 0.5) * 0.3;
        shreds.add(s);
      }
      shreds.visible = false;
      wall.add(shreds);

      const center = f.normal.clone().multiplyScalar(H);
      center.y = (v0 + v1) / 2;
      const op: Opening = {
        id: f.id, label: f.label, isDoor: f.id === 'front' || f.id === 'rear',
        state: f.id === 'front' ? 'open' : 'mesh', tear: 0, repair: 0,
        normal: f.normal.clone(), center, u0, u1, v0, v1, panel, flap, shreds, wall: wi, bulge: 0, occupant: null,
      };
      this.openings.push(op);
      this.applyState(op);
    });

    // Roof: 4 subdivided triangles to the peak, so it can dent under a climbing raccoon.
    const N = 8;
    const pos: number[] = [];
    const uv: number[] = [];
    const corners = [
      [-H, -H], [H, -H], [H, H], [-H, H],
    ];
    for (let f = 0; f < 4; f++) {
      const [ax, az] = corners[f];
      const [bx, bz] = corners[(f + 1) % 4];
      const A = new THREE.Vector3(ax, W, az), B = new THREE.Vector3(bx, W, bz), C = new THREE.Vector3(0, P, 0);
      const pt = (i: number, j: number) => {
        // i along base, j toward apex
        const a = 1 - (i + j) / N;
        const b = i / N;
        const c = j / N;
        return new THREE.Vector3().addScaledVector(A, a).addScaledVector(B, b).addScaledVector(C, c);
      };
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N - j; i++) {
          const p1 = pt(i, j), p2 = pt(i + 1, j), p3 = pt(i, j + 1);
          pos.push(...p1.toArray(), ...p2.toArray(), ...p3.toArray());
          uv.push(p1.x + p1.z, p1.y * 1.5, p2.x + p2.z, p2.y * 1.5, p3.x + p3.z, p3.y * 1.5);
          if (i < N - j - 1) {
            const p4 = pt(i + 1, j + 1);
            pos.push(...p2.toArray(), ...p4.toArray(), ...p3.toArray());
            uv.push(p2.x + p2.z, p2.y * 1.5, p4.x + p4.z, p4.y * 1.5, p3.x + p3.z, p3.y * 1.5);
          }
        }
      }
    }
    const roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    roofGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    roofGeo.computeVertexNormals();
    this.roofBase = new Float32Array(pos);
    this.roof = new THREE.Mesh(roofGeo, roofMat);
    this.roof.castShadow = true;
    this.group.add(this.roof);

    // Poles along roof edges + stakes and guy lines
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.4, roughness: 0.5 });
    for (const [cx, cz] of corners) {
      const a = new THREE.Vector3(cx * 1.01, W, cz * 1.01), b = new THREE.Vector3(0, P + 0.02, 0);
      const len = a.distanceTo(b);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 5), poleMat);
      pole.position.copy(a).add(b).multiplyScalar(0.5);
      pole.lookAt(b);
      pole.rotateX(Math.PI / 2);
      this.group.add(pole);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, W, 5), poleMat);
      leg.position.set(cx * 1.01, W / 2, cz * 1.01);
      this.group.add(leg);
      // guy line
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx * 1.01, W, cz * 1.01), new THREE.Vector3(cx * 1.9, 0.02, cz * 1.9)]);
      this.group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd8c9a0, transparent: true, opacity: 0.5 })));
      const stake = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.15, 4), poleMat);
      stake.position.set(cx * 1.9, 0.05, cz * 1.9);
      stake.rotation.x = Math.PI;
      this.group.add(stake);
    }

    // Interior: floor tarp, sleeping bag, pillow, comic, backpack
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2d3b4f, roughness: 0.9 }));
    floor.position.y = 0.015;
    floor.receiveShadow = true;
    this.group.add(floor);
    const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.2, 4, 10).rotateX(Math.PI / 2).scale(1, 0.32, 1), new THREE.MeshStandardMaterial({ color: 0x8a2a24, roughness: 0.9 }));
    bag.position.set(-0.45, 0.08, 0.35);
    this.group.add(bag);
    const lining = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5f6e3a, roughness: 1 }));
    lining.position.set(-0.45, 0.19, -0.2);
    this.group.add(lining);
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: 0xd6cfb8, roughness: 1 }));
    pillow.position.set(-0.45, 0.07, 0.98);
    this.group.add(pillow);
    const comic = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.01, 0.26), new THREE.MeshStandardMaterial({ color: 0xd94b2b }));
    comic.position.set(0.5, 0.03, 0.6);
    comic.rotation.y = 0.4;
    this.group.add(comic);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.45, 0.24), new THREE.MeshStandardMaterial({ color: 0x7a5aa0, roughness: 0.9 }));
    pack.position.set(0.75, 0.23, 0.85);
    pack.rotation.y = -0.3;
    this.group.add(pack);
    const gameboy = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.15), new THREE.MeshStandardMaterial({ color: 0x9a9a8e }));
    gameboy.position.set(0.35, 0.03, 0.95);
    this.group.add(gameboy);
  }

  applyState(op: Opening) {
    op.panel.visible = op.state === 'mesh';
    op.flap.visible = op.state === 'open';
    op.shreds.visible = op.state === 'torn';
  }

  setState(op: Opening, s: OpeningState) {
    op.state = s;
    if (s !== 'torn') op.tear = 0;
    op.repair = 0;
    this.applyState(op);
  }

  reset() {
    for (const op of this.openings) {
      this.setState(op, op.id === 'front' ? 'open' : 'mesh');
      op.occupant = null;
      op.bulge = 0;
    }
    this.dentStrength = 0;
  }

  static isInside(p: THREE.Vector3, margin = 0): boolean {
    if (Math.abs(p.x) > H + margin || Math.abs(p.z) > H + margin) return false;
    return p.y < tentHeight(p.x, p.z) + margin && p.y > -0.1;
  }

  /** Which opening (if any) is at this boundary point. */
  openingAt(p: THREE.Vector3): Opening | null {
    if (p.y > W) return null;
    const ax = Math.abs(p.x), az = Math.abs(p.z);
    let id: OpeningId;
    let u: number;
    if (az >= ax) { id = p.z < 0 ? 'front' : 'rear'; u = p.x; }
    else { id = p.x > 0 ? 'right' : 'left'; u = p.z; }
    const op = this.openings.find((o) => o.id === id)!;
    if (u > op.u0 && u < op.u1 && p.y > op.v0 && p.y < op.v1) return op;
    return null;
  }

  faceNormal(p: THREE.Vector3): THREE.Vector3 {
    if (p.y > W - 0.02) {
      const ax = Math.abs(p.x), az = Math.abs(p.z);
      const n = az >= ax ? new THREE.Vector3(0, 0.55, Math.sign(p.z)) : new THREE.Vector3(Math.sign(p.x), 0.55, 0);
      return n.normalize();
    }
    const ax = Math.abs(p.x), az = Math.abs(p.z);
    return az >= ax ? new THREE.Vector3(0, 0, Math.sign(p.z) || 1) : new THREE.Vector3(Math.sign(p.x) || 1, 0, 0);
  }

  /**
   * Segment test against the tent shell. Returns null if the segment doesn't cross
   * fabric (no crossing, or it passed through an open/torn opening).
   */
  crossFabric(a: THREE.Vector3, b: THREE.Vector3): { point: THREE.Vector3; normal: THREE.Vector3; roof: boolean; opening: Opening | null } | null {
    const ia = Tent.isInside(a), ib = Tent.isInside(b);
    if (ia === ib) return null;
    let lo = 0, hi = 1;
    const p = new THREE.Vector3();
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      p.lerpVectors(a, b, mid);
      if (Tent.isInside(p) === ia) lo = mid; else hi = mid;
    }
    p.lerpVectors(a, b, (lo + hi) / 2);
    const op = this.openingAt(p);
    if (op && op.state !== 'mesh') return null;
    return { point: p.clone(), normal: this.faceNormal(p), roof: p.y > W - 0.02, opening: op };
  }

  /** Can a body at height y move from a to b (xz only)? Doors for the player, any opening for raccoons. */
  canPass(a: THREE.Vector3, b: THREE.Vector3, y: number, windowsToo: boolean): boolean {
    const A = new THREE.Vector3(a.x, y, a.z), B = new THREE.Vector3(b.x, y, b.z);
    const ia = Tent.isInside(A, 0.12), ib = Tent.isInside(B, 0.12);
    if (ia === ib) return true;
    // find crossing on the actual shell
    let lo = 0, hi = 1;
    const p = new THREE.Vector3();
    const inA = Tent.isInside(A);
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      p.lerpVectors(A, B, mid);
      if (Tent.isInside(p) === inA) lo = mid; else hi = mid;
    }
    // generous: check opening on the face with the rect's horizontal extent only for doors
    const ax = Math.abs(p.x), az = Math.abs(p.z);
    let id: OpeningId, u: number;
    if (az >= ax) { id = p.z < 0 ? 'front' : 'rear'; u = p.x; } else { id = p.x > 0 ? 'right' : 'left'; u = p.z; }
    const op = this.openings.find((o) => o.id === id)!;
    if (op.state === 'mesh') return false;
    if (!op.isDoor && !windowsToo) return false;
    return u > op.u0 + 0.08 && u < op.u1 - 0.08;
  }

  impact(p: THREE.Vector3, strength = 1) {
    if (p.y > W - 0.05) {
      this.roofWobbleV += strength * 2.5;
      return;
    }
    const n = this.faceNormal(p);
    for (const w of this.walls) if (w.normal.dot(n) > 0.9) w.v += strength * 3;
  }

  update(dt: number, t: number) {
    for (const w of this.walls) {
      // damped spring
      w.v += (-w.w * 90 - w.v * 9) * dt;
      w.w += w.v * dt;
      w.mesh.position.copy(w.base).addScaledVector(w.normal, -w.w * 0.05);
    }
    for (const op of this.openings) {
      const target = op.occupant && op.state === 'mesh' ? 1 : 0;
      op.bulge += (target - op.bulge) * Math.min(1, dt * 6);
      op.panel.position.z = 0.005 - op.bulge * (0.05 + 0.04 * Math.sin(t * 22));
      op.panel.scale.set(1, 1, 1);
      if (op.state === 'torn') op.shreds.children.forEach((s, k) => (s.rotation.z = Math.sin(t * 2 + k) * 0.15));
    }
    this.roofWobbleV += (-this.roofWobble * 70 - this.roofWobbleV * 7) * dt;
    this.roofWobble += this.roofWobbleV * dt;
    // roof dent
    const attr = this.roof.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const base = this.roofBase;
    const ds = this.dentStrength;
    const wob = this.roofWobble;
    if (ds > 0.001 || Math.abs(wob) > 0.0005 || this.wasDeformed) {
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i], y = base[i + 1], z = base[i + 2];
        const lift = (y - W) / (P - W); // 0 at eaves, 1 at peak
        const dx = x - this.dent.x, dz = z - this.dent.z;
        const d = ds * Math.exp(-(dx * dx + dz * dz) / 0.18) * lift;
        arr[i] = x; arr[i + 1] = y - d * 0.42 + wob * 0.06 * lift; arr[i + 2] = z;
      }
      attr.needsUpdate = true;
      this.roof.geometry.computeVertexNormals();
      this.wasDeformed = ds > 0.001 || Math.abs(wob) > 0.0005;
    }
  }
  private wasDeformed = false;
}
