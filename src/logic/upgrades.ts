import { FIREWOOD_PER_HOME } from '../data/families';
import { formatMaterials, formatMissing, materialEntries, type MaterialCost } from '../data/materials';
import { SEASON_DAYS } from '../data/seasons';
import { familiesCount, familiesOf } from './families';
import type { Game } from './game';
import { levelWithin } from './homes';
import { materialsCost } from './perks';
import type { PlacedObject } from './types';

/**
 * Home upgrades, like Manor Lords' burgage and manor levels, shared by the cottage (`src/logic/cottages.ts`) and the
 * farmhouse (`src/logic/farmhouse.ts`): a home goes up a level only while the needs its next level asks are met (the
 * farm's level, a winter's firewood in store, and per building: a varied meal yesterday, enough families, enough
 * approval) and the cost is paid (materials fewer with Thrifty). It never goes down a level when the needs lapse later.
 */

/** What going up to a level asks: the farm's level and the cost always; the rest only when given. */
export interface LevelNeeds {
  cost: number;
  materials: MaterialCost;
  farmLevel: number;
  /** Kinds of food eaten on the last settled day, with nobody short (the cottage). */
  foods?: number;
  /** At least this many families on the farm (the farmhouse). */
  families?: number;
  /** Approval of at least this (percent) (the farmhouse). */
  approval?: number;
}

/** One level of a home: the families it houses, and what going up to it asks (missing for level 1, the build). */
export interface HomeLevel {
  room: number;
  upgrade?: LevelNeeds;
}

/** A home with levels: its type and its levels, level 1 first. */
export interface UpgradeDef {
  type: string;
  levels: readonly HomeLevel[];
}

export type NextLevel = LevelNeeds & { level: number; room: number };

/** The level a home of `def` is at (1 for a save without one). */
export function levelOf(def: UpgradeDef, obj: PlacedObject): number {
  return levelWithin(obj, def.levels.length);
}

/** The next level and what it asks, or null at the top level (or for anything that isn't `def`'s type). */
export function nextLevel(def: UpgradeDef, obj: PlacedObject): NextLevel | null {
  if (obj.type !== def.type) return null;
  const level = levelOf(def, obj);
  const next = def.levels[level];
  return next?.upgrade ? { ...next.upgrade, level: level + 1, room: next.room } : null;
}

/** One line of the checklist: met or not, and what it says (with what is missing when it isn't). */
export interface CheckLine {
  ok: boolean;
  text: string;
}

export type CheckLineId = 'level' | 'families' | 'approval' | 'fuel' | 'food' | 'cost';

export interface UpgradeChecklist {
  /** The level the upgrade leads to (the top level when there is none). */
  next: number;
  level: CheckLine;
  families?: CheckLine;
  approval?: CheckLine;
  fuel: CheckLine;
  food?: CheckLine;
  cost: CheckLine;
  /** The lines this home's next level asks, in the order the panel shows them. */
  lines: (CheckLine & { id: CheckLineId })[];
  /** Why it can't be upgraded whatever the lines say: still being built, or already at the top level. */
  blocked: 'site' | 'max' | null;
  /** Every line met and nothing blocks it: the button works. */
  ok: boolean;
}

/** Wood a winter takes for `families` families: one per family per winter day. */
export function winterFirewood(families: number): number {
  return Math.max(0, families) * FIREWOOD_PER_HOME * SEASON_DAYS;
}

/** The materials the upgrade to `next` takes on this farm (fewer with Thrifty). */
export function upgradeMaterials(game: Game, next: LevelNeeds): MaterialCost {
  return materialsCost(game.state, next.materials);
}

const familiesText = (n: number) => `${n} ${n === 1 ? 'family' : 'families'}`;

/**
 * The upgrade's requirements checklist for a home of `def`, each line met or not. Pure: reads the game, changes
 * nothing. At the top level it shows what the last level asked, with `blocked: 'max'`.
 */
