import { registerBuildable } from './buildables';
import type { KnownItemId } from './items';

/**
 * Families: every farmer is a family living in a home. The farmhouse houses the first one, each cottage one more.
 * Families eat from the granary, burn firewood in winter and want clothes once the loom is unlocked; how well the
 * farm meets those needs is their approval, and approval decides whether new families move in or old ones leave.
 * Rules live in `src/logic/families.ts`; the look and panel in `src/features/families`.
 */

export const COTTAGE = 'cottage';

/** Homes besides the cottages: the farmhouse houses the starting family. */
export const FARMHOUSE_HOMES = 1;

/** What families eat, in the order they reach for it. Never feed, wool or cloth. */
export const FOODS: readonly KnownItemId[] = ['wheat', 'carrot', 'corn', 'apple', 'egg', 'milk', 'bread', 'cheese', 'butter'];

/** Food each family eats a day. */
export const MEAL_PER_FAMILY = 2;

/**
 * A new farm's families live on the provisions they brought for this many days: going short then costs no approval,
 * so the first newcomers don't leave before the first harvest is in.
 */
export const PROVISION_DAYS = 2;

/** Wood each occupied home burns on a winter day. */
export const FIREWOOD_PER_HOME = 1;

/** Cloth each family takes at the start of winter (once the loom is unlocked); it keeps them clothed that year. */
export const CLOTH_PER_FAMILY = 1;

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
  /** When every family is clothed (a share of it when some are). */
  clothed: 10,
  /** Winter days: every occupied home had firewood, or some went cold (all of them cold: the full `freezing`). */
  firewood: 10,
  freezing: -60,
} as const;

/** The cottage: a small home for one more family. Costs about what hiring a farmer for cash used to ($150). */
export const COTTAGE_DEF = {
  cost: 80,
  materials: { wood: 8 },
  footprint: { w: 2, h: 2 },
} as const;

registerBuildable({
  id: COTTAGE,
  name: 'Cottage',
  cost: COTTAGE_DEF.cost,
  materials: COTTAGE_DEF.materials,
  footprint: COTTAGE_DEF.footprint,
  texture: COTTAGE,
  category: 'housing',
  description: 'A home for one more family: a new farmer moves in when your families are happy.',
  icon: '🛖',
  unlockLevel: 1,
});
