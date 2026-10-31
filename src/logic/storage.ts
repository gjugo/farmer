import { getBuildable } from '../data/buildables';
import { isMaterial, type MaterialCost } from '../data/materials';
import {
  FARMHOUSE_STORE,
  isStorageType,
  MAX_STORAGE_LEVEL,
  POOL_BUILDING,
  STORAGE,
  STORAGE_POOLS,
  type StorageLevel,
  type StoragePool,
} from '../data/storage';
import { getSlice, registerStateSlice } from './slices';
import type { Game } from './game';
import type { GameState, ItemId, PlacedObject } from './types';

/**
 * Storage rules: how much each pool holds and how much of it is used. Every way items come into the inventory
 * goes through `Game.addItem`, which only takes what `spaceFor` allows, so the rule lives here and nowhere else.
 * Old saves may hold more than fits: they keep it, but nothing new goes into an over-full pool.
 */

/** Per-object state of a granary or storehouse. */
export type StorageState = {
  level: number;
};

export interface PoolInfo {
  used: number;
  capacity: number;
}

export type StorageInfo = Record<StoragePool, PoolInfo>;

/** Which pool an item is stored in. */
export function poolOf(itemId: ItemId): StoragePool {
  return isMaterial(itemId) ? 'materials' : 'goods';
}

/** The building's level, repaired if a save holds something odd. */
export function levelOf(obj: PlacedObject): number {
  const level = obj.state.level;
  return typeof level === 'number' && Number.isInteger(level) ? Math.max(1, Math.min(MAX_STORAGE_LEVEL, level)) : 1;
}

/** Room `obj` adds to its pool (0 for anything that is not a storage building). */
export function capacityOfObject(obj: PlacedObject): number {
  return isStorageType(obj.type) ? STORAGE[obj.type].levels[levelOf(obj) - 1].capacity : 0;
}

/** A pool's room: the farmhouse store plus every storage building of that pool, optionally leaving one out. */
export function capacity(state: GameState, pool: StoragePool, without?: string): number {
  let total = FARMHOUSE_STORE[pool];
  for (const o of state.objects) if (o.id !== without && isStorageType(o.type) && STORAGE[o.type].pool === pool) total += capacityOfObject(o);
  return total;
}

/** Items held in a pool. */
export function used(state: GameState, pool: StoragePool): number {
  let total = 0;
  for (const [id, n] of Object.entries(state.inventory)) if (poolOf(id) === pool) total += n;
  return total;
}

/** How many more of `itemId` fit now; 0 when the pool is full (or over-full, from an old save). */
export function spaceFor(state: GameState, itemId: ItemId): number {
  const pool = poolOf(itemId);
  return Math.max(0, capacity(state, pool) - used(state, pool));
}

/** Both pools' use, e.g. for `window.farm.storage`. */
export function storageInfo(state: GameState): StorageInfo {
  return Object.fromEntries(STORAGE_POOLS.map((p) => [p, { used: used(state, p), capacity: capacity(state, p) }])) as StorageInfo;
}

/** Share of a pool used at which the HUD warns. */
export const STORAGE_WARN_AT = 0.9;

export type PoolStatus = 'ok' | 'warn' | 'full';

export function poolStatus(info: PoolInfo): PoolStatus {
  if (info.used >= info.capacity) return 'full';
  return info.used >= info.capacity * STORAGE_WARN_AT ? 'warn' : 'ok';
}

/** Why something can't come in, e.g. "The granary is full: build or upgrade a granary, or sell something". */
export function fullMessage(pool: StoragePool): string {
  return pool === 'goods'
    ? 'The granary is full: build or upgrade a granary, or sell something'
    : 'The storehouse is full: build or upgrade a storehouse, or use or sell some materials';
}

/** Name of what a pool holds, singular or plural: "good"/"goods", "material"/"materials". */
export function poolNoun(pool: StoragePool, n: number): string {
  const word = pool === 'goods' ? 'good' : 'material';
  return n === 1 ? word : `${word}s`;
}

// Upgrades ---------------------------------------------------------------------------

