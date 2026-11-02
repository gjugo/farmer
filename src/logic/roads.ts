import { getBuildable } from '../data/buildables';
import { FARMHOUSE, FARMHOUSE_DOOR, PATH } from '../data/farmhouse';
import { START_LAYOUT } from './constants';
// The starting fields' new-game setup must run before ours, which lays the road to them.
import './crops';
import { inBounds, isOwned } from './land';
import { canPlace, ruleBlock } from './placement';
import { addStartingObject, onNewGame } from './state';
import type { GameState, PlacedObject } from './types';

/**
 * Roads: farmers leave the farmhouse door and walk along paths to their work, so a field,
 * pen or building gets worked only when a path joins it to the door. Every farm has a
 * farmhouse: new farms start with one and a road to the starting fields, and saves from
 * before farmhouses get one (and roads to what is already built) when they load.
 */

export interface Tile {
  x: number;
  y: number;
}

/** A tile rectangle: top-left tile and size. */
export interface Area extends Tile {
  w: number;
  h: number;
}

/** How a farmer gets to a work site. */
export interface Route {
  /** Path tiles walked, from the farmhouse door to the one next to the site. Empty when there is no farmhouse. */
  tiles: Tile[];
  /** Grid point where the farmer works: the middle of the site tile next to the last path tile. */
  work: { x: number; y: number };
}

/** Right of the starting fields, door onto the lane in front of them. */
export const STARTING_FARMHOUSE: Tile = { x: START_LAYOUT.x + 6, y: START_LAYOUT.y };

const key = (x: number, y: number) => `${x},${y}`;
const STEPS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

function footprintOf(obj: PlacedObject): { w: number; h: number } {
  return getBuildable(obj.type)?.footprint ?? { w: 1, h: 1 };
}

export function farmhouseOf(state: GameState): PlacedObject | undefined {
  return state.objects.find((o) => o.type === FARMHOUSE);
}

/** The tile in front of the farmhouse door, where every road starts. */
export function doorOf(house: Tile): Tile {
  return { x: house.x + FARMHOUSE_DOOR.x, y: house.y + FARMHOUSE_DOOR.y };
}

function inside(a: Area, x: number, y: number): boolean {
  return x >= a.x && y >= a.y && x < a.x + a.w && y < a.y + a.h;
}

/** The tile of `a` sharing an edge with tile (x, y) outside it, or null when they don't touch. */
function touching(a: Area, x: number, y: number): Tile | null {
  if (inside(a, x, y)) return null;
  for (const [dx, dy] of STEPS) if (inside(a, x + dx, y + dy)) return { x: x + dx, y: y + dy };
  return null;
}

/** Tile → the object covering it, for every owned tile with something on it. */
function occupancy(state: GameState): Map<string, PlacedObject> {
  const at = new Map<string, PlacedObject>();
  for (const o of state.objects) {
    const { w, h } = footprintOf(o);
    for (let y = o.y; y < o.y + h; y++) for (let x = o.x; x < o.x + w; x++) at.set(key(x, y), o);
  }
  return at;
}

/**
 * Searches from the door to a tile touching `site`. `cost` says what stepping on a tile costs:
 * null when it can't be walked, otherwise 0 or 1 (a 0-1 breadth-first search, so 0-cost tiles are
 * preferred). Returns the tiles from the door on, or null when nothing reaches the site.
 */
function search(door: Tile | Tile[], site: Area, cost: (x: number, y: number) => number | null): Tile[] | null {
  const best = new Map<string, number>();
  const from = new Map<string, Tile | null>();
  const queue: (Tile & { d: number })[] = [];
  for (const t of Array.isArray(door) ? door : [door]) {
    const startCost = cost(t.x, t.y);
    if (startCost === null || best.has(key(t.x, t.y))) continue;
    best.set(key(t.x, t.y), startCost);
    from.set(key(t.x, t.y), null);
    queue.push({ ...t, d: startCost });
  }
  while (queue.length > 0) {
    const t = queue.shift()!;
    if (t.d > (best.get(key(t.x, t.y)) ?? Infinity)) continue;
    if (touching(site, t.x, t.y)) {
      const tiles: Tile[] = [];
      for (let c: Tile | null = t; c; c = from.get(key(c.x, c.y)) ?? null) tiles.unshift({ x: c.x, y: c.y });
      return tiles;
    }
    for (const [dx, dy] of STEPS) {
      const nx = t.x + dx;
      const ny = t.y + dy;
      const step = cost(nx, ny);
      if (step === null) continue;
      const d = t.d + step;
      if (d >= (best.get(key(nx, ny)) ?? Infinity)) continue;
      best.set(key(nx, ny), d);
      from.set(key(nx, ny), { x: t.x, y: t.y });
      if (step === 0) queue.unshift({ x: nx, y: ny, d });
      else queue.push({ x: nx, y: ny, d });
    }
  }
  return null;
}

/**
 * The way from the farmhouse door to `site` along paths, or null when no path joins them. On a farm
 * without a farmhouse (never after loading) there is nothing to walk: the farmer works in the site's middle.
 */
