import type { ItemId } from './types';

/**
 * What the player did, reported by feature logic through `game.activity`.
 * Goals count these instead of watching the whole state.
 */
export interface ActivityEvents {
  /** A field was harvested. */
  harvested: { item: ItemId; qty: number };
  /** Animal products were collected from a pen. */
  collected: { item: ItemId; qty: number };
  /** Output of a processing building was collected. */
  made: { item: ItemId; qty: number };
  /** Items were sold at the Market. */
  sold: { item: ItemId; qty: number; earned: number };
  /** Money came in through the shared income path (`game.earnIncome`); it also gives XP. */
  income: { amount: number };
  /** The player built something (starting objects of a new game do not count). */
  placed: { type: string };
  /** The player bought a parcel of land. */
  landBought: { parcel: string; price: number };
}
