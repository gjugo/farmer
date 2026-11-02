import { getBuildable } from '../data/buildables';
import { CAMP, CAMP_FOOTPRINT, CAMP_SUPPLIES } from '../data/camp';
import { FIELD } from '../data/crops';
import { FARMHOUSE, PATH } from '../data/farmhouse';
import { MATERIAL_IDS } from '../data/materials';
import { MIN_FARMERS } from '../data/workers';
import { campFront, campOf, campSlice, type CampState } from './camp';
import { MAX_LEVEL } from '../data/progression';
import { STARTING_FIELDS, type FieldState } from './crops';
import { ROAD_SLICE, type RoadState } from './mainroad';
import { MAP_SLICE, type MapLayer } from './maplayer';
import { canPlace } from './placement';
import { PROGRESSION, type ProgressionState } from './progression';
import { ensureFarmhouse, farmhouseOf } from './roads';
import { getSlice } from './slices';
import { addStartingObject, createNewGame, onNewGame } from './state';
import type { GameState, PlacedObject } from './types';
import { xpForLevel } from './unlocks';

/**
 * A new game at the top level with a store of building materials, a bare map (see `bareMap`) and no starting camp
 * (see `noCamp`), so tests can use any crop, animal or building anywhere, without level-up bonuses or trips to the
 * Market, and count the stock they put in.
 */
export function maxLevelState(): GameState {
  const state = noCamp(bareMap(createNewGame()));
  getSlice<ProgressionState>(state, PROGRESSION).xp = xpForLevel(MAX_LEVEL);
  stockMaterials(state);
  return state;
}

/** Adds `qty` of every building material to the inventory. */
export function stockMaterials(state: GameState, qty = 1000): GameState {
  for (const id of MATERIAL_IDS) state.inventory[id] = (state.inventory[id] ?? 0) + qty;
  return state;
}

/** Saves up to version 6 had a 32×24 map with the 10×8 starting land at (11, 8). Old-save fixtures use these coordinates. */
export const V6_START = { x: 11, y: 8, w: 10, h: 8 } as const;

/** The owned land of a new version-6 farm, as such a save holds it. */
export function v6Land(): { width: number; height: number; owned: number[] } {
  const owned = new Array<number>(32 * 24).fill(0);
  for (let y = V6_START.y; y < V6_START.y + V6_START.h; y++) for (let x = V6_START.x; x < V6_START.x + V6_START.w; x++) owned[y * 32 + x] = 1;
  return { width: 32, height: 24, owned };
}

/** Where a tile of a version-6 save lies once loaded: the old farm moved into the middle of the bigger map. */
export function fromV6(x: number, y: number): { x: number; y: number } {
  return { x: x + 13, y: y + 10 };
}

/**
 * Takes the trees and deposits off the map (`src/logic/maplayer.ts`) and the main road (`src/logic/mainroad.ts`), so
 * tests can build at fixed spots: a new game's grove and outcrop stand on the starting land, and its road (random per
 * farm) near an edge. Map and road tests lay out their own.
 */
export function bareMap(state: GameState): GameState {
  const layer: MapLayer = { trees: [], deposits: [] };
  state.ext[MAP_SLICE] = layer;
  const road: RoadState = { seed: 1, side: null, tiles: [], pending: false };
  state.ext[ROAD_SLICE] = road;
  return state;
}

/**
 * Takes the starting camp (`src/logic/camp.ts`) and its supplies away, so a test starts from an empty store as farms
 * did before the camp (the slice stays as an old save's: no camp). Its families go too, but one: farms before the camp
 * started with one farmer.
 */
export function noCamp(state: GameState): GameState {
  const camp = campOf(state);
  if (!camp) return state;
  state.objects = state.objects.filter((o) => o !== camp);
  const s = campSlice(state);
  s.id = null;
  s.families = 0;
  getSlice<{ farmers: number }>(state, 'workers').farmers = MIN_FARMERS;
  for (const [id, n] of Object.entries(CAMP_SUPPLIES)) {
    const left = (state.inventory[id] ?? 0) - (n ?? 0);
    if (left > 0) state.inventory[id] = left;
    else delete state.inventory[id];
  }
  return state;
}

