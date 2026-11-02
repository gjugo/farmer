import { afterEach, describe, expect, it } from 'vitest';
import { ANIMALS, PENS, type AnimalKind, type PenType } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { FIELD } from '../data/crops';
import { isMaterial, MATERIAL_IDS, type MaterialCost } from '../data/materials';
import { GRANARY, POOL_BUILDING, type StoragePool } from '../data/storage';
import { buyAnimal, buyFeed, feedNeeded, type PenState } from './animals';
import type { FieldState } from './crops';
import { Game } from './game';
import { allowance, buy, buyPrice, buyUnlockLevel, marketOf, sell } from './market';
import { sellToTrader, traderHere, traderOf, updateTrader } from './trader';
import { START_LAND } from './constants';
import { connectToFarmhouse, doorOf, farmhouseOf } from './roads';
import { inBounds } from './land';
import { capacity, checkUpgrade, nextLevel, upgrade, used } from './storage';
import type { GameState, PlacedObject } from './types';
import { PATH } from '../data/farmhouse';
import { COTTAGE, FIREWOOD_PER_HOME, FOODS, MEAL_PER_FAMILY, PROVISION_DAYS } from '../data/families';
import { getItem } from '../data/items';
import { SEASON_DAYS } from '../data/seasons';
import type { FarmContext } from '../game/context';
import { withFarmer } from '../game/workers';
import { DAY_MS } from './constants';
import { homesOf } from './families';
import { DEFENCES, type DefenceType } from '../data/hazards';
import { guardedBy, harshWinterAt, harshWinterWood, hazardsOf, isProtected, setHazardsEnabled } from './hazards';
import { dayOfSeason, nextSeasonAt, seasonAt } from './seasons';
import { workplaceNext } from './work';
import { addDeposit, depositsUnder, MAP_SLICE, mapOf, newMapLayer, treesInRange } from './maplayer';
import { ruleBlock } from './placement';
import { createNewGame } from './state';
import { RESOURCES } from '../data/resourceBuildings';
import { addFarmer, assignFarmer, cropPlanOf, freeFarmers, PLAN_BEST, PLAN_FALLOW, setCropPlan, setKeepMaking, workerAt, workersOf } from './workers';
import { maxLevelState } from './test-utils';

/**
 * A scripted "normal" player on a new game at ×1 speed, used to tune the level curve
 * against the real prices. It looks at the farm every `reactMs` (no instant clicks) and,
 * like a Manor Lords lord, assigns farmers instead of doing the work: every field (crop plan
 * "Best in season", which rotates crops; it never spreads manure) and pen gets a farmer. With none to spare it builds a cottage, one at a time, for a family to
 * move into, and meanwhile has a free farmer work an unstaffed field by hand (a tap). It feeds the families its own
 * crops: a day's meals in store, and from autumn into early spring enough to last the winter (no new cottage until
 * that is in store); with firewood for every home bought from autumn. It sells the rest,
 * buys feed, builds up to `maxFields` fields (construction sites the free farmers build, with a path
 * to each), keeps chickens (and cows from level 3) and claims finished goals. Before building it buys
 * the materials it lacks at the Market, in fives like the Market's buttons. The map is the one a new game gets from
 * `MAP_SEED`: a grove and a stone outcrop on the starting land, an iron vein next door. It follows the storage goals
 * (build, then upgrade a granary) and, when a farmer waits because the granary is full, upgrades or builds
 * one; it makes room in the storehouse the same way before shopping for more materials than fit (selling materials
 * the purchase doesn't need first). From level 2 it builds a woodcutter's lodge, then a quarry with the lodge's wood;
 * it staffs them in winter with the farmers whose fields are frozen, and sends them back to the fields in spring, so it
 * hires nobody for them and buys only the materials they haven't made. It sells materials beyond 10 of each. It never uses processing
 * buildings, never builds where it would wall off land the farmhouse reaches, and buys land only when it runs out
 * of room, so a real player who does more should level at least as fast. Hazards are on at their normal rates: from
 * level 2 it builds scarecrows and wells where they guard fields nothing guards yet, from level 3 a kennel by the coop,
 * and for a harsh winter it stocks the wood the warning asks for.
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
/** The travelling traders' schedule and offers, fixed so the runs repeat. */
const TRADER_SEED = 79;

