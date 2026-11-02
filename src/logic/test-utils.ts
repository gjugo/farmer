import { CAMP_SUPPLIES } from '../data/camp';
import { MATERIAL_IDS } from '../data/materials';
import { campOf } from './camp';
import { MAX_LEVEL } from '../data/progression';
import { ROAD_SLICE, type RoadState } from './mainroad';
import { MAP_SLICE, type MapLayer } from './maplayer';
import { PROGRESSION, type ProgressionState } from './progression';
import { getSlice } from './slices';
import { createNewGame } from './state';
import type { GameState } from './types';
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
 * did before the camp (the slice stays as an old save's: no camp).
 */
export function noCamp(state: GameState): GameState {
  const camp = campOf(state);
  if (!camp) return state;
  state.objects = state.objects.filter((o) => o !== camp);
  for (const [id, n] of Object.entries(CAMP_SUPPLIES)) {
    const left = (state.inventory[id] ?? 0) - (n ?? 0);
    if (left > 0) state.inventory[id] = left;
    else delete state.inventory[id];
  }
  return state;
}
