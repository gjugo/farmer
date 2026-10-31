import { describe, expect, it } from 'vitest';
import { ANIMALS, PENS, type AnimalKind, type PenType } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { FIELD } from '../data/crops';
import { isMaterial, type MaterialCost } from '../data/materials';
import { GRANARY, POOL_BUILDING, type StoragePool } from '../data/storage';
import { buyAnimal, buyFeed, feedNeeded, type PenState } from './animals';
import type { FieldState } from './crops';
import { Game } from './game';
import { buy, buyPrice, buyUnlockLevel, sell } from './market';
import { START_LAND } from './constants';
import { buyParcel, FARM_PARCELS, parcelPrice, parcelsBought, parcelsForSale } from './parcels';
import { connectToFarmhouse, findRoute } from './roads';
import { capacity, checkUpgrade, nextLevel, upgrade, used } from './storage';
import type { PlacedObject } from './types';
import { workplaceNext } from './work';
import { assignFarmer, hireCost, hireFarmer, workerAt } from './workers';

/**
 * A scripted "normal" player on a new game at ×1 speed, used to tune the level curve
 * against the real prices. It looks at the farm every `reactMs` (no instant clicks) and,
 * like a Manor Lords lord, assigns farmers instead of doing the work: every field (crop plan
 * "Best in season") and pen gets a farmer, hiring more when it can afford one. It sells everything,
 * buys feed, builds up to `maxFields` fields (construction sites the free farmers build, with a path
 * to each), keeps chickens (and cows from level 3) and claims finished goals. Before building it buys
 * the materials it lacks at the Market, in fives like the Market's buttons. It follows the storage goals
 * (build, then upgrade a granary) and, when a farmer waits because the granary is full, upgrades or builds
 * one; it makes room in the storehouse the same way before shopping for more materials than fit. It never uses processing
 * buildings and buys land only when it runs out of room, so a real player who does more should level
 * at least as fast.
 */
