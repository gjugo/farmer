import { inBounds, isOwned } from './land';
import type { GameState, PlacedObject } from './types';

export interface Footprint {
  w: number;
  h: number;
}

export type PlacementResult = { ok: true } | { ok: false; reason: 'out-of-bounds' | 'locked' | 'occupied' };

/** Returns the size of a placed object's footprint. */
export type FootprintOf = (obj: PlacedObject) => Footprint;

export function covers(obj: PlacedObject, fp: Footprint, x: number, y: number): boolean {
  return x >= obj.x && y >= obj.y && x < obj.x + fp.w && y < obj.y + fp.h;
}

export function objectAt(state: GameState, x: number, y: number, footprintOf: FootprintOf): PlacedObject | undefined {
  return state.objects.find((o) => covers(o, footprintOf(o), x, y));
}

/** A footprint can be placed when every tile is inside the map, owned and free. */
export function canPlace(
  state: GameState,
  fp: Footprint,
  x: number,
  y: number,
  footprintOf: FootprintOf,
): PlacementResult {
  for (let ty = y; ty < y + fp.h; ty++) {
    for (let tx = x; tx < x + fp.w; tx++) {
      if (!inBounds(state.land, tx, ty)) return { ok: false, reason: 'out-of-bounds' };
      if (!isOwned(state.land, tx, ty)) return { ok: false, reason: 'locked' };
    }
  }
  const overlaps = state.objects.some((o) => {
    const ofp = footprintOf(o);
    return o.x < x + fp.w && x < o.x + ofp.w && o.y < y + fp.h && y < o.y + ofp.h;
  });
  return overlaps ? { ok: false, reason: 'occupied' } : { ok: true };
}
