import { getBuildable } from '../data/buildables';
import { initialProgression, PROGRESSION } from './progression';
import { migrateOrdersSlice } from './orders';
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
export const SAVE_VERSION = 3;

export interface SaveFile {
  version: number;
  savedAt: number;
  state: GameState;
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
  // Farm levels: start at the lowest level that unlocks everything already on the farm.
  2: (raw) => {
    const state = isPlainObject(raw.state) ? raw.state : {};
    const ext = isPlainObject(state.ext) ? state.ext : {};
    const xp = xpForLevel(requiredLevel(state.objects));
    return { ...raw, version: 3, state: { ...state, ext: { ...ext, [PROGRESSION]: initialProgression(xp) } } };
  },
};

export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function serialize(state: GameState, savedAt = 0): string {
  const file: SaveFile = { version: SAVE_VERSION, savedAt, state };
  return JSON.stringify(file);
}

/** Parses a save. Anything unreadable becomes a new game; missing fields get defaults. */
export function deserialize(json: string | null | undefined): GameState {
  if (!json) return createNewGame();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return createNewGame();
  }
  if (!isPlainObject(raw)) return createNewGame();

  let file: RawSave = raw;
  let version = typeof file.version === 'number' ? file.version : 0;
  while (version < SAVE_VERSION) {
    const migrate = migrations[version];
    if (!migrate) return createNewGame();
    file = migrate(file);
    version++;
  }
  return normalize(file.state);
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

  return { money, inventory, land, objects, nextObjectId, clock, ext };
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
  try {
    return deserialize(storage.getItem(SAVE_KEY));
  } catch {
    return createNewGame();
  }
}

export function clearStorage(storage: SaveStorage): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}
