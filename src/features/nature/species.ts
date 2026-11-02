import { START_LAND } from '../../logic/constants';
import { treeAt, type MapLayer } from '../../logic/maplayer';
import { FARM_PARCELS, parcelAt } from '../../logic/parcels';
import { nearPond, treeSpecies, woodMix, type TreeSite, type TreeSpecies } from '../../scenes/art';

/**
 * Which species each tree of the map is, worked out from where it stands (see `treeSpecies` in src/scenes/art.ts):
 * the parcel's wood mix, whether it is at the forest's edge, on the starting land, or near a pond. Nothing saved.
 */

/** Fewer tree neighbours (of 8) than this puts a tree at the forest's edge. */
export const EDGE_NEIGHBOURS = 6;

export function treeSite(layer: MapLayer, x: number, y: number): TreeSite {
  let neighbours = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && treeAt(layer, x + dx, y + dy)) neighbours++;
  const S = START_LAND;
  return {
    x,
    y,
    mix: woodMix(parcelAt(FARM_PARCELS, x, y), x, y),
    edge: neighbours < EDGE_NEIGHBOURS,
    start: x >= S.x && x < S.x + S.w && y >= S.y && y < S.y + S.h,
    pond: nearPond(x, y),
  };
}

export function speciesAt(layer: MapLayer, x: number, y: number): TreeSpecies {
  return treeSpecies(treeSite(layer, x, y));
}
