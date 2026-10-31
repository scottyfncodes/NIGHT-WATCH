// ─────────────────────────────────────────────────────────────
// NIGHT WATCH — tunable game data
// ─────────────────────────────────────────────────────────────

export type ArchetypeId = 'visitor' | 'scout' | 'bandit' | 'sneak' | 'tank' | 'acrobat' | 'distraction' | 'boss';

export interface Archetype {
  id: ArchetypeId;
  name: string;
  scale: number;
  walk: number; // m/s
  run: number; // m/s
  resolve: number; // paint hits before deterred
  stun: number; // seconds stunned per hit
  knockback: number; // multiplier
  fear: number; // flees if player closer than this (outside tent). 0 = fearless
  openTime: number; // seconds to open cooler lid
  steal: number; // food taken per raid
  maxRaids: number;
  furA: number; // main fur color
  furB: number; // belly / light fur
  mask: number;
  eye: number; // eyeshine color
  pitch: number; // voice pitch multiplier
  loot: 'marshmallows' | 'chips' | 'hotdogs' | 'bread' | 'soda';
}

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  visitor: {
    id: 'visitor', name: 'The Visitor', scale: 1.0, walk: 1.1, run: 3.6, resolve: 2, stun: 1.1, knockback: 1,
    fear: 0, openTime: 2.6, steal: 6, maxRaids: 99, furA: 0x6f6a62, furB: 0xb8b1a3, mask: 0x1b1816, eye: 0xd8ff7a, pitch: 1, loot: 'marshmallows',
  },
  scout: {
    id: 'scout', name: 'Scout', scale: 0.78, walk: 1.7, run: 5.4, resolve: 1, stun: 0.9, knockback: 1.3,
    fear: 3.6, openTime: 1.2, steal: 4, maxRaids: 3, furA: 0x7c766b, furB: 0xc9c1b0, mask: 0x231e1b, eye: 0xf2ff8a, pitch: 1.35, loot: 'marshmallows',
  },
  bandit: {
    id: 'bandit', name: 'Bandit', scale: 1.0, walk: 1.5, run: 4.3, resolve: 2, stun: 1.0, knockback: 1,
    fear: 2.4, openTime: 1.7, steal: 9, maxRaids: 3, furA: 0x5f5a53, furB: 0xaaa293, mask: 0x0f0d0c, eye: 0xc8ff5e, pitch: 1.0, loot: 'chips',
  },
  sneak: {
    id: 'sneak', name: 'Sneak', scale: 0.92, walk: 1.0, run: 4.0, resolve: 2, stun: 0.9, knockback: 1.1,
    fear: 2.0, openTime: 1.5, steal: 6, maxRaids: 3, furA: 0x3f3c39, furB: 0x77716a, mask: 0x090807, eye: 0x9effc8, pitch: 0.9, loot: 'bread',
  },
  tank: {
    id: 'tank', name: 'Tank', scale: 1.42, walk: 1.05, run: 2.9, resolve: 5, stun: 0.4, knockback: 0.35,
    fear: 0, openTime: 0.9, steal: 14, maxRaids: 2, furA: 0x6a6157, furB: 0xa69c8b, mask: 0x141110, eye: 0xffd36a, pitch: 0.62, loot: 'hotdogs',
  },
  acrobat: {
    id: 'acrobat', name: 'Acrobat', scale: 0.9, walk: 1.9, run: 5.0, resolve: 2, stun: 0.9, knockback: 1.2,
    fear: 1.8, openTime: 1.3, steal: 6, maxRaids: 3, furA: 0x77705f, furB: 0xc2b89e, mask: 0x1c1813, eye: 0xe9ff6a, pitch: 1.2, loot: 'soda',
  },
  distraction: {
    id: 'distraction', name: 'Distraction', scale: 1.0, walk: 1.6, run: 4.4, resolve: 2, stun: 1.0, knockback: 1,
    fear: 3.0, openTime: 1.6, steal: 5, maxRaids: 1, furA: 0x6d675d, furB: 0xb3ab9b, mask: 0x1a1715, eye: 0xd2ff70, pitch: 1.1, loot: 'marshmallows',
  },
  boss: {
    id: 'boss', name: 'Big Earl', scale: 1.9, walk: 1.0, run: 2.6, resolve: 20, stun: 0.3, knockback: 0.2,
    fear: 0, openTime: 0.6, steal: 0, maxRaids: 99, furA: 0x5b544b, furB: 0x9b917f, mask: 0x0b0908, eye: 0xff9a4a, pitch: 0.5, loot: 'hotdogs',
  },
};

export interface SpawnDef {
  type: ArchetypeId;
  at: number; // seconds into the wave
  side?: number; // degrees, 0 = in front of the tent (-Z), 90 = right (+X), 180 = behind
  role?: 'pincer-noise' | 'pincer-raid';
}

