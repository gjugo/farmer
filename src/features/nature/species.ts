import { blockAt, onStartLand, treeAt, type MapLayer } from '../../logic/maplayer';
import { nearPond, treeSpecies, woodMix, type TreeSite, type TreeSpecies } from '../../scenes/art';

/**
 * Which species each tree of the map is, worked out from where it stands (see `treeSpecies` in src/scenes/art.ts):
 * its layout block's wood mix, whether it is at the forest's edge, on the starting land, or near a pond
 * (`pondShows`, as FarmScene draws it). Nothing saved.
 */

/** Fewer tree neighbours (of 8) than this puts a tree at the forest's edge. */
export const EDGE_NEIGHBOURS = 6;

export function treeSite(layer: MapLayer, x: number, y: number): TreeSite {
  let neighbours = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && treeAt(layer, x + dx, y + dy)) neighbours++;
  return {
    x,
    y,
    mix: woodMix(blockAt(x, y), x, y),
    edge: neighbours < EDGE_NEIGHBOURS,
    start: onStartLand(x, y),
    pond: nearPond(layer, x, y),
  };
}

export function speciesAt(layer: MapLayer, x: number, y: number): TreeSpecies {
  return treeSpecies(treeSite(layer, x, y));
}
