import {
  APPROVAL,
  ARRIVAL_DELAY_DAYS,
  ARRIVAL_GAP_DAYS,
  ARRIVE_APPROVAL,
  CLOTH_PER_FAMILY,
  CLOTHES_PER_FAMILY,
  FAMILIES_PER_ALE,
  FOODS,
  LEAVE_APPROVAL,
  MEAL_PER_FAMILY,
} from '../data/families';
import { FARMHOUSE_APPROVAL } from '../data/farmhouse';
import { GARDEN_APPROVAL, GARDENS } from '../data/gardens';
import { PROCESSORS } from '../data/processing';
import { SEASONS } from '../data/seasons';
import { MAX_FARMERS } from '../data/workers';
import { DAY_MS } from './constants';
import type { Game } from './game';
import { familyLeftCamp, settleCamp, tentFamilies } from './camp';
import { firewoodPerHome } from './hazards';
import { gardenedHomes } from './gardens';
import { builtFarmhouse, homeBuildings, homeRoom, houseRoom } from './homes';
import * as inventory from './inventory';
import { perkFactor } from './perks';
import { seasonAt, SEASON_MS } from './seasons';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import type { GameState, Inventory } from './types';
import { addFarmer, removeFarmer, workersOf } from './workers';

/**
 * Families with needs. Each family is one farmer and lives in a home: the camp's tent, a cottage or the farmhouse. Once a
 * game day (at every day boundary) the families eat from the granary, burn firewood in winter, drink ale once the
 * brewery is unlocked and, at the start of winter once the loom is unlocked, take clothes (or else cloth) for the year;
 * the day's results (and how many homes have a house garden, `src/logic/gardens.ts`) give their approval. When approval is
 * high and a house has room a new family moves in (never into the tent); when it stays low for a whole day one leaves.
 *
 * Everything runs on the game clock inside the work scheduler (`src/logic/work.ts`): day boundaries and arrival times
 * are scheduler events, so ×60, ×1 and offline catch-up give the same farm.
 */

export const FAMILIES = 'families';

/** Game ms in a year (four seasons). */
export const YEAR_MS = SEASONS.length * SEASON_MS;

/** What the families got on one day. */
export interface DayNeeds {
  /** Families on the farm that day. */
  families: number;
  /** Food id → eaten. */
  ate: Inventory;
  /** Food eaten in all, and what a full meal for every family is. */
  eaten: number;
  meal: number;
  /** Different foods eaten. */
  variety: number;
  /** Winter: families' hearths kept warm (null on other days), and hearths in all (one per housed family). */
  firewood: number | null;
  firewoodNeeded: number;
  /** Families clothed this year; null until the loom is unlocked. */
  clothed: number | null;
  /** How many of the `clothed` wear the tailor's clothes (the rest cloth); missing in older saves (none). */
  dressed?: number;
  /** Families who had ale that day, and the ale they drank; null until the brewery is unlocked (missing in older saves). */
  ale?: number | null;
  aleDrunk?: number;
  /**
   * Home buildings that day (the farmhouse and finished cottages, whatever their room) and how many had a garden; null
   * until gardens are unlocked. Missing in saves from before gardens.
   */
  gardens?: { homes: number; gardened: number } | null;
  /** The farmhouse stood that day. Missing in saves from before it was a building of its own. */
  farmhouse?: boolean;
}

export type ApprovalPartId = 'base' | 'variety' | 'food' | 'clothes' | 'ale' | 'firewood' | 'gardens' | 'farmhouse' | 'neighbours';

/** One line of the approval breakdown, e.g. `{ id: 'variety', label: '3 kinds of food', points: 10 }`. */
export interface ApprovalPart {
  id: ApprovalPartId;
  label: string;
  points: number;
}

export interface Approval {
  /** 0..100 percent. */
  approval: number;
  breakdown: ApprovalPart[];
}

export interface FamiliesState {
  /** Index of the last game day settled (day n starts at n × DAY_MS); -1 until the first step. */
  settledDay: number;
  /** Approval (0..100) from the last settled day, and how it is made up. */
  approval: number;
  breakdown: ApprovalPart[];
  /** What the families got on the last settled day; null before the first one. */
  lastDay: DayNeeds | null;
  /**
   * Game time (the start of a winter) the families last took clothes or cloth, how many got some (clothed until the next
   * winter) and how many of those got the tailor's clothes.
   */
  clothedAt: number | null;
  clothed: number;
  dressed: number;
  /** Game time the next family moves in (if approval allows then); null while no home is free. */
  nextArrivalAt: number | null;
  /** Game time the last family moved in; null before any. */
  lastArrivalAt: number | null;
}

