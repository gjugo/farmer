import { isPenType } from './animals';
import { getBuildable } from '../data/buildables';
import { FIELD } from '../data/crops';
import { FARMHOUSE } from '../data/farmhouse';
import { isResourceType } from '../data/resourceBuildings';
import { MILL } from '../data/processing';
import { PLOUGH_SEASONS } from '../data/seasons';
import { MAP_HEIGHT, MAP_WIDTH, START_LAND } from './constants';
import { createLand, type Rect } from './land';
import { MAP_BLOCKS, MAP_SLICE, migrateMapLayer } from './maplayer';
import { initialProgression, PROGRESSION } from './progression';
import { seasonAt } from './seasons';
import { areaSoil } from './soil';
import { spaceFor, STORAGE_SLICE } from './storage';
import { migrateOrdersSlice } from './orders';
import { GUIDE_STEPS } from '../data/guide';
import { FARMHOUSE_GROWN_IN, growFarmhouse } from './farmhouse';
import { ensureFarmhouse } from './roads';
import { ensureMainRoad, ROAD_SLICE } from './mainroad';
import { TRADE_SLICE } from './tradepost';
import { applySliceDefaults, isPlainObject, shiftSlices } from './slices';
import { createNewGame } from './state';
import type { GameState, Inventory, PlacedObject } from './types';
import { requiredLevel, xpForLevel } from './unlocks';
// The workers slice holds tile coordinates (jobs and their routes); the map migration must know how to move them.
import './workers';

export const SAVE_KEY = 'farmer.save';

/**
 * Bump when the save shape changes in a way defaults cannot cover (renames,
 * restructuring) and add a migration below. Purely additive fields need no bump:
 * `normalize` fills anything missing with defaults.
 */
export const SAVE_VERSION = 20;

export interface SaveFile {
  version: number;
  /** Real time (`Date.now()`) the save was written; null when unknown (older saves). Offline catch-up runs from here. */
  savedAt: number | null;
  state: GameState;
}

/** A loaded save: the state plus when it was written (null when unknown, e.g. a new game or an older save). */
export interface LoadedSave {
  state: GameState;
  savedAt: number | null;
}

type RawSave = Record<string, unknown>;

/**
 * migrations[n] upgrades a version-n save to version n+1.
 * Version 0 is the pre-release shape: game state fields at the top level, no `version`.
 */
