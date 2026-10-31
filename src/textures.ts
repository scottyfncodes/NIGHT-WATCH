import * as THREE from 'three';

// Deterministic PRNG so the forest looks the same every night.
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Forest floor: dense loblolly pine straw over dark soil. */
export function pineStrawTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512);
  const r = rng(11);
  g.fillStyle = '#2a2018';
  g.fillRect(0, 0, 512, 512);
  // soil mottling
  for (let i = 0; i < 260; i++) {
    const x = r() * 512, y = r() * 512, rad = 8 + r() * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const shade = r() < 0.5 ? 'rgba(18,13,9,0.5)' : 'rgba(64,48,32,0.35)';
    grd.addColorStop(0, shade);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // pine needles, layered
  const cols = ['#7a5432', '#94663b', '#5e4029', '#a87a48', '#6b4a2c', '#4a3422', '#b58955'];
  for (let i = 0; i < 5200; i++) {
    const x = r() * 512, y = r() * 512;
    const a = r() * Math.PI * 2;
    const len = 10 + r() * 26;
    g.strokeStyle = cols[(r() * cols.length) | 0];
    g.globalAlpha = 0.5 + r() * 0.5;
    g.lineWidth = 0.8 + r() * 1.1;
    g.beginPath();
    g.moveTo(x, y);
    const bend = (r() - 0.5) * 6;
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + bend, y + Math.sin(a) * len * 0.5 - bend, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
    // wrap edges for tiling
    if (x < 30 || y < 30) {
      g.beginPath();
      g.moveTo(x + 512, y + (y < 30 ? 512 : 0));
      g.lineTo(x + 512 + Math.cos(a) * len, y + (y < 30 ? 512 : 0) + Math.sin(a) * len);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  // a few oak leaves
  for (let i = 0; i < 40; i++) {
    const x = r() * 512, y = r() * 512;
    g.fillStyle = ['#5a3a1c', '#6e4a20', '#3e2a14'][(r() * 3) | 0];
    g.beginPath();
    g.ellipse(x, y, 5 + r() * 4, 3 + r() * 2, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, 18);
}

/** Packed dirt of the campsite clearing (radial alpha). */
export function clearingTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512);
  const r = rng(5);
  const grd = g.createRadialGradient(256, 256, 40, 256, 256, 256);
  grd.addColorStop(0, 'rgba(70,56,42,1)');
  grd.addColorStop(0.6, 'rgba(60,46,34,0.85)');
  grd.addColorStop(1, 'rgba(50,38,28,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1800; i++) {
    const x = r() * 512, y = r() * 512;
    const d = Math.hypot(x - 256, y - 256) / 256;
    if (d > 1) continue;
    g.fillStyle = `rgba(${90 + r() * 50},${70 + r() * 40},${50 + r() * 30},${(1 - d) * 0.6})`;
    g.fillRect(x, y, 1 + r() * 2, 1 + r() * 2);
  }
  for (let i = 0; i < 600; i++) {
    const x = r() * 512, y = r() * 512;
    const d = Math.hypot(x - 256, y - 256) / 256;
    if (d > 1) continue;
    g.strokeStyle = `rgba(150,110,65,${(1 - d) * 0.7})`;
    g.lineWidth = 1;
    const a = r() * 6.28, len = 6 + r() * 14;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  const t = tex(c, 1);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Ridged pine bark. */
export function barkTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  const r = rng(7);
  g.fillStyle = '#3b2c22';
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 110; i++) {
    const x = r() * 128, y = r() * 256, w = 10 + r() * 24, h = 14 + r() * 40;
    g.fillStyle = r() < 0.5 ? '#5a4232' : '#4a372a';
    g.beginPath();
    g.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1d1511';
    g.lineWidth = 2;
    g.stroke();
  }
  return tex(c, 1);
}

/** 90s dome tent nylon: teal with purple trim stripe. */
export function nylonTexture(base = '#2f6f6a', trim = '#5b3a73'): THREE.CanvasTexture {
  const [c, g] = canvas(256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  // ripstop grid
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 1;
  for (let i = 0; i < 256; i += 8) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
  }
  // trim band at bottom
  g.fillStyle = trim;
  g.fillRect(0, 214, 256, 42);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, 212, 256, 3);
  return tex(c, 1);
}

/** Bug mesh: see-through dark grid. */
export function meshTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128);
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(10,14,16,0.35)';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(25,30,30,0.95)';
  g.lineWidth = 1;
  for (let i = 0; i <= 128; i += 4) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
  }
  const t = tex(c, 3);
  return t;
}