export interface WaveDef {
  id: number;
  name: string;
  flavor: string;
  clockStart: number; // minutes after 10:00 PM
  clockEnd: number;
  spawns: SpawnDef[];
  resupply: number;
  isBoss?: boolean;
  duration?: number; // boss: seconds until sunrise
}

export const WAVES: WaveDef[] = [
  {
    id: 1, name: 'The Visitor', flavor: 'Something is in the cooler.', clockStart: 25, clockEnd: 70, resupply: 0,
    spawns: [{ type: 'visitor', at: 0, side: 8 }],
  },
  {
    id: 2, name: 'Company', flavor: 'It brought friends.', clockStart: 95, clockEnd: 150, resupply: 30,
    spawns: [
      { type: 'scout', at: 1.5, side: -55 },
      { type: 'bandit', at: 4.5, side: 60 },
      { type: 'scout', at: 9, side: 165 },
    ],
  },
  {
    id: 3, name: "They're Back", flavor: 'They want the chips.', clockStart: 185, clockEnd: 250, resupply: 45,
    spawns: [
      { type: 'bandit', at: 1, side: 20 },
      { type: 'scout', at: 3, side: -80 },
      { type: 'bandit', at: 6, side: 100 },
      { type: 'scout', at: 9, side: -150 },
      { type: 'bandit', at: 12, side: -20 },
    ],
  },
  {
    id: 4, name: 'Bad News', flavor: 'These ones are organized.', clockStart: 280, clockEnd: 345, resupply: 55,
    spawns: [
      { type: 'distraction', at: 1, side: -95, role: 'pincer-noise' },
      { type: 'bandit', at: 6, side: 75, role: 'pincer-raid' },
      { type: 'sneak', at: 8, side: 170 },
      { type: 'acrobat', at: 13, side: 130 },
      { type: 'tank', at: 18, side: 0 },
      { type: 'scout', at: 22, side: -40 },
    ],
  },
  {
    id: 5, name: 'The Raid', flavor: 'Eyes. Everywhere.', clockStart: 370, clockEnd: 430, resupply: 60,
    spawns: [
      { type: 'distraction', at: 1, side: 100, role: 'pincer-noise' },
      { type: 'bandit', at: 5, side: -70, role: 'pincer-raid' },
      { type: 'bandit', at: 5.6, side: -95, role: 'pincer-raid' },
      { type: 'scout', at: 6, side: -40, role: 'pincer-raid' },
      { type: 'sneak', at: 10, side: 185 },
      { type: 'acrobat', at: 14, side: -150 },
      { type: 'tank', at: 18, side: 30 },
      { type: 'bandit', at: 22, side: 140 },
      { type: 'scout', at: 25, side: 60 },
    ],
  },
  {
    id: 6, name: 'Big Earl', flavor: 'Hold the cooler until sunrise.', clockStart: 440, clockEnd: 480, resupply: 80, isBoss: true, duration: 110,
    spawns: [
      { type: 'boss', at: 3 },
      { type: 'scout', at: 9, side: -60 },
      { type: 'bandit', at: 14, side: 70 },
      { type: 'sneak', at: 22, side: 175 },
      { type: 'distraction', at: 30, side: -110, role: 'pincer-noise' },
      { type: 'bandit', at: 34, side: 95, role: 'pincer-raid' },
      { type: 'tank', at: 44, side: -15 },
      { type: 'acrobat', at: 52, side: 150 },
      { type: 'bandit', at: 62, side: -45 },
      { type: 'scout', at: 70, side: 40 },
      { type: 'bandit', at: 80, side: -120 },
      { type: 'tank', at: 90, side: 120 },
    ],
  },
];

// ─── Upgrades ──────────────────────────────────────────────

export type UpgradeId =
  | 'semiauto' | 'hopper' | 'loader' | 'barrel' | 'glow' | 'sticky' | 'burst' | 'decoyRounds'
  | 'ripstop' | 'coolerLock' | 'tripwire' | 'motion'
  | 'maglite' | 'extraPaint' | 'hotdog' | 'pots';

