import { getBuildable } from '../data/buildables';
import { CAMP, CAMP_FAMILIES, CAMP_FOOTPRINT, CAMP_SUPPLIES } from '../data/camp';
import { PATH } from '../data/farmhouse';
import { isStoredMaterial } from '../data/materials';
import type { StoragePool } from '../data/storage';
import { START_LAYOUT } from './constants';
import type { Game } from './game';
import { houseRoom } from './homes';
import { inBounds } from './land';
import { canPlace } from './placement';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import { addStartingObject, onNewGame } from './state';
import type { GameState, Inventory, PlacedObject } from './types';

/**
 * The starting camp (see `src/data/camp.ts`). Its supplies are ordinary stock in `state.inventory`; the camp only
 * records how much of each is `left`. After every change to the inventory `left[item]` drops to what the farm still
 * holds, so whatever is spent, sold or eaten comes out of the camp first and nothing new ever refills it. The camp adds
 * its `left` to each storage pool's room. The starting families live in its tent (it never takes newcomers), and the
 * village centre is the tile in front of it until the farmhouse is built (`villageCentre`, `src/logic/roads.ts`).
 * Once every `left` is 0 *and* its families have room in the cottages or the farmhouse it is packed away: the object
 * goes, its tiles are free, its families move into the houses, and the slice remembers that it was (so a reload
 * doesn't bring it back). Until then the empty tent waits for homes. Saves from before the camp have none, and saves
 * from before the camp housed families have none in it.
 */

export type CampState = {
  /** What is left of the starting supplies, per item; never more than the inventory holds. */
  left: Inventory;
};

export interface CampSlice {
  /** The camp object's id, null on farms that never had a camp (saves from before it). */
  id: string | null;
  /** True once the supplies were used up and the camp packed away. */
  packed: boolean;
  /** Families living in the tent while it stands (0 once packed, and in saves from before the tent housed any). */
  families: number;
}

export const CAMP_SLICE = 'camp';

registerStateSlice<CampSlice>(CAMP_SLICE, () => ({ id: null, packed: false, families: 0 }));

export function campSlice(state: GameState): CampSlice {
  const s = getSlice<CampSlice>(state, CAMP_SLICE);
  if (typeof s.id !== 'string') s.id = null;
  s.packed = s.packed === true;
  s.families = Number.isInteger(s.families) && s.families > 0 ? Math.min(s.families, CAMP_FAMILIES) : 0;
  return s;
}

/** The farm's farmers (one per family), read without the workers module (which needs this one). */
function farmers(state: GameState): number {
  const n = getSlice<{ farmers?: unknown }>(state, 'workers')?.farmers;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 1;
}

/** Families living in the tent now: its starting families, as far as they are still on the farm; 0 once it is gone. */
export function tentFamilies(state: GameState): number {
  return campOf(state) ? Math.min(campSlice(state).families, farmers(state)) : 0;
}

/** Families the tent's packing waits for: those in it the houses have no room for yet. */
export function waitingFamilies(state: GameState): number {
  const tent = tentFamilies(state);
  if (tent === 0) return 0;
  const housed = farmers(state) - tent;
  return Math.max(0, tent - Math.max(0, houseRoom(state) - housed));
}

/** A family left the farm: while the tent stands it is one of the tent's (the poorest home goes first). */
export function familyLeftCamp(state: GameState): void {
  const s = campSlice(state);
  if (campOf(state) && s.families > 0) s.families--;
}

/** The camp object, while it stands. */
export function campOf(state: GameState): PlacedObject<CampState> | undefined {
  return state.objects.find((o) => o.type === CAMP) as PlacedObject<CampState> | undefined;
}

/** The camp's `left`, repaired if a save holds something odd (counts are whole and not negative). */
export function campLeft(camp: PlacedObject<CampState>): Inventory {
  const raw: unknown = camp.state.left;
  const left: Inventory = {};
  if (isPlainObject(raw)) for (const [id, n] of Object.entries(raw)) if (typeof n === 'number' && Number.isFinite(n) && n > 0) left[id] = Math.floor(n);
  camp.state.left = left;
  return left;
}

/** Room the camp adds to `pool`: what is left of its supplies in that pool (0 without a camp). */
export function campRoom(state: GameState, pool: StoragePool): number {
  const camp = campOf(state);
  if (!camp) return 0;
  let room = 0;
  for (const [id, n] of Object.entries(campLeft(camp))) if ((isStoredMaterial(id) ? 'materials' : 'goods') === pool) room += n;
  return room;
}

/**
 * Brings `left` down to the inventory: `left[item] = min(left[item], inventory[item])`. Pure bookkeeping on the state;
 * returns true when every `left` is 0 (time to pack away). False without a camp.
 */
export function trimCamp(state: GameState): boolean {
  const camp = campOf(state);
  if (!camp) return false;
  const left = campLeft(camp);
  for (const [id, n] of Object.entries(left)) {
    const have = state.inventory[id] ?? 0;
    if (have < n) {
      if (have > 0) left[id] = have;
      else delete left[id];
    }
  }
  return Object.keys(left).length === 0;
}

