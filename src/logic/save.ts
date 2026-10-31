import { getBuildable } from '../data/buildables';
import { FIELD } from '../data/crops';
import { PLOUGH_SEASONS } from '../data/seasons';
import { MAP_HEIGHT, MAP_WIDTH, START_LAND } from './constants';
import { createLand, isOwned, setOwned, setOwnedRect, type Rect } from './land';
import { FARM_PARCELS, isParcelOwned } from './parcels';
import { initialProgression, PROGRESSION } from './progression';
import { seasonAt } from './seasons';
import { STORAGE_SLICE } from './storage';
import { migrateOrdersSlice } from './orders';
import { ensureFarmhouse } from './roads';
import { applySliceDefaults, isPlainObject, shiftSlices } from './slices';
import { createNewGame } from './state';
import type { GameState, Inventory, LandState, PlacedObject } from './types';
import { requiredLevel, xpForLevel } from './unlocks';
// The workers slice holds tile coordinates (jobs and their routes); the map migration must know how to move them.
import './workers';

export const SAVE_KEY = 'farmer.save';

/**
 * Bump when the save shape changes in a way defaults cannot cover (renames,
 * restructuring) and add a migration below. Purely additive fields need no bump:
 * `normalize` fills anything missing with defaults.
 */
export const SAVE_VERSION = 10;

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
  // Families: farmers live in homes and cash hiring is gone. The farm keeps every farmer it has, housed or not (no
  // family arrives while there are more farmers than homes; nobody leaves for lack of one), and its families start
  // counting days from the first load. Two goals were inserted ("build-cottage", "house-families"); farms past them skip them.
  9: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const p = ext[PROGRESSION];
    if (!isPlainObject(p) || typeof p.nextGoal !== 'number') return { ...raw, version: 10 };
    let nextGoal = p.nextGoal;
    // "build-cottage" and "house-families" in version 10.
    for (const at of [5, 14]) if (nextGoal > at) nextGoal++;
    return { ...raw, version: 10, state: { ...state, ext: { ...ext, [PROGRESSION]: { ...p, nextGoal } } } };
  },
};

/** The map and starting land of saves up to version 7, written out because the constants have moved on since. */
const OLD_MAP = { width: 32, height: 24 } as const;
const OLD_START = { x: 11, y: 8, w: 10, h: 8 } as const;

/**
 * Moves a version-7 farm into the middle of today's bigger map: every saved tile coordinate (objects, owned land,
 * slices such as the farmers' jobs and routes) shifts by the offset between the old and new starting land, so the
 * farm keeps its shape. The farm also gets the whole new starting land, and any parcel it partly owns becomes its own.
 */
export function growMap(state: Record<string, unknown>): Record<string, unknown> {
  const dx = START_LAND.x - OLD_START.x;
  const dy = START_LAND.y - OLD_START.y;
  const land = createLand(MAP_WIDTH, MAP_HEIGHT, START_LAND);
  const old = isPlainObject(state.land) ? state.land : {};
  const valid =
    old.width === OLD_MAP.width && old.height === OLD_MAP.height && Array.isArray(old.owned) && old.owned.length === OLD_MAP.width * OLD_MAP.height;
  if (valid) {
    (old.owned as unknown[]).forEach((t, i) => {
      if (t === 1) setOwned(land, (i % OLD_MAP.width) + dx, Math.floor(i / OLD_MAP.width) + dy, true);
    });
  } else {
    // A missing or broken grid loaded as a new game's land back then.
    setOwnedRect(land, { ...OLD_START, x: OLD_START.x + dx, y: OLD_START.y + dy }, true);
  }
  for (const p of FARM_PARCELS) {
    if (!isParcelOwned(land, p) && ownsSomeOf(land, p)) setOwnedRect(land, p, true);
  }
  const objects = Array.isArray(state.objects)
    ? state.objects.map((o: unknown) =>
        isPlainObject(o) && typeof o.x === 'number' && typeof o.y === 'number' ? { ...o, x: o.x + dx, y: o.y + dy } : o,
      )
    : state.objects;
  const ext = isPlainObject(state.ext) ? shiftSlices(state.ext, dx, dy) : state.ext;
  return { ...state, land, objects, ext };
}

function ownsSomeOf(land: LandState, p: Rect): boolean {
  for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (isOwned(land, x, y)) return true;
  return false;
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
  while (version < SAVE_VERSION) {
    const migrate = migrations[version];
    if (!migrate) return fresh();
    file = migrate(file);
    version++;
  }
  const savedAt = isNonNegNumber(file.savedAt) ? file.savedAt : null;
  return { state: normalize(file.state), savedAt };
}

/** Builds a valid GameState from untrusted data, falling back to new-game defaults field by field. */
export function normalize(input: unknown): GameState {
  const base = createNewGame();
  if (!isPlainObject(input)) return base;

  const money = isNonNegNumber(input.money) ? input.money : base.money;
  const inventory = normalizeInventory(input.inventory);
  const land = normalizeLand(input.land, base.land);
  const objects = normalizeObjects(input.objects);
  const maxId = objects.reduce((m, o) => Math.max(m, Number(o.id.replace(/^o/, '')) || 0), 0);
  const nextObjectId = Math.max(isNonNegNumber(input.nextObjectId) ? Math.floor(input.nextObjectId) : 1, maxId + 1);
  const clockIn = isPlainObject(input.clock) ? input.clock : {};
  const clock = { elapsed: isNonNegNumber(clockIn.elapsed) ? clockIn.elapsed : 0, speed: 1 };
  const ext = isPlainObject(input.ext) ? { ...input.ext } : {};
  applySliceDefaults(ext);

  const state: GameState = { money, inventory, land, objects, nextObjectId, clock, ext };
  // Farms from before farmhouses get one, with paths to what they have built.
  ensureFarmhouse(state);
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

function normalizeLand(v: unknown, fallback: LandState): LandState {
  if (!isPlainObject(v)) return fallback;
  const { width, height, owned } = v;
  if (width !== fallback.width || height !== fallback.height) return fallback;
  if (!Array.isArray(owned) || owned.length !== fallback.owned.length) return fallback;
  return { width, height, owned: owned.map((t) => (t === 1 ? 1 : 0)) };
}

function normalizeObjects(v: unknown): PlacedObject[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: PlacedObject[] = [];
  for (const o of v) {
    if (!isPlainObject(o)) continue;
    const { id, type, x, y } = o;
    if (typeof id !== 'string' || typeof type !== 'string' || seen.has(id)) continue;
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    seen.add(id);
    const defaults = getBuildable(type)?.initialState?.() ?? {};
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
