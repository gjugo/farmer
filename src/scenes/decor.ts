/**
 * Ground decorations: tufts, stones and the season's flowers, mushrooms, leaves or twigs over the grass, and
 * undergrowth (ferns, fallen logs, bushes) along the forests' edges. Purely decorative: scattered from a fixed seed
 * (not saved), never blocking anything, hidden under whatever is built on a tile. Plain TypeScript (no Phaser) so the
 * scatter can be unit-tested; `src/features/decor` draws it.
 *
 * Where a decoration lies doesn't change with the season; what it is does. A spot has a role: a tuft or stones
 * (all year, in each season's look), a seasonal feature (spring flowers, summer tall grass, autumn mushrooms...) or
 * undergrowth. The meadow is clustered by a coarse-cell hash: every 4 × 4 cell is flowery, stony or plain.
 */

import type { Season } from '../data/seasons';
import { FERN_ART, hash, LOG_ART, SCENERY, SEASON_DECOR, STONE_ART, TUFT_ART } from './art';

/** Seed of the scatter: the same farm always looks the same. */
export const DECOR_SEED = 96;
/** Most decorations on a map (the 64 × 48 map gets about 900). */
export const DECOR_CAP = 1200;
/** Side of the coarse cells that make the meadow clustered. */
export const DECOR_CELL = 4;
/** How far from a decoration's tile centre it may lie, in tiles, so the scatter doesn't look like a grid. */
export const DECOR_JITTER = 0.22;

export type CellKind = 'flowery' | 'stony' | 'plain';
export type DecorRole = 'tuft' | 'stone' | 'feature' | 'undergrowth';

/** Share of meadow tiles that get a decoration, by the kind of cell they are in (about 1 in 4 overall). */
export const MEADOW_CHANCE: Record<CellKind, number> = { flowery: 0.45, stony: 0.35, plain: 0.1 };
/** Share of free tiles next to a forest (1 tile out) and 2 tiles out that get undergrowth. */
export const EDGE_CHANCE = [0, 0.6, 0.3] as const;
/** A free tile with this many trees of its 8 neighbours is inside the forest, not on its edge: nothing grows there. */
export const INSIDE_FOREST = 6;

export interface DecorSpot {
  x: number;
  y: number;
  role: DecorRole;
  /** A hash of the tile: picks the art. */
  pick: number;
  /** The flowery cell's own feature (index into the season's list), so a cell is mostly one kind of flower. */
  cellPick: number;
  /** Offset from the tile's centre, in tiles. */
  dx: number;
  dy: number;
}

/** What the scatter needs to know of the map. */
export interface DecorGround {
  width: number;
  height: number;
  /** A tree (grown or a stump) stands here: the forest. */
  tree(x: number, y: number): boolean;
  /** Nothing ever grows here (deposits, the wild's bushes and ponds). */
  blocked(x: number, y: number): boolean;
}

/** The kind of the coarse cell at cell coordinates (cx, cy). */
export function cellKind(cx: number, cy: number, seed = DECOR_SEED): CellKind {
  const h = hash(cx, cy, seed + 1) % 100;
  return h < 35 ? 'flowery' : h < 50 ? 'stony' : 'plain';
}

/**
 * How far tile (x, y) is from the forest: 1 or 2 when a tree stands that close (8-way), 0 when the tile is inside
 * the forest (a tree itself, or most of its neighbours are trees), null in the open.
 */
export function forestDistance(ground: DecorGround, x: number, y: number): 0 | 1 | 2 | null {
  if (ground.tree(x, y)) return 0;
  let near = 0;
  let best: 1 | 2 | null = null;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if ((dx === 0 && dy === 0) || !ground.tree(x + dx, y + dy)) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy)) as 1 | 2;
      if (d === 1) near++;
      if (best === null || d < best) best = d;
    }
  }
  return near >= INSIDE_FOREST ? 0 : best;
}

const unit = (h: number) => (h % 10007) / 10007;

/**
 * The decorations of a map, back to front (by x + y). Deterministic: the same ground always gives the same spots.
 * Never on a tree's tile or a blocked one; undergrowth only 1–2 tiles outside a forest, the meadow elsewhere. At
 * most `DECOR_CAP`: past it the undergrowth stays and the meadow is thinned evenly.
 */
export function scatterDecor(ground: DecorGround, seed = DECOR_SEED): DecorSpot[] {
  const edge: DecorSpot[] = [];
  const meadow: DecorSpot[] = [];
  for (let y = 0; y < ground.height; y++) {
    for (let x = 0; x < ground.width; x++) {
      if (ground.blocked(x, y)) continue;
      const dist = forestDistance(ground, x, y);
      if (dist === 0) continue;
      const roll = unit(hash(x, y, seed));
      const pick = hash(x, y, seed + 2);
      const jitter = (s: number) => (unit(hash(x, y, seed + s)) * 2 - 1) * DECOR_JITTER;
      const spot = (role: DecorRole, cellPick = 0): DecorSpot => ({ x, y, role, pick, cellPick, dx: jitter(3), dy: jitter(4) });
      if (dist !== null) {
        if (roll < EDGE_CHANCE[dist]) edge.push(spot('undergrowth'));
        continue;
      }
      const cx = Math.floor(x / DECOR_CELL);
      const cy = Math.floor(y / DECOR_CELL);
      const kind = cellKind(cx, cy, seed);
      if (roll >= MEADOW_CHANCE[kind]) continue;
      const r = unit(pick);
      const role: DecorRole =
        kind === 'flowery' ? (r < 0.75 ? 'feature' : 'tuft') : kind === 'stony' ? (r < 0.6 ? 'stone' : 'tuft') : r < 0.7 ? 'tuft' : r < 0.9 ? 'feature' : 'stone';
      meadow.push(spot(role, hash(cx, cy, seed + 5)));
    }
  }
  let kept = meadow;
  const room = Math.max(0, DECOR_CAP - edge.length);
  if (meadow.length > room) {
    // Keep the meadow spots with the lowest hash: an even thinning, the same every load.
    const order = meadow.map((s, i) => ({ i, k: hash(s.x, s.y, seed + 6) })).sort((a, b) => a.k - b.k || a.i - b.i);
    const keep = new Set(order.slice(0, room).map((o) => o.i));
    kept = meadow.filter((_, i) => keep.has(i));
  }
  const all = [...edge.slice(0, DECOR_CAP), ...kept];
  return all.sort((a, b) => a.x + a.y - (b.x + b.y) || a.y - b.y);
}

/** The base art of a spot in `season` (seasonal ones still need `seasonalArt` for their season's version). */
export function decorArt(spot: DecorSpot, season: Season): string {
  switch (spot.role) {
    case 'tuft':
      return TUFT_ART[spot.pick % TUFT_ART.length];
    case 'stone':
      return STONE_ART[spot.pick % STONE_ART.length];
    case 'feature': {
      const list = SEASON_DECOR[season];
      // Mostly the cell's own feature (its flower), now and then another; the last one (a puddle, the poppies, a
      // snow drift) never leads a cell, so it stays the odd one out.
      const own = spot.cellPick % (list.length - 1);
      return unit(spot.pick >>> 3) < 0.7 ? list[own] : list[(spot.pick >>> 5) % list.length];
    }
    case 'undergrowth': {
      // Half ferns, three in ten bushes, one in five a fallen log.
      const r = spot.pick % 10;
      const which = spot.pick >>> 7;
      if (r < 5) return FERN_ART[which % FERN_ART.length];
      if (r < 8) return SCENERY[which % SCENERY.length];
      return LOG_ART;
    }
  }
}

