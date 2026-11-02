import { getBuildable } from '../data/buildables';
import { createClock } from './clock';
import { MAP_HEIGHT, MAP_WIDTH, STARTING_MONEY } from './constants';
import { createLand } from './land';
import { canPlace } from './placement';
import { applySliceDefaults } from './slices';
import type { GameState, PlacedObject } from './types';

/** Fills a brand-new farm, e.g. with starting fields. Not run for loaded saves. */
export type NewGameSetup = (state: GameState) => void;

const setups: { setup: NewGameSetup; late: boolean }[] = [];

/**
 * Registers starting content for new games. Features call this from their own module, so setups run in import order;
 * a `late` setup runs after all the others (the farmhouse lays its roads to what they placed, whatever the order).
 */
export function onNewGame(setup: NewGameSetup, { late = false }: { late?: boolean } = {}): void {
  setups.push({ setup, late });
}

export function createNewGame(): GameState {
  const ext: Record<string, unknown> = {};
  applySliceDefaults(ext);
  const state: GameState = {
    money: STARTING_MONEY,
    inventory: {},
    land: createLand(MAP_WIDTH, MAP_HEIGHT),
    objects: [],
    nextObjectId: 1,
    clock: createClock(),
    ext,
  };
  for (const late of [false, true]) for (const s of setups) if (s.late === late) s.setup(state);
  return state;
}

/**
 * Places a buildable for free, for new-game setups. Returns null (and changes
 * nothing) when the type is unknown or the spot is not free.
 */
export function addStartingObject(state: GameState, type: string, x: number, y: number): PlacedObject | null {
  const def = getBuildable(type);
  if (!def) return null;
  const footprintOf = (o: PlacedObject) => getBuildable(o.type)?.footprint ?? { w: 1, h: 1 };
  if (!canPlace(state, def.footprint, x, y, footprintOf, type).ok) return null;
  const object: PlacedObject = { id: `o${state.nextObjectId++}`, type, x, y, state: def.initialState?.({ x, y, now: state.clock.elapsed }) ?? {} };
  state.objects.push(object);
  return object;
}
