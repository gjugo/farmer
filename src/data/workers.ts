import { getBuildable } from './buildables';

/**
 * Farmers: the hands that do the farm work. A job keeps one farmer busy for a while
 * (game time); when every farmer is busy hand-ordered work is refused until one is free.
 * A farmer can be assigned to a workplace (a field, pen, processing or resource building) and then
 * does its work by themselves; with nothing to do there they build construction sites.
 */

/** A new farm starts with this many farmers: the family in the farmhouse. More move into cottages (`src/data/families.ts`). */
export const STARTING_FARMERS = 1;

/** The most farmers a farm can employ. */
export const MAX_FARMERS = 20;

export type JobKind = 'build' | 'plough' | 'plant' | 'harvest' | 'fertilise' | 'feed' | 'collect' | 'load' | 'chop' | 'quarry' | 'mine' | 'haul';

export const JOBS: Record<JobKind, { label: string; icon: string }> = {
  build: { label: 'Building', icon: '🔨' },
  plough: { label: 'Ploughing', icon: '🚜' },
  plant: { label: 'Planting', icon: '🌱' },
  harvest: { label: 'Harvesting', icon: '🧺' },
  fertilise: { label: 'Spreading manure', icon: '💩' },
  feed: { label: 'Feeding animals', icon: '🌰' },
  collect: { label: 'Collecting', icon: '🧺' },
  load: { label: 'Starting a batch', icon: '⚙️' },
  // Resource buildings: the work is one production cycle (see `src/data/resourceBuildings.ts`).
  chop: { label: 'Cutting wood', icon: '🪓' },
  quarry: { label: 'Quarrying stone', icon: '⛏️' },
  mine: { label: 'Mining iron', icon: '⚒️' },
  // An ox barn's carter: drives the oxcart from a yard to the stores (see `src/data/haul.ts`).
  haul: { label: 'Hauling', icon: '🐂' },
};

/** Game milliseconds a farmer is busy for each job (building: see `buildWorkMs`). */
export const PLOUGH_WORK_MS = 40_000;
export const PLANT_WORK_MS = 30_000;
export const HARVEST_WORK_MS = 40_000;
/** Spreading manure on a field (see `MANURE_PER_SPREAD`). */
export const FERTILISE_WORK_MS = 20_000;
export const FEED_WORK_MS = 20_000;
/**
 * Collecting eggs, milk or wool from a pen, finished goods from a processing building, or materials left waiting in a
 * resource building (assigned farmers only).
 */
export const COLLECT_WORK_MS = 20_000;
/** Carrying a recipe's inputs into a processing building to queue a batch (assigned farmers only). */
export const LOAD_WORK_MS = 20_000;

/** Building takes this long per footprint tile, within `BUILD_WORK_MIN_MS`..`BUILD_WORK_MAX_MS`. */
export const BUILD_WORK_PER_TILE_MS = 15_000;
export const BUILD_WORK_MIN_MS = 30_000;
export const BUILD_WORK_MAX_MS = 180_000;

/**
 * Buildables a player lays without a farmer: cheap 1×1 pieces drawn in long runs, and the house gardens (the family
 * lays out its own, see `src/data/gardens.ts`).
 */
export const NO_FARMER_BUILDABLES: readonly string[] = ['path', 'veg-patch', 'hen-run', 'orchard'];

/** How long building `type` keeps a farmer busy; 0 when it needs no farmer. */
export function buildWorkMs(type: string): number {
  if (NO_FARMER_BUILDABLES.includes(type)) return 0;
  const fp = getBuildable(type)?.footprint ?? { w: 1, h: 1 };
  return Math.min(BUILD_WORK_MAX_MS, Math.max(BUILD_WORK_MIN_MS, fp.w * fp.h * BUILD_WORK_PER_TILE_MS));
}
