import { registerBuildable } from './buildables';
import type { MaterialCost } from './materials';

/**
 * The farmhouse, built later like Manor Lords' manor: a new farm starts with only the camp, and the farmhouse is a big
 * building of its own from farm level 4 (one per farm, never demolished). Once it stands it is the village centre
 * (`villageCentre` in `src/logic/roads.ts`): idle farmers rest on its bench and set out from its door, walking along
 * paths to their work. It houses a family, adds its store and its approval.
 */

export const FARMHOUSE = 'farmhouse';

/** Paths are the buildable farmers walk on. */
export const PATH = 'path';

/** The tile in front of the farmhouse door, relative to the farmhouse's top-left tile. */
export const FARMHOUSE_DOOR = { x: 1, y: 2 } as const;

/** Game milliseconds a farmer takes to walk one tile. */
export const WALK_MS_PER_TILE = 400;

/** What the farmhouse costs, and the level it unlocks at. */
export const FARMHOUSE_COST = 400;
export const FARMHOUSE_MATERIALS: MaterialCost = { wood: 30, stone: 20, iron: 4 };
export const FARMHOUSE_LEVEL = 4;

/** Game ms of building work: about twice a cottage's (a 2×2 cottage takes 60 s). */
export const FARMHOUSE_BUILD_MS = 120_000;

/** Approval points while the farmhouse stands ("A farmhouse oversees the farm"). */
export const FARMHOUSE_APPROVAL = 10;

registerBuildable({
  id: FARMHOUSE,
  name: 'Farmhouse',
  cost: FARMHOUSE_COST,
  materials: FARMHOUSE_MATERIALS,
  footprint: { w: 2, h: 2 },
  texture: 'farmhouse',
  category: 'homes',
  icon: '🏠',
  unlockLevel: FARMHOUSE_LEVEL,
  unique: true,
  permanent: true,
  buildWorkMs: FARMHOUSE_BUILD_MS,
  description: 'The heart of the farm: farmers set out from its door and rest on its bench. Houses a family, stores 50 goods and 50 materials, +10 approval.',
});
