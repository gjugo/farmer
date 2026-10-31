import { describe, expect, it } from 'vitest';
import { ANIMALS, PENS, type AnimalKind, type PenType } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { FIELD } from '../data/crops';
import { isMaterial, MATERIAL_IDS, type MaterialCost } from '../data/materials';
import { GRANARY, POOL_BUILDING, type StoragePool } from '../data/storage';
import { buyAnimal, buyFeed, feedNeeded, type PenState } from './animals';
import type { FieldState } from './crops';
import { Game } from './game';
import { buy, buyPrice, buyUnlockLevel, sell } from './market';
import { START_LAND } from './constants';
import { buyParcel, FARM_PARCELS, parcelPrice, parcelsBought, parcelsForSale } from './parcels';
import { connectToFarmhouse, doorOf, farmhouseOf } from './roads';
import { inBounds, isOwned } from './land';
import { capacity, checkUpgrade, nextLevel, upgrade, used } from './storage';
import type { GameState, PlacedObject } from './types';
import { PATH } from '../data/farmhouse';
import { workplaceNext } from './work';
import { depositsUnder, MAP_SLICE, mapOf, newMapLayer, treesInRange } from './maplayer';
import { ruleBlock } from './placement';
import { createNewGame } from './state';
import { RESOURCES } from '../data/resourceBuildings';
import { assignFarmer, hireCost, hireFarmer, workerAt } from './workers';

/**
 * A scripted "normal" player on a new game at ×1 speed, used to tune the level curve
 * against the real prices. It looks at the farm every `reactMs` (no instant clicks) and,
 * like a Manor Lords lord, assigns farmers instead of doing the work: every field (crop plan
 * "Best in season") and pen gets a farmer, hiring more when it can afford one. It sells everything,
 * buys feed, builds up to `maxFields` fields (construction sites the free farmers build, with a path
 * to each), keeps chickens (and cows from level 3) and claims finished goals. Before building it buys
 * the materials it lacks at the Market, in fives like the Market's buttons. The map is the one a new game gets from
 * `MAP_SEED`: a grove and a stone outcrop on the starting land, an iron vein next door. It follows the storage goals
 * (build, then upgrade a granary) and, when a farmer waits because the granary is full, upgrades or builds
 * one; it makes room in the storehouse the same way before shopping for more materials than fit (selling materials
 * the purchase doesn't need first). From level 3 it builds a woodcutter's lodge, then a quarry with the lodge's wood;
 * it staffs them in winter with the farmers whose fields are frozen, and sends them back to the fields in spring, so it
 * hires nobody for them and buys only the materials they haven't made. It sells materials beyond 10 of each. It never uses processing
 * buildings, never builds where it would wall off land the farmhouse reaches, and buys land only when it runs out
 * of room, so a real player who does more should level at least as fast.
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

/** The new game's map: any seed gives a start grove and outcrop, this one keeps the runs repeatable. */
const MAP_SEED = 20261031;

