import { UPGRADES, UpgradeId, PAINT_COLORS } from './config';

export interface Settings {
  volume: number; // 0..1
  ambience: number; // 0..1
  sensitivity: number; // mouse
  touchSensitivity: number;
  invertY: boolean;
  quality: 'low' | 'medium' | 'high';
  hints: boolean;
}

export interface SaveData {
  version: 1;
  supplies: number;
  night: number; // next night to play
  upgrades: Partial<Record<UpgradeId, number>>;
  paint: string;
  bestNight: number;
  totalDeterred: number;
  seenIntro: boolean;
  settings: Settings;
}

const KEY = 'nightwatch.save.v1';

function isMobile(): boolean {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export function defaultSave(): SaveData {
  return {
    version: 1,
    supplies: 0,
    night: 1,
    upgrades: {},
    paint: 'pink',
    bestNight: 0,
    totalDeterred: 0,
    seenIntro: false,
    settings: {
      volume: 0.85,
      ambience: 0.8,
      sensitivity: 1,
      touchSensitivity: 1,
      invertY: false,
      quality: isMobile() ? 'medium' : 'high',
      hints: true,
    },
  };
}

export function loadSave(storage: Pick<Storage, 'getItem'> | null = safeStorage()): SaveData {
  const base = defaultSave();
  if (!storage) return base;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}) }, upgrades: { ...(parsed.upgrades || {}) } };
  } catch {
    return base;
  }
}

export function writeSave(data: SaveData, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable (private mode) — progress lives for this session only */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function level(save: SaveData, id: UpgradeId): number {
  return save.upgrades[id] ?? 0;
}

export function nextCost(save: SaveData, id: UpgradeId): number | null {
  const def = UPGRADES.find((u) => u.id === id)!;
  const lv = level(save, id);
  return lv >= def.costs.length ? null : def.costs[lv];
}

export function purchase(save: SaveData, id: UpgradeId): boolean {
  const cost = nextCost(save, id);
  if (cost === null || save.supplies < cost) return false;
  save.supplies -= cost;
  save.upgrades[id] = level(save, id) + 1;
  return true;
}

/** All gameplay numbers derived from purchased upgrades. */
export interface Loadout {
  semiAuto: boolean;
  fireInterval: number;
  hopper: number;
  reload: number;
  spread: number; // radians
  moveSpreadMul: number;
  muzzle: number; // m/s
  reserve: number;
  specials: { glow: number; sticky: number; burst: number; decoy: number };
  glowTime: number;
  stickyTime: number;
  burstRadius: number;
  tearMul: number; // mesh tear time multiplier
  repairTime: number;
  bungeeTime: number;
  bungeeMul: number;
  autoStrap: boolean;
  tripwires: number;
  motion: boolean;
  beamRange: number;
  beamAngle: number;
  battery: number; // seconds
  freezeTime: number;
  hotdog: boolean;
  pots: number;
  paint: number;
}

export function computeLoadout(save: SaveData): Loadout {
  const L = (id: UpgradeId) => level(save, id);
  const semi = L('semiauto') > 0;
  const barrel = L('barrel');
  const paint = PAINT_COLORS.find((p) => p.id === save.paint) ?? PAINT_COLORS[0];
  return {
    semiAuto: semi,
    fireInterval: semi ? 0.19 : 0.6,
    hopper: [12, 20, 30, 45][L('hopper')],
    reload: [2.3, 1.6, 1.0][L('loader')],
    spread: [0.026, 0.017, 0.0105][barrel],
    moveSpreadMul: barrel >= 2 ? 1.25 : 1.9,
    muzzle: [40, 48, 56][barrel],
    reserve: 150 + [0, 40, 80, 130][L('extraPaint')],
    specials: {
      glow: [0, 10, 18][L('glow')],
      sticky: [0, 8, 14][L('sticky')],
      burst: [0, 5, 9][L('burst')],
      decoy: [0, 6][L('decoyRounds')],
    },
    glowTime: L('glow') >= 2 ? 30 : 15,
    stickyTime: L('sticky') >= 2 ? 6 : 4,
    burstRadius: L('burst') >= 2 ? 3.4 : 2.6,
    tearMul: [1, 1.75, 2.5][L('ripstop')],
    repairTime: L('ripstop') > 0 ? 1.0 : 2.0,
    bungeeTime: [16, 30, 45][L('coolerLock')],
    bungeeMul: L('coolerLock') > 0 ? 4 : 2.5,
    autoStrap: L('coolerLock') >= 2,
    tripwires: L('tripwire'),
    motion: L('motion') > 0,
    beamRange: [17, 24, 30][L('maglite')],
    beamAngle: [0.36, 0.44, 0.52][L('maglite')],
    battery: [70, 112, 140][L('maglite')],
    freezeTime: L('maglite') >= 2 ? 1.1 : 0.55,
    hotdog: L('hotdog') > 0,
    pots: L('pots') > 0 ? 2 : 0,
    paint: paint.hex,
  };
}

/** Supplies awarded at the end of a night. */
export interface NightStats {
  won: boolean;
  wavesCleared: number;
  food: number;
  deterred: number;
  tanks: number;
  boss: boolean;
  shots: number;
  hits: number;
}

export function computeReward(s: NightStats): { total: number; lines: [string, number][] } {
  const lines: [string, number][] = [];
  lines.push(['Raccoons deterred', s.deterred * 6 + s.tanks * 6]);
  if (s.boss) lines.push(['Big Earl ran off', 60]);
  lines.push(['Food saved', Math.round(s.food * 0.8)]);
  const acc = s.shots > 0 ? s.hits / s.shots : 0;
  lines.push(['Accuracy bonus', Math.round(acc * 50)]);
  if (s.won) lines.push(['Made it to sunrise', 60]);
  else lines.push(['Waves survived', s.wavesCleared * 10]);
  const total = lines.reduce((a, [, v]) => a + v, 0);
  return { total, lines };
}
