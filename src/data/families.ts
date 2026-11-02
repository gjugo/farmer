import { registerBuildable } from './buildables';
import type { KnownItemId } from './items';
import type { MaterialCost } from './materials';

/**
 * Families: every farmer is a family living in a home. The starting families live in the camp's tent; each cottage
 * houses one more (two once upgraded to level 2), and the farmhouse one once it is built.
 * Families eat from the granary, burn firewood in winter, want clothes once the loom is unlocked and enjoy ale once
 * the brewery is; how well the farm meets those needs is their approval, and approval decides whether new families
 * move in or old ones leave.
 * Rules live in `src/logic/families.ts`; the look and panel in `src/features/families`.
 */

export const COTTAGE = 'cottage';

/** Room besides the cottages: the farmhouse houses a family once it is built. */
export const FARMHOUSE_HOMES = 1;

/** What families eat, in the order they reach for it. Never feed, wool, cloth or the brewery's malt and ale. */
export const FOODS: readonly KnownItemId[] = ['wheat', 'carrot', 'corn', 'potato', 'cabbage', 'pumpkin', 'apple', 'egg', 'milk', 'bread', 'cheese', 'butter'];

/** Food each family eats a day. */
export const MEAL_PER_FAMILY = 2;

/** Wood each family burns at its own hearth on a winter day (a full level 2 cottage burns two). */
export const FIREWOOD_PER_HOME = 1;

/**
 * Cloth each family takes at the start of winter (once the loom is unlocked); it keeps them clothed that year. A family
 * takes `CLOTHES_PER_FAMILY` clothes instead while the tailor's clothes are in stock.
 */
export const CLOTH_PER_FAMILY = 1;
export const CLOTHES_PER_FAMILY = 1;

/** Families drink ale (once the brewery is unlocked) each day while there is any: one ale for this many families. */
export const FAMILIES_PER_ALE = 2;

/** A new family moves in when approval is at least this (percent). */
export const ARRIVE_APPROVAL = 50;

/** A family leaves when approval stays below this (percent) for a whole day. */
export const LEAVE_APPROVAL = 25;

/** The first family arrives this share of a day after a home becomes free. */
export const ARRIVAL_DELAY_DAYS = 0.5;

/** At most one family arrives per this many days. */
export const ARRIVAL_GAP_DAYS = 1;

/**
 * Approval points (percent). A fed farm with two or more foods sits above `ARRIVE_APPROVAL`; starving or freezing
 * goes below `LEAVE_APPROVAL` whatever else is going well.
 */
export const APPROVAL = {
  base: 50,
  /** Per food kind eaten beyond the first. */
  perExtraFood: 5,
  maxVariety: 20,
  /** Every family fed, but less than a full meal each. */
  shortMeal: -20,
  noFood: -50,
  /** When every family is clothed in cloth (a share of it when some are). */
  clothed: 10,
  /** The same in the tailor's clothes. */
  dressed: 15,
  /** When every family had ale that day (a share of it when some did). */
  ale: 10,
  /** Winter days: every occupied home had firewood, or some went cold (all of them cold: the full `freezing`). */
  firewood: 10,
  freezing: -60,
} as const;

export interface CottageLevel {
  /** Families this cottage houses at this level. */
  room: number;
  /**
   * What going up to this level asks (missing for level 1, which is the build cost), as Manor Lords' burgages do: the
   * farm's level, a winter's firewood in store (one per family per winter day, counted after the upgrade's wood),
   * `foods` kinds of food eaten on the last settled day with nobody short, and the cost.
   */
  upgrade?: { cost: number; materials: MaterialCost; farmLevel: number; foods: number };
}

/** The cottage: a small home for one more family. Costs about what hiring a farmer for cash used to ($150). */
export const COTTAGE_DEF = {
  cost: 80,
  materials: { wood: 8 },
  footprint: { w: 2, h: 2 },
  /** Level 1 first; the highest level is the last. A cottage never goes down a level. */
  levels: [{ room: 1 }, { room: 2, upgrade: { cost: 120, materials: { wood: 12, stone: 8 }, farmLevel: 3, foods: 2 } }] as readonly CottageLevel[],
} as const;

export const MAX_COTTAGE_LEVEL = COTTAGE_DEF.levels.length;

registerBuildable({
  id: COTTAGE,
  name: 'Cottage',
  cost: COTTAGE_DEF.cost,
  materials: COTTAGE_DEF.materials,
  footprint: COTTAGE_DEF.footprint,
  texture: COTTAGE,
  category: 'homes',
  description: 'A home for one more family: a new farmer moves in when your families are happy.',
  icon: '🛖',
  unlockLevel: 1,
  initialState: () => ({ level: 1 }),
});
