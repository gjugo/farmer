import { FOODS, MEAL_PER_FAMILY } from '../data/families';
import { familiesCount, homesOf } from './families';
import { firewoodPerHome } from './hazards';
import { perkFactor } from './perks';
import { seasonAt } from './seasons';
import type { GameState } from './types';

/**
 * Supplies, as the HUD's farm overview shows them (like Manor Lords' barrel): how many days the food in the granary
 * lasts at today's use, and in winter the firewood too, whichever runs out first. Read-only: the families' own rules
 * are in `src/logic/families.ts`.
 */

export interface SuppliesInput {
  /** Food in stock (every kind the families eat). */
  food: number;
  families: number;
  /** Wood in stock, and occupied homes that burn it on a winter day. */
  wood: number;
  homes: number;
  winter: boolean;
  /** Wood a home burns a winter day (harsh winters and Warm hearths change it). */
  firewoodPerHome: number;
}

export interface Supplies {
  /** Days until the first of food or (in winter) firewood runs out; null when nothing is used up (no families). */
  days: number | null;
  food: { stock: number; perDay: number; days: number | null };
  /** Null outside winter. */
  firewood: { stock: number; perDay: number; days: number | null } | null;
  /** What runs out first. */
  limit: 'food' | 'firewood' | null;
}

const daysOf = (stock: number, perDay: number) => (perDay > 0 ? Math.floor(Math.max(0, stock) / perDay) : null);

/** Days of food (and, in winter, firewood) left at today's use. */
export function supplyDays(i: SuppliesInput): Supplies {
  const foodPerDay = Math.max(0, i.families) * MEAL_PER_FAMILY;
  const food = { stock: i.food, perDay: foodPerDay, days: daysOf(i.food, foodPerDay) };
  // A day's firewood is rounded up, as the families burn it (`settleDay`).
  const woodPerDay = i.winter ? Math.ceil(Math.min(i.homes, i.families) * i.firewoodPerHome - 1e-9) : 0;
  const firewood = i.winter ? { stock: i.wood, perDay: woodPerDay, days: daysOf(i.wood, woodPerDay) } : null;
  let days = food.days;
  let limit: Supplies['limit'] = days === null ? null : 'food';
  if (firewood?.days != null && (days === null || firewood.days < days)) {
    days = firewood.days;
    limit = 'firewood';
  }
  return { days, food, firewood, limit };
}

/** The farm's supplies now. */
export function suppliesOf(state: GameState): Supplies {
  const now = state.clock.elapsed;
  const count = (id: string) => state.inventory[id] ?? 0;
  return supplyDays({
    food: FOODS.reduce((sum, id) => sum + count(id), 0),
    families: familiesCount(state),
    wood: count('wood'),
    homes: homesOf(state),
    winter: seasonAt(now) === 'winter',
    firewoodPerHome: firewoodPerHome(state, now) * perkFactor(state, 'warm-hearths'),
  });
}