const migrations: Record<number, (raw: RawSave) => RawSave> = {
  0: (raw) => ({ version: 1, savedAt: 0, state: raw }),
  // Orders board (#7): known goods = what the inventory holds now, fresh orders.
  1: (raw) => ({ ...raw, version: 2, state: migrateOrdersSlice(isPlainObject(raw.state) ? raw.state : {}) }),
  // Version 3 catches up on time away from `savedAt`. Older saves never meant it that way, so their first load skips catch-up.
  2: (raw) => ({ ...raw, version: 3, savedAt: null }),
  // Farm levels: start at the lowest level that unlocks everything already on the farm.
  3: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const xp = xpForLevel(requiredLevel(state.objects));
    return { ...raw, version: 4, state: { ...state, ext: { ...ext, [PROGRESSION]: initialProgression(xp) } } };
  },
  // Seasons: fields need ploughing. Fields of older farms count as ploughed now, unless it is winter.
  4: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const clock = isPlainObject(state.clock) ? state.clock : {};
    const now = isNonNegNumber(clock.elapsed) ? clock.elapsed : 0;
    const ploughedAt = PLOUGH_SEASONS.includes(seasonAt(now)) ? now : null;
    const objects = Array.isArray(state.objects)
      ? state.objects.map((o: unknown) =>
          isPlainObject(o) && o.type === FIELD ? { ...o, state: { ...(isPlainObject(o.state) ? o.state : {}), ploughedAt } } : o,
        )
      : state.objects;
    return { ...raw, version: 5, state: { ...state, objects } };
  },
  // Building materials: the "buy wood" goal was inserted into the goal list. Farms already past that point skip it
  // (their next-goal index moves along with the goals after it). Inventories need nothing: no materials yet.
  // Indexes are into the goal list of the version migrated to (later versions insert more goals).
  5: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const p = ext[PROGRESSION];
    const at = 3; // "buy-wood" in version 6
    if (!isPlainObject(p) || typeof p.nextGoal !== 'number' || p.nextGoal <= at) return { ...raw, version: 6 };
    return { ...raw, version: 6, state: { ...state, ext: { ...ext, [PROGRESSION]: { ...p, nextGoal: p.nextGoal + 1 } } } };
  },
  // Storage: goods and materials need room in granaries and storehouses. The farm keeps everything it holds (even
  // above capacity) and is told once to build a granary. Two goals were inserted; farms past them skip them.
  6: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const p = ext[PROGRESSION];
    let progression = p;
    if (isPlainObject(p) && typeof p.nextGoal === 'number') {
      let nextGoal = p.nextGoal;
      // "build-granary" and "upgrade-granary" in version 7.
      for (const at of [2, 11]) if (nextGoal > at) nextGoal++;
      progression = { ...p, nextGoal };
    }
    return { ...raw, version: 7, state: { ...state, ext: { ...ext, [PROGRESSION]: progression, [STORAGE_SLICE]: { pendingNotice: true } } } };
  },
  // Bigger map: the old farm moves into the middle of the new one (see `growMap`).
  7: (raw) => ({ ...raw, version: 8, state: growMap(isPlainObject(raw.state) ? raw.state : {}) }),
  // Resource buildings: four goals were inserted (woodcutter, wood, quarry, iron). Farms past them skip them.
  8: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const p = ext[PROGRESSION];
    if (!isPlainObject(p) || typeof p.nextGoal !== 'number') return { ...raw, version: 9 };
    let nextGoal = p.nextGoal;
    // "build-woodcutter", "produce-wood", "build-quarry" and "mine-iron" in version 9.
    for (const at of [17, 18, 19, 21]) if (nextGoal > at) nextGoal++;
    return { ...raw, version: 9, state: { ...state, ext: { ...ext, [PROGRESSION]: { ...p, nextGoal } } } };
  },
  // Soil fertility: every field starts at the soil quality of its land, resting from now, with no last crop. The
  // "spread-manure" goal was inserted (index 14 in version 10, after "own-cows"); farms past it skip it.
  9: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const p = ext[PROGRESSION];
    const progression = isPlainObject(p) && typeof p.nextGoal === 'number' && p.nextGoal > 14 ? { ...p, nextGoal: p.nextGoal + 1 } : p;
    const clock = isPlainObject(state.clock) ? state.clock : {};
    const now = isNonNegNumber(clock.elapsed) ? clock.elapsed : 0;
    const objects = Array.isArray(state.objects)
      ? state.objects.map((o: unknown) => {
          if (!isPlainObject(o) || o.type !== FIELD || !Number.isInteger(o.x) || !Number.isInteger(o.y)) return o;
          const fertility = areaSoil({ x: o.x as number, y: o.y as number, ...(getBuildable(FIELD)?.footprint ?? { w: 2, h: 2 }) });
          const fieldState = isPlainObject(o.state) ? o.state : {};
          return { ...o, state: { ...fieldState, fertility, restingSince: fieldState.crop ? null : now, lastCrop: null } };
        })
      : state.objects;
    return { ...raw, version: 10, state: { ...state, objects, ext: p === undefined ? state.ext : { ...ext, [PROGRESSION]: progression } } };
  },
  // Map resources: forests and deposits generated around what the farm has built (never on top of it). Every
  // quarry and mine gets a deposit under it and every lodge a grove in reach, so nothing stops working.
  10: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    return { ...raw, version: 11, state: { ...state, ext: { ...ext, [MAP_SLICE]: migrateMapLayer(state) } } };
  },
  // Families: farmers live in homes and cash hiring is gone. The farm keeps every farmer it has, housed or not (no
  // family arrives while there are more farmers than homes; nobody leaves for lack of one), and its families start
  // counting days from the first load. Two goals were inserted ("build-cottage", "house-families"); farms past them skip them.
  11: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const p = ext[PROGRESSION];
    if (!isPlainObject(p) || typeof p.nextGoal !== 'number') return { ...raw, version: 12 };
    let nextGoal = p.nextGoal;
    // "build-cottage" and "house-families" in version 12.
    for (const at of [5, 14]) if (nextGoal > at) nextGoal++;
    return { ...raw, version: 12, state: { ...state, ext: { ...ext, [PROGRESSION]: { ...p, nextGoal } } } };
  },
  // Oxcart hauling: a resource building's yield now lands in its yard (`waiting`) instead of the storehouse. What
  // waited there for room stays in the yard, a whole count (its farmer carries it in once the yard is full, or a
  // cart hauls it). Jobs gain an optional `haul` trip and ox barns their own state: nothing to fill in.
  12: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const objects = Array.isArray(state.objects)
      ? state.objects.map((o: unknown) => {
          if (!isPlainObject(o) || !isResourceType(o.type)) return o;
          const s = isPlainObject(o.state) ? o.state : {};
          const waiting = typeof s.waiting === 'number' && Number.isFinite(s.waiting) && s.waiting > 0 ? Math.ceil(s.waiting) : 0;
          return { ...o, state: { ...s, waiting } };
        })
      : state.objects;
    return { ...raw, version: 13, state: { ...state, objects } };
  },
  // Tools (the blacksmith): every farmer gets a tool slot, empty.
  13: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const workers = ext.workers;
    if (!isPlainObject(workers)) return { ...raw, version: 14 };
    const farmers = Number.isInteger(workers.farmers) && (workers.farmers as number) > 0 ? (workers.farmers as number) : 1;
    const tools = Array.from({ length: farmers }, () => null);
    return { ...raw, version: 14, state: { ...state, ext: { ...ext, workers: { ...workers, tools } } } };
  },
  // The whole map is open: every tile is the farm's, no land is bought any more (none refunded either). Nothing
  // moves. The "Buy a plot of land" goal became "Own 10 fields" in its slot: an active one is renamed.
  14: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const land = createLand(MAP_WIDTH, MAP_HEIGHT);
    const p = ext[PROGRESSION];
    if (!isPlainObject(p) || !Array.isArray(p.goals)) return { ...raw, version: 15, state: { ...state, land } };
    const goals = p.goals.map((g: unknown) => (isPlainObject(g) && g.id === OLD_LAND_GOAL ? { ...g, id: LAND_GOAL_NOW, progress: 0 } : g));
    return { ...raw, version: 15, state: { ...state, land, ext: { ...ext, [PROGRESSION]: { ...p, goals } } } };
  },
  // The main road and the trading post: trade needs a trading post linked to the road. The road is laid on load
  // (`ensureMainRoad`) from a seed the save already holds (the trader's, else the clock), round what is built. The
  // "Buy 10 wood at the Market" goal became "Build a trading post" in its slot: an active one is renamed. The guide
  // gained a trading-post step (see `guideStepNow`). The farm is told once (`TRADE_SLICE`).
  15: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const out: Record<string, unknown> = { ...ext, [TRADE_SLICE]: { pendingNotice: true } };
    const trader = isPlainObject(ext.trader) ? ext.trader : {};
    const clock = isPlainObject(state.clock) ? state.clock : {};
    const seed =
      typeof trader.seed === 'number' && Number.isFinite(trader.seed)
        ? trader.seed >>> 0
        : ((isNonNegNumber(clock.elapsed) ? Math.floor(clock.elapsed) : 0) ^ 0x40ad) >>> 0;
    out[ROAD_SLICE] = { seed, side: null, tiles: [], pending: true };
    const p = ext[PROGRESSION];
    if (isPlainObject(p) && Array.isArray(p.goals)) {
      const goals = p.goals.map((g: unknown) => (isPlainObject(g) && g.id === OLD_WOOD_GOAL ? { ...g, id: POST_GOAL_NOW, progress: 0 } : g));
      out[PROGRESSION] = { ...p, goals };
    }
    const guide = ext.guide;
    if (isPlainObject(guide) && typeof guide.step === 'number') out.guide = { ...guide, step: guideStepNow(guide.step) };
    return { ...raw, version: 16, state: { ...state, ext: out } };
  },
  // The farmhouse became a building of its own, built later: a new farm starts with only the camp. Nothing in a save
  // changes (an older farm keeps its farmhouse); only saves from before this one get a missing farmhouse back
  // (`FARMHOUSE_REPAIR_BEFORE`). The guide's steps were reordered for the new start: a guide in progress keeps its step.
  16: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const guide = ext.guide;
    if (!isPlainObject(guide) || typeof guide.step !== 'number') return { ...raw, version: 17 };
    return { ...raw, version: 17, state: { ...state, ext: { ...ext, guide: { ...guide, step: guideStepV17(guide.step) } } } };
  },
  // The farmhouse became 3×3 with levels: an old 2×2 one grows into the 3×3 at level 1 when the save loads, over its
  // old footprint or nearby (`growFarmhouse`, `FARMHOUSE_GROWN_IN`), since that needs the whole farm. Nothing to do here.
  17: (raw) => ({ ...raw, version: 18 }),
  // Winter feeding (the Feed Barn): animals graze from spring to autumn and eat feed only in winter, and one left
  // hungry through a whole winter day with no feed starves. Each animal notes since when it is hungry: a hungry one
  // from now (so none can starve on the first day after loading), one eating or with its product waiting not at all.
  // Its cycle stays as it was.
  18: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const clock = isPlainObject(state.clock) ? state.clock : {};
    const now = isNonNegNumber(clock.elapsed) ? clock.elapsed : 0;
    const objects = Array.isArray(state.objects)
      ? state.objects.map((o: unknown) => {
          if (!isPlainObject(o) || !isPenType(o.type as string) || !isPlainObject(o.state) || !Array.isArray(o.state.animals)) return o;
          const animals = o.state.animals.map((a: unknown) => (isPlainObject(a) ? { ...a, hungrySince: a.timer ? null : now } : a));
          return { ...o, state: { ...o.state, animals } };
        })
      : state.objects;
    return { ...raw, version: 19, state: { ...state, objects } };
  },
  // The feed mill became the Windmill, which grinds flour (the Feed Barn makes feed). Its feed jobs are refunded when
  // the save loads (`refundMillFeed`, since that needs the farm's storage room); here a "Keep making" set to a feed
  // recipe is cleared. Feed waiting in a mill stays to be collected, and bakery jobs on the old bread recipe just finish.
  19: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const workers = ext.workers;
    if (!isPlainObject(workers) || !isPlainObject(workers.recipes)) return { ...raw, version: 20 };
    const recipes = Object.fromEntries(Object.entries(workers.recipes).filter(([, r]) => typeof r !== 'string' || !Object.hasOwn(OLD_MILL_FEED, r)));
    return { ...raw, version: 20, state: { ...state, ext: { ...ext, workers: { ...workers, recipes } } } };
  },
};

