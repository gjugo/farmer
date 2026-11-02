import { MAP_HEIGHT, MAP_WIDTH, START_LAND } from '../../logic/constants';
import { createLand } from '../../logic/land';
import { treeAt, type MapLayer } from '../../logic/maplayer';
import { FARM_PARCELS, parcelAt } from '../../logic/parcels';
import { nearPond, treeSpecies, woodMix, type TreeSite, type TreeSpecies } from '../../scenes/art';

/**
 * Which species each tree of the map is, worked out from where it stands (see `treeSpecies` in src/scenes/art.ts):
 * the parcel's wood mix, whether it is at the forest's edge, on the starting land, or near a pond (one that
 * shows one on the new farm: `pondShows` with the starting land owned, as FarmScene draws it). Nothing saved. Willows by a
 * pond whose land is bought later stay, as trees do.
 */

/** The land owned on a new farm: ponds it hides grow no willows. */
const START_OWNED = createLand(MAP_WIDTH, MAP_HEIGHT, START_LAND);

/** Fewer tree neighbours (of 8) than this puts a tree at the forest's edge. */
export const EDGE_NEIGHBOURS = 6;

export function treeSite(layer: MapLayer, x: number, y: number): TreeSite {
  let neighbours = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && treeAt(layer, x + dx, y + dy)) neighbours++;
  const S = START_LAND;
  const onStart = (tx: number, ty: number) => tx >= S.x && tx < S.x + S.w && ty >= S.y && ty < S.y + S.h;
  return {
    x,
    y,
    mix: woodMix(parcelAt(FARM_PARCELS, x, y), x, y),
    edge: neighbours < EDGE_NEIGHBOURS,
    start: onStart(x, y),
    pond: nearPond(START_OWNED, layer, x, y),
  };
}

export function speciesAt(layer: MapLayer, x: number, y: number): TreeSpecies {
  return treeSpecies(treeSite(layer, x, y));
}
