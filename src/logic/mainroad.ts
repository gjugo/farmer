import { getBuildable } from '../data/buildables';
import { MAP_HEIGHT, MAP_WIDTH, START_LAND } from './constants';
import { depositAt, mapOf, removeTrees, seededRandom, treeAt } from './maplayer';
import { hash } from '../scenes/noise';
import { registerPlacementRule } from './placement';
import { POND, sceneryArt } from './scenery';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import { onNewGame } from './state';
import type { GameState } from './types';

/**
 * The main road: one per map, along one side of it (picked from the seed) in a band 2–7 tiles in from that edge, from
 * map edge to map edge, winding gently. Merchants' carts travel it, and trade needs a trading post linked to it by the
 * farm's own paths (`src/logic/tradepost.ts`).
 *
 * - Its tiles count as path: farmers, carts and "a path from the village reaches it" walk it (`src/logic/roads.ts`).
 * - Nothing is built on it and it is never demolished: placing anything (a path too) on it is refused (`road`).
 * - It goes round ponds, deposits, buildings and the starting land, and cuts through forests (those trees are gone).
 *
 * The tiles are saved (`ext.road`). New farms get it at once; older saves get it on load, from their seed, routed
 * round what they have built (`ensureMainRoad`). The look lives in `src/features/road`.
 */

export const ROAD_SLICE = 'road';

export type RoadSide = 'north' | 'east' | 'south' | 'west';
export const ROAD_SIDES: readonly RoadSide[] = ['north', 'east', 'south', 'west'];

export interface RoadTile {
  x: number;
  y: number;
}

export interface RoadState {
  /** Seed the road is laid out from (and its merchants timed by). */
  seed: number;
  /** The side of the map it runs along; null until it is laid. */
  side: RoadSide | null;
  /** From the entry edge to the exit edge, each tile sharing an edge with the next. Empty until it is laid. */
  tiles: RoadTile[];
  /** Still to be laid (`ensureMainRoad`): a new farm, a save from before the road, or one whose road was broken. */
  pending: boolean;
}

/** The band the road keeps to, in tiles in from its side's edge (it widens only when there is no way through). */
export const ROAD_BAND = { min: 2, max: 7 } as const;
/** Wider bands tried in turn when an older farm's buildings leave no way through the usual one. */
const WIDER_BANDS = [
  { min: 1, max: 11 },
  { min: 0, max: 16 },
] as const;
/** The road keeps this many tiles clear of the starting land. */
const START_CLEARANCE = 2;

const randomSeed = () => Math.floor(Math.random() * 0x100000000);

registerStateSlice<RoadState>(ROAD_SLICE, () => ({ seed: randomSeed(), side: null, tiles: [], pending: true }));

const isInt = (v: unknown): v is number => Number.isInteger(v);

/** The road slice, repaired if a save held anything malformed (a broken road is laid again by `ensureMainRoad`). */
export function roadOf(state: GameState): RoadState {
  const raw = getSlice<unknown>(state, ROAD_SLICE);
  const r = (isPlainObject(raw) ? raw : (state.ext[ROAD_SLICE] = {})) as Record<string, unknown>;
  if (checked.has(r)) return r as unknown as RoadState;
  const seed = typeof r.seed === 'number' && Number.isFinite(r.seed) ? r.seed >>> 0 : randomSeed();
  const side = ROAD_SIDES.includes(r.side as RoadSide) ? (r.side as RoadSide) : null;
  const tiles = Array.isArray(r.tiles)
    ? r.tiles.flatMap((t) => (isPlainObject(t) && isInt(t.x) && isInt(t.y) && t.x >= 0 && t.y >= 0 && t.x < MAP_WIDTH && t.y < MAP_HEIGHT ? [{ x: t.x, y: t.y }] : []))
    : [];
  const ok = side !== null && joined(tiles);
  const road: RoadState = { seed, side: ok ? side : null, tiles: ok ? tiles : [], pending: r.pending === true || (r.side != null && !ok) };
  state.ext[ROAD_SLICE] = road;
  checked.add(road);
  return road;
}

const checked = new WeakSet<object>();

/** Does every tile share an edge with the next (and none repeat)? */
function joined(tiles: readonly RoadTile[]): boolean {
  if (tiles.length < 2) return false;
  const seen = new Set<number>();
  for (let i = 0; i < tiles.length; i++) {
    const k = tiles[i].y * MAP_WIDTH + tiles[i].x;
    if (seen.has(k)) return false;
    seen.add(k);
    if (i > 0 && Math.abs(tiles[i].x - tiles[i - 1].x) + Math.abs(tiles[i].y - tiles[i - 1].y) !== 1) return false;
  }
  return true;
}

const tileSets = new WeakMap<readonly RoadTile[], Set<number>>();

function tileSet(tiles: readonly RoadTile[]): Set<number> {
  let set = tileSets.get(tiles);
  if (!set) {
    set = new Set(tiles.map((t) => t.y * MAP_WIDTH + t.x));
    tileSets.set(tiles, set);
  }
  return set;
}

