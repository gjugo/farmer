import { describe, expect, it } from 'vitest';
import { ANIMALS, PENS, type AnimalKind, type PenType } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { FIELD } from '../data/crops';
import { isMaterial } from '../data/materials';
import { buyAnimal, buyFeed, feedNeeded, type PenState } from './animals';
import type { FieldState } from './crops';
import { Game } from './game';
import { buy, buyPrice, buyUnlockLevel, sell } from './market';
import { START_LAND } from './constants';
import { buyParcel, FARM_PARCELS, parcelPrice, parcelsBought, parcelsForSale } from './parcels';
import { connectToFarmhouse, doorOf, farmhouseOf } from './roads';
import { inBounds, isOwned } from './land';
import type { GameState, PlacedObject } from './types';
import { PATH } from '../data/farmhouse';
import { assignFarmer, hireCost, hireFarmer, workerAt } from './workers';

/**
 * A scripted "normal" player on a new game at ×1 speed, used to tune the level curve
 * against the real prices. It looks at the farm every `reactMs` (no instant clicks) and,
 * like a Manor Lords lord, assigns farmers instead of doing the work: every field (crop plan
 * "Best in season") and pen gets a farmer, hiring more when it can afford one. It sells everything,
 * buys feed, builds up to `maxFields` fields (construction sites the free farmers build, with a path
 * to each), keeps chickens (and cows from level 3) and claims finished goals. Before building it buys
 * the materials it lacks at the Market, in fives like the Market's buttons. It never uses processing
 * buildings and buys land only when it runs out of room, so a real player who does more should level
 * at least as fast.
 */