function simulate({ reactMs, maxFields, minutes, hazardSeed }: { reactMs: number; maxFields: number; minutes: number; hazardSeed: number }): Sim {
  const state = createNewGame();
  state.ext[MAP_SLICE] = newMapLayer(state, MAP_SEED);
  hazardsOf(state).seed = hazardSeed;
  traderOf(state).seed = TRADER_SEED;
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
  let buyingFirewood = false;
  let buyingDefence = false;
  // Building materials bought (firewood for the families and the stone and wood for defences are counted apart: the
  // check below is about the lodge and quarry keeping up with the farm's buildings).
  game.activity.on('bought', ({ item, qty }) => {
    if (!buyingFirewood && !buyingDefence) bought[item] = (bought[item] ?? 0) + qty;
  });
  const STEP = 1000;
  /** Units it sells past an item's daily allowance: a price up to this many % down is still worth taking. */
  const FLOOD_OK = 10;
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
    // The whole map is open: like a player, it builds close to the farmhouse first.
    const door = doorOf(farmhouseOf(game.state)!);
    spots.sort((a, b) => Math.abs(a.x - door.x) + Math.abs(a.y - door.y) - (Math.abs(b.x - door.x) + Math.abs(b.y - door.y)));
    const area = (s: { x: number; y: number }) => ({ ...s, ...def.footprint });
    // Same as trying findRoute, then connectToFarmhouse, on each spot, but one flood fill each instead of one per spot.
    const onPaths = reachable(game.state, (o) => o?.type === PATH);
    // Trees and rocks are in the way of paths too.
    const free = (o: PlacedObject | undefined, x: number, y: number) =>
      inBounds(game.state.land, x, y) && (o ? o.type === PATH : !ruleBlock(game.state, { w: 1, h: 1 }, x, y, PATH));
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
    // A well, scarecrow or kennel goes where it guards the most fields or coops nothing guards yet.
    const defence = DEFENCES[type as DefenceType];
    const unguarded = (s: { x: number; y: number }) => guardedBy(game.state, defence.id, area(s)).filter((o) => !isProtected(game.state, o, defence.against)).length;
    const worth = (s: { x: number; y: number }) =>
      defence ? unguarded(s) : res?.range ? treesInRange(layer, area(s), res.range).length : res?.deposit ? depositsUnder(layer, area(s), res.deposit).length * 100 - overhang(s) : 0;
    const overhang = (s: { x: number; y: number }) => {
      let n = 0;
      for (let y = s.y; y < s.y + def.footprint.h; y++) for (let x = s.x; x < s.x + def.footprint.w; x++) n += layer.deposits.some((d) => x >= d.x && y >= d.y && x < d.x + d.w && y < d.y + d.h) ? 0 : 1;
      return n;
    };
    if (res || defence) spots.sort((a, b) => worth(b) - worth(a));
    // A defence where it guards nothing new is money wasted.
    if (defence) spots.splice(spots.findIndex((s) => worth(s) === 0) >>> 0);
    const spot = spots.find((s) => fits(s, onPaths)) ?? spots.find((s) => fits(s, onLand));
    // The whole map is open: no room left means nowhere a path reaches.
    if (!spot) return null;
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
  const tapCtx = { game, ui: { toast: () => {} } } as unknown as FarmContext;
  const pens = (type: PenType) => game.objectsOfType(type) as PlacedObject<PenState>[];

  const act = () => {
    for (const g of game.progression.goals()) if (g.complete) game.progression.claim(g.def.id);
    // Like a player, it follows the storage goals.
    const goals = new Set(game.progression.goals().map((g) => g.def.id));
    if (goals.has('build-granary') || goals.has('upgrade-granary')) makeRoom('goods');
    // Food for the families (none while they live on their provisions): its cheap crops (wheat, carrots, corn); the
    // dearer eggs and milk are sold. A day's meals, and from autumn until the first spring harvest (a crop sown in
    // spring can take two days) enough for winter and those days, split across the kinds (meals are spread across them).
    const families = workersOf(game.state).farmers;
    const winterSoon = seasonAt(game.now) === 'winter' || seasonAt(nextSeasonAt(game.now)) === 'winter';
    const fed = game.now >= PROVISION_DAYS * DAY_MS;
    const PANTRY: readonly string[] = FOODS.filter((id) => getItem(id)?.category === 'crop');
    const foodKinds = PANTRY.filter((id) => game.count(id) > 0).length || 1;
    const lean = winterSoon || (seasonAt(game.now) === 'spring' && dayOfSeason(game.state.clock) <= 2);
    const days = lean ? SEASON_DAYS + 4 : 1;
    const keepFood = fed ? Math.ceil((days * MEAL_PER_FAMILY * families) / foodKinds) + 1 : 0;
    // A trader in the yard gets first pick of what it would sell.
    updateTrader(game);
    const trader = traderHere(game.state);
    trader?.wants.forEach((w, i) => {
      const spare = game.count(w.item) - (PANTRY.includes(w.item) ? keepFood : 0);
      if (spare > 0) sellToTrader(game, i, spare);
    });
    // It doesn't flood the Market: past an item's daily allowance (and a 10% drop) it keeps the rest for tomorrow,
    // unless the granary is half full.
    const tight = used(game.state, 'goods') >= 0.5 * capacity(game.state, 'goods');
    for (const id of Object.keys(game.state.inventory)) {
      if (id === 'feed' || isMaterial(id)) continue;
      const keep = PANTRY.includes(id) ? keepFood : 0;
      const room = tight ? Infinity : Math.max(0, allowance(id) + FLOOD_OK - (marketOf(game.state).sold[id] ?? 0));
      const n = Math.min(game.count(id) - keep, room);
      if (n > 0) sell(game, id, n);
    }
    // A harsh winter (announced at the start of autumn) takes twice the wood: it stocks what the warning says.
    const harsh = harshWinterAt(game.state, nextSeasonAt(game.now)) || harshWinterAt(game.state, game.now);
    const firewood = harsh ? harshWinterWood(game.state) : SEASON_DAYS * FIREWOOD_PER_HOME * Math.min(families, homesOf(game.state));
    // Materials its buildings made beyond a working stock are sold too.
    for (const id of MATERIAL_IDS) {
      const keep = id === 'wood' ? Math.max(KEEP_MATERIALS, firewood) : KEEP_MATERIALS;
      if (game.count(id) > keep) sell(game, id, game.count(id) - keep);
    }
    const fields = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    const resources = [...game.objectsOfType('woodcutter'), ...game.objectsOfType('quarry')].filter((o) => !o.site);
    const workplaces = [...pens('coop'), ...pens('pasture'), ...fields].filter((o) => !o.site);
    // Winter: farmers whose fields can't be sown cut wood and break stone instead; when the ground thaws they go back.
    const frozen = (f: PlacedObject) => (workplaceNext(game, f) as { wait?: string }).wait === 'season';
    for (const r of resources) {
      const farmer = workerAt(game.state, r.id);
      const field = fields.find((f) => !f.site && (farmer === null ? workerAt(game.state, f.id) !== null && frozen(f) : workerAt(game.state, f.id) === null && !frozen(f)));
      if (field) assignFarmer(game, farmer === null ? r.id : field.id, farmer ?? workerAt(game.state, field.id)!);
      // A family with no other workplace works it all year.
      if (workerAt(game.state, r.id) === null && workersOf(game.state).workplaces.includes(null)) assignFarmer(game, r.id);
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
    // Staff every finished field and pen; for those left without a farmer, build cottages so families come for them.
    // (Fields frozen in winter don't count: their farmers are at the lodge and the quarry.)
    const unstaffed = workplaces.filter((wp) => workerAt(game.state, wp.id) === null && !frozen(wp) && !assignFarmer(game, wp.id).ok).length;
    const comingHomes = homesOf(game.state) - workersOf(game.state).farmers + game.objectsOfType(COTTAGE).filter((o) => o.site).length;
    // Only when the pantry holds its reserve: a family it can't feed would leave again.
    const pantry = PANTRY.reduce((n, id) => n + game.count(id), 0);
    if (unstaffed > 0 && comingHomes <= 0 && pantry >= (keepFood - 1) * foodKinds) build(COTTAGE, 40);
    // While a family is on its way, a field nobody works gets a tap: a free farmer ploughs, sows or harvests it by hand.
    for (const f of fields) {
      if (f.site || workerAt(game.state, f.id) !== null || freeFarmers(game.state) === 0) continue;
      if (cropPlanOf(game.state, f.id) === PLAN_FALLOW) setCropPlan(game, f.id, PLAN_BEST);
      const next = workplaceNext(game, f);
      if ('task' in next) withFarmer(tapCtx, next.task.kind, f, next.task.workMs, () => next.task.run(0, 1));
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
    // Its own materials from level 2 (cottages and firewood take wood): a woodcutter's lodge, then a quarry built with
    // the lodge's wood.
    if (game.level >= 2 && game.objectsOfType('woodcutter').length === 0) build('woodcutter', 40);
    if (game.objectsOfType('quarry').length === 0 && game.missingMaterials(getBuildable('quarry')!.materials).length === 0) build('quarry', 40);
    const stocked = pens('coop').some((p) => p.state.animals.length > 0);
    // Past the first four, no more fields while some have nobody to work them: the money goes to cottages first.
    if (fields.length < maxFields && (fields.length < 4 || stocked) && (fields.length < 4 || unstaffed === 0)) build(FIELD, 40);
    stock('pasture', 'cow', 100);
    // The cheap defences, one site at a time, where they guard what nothing guards yet: scarecrows and wells for the
    // fields from level 2, a kennel for the coop from level 3.
    const guard = (type: DefenceType, targets: PlacedObject[]) => {
      if (!game.isUnlocked(DEFENCES[type].unlockLevel) || game.objectsOfType(type).some((o) => o.site)) return;
      if (!targets.some((o) => !o.site && !isProtected(game.state, o, DEFENCES[type].against))) return;
      buyingDefence = true;
      build(type, 40);
      buyingDefence = false;
    };
    if (fields.length >= 4) {
      guard('scarecrow', fields);
      guard('well', fields);
    }
    if (stocked) guard('kennel', pens('coop'));
    // Firewood for a whole winter (after building, which may have used wood), bought from autumn on if its own lodge
    // hasn't made it: in fives, as far as the money goes.
    for (let i = 0; winterSoon && i < 10 && game.count('wood') < firewood && game.money >= 5 * buyPrice(game.day, 'wood')!; i++) {
      if (used(game.state, 'materials') + 5 > capacity(game.state, 'materials')) makeRoom('materials');
      buyingFirewood = true;
      const ok = buy(game, 'wood', 5).ok;
      buyingFirewood = false;
      if (!ok) break;
    }
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

/**
 * The hazards' seed for the runs: with it a harsh winter comes in the first year (announced at minute 64, once the
 * players are at level 3) and a drought in the second summer, besides crows and foxes. Over seeds 1–8: casual L5
 * 173.0 min, relaxed 161.0–172.5, busy 148.0–150.5.
 */
const HAZARD_SEED = 4;

// Hazards on at their normal rates (the test setup turns them off for other tests).
setHazardsEnabled(true);

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
  // Soil fertility (rich start patch, yield by fertility, drain per harvest, double for the same crop, "Best in season"
  // rotating, no manure): casual L2 9.0, L5 173.0; relaxed L2 8.5, L5 158.0; busy L2 8.2, L5 162.0. Its fields end the
  // 3 h worn down (often under 20%): fallow and manure are for a real player to use.
  // Map resources (the lodge fells the start grove, the quarry stands on the start outcrop, map seed MAP_SEED):
  // casual L2 10.0, L5 167.0; relaxed L2 8.5, L5 166.0; busy L2 8.2, L5 167.8.
  // Map resources and soil fertility together: casual L2 9.0, L5 173.0; relaxed L2 8.5, L5 157.0; busy L2 8.2, L5 161.9.
  // All three with families (lodge from level 2, since cottages and firewood take wood; at level 3 the relaxed player
  // bought over 70% of its materials): casual L2 9.0, L5 174.0; relaxed L2 9.5, L5 172.5; busy L2 9.2, L5 145.2.
  // Then families instead of hiring: a family moves into a cottage ($80 + 8 wood) half a day after it is built, and eats
  // 2 food a day (about a fifth of what the farm makes; up to ~1,600 of the $ it would have sold in 3 h), plus firewood
  // in winter. Tapping unstaffed fields while families are on their way makes up the early game; the "build a coop"
  // goal now counts a coop built before it shows (it blocked a goal slot for good). With level 5 at 6000 XP the casual
  // player missed it (≈5900 XP in 3 h), at 5500 reached it at 183 min; at 5000: casual L2 9.0, L5 171.0; relaxed
  // L2 9.0, L5 159.0; busy L2 9.0, L5 153.7.
  // More crops (potato at level 3, barley at 4; "Best in season" sows potato before corn comes): casual L2 9.0, L5 158.0;
  // relaxed L2 9.5, L5 151.0; busy L2 9.2, L5 137.4.
  // (The next numbers, for saturation and traders, were measured before more crops came in.)
  // Market saturation (each item's price falls past ~$150 a day of it, recovering a quarter a day) and travelling
  // traders from level 3. Selling everything at once as before: casual L5 174.0, relaxed 176.0, busy 146.8. It now
  // sells each item only up to the day's allowance and 10 more (unless the granary is half full), and its wanted goods to
  // a trader first: casual L2 9.0, L5 156.0; relaxed L2 9.5, L5 172.5; busy L2 9.2, L5 119.3 (trader seed 79; over
  // seeds 1-5 relaxed L5 172.5-178.5, casual 162-173, the same as before saturation: relaxed 172.5, casual 174.0).
  // Both with more crops: casual L2 9.0, L5 152.0; relaxed L2 9.5, L5 158.0; busy L2 9.2, L5 133.8 (trader seeds 1-3:
  // casual 152-158, relaxed 152-158, busy 116-141).
  // Hazards (harsh winters, droughts, crows, foxes), with scarecrows and wells from level 2 and a kennel from level 3
  // (no losses after them) and the harsh winter's wood stocked, on top of the new crops: casual L2 9.0, L5 174.0;
  // relaxed L2 9.5, L5 158.5; busy L2 9.2, L5 149.2 (seeds 1–8: casual L5 at most 175.0). Without the defences a casual
  // or relaxed player could miss level 5 in 3 h. With saturation and traders as well (trader seed 79): casual L2 9.0,
  // L5 167.0; relaxed L2 9.5, L5 158.0; busy L2 9.2, L5 152.0.
  // The whole map open from the start (no land to buy; each player builds nearest the farmhouse first): casual L2 9.0,
  // L5 175.0; relaxed L2 9.0, L5 157.5; busy L2 9.0, L5 148.3 (before: casual L5 170.0, relaxed 158.0, busy 155.5).
  const casual = simulate({ reactMs: 60_000, maxFields: 6, minutes: 190, hazardSeed: HAZARD_SEED });
  const relaxed = simulate({ reactMs: 30_000, maxFields: 8, minutes: 190, hazardSeed: HAZARD_SEED });
  const busy = simulate({ reactMs: 10_000, maxFields: 12, minutes: 190, hazardSeed: HAZARD_SEED });

  it('runs with hazards on: a harsh winter, a drought, crows and foxes come, and the defences keep them off', () => {
    for (const sim of [casual, relaxed, busy]) {
      const log = hazardsOf(sim.game.state).log;
      expect(new Set(log.map((n) => n.kind))).toEqual(new Set(['harsh-winter', 'drought', 'crows', 'fox']));
      expect(log.some((n) => n.outcome === 'defended')).toBe(true);
      for (const type of ['well', 'scarecrow', 'kennel']) expect(sim.game.objectsOfType(type).length, type).toBeGreaterThan(0);
    }
  });

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

/**
 * Tools: an equipped farm of 8 farmers on its own iron. Two fields, two coops, a quarry, a mine and a builder, with the
 * eighth farmer at the blacksmith keeping one set of tools in store per farmer (so everyone stays equipped). Run for
 * a year to fill the stores, then a year measured: the iron the forge burns against what the mine digs.
 */
describe('tools balance', () => {
  const FARMERS = 8;

  function equippedFarm() {
    const game = new Game(maxLevelState());
    game.earn(1_000_000);
    setHazardsEnabled(false);
    const land = game.state.land;
    while (workersOf(game.state).farmers < FARMERS) addFarmer(game);
    // Each building at the first free spot (scanning rows below the starting layout) a path can reach.
    const place = (type: string, site = false) => {
      const fp = getBuildable(type)!.footprint;
      // A quarry or mine stands on its deposit: lay a deep one under each spot tried.
      const deposit = (RESOURCES as Record<string, { deposit?: 'stone' | 'iron' }>)[type]?.deposit;
      for (let y = START_LAND.y + 8; y < land.height - fp.h; y += 1) {
        for (let x = 1; x < land.width - fp.w; x += 1) {
          if (deposit) addDeposit(mapOf(game.state), deposit, { x, y, ...fp }, 100_000);
          if (!game.checkPlacement(type, x, y).ok) continue;
          const r = game.place(type, x, y, { site });
          if (!r.ok) continue;
          if (connectToFarmhouse(game.state, { x, y, ...fp })) return r.object;
          game.demolish(r.object.id);
        }
      }
      throw new Error(`no room for ${type}`);
    };
    for (let i = 0; i < 3; i++) place(GRANARY).state.level = 3;
    place('storehouse').state.level = 3;
    const mine = place('mine');
    const quarry = place('quarry');
    const coops = [place('coop'), place('coop')];
    for (const c of coops) for (let i = 0; i < 4; i++) buyAnimal(game, c as unknown as PlacedObject<PenState>, 'chicken');
    const smith = place('blacksmith');
    setKeepMaking(game, smith.id, 'tools');
    // The test farm's 1000 of each material would fill every store: start from a working stock instead.
    Object.assign(game.state.inventory, { wood: 40, stone: 40, iron: 10 });
    const fields = game.objectsOfType(FIELD);
    const workplaces = [...fields.slice(0, 2), ...coops, quarry, mine, smith].map((o) => o.id);
    workplaces.forEach((id, i) => assignFarmer(game, id, i));
    return { game, place, workplaces };
  }

  afterEach(() => setHazardsEnabled(true));

  it('an 8-farmer farm keeping everyone equipped needs no more iron than one mine digs', () => {
    const { game, place, workplaces } = equippedFarm();
    let iron = 0;
    let forged = 0;
    let taken = 0;
    let jobs = 0;
    game.activity.on('produced', ({ item, qty }) => item === 'iron' && (iron += qty));
    game.activity.on('jobStarted', ({ recipe }) => recipe === 'tools' && forged++);
    game.activity.on('toolTaken', () => taken++);
    game.activity.on('workStarted', () => jobs++);
    let site = 0;
    const year = 4 * SEASON_DAYS;
    for (let day = 0; day < 2 * year; day++) {
      if (day === year) [iron, forged, taken, jobs] = [0, 0, 0, 0];
      // Keep the farm as it is: food, feed and wood for the families and coops, farmers who left back, and a new site
      // for the builder every other day (a well).
      for (const food of ['wheat', 'carrot', 'potato', 'cabbage', 'bread', 'cheese', 'cloth']) game.state.inventory[food] = 40;
      game.state.inventory.feed = 100;
      // Wood for the forge, the firewood and the wells; the quarry's stone is sold off.
      game.state.inventory.wood = 40;
      game.state.inventory.stone = 40;
      while (workersOf(game.state).farmers < FARMERS) addFarmer(game);
      workplaces.forEach((id, i) => workerAt(game.state, id) === null && assignFarmer(game, id, i));
      if (day % 2 === 0 && site++ < 2 * year) place('well', true);
      game.advance(DAY_MS);
    }
    const seasons = 4;
    // Measured: 1.5 tools forged (and taken) a season, from some 60 jobs a season over the 8 farmers (fields, coops and
    // the builder wait on crops, eggs and sites most of the time), against 3.0 iron a season from the mine (slower in
    // winter, and its farmer walks). The issue guessed 5-7 tools a season; at 30 jobs a tool it is half a mine.
    expect(forged / seasons).toBeGreaterThanOrEqual(1);
    expect(taken).toBeGreaterThan(0);
    // Every tool forged took one iron: the forge burns no more than one mine digs, and leaves some for buildings.
    expect(forged).toBeLessThan(iron);
    expect(jobs).toBeGreaterThan(0);
  });
});
