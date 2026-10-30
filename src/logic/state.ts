import { createClock } from './clock';
import { MAP_HEIGHT, MAP_WIDTH, START_LAND, STARTING_MONEY } from './constants';
import { createLand } from './land';
import { applySliceDefaults } from './slices';
import type { GameState } from './types';

export function createNewGame(): GameState {
  const ext: Record<string, unknown> = {};
  applySliceDefaults(ext);
  return {
    money: STARTING_MONEY,
    inventory: {},
    land: createLand(MAP_WIDTH, MAP_HEIGHT, START_LAND),
    objects: [],
    nextObjectId: 1,
    clock: createClock(),
    ext,
  };
}
