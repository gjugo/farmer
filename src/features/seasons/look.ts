import type { Season } from '../../data/seasons';

/**
 * How each season looks beyond its art: the camera's colour grade and background, and its weather. Plain data
 * and arithmetic (no Phaser) so it can be unit-tested.
 */

/** A 4×5 colour matrix (Phaser's ColorMatrix layout, offsets in 0–255). */
export type Grade = readonly number[];

const IDENTITY: Grade = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

/** Scales red, green and blue and adds an offset to each. */
function tint(r: number, g: number, b: number, offset: [number, number, number] = [0, 0, 0]): Grade {
  return [r, 0, 0, 0, offset[0], 0, g, 0, 0, offset[1], 0, 0, b, 0, offset[2], 0, 0, 0, 1, 0];
}

export interface SeasonLook {
  /** Camera colour grade; null for none (spring is drawn as the art is). */
  grade: Grade | null;
  /** Camera background, around the map. */
  background: string;
}

/** Subtle: the art carries the season, the grade only warms or cools it. */
export const SEASON_LOOK: Record<Season, SeasonLook> = {
  spring: { grade: null, background: '#2f4a2a' },
  summer: { grade: tint(1.04, 1.01, 0.93), background: '#2c4524' },
  autumn: { grade: tint(1.08, 0.99, 0.84, [6, 2, 0]), background: '#4a3f22' },
  winter: { grade: tint(0.97, 0.99, 1.03, [0, 0, 3]), background: '#a9b7c3' },
};

export function isIdentity(grade: Grade): boolean {
  return grade.every((v, i) => v === IDENTITY[i]);
}

// Weather ------------------------------------------------------------------------

/** Hard cap on live weather particles. */
export const WEATHER_CAP = 150;
/** Particles per megapixel of view at zoom 1, per season (summer is clear). */
export const WEATHER_DENSITY: Record<Season, number> = { spring: 20, summer: 0, autumn: 35, winter: 130 };
/** Small screens count as this many megapixels, so a phone still gets a proper snowfall. */
const MIN_MEGAPIXELS = 0.6;
/** Zoomed out the weather thins down to this share at most. */
const MIN_ZOOM_SHARE = 0.35;

/**
 * How many weather particles to keep alive for a `width` × `height` px view at camera `zoom`: thinned when zoomed
 * out, never over WEATHER_CAP, none when weather effects are off.
 */
export function weatherBudget(season: Season, width: number, height: number, zoom: number, enabled: boolean): number {
  if (!enabled) return 0;
  const mp = Math.max(MIN_MEGAPIXELS, (Math.max(0, width) * Math.max(0, height)) / 1e6);
  const share = Math.min(1, Math.max(MIN_ZOOM_SHARE, zoom));
  return Math.min(WEATHER_CAP, Math.round(WEATHER_DENSITY[season] * mp * share));
}

/** Game time jumps bigger than this (debug "Next season", catch-up after time away) change the look at once. */
export const JUMP_MS = 60_000;
/** A season that comes round while playing crossfades in over this long. */
export const CROSSFADE_MS = 1500;

/** Whether a season change between two game times is the clock running on (crossfade) rather than a jump. */
export function isNaturalChange(fromElapsed: number, toElapsed: number): boolean {
  const step = toElapsed - fromElapsed;
  return step >= 0 && step <= JUMP_MS;
}
