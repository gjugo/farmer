import { COTTAGE, COTTAGE_DEF, FIREWOOD_PER_HOME, MAX_COTTAGE_LEVEL, type CottageLevel } from '../data/families';
import { formatMaterials, formatMissing, materialEntries, type MaterialCost } from '../data/materials';
import { SEASON_DAYS } from '../data/seasons';
import { familiesCount, familiesOf } from './families';
import type { Game } from './game';
import { cottageLevel } from './homes';
import { materialsCost } from './perks';
import type { PlacedObject } from './types';

/**
 * Cottage upgrades, like Manor Lords' burgage levels: a cottage goes up a level only while its households' needs are
 * met (the farm's level, a winter's firewood in store, a varied meal yesterday) and the cost is paid; a free farmer
 * then rebuilds it bigger, and a level 2 cottage houses a second family. It never goes down a level when the needs
 * lapse later. Levels and costs are `COTTAGE_DEF.levels` (`src/data/families.ts`); room is `src/logic/homes.ts`.
 */

export type CottageUpgrade = Required<CottageLevel>['upgrade'] & { level: number; room: number };

/** The next level and what it asks, or null at the top level (or for anything that isn't a cottage). */
export function nextCottageLevel(obj: PlacedObject): CottageUpgrade | null {
  if (obj.type !== COTTAGE) return null;
  const level = cottageLevel(obj);
  const next = COTTAGE_DEF.levels[level];
  return next?.upgrade ? { ...next.upgrade, level: level + 1, room: next.room } : null;
}

/** One line of the checklist: met or not, and what it says (with what is missing when it isn't). */
export interface CheckLine {
  ok: boolean;
  text: string;
}

export interface CottageChecklist {
  /** The level the upgrade leads to (the top level when there is none). */
  next: number;
  level: CheckLine;
  fuel: CheckLine;
  food: CheckLine;
  cost: CheckLine;
  /** Why it can't be upgraded whatever the lines say: still being built, or already at the top level. */
  blocked: 'site' | 'max' | null;
  /** Every line met and nothing blocks it: the button works. */
  ok: boolean;
}

/** The materials the upgrade to `next` takes on this farm (fewer with Thrifty). */
function costMaterials(game: Game, next: CottageUpgrade): MaterialCost {
  return materialsCost(game.state, next.materials);
}

/** Wood a winter takes for `families` families: one per family per winter day. */
export function winterFirewood(families: number): number {
  return Math.max(0, families) * FIREWOOD_PER_HOME * SEASON_DAYS;
}

/**
 * The upgrade's requirements checklist for a cottage, each line met or not. Pure: reads the game, changes nothing.
 * At the top level it shows what the last level asked, with `blocked: 'max'`.
 */
export function cottageChecklist(game: Game, obj: PlacedObject): CottageChecklist {
  const top = COTTAGE_DEF.levels[MAX_COTTAGE_LEVEL - 1];
  const next = nextCottageLevel(obj) ?? { ...top.upgrade!, level: MAX_COTTAGE_LEVEL, room: top.room };
  const { state } = game;

  const level: CheckLine = {
    ok: game.level >= next.farmLevel,
    text: game.level >= next.farmLevel ? `Farm level ${next.farmLevel}` : `Farm level ${next.farmLevel} (the farm is level ${game.level})`,
  };

  // Fuel: a winter's firewood for the families there are, left in store after the upgrade's own wood is paid.
  const families = familiesCount(state);
  const needWood = winterFirewood(families);
  const costWood = costMaterials(game, next).wood ?? 0;
  const woodLeft = game.count('wood') - costWood;
  const fuel: CheckLine = {
    ok: woodLeft >= needWood,
    text:
      woodLeft >= needWood
        ? `Fuel: a winter's firewood, ${needWood} 🪵 for ${families} ${families === 1 ? 'family' : 'families'}`
        : `Fuel: a winter's firewood, ${needWood} 🪵 for ${families} ${families === 1 ? 'family' : 'families'} after the upgrade's ${costWood} 🪵 (${Math.max(0, woodLeft)} would be left)`,
  };

  // Food: a varied meal on the last settled day, with nobody short.
  const day = familiesOf(state).lastDay;
  const kinds = `${next.foods} kinds of food`;
  let foodWhy: string | null = null;
  if (!day) foodWhy = 'no day settled yet';
  else if (day.eaten < day.meal) foodWhy = `short yesterday: ${day.eaten} of ${day.meal}`;
  else if (day.variety < next.foods) foodWhy = `ate ${day.variety} ${day.variety === 1 ? 'kind' : 'kinds'} yesterday`;
  const food: CheckLine = { ok: foodWhy === null, text: foodWhy === null ? `Food: ${kinds} eaten yesterday, nobody short` : `Food: ${kinds} eaten yesterday, nobody short (${foodWhy})` };

  // Cost: money and materials.
  const materials = costMaterials(game, next);
  const missing = game.missingMaterials(materials);
  const short = Math.max(0, next.cost - state.money);
  const costText = `Cost: $${next.cost}${materialEntries(materials).length ? ` + ${formatMaterials(materials)}` : ''}`;
  const lacks = [...(short > 0 ? [`$${Math.ceil(short)} more`] : []), ...(missing.length ? [formatMissing(missing)] : [])];
  const cost: CheckLine = { ok: lacks.length === 0, text: lacks.length ? `${costText} (needs ${lacks.join(' and ')})` : costText };

  const blocked = obj.site ? 'site' : nextCottageLevel(obj) === null ? 'max' : null;
  return { next: next.level, level, fuel, food, cost, blocked, ok: !blocked && level.ok && fuel.ok && food.ok && cost.ok };
}

export type CottageUpgradeResult = { ok: true; level: number } | { ok: false; reason: 'not-cottage' | 'site' | 'max' | 'needs' };

/** Checks without changing anything; `upgradeCottage` gives the same answer. */
export function checkCottageUpgrade(game: Game, obj: PlacedObject): CottageUpgradeResult {
  if (obj.type !== COTTAGE) return { ok: false, reason: 'not-cottage' };
  const list = cottageChecklist(game, obj);
  if (list.blocked) return { ok: false, reason: list.blocked };
  return list.ok ? { ok: true, level: list.next } : { ok: false, reason: 'needs' };
}

/** Charges the next level's money and materials and raises the level (and the cottage's room). Nothing changes when it fails. */
export function upgradeCottage(game: Game, obj: PlacedObject): CottageUpgradeResult {
  const check = checkCottageUpgrade(game, obj);
  if (!check.ok) return check;
  const next = nextCottageLevel(obj)!;
  game.spend(next.cost);
  for (const [id, qty] of materialEntries(costMaterials(game, next))) game.removeItem(id, qty);
  obj.state.level = next.level;
  game.touch(obj);
  game.activity.emit('upgraded', { type: obj.type, level: next.level });
  return check;
}