/** Tiles reachable from the farmhouse door over tiles that pass `walkable` (given what stands there), as "x,y" keys. */
function reachable(state: GameState, walkable: (o: PlacedObject | undefined, x: number, y: number) => boolean): Set<string> {
  const at = new Map<string, PlacedObject>();
  for (const o of state.objects) {
    const { w, h } = getBuildable(o.type)?.footprint ?? { w: 1, h: 1 };
    for (let y = o.y; y < o.y + h; y++) for (let x = o.x; x < o.x + w; x++) at.set(`${x},${y}`, o);
  }
  const ok = (x: number, y: number) => inBounds(state.land, x, y) && walkable(at.get(`${x},${y}`), x, y);
  const door = doorOf(farmhouseOf(state)!);
  const seen = new Set<string>();
  const queue = ok(door.x, door.y) ? [door] : [];
  for (const t of queue) {
    const k = `${t.x},${t.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) if (ok(t.x + dx, t.y + dy)) queue.push({ x: t.x + dx, y: t.y + dy });
  }
  return seen;
}

/** True when a tile of `tiles` lies along an edge of `a`, just outside it. */
function touches(tiles: Set<string>, a: { x: number; y: number; w: number; h: number }): boolean {
  for (let x = a.x; x < a.x + a.w; x++) if (tiles.has(`${x},${a.y - 1}`) || tiles.has(`${x},${a.y + a.h}`)) return true;
  for (let y = a.y; y < a.y + a.h; y++) if (tiles.has(`${a.x - 1},${y}`) || tiles.has(`${a.x + a.w},${y}`)) return true;
  return false;
}

function simulate({ reactMs, maxFields, minutes }: { reactMs: number; maxFields: number; minutes: number }): Map<number, number> {
  const game = new Game();
  const reachedAt = new Map<number, number>([[1, 0]]);
  game.events.on('levelUp', ({ level }) => reachedAt.set(level, game.now));
  const STEP = 1000;

  // Like a player, it builds next to a path when it can, else lays one from the farmhouse (free here: paths cost next to nothing).
  const build = (type: string, reserve: number): PlacedObject | null => {
    const def = getBuildable(type)!;
    if (!game.isUnlocked(def.unlockLevel)) return null;
    const shopping = game.missingMaterials(def.materials).map(([id, qty]) => [id, Math.ceil(qty / 5) * 5] as const);
    if (shopping.some(([id]) => !game.isUnlocked(buyUnlockLevel(id)))) return null;
    const shoppingCost = shopping.reduce((sum, [id, qty]) => sum + qty * buyPrice(game.day, id)!, 0);
    if (game.money < def.cost + shoppingCost + reserve) return null;
    const { width, height } = game.state.land;
    const spots: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (game.checkPlacement(type, x, y).ok) spots.push({ x, y });
    const area = (s: { x: number; y: number }) => ({ ...s, ...def.footprint });
    // Same as trying findRoute, then connectToFarmhouse, on each spot, but one flood fill each instead of one per spot.
    const onPaths = reachable(game.state, (o) => o?.type === PATH);
    const onLand = reachable(game.state, (o, x, y) => isOwned(game.state.land, x, y) && (!o || o.type === PATH));
    const spot = spots.find((s) => touches(onPaths, area(s))) ?? spots.find((s) => touches(onLand, area(s)));
    if (!spot) {
      // Out of room: buy the cheapest parcel next to the farm, if that leaves the money for the building.
      const [parcel] = parcelsForSale(game.state.land, FARM_PARCELS);
      const price = parcelPrice(parcelsBought(game.state.land, FARM_PARCELS, START_LAND));
      if (parcel && game.money >= price + def.cost + shoppingCost + reserve) buyParcel(game, FARM_PARCELS, START_LAND, parcel);
      return null;
    }
    for (const [id, qty] of shopping) buy(game, id, qty);
    const r = game.place(type, spot.x, spot.y, { site: true });
    if (r.ok) connectToFarmhouse(game.state, area(spot));
    return r.ok ? r.object : null;
  };
  const pens = (type: PenType) => game.objectsOfType(type) as PlacedObject<PenState>[];

  const act = () => {
    for (const g of game.progression.goals()) if (g.complete) game.progression.claim(g.def.id);
    for (const id of Object.keys(game.state.inventory)) if (id !== 'feed' && !isMaterial(id)) sell(game, id);
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
    // Grow: four fields, then a coop with chickens, then more fields and the rest.
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
    const stocked = pens('coop').some((p) => p.state.animals.length > 0);
    if (fields.length < maxFields && (fields.length < 4 || stocked)) build(FIELD, 40);
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
  // Plus building materials bought at the Market: casual L2 4.5, L5 41.0; relaxed L2 4.3, L5 40.0; busy L2 6.1, L5 41.0.
  // Slower pace (8 min wheat, 32 min seasons, 10× longer farm work, LEVEL_XP 150/900/2600/6000), checking every
  // 60 / 30 / 10 s: casual L2 11.0, L5 168.0; relaxed L2 9.0, L5 178.5; busy L2 8.3, L5 161.7. Winter runs from minute 96 to 128.
  // Bigger map (64×48, 16×12 start, parcels up to 12 tiles from $1,000 ×1.25), more fields only once the coop has chickens:
  // casual L2 11.0, L5 162.0; relaxed L2 8.5, L5 161.5; busy L2 8.2, L5 168.8 (none of them needs to buy land now).
  it('a casual player (checks every 60 s, up to 6 fields) reaches level 2 within 15 min and level 5 within 3 h', () => {
    const reached = simulate({ reactMs: 60_000, maxFields: 6, minutes: 190 });
    expect(minutes(reached.get(2))).toBeLessThanOrEqual(15);
    expect(minutes(reached.get(5))).toBeLessThanOrEqual(180);
  });

  it('a relaxed player (checks every 30 s, up to 8 fields) is inside those limits', () => {
    const reached = simulate({ reactMs: 30_000, maxFields: 8, minutes: 190 });
    expect(minutes(reached.get(2))).toBeLessThanOrEqual(15);
    expect(minutes(reached.get(5))).toBeLessThanOrEqual(180);
  });

  it('a busy player (checks every 10 s, up to 12 fields) does not race through the levels', () => {
    const reached = simulate({ reactMs: 10_000, maxFields: 12, minutes: 190 });
    expect(minutes(reached.get(2))).toBeGreaterThanOrEqual(8);
    expect(minutes(reached.get(5))).toBeGreaterThanOrEqual(60);
  });
});