/** The feed mill's recipes before it became the Windmill (version 19): what each job took. */
const OLD_MILL_FEED: Readonly<Record<string, Inventory>> = {
  'feed-from-wheat': { wheat: 2 },
  'feed-from-corn': { corn: 1 },
  'feed-from-barley': { barley: 2 },
};

/** Saves older than this may have feed jobs queued at the mill (`refundMillFeed`). */
export const MILL_FLOUR_IN = 20;

/**
 * The feed jobs queued or running at a mill from before it became the Windmill are dropped, and their inputs go back
 * into store while there is room (what doesn't fit is lost). Only for saves from before `MILL_FLOUR_IN`.
 */
export function refundMillFeed(state: GameState): void {
  for (const o of state.objects) {
    if (o.type !== MILL || !Array.isArray(o.state.queue)) continue;
    const queue = o.state.queue as unknown[];
    const old = queue.filter((j) => isPlainObject(j) && typeof j.recipe === 'string' && Object.hasOwn(OLD_MILL_FEED, j.recipe));
    if (old.length === 0) continue;
    o.state.queue = queue.filter((j) => !old.includes(j));
    for (const job of old as { recipe: string }[]) {
      for (const [item, qty] of Object.entries(OLD_MILL_FEED[job.recipe])) {
        const n = Math.min(qty, spaceFor(state, item));
        if (n > 0) state.inventory[item] = (state.inventory[item] ?? 0) + n;
      }
    }
  }
}

