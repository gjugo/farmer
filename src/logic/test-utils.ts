import { MAX_LEVEL } from '../data/progression';
import { PROGRESSION, type ProgressionState } from './progression';
import { getSlice } from './slices';
import { createNewGame } from './state';
import type { GameState } from './types';
import { xpForLevel } from './unlocks';

/** A new game at the top level, so tests can use any crop, animal or building without level-up bonuses. */
export function maxLevelState(): GameState {
  const state = createNewGame();
  getSlice<ProgressionState>(state, PROGRESSION).xp = xpForLevel(MAX_LEVEL);
  return state;
}