export function findRoute(state: GameState, site: Area): Route | null {
  const house = farmhouseOf(state);
  if (!house) return { tiles: [], work: { x: site.x + site.w / 2, y: site.y + site.h / 2 } };
  const at = occupancy(state);
  const tiles = search(doorOf(house), site, (x, y) => (at.get(key(x, y))?.type === PATH ? 0 : null));
  if (!tiles) return null;
  const last = tiles[tiles.length - 1];
  const t = touching(site, last.x, last.y)!;
  return { tiles, work: { x: t.x + 0.5, y: t.y + 0.5 } };
}

/** A grid point (in tiles, may be fractional). */
export interface Point {
  x: number;
  y: number;
}

/**
 * The way between two areas along paths, for the oxcart: from the middle of the tile of `from` next to the first path
 * tile, through the middle of every path tile, to the middle of the tile of `to` next to the last one. Null when no
 * path joins them.
 */
export function findWay(state: GameState, from: Area, to: Area): Point[] | null {
  const at = occupancy(state);
  const isPath = (x: number, y: number) => at.get(key(x, y))?.type === PATH;
  const starts: Tile[] = [];
  for (let y = from.y - 1; y <= from.y + from.h; y++) {
    for (let x = from.x - 1; x <= from.x + from.w; x++) if (isPath(x, y) && touching(from, x, y)) starts.push({ x, y });
  }
  const tiles = search(starts, to, (x, y) => (isPath(x, y) ? 0 : null));
  if (!tiles) return null;
  const first = touching(from, tiles[0].x, tiles[0].y)!;
  const last = touching(to, tiles[tiles.length - 1].x, tiles[tiles.length - 1].y)!;
  const mid = (t: Tile): Point => ({ x: t.x + 0.5, y: t.y + 0.5 });
  return [mid(first), ...tiles.map(mid), mid(last)];
}

/** Length of a polyline, in tiles. */
export function wayLength(points: Point[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return n;
}

/** Lays free paths over owned empty tiles so the door reaches `site`, reusing paths already there. */
function layRoad(state: GameState, door: Tile, site: Area): boolean {
  const at = occupancy(state);
  const tiles = search(door, site, (x, y) => {
    if (!inBounds(state.land, x, y) || !isOwned(state.land, x, y)) return null;
    const o = at.get(key(x, y));
    if (o) return o.type === PATH ? 0 : null;
    // A grown tree or a deposit is in the way.
    return ruleBlock(state, { w: 1, h: 1 }, x, y, PATH) ? null : 1;
  });
  if (!tiles) return false;
  for (const t of tiles) if (!at.has(key(t.x, t.y))) addStartingObject(state, PATH, t.x, t.y);
  return true;
}

/** Lays free paths (no money, no events) from the farmhouse door to `site`; false when there is no way over free land. For new-game setups and tests. */
export function connectToFarmhouse(state: GameState, site: Area): boolean {
  const house = farmhouseOf(state);
  return !!house && layRoad(state, doorOf(house), site);
}

/** Can the farmhouse stand at (x, y) with a free (or path) tile of our land in front of its door? */
function farmhouseFits(state: GameState, x: number, y: number): boolean {
  if (!canPlace(state, getBuildable(FARMHOUSE)!.footprint, x, y, footprintOf, FARMHOUSE).ok) return false;
  const door = doorOf({ x, y });
  if (!isOwned(state.land, door.x, door.y)) return false;
  const there = occupancy(state).get(key(door.x, door.y));
  return !there || there.type === PATH;
}

/**
 * Gives a farm without a farmhouse one: at `preferred` when it fits there, else on the free spot of
 * our land nearest to it. Then lays paths from its door to everything already built that has none.
 */
export function ensureFarmhouse(state: GameState, preferred: Tile = STARTING_FARMHOUSE): void {
  if (farmhouseOf(state)) return;
  const spots: Tile[] = [];
  for (let y = 0; y < state.land.height; y++) for (let x = 0; x < state.land.width; x++) spots.push({ x, y });
  const dist = (t: Tile) => Math.abs(t.x - preferred.x) + Math.abs(t.y - preferred.y);
  spots.sort((a, b) => dist(a) - dist(b) || a.y - b.y || a.x - b.x);
  const spot = spots.find((t) => farmhouseFits(state, t.x, t.y));
  if (!spot) return;
  const house = addStartingObject(state, FARMHOUSE, spot.x, spot.y)!;
  const door = doorOf(house);
  for (const obj of [...state.objects]) {
    if (obj.type === PATH || obj.type === FARMHOUSE) continue;
    const site = { x: obj.x, y: obj.y, ...footprintOf(obj) };
    if (!findRoute(state, site)) layRoad(state, door, site);
  }
  // The door always gets a path, so the first road the player lays has somewhere to start.
  if (!occupancy(state).has(key(door.x, door.y))) addStartingObject(state, PATH, door.x, door.y);
}

onNewGame((state) => ensureFarmhouse(state));
