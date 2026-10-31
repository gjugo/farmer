import { inBounds, isOwned } from './land';
import type { GameState, PlacedObject } from './types';

export interface Footprint {
  w: number;
  h: number;
}

/** Why a spot is refused by a placement rule a feature registered (see `registerPlacementRule`). */
export type RuleReason = 'tree' | 'deposit' | 'needs-outcrop' | 'needs-vein';

export type PlacementResult = { ok: true } | { ok: false; reason: 'out-of-bounds' | 'locked' | 'occupied' | RuleReason };

/**
 * A rule beyond land and objects, e.g. trees and deposits on the map (`src/logic/maplayer.ts`): the reason the
 * footprint of `type` can't go at (x, y), or null when the rule allows it. `type` is missing when unknown.
 */
export type PlacementRule = (state: GameState, fp: Footprint, x: number, y: number, type: string | undefined) => RuleReason | null;

const rules: PlacementRule[] = [];

export function registerPlacementRule(rule: PlacementRule): void {
  rules.push(rule);
}

/** The first registered rule refusing the spot, or null. Ignores land and objects (see `canPlace`). */
export function ruleBlock(state: GameState, fp: Footprint, x: number, y: number, type?: string): RuleReason | null {
  for (const rule of rules) {
    const reason = rule(state, fp, x, y, type);
    if (reason) return reason;
  }
  return null;
}

/** Returns the size of a placed object's footprint. */
export type FootprintOf = (obj: PlacedObject) => Footprint;

export function covers(obj: PlacedObject, fp: Footprint, x: number, y: number): boolean {
  return x >= obj.x && y >= obj.y && x < obj.x + fp.w && y < obj.y + fp.h;
}

export function objectAt(state: GameState, x: number, y: number, footprintOf: FootprintOf): PlacedObject | undefined {
  return state.objects.find((o) => covers(o, footprintOf(o), x, y));
}

/** A footprint can be placed when every tile is inside the map, owned and free, and no placement rule refuses it. */
export function canPlace(
  state: GameState,
  fp: Footprint,
  x: number,
  y: number,
  footprintOf: FootprintOf,
  type?: string,
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
  if (overlaps) return { ok: false, reason: 'occupied' };
  const reason = ruleBlock(state, fp, x, y, type);
  return reason ? { ok: false, reason } : { ok: true };
}
