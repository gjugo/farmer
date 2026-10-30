import { getBuildable } from './buildables';

/**
 * Farmers: the hands that do the farm work. A job keeps one farmer busy for a while
 * (game time); when every farmer is busy the work is refused until one is free.
 */

/** A new farm starts with this many farmers. */
export const STARTING_FARMERS = 1;

/** The most farmers a farm can employ. */
export const MAX_FARMERS = 8;

/** Hiring the 2nd farmer costs this; every further hire costs `HIRE_COST_GROWTH` times the last. */
export const BASE_HIRE_COST = 250;
export const HIRE_COST_GROWTH = 1.6;

export type JobKind = 'build' | 'plant' | 'harvest' | 'feed';

export const JOBS: Record<JobKind, { label: string; icon: string }> = {
  build: { label: 'Building', icon: '🔨' },
  plant: { label: 'Planting', icon: '🌱' },
  harvest: { label: 'Harvesting', icon: '🧺' },
  feed: { label: 'Feeding animals', icon: '🌰' },
};

/** Game milliseconds a farmer is busy for each job (building: see `buildWorkMs`). */
export const PLANT_WORK_MS = 4_000;
export const HARVEST_WORK_MS = 3_000;
export const FEED_WORK_MS = 4_000;

/** Building takes this long per footprint tile, within `BUILD_WORK_MIN_MS`..`BUILD_WORK_MAX_MS`. */
export const BUILD_WORK_PER_TILE_MS = 1_500;
export const BUILD_WORK_MIN_MS = 3_000;
export const BUILD_WORK_MAX_MS = 20_000;

/** Buildables a player lays without a farmer (cheap 1×1 pieces drawn in long runs). */
export const NO_FARMER_BUILDABLES: readonly string[] = ['path'];

/** How long building `type` keeps a farmer busy; 0 when it needs no farmer. */
export function buildWorkMs(type: string): number {
  if (NO_FARMER_BUILDABLES.includes(type)) return 0;
  const fp = getBuildable(type)?.footprint ?? { w: 1, h: 1 };
  return Math.min(BUILD_WORK_MAX_MS, Math.max(BUILD_WORK_MIN_MS, fp.w * fp.h * BUILD_WORK_PER_TILE_MS));
}
