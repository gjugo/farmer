import { registerBuildable } from './buildables';

/**
 * The farmhouse: every farm has one. Idle farmers rest on its bench and set out from its
 * door, walking along paths to their work.
 */

export const FARMHOUSE = 'farmhouse';

/** Paths are the buildable farmers walk on. */
export const PATH = 'path';

/** The tile in front of the farmhouse door, relative to the farmhouse's top-left tile. */
export const FARMHOUSE_DOOR = { x: 1, y: 2 } as const;

/** Game milliseconds a farmer takes to walk one tile. */
export const WALK_MS_PER_TILE = 400;

registerBuildable({
  id: FARMHOUSE,
  name: 'Farmhouse',
  cost: 0,
  footprint: { w: 2, h: 2 },
  texture: 'farmhouse',
  icon: '🏠',
  unlockLevel: 1,
  fixed: true,
  description: 'Home of your farmers. They rest on the bench and walk out along the paths to work.',
});
