import type { AnimalKind } from './animals';
import type { KnownItemId } from './items';
import type { Season } from './seasons';

/**
 * Total XP needed to reach each level: `LEVEL_XP[n - 1]` is where level n starts.
 * The farm earns 1 XP per $1 of sales, plus goal rewards. Tuned so a new player at ×1
 * reaches level 2 in 10–15 minutes and level 5 in about 2–3 hours
 * (see `src/logic/balance.test.ts`). Level 5 asks for 5000 (6000 before families, who eat about a fifth of what
 * the farm makes).
 */
export const LEVEL_XP: readonly number[] = [0, 150, 900, 2600, 5000, 10_000, 15_000, 21_000, 28_000, 36_000];

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
  /** Harvest `count` of `item` (only harvests in `season`, when given). */
  | { kind: 'harvest'; item: KnownItemId; count: number; season?: Season }
  | { kind: 'collect'; item: KnownItemId; count: number }
  | { kind: 'make'; item: KnownItemId; count: number }
  /** Make `count` of a material in resource buildings (a woodcutter's lodge, quarry or mine). */
  | { kind: 'produce'; item: KnownItemId; count: number }
  /** Pick `count` of a food in house gardens. */
  | { kind: 'gather'; item: KnownItemId; count: number }
  /** Sell `count` items (of `item`, or of anything). */
  | { kind: 'sell'; item?: KnownItemId; count: number }
  /** Buy `count` of `item` at the Market. */
  | { kind: 'buy'; item: KnownItemId; count: number }
  /** Earn $`count` from sales. */
  | { kind: 'earn'; count: number }
  /** Trades with travelling traders (one per sale or purchase). */
  | { kind: 'trade'; count: number }
  /** Build `count` buildables of `type`. */
  | { kind: 'build'; type: string; count: number }
  /** Upgrade buildables of `type` `count` times. */
  | { kind: 'upgrade'; type: string; count: number }
  /** Spread manure on fields `count` times. */
  | { kind: 'fertilise'; count: number }
  /** Haul `count` goods to the stores by oxcart. */
  | { kind: 'haul'; count: number }
  // State goals
  | { kind: 'own-buildings'; type: string; count: number }
  | { kind: 'own-animals'; animal?: AnimalKind; count: number }
  | { kind: 'reach-level'; count: number }
  /** Have a finished `type` (a home with levels) at level `count` or higher. */
  | { kind: 'building-level'; type: string; count: number }
  /** Have `count` families (farmers) living on the farm. */
  | { kind: 'families'; count: number }
  /** Have `count` coops with a kennel in reach (see `src/logic/hazards.ts`). */
  | { kind: 'protected-coops'; count: number };

export type GoalDef = GoalTask & {
  id: string;
  title: string;
  icon: string;
  reward: GoalReward;
};

/**
 * Goals in the order they are offered. The first three teach the core loop;
 * later ones walk through animals, materials and processing in unlock order.
 */
