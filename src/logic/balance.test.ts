import { describe, expect, it } from 'vitest';
import { ANIMALS, PENS, type AnimalKind, type PenType } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { FIELD } from '../data/crops';
import { buyAnimal, buyFeed, feedNeeded, type PenState } from './animals';
import type { FieldState } from './crops';
import { Game } from './game';
import { sell } from './market';
import { START_LAND } from './constants';
import { buyParcel, FARM_PARCELS, parcelPrice, parcelsBought, parcelsForSale } from './parcels';
import { connectToFarmhouse, findRoute } from './roads';
import type { PlacedObject } from './types';
import { assignFarmer, hireCost, hireFarmer, workerAt } from './workers';

/**
 * A scripted "normal" player on a new game at ×1 speed, used to tune the level curve
 * against the real prices. It looks at the farm every `reactMs` (no instant clicks) and,
 * like a Manor Lords lord, assigns farmers instead of doing the work: every field (crop plan
 * "Best in season") and pen gets a farmer, hiring more when it can afford one. It sells everything,
 * buys feed, builds up to `maxFields` fields (construction sites the free farmers build, with a path
 * to each), keeps chickens (and cows from level 3) and claims finished goals. It never uses processing
 * buildings and buys land only when it runs out of room, so a real player who does more should level
 * at least as fast.
 */
function simulate({ reactMs, maxFields, minutes }: { reactMs: number; maxFields: number; minutes: number }): Map<number, number> {
  const game = new Game();
  const reachedAt = new Map<number, number>([[1, 0]]);
  game.events.on('levelUp', ({ level }) => reachedAt.set(level, game.now));
  const STEP = 1000;

  // Like a player, it builds next to a path when it can, else lays one from the farmhouse (free here: paths cost next to nothing).
  const build = (type: string, reserve: number): PlacedObject | null => {
    const def = getBuildable(type)!;
    if (game.money < def.cost + reserve || !game.isUnlocked(def.unlockLevel)) return null;
    const { width, height } = game.state.land;
    const spots: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (game.checkPlacement(type, x, y).ok) spots.push({ x, y });
    const area = (s: { x: number; y: number }) => ({ ...s, ...def.footprint });
    const spot = spots.find((s) => findRoute(game.state, area(s))) ?? spots.find((s) => connectToFarmhouse(structuredClone(game.state), area(s)));
    if (!spot) {
      // Out of room: buy the cheapest parcel next to the farm, if that leaves the money for the building.
      const [parcel] = parcelsForSale(game.state.land, FARM_PARCELS);
      const price = parcelPrice(parcelsBought(game.state.land, FARM_PARCELS, START_LAND));
      if (parcel && game.money >= price + def.cost + reserve) buyParcel(game, FARM_PARCELS, START_LAND, parcel);
      return null;
    }
    const r = game.place(type, spot.x, spot.y, { site: true });
    if (r.ok) connectToFarmhouse(game.state, area(spot));
    return r.ok ? r.object : null;
  };
  const pens = (type: PenType) => game.objectsOfType(type) as PlacedObject<PenState>[];

  const act = () => {
    for (const g of game.progression.goals()) if (g.complete) game.progression.claim(g.def.id);
    for (const id of Object.keys(game.state.inventory)) if (id !== 'feed') sell(game, id);
    for (const type of ['coop', 'pasture'] as const) {
      for (const p of pens(type)) while (game.count('feed') < feedNeeded(game, p) && buyFeed(game));
    }
    // Staff every finished field and pen, hiring when there is no farmer to spare.
    const fields = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    const workplaces = [...pens('coop'), ...pens('pasture'), ...fields].filter((o) => !o.site);
    for (const wp of workplaces) {
      if (workerAt(game.state, wp.id) !== null) continue;
      if (assignFarmer(game, wp.id).ok) continue;
      const cost = hireCost(game.state);
      if (cost === null || game.money < cost + 40 || !hireFarmer(game).ok) break;
      assignFarmer(game, wp.id);
    }
    // Grow: four fields, then a coop, then more fields and the rest.
    const stock = (type: PenType, kind: AnimalKind, reserve: number) => {
      if (!game.isUnlocked(ANIMALS[kind].unlockLevel)) return;
      if (pens(type).length === 0) build(type, reserve);
      for (const p of pens(type)) {
        while (!p.site && p.state.animals.length < PENS[type].capacity && game.money >= ANIMALS[kind].price + reserve) {
          if (!buyAnimal(game, p, kind).ok) break;
        }
      }
    };
    if (fields.length >= 4) stock('coop', 'chicken', 60);
    if (fields.length < maxFields && (fields.length < 4 || pens('coop').length > 0)) build(FIELD, 40);
    stock('pasture', 'cow', 100);
  };

  let nextAct = 0;
  for (let t = 0; t < minutes * 60_000; t += STEP) {
    game.advance(STEP);
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
  // With assigned farmers (hired at $150, ×1.2), construction sites and paths: casual L2 4.5, L5 41.0;
  // relaxed L2 4.5, L5 40.3; busy L2 6.1, L5 41.0 (farmers do the work, so reacting faster no longer pays).
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