function simulate({ reactMs, maxFields, minutes }: { reactMs: number; maxFields: number; minutes: number }): Sim {
  const game = new Game();
  const reachedAt = new Map<number, number>([[1, 0]]);
  game.events.on('levelUp', ({ level }) => reachedAt.set(level, game.now));
  const storage = { built: 0, upgraded: 0, refused: 0 };
  game.activity.on('placed', ({ type }) => {
    if (type === GRANARY || type === POOL_BUILDING.materials) storage.built++;
  });
  game.activity.on('upgraded', () => storage.upgraded++);
  const STEP = 1000;

  /** Buys what `cost` lacks, in fives, if there is the money (keeping `reserve`) and the room; false when it can't. */
  const shop = (cost: number, materials: MaterialCost | undefined, reserve: number): boolean => {
    const shopping = game.missingMaterials(materials).map(([id, qty]) => [id, Math.ceil(qty / 5) * 5] as const);
    if (shopping.some(([id]) => !game.isUnlocked(buyUnlockLevel(id)))) return false;
    const shoppingCost = shopping.reduce((sum, [id, qty]) => sum + qty * buyPrice(game.day, id)!, 0);
    if (game.money < cost + shoppingCost + reserve) return false;
    const room = capacity(game.state, 'materials') - used(game.state, 'materials');
    if (shopping.reduce((sum, [, qty]) => sum + qty, 0) > room) {
      makeRoom('materials');
      return false;
    }
    for (const [id, qty] of shopping) buy(game, id, qty);
    return game.missingMaterials(materials).length === 0;
  };

  // Like a player, it builds next to a path when it can, else lays one from the farmhouse (free here: paths cost next to nothing).
  const build = (type: string, reserve: number): PlacedObject | null => {
    const def = getBuildable(type)!;
    if (!game.isUnlocked(def.unlockLevel)) return null;
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
    if (!shop(def.cost, def.materials, reserve)) return null;
    const r = game.place(type, spot.x, spot.y, { site: true });
    if (r.ok) connectToFarmhouse(game.state, area(spot));
    return r.ok ? r.object : null;
  };
  /** Upgrades a finished storage building of the pool, or builds one when there is none yet. */
  let makingRoom = false;
  const makeRoom = (pool: StoragePool, reserve = 40) => {
    if (makingRoom) return; // shopping for the storehouse itself must not recurse
    makingRoom = true;
    const type = POOL_BUILDING[pool];
    const all = game.objectsOfType(type);
    const target = all.find((o) => !o.site && nextLevel(o) !== null);
    const next = target && nextLevel(target);
    if (target && next && shop(next.upgrade.cost, next.upgrade.materials, reserve) && checkUpgrade(game, target).ok) upgrade(game, target);
    else if (all.length === 0) build(type, reserve);
    makingRoom = false;
  };
  const pens = (type: PenType) => game.objectsOfType(type) as PlacedObject<PenState>[];

  const act = () => {
    for (const g of game.progression.goals()) if (g.complete) game.progression.claim(g.def.id);
    // Like a player, it follows the storage goals.
    const goals = new Set(game.progression.goals().map((g) => g.def.id));
    if (goals.has('build-granary') || goals.has('upgrade-granary')) makeRoom('goods');
    for (const id of Object.keys(game.state.inventory)) if (id !== 'feed' && !isMaterial(id)) sell(game, id);
    const fields = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    const workplaces = [...pens('coop'), ...pens('pasture'), ...fields].filter((o) => !o.site);
    // A farmer still waiting for room after the sale (feed takes room too): more storage, if it can pay for it.
    if (workplaces.some((wp) => workerAt(game.state, wp.id) !== null && (workplaceNext(game, wp) as { wait?: string }).wait === 'full')) {
      storage.refused++;
      makeRoom('goods');
    }
    for (const type of ['coop', 'pasture'] as const) {
      for (const p of pens(type)) while (game.count('feed') < feedNeeded(game, p) && buyFeed(game).ok);
    }
    // Staff every finished field and pen, hiring when there is no farmer to spare.
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
  const storageLevels = (type: string) => game.objectsOfType(type).map((o) => o.state.level as number);
  return { reachedAt, storage, granaries: storageLevels(GRANARY), storehouses: storageLevels(POOL_BUILDING.materials), game };
}

interface Sim {
  reachedAt: Map<number, number>;
  storage: { built: number; upgraded: number; refused: number };
  granaries: number[];
  storehouses: number[];
  game: Game;
}

const minutes = (ms: number | undefined) => (ms === undefined ? Infinity : ms / 60_000);

describe('level curve balance', () => {
  // At the time of tuning: casual L2 2.5 min, L5 28.5 min; relaxed L2 2.0, L5 22.0; busy L2 1.3, L5 15.9.
  // With seasons (winter from minute 24 to 32 grows nothing): casual L5 32.0; relaxed 21.5; busy L2 1.4, L5 15.7.
  // With assigned farmers (hired at $150, ×1.2), construction sites and paths: casual L2 4.5, L5 41.0;
  // relaxed L2 4.5, L5 40.3; busy L2 6.1, L5 41.0 (farmers do the work, so reacting faster no longer pays).
  // Plus building materials bought at the Market: casual L2 4.5, L5 41.0; relaxed L2 4.3, L5 40.0; busy L2 6.1, L5 41.0.
  // Plus storage (granary $30 + 5 wood, built for its goal): casual L2 4.0, L5 43.5; relaxed L2 4.0, L5 42.5; busy L2 5.8, L5 42.0.
  const casual = simulate({ reactMs: 30_000, maxFields: 6, minutes: 50 });
  const relaxed = simulate({ reactMs: 15_000, maxFields: 8, minutes: 50 });
  const busy = simulate({ reactMs: 5_000, maxFields: 12, minutes: 50 });

  it('a casual player (checks every 30 s, up to 6 fields) reaches level 2 within 5 min and level 5 within 45 min', () => {
    expect(minutes(casual.reachedAt.get(2))).toBeLessThanOrEqual(5);
    expect(minutes(casual.reachedAt.get(5))).toBeLessThanOrEqual(45);
  });

  it('a relaxed player (checks every 15 s, up to 8 fields) is well inside those limits', () => {
    expect(minutes(relaxed.reachedAt.get(2))).toBeLessThanOrEqual(5);
    expect(minutes(relaxed.reachedAt.get(5))).toBeLessThanOrEqual(45);
  });

  it('a busy player (checks every 5 s, up to 12 fields) does not race through the levels', () => {
    expect(minutes(busy.reachedAt.get(2))).toBeGreaterThanOrEqual(1);
    expect(minutes(busy.reachedAt.get(5))).toBeGreaterThanOrEqual(12);
  });

  it.each([
    ['casual', casual],
    ['relaxed', relaxed],
    ['busy', busy],
  ])('the %s player builds a granary and never holds more than fits', (_name, sim) => {
    expect(sim.storage.built).toBeGreaterThanOrEqual(1);
    expect(sim.granaries.length).toBeGreaterThanOrEqual(1);
    for (const pool of ['goods', 'materials'] as const) expect(used(sim.game.state, pool)).toBeLessThanOrEqual(capacity(sim.game.state, pool));
  });
});