/** Version 16's guide steps, in order. */
const GUIDE_V16 = ['look', 'assign', 'speed', 'sow', 'develop', 'field', 'harvest', 'materials', 'post', 'sell', 'granary', 'cottage', 'done'];

/** A version-16 guide step in version 17's list (the same step by id; one done already is skipped when it comes up). */
function guideStepV17(step: number): number {
  const at = GUIDE_STEPS.findIndex((s) => s.id === GUIDE_V16[step]);
  return at >= 0 ? at : 0;
}

/** Does the raw save's farmhouse have a level (so it is 3×3 already)? */
function savedWithLevel(file: RawSave): boolean {
  const state = isPlainObject(file.state) ? file.state : {};
  const objects = Array.isArray(state.objects) ? state.objects : [];
  return objects.some((o: unknown) => isPlainObject(o) && o.type === FARMHOUSE && isPlainObject(o.state) && typeof o.state.level === 'number');
}

/** Saves older than this that lack a farmhouse get one on loading; from this version on a farm without one is normal. */
export const FARMHOUSE_REPAIR_BEFORE = 17;

/** The goal slot that was "Buy 10 wood at the Market" (version 15) and is "Build a trading post" since. */
const OLD_WOOD_GOAL = 'buy-wood';
const POST_GOAL_NOW = 'build-trading-post';
/**
 * A version-15 guide step in version 16's list: "Wood and stone" (8) moved before "Sell" (7), and "Build a trading
 * post" came in between them. A guide on "Sell" or "Wood and stone" goes to "Wood and stone" (a step already done is
 * skipped when it comes up); later ones move along one.
 */