export const GOALS: readonly GoalDef[] = [
  { id: 'first-field', title: 'Build a field', icon: '🟫', kind: 'build', type: 'field', count: 1, reward: { money: 30, xp: 10 } },
  { id: 'harvest-wheat', title: 'Harvest 20 wheat', icon: '🌾', kind: 'harvest', item: 'wheat', count: 20, reward: { money: 20, xp: 10 } },
  { id: 'build-granary', title: 'Build a granary', icon: '🌾', kind: 'build', type: 'granary', count: 1, reward: { money: 50, xp: 15 } },
  { id: 'sell-wheat', title: 'Sell 20 wheat at the trading post', icon: '🏪', kind: 'sell', item: 'wheat', count: 20, reward: { money: 30, xp: 15 } },
  { id: 'build-trading-post', title: 'Build a trading post', icon: '🏪', kind: 'own-buildings', type: 'trading-post', count: 1, reward: { money: 40, xp: 15 } },
  { id: 'build-cottage', title: 'Build a cottage', icon: '🛖', kind: 'own-buildings', type: 'cottage', count: 1, reward: { money: 40, xp: 15 } },
  { id: 'build-coop', title: 'Build a chicken coop', icon: '🐔', kind: 'own-buildings', type: 'coop', count: 1, reward: { money: 50, xp: 15 } },
  { id: 'own-chickens', title: 'Own 3 chickens', icon: '🐔', kind: 'own-animals', animal: 'chicken', count: 3, reward: { money: 60, xp: 20 } },
  { id: 'collect-eggs', title: 'Collect 6 eggs', icon: '🥚', kind: 'collect', item: 'egg', count: 6, reward: { money: 60, xp: 25 } },
  { id: 'harvest-carrots', title: 'Harvest 30 carrots', icon: '🥕', kind: 'harvest', item: 'carrot', count: 30, reward: { money: 80, xp: 30 } },
  { id: 'bake-bread', title: 'Bake 3 bread', icon: '🍞', kind: 'make', item: 'bread', count: 3, reward: { money: 100, xp: 40 } },
  { id: 'own-fields', title: 'Own 6 fields', icon: '🟫', kind: 'own-buildings', type: 'field', count: 6, reward: { money: 100, xp: 40 } },
  { id: 'upgrade-granary', title: 'Upgrade a granary', icon: '🌾', kind: 'upgrade', type: 'granary', count: 1, reward: { money: 100, xp: 40 } },
  { id: 'reach-3', title: 'Reach level 3', icon: '⭐', kind: 'reach-level', count: 3, reward: { money: 100, xp: 50 } },
  { id: 'house-families', title: 'House 4 families', icon: '👪', kind: 'families', count: 4, reward: { money: 120, xp: 50 } },
  { id: 'own-cows', title: 'Own 2 cows', icon: '🐄', kind: 'own-animals', animal: 'cow', count: 2, reward: { money: 120, xp: 50 } },
  { id: 'spread-manure', title: 'Spread manure on a field', icon: '💩', kind: 'fertilise', count: 1, reward: { money: 120, xp: 50 } },
  { id: 'make-cheese', title: 'Make 3 cheese', icon: '🧀', kind: 'make', item: 'cheese', count: 3, reward: { money: 150, xp: 60 } },
  { id: 'earn-1000', title: 'Earn $1,000 from sales', icon: '💰', kind: 'earn', count: 1000, reward: { money: 150, xp: 75 } },
  { id: 'own-10-fields', title: 'Own 10 fields', icon: '🟫', kind: 'own-buildings', type: 'field', count: 10, reward: { money: 200, xp: 75 } },
  { id: 'build-woodcutter', title: "Build a woodcutter's lodge", icon: '🪓', kind: 'own-buildings', type: 'woodcutter', count: 1, reward: { money: 50, xp: 20 } },
  { id: 'produce-wood', title: 'Produce 20 wood', icon: '🪵', kind: 'produce', item: 'wood', count: 20, reward: { money: 60, xp: 25 } },
  { id: 'build-quarry', title: 'Build a quarry', icon: '⛏️', kind: 'own-buildings', type: 'quarry', count: 1, reward: { money: 80, xp: 30 } },
  { id: 'make-feed', title: 'Make 12 feed', icon: '🌰', kind: 'make', item: 'feed', count: 12, reward: { money: 150, xp: 75 } },
  { id: 'mine-iron', title: 'Mine 5 iron', icon: '🔩', kind: 'produce', item: 'iron', count: 5, reward: { money: 200, xp: 100 } },
  { id: 'own-sheep', title: 'Own 2 sheep', icon: '🐑', kind: 'own-animals', animal: 'sheep', count: 2, reward: { money: 200, xp: 100 } },
  { id: 'weave-cloth', title: 'Weave 2 cloth', icon: '🧵', kind: 'make', item: 'cloth', count: 2, reward: { money: 250, xp: 120 } },
  // Saves keep goals by index: new goals go at the end.
  { id: 'harvest-potatoes', title: 'Harvest 30 potatoes', icon: '🥔', kind: 'harvest', item: 'potato', count: 30, reward: { money: 120, xp: 50 } },
  { id: 'winter-cabbage', title: 'Harvest cabbage in winter', icon: '🥬', kind: 'harvest', item: 'cabbage', season: 'winter', count: 1, reward: { money: 250, xp: 120 } },
  { id: 'grow-pumpkins', title: 'Grow 10 pumpkins', icon: '🎃', kind: 'harvest', item: 'pumpkin', count: 10, reward: { money: 300, xp: 150 } },
  { id: 'trade-trader', title: 'Trade with a travelling trader', icon: '🛒', kind: 'trade', count: 1, reward: { money: 150, xp: 75 } },
  { id: 'build-veg-patch', title: 'Plant a vegetable patch', icon: '🥬', kind: 'own-buildings', type: 'veg-patch', count: 1, reward: { money: 60, xp: 25 } },
  { id: 'gather-apples', title: 'Gather 20 apples', icon: '🍎', kind: 'gather', item: 'apple', count: 20, reward: { money: 150, xp: 75 } },
  { id: 'build-well', title: 'Build a well', icon: '🪣', kind: 'own-buildings', type: 'well', count: 1, reward: { money: 60, xp: 25 } },
  { id: 'guard-coop', title: 'Protect a coop with a kennel', icon: '🐕', kind: 'protected-coops', count: 1, reward: { money: 80, xp: 30 } },
  { id: 'build-oxbarn', title: 'Build an ox barn', icon: '🐂', kind: 'own-buildings', type: 'oxbarn', count: 1, reward: { money: 150, xp: 60 } },
  { id: 'haul-goods', title: 'Haul 100 goods by cart', icon: '🛒', kind: 'haul', count: 100, reward: { money: 250, xp: 120 } },
  { id: 'make-malt', title: 'Malt barley into 10 malt', icon: '🫘', kind: 'make', item: 'malt', count: 10, reward: { money: 300, xp: 150 } },
  { id: 'brew-ale', title: 'Brew 5 ale', icon: '🍺', kind: 'make', item: 'ale', count: 5, reward: { money: 400, xp: 200 } },
  { id: 'sew-clothes', title: 'Sew 3 clothes', icon: '👕', kind: 'make', item: 'clothes', count: 3, reward: { money: 500, xp: 250 } },
  { id: 'build-blacksmith', title: 'Build a blacksmith', icon: '🔨', kind: 'own-buildings', type: 'blacksmith', count: 1, reward: { money: 200, xp: 100 } },
  { id: 'forge-tools', title: 'Forge 5 tools', icon: '🛠️', kind: 'make', item: 'tools', count: 5, reward: { money: 250, xp: 120 } },
  { id: 'upgrade-cottage', title: 'Upgrade a cottage', icon: '🏡', kind: 'upgrade', type: 'cottage', count: 1, reward: { money: 150, xp: 75 } },
  { id: 'build-farmhouse', title: 'Build the farmhouse', icon: '🏠', kind: 'own-buildings', type: 'farmhouse', count: 1, reward: { money: 200, xp: 100 } },
  { id: 'manor-house', title: 'Upgrade the farmhouse to a manor house', icon: '🏡', kind: 'building-level', type: 'farmhouse', count: 2, reward: { money: 400, xp: 200 } },
  { id: 'manor-hall', title: 'Raise the manor hall', icon: '🏰', kind: 'building-level', type: 'farmhouse', count: 3, reward: { money: 600, xp: 300 } },
  { id: 'build-feed-barn', title: 'Build a feed barn', icon: '🐮', kind: 'own-buildings', type: 'feed-barn', count: 1, reward: { money: 80, xp: 30 } },
];

export function getGoal(id: string): GoalDef | undefined {
  return GOALS.find((g) => g.id === id);
}
