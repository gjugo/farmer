import { describe, expect, it } from 'vitest';
import { ANIMALS, PENS, type AnimalKind, type PenType } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { CROP_LIST, FIELD } from '../data/crops';
import { buildWorkMs, FEED_WORK_MS, HARVEST_WORK_MS, PLANT_WORK_MS, PLOUGH_WORK_MS, type JobKind } from '../data/workers';
import { buyAnimal, buyFeed, collect, feedAll, feedNeeded, type PenState } from './animals';
import { cropStage, harvest, isPloughed, plant, plough, seasonCheck, type FieldState } from './crops';
import { Game } from './game';
import { sell } from './market';
import type { PlacedObject } from './types';
import { assignJob, freeFarmers, hireCost, hireFarmer, workersOf } from './workers';

/**
 * A scripted "normal" player on a new game at ×1 speed, used to tune the level curve
 * against the real prices. It looks at the farm every `reactMs` (no instant clicks),
 * keeps fields ploughed and planted with the best crop in season, sells everything,
 * builds up to `maxFields` fields, keeps chickens (and cows from level 3) and claims finished goals.
 * Farm work needs a free farmer for its real duration (without the walk: paths are left out);
 * it hires one more farmer for every `fieldsPerFarmer` fields. It never uses processing
 * buildings or buys land, so a real player who does should level at least as fast.
 */
function simulate({ reactMs, maxFields, fieldsPerFarmer, minutes }: { reactMs: number; maxFields: number; fieldsPerFarmer: number; minutes: number }): Map<number, number> {
  const game = new Game();
  const reachedAt = new Map<number, number>([[1, 0]]);
  game.events.on('levelUp', ({ level }) => reachedAt.set(level, game.now));
  const STEP = 1000;

  /** Runs `action` with a free farmer and keeps the farmer busy for `ms` when it succeeded. */
  const work = (kind: JobKind, obj: { x: number; y: number }, ms: number, action: () => boolean): boolean => {
    if (freeFarmers(game.state) <= 0 || !action()) return false;
    assignJob(game, kind, obj.x, obj.y, ms);
    return true;
  };
  const freeSpot = (type: string): { x: number; y: number } | null => {
    const { width, height } = game.state.land;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (game.checkPlacement(type, x, y).ok) return { x, y };
    return null;
  };
  const build = (type: string, reserve: number): boolean => {
    const def = getBuildable(type)!;
    if (game.money < def.cost + reserve || !game.isUnlocked(def.unlockLevel)) return false;
    const spot = freeSpot(type);
    return !!spot && work('build', spot, buildWorkMs(type), () => game.place(type, spot.x, spot.y).ok);
  };
  const pens = (type: PenType) => game.objectsOfType(type) as PlacedObject<PenState>[];
  const bestCrop = () =>
    CROP_LIST.filter((c) => game.isUnlocked(c.unlockLevel) && seasonCheck(game.state.clock, c) === 'ok').sort((a, b) => b.growMs - a.growMs)[0];

  const act = () => {
    for (const g of game.progression.goals()) if (g.complete) game.progression.claim(g.def.id);
    const fields = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    for (const f of fields) work('harvest', f, HARVEST_WORK_MS, () => harvest(game, f) !== null);
    for (const type of ['coop', 'pasture'] as const) for (const p of pens(type)) collect(game, p);
    for (const id of Object.keys(game.state.inventory)) if (id !== 'feed') sell(game, id);
    for (const f of fields) {
      if (cropStage(game.state.clock, f.state) !== 'empty') continue;
      const crop = bestCrop();
      if (!crop) continue;
      if (!isPloughed(game.state.clock, f.state)) work('plough', f, PLOUGH_WORK_MS, () => plough(game, f).ok);
      else work('plant', f, PLANT_WORK_MS, () => plant(game, f, crop.id).ok);
    }
    for (const type of ['coop', 'pasture'] as const) {
      for (const p of pens(type)) {
        const needed = feedNeeded(game, p);
        if (needed === 0) continue;
        while (game.count('feed') < needed && buyFeed(game));
        work('feed', p, FEED_WORK_MS, () => feedAll(game, p) > 0);
      }
    }
    // Grow: farmers to work the fields, more fields, then animals.
    const hire = hireCost(game.state);
    if (hire !== null && fields.length > workersOf(game.state).farmers * fieldsPerFarmer && game.money >= hire + 40) hireFarmer(game);
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
  // Earlier pace (30 s wheat, 2-day seasons, farmers left out): casual L2 2.5 min, L5 32.0; relaxed L5 21.5; busy L2 1.4, L5 15.7.
  // Slower pace (8 min wheat, 32 min seasons, 10× longer farm work, farmers simulated):
  // casual L2 12.0 min, L5 147.0; relaxed L2 11.0, L5 146.5; busy L2 10.7, L5 85.3. Winter runs from minute 96 to 128.
  it('a casual player (checks every 60 s, up to 6 fields) reaches level 2 within 15 min and level 5 within 3 h', () => {
    const reached = simulate({ reactMs: 60_000, maxFields: 6, fieldsPerFarmer: 4, minutes: 190 });
    expect(minutes(reached.get(2))).toBeLessThanOrEqual(15);
    expect(minutes(reached.get(5))).toBeLessThanOrEqual(180);
  });

  it('a relaxed player (checks every 30 s, up to 8 fields) is inside those limits', () => {
    const reached = simulate({ reactMs: 30_000, maxFields: 8, fieldsPerFarmer: 4, minutes: 190 });
    expect(minutes(reached.get(2))).toBeLessThanOrEqual(15);
    expect(minutes(reached.get(5))).toBeLessThanOrEqual(180);
  });

  it('a busy player (checks every 10 s, up to 12 fields) does not race through the levels', () => {
    const reached = simulate({ reactMs: 10_000, maxFields: 12, fieldsPerFarmer: 3, minutes: 190 });
    expect(minutes(reached.get(2))).toBeGreaterThanOrEqual(8);
    expect(minutes(reached.get(5))).toBeGreaterThanOrEqual(60);
  });
});
