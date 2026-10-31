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
  /** A resource building finished a cycle: `qty` of a material made (stored, or waiting for room in the building). */
  produced: { item: ItemId; qty: number };
  /** Items (building materials) were bought at the Market. */
  bought: { item: ItemId; qty: number; spent: number };
  /** Items were sold at the Market. */
  sold: { item: ItemId; qty: number; earned: number };
  /** Money came in through the shared income path (`game.earnIncome`); it also gives XP. */
  income: { amount: number };
  /** The player built something (starting objects of a new game do not count). For a construction site: when it is placed. */
  placed: { type: string };
  /** A building (a granary or storehouse) was upgraded to `level`. */
  upgraded: { type: string; level: number };
  /** A farmer finished building a construction site. */
  built: { type: string };
  /** The player bought a parcel of land. */
  landBought: { parcel: string; price: number };
  /** A field was ploughed. */
  ploughed: Record<string, never>;
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
  /** A farmer was put to work (building, ploughing, planting, harvesting, feeding, collecting, starting a batch, cutting wood, ...). */
  workStarted: { kind: string };
  /** A family moved into a free home, bringing a farmer; `families` is the new total. */
  familyArrived: { families: number };
  /** A family left the farm (approval stayed too low); their farmer's workplace (if any) is free. */
  familyLeft: { families: number; workplace: string | null };
  /** A game day was settled: the families ate, burned firewood and took cloth; `approval` is the new approval. */
  familiesSettled: { approval: number };
}
