import { MATERIAL_IDS } from '../data/materials';
import { MAX_LEVEL } from '../data/progression';
import { PROGRESSION, type ProgressionState } from './progression';
import { getSlice } from './slices';
import { createNewGame } from './state';
import type { GameState } from './types';
import { xpForLevel } from './unlocks';

/**
 * A new game at the top level with a store of building materials, so tests can use any crop, animal or
 * building without level-up bonuses or trips to the Market.
 */
export function maxLevelState(): GameState {
  const state = createNewGame();
  getSlice<ProgressionState>(state, PROGRESSION).xp = xpForLevel(MAX_LEVEL);
  stockMaterials(state);
  return state;
}

/** Adds `qty` of every building material to the inventory. */
export function stockMaterials(state: GameState, qty = 1000): GameState {
  for (const id of MATERIAL_IDS) state.inventory[id] = (state.inventory[id] ?? 0) + qty;
  return state;
}
