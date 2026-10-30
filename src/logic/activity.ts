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
  /** A crop was planted in a field. */
  planted: { crop: string };
  /** An animal was bought into a pen. */
  animalBought: { kind: string };
  /** Hungry animals in a pen were fed. */
  fed: { count: number };
  /** A processing job was queued. */
  jobStarted: { recipe: string };
  /** Processing jobs finished while the farm was running (offline catch-up does not report these). */
  jobsFinished: { count: number };
  /** A customer order was fulfilled. */
  orderFulfilled: { reward: number };
  /** A finished goal was claimed. */
  goalClaimed: { id: string };
  /** A farmer was put to work (building, planting, harvesting, feeding). */
  workStarted: { kind: string };
  /** A farmer was hired; `farmers` is the new total. */
  hired: { farmers: number };
}
