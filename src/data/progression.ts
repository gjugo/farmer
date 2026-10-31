import type { AnimalKind } from './animals';
import type { KnownItemId } from './items';

/**
 * Total XP needed to reach each level: `LEVEL_XP[n - 1]` is where level n starts.
 * The farm earns 1 XP per $1 of sales, plus goal rewards. Tuned so a new player at ×1
 * reaches level 2 in 10–15 minutes and level 5 in about 2–3 hours
 * (see `src/logic/balance.test.ts`).
 */
export const LEVEL_XP: readonly number[] = [0, 150, 900, 2600, 6000, 10_000, 15_000, 21_000, 28_000, 36_000];

export const MAX_LEVEL = LEVEL_XP.length;

/** Cash paid on reaching a level: this × the new level. */
export const LEVEL_BONUS = 50;

/** Goals shown at once. */
export const ACTIVE_GOALS = 3;

export interface GoalReward {
  money: number;
  xp: number;
}

/**
 * What a goal asks for. Count goals count from when the goal became active;
 * state goals look at the farm as it is.
 */
export type GoalTask =
  // Count goals
  | { kind: 'harvest'; item: KnownItemId; count: number }
  | { kind: 'collect'; item: KnownItemId; count: number }
  | { kind: 'make'; item: KnownItemId; count: number }
  /** Make `count` of a material in resource buildings (a woodcutter's lodge, quarry or mine). */
  | { kind: 'produce'; item: KnownItemId; count: number }
  /** Sell `count` items (of `item`, or of anything). */
  | { kind: 'sell'; item?: KnownItemId; count: number }
  /** Buy `count` of `item` at the Market. */
  | { kind: 'buy'; item: KnownItemId; count: number }
  /** Earn $`count` from sales. */
  | { kind: 'earn'; count: number }
  /** Build `count` buildables of `type`. */
  | { kind: 'build'; type: string; count: number }
  /** Upgrade buildables of `type` `count` times. */
  | { kind: 'upgrade'; type: string; count: number }
  /** Spread manure on fields `count` times. */
  | { kind: 'fertilise'; count: number }
  // State goals
  | { kind: 'own-buildings'; type: string; count: number }
  | { kind: 'own-animals'; animal?: AnimalKind; count: number }
  /** Own `count` parcels besides the starting land. */
  | { kind: 'own-parcels'; count: number }
  | { kind: 'reach-level'; count: number };

export type GoalDef = GoalTask & {
  id: string;
  title: string;
  icon: string;
  reward: GoalReward;
};

/**
 * Goals in the order they are offered. The first three teach the core loop;
 * later ones walk through animals, materials, processing and land in unlock order.
 */
export const GOALS: readonly GoalDef[] = [
  { id: 'first-field', title: 'Build a field', icon: '🟫', kind: 'build', type: 'field', count: 1, reward: { money: 30, xp: 10 } },
  { id: 'harvest-wheat', title: 'Harvest 20 wheat', icon: '🌾', kind: 'harvest', item: 'wheat', count: 20, reward: { money: 20, xp: 10 } },
  { id: 'build-granary', title: 'Build a granary', icon: '🌾', kind: 'build', type: 'granary', count: 1, reward: { money: 50, xp: 15 } },
  { id: 'sell-wheat', title: 'Sell 20 wheat at the Market', icon: '🏪', kind: 'sell', item: 'wheat', count: 20, reward: { money: 30, xp: 15 } },
  { id: 'buy-wood', title: 'Buy 10 wood at the Market', icon: '🪵', kind: 'buy', item: 'wood', count: 10, reward: { money: 40, xp: 15 } },
  { id: 'build-coop', title: 'Build a chicken coop', icon: '🐔', kind: 'build', type: 'coop', count: 1, reward: { money: 50, xp: 15 } },
  { id: 'own-chickens', title: 'Own 3 chickens', icon: '🐔', kind: 'own-animals', animal: 'chicken', count: 3, reward: { money: 60, xp: 20 } },
  { id: 'collect-eggs', title: 'Collect 6 eggs', icon: '🥚', kind: 'collect', item: 'egg', count: 6, reward: { money: 60, xp: 25 } },
  { id: 'harvest-carrots', title: 'Harvest 30 carrots', icon: '🥕', kind: 'harvest', item: 'carrot', count: 30, reward: { money: 80, xp: 30 } },
  { id: 'bake-bread', title: 'Bake 3 bread', icon: '🍞', kind: 'make', item: 'bread', count: 3, reward: { money: 100, xp: 40 } },
  { id: 'own-fields', title: 'Own 6 fields', icon: '🟫', kind: 'own-buildings', type: 'field', count: 6, reward: { money: 100, xp: 40 } },
  { id: 'upgrade-granary', title: 'Upgrade a granary', icon: '🌾', kind: 'upgrade', type: 'granary', count: 1, reward: { money: 100, xp: 40 } },
  { id: 'reach-3', title: 'Reach level 3', icon: '⭐', kind: 'reach-level', count: 3, reward: { money: 100, xp: 50 } },
  { id: 'own-cows', title: 'Own 2 cows', icon: '🐄', kind: 'own-animals', animal: 'cow', count: 2, reward: { money: 120, xp: 50 } },
  { id: 'spread-manure', title: 'Spread manure on a field', icon: '💩', kind: 'fertilise', count: 1, reward: { money: 120, xp: 50 } },
  { id: 'make-cheese', title: 'Make 3 cheese', icon: '🧀', kind: 'make', item: 'cheese', count: 3, reward: { money: 150, xp: 60 } },
  { id: 'earn-1000', title: 'Earn $1,000 from sales', icon: '💰', kind: 'earn', count: 1000, reward: { money: 150, xp: 75 } },
  { id: 'buy-land', title: 'Buy a plot of land', icon: '🪧', kind: 'own-parcels', count: 1, reward: { money: 200, xp: 75 } },
  { id: 'build-woodcutter', title: "Build a woodcutter's lodge", icon: '🪓', kind: 'own-buildings', type: 'woodcutter', count: 1, reward: { money: 50, xp: 20 } },
  { id: 'produce-wood', title: 'Produce 20 wood', icon: '🪵', kind: 'produce', item: 'wood', count: 20, reward: { money: 60, xp: 25 } },
  { id: 'build-quarry', title: 'Build a quarry', icon: '⛏️', kind: 'own-buildings', type: 'quarry', count: 1, reward: { money: 80, xp: 30 } },
  { id: 'make-feed', title: 'Mill 12 feed', icon: '🌰', kind: 'make', item: 'feed', count: 12, reward: { money: 150, xp: 75 } },
  { id: 'mine-iron', title: 'Mine 5 iron', icon: '🔩', kind: 'produce', item: 'iron', count: 5, reward: { money: 200, xp: 100 } },
  { id: 'own-sheep', title: 'Own 2 sheep', icon: '🐑', kind: 'own-animals', animal: 'sheep', count: 2, reward: { money: 200, xp: 100 } },
  { id: 'weave-cloth', title: 'Weave 2 cloth', icon: '🧵', kind: 'make', item: 'cloth', count: 2, reward: { money: 250, xp: 120 } },
];

export function getGoal(id: string): GoalDef | undefined {
  return GOALS.find((g) => g.id === id);
}
