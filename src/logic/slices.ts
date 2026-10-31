import type { GameState } from './types';

/**
 * Feature-owned global state lives in `GameState.ext[key]`. Registering a slice
 * gives new games (and old saves without it) the default value.
 */
const slices = new Map<string, () => unknown>();

/**
 * Moves every tile coordinate a saved slice holds by (dx, dy) and returns the moved slice. Save migrations
 * that move the farm on the map (e.g. when the map grew) call it on raw, untrusted saved data.
 */
export type SliceShift = (saved: unknown, dx: number, dy: number) => unknown;
const shifts = new Map<string, SliceShift>();

/** Registers a slice's defaults and, when the slice holds tile coordinates, how to move them. */
export function registerStateSlice<T>(key: string, defaults: () => T, shift?: SliceShift): void {
  if (slices.has(key)) throw new Error(`State slice "${key}" is already registered`);
  slices.set(key, defaults);
  if (shift) shifts.set(key, shift);
}

/** `ext` with every slice's tile coordinates moved by (dx, dy). Slices without coordinates stay as they are. */
export function shiftSlices(ext: Record<string, unknown>, dx: number, dy: number): Record<string, unknown> {
  const out = { ...ext };
  for (const [key, shift] of shifts) if (out[key] !== undefined) out[key] = shift(out[key], dx, dy);
  return out;
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