/** The next level and what it costs, or null at the top level (or for non-storage objects). */
export function nextLevel(obj: PlacedObject): (StorageLevel & { level: number; upgrade: { cost: number; materials: MaterialCost } }) | null {
  if (!isStorageType(obj.type)) return null;
  const level = levelOf(obj);
  const next = STORAGE[obj.type].levels[level];
  return next?.upgrade ? { ...next, level: level + 1, upgrade: next.upgrade } : null;
}

export type UpgradeResult = { ok: true; level: number } | { ok: false; reason: 'not-storage' | 'max' | 'money' | 'materials' };

/** Checks without changing anything; `upgrade` gives the same answer. */
export function checkUpgrade(game: Game, obj: PlacedObject): UpgradeResult {
  if (!isStorageType(obj.type)) return { ok: false, reason: 'not-storage' };
  const next = nextLevel(obj);
  if (!next) return { ok: false, reason: 'max' };
  if (!game.canAfford(next.upgrade.cost)) return { ok: false, reason: 'money' };
  if (game.missingMaterials(next.upgrade.materials).length) return { ok: false, reason: 'materials' };
  return { ok: true, level: next.level };
}

/** Charges the next level's money and materials and raises the level (and the pool's room). Nothing changes when it fails. */
export function upgrade(game: Game, obj: PlacedObject): UpgradeResult {
  const check = checkUpgrade(game, obj);
  if (!check.ok) return check;
  const next = nextLevel(obj)!;
  game.spend(next.upgrade.cost);
  for (const [id, qty] of Object.entries(next.upgrade.materials)) if (qty) game.removeItem(id, qty);
  obj.state.level = next.level;
  game.touch(obj);
  game.activity.emit('upgraded', { type: obj.type, level: next.level });
  return check;
}

// Demolishing -------------------------------------------------------------------------

/** How many items would no longer fit if `obj` were removed (0 when it is not a storage building or all fits). */
export function excessWithout(state: GameState, obj: PlacedObject): number {
  if (!isStorageType(obj.type)) return 0;
  const pool = STORAGE[obj.type].pool;
  return Math.max(0, used(state, pool) - capacity(state, pool, obj.id));
}

/** "Sell or use 40 goods first", for a storage building that can't be demolished. */
export function demolishBlockedMessage(obj: PlacedObject, excess: number): string {
  const def = isStorageType(obj.type) ? STORAGE[obj.type] : undefined;
  const pool = def?.pool ?? 'goods';
  const name = def?.name.toLowerCase() ?? getBuildable(obj.type)?.name.toLowerCase() ?? obj.type;
  return `The ${name} can't go: its stock wouldn't fit anywhere else. Sell or use ${excess} ${poolNoun(pool, excess)} first`;
}

// The one-time notice for saves from before storage -----------------------------------

export interface StorageNoticeState {
  /** Set by the save migration for farms from before storage; cleared once the player has been told. */
  pendingNotice: boolean;
}

export const STORAGE_SLICE = 'storage';

registerStateSlice<StorageNoticeState>(STORAGE_SLICE, () => ({ pendingNotice: false }));

/** Takes the pending notice for an old save (true once, then false). */
export function takeStorageNotice(state: GameState): boolean {
  const s = getSlice<StorageNoticeState>(state, STORAGE_SLICE);
  if (s.pendingNotice !== true) return false;
  s.pendingNotice = false;
  return true;
}

/** Text of the notice: build a granary, and what is over capacity. */
export function storageNoticeMessage(state: GameState): string {
  const info = storageInfo(state);
  const over = STORAGE_POOLS.filter((p) => info[p].used > info[p].capacity);
  const base = `Your farm now needs storage: build a 🌾 ${STORAGE[POOL_BUILDING.goods].name} for goods and a ${STORAGE[POOL_BUILDING.materials].name} for building materials.`;
  if (!over.length) return base;
  return `${base} You keep everything you hold, but nothing new comes in while ${over.map((p) => `${p} (${info[p].used}/${info[p].capacity})`).join(' and ')} ${over.length > 1 ? 'are' : 'is'} over capacity.`;
}