export function upgradeChecklist(game: Game, def: UpgradeDef, obj: PlacedObject): UpgradeChecklist {
  const max = def.levels.length;
  const top = def.levels[max - 1];
  const next = nextLevel(def, obj) ?? { ...top.upgrade!, level: max, room: top.room };
  const { state } = game;
  const lines: UpgradeChecklist['lines'] = [];

  const level: CheckLine = {
    ok: game.level >= next.farmLevel,
    text: game.level >= next.farmLevel ? `Farm level ${next.farmLevel}` : `Farm level ${next.farmLevel} (the farm is level ${game.level})`,
  };
  lines.push({ id: 'level', ...level });

  const families = familiesCount(state);
  let familiesLine: CheckLine | undefined;
  if (next.families !== undefined) {
    const ok = families >= next.families;
    familiesLine = { ok, text: ok ? `At least ${familiesText(next.families)}` : `At least ${familiesText(next.families)} (${families} now)` };
    lines.push({ id: 'families', ...familiesLine });
  }

  let approvalLine: CheckLine | undefined;
  if (next.approval !== undefined) {
    const { approval } = familiesOf(state);
    const ok = approval >= next.approval;
    approvalLine = { ok, text: ok ? `Approval ${next.approval}% or more` : `Approval ${next.approval}% or more (${approval}% now)` };
    lines.push({ id: 'approval', ...approvalLine });
  }

  // Fuel: a winter's firewood for the families there are, left in store after the upgrade's own wood is paid.
  const needWood = winterFirewood(families);
  const costWood = upgradeMaterials(game, next).wood ?? 0;
  const woodLeft = game.count('wood') - costWood;
  const fuel: CheckLine = {
    ok: woodLeft >= needWood,
    text:
      woodLeft >= needWood
        ? `Fuel: a winter's firewood, ${needWood} 🪵 for ${familiesText(families)}`
        : `Fuel: a winter's firewood, ${needWood} 🪵 for ${familiesText(families)} after the upgrade's ${costWood} 🪵 (${Math.max(0, woodLeft)} would be left)`,
  };
  lines.push({ id: 'fuel', ...fuel });

  // Food: a varied meal on the last settled day, with nobody short.
  let food: CheckLine | undefined;
  if (next.foods !== undefined) {
    const day = familiesOf(state).lastDay;
    const kinds = `${next.foods} kinds of food`;
    let foodWhy: string | null = null;
    if (!day) foodWhy = 'no day settled yet';
    else if (day.eaten < day.meal) foodWhy = `short yesterday: ${day.eaten} of ${day.meal}`;
    else if (day.variety < next.foods) foodWhy = `ate ${day.variety} ${day.variety === 1 ? 'kind' : 'kinds'} yesterday`;
    food = { ok: foodWhy === null, text: foodWhy === null ? `Food: ${kinds} eaten yesterday, nobody short` : `Food: ${kinds} eaten yesterday, nobody short (${foodWhy})` };
    lines.push({ id: 'food', ...food });
  }

  // Cost: money and materials.
  const materials = upgradeMaterials(game, next);
  const missing = game.missingMaterials(materials);
  const short = Math.max(0, next.cost - state.money);
  const costText = `Cost: $${next.cost}${materialEntries(materials).length ? ` + ${formatMaterials(materials)}` : ''}`;
  const lacks = [...(short > 0 ? [`$${Math.ceil(short)} more`] : []), ...(missing.length ? [formatMissing(missing)] : [])];
  const cost: CheckLine = { ok: lacks.length === 0, text: lacks.length ? `${costText} (needs ${lacks.join(' and ')})` : costText };
  lines.push({ id: 'cost', ...cost });

  const blocked = obj.site ? 'site' : nextLevel(def, obj) === null ? 'max' : null;
  return {
    next: next.level,
    level,
    ...(familiesLine ? { families: familiesLine } : {}),
    ...(approvalLine ? { approval: approvalLine } : {}),
    fuel,
    ...(food ? { food } : {}),
    cost,
    lines,
    blocked,
    ok: !blocked && lines.every((l) => l.ok),
  };
}

export type UpgradeResult<Wrong extends string> = { ok: true; level: number } | { ok: false; reason: Wrong | 'site' | 'max' | 'needs' };

/** Checks without changing anything; `applyUpgrade` gives the same answer. `wrong` is the reason for another type. */
export function checkUpgrade<W extends string>(game: Game, def: UpgradeDef, obj: PlacedObject, wrong: W): UpgradeResult<W> {
  if (obj.type !== def.type) return { ok: false, reason: wrong };
  const list = upgradeChecklist(game, def, obj);
  if (list.blocked) return { ok: false, reason: list.blocked };
  return list.ok ? { ok: true, level: list.next } : { ok: false, reason: 'needs' };
}

/** Charges the next level's money and materials and raises the level. Nothing changes when it fails. */
export function applyUpgrade<W extends string>(game: Game, def: UpgradeDef, obj: PlacedObject, wrong: W): UpgradeResult<W> {
  const check = checkUpgrade(game, def, obj, wrong);
  if (!check.ok) return check;
  const next = nextLevel(def, obj)!;
  game.spend(next.cost);
  for (const [id, qty] of materialEntries(upgradeMaterials(game, next))) game.removeItem(id, qty);
  obj.state.level = next.level;
  game.touch(obj);
  game.activity.emit('upgraded', { type: obj.type, level: next.level });
  return check;
}

/** The unmet lines' texts, joined, for the toast when the needs lapsed while the farmer walked there. */
export function missingText(list: UpgradeChecklist): string {
  return list.lines
    .filter((l) => !l.ok)
    .map((l) => l.text)
    .join('; ');
}
