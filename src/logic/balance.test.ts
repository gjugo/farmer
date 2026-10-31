import { describe, expect, it } from 'vitest';
import { ANIMALS, PENS, type AnimalKind, type PenType } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { CROP_LIST, FIELD } from '../data/crops';
import { isMaterial, type MaterialCost } from '../data/materials';
import { GRANARY, POOL_BUILDING, type StoragePool } from '../data/storage';
import { buyAnimal, buyFeed, collect, feedAll, feedNeeded, readyCount, type PenState } from './animals';
import { cropStage, harvest, isPloughed, plant, plough, seasonCheck, type FieldState } from './crops';
import { Game } from './game';
import { buy, buyPrice, buyUnlockLevel, sell } from './market';
import { capacity, checkUpgrade, nextLevel, upgrade, used } from './storage';
import type { PlacedObject } from './types';

/**
 * A scripted "normal" player on a new game at ×1 speed, used to tune the level curve
 * against the real prices. It looks at the farm every `reactMs` (no instant clicks),
 * keeps fields ploughed and planted with the best crop in season, sells everything on a trip to the Market every few minutes,
 * builds up to `maxFields` fields, keeps chickens (and cows from level 3) and claims finished goals. Before building it
 * buys the materials it lacks at the Market, in fives like the Market's buttons. When a harvest or collection
 * is refused for want of room it upgrades its granary (or builds one), and it makes room in the storehouse the
 * same way before shopping for more materials than fit. It never uses processing buildings or buys land, so a
 * real player who does should level at least as fast.
 */
function simulate({ reactMs, maxFields, minutes, tripMs }: { reactMs: number; maxFields: number; minutes: number; tripMs: number }): Sim {
  const game = new Game();
  const reachedAt = new Map<number, number>([[1, 0]]);
  game.events.on('levelUp', ({ level }) => reachedAt.set(level, game.now));
  const storage = { built: 0, upgraded: 0, refused: 0 };
  game.activity.on('placed', ({ type }) => {
    if (type === GRANARY || type === POOL_BUILDING.materials) storage.built++;
  });
  game.activity.on('upgraded', () => storage.upgraded++);
  const STEP = 1000;
  let lastTrip = 0;

  const freeSpot = (type: string): { x: number; y: number } | null => {
    const { width, height } = game.state.land;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (game.checkPlacement(type, x, y).ok) return { x, y };
    return null;
  };
  /** Buys what `cost` lacks, in fives, if there is the money (keeping `reserve`) and the room. */
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
  const build = (type: string, reserve: number): PlacedObject | null => {
    const def = getBuildable(type)!;
    if (!game.isUnlocked(def.unlockLevel)) return null;
    const spot = freeSpot(type);
    if (!spot || !shop(def.cost, def.materials, reserve)) return null;
    const r = game.place(type, spot.x, spot.y);
    return r.ok ? r.object : null;
  };
  /** Upgrades a storage building of the pool, or builds one when none can be upgraded. */
  let makingRoom = false;
  const makeRoom = (pool: StoragePool) => {
    if (makingRoom) return; // shopping for the storehouse itself must not recurse
    makingRoom = true;
    const type = POOL_BUILDING[pool];
    const target = game.objectsOfType(type).find((o) => nextLevel(o) !== null);
    const next = target && nextLevel(target);
    if (target && next && shop(next.upgrade.cost, next.upgrade.materials, 40) && checkUpgrade(game, target).ok) upgrade(game, target);
    else if (!target) build(type, 40);
    makingRoom = false;
  };
  const pens = (type: PenType) => game.objectsOfType(type) as PlacedObject<PenState>[];
  const bestCrop = () =>
    CROP_LIST.filter((c) => game.isUnlocked(c.unlockLevel) && seasonCheck(game.state.clock, c) === 'ok').sort((a, b) => b.growMs - a.growMs)[0];

  const act = () => {
    for (const g of game.progression.goals()) if (g.complete) game.progression.claim(g.def.id);
    const fields = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    let full = false;
    for (const f of fields) if (harvest(game, f).ok === false && cropStage(game.state.clock, f.state) === 'ripe') full = true;
    for (const type of ['coop', 'pasture'] as const) {
      for (const p of pens(type)) {
        collect(game, p);
        if (readyCount(game.state.clock, p) > 0) full = true;
      }
    }
    const sellAll = () => {
      for (const id of Object.keys(game.state.inventory)) if (id !== 'feed' && !isMaterial(id)) sell(game, id);
      lastTrip = game.now;
    };
    const takeIn = () => {
      for (const f of fields) harvest(game, f);
      for (const type of ['coop', 'pasture'] as const) for (const p of pens(type)) collect(game, p);
    };
    if (game.now - lastTrip >= tripMs) sellAll();
    if (full) {
      // No room: more storage if it can pay for it, otherwise an early trip to the Market.
      storage.refused++;
      makeRoom('goods');
      takeIn();
      if (used(game.state, 'goods') >= capacity(game.state, 'goods') * 0.9) {
        sellAll();
        takeIn();
      }
    }
    for (const f of fields) {
      if (cropStage(game.state.clock, f.state) !== 'empty') continue;
      if (!isPloughed(game.state.clock, f.state)) plough(game, f);
      const crop = bestCrop();
      if (crop) plant(game, f, crop.id);
    }
    for (const type of ['coop', 'pasture'] as const) {
      for (const p of pens(type)) {
        while (game.count('feed') < feedNeeded(game, p) && buyFeed(game).ok);
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

/** The scripted player goes to the Market every 3 minutes (sooner when it runs out of room). */
const TRIP_MS = 180_000;
const minutes = (ms: number | undefined) => (ms === undefined ? Infinity : ms / 60_000);

describe('level curve balance', () => {
  // At the time of tuning: casual L2 2.5 min, L5 28.5 min; relaxed L2 2.0, L5 22.0; busy L2 1.3, L5 15.9.
  // With seasons (winter from minute 24 to 32 grows nothing): casual L5 32.0; relaxed 21.5; busy L2 1.4, L5 15.7.
  // With building materials bought at the Market: casual L2 2.5, L5 31.5; relaxed L2 2.0, L5 21.8; busy L2 1.4, L5 15.8.
  // With storage and Market trips every 3 min: casual L2 2.5, L5 35.0; relaxed L2 2.3, L5 21.8; busy L2 2.1, L5 18.4.
  const casual = simulate({ reactMs: 30_000, maxFields: 6, minutes: 50, tripMs: TRIP_MS });
  const relaxed = simulate({ reactMs: 15_000, maxFields: 8, minutes: 50, tripMs: TRIP_MS });
  const busy = simulate({ reactMs: 5_000, maxFields: 12, minutes: 50, tripMs: TRIP_MS });

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
  ])('the %s player runs out of room, then builds a granary and upgrades it', (_name, sim) => {
    expect(sim.storage.refused).toBeGreaterThan(0);
    expect(sim.granaries.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...sim.granaries)).toBeGreaterThanOrEqual(2);
    expect(sim.storage.upgraded).toBeGreaterThanOrEqual(1);
    // Never more stored than fits.
    for (const pool of ['goods', 'materials'] as const) expect(used(sim.game.state, pool)).toBeLessThanOrEqual(capacity(sim.game.state, pool));
  });
});