/** Is (x, y) a main-road tile? Never lays the road (see `ensureMainRoad`). */
export function isRoadTile(state: GameState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return false;
  return tileSet(roadOf(state).tiles).has(y * MAP_WIDTH + x);
}

/** The road's tiles, entry first (empty before it is laid). */
export function roadTiles(state: GameState): readonly RoadTile[] {
  return roadOf(state).tiles;
}

// Placement: nothing is built on the road. ------------------------------------------------

registerPlacementRule((state, fp, x, y) => {
  const set = tileSet(roadOf(state).tiles);
  if (set.size === 0) return null;
  for (let ty = y; ty < y + fp.h; ty++) for (let tx = x; tx < x + fp.w; tx++) if (set.has(ty * MAP_WIDTH + tx)) return 'road';
  return null;
});

// Laying it out ------------------------------------------------------------------------------

/** A rectangle the road must not cross (a building, field or path of an older farm). */
interface Blocker {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoadPlan {
  side: RoadSide;
  tiles: RoadTile[];
}

/** Map tile of the point `a` tiles along `side` and `d` tiles in from its edge. */
export function sideTile(side: RoadSide, a: number, d: number): RoadTile {
  switch (side) {
    case 'north':
      return { x: a, y: d };
    case 'south':
      return { x: a, y: MAP_HEIGHT - 1 - d };
    case 'west':
      return { x: d, y: a };
    case 'east':
      return { x: MAP_WIDTH - 1 - d, y: a };
  }
}

/** How far in from `side`'s edge tile (x, y) is. */
export function depthIn(side: RoadSide, x: number, y: number): number {
  return side === 'north' ? y : side === 'south' ? MAP_HEIGHT - 1 - y : side === 'west' ? x : MAP_WIDTH - 1 - x;
}

const sideLength = (side: RoadSide) => (side === 'north' || side === 'south' ? MAP_WIDTH : MAP_HEIGHT);

/**
 * Lays the road out from `seed`: picks the side, a gently winding line in the band (it moves a tile in or out every
 * few tiles), then the cheapest way from edge to edge that stays near the line. Ponds, deposits, `blockers` and the
 * starting land are in the way; trees and bushes are not (they are cleared). When nothing gets through the band, wider
 * ones are tried. Null when there is no way at all.
 */
export function planRoad(state: GameState, seed: number, blockers: readonly Blocker[] = []): RoadPlan | null {
  const rnd = seededRandom((seed ^ 0x40ad5) >>> 0);
  const side = ROAD_SIDES[Math.floor(rnd() * ROAD_SIDES.length)];
  const L = sideLength(side);
  // The line it follows: starts 3–6 in, drifts a tile in or out now and then.
  const lane: number[] = [];
  let d = 3 + Math.floor(rnd() * 4);
  let hold = 0;
  for (let a = 0; a < L; a++) {
    if (hold <= 0 && rnd() < 0.3) {
      const step = rnd() < 0.5 ? -1 : 1;
      d = Math.max(ROAD_BAND.min + 1, Math.min(ROAD_BAND.max - 1, d + step));
      hold = 3 + Math.floor(rnd() * 4);
    }
    hold--;
    lane.push(d);
  }

  const layer = mapOf(state);
  const blocked = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  const S = START_LAND;
  const c = START_CLEARANCE;
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const nearStart = x >= S.x - c && y >= S.y - c && x < S.x + S.w + c && y < S.y + S.h + c;
      if (nearStart || depositAt(layer, x, y) || sceneryArt(x, y) === POND) blocked[y * MAP_WIDTH + x] = 1;
    }
  }
  for (const b of blockers) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT) blocked[y * MAP_WIDTH + x] = 1;
  }

  for (const band of [ROAD_BAND, ...WIDER_BANDS]) {
    const tiles = cheapestWay(side, L, band, lane, (x, y) => {
      if (blocked[y * MAP_WIDTH + x]) return null;
      let cost = 1;
      if (treeAt(layer, x, y)) cost += 0.4;
      if (sceneryArt(x, y)) cost += 0.2;
      return cost;
    });
    if (tiles) return { side, tiles };
  }
  return null;
}