function guideStepNow(step: number): number {
  return step < 7 ? step : step <= 8 ? 7 : step + 1;
}

/** The goal slot that was "Buy a plot of land" (version 14) and is "Own 10 fields" since. */
const OLD_LAND_GOAL = 'buy-land';
const LAND_GOAL_NOW = 'own-10-fields';

/** The map and starting land of saves up to version 7, written out because the constants have moved on since. */
const OLD_MAP = { width: 32, height: 24 } as const;
const OLD_START = { x: 11, y: 8, w: 10, h: 8 } as const;

/**
 * Moves a version-7 farm into the middle of today's bigger map: every saved tile coordinate (objects, owned land,
 * slices such as the farmers' jobs and routes) shifts by the offset between the old and new starting land, so the
 * farm keeps its shape. The farm also gets the whole new starting land, and any layout block it partly owns becomes
 * its own. (Saves back then owned land tile by tile: a row-major grid, 1 = owned. Version 10 lays out the map around
 * it; version 15 opens the whole map.)
 */
export function growMap(state: Record<string, unknown>): Record<string, unknown> {
  const dx = START_LAND.x - OLD_START.x;
  const dy = START_LAND.y - OLD_START.y;
  const owned = new Array<number>(MAP_WIDTH * MAP_HEIGHT).fill(0);
  const own = (r: Rect) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) owned[y * MAP_WIDTH + x] = 1;
  };
  own(START_LAND);
  const old = isPlainObject(state.land) ? state.land : {};
  const valid =
    old.width === OLD_MAP.width && old.height === OLD_MAP.height && Array.isArray(old.owned) && old.owned.length === OLD_MAP.width * OLD_MAP.height;
  if (valid) {
    (old.owned as unknown[]).forEach((t, i) => {
      if (t === 1) own({ x: (i % OLD_MAP.width) + dx, y: Math.floor(i / OLD_MAP.width) + dy, w: 1, h: 1 });
    });
  } else {
    // A missing or broken grid loaded as a new game's land back then.
    own({ ...OLD_START, x: OLD_START.x + dx, y: OLD_START.y + dy });
  }
  for (const b of MAP_BLOCKS) {
    let some = false;
    let all = true;
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        if (owned[y * MAP_WIDTH + x] === 1) some = true;
        else all = false;
      }
    }
    if (some && !all) own(b);
  }
  const land = { width: MAP_WIDTH, height: MAP_HEIGHT, owned };
  const objects = Array.isArray(state.objects)
    ? state.objects.map((o: unknown) =>
        isPlainObject(o) && typeof o.x === 'number' && typeof o.y === 'number' ? { ...o, x: o.x + dx, y: o.y + dy } : o,
      )
    : state.objects;
  const ext = isPlainObject(state.ext) ? shiftSlices(state.ext, dx, dy) : state.ext;
  return { ...state, land, objects, ext };
}

export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function serialize(state: GameState, savedAt: number | null = null): string {
  const file: SaveFile = { version: SAVE_VERSION, savedAt, state };
  return JSON.stringify(file);
}

/** Parses a save. Anything unreadable becomes a new game; missing fields get defaults. */
export function deserialize(json: string | null | undefined): GameState {
  return parseSave(json).state;
}

/** Like `deserialize`, but also returns when the save was written. */
export function parseSave(json: string | null | undefined): LoadedSave {
  const fresh = (): LoadedSave => ({ state: createNewGame(), savedAt: null });
  if (!json) return fresh();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return fresh();
  }
  if (!isPlainObject(raw)) return fresh();

  let file: RawSave = raw;
  let version = typeof file.version === 'number' ? file.version : 0;
  const repairFarmhouse = version < FARMHOUSE_REPAIR_BEFORE;
  // A farmhouse saved with a level is the 3×3 one already (one laid out by today's code, then saved as older).
  const growHouse = version < FARMHOUSE_GROWN_IN && !savedWithLevel(file);
  const refundMill = version < MILL_FLOUR_IN;
  while (version < SAVE_VERSION) {
    const migrate = migrations[version];
    if (!migrate) return fresh();
    file = migrate(file);
    version++;
  }
  const savedAt = isNonNegNumber(file.savedAt) ? file.savedAt : null;
  return { state: normalize(file.state, { repairFarmhouse, growHouse, refundMill }), savedAt };
}