/**
 * Runs after every inventory change that takes something out (`Game.removeItem`) and at every scheduler step (a home
 * may have been finished): trims `left`, and packs the camp away once the supplies are used up and its families have
 * room in the houses. Packing removes the object (with an `objectRemoved` event, which the camp's view turns into a
 * fade and a toast), moves its families into the houses and marks the slice `packed`. The objects array is replaced
 * rather than spliced, so a loop over it that took the last supplies carries on safely.
 */
export function settleCamp(game: Game): void {
  const { state } = game;
  const camp = campOf(state);
  if (!camp) return;
  const before = JSON.stringify(camp.state.left);
  const empty = trimCamp(state);
  if (empty && waitingFamilies(state) === 0) {
    state.objects = state.objects.filter((o) => o !== camp);
    const s = campSlice(state);
    s.id = camp.id;
    s.packed = true;
    s.families = 0;
    game.events.emit('objectRemoved', camp);
  } else if (JSON.stringify(camp.state.left) !== before) game.touch(camp);
}

/**
 * `window.farm.camp`: the camp's id, what is left, the room it adds, whether it is packed away, the families in the
 * tent and how many of them wait for homes before it can be packed (only once the supplies are used up); null on old
 * saves.
 */
export interface CampInfo {
  id: string;
  left: Inventory;
  room: Record<StoragePool, number>;
  packed: boolean;
  families: number;
  waiting: number;
}

export function campInfo(state: GameState): CampInfo | null {
  const camp = campOf(state);
  if (camp) {
    const left = { ...campLeft(camp) };
    const waiting = Object.keys(left).length === 0 ? waitingFamilies(state) : 0;
    return { id: camp.id, left, room: { goods: campRoom(state, 'goods'), materials: campRoom(state, 'materials') }, packed: false, families: tentFamilies(state), waiting };
  }
  const s = campSlice(state);
  return s.packed && s.id ? { id: s.id, left: {}, room: { goods: 0, materials: 0 }, packed: true, families: 0, waiting: 0 } : null;
}

// New game -------------------------------------------------------------------------------

/** Where a new farm's camp stands: in the middle of the starting land, with room for fields on the rich soil to its left. */
export const START_CAMP = { x: START_LAYOUT.x + 6, y: START_LAYOUT.y } as const;

/** The tile in front of the tent, where its families set out from (relative to the camp's top-left tile). */
export const CAMP_FRONT = { x: 1, y: CAMP_FOOTPRINT.h } as const;

/** The tile in front of a camp standing at (x, y). */
export function campFront(at: { x: number; y: number }): { x: number; y: number } {
  return { x: at.x + CAMP_FRONT.x, y: at.y + CAMP_FRONT.y };
}

/**
 * Where a new farm's camp goes: `START_CAMP`, or else the free spot nearest to it (clear of trees and rocks) with a
 * free tile in the map in front of the tent. Null when nothing fits.
 */
export function campSpot(state: GameState): { x: number; y: number } | null {
  const footprintOf = (o: PlacedObject) => getBuildable(o.type)?.footprint ?? { w: 1, h: 1 };
  const fits = (x: number, y: number) => {
    if (!canPlace(state, CAMP_FOOTPRINT, x, y, footprintOf, CAMP).ok) return false;
    const front = campFront({ x, y });
    return inBounds(state.land, front.x, front.y) && canPlace(state, { w: 1, h: 1 }, front.x, front.y, footprintOf, PATH).ok;
  };
  const spots: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < state.land.height; y++) for (let x = 0; x < state.land.width; x++) spots.push({ x, y, d: Math.abs(x - START_CAMP.x) + Math.abs(y - START_CAMP.y) });
  spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const spot = spots.find((s) => fits(s.x, s.y));
  return spot ? { x: spot.x, y: spot.y } : null;
}

/**
 * Sets up a new farm's camp: the tent with its supplies (also put into the inventory), a path on the tile in front of
 * it, and its families (the farm's starting farmers). Returns the camp, or null when it didn't fit.
 */
export function addCamp(state: GameState): PlacedObject<CampState> | null {
  const spot = campSpot(state);
  const camp = spot && (addStartingObject(state, CAMP, spot.x, spot.y) as PlacedObject<CampState> | null);
  if (!camp) return null;
  for (const [id, n] of Object.entries(CAMP_SUPPLIES)) if (n) state.inventory[id] = (state.inventory[id] ?? 0) + n;
  const front = campFront(camp);
  addStartingObject(state, PATH, front.x, front.y);
  const s = campSlice(state);
  s.id = camp.id;
  s.families = CAMP_FAMILIES;
  getSlice<{ farmers: number }>(state, 'workers').farmers = Math.max(farmers(state), CAMP_FAMILIES);
  return camp;
}

// Early: a new farm is only the camp, and the map is generated around it (clear of trees and rocks).
onNewGame(
  (state) => {
    addCamp(state);
  },
  { early: true },
);