/** Dijkstra over the band, from any tile at a = 0 to any at a = L - 1. */
function cheapestWay(
  side: RoadSide,
  L: number,
  band: { min: number; max: number },
  lane: readonly number[],
  stepCost: (x: number, y: number) => number | null,
): RoadTile[] | null {
  const D = band.max - band.min + 1;
  const n = L * D;
  const idx = (a: number, d: number) => a * D + (d - band.min);
  const cost = (a: number, d: number) => {
    const t = sideTile(side, a, d);
    const base = stepCost(t.x, t.y);
    // Off its line costs more; going back the way it came is allowed (round a pond), at a price.
    return base === null ? null : base + 0.7 * Math.abs(d - lane[a]);
  };
  const dist = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  for (let d = band.min; d <= band.max; d++) {
    const c = cost(0, d);
    if (c !== null) dist[idx(0, d)] = c;
  }
  for (;;) {
    let best = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (best < 0 || dist[i] < dist[best])) best = i;
    if (best < 0) return null;
    done[best] = 1;
    const a = Math.floor(best / D);
    const d = (best % D) + band.min;
    if (a === L - 1) {
      const out: RoadTile[] = [];
      for (let i = best; i >= 0; i = from[i]) out.unshift(sideTile(side, Math.floor(i / D), (i % D) + band.min));
      return out;
    }
    for (const [da, dd] of [
      [1, 0],
      [0, 1],
      [0, -1],
      [-1, 0],
    ] as const) {
      const na = a + da;
      const nd = d + dd;
      if (na < 0 || na >= L || nd < band.min || nd > band.max) continue;
      const j = idx(na, nd);
      if (done[j]) continue;
      const c = cost(na, nd);
      if (c === null) continue;
      const total = dist[best] + c + (da < 0 ? 2 : 0);
      if (total < dist[j]) {
        dist[j] = total;
        from[j] = best;
      }
    }
  }
}

/** Every object's footprint, for laying the road round what an older farm has built. */
function objectBlockers(state: GameState): Blocker[] {
  return state.objects.map((o) => ({ x: o.x, y: o.y, ...(getBuildable(o.type)?.footprint ?? { w: 1, h: 1 }) }));
}

/**
 * Lays the farm's main road when it has none yet (a new farm, or a save from before it): from the saved seed, round
 * everything built, clearing the trees on its tiles. Returns true when it laid one.
 */
export function ensureMainRoad(state: GameState): boolean {
  const road = roadOf(state);
  if (!road.pending) return false;
  road.pending = false;
  const plan = planRoad(state, road.seed, objectBlockers(state));
  if (!plan) return false;
  road.side = plan.side;
  road.tiles = plan.tiles;
  removeTrees(mapOf(state), plan.tiles);
  return true;
}

// A new farm's road: after the map is laid out round the camp (whatever loaded first).
onNewGame((state) => void ensureMainRoad(state), { late: true });

// Merchants ------------------------------------------------------------------------------

/** Game time a merchant's cart takes to go one road tile. */
export const MERCHANT_MS_PER_TILE = 2400;
/** Chance (percent) that a cart sets out in a slot. */
export const MERCHANT_CHANCE = 65;
/** Most carts on the road at once. */
export const MAX_MERCHANTS = 2;

export interface Merchant {
  /** Which slot it set out in (stable while it travels). */
  id: number;
  /** Grid point (tile units) it is at now. */
  x: number;
  y: number;
  /** Which way it is heading, one grid step: for its facing. */
  dx: number;
  dy: number;
  /** Driving from the exit back to the entry. */
  reverse: boolean;
  /** 0 at its starting edge, 1 at the far one. */
  progress: number;
}

/**
 * The carts on the road at game time `now`: scenery only, worked out from the clock and the seed (nothing saved). Time
 * is cut in slots a bit longer than a crossing; a cart may set out in each, in the first half of it, so at most two are
 * ever on the road (one from this slot, one still finishing from the last).
 */
export function merchantsAt(road: Pick<RoadState, 'seed' | 'tiles'>, now: number): Merchant[] {
  const tiles = road.tiles;
  if (tiles.length < 2 || !(now >= 0)) return [];
  const travel = (tiles.length - 1) * MERCHANT_MS_PER_TILE;
  const slot = travel / 0.8;
  const k = Math.floor(now / slot);
  const out: Merchant[] = [];
  for (const j of [k - 1, k]) {
    if (j < 0) continue;
    const h = hash(j, road.seed >>> 16, (road.seed & 0xffff) + 97);
    if (h % 100 >= MERCHANT_CHANCE) continue;
    const start = j * slot + ((Math.floor(h / 100) % 1000) / 1000) * 0.5 * slot;
    const p = (now - start) / travel;
    if (p < 0 || p >= 1) continue;
    const reverse = Math.floor(h / 100000) % 2 === 1;
    const along = (reverse ? 1 - p : p) * (tiles.length - 1);
    const i = Math.min(tiles.length - 2, Math.floor(along));
    const f = along - i;
    const a = tiles[i];
    const b = tiles[i + 1];
    const sx = reverse ? -1 : 1;
    out.push({ id: j, x: a.x + 0.5 + (b.x - a.x) * f, y: a.y + 0.5 + (b.y - a.y) * f, dx: (b.x - a.x) * sx, dy: (b.y - a.y) * sx, reverse, progress: p });
  }
  return out;
}

/** `window.farm.road`: the side, tiles, entry and exit, and the carts on it now. */
export function roadInfo(state: GameState, now: number) {
  const road = roadOf(state);
  return {
    side: road.side,
    tiles: road.tiles.map((t) => ({ ...t })),
    entry: road.tiles[0] ? { ...road.tiles[0] } : null,
    exit: road.tiles.length ? { ...road.tiles[road.tiles.length - 1] } : null,
    merchants: merchantsAt(road, now),
  };
}
