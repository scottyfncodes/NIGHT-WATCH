import { describe, it, expect } from 'vitest';
import { defaultSave, purchase, computeLoadout, nextCost, level, computeReward, loadSave, writeSave } from '../src/save';
import { UPGRADES, WAVES, ARCHETYPES } from '../src/config';

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