// The classic start -------------------------------------------------------------------------

/**
 * Most rule tests were written for the farm a new game used to be: a built farmhouse with its family, two ploughed
 * starting fields and a road from the door to them, and the camp (with no families in its tent) beside the farmhouse.
 * In tests a new game is laid out like that (`classicFarm`), so they keep testing their rules on that farm; tests of the
 * new start (only the camp, two families in the tent) turn it off with `useClassicStart(false)` (and back on after).
 */
let classicStart = true;

export function useClassicStart(on: boolean): void {
  classicStart = on;
}

/** Where the classic camp went: beside the farmhouse, by a path, on the side away from the starting fields. */
function classicCampSpot(state: GameState): { x: number; y: number } | null {
  const house = farmhouseOf(state);
  if (!house) return null;
  const hf = getBuildable(FARMHOUSE)!.footprint;
  const hx = house.x + hf.w / 2;
  const hy = house.y + hf.h / 2;
  const paths = new Set(state.objects.filter((o) => o.type === PATH).map((o) => `${o.x},${o.y}`));
  const besidePath = (x: number, y: number, w: number, h: number) => {
    for (let tx = x; tx < x + w; tx++) if (paths.has(`${tx},${y - 1}`) || paths.has(`${tx},${y + h}`)) return true;
    for (let ty = y; ty < y + h; ty++) if (paths.has(`${x - 1},${ty}`) || paths.has(`${x + w},${ty}`)) return true;
    return false;
  };
  const others = state.objects.filter((o) => o.type !== PATH && o.type !== FARMHOUSE);
  const centre = (o: PlacedObject) => {
    const fp = getBuildable(o.type)?.footprint ?? { w: 1, h: 1 };
    return { x: o.x + fp.w / 2, y: o.y + fp.h / 2 };
  };
  let [dx, dy] = [1, 0];
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
    for (let x = house.x - 8; x <= house.x + 8; x++) spots.push({ x, y, d: Math.hypot(x + w / 2 - want.x, y + h / 2 - want.y) + (besidePath(x, y, w, h) ? 0 : 4) });
  }
  spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const footprintOf = (o: PlacedObject) => getBuildable(o.type)?.footprint ?? { w: 1, h: 1 };
  return spots.find((s) => canPlace(state, CAMP_FOOTPRINT, s.x, s.y, footprintOf, CAMP).ok) ?? null;
}

/**
 * Lays a new game out as the classic start (see `useClassicStart`): the camp and its front path make way for two
 * ploughed starting fields and the farmhouse with its road; the camp, with its supplies but no families, goes back up
 * beside the farmhouse; one farmer, the farmhouse's family.
 */
export function classicFarm(state: GameState): GameState {
  const camp = campOf(state);
  if (camp) {
    const front = campFront(camp);
    state.objects = state.objects.filter((o) => o !== camp && !(o.type === PATH && o.x === front.x && o.y === front.y));
  }
  for (const { x, y } of STARTING_FIELDS) {
    const field = addStartingObject(state, FIELD, x, y);
    if (field) (field.state as FieldState).ploughedAt = state.clock.elapsed;
  }
  ensureFarmhouse(state);
  const s = campSlice(state);
  s.families = 0;
  s.id = null;
  if (camp) {
    const spot = classicCampSpot(state);
    const back = spot && (addStartingObject(state, CAMP, spot.x, spot.y) as PlacedObject<CampState> | null);
    if (back) {
      back.state.left = { ...camp.state.left };
      s.id = back.id;
    } else {
      // No room: the supplies go with it.
      for (const [id, n] of Object.entries(CAMP_SUPPLIES)) state.inventory[id] = Math.max(0, (state.inventory[id] ?? 0) - (n ?? 0));
    }
  }
  getSlice<{ farmers: number }>(state, 'workers').farmers = MIN_FARMERS;
  return state;
}

onNewGame(
  (state) => {
    if (classicStart) classicFarm(state);
  },
  { late: true },
);