function initialFamilies(): FamiliesState {
  return {
    settledDay: -1,
    approval: APPROVAL.base,
    breakdown: [{ id: 'base', label: 'Settling in', points: APPROVAL.base }],
    lastDay: null,
    clothedAt: null,
    clothed: 0,
    dressed: 0,
    nextArrivalAt: null,
    lastArrivalAt: null,
  };
}

registerStateSlice<FamiliesState>(FAMILIES, initialFamilies);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The families slice, repaired if a save holds something malformed. */
export function familiesOf(state: GameState): FamiliesState {
  const raw = getSlice<unknown>(state, FAMILIES);
  const s = (isPlainObject(raw) ? raw : {}) as Partial<FamiliesState>;
  const d = initialFamilies();
  const fixed: FamiliesState = {
    settledDay: Number.isInteger(s.settledDay) && s.settledDay! >= -1 ? s.settledDay! : d.settledDay,
    approval: isNum(s.approval) ? Math.max(0, Math.min(100, s.approval)) : d.approval,
    breakdown: Array.isArray(s.breakdown) ? s.breakdown : d.breakdown,
    lastDay: isPlainObject(s.lastDay) ? (s.lastDay as unknown as DayNeeds) : null,
    clothedAt: isNum(s.clothedAt) ? s.clothedAt : null,
    clothed: Number.isInteger(s.clothed) && s.clothed! >= 0 ? s.clothed! : 0,
    dressed: Number.isInteger(s.dressed) && s.dressed! >= 0 ? s.dressed! : 0,
    nextArrivalAt: isNum(s.nextArrivalAt) ? s.nextArrivalAt : null,
    lastArrivalAt: isNum(s.lastArrivalAt) ? s.lastArrivalAt : null,
  };
  if (!isPlainObject(raw)) return (state.ext[FAMILIES] = fixed);
  return Object.assign(raw, fixed) as FamiliesState;
}

// Pure rules -----------------------------------------------------------------------

/** Families on the farm: one per farmer. */
export function familiesCount(state: GameState): number {
  return workersOf(state).farmers;
}

/**
 * The day's meal: `mouths` families eat `MEAL_PER_FAMILY` each, spread across the foods in stock (one of each kind in
 * turn, in `FOODS` order), so variety is as high as the stock allows. `stock` says how many of a food there are.
 */