/** Paint splat alpha mask (white, tinted per-instance). */
export function splatTexture(seed = 3): THREE.CanvasTexture {
  const [c, g] = canvas(128);
  const r = rng(seed);
  g.fillStyle = '#fff';
  g.beginPath();
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = 26 + r() * 16;
    const x = 64 + Math.cos(a) * rad, y = 64 + Math.sin(a) * rad;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.fill();
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2, d = 34 + r() * 26, s = 2 + r() * 7;
    g.beginPath();
    g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, s, 0, Math.PI * 2);
    g.fill();
    // drip streaks
    if (r() < 0.4) {
      g.lineWidth = s * 0.7;
      g.strokeStyle = '#fff';
      g.beginPath();
      g.moveTo(64 + Math.cos(a) * 20, 64 + Math.sin(a) * 20);
      g.lineTo(64 + Math.cos(a) * d, 64 + Math.sin(a) * d);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Soft radial glow for eyes, fireflies, lantern halos. */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Moon disc with maria. */
export function moonTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256);
  const glow = g.createRadialGradient(128, 128, 40, 128, 128, 128);
  glow.addColorStop(0, 'rgba(220,230,255,0.55)');
  glow.addColorStop(0.5, 'rgba(160,180,230,0.12)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#e9eef5';
  g.beginPath();
  g.arc(128, 128, 44, 0, Math.PI * 2);
  g.fill();
  const r = rng(9);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(150,160,180,${0.25 + r() * 0.3})`;
    g.beginPath();
    g.arc(100 + r() * 56, 100 + r() * 56, 4 + r() * 10, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}

/** Pop-up camper canvas: cream with screened windows (lit warm from inside). */
export function camperCanvasTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#b9ad8f';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let i = 0; i < 512; i += 6) g.fillRect(i, 0, 1, 128);
  // windows
  for (const x of [40, 210, 380]) {
    const grd = g.createLinearGradient(0, 22, 0, 100);
    grd.addColorStop(0, '#ffcf7a');
    grd.addColorStop(1, '#e08a3a');
    g.fillStyle = grd;
    g.fillRect(x, 24, 96, 70);
    g.strokeStyle = 'rgba(30,20,10,0.6)';
    g.lineWidth = 1;
    for (let i = 0; i < 96; i += 4) { g.beginPath(); g.moveTo(x + i, 24); g.lineTo(x + i, 94); g.stroke(); }
    for (let i = 0; i < 70; i += 4) { g.beginPath(); g.moveTo(x, 24 + i); g.lineTo(x + 96, 24 + i); g.stroke(); }
    g.strokeStyle = '#6b5a3c';
    g.lineWidth = 4;
    g.strokeRect(x, 24, 96, 70);
  }
  g.fillStyle = '#7a3b25';
  g.fillRect(0, 112, 512, 16);
  return tex(c, 1);
}

/** Wood planks. */
export function woodTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256);
  const r = rng(21);
  g.fillStyle = '#6a4a2e';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = `rgba(${40 + r() * 40},${25 + r() * 25},${12 + r() * 15},0.5)`;
    g.lineWidth = 1 + r() * 2;
    const y = r() * 256;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(80, y + (r() - 0.5) * 8, 170, y + (r() - 0.5) * 8, 256, y);
    g.stroke();
  }
  for (let i = 0; i < 256; i += 64) {
    g.fillStyle = 'rgba(20,12,6,0.8)';
    g.fillRect(0, i, 256, 3);
  }
  return tex(c, 1);
}

/** Grizzled fur noise, used as vertex-colour modulation map. */
export function furTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128);
  const r = rng(33);
  g.fillStyle = '#c8c8c8';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) {
    const v = 140 + r() * 115;
    g.fillStyle = `rgb(${v},${v},${v})`;
    const x = r() * 128, y = r() * 128;
    g.fillRect(x, y, 1, 2 + r() * 3);
  }
  return tex(c, 2);
}

/** Grass tuft alpha card. */
export function grassTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64);
  const r = rng(77);
  for (let i = 0; i < 26; i++) {
    const x = 8 + r() * 48;
    g.strokeStyle = ['#3d5a2a', '#55722e', '#2e4520', '#6b7d34'][(r() * 4) | 0];
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, 64);
    g.quadraticCurveTo(x + (r() - 0.5) * 10, 40, x + (r() - 0.5) * 22, 8 + r() * 26);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

/** Film-grain overlay (CSS background). */
export function grainDataURL(): string {
  const [c, g] = canvas(128);
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 22;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}