export interface UpgradeDef {
  id: UpgradeId;
  cat: 'weapon' | 'defense' | 'utility';
  name: string;
  costs: number[]; // cost per level
  desc: string[]; // description per level (what you get at that level)
  icon: string;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'semiauto', cat: 'weapon', name: 'Semi-Auto Conversion', icon: '⟫', costs: [170], desc: ['Swap the pump for a semi-auto valve. Hold to fire, ~3× faster.'] },
  { id: 'hopper', cat: 'weapon', name: 'Bigger Hopper', icon: '◍', costs: [60, 110, 170], desc: ['Hopper 12 → 20 balls.', 'Hopper 20 → 30 balls.', 'Hopper 30 → 45 balls.'] },
  { id: 'loader', cat: 'weapon', name: 'Speed Feeder', icon: '↻', costs: [70, 130], desc: ['Reload 2.3s → 1.6s.', 'Reload 1.6s → 1.0s.'] },
  { id: 'barrel', cat: 'weapon', name: 'Long Barrel', icon: '━', costs: [80, 140], desc: ['+20% muzzle velocity, −35% spread.', '+40% velocity, −60% spread, steadier while moving.'] },
  { id: 'glow', cat: 'weapon', name: 'Glow Rounds', icon: '✦', costs: [90, 70], desc: ['10 glow rounds per night. Tagged raccoons glow and can’t hide.', '18 glow rounds; glow lasts twice as long.'] },
  { id: 'sticky', cat: 'weapon', name: 'Sticky Rounds', icon: '❋', costs: [100, 70], desc: ['8 sticky rounds. Gooey paint slows raccoons 55% for 4s.', '14 sticky rounds; slow lasts 6s.'] },
  { id: 'burst', cat: 'weapon', name: 'Burst Rounds', icon: '✺', costs: [130, 90], desc: ['5 burst rounds. Splatter hits everything within 2.6m.', '9 burst rounds; 3.4m splash.'] },
  { id: 'decoyRounds', cat: 'weapon', name: 'BBQ Decoy Rounds', icon: '◎', costs: [80], desc: ['6 BBQ-scented rounds. Raccoons near the splat stop to sniff it for 6s.'] },
  { id: 'ripstop', cat: 'defense', name: 'Ripstop Tent', icon: '▲', costs: [70, 120], desc: ['Mesh tears 75% slower. Duct-tape repairs twice as fast.', 'Mesh tears 150% slower. Acrobats slide off the roof faster.'] },
  { id: 'coolerLock', cat: 'defense', name: 'Cooler Lock', icon: '⊞', costs: [60, 110], desc: ['Bungee lasts 30s (was 16s), raccoons take 4× longer on a strapped lid.', 'Cooler starts each wave strapped; bungee lasts 45s.'] },
  { id: 'tripwire', cat: 'defense', name: 'Tripwire Traps', icon: '⌇', costs: [90, 110], desc: ['One paint tripwire per wave on the left trail.', 'Adds a second tripwire on the right trail.'] },
  { id: 'motion', cat: 'defense', name: 'Motion Alarm', icon: '◉', costs: [75], desc: ['Warns about raccoons from 30m away — including sneaks and climbers — with a chime.'] },
  { id: 'maglite', cat: 'utility', name: 'Big Flashlight', icon: '☀', costs: [60, 100], desc: ['Longer, wider beam. Battery lasts 60% longer.', 'Huge beam. Raccoons caught in it freeze longer.'] },
  { id: 'extraPaint', cat: 'utility', name: 'Extra Paint', icon: '+', costs: [40, 70, 100], desc: ['+40 paintballs per night.', '+80 paintballs per night.', '+130 paintballs per night.'] },
  { id: 'hotdog', cat: 'utility', name: 'Decoy Hot Dog', icon: '⌒', costs: [65], desc: ['Throw a hot dog (G / 🌭) once per wave. Raccoons swarm it for 7s.'] },
  { id: 'pots', cat: 'utility', name: 'Pots & Spoon', icon: '♫', costs: [70], desc: ['Bang pots (N / 🔔) twice a night. Every raccoon within 14m bolts.'] },
];

export const PAINT_COLORS: { id: string; name: string; hex: number }[] = [
  { id: 'pink', name: 'Hot Pink', hex: 0xff2e88 },
  { id: 'orange', name: 'Blaze Orange', hex: 0xff7a1a },
  { id: 'cyan', name: 'Electric Blue', hex: 0x2fd8ff },
  { id: 'yellow', name: 'Highlighter', hex: 0xffe23b },
];

export type AmmoType = 'standard' | 'glow' | 'sticky' | 'burst' | 'decoy';
export const AMMO_COLORS: Record<Exclude<AmmoType, 'standard'>, number> = {
  glow: 0x8dff3a,
  sticky: 0xb04dff,
  burst: 0xff5a1f,
  decoy: 0xd99a2b,
};
export const AMMO_NAMES: Record<AmmoType, string> = {
  standard: 'Standard', glow: 'Glow', sticky: 'Sticky', burst: 'Burst', decoy: 'BBQ Decoy',
};

// World layout
export const LAYOUT = {
  tentHalf: 1.25,
  tentWall: 1.1,
  tentPeak: 1.85,
  cooler: { x: 0.9, z: -4.3 },
  table: { x: 3.7, z: -5.0 },
  fire: { x: -2.9, z: -5.4 },
  camper: { x: -7.5, z: 4.5 },
  bounds: { x: 0.4, z: -2.1, r: 5.2 },
  spawnR: 30,
  exitR: 27,
};
