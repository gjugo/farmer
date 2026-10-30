import { getBuildable } from '../data/buildables';
import { FIELD } from '../data/crops';
import { PLOUGH_SEASONS } from '../data/seasons';
import { initialProgression, PROGRESSION } from './progression';
import { seasonAt } from './seasons';
import { migrateOrdersSlice } from './orders';
import { ensureFarmhouse } from './roads';
import { applySliceDefaults, isPlainObject } from './slices';
import { createNewGame } from './state';
import type { GameState, Inventory, LandState, PlacedObject } from './types';
import { requiredLevel, xpForLevel } from './unlocks';

export const SAVE_KEY = 'farmer.save';

/**
 * Bump when the save shape changes in a way defaults cannot cover (renames,
 * restructuring) and add a migration below. Purely additive fields need no bump:
 * `normalize` fills anything missing with defaults.
 */
export const SAVE_VERSION = 5;

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
};

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
    out.push({ id, type, x: x as number, y: y as number, state });
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
