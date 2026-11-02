import { registerBuildable } from './buildables';
import type { MaterialCost } from './materials';
import { FARMHOUSE_HOMES } from './families';
import { FARMHOUSE_STORE, type StoragePool } from './storage';

/**
 * The farmhouse, built later like Manor Lords' manor: a new farm starts with only the camp, and the farmhouse is a big
 * building of its own from farm level 4 (one per farm, never demolished). Once it stands it is the village centre
 * (`villageCentre` in `src/logic/roads.ts`): idle farmers rest on its bench and set out from its door, walking along
 * paths to their work. It houses a family, adds its store and its approval. A 3×3 house, bigger than every other
 * building, it goes up two levels like a cottage (`FARMHOUSE_DEF.levels`, the upgrade in `src/logic/upgrades.ts`):
 * the manor house, then the manor hall, each housing more families, storing more and adding more approval.
 */

export const FARMHOUSE = 'farmhouse';

/** Paths are the buildable farmers walk on. */
export const PATH = 'path';

/** The farmhouse's footprint at every level: each level grows in height and detail on the same plot. */
export const FARMHOUSE_FOOTPRINT = { w: 3, h: 3 } as const;

/** The tile in front of the farmhouse door (the middle of its front-left, +y face), relative to its top-left tile. */
export const FARMHOUSE_DOOR = { x: 1, y: 3 } as const;

/** Game milliseconds a farmer takes to walk one tile. */
export const WALK_MS_PER_TILE = 400;

/** What the farmhouse costs, and the level it unlocks at. */
export const FARMHOUSE_COST = 400;
export const FARMHOUSE_MATERIALS: MaterialCost = { wood: 30, stone: 20, iron: 4 };
export const FARMHOUSE_LEVEL = 4;

/** Game ms of building work: about twice a cottage's (a 2×2 cottage takes 60 s). */
export const FARMHOUSE_BUILD_MS = 120_000;

export interface FarmhouseLevel {
  /** Its name at this level. */
  name: string;
  /** Families it houses. */
  room: number;
  /** What it stores in each pool. */
  store: Readonly<Record<StoragePool, number>>;
  /** Approval points while it stands ("A farmhouse oversees the farm"). */
  approval: number;
  /**
   * What going up to this level asks (missing for level 1, which is the build): the farm's level, at least `families`
   * families, approval of at least `approval`%, a winter's firewood left after the upgrade's wood, and the cost.
   */
  upgrade?: { cost: number; materials: MaterialCost; farmLevel: number; families: number; approval: number };
}

export const FARMHOUSE_DEF = {
  /** Level 1 first; the highest level is the last. It never goes down a level. */
  levels: [
    { name: 'Farmhouse', room: FARMHOUSE_HOMES, store: FARMHOUSE_STORE, approval: 10 },
    {
      name: 'Manor house',
      room: 2,
      store: { goods: 100, materials: 100 },
      approval: 15,
      upgrade: { cost: 700, materials: { wood: 40, stone: 30, iron: 8 }, farmLevel: 6, families: 6, approval: 50 },
    },
    {
      name: 'Manor hall',
      room: 3,
      store: { goods: 150, materials: 150 },
      approval: 20,
      upgrade: { cost: 1200, materials: { wood: 60, stone: 50, iron: 15 }, farmLevel: 8, families: 10, approval: 60 },
    },
  ] as readonly FarmhouseLevel[],
} as const;

export const MAX_FARMHOUSE_LEVEL = FARMHOUSE_DEF.levels.length;

/** Approval points of a level 1 farmhouse ("A farmhouse oversees the farm"); `FARMHOUSE_DEF.levels` has each level's. */
export const FARMHOUSE_APPROVAL = FARMHOUSE_DEF.levels[0].approval;

registerBuildable({
  id: FARMHOUSE,
  name: 'Farmhouse',
  cost: FARMHOUSE_COST,
  materials: FARMHOUSE_MATERIALS,
  footprint: FARMHOUSE_FOOTPRINT,
  texture: 'farmhouse',
  category: 'homes',
  icon: '🏠',
  unlockLevel: FARMHOUSE_LEVEL,
  unique: true,
  permanent: true,
  buildWorkMs: FARMHOUSE_BUILD_MS,
  description:
    'The heart of the farm: farmers set out from its door and rest on its bench. Houses a family, stores 50 goods and 50 materials, +10 approval. Grows into a manor house and a manor hall.',
  initialState: () => ({ level: 1 }),
});
