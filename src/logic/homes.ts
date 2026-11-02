import { CAMP } from '../data/camp';
import { COTTAGE, COTTAGE_DEF, MAX_COTTAGE_LEVEL } from '../data/families';
import { FARMHOUSE, FARMHOUSE_DEF, MAX_FARMHOUSE_LEVEL, type FarmhouseLevel } from '../data/farmhouse';
import { campOf, tentFamilies } from './camp';
import type { GameState, PlacedObject } from './types';

/**
 * Homes: the camp's tent, the farmhouse (once built) and the cottages. The counts, kept apart:
 * - **house room**, the families the houses fit (the farmhouse's once it is finished, plus each finished cottage's
 *   room for its level): newcomers need free house room, and the camp packs away only once its families fit in it;
 * - **room**, the house room plus the families in the tent (it houses the starting families while it stands but never
 *   takes newcomers): the 🏠 chip, supplies and firewood go by it;
 * - **home buildings** (the farmhouse and every finished cottage, whatever its level): one garden each, and the
 *   gardens' approval share counts these.
 * The tent's families live in the tent; the others fill the houses in build order: the farmhouse first, then each
 * cottage up to its room.
 */

/** The farmhouse once it is finished (not while it is a construction site). */
export function builtFarmhouse(state: GameState): PlacedObject | undefined {
  return state.objects.find((o) => o.type === FARMHOUSE && !o.site);
}

/** `obj.state.level` within 1..max (1 for a save without one), repaired if a save holds something odd. */
export function levelWithin(obj: PlacedObject, max: number): number {
  const level = obj.state.level;
  return typeof level === 'number' && Number.isInteger(level) ? Math.max(1, Math.min(max, level)) : 1;
}

/** A cottage's level (1 for anything else, or a save without one), repaired if a save holds something odd. */
export function cottageLevel(obj: PlacedObject): number {
  return levelWithin(obj, MAX_COTTAGE_LEVEL);
}

/** A farmhouse's level (1 for a save without one; it counts while still a site, too). */
export function farmhouseLevel(obj: PlacedObject): number {
  return levelWithin(obj, MAX_FARMHOUSE_LEVEL);
}

/** What the built farmhouse's level gives (room, store, approval), or null while there is none. */
export function farmhouseNow(state: GameState): FarmhouseLevel | null {
  const house = builtFarmhouse(state);
  return house ? FARMHOUSE_DEF.levels[farmhouseLevel(house) - 1] : null;
}

/** Families the farmhouse houses: its level's room once it is built, else none. */
export function farmhouseRoom(state: GameState): number {
  return farmhouseNow(state)?.room ?? 0;
}

/** Families a finished cottage houses (none while it is being built, and none for anything that isn't a cottage). */
export function cottageRoom(obj: PlacedObject): number {
  return obj.type === COTTAGE && !obj.site ? COTTAGE_DEF.levels[cottageLevel(obj) - 1].room : 0;
}

/** Finished cottages in build order. */
export function finishedCottages(state: GameState): PlacedObject[] {
  return state.objects.filter((o) => o.type === COTTAGE && !o.site);
}

/** Families the houses fit: the built farmhouse's, plus every finished cottage's room. */
export function houseRoom(state: GameState): number {
  return farmhouseRoom(state) + finishedCottages(state).reduce((n, o) => n + cottageRoom(o), 0);
}

/** Families the farm's homes fit: the houses' room, plus the families living in the tent. */
export function homeRoom(state: GameState): number {
  return houseRoom(state) + tentFamilies(state);
}

/** Home buildings: the built farmhouse and every finished cottage, one each whatever its level. */
export function homeBuildings(state: GameState): number {
  return (builtFarmhouse(state) ? 1 : 0) + finishedCottages(state).length;
}

export interface HomeInfo {
  id: string;
  type: string;
  level: number;
  room: number;
  families: number;
}

/**
 * Every home and who lives there, for `families` families: the tent's families in the tent, then the built farmhouse,
 * then the finished cottages in build order, each filled up to its room. Families beyond the room (an old save) live
 * nowhere in particular.
 */
export function homeList(state: GameState, families: number): HomeInfo[] {
  const homes: HomeInfo[] = [];
  const camp = campOf(state);
  const tent = Math.min(tentFamilies(state), Math.max(0, families));
  if (camp && tent > 0) homes.push({ id: camp.id, type: CAMP, level: 1, room: tent, families: 0 });
  const farmhouse = builtFarmhouse(state);
  if (farmhouse) homes.push({ id: farmhouse.id, type: FARMHOUSE, level: farmhouseLevel(farmhouse), room: farmhouseRoom(state), families: 0 });
  for (const o of finishedCottages(state)) homes.push({ id: o.id, type: COTTAGE, level: cottageLevel(o), room: cottageRoom(o), families: 0 });
  let left = Math.max(0, families);
  for (const h of homes) {
    h.families = Math.min(h.room, left);
    left -= h.families;
  }
  return homes;
}

/** Families living in the home `id` (0 for a site or an unknown id). */
export function familiesIn(state: GameState, families: number, id: string): number {
  return homeList(state, families).find((h) => h.id === id)?.families ?? 0;
}
