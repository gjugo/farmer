import type { GameState } from './types';

/**
 * Feature-owned global state lives in `GameState.ext[key]`. Registering a slice
 * gives new games (and old saves without it) the default value.
 */
const slices = new Map<string, () => unknown>();

export function registerStateSlice<T>(key: string, defaults: () => T): void {
  if (slices.has(key)) throw new Error(`State slice "${key}" is already registered`);
  slices.set(key, defaults);
}

export function getSlice<T>(state: GameState, key: string): T {
  if (!(key in state.ext)) {
    const defaults = slices.get(key);
    if (!defaults) throw new Error(`Unknown state slice "${key}"`);
    state.ext[key] = defaults();
  }
  return state.ext[key] as T;
}

/** Fills in every registered slice; for plain-object slices, missing fields too. */
export function applySliceDefaults(ext: Record<string, unknown>): void {
  for (const [key, defaults] of slices) {
    const def = defaults();
    const saved = ext[key];
    if (saved === undefined) ext[key] = def;
    else if (isPlainObject(def) && isPlainObject(saved)) ext[key] = { ...def, ...saved };
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