export function mealFrom(stock: (id: string) => number, mouths: number): Inventory {
  const left = new Map(FOODS.map((id) => [id as string, Math.max(0, stock(id))]));
  const ate: Inventory = {};
  let need = mouths * MEAL_PER_FAMILY;
  while (need > 0) {
    let took = false;
    for (const id of FOODS) {
      if (need === 0) break;
      if (left.get(id)! <= 0) continue;
      left.set(id, left.get(id)! - 1);
      inventory.add(ate, id, 1);
      need--;
      took = true;
    }
    if (!took) break;
  }
  return ate;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Approval (0..100) for a day's results, with the breakdown the Families sheet shows; `neighbours`: Good neighbours' points. */
export function approvalOf(day: DayNeeds, neighbours = 0): Approval {
  const parts: ApprovalPart[] = [{ id: 'base', label: 'Base', points: APPROVAL.base }];
  if (day.eaten === 0) parts.push({ id: 'food', label: 'No food in the granary', points: APPROVAL.noFood });
  if (day.eaten > 0) {
    if (day.eaten < day.meal) parts.push({ id: 'food', label: `Short of food (${day.eaten} of ${day.meal})`, points: APPROVAL.shortMeal });
    const variety = Math.min(APPROVAL.maxVariety, Math.max(0, day.variety - 1) * APPROVAL.perExtraFood);
    parts.push({ id: 'variety', label: `${plural(day.variety, 'kind')} of food`, points: variety });
  }
  if (day.clothed !== null && day.families > 0) {
    const clothed = Math.min(day.clothed, day.families);
    // The tailor's clothes are worth more than plain cloth.
    const dressed = Math.min(day.dressed ?? 0, clothed);
    const points = Math.round((APPROVAL.dressed * dressed + APPROVAL.clothed * (clothed - dressed)) / day.families);
    const label = `${clothed} of ${plural(day.families, 'family', 'families')} clothed${dressed > 0 ? ` (${dressed} in clothes)` : ''}`;
    parts.push({ id: 'clothes', label, points });
  }
  if (day.ale != null && day.families > 0) {
    const had = Math.min(day.ale, day.families);
    const label = had === day.families ? `Ale for every family` : `${had} of ${plural(day.families, 'family', 'families')} had ale`;
    parts.push({ id: 'ale', label, points: Math.round((APPROVAL.ale * had) / day.families) });
  }
  if (day.firewood !== null && day.firewoodNeeded > 0) {
    const cold = Math.max(0, day.firewoodNeeded - day.firewood);
    parts.push(
      cold === 0
        ? { id: 'firewood', label: 'Firewood for every home', points: APPROVAL.firewood }
        : // Every cold home counts: all of them cold is the full penalty.
          { id: 'firewood', label: `${cold} of ${plural(day.firewoodNeeded, 'home')} without firewood`, points: Math.round((APPROVAL.freezing * cold) / day.firewoodNeeded) },
    );
  }
  if (day.gardens && day.gardens.homes > 0) {
    const { homes, gardened } = day.gardens;
    const n = Math.min(gardened, homes);
    parts.push({
      id: 'gardens',
      label: n === homes ? `A garden at every home (${homes})` : `Gardens at ${n} of ${plural(homes, 'home')}`,
      points: Math.round((GARDEN_APPROVAL * n) / homes),
    });
  }
  if (day.farmhouse) parts.push({ id: 'farmhouse', label: 'A farmhouse oversees the farm', points: FARMHOUSE_APPROVAL });
  if (neighbours) parts.push({ id: 'neighbours', label: 'Good neighbours', points: neighbours });
  const total = parts.reduce((sum, p) => sum + p.points, 0);
  return { approval: Math.max(0, Math.min(100, total)), breakdown: parts };
}

/** Is `time` the first moment of a winter? */
function winterStarts(time: number): boolean {
  return seasonAt(time) === 'winter' && (time === 0 || seasonAt(time - 1) !== 'winter');
}

/** Are clothes a need yet (the loom is unlocked)? */
export function clothesNeeded(game: Game): boolean {
  return game.isUnlocked(PROCESSORS.loom.unlockLevel);
}

/** Do the families drink ale yet (the brewery is unlocked)? */
export function aleWanted(game: Game): boolean {
  return game.isUnlocked(PROCESSORS.brewery.unlockLevel);
}

/** Do the families want gardens yet (the first kind is unlocked)? */
export function gardensNeeded(game: Game): boolean {
  return game.isUnlocked(Math.min(...Object.values(GARDENS).map((g) => g.unlockLevel)));
}

// Game rules -----------------------------------------------------------------------

/** A family moves in now if a house has room (and the farm is below `MAX_FARMERS`). Returns false when none can. */
export function addFamily(game: Game): boolean {
  const { state } = game;
  if (!homeFree(state) || !addFarmer(game)) return false;
  const s = familiesOf(state);
  s.lastArrivalAt = state.clock.elapsed;
  s.nextArrivalAt = null;
  game.activity.emit('familyArrived', { families: familiesCount(state) });
  return true;
}

/** Room for a newcomer: the houses fit more than the families outside the tent (the tent never takes newcomers). */
function homeFree(state: GameState): boolean {
  return houseRoom(state) > familiesCount(state) - tentFamilies(state) && familiesCount(state) < MAX_FARMERS;
}

/** One family leaves (one of the tent's while it stands): their farmer goes and their workplace is freed. The last family never leaves. */
function familyLeaves(game: Game): boolean {
  const left = removeFarmer(game);
  if (!left) return false;
  familyLeftCamp(game.state);
  game.activity.emit('familyLeft', { families: familiesCount(game.state), workplace: left.workplace });
  return true;
}

/** Settles game day `day` at its first moment: who leaves, the meal, firewood, ale, clothes and the new approval. */
function settleDay(game: Game, day: number): void {
  const { state } = game;
  const s = familiesOf(state);
  const t = day * DAY_MS;
  // The approval set at the start of yesterday held all day: below the line, one family has had enough.
  if (s.settledDay === day - 1 && s.approval < LEAVE_APPROVAL) familyLeaves(game);

  const families = familiesCount(state);
  const ate = mealFrom((id) => game.count(id), families);
  for (const [id, qty] of Object.entries(ate)) game.removeItem(id, qty);
  const eaten = Object.values(ate).reduce((a, b) => a + b, 0);

  const winter = seasonAt(t) === 'winter';
  const firewoodNeeded = Math.min(homeRoom(state), families);
  let firewood: number | null = null;
  if (winter) {
    // Warm hearths: each home burns half as much (the day's wood is rounded up). A harsh winter doubles it
    // (`src/logic/hazards.ts`); the approval rules stay the same.
    const perHome = firewoodPerHome(state, t) * perkFactor(state, 'warm-hearths');
    const burnt = Math.min(Math.ceil(firewoodNeeded * perHome - 1e-9), game.count('wood'));
    if (burnt > 0) game.removeItem('wood', burnt);
    firewood = Math.min(firewoodNeeded, Math.floor(burnt / perHome + 1e-9));
  }

  // Ale: one for every `FAMILIES_PER_ALE` families, as far as the stock goes.
  let ale: number | null = null;
  let aleDrunk = 0;
  if (aleWanted(game)) {
    aleDrunk = Math.min(Math.ceil(families / FAMILIES_PER_ALE), game.count('ale'));
    if (aleDrunk > 0) game.removeItem('ale', aleDrunk);
    ale = Math.min(families, aleDrunk * FAMILIES_PER_ALE);
  }

  let clothed: number | null = null;
  let dressed = 0;
  if (clothesNeeded(game)) {
    if (winterStarts(t) && s.clothedAt !== t) {
      // Clothes first, while there are any; the rest of the families take cloth.
      const withClothes = Math.min(families, Math.floor(game.count('clothes') / CLOTHES_PER_FAMILY));
      if (withClothes > 0) game.removeItem('clothes', withClothes * CLOTHES_PER_FAMILY);
      const withCloth = Math.min(families - withClothes, Math.floor(game.count('cloth') / CLOTH_PER_FAMILY));
      if (withCloth > 0) game.removeItem('cloth', withCloth * CLOTH_PER_FAMILY);
      s.clothedAt = t;
      s.clothed = withClothes + withCloth;
      s.dressed = withClothes;
    }
    clothed = s.clothedAt !== null && t < s.clothedAt + YEAR_MS ? Math.min(s.clothed, families) : 0;
    dressed = Math.min(s.dressed, clothed);
  }

  const gardens = gardensNeeded(game) ? { homes: homeBuildings(state), gardened: gardenedHomes(state) } : null;
  const needs: DayNeeds = {
    families,
    ate,
    eaten,
    meal: families * MEAL_PER_FAMILY,
    variety: Object.keys(ate).length,
    firewood,
    firewoodNeeded,
    clothed,
    dressed,
    ale,
    aleDrunk,
    gardens,
    farmhouse: !!builtFarmhouse(state),
  };
  const { approval, breakdown } = approvalOf(needs, perkFactor(state, 'good-neighbours'));
  Object.assign(s, { settledDay: day, approval, breakdown, lastDay: needs });
  game.activity.emit('familiesSettled', { approval });
}

/**
 * The families' part of a scheduler step at the current game time: settles every day that has begun, then lets a
 * family move in when one is due. Called by `runWork` at every event, so it must be a no-op between events.
 */
export function stepFamilies(game: Game): void {
  const { state } = game;
  const now = state.clock.elapsed;
  const s = familiesOf(state);
  const today = Math.floor(now / DAY_MS);
  // A home may have been finished since: the empty camp packs away once its families have room.
  settleCamp(game);
  // A new game, or a save from before families: start counting from today.
  if (s.settledDay < 0) s.settledDay = today;
  while (s.settledDay < today) settleDay(game, s.settledDay + 1);

  if (!homeFree(state)) {
    s.nextArrivalAt = null;
    return;
  }
  const schedule = () => {
    const gap = s.lastArrivalAt === null ? -Infinity : s.lastArrivalAt + ARRIVAL_GAP_DAYS * DAY_MS;
    s.nextArrivalAt = Math.max(now + ARRIVAL_DELAY_DAYS * DAY_MS, gap);
  };
  if (s.nextArrivalAt === null) schedule();
  if (now >= s.nextArrivalAt! && s.approval >= ARRIVE_APPROVAL && addFamily(game) && homeFree(state)) schedule();
}

/** The next game time after now at which the families' step does something: a new day, or a family due to arrive. */
export function nextFamiliesEvent(state: GameState): number {
  const now = state.clock.elapsed;
  const s = familiesOf(state);
  const day = (Math.floor(now / DAY_MS) + 1) * DAY_MS;
  return s.nextArrivalAt !== null && s.nextArrivalAt > now ? Math.min(day, s.nextArrivalAt) : day;
}