/**
 * Builds a valid GameState from untrusted data, falling back to new-game defaults field by field. `repairFarmhouse`:
 * a save from before the farmhouse was built later, which gets one (with paths) if it has none. `growHouse`: a save
 * from before the farmhouse was 3×3, whose 2×2 one grows. `refundMill`: a save from before the Windmill, whose mill
 * may still have feed jobs (`refundMillFeed`).
 */
export function normalize(
  input: unknown,
  { repairFarmhouse = false, growHouse = false, refundMill = false }: { repairFarmhouse?: boolean; growHouse?: boolean; refundMill?: boolean } = {},
): GameState {
  const base = createNewGame();
  if (!isPlainObject(input)) return base;

  const money = isNonNegNumber(input.money) ? input.money : base.money;
  const inventory = normalizeInventory(input.inventory);
  // The map is always the same size and every tile of it is the farm's: nothing to read from the save.
  const land = base.land;
  const clockIn = isPlainObject(input.clock) ? input.clock : {};
  const clock = { elapsed: isNonNegNumber(clockIn.elapsed) ? clockIn.elapsed : 0, speed: 1 };
  const objects = normalizeObjects(input.objects, clock.elapsed);
  const maxId = objects.reduce((m, o) => Math.max(m, Number(o.id.replace(/^o/, '')) || 0), 0);
  const nextObjectId = Math.max(isNonNegNumber(input.nextObjectId) ? Math.floor(input.nextObjectId) : 1, maxId + 1);
  const ext = isPlainObject(input.ext) ? { ...input.ext } : {};
  applySliceDefaults(ext);

  const state: GameState = { money, inventory, land, objects, nextObjectId, clock, ext };
  // A 2×2 farmhouse from before levels grows into the 3×3 one (before anything else is laid round it).
  if (growHouse) growFarmhouse(state);
  // Farms from before farmhouses get one, with paths to what they have built. Newer farms build theirs later.
  if (repairFarmhouse) ensureFarmhouse(state);
  // Farms from before the main road get one (from their seed, round what they have built).
  ensureMainRoad(state);
  // The mill's feed jobs from before it ground flour go back into store.
  if (refundMill) refundMillFeed(state);
  return state;
}

function isNonNegNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function normalizeInventory(v: unknown): Inventory {
  const inv: Inventory = {};
  if (!isPlainObject(v)) return inv;
  for (const [id, n] of Object.entries(v)) {
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) inv[id] = n;
  }
  return inv;
}

function normalizeObjects(v: unknown, now: number): PlacedObject[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: PlacedObject[] = [];
  for (const o of v) {
    if (!isPlainObject(o)) continue;
    const { id, type, x, y } = o;
    if (typeof id !== 'string' || typeof type !== 'string' || seen.has(id)) continue;
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    seen.add(id);
    const defaults = getBuildable(type)?.initialState?.({ x: x as number, y: y as number, now }) ?? {};
    const state = isPlainObject(o.state) ? { ...defaults, ...o.state } : defaults;
    const obj: PlacedObject = { id, type, x: x as number, y: y as number, state };
    const site = o.site;
    if (isPlainObject(site) && isNonNegNumber(site.workMs) && site.workMs > 0 && isNonNegNumber(site.paid)) {
      obj.site = { workMs: site.workMs, paid: site.paid };
    }
    out.push(obj);
  }
  return out;
}

export function saveToStorage(storage: SaveStorage, state: GameState, savedAt = Date.now()): boolean {
  try {
    storage.setItem(SAVE_KEY, serialize(state, savedAt));
    return true;
  } catch {
    // Quota exceeded or storage disabled (private mode): keep playing without saving.
    return false;
  }
}

export function loadFromStorage(storage: SaveStorage): GameState {
  return loadSave(storage).state;
}

/** Loads the save and when it was written. Never throws: a broken or missing save is a new game. */
export function loadSave(storage: SaveStorage): LoadedSave {
  try {
    return parseSave(storage.getItem(SAVE_KEY));
  } catch {
    return { state: createNewGame(), savedAt: null };
  }
}

export function clearStorage(storage: SaveStorage): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}
