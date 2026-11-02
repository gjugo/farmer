import { getBuildable } from '../data/buildables';
import { CAMP, CAMP_FOOTPRINT, CAMP_SUPPLIES } from '../data/camp';
import { FARMHOUSE, PATH } from '../data/farmhouse';
import { isStoredMaterial } from '../data/materials';
import type { StoragePool } from '../data/storage';
import type { Game } from './game';
// The farmhouse and its road are laid out first; the camp goes beside them.
import { farmhouseOf } from './roads';
import { canPlace } from './placement';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import { addStartingObject, onNewGame } from './state';
import type { GameState, Inventory, PlacedObject } from './types';

/**
 * The starting camp (see `src/data/camp.ts`). Its supplies are ordinary stock in `state.inventory`; the camp only
 * records how much of each is `left`. After every change to the inventory `left[item]` drops to what the farm still
 * holds, so whatever is spent, sold or eaten comes out of the camp first and nothing new ever refills it. The camp adds
 * its `left` to each storage pool's room, and once every `left` is 0 it is packed away: the object goes, its tiles
 * are free, and the slice remembers that it was (so a reload doesn't bring it back). Saves from before the camp have
 * none.
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
}

export const CAMP_SLICE = 'camp';

registerStateSlice<CampSlice>(CAMP_SLICE, () => ({ id: null, packed: false }));

export function campSlice(state: GameState): CampSlice {
  const s = getSlice<CampSlice>(state, CAMP_SLICE);
  if (typeof s.id !== 'string') s.id = null;
  s.packed = s.packed === true;
  return s;
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
 * Runs after every inventory change that takes something out (`Game.removeItem`): trims `left`, and packs the camp
 * away once the supplies are used up. Packing removes the object (with an `objectRemoved` event, which the camp's view
 * turns into a fade and a toast) and marks the slice `packed`. The objects array is replaced rather than spliced, so
 * a loop over it that took the last supplies carries on safely.
 */
export function settleCamp(game: Game): void {
  const { state } = game;
  const camp = campOf(state);
  if (!camp) return;
  const before = JSON.stringify(camp.state.left);
  const empty = trimCamp(state);
  if (empty) {
    state.objects = state.objects.filter((o) => o !== camp);
    const s = campSlice(state);
    s.id = camp.id;
    s.packed = true;
    game.events.emit('objectRemoved', camp);
  } else if (JSON.stringify(camp.state.left) !== before) game.touch(camp);
}

/** `window.farm.camp`: the camp's id, what is left, the room it adds and whether it is packed away; null on old saves. */
export interface CampInfo {
  id: string;
  left: Inventory;
  room: Record<StoragePool, number>;
  packed: boolean;
}

export function campInfo(state: GameState): CampInfo | null {
  const camp = campOf(state);
  if (camp) return { id: camp.id, left: { ...campLeft(camp) }, room: { goods: campRoom(state, 'goods'), materials: campRoom(state, 'materials') }, packed: false };
  const s = campSlice(state);
  return s.packed && s.id ? { id: s.id, left: {}, room: { goods: 0, materials: 0 }, packed: true } : null;
}

// New game -------------------------------------------------------------------------------

/** True when the w × h area at (x, y) shares an edge with a path tile. */
function besidePath(state: GameState, x: number, y: number, w: number, h: number): boolean {
  const paths = new Set(state.objects.filter((o) => o.type === PATH).map((o) => `${o.x},${o.y}`));
  for (let tx = x; tx < x + w; tx++) if (paths.has(`${tx},${y - 1}`) || paths.has(`${tx},${y + h}`)) return true;
  for (let ty = y; ty < y + h; ty++) if (paths.has(`${x - 1},${ty}`) || paths.has(`${x + w},${ty}`)) return true;
  return false;
}

/**
 * Where a new farm's camp goes: free owned tiles near the farmhouse, beside a path, on the side away from the
 * starting fields (the spot nearest to a point two and a half tiles past the farmhouse on that side). Null when
 * nothing fits.
 */
export function campSpot(state: GameState): { x: number; y: number } | null {
  const house = farmhouseOf(state);
  if (!house) return null;
  const hf = getBuildable(FARMHOUSE)!.footprint;
  const hx = house.x + hf.w / 2;
  const hy = house.y + hf.h / 2;
  const others = state.objects.filter((o) => o.type !== PATH && o.type !== FARMHOUSE);
  const centre = (o: PlacedObject) => {
    const fp = getBuildable(o.type)?.footprint ?? { w: 1, h: 1 };
    return { x: o.x + fp.w / 2, y: o.y + fp.h / 2 };
  };
  let dx = 1;
  let dy = 0;
  if (others.length) {
    const fx = others.reduce((n, o) => n + centre(o).x, 0) / others.length - hx;
    const fy = others.reduce((n, o) => n + centre(o).y, 0) / others.length - hy;
    const len = Math.hypot(fx, fy) || 1;
    [dx, dy] = [-fx / len, -fy / len];
  }
  const { w, h } = CAMP_FOOTPRINT;
  const reach = (hf.w + w) / 2 + 0.5;
  const want = { x: hx + dx * reach, y: hy + dy * reach };
  const spots: { x: number; y: number; d: number }[] = [];
  for (let y = house.y - 8; y <= house.y + 8; y++) {
    for (let x = house.x - 8; x <= house.x + 8; x++) {
      const d = Math.hypot(x + w / 2 - want.x, y + h / 2 - want.y) + (besidePath(state, x, y, w, h) ? 0 : 4);
      spots.push({ x, y, d });
    }
  }
  spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const footprintOf = (o: PlacedObject) => getBuildable(o.type)?.footprint ?? { w: 1, h: 1 };
  return spots.find((s) => canPlace(state, CAMP_FOOTPRINT, s.x, s.y, footprintOf, CAMP).ok) ?? null;
}

/** Sets up a new farm's camp with its supplies (also put into the inventory). Returns the camp, or null when it didn't fit. */
export function addCamp(state: GameState): PlacedObject<CampState> | null {
  const spot = campSpot(state);
  const camp = spot && (addStartingObject(state, CAMP, spot.x, spot.y) as PlacedObject<CampState> | null);
  if (!camp) return null;
  for (const [id, n] of Object.entries(CAMP_SUPPLIES)) if (n) state.inventory[id] = (state.inventory[id] ?? 0) + n;
  campSlice(state).id = camp.id;
  return camp;
}

onNewGame((state) => {
  addCamp(state);
});
