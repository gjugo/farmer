import { hash } from '../scenes/noise';
import { MAP_HEIGHT, MAP_WIDTH, START_LAND } from './constants';
import { depositAt, mapOf, treeAt, type MapLayer } from './maplayer';
import { registerPlacementRule } from './placement';

/**
 * Scenery out in the wild, scattered from a fixed seed (nothing saved): bushes, and small ponds with a willow or two
 * beside each (drawn by FarmScene). It keeps clear of the starting land, so a seed's scenery never moves.
 *
 * - A bush is only a look: building over it is fine, and it stops showing.
 * - A pond is in the way: nothing is built on it (`pond` placement reason).
 */

/** The bushes. Trees and rocks are real: see `src/logic/maplayer.ts`. */
export const SCENERY = ['bush', 'bush_berry'] as const;
/** A small pond; scattered apart from the other scenery. */
export const POND = 'pond';
/** Share of tiles that get a bush, and (of the rest) per mille that get a pond. */
export const SCENERY_CHANCE = 0.02;
export const POND_PER_MILLE = 5;

/** The scenery a tile would carry away from the starting land, from a fixed seed: null for none. */
export function sceneryArt(x: number, y: number): string | null {
  if ((hash(x, y, 7) % 1000) / 1000 < SCENERY_CHANCE) return SCENERY[hash(x, y, 11) % SCENERY.length];
  return hash(x, y, 13) % 1000 < POND_PER_MILLE ? POND : null;
}

/** Scenery keeps this many tiles clear of the starting land. */
export const SCENERY_CLEARANCE = 4;

/** Can scenery (a bush, a pond or a pond's willow) stand on (x, y): in the map, clear of the starting land, trees and deposits? */
export function sceneryClear(layer: MapLayer, x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return false;
  if (treeAt(layer, x, y) || depositAt(layer, x, y)) return false;
  const S = START_LAND;
  const c = SCENERY_CLEARANCE;
  return x < S.x - c || y < S.y - c || x >= S.x + S.w + c || y >= S.y + S.h + c;
}

/** Is there a pond on (x, y)? */
export function pondShows(layer: MapLayer, x: number, y: number): boolean {
  return sceneryArt(x, y) === POND && sceneryClear(layer, x, y);
}

registerPlacementRule((state, fp, x, y) => {
  const layer = mapOf(state);
  for (let ty = y; ty < y + fp.h; ty++) for (let tx = x; tx < x + fp.w; tx++) if (pondShows(layer, tx, ty)) return 'pond';
  return null;
});
