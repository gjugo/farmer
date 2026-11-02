import type { HazardNote } from './hazards';
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
  /** A house garden yielded: `qty` of a food picked (stored, or waiting in the garden for room). */
  gathered: { item: ItemId; qty: number };
  /** An oxcart unloaded `qty` of `item` at a store (`src/logic/haul.ts`). */
  hauled: { item: ItemId; qty: number };
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
  /** Manure was spread on a field, bringing it to `fertility` points. */
  fertilised: { fertility: number };
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
  /** Goods, materials or an animal traded with a travelling trader: `kind` is what the farm did (bought or sold). */
  traded: { kind: 'buy' | 'sell'; what: string; qty: number; money: number };
  /** A finished goal was claimed. */
  goalClaimed: { id: string };
  /** A farmer was put to work (building, ploughing, planting, harvesting, feeding, collecting, starting a batch, cutting wood, ...). */
  workStarted: { kind: string };
  /** Farmer `farmer` took tools from the store on the way to a job (`src/logic/tools.ts`). */
  toolTaken: { farmer: number };
  /** Farmer `farmer`'s tools wore out and broke as their job ended; `inStore` tools are left in the store. */
  toolBroke: { farmer: number; inStore: number };
  /** A family moved into a free home, bringing a farmer; `families` is the new total. */
  familyArrived: { families: number };
  /** A family left the farm (approval stayed too low); their farmer's workplace (if any) is free. */
  familyLeft: { families: number; workplace: string | null };
  /** A game day was settled: the families ate, burned firewood and took cloth; `approval` is the new approval. */
  familiesSettled: { approval: number };
  /** A hazard was announced, began, ended, hit the farm or was kept off by a defence (see `src/logic/hazards.ts`). */
  hazard: HazardNote;
}
