import { describe, expect, it } from 'vitest';
import { ANIMALS, PENS, type AnimalKind, type PenType } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { CROP_LIST, FIELD } from '../data/crops';
import { isMaterial } from '../data/materials';
import { buyAnimal, buyFeed, collect, feedAll, feedNeeded, type PenState } from './animals';
import { cropStage, harvest, isPloughed, plant, plough, seasonCheck, type FieldState } from './crops';
import { Game } from './game';
import { buy, buyPrice, buyUnlockLevel, sell } from './market';
import type { PlacedObject } from './types';

/**
 * A scripted "normal" player on a new game at ×1 speed, used to tune the level curve
 * against the real prices. It looks at the farm every `reactMs` (no instant clicks),
 * keeps fields ploughed and planted with the best crop in season, sells everything,
 * builds up to `maxFields` fields, keeps chickens (and cows from level 3) and claims finished goals. Before building it
 * buys the materials it lacks at the Market, in fives like the Market's buttons. It never uses processing
 * buildings or buys land, so a real player who does should level at least as fast.
 */
function simulate({ reactMs, maxFields, minutes }: { reactMs: number; maxFields: number; minutes: number }): Map<number, number> {
  const game = new Game();
  const reachedAt = new Map<number, number>([[1, 0]]);
  game.events.on('levelUp', ({ level }) => reachedAt.set(level, game.now));
  const STEP = 1000;

  const freeSpot = (type: string): { x: number; y: number } | null => {
    const { width, height } = game.state.land;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (game.checkPlacement(type, x, y).ok) return { x, y };
    return null;
  };
  const build = (type: string, reserve: number): PlacedObject | null => {
    const def = getBuildable(type)!;
    if (!game.isUnlocked(def.unlockLevel)) return null;
    const shopping = game.missingMaterials(def.materials).map(([id, qty]) => [id, Math.ceil(qty / 5) * 5] as const);
    if (shopping.some(([id]) => !game.isUnlocked(buyUnlockLevel(id)))) return null;
    const shoppingCost = shopping.reduce((sum, [id, qty]) => sum + qty * buyPrice(game.day, id)!, 0);
    if (game.money < def.cost + shoppingCost + reserve) return null;
    const spot = freeSpot(type);
    if (!spot) return null;
    for (const [id, qty] of shopping) buy(game, id, qty);
    const r = game.place(type, spot.x, spot.y);
    return r.ok ? r.object : null;
  };
  const pens = (type: PenType) => game.objectsOfType(type) as PlacedObject<PenState>[];
  const bestCrop = () =>
    CROP_LIST.filter((c) => game.isUnlocked(c.unlockLevel) && seasonCheck(game.state.clock, c) === 'ok').sort((a, b) => b.growMs - a.growMs)[0];

  const act = () => {
    for (const g of game.progression.goals()) if (g.complete) game.progression.claim(g.def.id);
    const fields = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    for (const f of fields) harvest(game, f);
    for (const type of ['coop', 'pasture'] as const) for (const p of pens(type)) collect(game, p);
    for (const id of Object.keys(game.state.inventory)) if (id !== 'feed' && !isMaterial(id)) sell(game, id);
    for (const f of fields) {
      if (cropStage(game.state.clock, f.state) !== 'empty') continue;
      if (!isPloughed(game.state.clock, f.state)) plough(game, f);
      const crop = bestCrop();
      if (crop) plant(game, f, crop.id);
    }
    for (const type of ['coop', 'pasture'] as const) {
      for (const p of pens(type)) {
        while (game.count('feed') < feedNeeded(game, p) && buyFeed(game));
        feedAll(game, p);
      }
    }
    // Grow: more fields first, then animals.
    if (fields.length < maxFields) build(FIELD, 40);
    const stock = (type: PenType, kind: AnimalKind, reserve: number) => {
      if (!game.isUnlocked(ANIMALS[kind].unlockLevel)) return;
      if (pens(type).length === 0) build(type, reserve);
      for (const p of pens(type)) {
        while (p.state.animals.length < PENS[type].capacity && game.money >= ANIMALS[kind].price + reserve) {
          if (!buyAnimal(game, p, kind).ok) break;
        }
      }
    };
    if (fields.length >= 4) stock('coop', 'chicken', 60);
    stock('pasture', 'cow', 100);
  };

  let nextAct = 0;
  for (let t = 0; t < minutes * 60_000; t += STEP) {
    game.state.clock.elapsed += STEP;
    if (game.now >= nextAct) {
      act();
      nextAct = game.now + reactMs;
    }
  }
  return reachedAt;
}

const minutes = (ms: number | undefined) => (ms === undefined ? Infinity : ms / 60_000);

describe('level curve balance', () => {
  // At the time of tuning: casual L2 2.5 min, L5 28.5 min; relaxed L2 2.0, L5 22.0; busy L2 1.3, L5 15.9.
  // With seasons (winter from minute 24 to 32 grows nothing): casual L5 32.0; relaxed 21.5; busy L2 1.4, L5 15.7.
  // With building materials bought at the Market: casual L2 2.5, L5 31.5; relaxed L2 2.0, L5 21.8; busy L2 1.4, L5 15.8.
  it('a casual player (checks every 30 s, up to 6 fields) reaches level 2 within 5 min and level 5 within 45 min', () => {
    const reached = simulate({ reactMs: 30_000, maxFields: 6, minutes: 50 });
    expect(minutes(reached.get(2))).toBeLessThanOrEqual(5);
    expect(minutes(reached.get(5))).toBeLessThanOrEqual(45);
  });

  it('a relaxed player (checks every 15 s, up to 8 fields) is well inside those limits', () => {
    const reached = simulate({ reactMs: 15_000, maxFields: 8, minutes: 50 });
    expect(minutes(reached.get(2))).toBeLessThanOrEqual(5);
    expect(minutes(reached.get(5))).toBeLessThanOrEqual(45);
  });

  it('a busy player (checks every 5 s, up to 12 fields) does not race through the levels', () => {
    const reached = simulate({ reactMs: 5_000, maxFields: 12, minutes: 50 });
    expect(minutes(reached.get(2))).toBeGreaterThanOrEqual(1);
    expect(minutes(reached.get(5))).toBeGreaterThanOrEqual(12);
  });
});