function simulate({ reactMs, maxFields, minutes }: { reactMs: number; maxFields: number; minutes: number }): Sim {
  const state = createNewGame();
  state.ext[MAP_SLICE] = newMapLayer(state, MAP_SEED);
  const game = new Game(state);
  const reachedAt = new Map<number, number>([[1, 0]]);
  game.events.on('levelUp', ({ level }) => reachedAt.set(level, game.now));
  const storage = { built: 0, upgraded: 0, refused: 0 };
  game.activity.on('placed', ({ type }) => {
    if (type === GRANARY || type === POOL_BUILDING.materials) storage.built++;
  });
  game.activity.on('upgraded', () => storage.upgraded++);
  const produced: Record<string, number> = {};
  const bought: Record<string, number> = {};
  const staffed = new Set<string>();
  game.activity.on('produced', ({ item, qty }) => (produced[item] = (produced[item] ?? 0) + qty));
  game.activity.on('bought', ({ item, qty }) => (bought[item] = (bought[item] ?? 0) + qty));
  const STEP = 1000;
  const KEEP_MATERIALS = 10;

  /** Buys what `cost` lacks, in fives, if there is the money (keeping `reserve`) and the room; false when it can't. */
  const shop = (cost: number, materials: MaterialCost | undefined, reserve: number): boolean => {
    const shopping = game.missingMaterials(materials).map(([id, qty]) => [id, Math.ceil(qty / 5) * 5] as const);
    if (shopping.some(([id]) => !game.isUnlocked(buyUnlockLevel(id)))) return false;
    const shoppingCost = shopping.reduce((sum, [id, qty]) => sum + qty * buyPrice(game.day, id)!, 0);
    if (game.money < cost + shoppingCost + reserve) return false;
    let room = capacity(game.state, 'materials') - used(game.state, 'materials');
    const need = shopping.reduce((sum, [, qty]) => sum + qty, 0);
    // Short of room: sell materials this cost doesn't take (as a player would), else make more room.
    for (const id of MATERIAL_IDS) {
      const spare = Math.min(game.count(id) - (materials?.[id] ?? 0), need - room);
      if (spare > 0) room += sell(game, id, spare) > 0 ? spare : 0;
    }
    if (need > room) {
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
    // Same as trying findRoute, then connectToFarmhouse, on each spot, but one flood fill each instead of one per spot.
    const onPaths = reachable(game.state, (o) => o?.type === PATH);
    // Trees and rocks are in the way of paths too.
    const free = (o: PlacedObject | undefined, x: number, y: number) =>
      isOwned(game.state.land, x, y) && (o ? o.type === PATH : !ruleBlock(game.state, { w: 1, h: 1 }, x, y, PATH));
    const onLand = reachable(game.state, free);
    // Nor does it wall off its own land: every tile the farmhouse reaches now stays reachable around the new building.
    const walls = (a: { x: number; y: number; w: number; h: number }) => {
      const inside = (x: number, y: number) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h;
      const after = reachable(game.state, (o, x, y) => !inside(x, y) && free(o, x, y));
      const covered = [...onLand].filter((k) => inside(...(k.split(',').map(Number) as [number, number]))).length;
      return after.size < onLand.size - covered;
    };
    const fits = (s: { x: number; y: number }, near: Set<string>) => touches(near, area(s)) && !walls(area(s));
    // A lodge goes where it reaches the most trees, a quarry or mine squarely on its deposit.
    const res = RESOURCES[type as keyof typeof RESOURCES];
    const layer = mapOf(game.state);
    const worth = (s: { x: number; y: number }) =>
      res?.range ? treesInRange(layer, area(s), res.range).length : res?.deposit ? depositsUnder(layer, area(s), res.deposit).length * 100 - overhang(s) : 0;
    const overhang = (s: { x: number; y: number }) => {
      let n = 0;
      for (let y = s.y; y < s.y + def.footprint.h; y++) for (let x = s.x; x < s.x + def.footprint.w; x++) n += layer.deposits.some((d) => x >= d.x && y >= d.y && x < d.x + d.w && y < d.y + d.h) ? 0 : 1;
      return n;
    };
    if (res) spots.sort((a, b) => worth(b) - worth(a));
    const spot = spots.find((s) => fits(s, onPaths)) ?? spots.find((s) => fits(s, onLand));
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
    // Materials its buildings made beyond a working stock are sold too.
    for (const id of MATERIAL_IDS) if (game.count(id) > KEEP_MATERIALS) sell(game, id, game.count(id) - KEEP_MATERIALS);
    const fields = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    const resources = [...game.objectsOfType('woodcutter'), ...game.objectsOfType('quarry')].filter((o) => !o.site);
    const workplaces = [...pens('coop'), ...pens('pasture'), ...fields].filter((o) => !o.site);
    // Winter: farmers whose fields can't be sown cut wood and break stone instead; when the ground thaws they go back.
    const frozen = (f: PlacedObject) => (workplaceNext(game, f) as { wait?: string }).wait === 'season';
    for (const r of resources) {
      const farmer = workerAt(game.state, r.id);
      const field = fields.find((f) => !f.site && (farmer === null ? workerAt(game.state, f.id) !== null && frozen(f) : workerAt(game.state, f.id) === null && !frozen(f)));
      if (field) assignFarmer(game, farmer === null ? r.id : field.id, farmer ?? workerAt(game.state, field.id)!);
      if (workerAt(game.state, r.id) !== null) staffed.add(r.type);
    }
    // A farmer still waiting for room after the sale (feed takes room too): more storage, if it can pay for it.
    if (workplaces.some((wp) => workerAt(game.state, wp.id) !== null && (workplaceNext(game, wp) as { wait?: string }).wait === 'full')) {
      storage.refused++;
      makeRoom('goods');
    }
    if (resources.some((wp) => workerAt(game.state, wp.id) !== null && (workplaceNext(game, wp) as { wait?: string }).wait === 'storehouse-full')) {
      makeRoom('materials');
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
    // Its own materials from level 3: a woodcutter's lodge, then a quarry built with the lodge's wood.
    if (game.level >= 3 && game.objectsOfType('woodcutter').length === 0) build('woodcutter', 40);
    if (game.objectsOfType('quarry').length === 0 && game.missingMaterials(getBuildable('quarry')!.materials).length === 0) build('quarry', 40);
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
  const storageLevels = (type: string) => game.objectsOfType(type).map((o) => o.state.level as number);
  return { reachedAt, storage, granaries: storageLevels(GRANARY), storehouses: storageLevels(POOL_BUILDING.materials), produced, bought, staffed, game };
}

interface Sim {
  reachedAt: Map<number, number>;
  storage: { built: number; upgraded: number; refused: number };
  granaries: number[];
  storehouses: number[];
  /** Materials made by its resource buildings, and bought at the Market. */
  produced: Record<string, number>;
  bought: Record<string, number>;
  /** Resource building types that had a farmer at some point. */
  staffed: Set<string>;
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
  // Slower pace (8 min wheat, 32 min seasons, 10× longer farm work, LEVEL_XP 150/900/2600/6000), checking every
  // 60 / 30 / 10 s: casual L2 11.0, L5 168.0; relaxed L2 9.0, L5 178.5; busy L2 8.3, L5 161.7. Winter runs from minute 96 to 128.
  // Bigger map (64×48, 16×12 start, parcels up to 12 tiles from $1,000 ×1.25), more fields only once the coop has chickens:
  // casual L2 11.0, L5 162.0; relaxed L2 8.5, L5 161.5; busy L2 8.2, L5 168.8 (none of them needs to buy land now).
  // Merged with storage (granary goal after 20 wheat): casual L2 10.0, L5 171.0; relaxed L2 9.0, L5 168.0; busy L2 8.3, L5 166.0.
  // Bigger map and storage together: casual L2 10.0, L5 167.0; relaxed L2 8.5, L5 162.0; busy L2 8.2, L5 161.8.
  // Plus a woodcutter's lodge (level 3) and a quarry, staffed in winter: casual L2 10.0, L5 175.0; relaxed L2 9.0, L5 171.0;
  // busy L2 8.3, L5 166.0. Hiring farmers for them, or building them before level 3, cost 8+ min of L5 in this 3 h window.
  // With the bigger map, building only where it walls off none of its land (the busy player's fields had shut the
  // lodge out): casual L2 10.0, L5 162.0; relaxed L2 8.5, L5 164.5; busy L2 8.2, L5 168.9.
  // Map resources (the lodge fells the start grove, the quarry stands on the start outcrop, map seed MAP_SEED):
  // casual L2 10.0, L5 167.0; relaxed L2 8.5, L5 166.0; busy L2 8.2, L5 167.8.
  const casual = simulate({ reactMs: 60_000, maxFields: 6, minutes: 190 });
  const relaxed = simulate({ reactMs: 30_000, maxFields: 8, minutes: 190 });
  const busy = simulate({ reactMs: 10_000, maxFields: 12, minutes: 190 });

  it('a casual player (checks every 60 s, up to 6 fields) reaches level 2 within 15 min and level 5 within 3 h', () => {
    expect(minutes(casual.reachedAt.get(2))).toBeLessThanOrEqual(15);
    expect(minutes(casual.reachedAt.get(5))).toBeLessThanOrEqual(180);
  });

  it('a relaxed player (checks every 30 s, up to 8 fields) is inside those limits', () => {
    expect(minutes(relaxed.reachedAt.get(2))).toBeLessThanOrEqual(15);
    expect(minutes(relaxed.reachedAt.get(5))).toBeLessThanOrEqual(180);
  });

  it('a busy player (checks every 10 s, up to 12 fields) does not race through the levels', () => {
    expect(minutes(busy.reachedAt.get(2))).toBeGreaterThanOrEqual(8);
    expect(minutes(busy.reachedAt.get(5))).toBeGreaterThanOrEqual(60);
  });

  it.each([
    ['casual', casual],
    ['relaxed', relaxed],
    ['busy', busy],
  ])("the %s player builds a woodcutter's lodge and a quarry, staffs them and makes its own wood and stone", (_name, sim) => {
    for (const type of ['woodcutter', 'quarry']) {
      expect(sim.game.objectsOfType(type).length, type).toBe(1);
      expect(sim.staffed.has(type), type).toBe(true);
    }
    expect(sim.produced.wood ?? 0).toBeGreaterThan(0);
    expect(sim.produced.stone ?? 0).toBeGreaterThan(0);
    // The wood came from trees it felled, the stone out of the outcrop under its quarry.
    const layer = mapOf(sim.game.state);
    const lodge = sim.game.objectsOfType('woodcutter')[0];
    const quarry = sim.game.objectsOfType('quarry')[0];
    expect(treesInRange(layer, { x: lodge.x, y: lodge.y, w: 2, h: 2 }, RESOURCES.woodcutter.range!).length).toBeGreaterThanOrEqual(5);
    expect(layer.trees.some((t) => t.felledAt !== null)).toBe(true);
    const [outcrop] = depositsUnder(layer, { x: quarry.x, y: quarry.y, w: 2, h: 2 }, 'stone');
    expect(outcrop.amount - outcrop.left).toBe(sim.produced.stone);
    // A good share of its materials are its own, not bought.
    const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    expect(total(sim.produced)).toBeGreaterThanOrEqual(0.3 * (total(sim.produced) + total(sim.bought)));
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
