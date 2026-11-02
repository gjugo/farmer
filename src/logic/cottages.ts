import { COTTAGE, COTTAGE_DEF, type CottageLevel } from '../data/families';
import type { Game } from './game';
import type { PlacedObject } from './types';
import { applyUpgrade, checkUpgrade, nextLevel, upgradeChecklist, type CheckLine, type UpgradeChecklist, type UpgradeDef } from './upgrades';

/**
 * Cottage upgrades, like Manor Lords' burgage levels: a cottage goes up a level only while its households' needs are
 * met (the farm's level, a winter's firewood in store, a varied meal yesterday) and the cost is paid; a free farmer
 * then rebuilds it bigger, and a level 2 cottage houses a second family. It never goes down a level when the needs
 * lapse later. Levels and costs are `COTTAGE_DEF.levels` (`src/data/families.ts`); room is `src/logic/homes.ts`; the
 * checklist and upgrade are shared with the farmhouse (`src/logic/upgrades.ts`).
 */

export { winterFirewood, type CheckLine } from './upgrades';

const COTTAGE_UPGRADE: UpgradeDef = { type: COTTAGE, levels: COTTAGE_DEF.levels };

export type CottageUpgrade = Required<CottageLevel>['upgrade'] & { level: number; room: number };

/** The next level and what it asks, or null at the top level (or for anything that isn't a cottage). */
export function nextCottageLevel(obj: PlacedObject): CottageUpgrade | null {
  return nextLevel(COTTAGE_UPGRADE, obj) as CottageUpgrade | null;
}

export type CottageChecklist = UpgradeChecklist & { food: CheckLine };

/**
 * The upgrade's requirements checklist for a cottage, each line met or not (level, fuel, food, cost). Pure: reads the
 * game, changes nothing. At the top level it shows what the last level asked, with `blocked: 'max'`.
 */
export function cottageChecklist(game: Game, obj: PlacedObject): CottageChecklist {
  return upgradeChecklist(game, COTTAGE_UPGRADE, obj) as CottageChecklist;
}

export type CottageUpgradeResult = { ok: true; level: number } | { ok: false; reason: 'not-cottage' | 'site' | 'max' | 'needs' };

/** Checks without changing anything; `upgradeCottage` gives the same answer. */
export function checkCottageUpgrade(game: Game, obj: PlacedObject): CottageUpgradeResult {
  return checkUpgrade(game, COTTAGE_UPGRADE, obj, 'not-cottage');
}

/** Charges the next level's money and materials and raises the level (and the cottage's room). Nothing changes when it fails. */
export function upgradeCottage(game: Game, obj: PlacedObject): CottageUpgradeResult {
  return applyUpgrade(game, COTTAGE_UPGRADE, obj, 'not-cottage');
}
