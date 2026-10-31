import { FARMHOUSE } from '../data/farmhouse';
import { GRANARY_PILES, PILE_STAGES, pileOf, STOREHOUSE_PILES, type PileStage } from '../data/resources';
import { FARMHOUSE_STORE, isStorageType, STORAGE, STORAGE_POOLS, type StoragePool } from '../data/storage';
import { capacityOfObject, poolOf, used } from './storage';
import type { GameState } from './types';

/**
 * Which stock piles each building shows. Stock is one shared pool per kind, so the display splits it: the
 * farmhouse store fills first, then each finished granary (goods) or storehouse (materials) in placement
 * order, up to its room. Purely visual: no rule reads this.
 */

/** The farmhouse's small piles: one for goods, one for materials. */
export const HOUSE_PILES: Readonly<Record<StoragePool, string>> = { goods: 'house_goods', materials: 'house_materials' };

export interface StockShown {
  id: string;
  type: string;
  /** Per pool this building stores: the share of the pool's stock it shows and its room. */
  pools: Partial<Record<StoragePool, { held: number; capacity: number }>>;
  /** The stage (0 none … 4 full) of each pile it draws, in drawing order (back to front). */
  piles: Record<string, PileStage>;
}

/** The stage of a pile filled to `share` (0..1) of its room: full only when it really is. */
export function pileStage(share: number): PileStage {
  if (!(share > 0)) return 0;
  if (share >= 1) return PILE_STAGES as PileStage;
  return Math.min(PILE_STAGES - 1, Math.floor(share * PILE_STAGES) + 1) as PileStage;
}

/** The pool's stock by pile kind. */
function pileTotals(state: GameState, pool: StoragePool, kinds: readonly string[]): Record<string, number> {
  const totals: Record<string, number> = Object.fromEntries(kinds.map((k) => [k, 0]));
  for (const [id, n] of Object.entries(state.inventory)) if (n > 0 && poolOf(id) === pool) totals[pileOf(id)] = (totals[pileOf(id)] ?? 0) + n;
  return totals;
}

/**
 * Every building that stores something (farmhouse, finished granaries and storehouses), in placement order,
 * with its piles. In a building the biggest pile shows how full the building is and the others are scaled to
 * it, so a full granary looks full whatever it holds and a pile only shows when there is some of it.
 */
export function stockDisplay(state: GameState): StockShown[] {
  const shown = new Map<string, StockShown>();
  for (const pool of STORAGE_POOLS) {
    const kinds = pool === 'goods' ? GRANARY_PILES : STOREHOUSE_PILES;
    const totals = pileTotals(state, pool, kinds);
    const biggest = Math.max(0, ...Object.values(totals));
    let left = used(state, pool);
    const take = (room: number) => {
      const held = Math.min(left, room);
      left -= held;
      return held;
    };
    // The farmhouse store fills first (even with no farmhouse on the map, its room is there).
    const houseHeld = take(FARMHOUSE_STORE[pool]);
    const house = state.objects.find((o) => o.type === FARMHOUSE);
    if (house) {
      const entry = shown.get(house.id) ?? { id: house.id, type: house.type, pools: {}, piles: {} };
      entry.pools[pool] = { held: houseHeld, capacity: FARMHOUSE_STORE[pool] };
      entry.piles[HOUSE_PILES[pool]] = pileStage(houseHeld / FARMHOUSE_STORE[pool]);
      shown.set(house.id, entry);
    }
    for (const obj of state.objects) {
      if (obj.site || !isStorageType(obj.type) || STORAGE[obj.type].pool !== pool) continue;
      const room = capacityOfObject(obj);
      const held = take(room);
      const fill = room > 0 ? held / room : 0;
      const piles: Record<string, PileStage> = {};
      for (const kind of kinds) piles[kind] = totals[kind] > 0 ? pileStage((fill * totals[kind]) / biggest) : 0;
      shown.set(obj.id, { id: obj.id, type: obj.type, pools: { [pool]: { held, capacity: room } }, piles });
    }
  }
  // Placement order, whichever pool a building was met in first.
  return state.objects.flatMap((o) => shown.get(o.id) ?? []);
}
