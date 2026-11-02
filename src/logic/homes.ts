import { COTTAGE, COTTAGE_DEF, FARMHOUSE_HOMES, MAX_COTTAGE_LEVEL } from '../data/families';
import { FARMHOUSE } from '../data/farmhouse';
import type { GameState, PlacedObject } from './types';

/**
 * Homes: the farmhouse and the cottages. Two counts, kept apart:
 * - **room**, the families that fit (the farmhouse's, plus each finished cottage's room for its level): arrivals, the
 *   🏠 chip, supplies and firewood go by it;
 * - **home buildings** (the farmhouse and every finished cottage, whatever its level): one garden each, and the
 *   gardens' approval share counts these.
 * Families fill the homes in build order: the farmhouse first, then each cottage up to its room.
 */

/** A cottage's level (1 for anything else, or a save without one), repaired if a save holds something odd. */
export function cottageLevel(obj: PlacedObject): number {
  const level = obj.state.level;
  return typeof level === 'number' && Number.isInteger(level) ? Math.max(1, Math.min(MAX_COTTAGE_LEVEL, level)) : 1;
}

/** Families a finished cottage houses (none while it is being built, and none for anything that isn't a cottage). */
export function cottageRoom(obj: PlacedObject): number {
  return obj.type === COTTAGE && !obj.site ? COTTAGE_DEF.levels[cottageLevel(obj) - 1].room : 0;
}

/** Finished cottages in build order. */
export function finishedCottages(state: GameState): PlacedObject[] {
  return state.objects.filter((o) => o.type === COTTAGE && !o.site);
}

/** Families the farm's homes fit: the farmhouse's, plus every finished cottage's room. */
export function homeRoom(state: GameState): number {
  return FARMHOUSE_HOMES + finishedCottages(state).reduce((n, o) => n + cottageRoom(o), 0);
}

/** Home buildings: the farmhouse and every finished cottage, one each whatever its level. */
export function homeBuildings(state: GameState): number {
  return FARMHOUSE_HOMES + finishedCottages(state).length;
}

export interface HomeInfo {
  id: string;
  type: string;
  level: number;
  room: number;
  families: number;
}

/**
 * Every home and who lives there, for `families` families: the farmhouse first, then the finished cottages in build
 * order, each filled up to its room. Families beyond the room (an old save) live nowhere in particular.
 */
export function homeList(state: GameState, families: number): HomeInfo[] {
  const farmhouse = state.objects.find((o) => o.type === FARMHOUSE);
  const homes: HomeInfo[] = [{ id: farmhouse?.id ?? FARMHOUSE, type: FARMHOUSE, level: 1, room: FARMHOUSE_HOMES, families: 0 }];
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
