import { describe, it, expect } from 'vitest';
import { defaultSave, purchase, computeLoadout, nextCost, level, computeReward, loadSave, writeSave, lockedUntil, unlockedAtLevel } from '../src/save';
import { UPGRADES, WAVES, ARCHETYPES, LEVELS, levelForNight, wavesForLevel } from '../src/config';

describe('upgrades', () => {
  it('purchasing deducts supplies and raises level', () => {
    const s = defaultSave();
    s.supplies = 500;
    expect(purchase(s, 'hopper')).toBe(true);
    expect(level(s, 'hopper')).toBe(1);
    expect(s.supplies).toBe(500 - 60);
  });
  it('refuses purchases you cannot afford or that are maxed', () => {
    const s = defaultSave();
    s.supplies = 10;
    expect(purchase(s, 'semiauto')).toBe(false);
    s.supplies = 10000;
    s.night = 2; // semi-auto unlocks at level 2
    expect(purchase(s, 'semiauto')).toBe(true);
    expect(nextCost(s, 'semiauto')).toBeNull();
    expect(purchase(s, 'semiauto')).toBe(false);
  });
  it('every upgrade level changes the loadout', () => {
    for (const u of UPGRADES) {
      for (let lv = 1; lv <= u.costs.length; lv++) {
        const before = defaultSave();
        before.upgrades[u.id] = lv - 1;
        const after = defaultSave();
        after.upgrades[u.id] = lv;
        expect(JSON.stringify(computeLoadout(after)), `${u.id} level ${lv}`).not.toEqual(JSON.stringify(computeLoadout(before)));
      }
      expect(u.desc.length).toBe(u.costs.length);
    }
  });
  it('semi-auto is meaningfully faster than pump', () => {
    const s = defaultSave();
    const pump = computeLoadout(s).fireInterval;
    s.upgrades.semiauto = 1;
    expect(computeLoadout(s).fireInterval).toBeLessThan(pump / 2.5);
  });
});

describe('rewards', () => {
  it('pays more for winning, deterring and accuracy', () => {
    const base = { won: false, wavesCleared: 2, food: 40, deterred: 5, tanks: 0, boss: false, shots: 50, hits: 10 };
    const lose = computeReward(base).total;
    const win = computeReward({ ...base, won: true, wavesCleared: 6, boss: true }).total;
    const accurate = computeReward({ ...base, hits: 40 }).total;
    expect(win).toBeGreaterThan(lose);
    expect(accurate).toBeGreaterThan(lose);
    expect(lose).toBeGreaterThan(0);
  });
  it('a solid first-night win buys at least two upgrades', () => {
    const r = computeReward({ won: true, wavesCleared: 6, food: 60, deterred: 30, tanks: 2, boss: true, shots: 160, hits: 60 });
    const cheapest = UPGRADES.map((u) => u.costs[0]).sort((a, b) => a - b);
    expect(r.total).toBeGreaterThan(cheapest[0] + cheapest[1]);
  });
});

describe('persistence', () => {
  it('round-trips through storage and tolerates garbage', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const s = defaultSave();
    s.supplies = 123;
    s.upgrades.pots = 1;
    writeSave(s, store);
    const back = loadSave(store);
    expect(back.supplies).toBe(123);
    expect(back.upgrades.pots).toBe(1);
    mem.set('nightwatch.save.v1', '{not json');
    expect(loadSave(store).supplies).toBe(0);
  });
});

describe('night structure', () => {
  it('has five waves plus a boss finale', () => {
    expect(WAVES.length).toBe(6);
    expect(WAVES[5].isBoss).toBe(true);
    expect(WAVES[5].spawns.some((s) => s.type === 'boss')).toBe(true);
    expect(WAVES[0].spawns.length).toBe(1);
    expect(WAVES[1].spawns.length).toBe(3);
    expect(WAVES[2].spawns.length).toBe(5);
  });
  it('introduces at least four distinct archetypes', () => {
    const types = new Set(WAVES.flatMap((w) => w.spawns.map((s) => s.type)));
    expect(types.size).toBeGreaterThanOrEqual(7);
    for (const t of types) expect(ARCHETYPES[t]).toBeDefined();
  });
  it('clock runs forward toward 6:00 AM', () => {
    for (let i = 1; i < WAVES.length; i++) expect(WAVES[i].clockStart).toBeGreaterThanOrEqual(WAVES[i - 1].clockEnd);
    expect(WAVES[5].clockEnd).toBe(480);
  });
});

describe('upgrade locks', () => {
  it('locks tiers until their level is reached', () => {
    const s = defaultSave();
    s.supplies = 10000;
    expect(lockedUntil(s, 'semiauto')).toBe(2);
    expect(purchase(s, 'semiauto')).toBe(false);
    expect(s.supplies).toBe(10000);
    s.night = 2;
    expect(purchase(s, 'optics')).toBe(true); // red dot at level 2
    expect(lockedUntil(s, 'optics')).toBe(3); // scope waits for the camper roof
    expect(purchase(s, 'optics')).toBe(false);
    s.night = 3;
    expect(purchase(s, 'optics')).toBe(true);
  });
  it('every tier has an unlock level inside the campaign, and level 1 has something to buy', () => {
    for (const u of UPGRADES) {
      expect(u.unlock?.length ?? u.costs.length, u.id).toBe(u.costs.length);
      for (const lv of u.unlock ?? []) expect(lv).toBeGreaterThanOrEqual(1), expect(lv).toBeLessThanOrEqual(LEVELS.length);
    }
    expect(UPGRADES.filter((u) => (u.unlock?.[0] ?? 1) === 1).length).toBeGreaterThanOrEqual(5);
  });
  it('announces new gear when a level is first reached', () => {
    expect(unlockedAtLevel(2, 2).length).toBeGreaterThan(0);
    expect(unlockedAtLevel(2, 6)).toEqual([]); // second time around, nothing new
  });
});

describe('levels', () => {
  it('moves the post every night and cycles after the last level', () => {
    const posts = LEVELS.map((l) => l.post.id);
    expect(new Set(posts).size).toBe(LEVELS.length);
    expect(levelForNight(1).post.id).toBe('tent');
    expect(levelForNight(LEVELS.length + 1).post.id).toBe('tent');
  });
  it('introduces squirrels, then possums', () => {
    const has = (lv: number, t: string) => wavesForLevel(LEVELS[lv - 1]).some((w) => w.spawns.some((s) => s.type === t));
    expect(has(1, 'squirrel') || has(1, 'possum')).toBe(false);
    expect(has(2, 'squirrel')).toBe(true);
    expect(has(2, 'possum')).toBe(false);
    expect(has(3, 'possum')).toBe(true);
    expect(has(4, 'squirrel') && has(4, 'possum')).toBe(true);
    for (const l of LEVELS) {
      const ws = wavesForLevel(l);
      expect(ws.length).toBe(WAVES.length);
      expect(ws[ws.length - 1].spawns.some((s) => s.type === 'boss')).toBe(true);
      for (const w of ws) for (const sp of w.spawns) expect(ARCHETYPES[sp.type]).toBeDefined();
    }
  });
  it('does not mutate the base raccoon night', () => {
    const before = JSON.stringify(WAVES);
    wavesForLevel(LEVELS[3]);
    expect(JSON.stringify(WAVES)).toBe(before);
  });
});
