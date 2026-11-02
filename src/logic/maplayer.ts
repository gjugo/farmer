import { getBuildable } from '../data/buildables';
import { DEPOSITS, RESOURCES, type DepositKind, type ResourceType } from '../data/resourceBuildings';
import { MAP_HEIGHT, MAP_WIDTH, START_LAND } from './constants';
import { inBounds, inRect, type Rect } from './land';
import { registerPlacementRule } from './placement';
import { SEASON_MS } from './seasons';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import { onNewGame } from './state';
import type { GameState, LandState } from './types';

const MAP: LandState = { width: MAP_WIDTH, height: MAP_HEIGHT };

/**
 * The map layer: forests and deposits that are really there, generated from a seed on a new game and saved.
 * Woodcutter's lodges fell the trees around them, quarries stand on stone outcrops and mines on iron veins.
 *
 * - A tree tile is grown or a stump, with the game time it was felled. A stump grows back `REGROW_MS` later
 *   (showing as a sapling, then a young tree, on the way: `treeStage`).
 *   Nothing is stored for that: grown or not is worked out from `felledAt` and the clock, so ×60, ×1 and
 *   offline catch-up give the same map. A lodge starting a cycle claims its tree at once (`felledAt` is the end of
 *   the cycle): it stands until then, and no other lodge takes it.
 * - A deposit holds what is left of its stone or iron; each quarry or mine cycle takes its yield from it.
 * - Grown trees and deposits block building (a quarry needs an outcrop under it, a mine a vein). Stumps and
 *   used-up deposits don't: building over them clears them for good.
 *
 * The look lives in `src/features/nature`.
 */

export const MAP_SLICE = 'map';

/** A stump grows back into a tree after about a season of game time. */
export const REGROW_MS = SEASON_MS;

export interface Tree {
  x: number;
  y: number;
  /** Game time it is (or will be, while a lodge works it) felled; null while it has never been. */
  felledAt: number | null;
}

export interface Deposit {
  kind: DepositKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** What is left to take. */
  left: number;
  /** What it held when new. */
  amount: number;
}

export interface MapLayer {
  trees: Tree[];
  deposits: Deposit[];
}

export type TreeStatus = 'grown' | 'stump';

const emptyLayer = (): MapLayer => ({ trees: [], deposits: [] });

function shiftLayer(saved: unknown, dx: number, dy: number): unknown {
  if (!isPlainObject(saved)) return saved;
  const move = (list: unknown) =>
    Array.isArray(list) ? list.map((t) => (isPlainObject(t) && typeof t.x === 'number' && typeof t.y === 'number' ? { ...t, x: t.x + dx, y: t.y + dy } : t)) : list;
  return { ...saved, trees: move(saved.trees), deposits: move(saved.deposits) };
}

registerStateSlice<MapLayer>(MAP_SLICE, emptyLayer, shiftLayer);

// Reading ------------------------------------------------------------------------------

const checked = new WeakSet<object>();

/** The farm's map layer, repaired once if it came from a save. */
export function mapOf(state: GameState): MapLayer {
  const raw = getSlice<unknown>(state, MAP_SLICE);
  if (isPlainObject(raw) && checked.has(raw)) return raw as unknown as MapLayer;
  const layer = sanitizeLayer(raw, state.land);
  state.ext[MAP_SLICE] = layer;
  checked.add(layer);
  return layer;
}

const isInt = (v: unknown): v is number => Number.isInteger(v);

/** A valid map layer from untrusted data: trees on the map, one per tile; deposits of a known kind. */
export function sanitizeLayer(raw: unknown, land: LandState): MapLayer {
  const layer = emptyLayer();
  if (!isPlainObject(raw)) return layer;
  const seen = new Set<number>();
  for (const t of Array.isArray(raw.trees) ? raw.trees : []) {
    if (!isPlainObject(t) || !isInt(t.x) || !isInt(t.y) || !inBounds(land, t.x, t.y)) continue;
    const k = t.y * land.width + t.x;
    if (seen.has(k)) continue;
    seen.add(k);
    const felledAt = typeof t.felledAt === 'number' && Number.isFinite(t.felledAt) && t.felledAt >= 0 ? t.felledAt : null;
    layer.trees.push({ x: t.x, y: t.y, felledAt });
  }
  for (const d of Array.isArray(raw.deposits) ? raw.deposits : []) {
    if (!isPlainObject(d) || (d.kind !== 'stone' && d.kind !== 'iron')) continue;
    if (!isInt(d.x) || !isInt(d.y) || !isInt(d.w) || !isInt(d.h) || d.w < 1 || d.h < 1 || d.w > 4 || d.h > 4) continue;
    if (!inBounds(land, d.x, d.y) || !inBounds(land, d.x + d.w - 1, d.y + d.h - 1)) continue;
    const amount = isInt(d.amount) && d.amount > 0 ? d.amount : DEPOSITS[d.kind].amount(d.w * d.h);
    const left = isInt(d.left) && d.left >= 0 ? Math.min(d.left, amount) : amount;
    layer.deposits.push({ kind: d.kind, x: d.x, y: d.y, w: d.w, h: d.h, left, amount });
  }
  return layer;
}

interface Index {
  trees: Map<number, Tree>;
  deposits: Map<number, Deposit>;
}

const indexes = new WeakMap<MapLayer, Index>();
const tileKey = (x: number, y: number) => y * 4096 + x;

/** Tile lookups, rebuilt after every change (see `changed`). */
function indexOf(layer: MapLayer): Index {
  let index = indexes.get(layer);
  if (!index) {
    index = { trees: new Map(), deposits: new Map() };
    for (const t of layer.trees) index.trees.set(tileKey(t.x, t.y), t);
    for (const d of layer.deposits) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) index.deposits.set(tileKey(x, y), d);
    indexes.set(layer, index);
  }
  return index;
}

function changed(layer: MapLayer): void {
  indexes.delete(layer);
}

export function treeAt(layer: MapLayer, x: number, y: number): Tree | undefined {
  return indexOf(layer).trees.get(tileKey(x, y));
}

export function depositAt(layer: MapLayer, x: number, y: number): Deposit | undefined {
  return indexOf(layer).deposits.get(tileKey(x, y));
}

/** When a stump grows back into a tree; null for a tree never felled. */
export function regrowAt(tree: Tree): number | null {
  return tree.felledAt === null ? null : tree.felledAt + REGROW_MS;
}

/** Grown (a tree still being felled stands until the cycle ends), or a stump. */
export function treeStatus(tree: Tree, now: number): TreeStatus {
  return tree.felledAt === null || now < tree.felledAt || now >= tree.felledAt + REGROW_MS ? 'grown' : 'stump';
}

/**
 * How far a tree has grown back, for the look: a stump, a sapling from a third of `REGROW_MS`, a young tree from
 * two thirds, grown again at `REGROW_MS`. Only from `felledAt` and the clock, so ×1, ×60 and offline catch-up agree.
 * Anything short of grown is a stump to the rules (`treeStatus`): a lodge fells only grown trees.
 */
export type TreeStage = 'stump' | 'sapling' | 'young' | 'grown';

/** Game time (after `felledAt`) each regrowth stage begins. */
export const TREE_STAGE_AT = { sapling: REGROW_MS / 3, young: (2 * REGROW_MS) / 3, grown: REGROW_MS } as const;

export function treeStage(tree: Tree, now: number): TreeStage {
  if (tree.felledAt === null || now < tree.felledAt) return 'grown';
  const since = now - tree.felledAt;
  if (since >= TREE_STAGE_AT.grown) return 'grown';
  if (since >= TREE_STAGE_AT.young) return 'young';
  return since >= TREE_STAGE_AT.sapling ? 'sapling' : 'stump';
}

/** The next game time after `now` the tree's look changes (it falls, or reaches the next stage); null when grown for good. */
export function nextStageAt(tree: Tree, now: number): number | null {
  if (tree.felledAt === null) return null;
  if (now < tree.felledAt) return tree.felledAt;
  for (const at of Object.values(TREE_STAGE_AT)) if (tree.felledAt + at > now) return tree.felledAt + at;
  return null;
}

/** A grown tree no lodge is felling: one a lodge may take. */
export function isFree(tree: Tree, now: number): boolean {
  return tree.felledAt === null || now >= tree.felledAt + REGROW_MS;
}

/** Squared distance in tiles from tile (x, y) to the nearest tile of `area`. */
function dist2(area: Rect, x: number, y: number): number {
  const dx = Math.max(area.x - x, 0, x - (area.x + area.w - 1));
  const dy = Math.max(area.y - y, 0, y - (area.y + area.h - 1));
  return dx * dx + dy * dy;
}

/** Is tile (x, y) within `range` tiles of the footprint `area` (and not under it)? */
export function inRange(area: Rect, range: number, x: number, y: number): boolean {
  const d = dist2(area, x, y);
  return d > 0 && d <= range * range;
}

/** Every tree tile (grown or stump) within `range` of `area`. */
export function treesInRange(layer: MapLayer, area: Rect, range: number): Tree[] {
  return layer.trees.filter((t) => inRange(area, range, t.x, t.y));
}

/** The nearest tree in range a lodge may fell now, or null. Ties go to the tree further back (lower y, then x). */
export function nearestFreeTree(layer: MapLayer, area: Rect, range: number, now: number): Tree | null {
  let best: Tree | null = null;
  let bestD = Infinity;
  for (const t of layer.trees) {
    if (!isFree(t, now) || !inRange(area, range, t.x, t.y)) continue;
    const d = dist2(area, t.x, t.y);
    if (d < bestD || (d === bestD && best && (t.y < best.y || (t.y === best.y && t.x < best.x)))) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** Claims the nearest free tree in range, to fall at game time `at`. Returns it, or null when there is none. */
export function fellNearest(layer: MapLayer, area: Rect, range: number, now: number, at: number): Tree | null {
  const tree = nearestFreeTree(layer, area, range, now);
  if (tree) tree.felledAt = at;
  return tree;
}

/** The next game time after `now` a tree in range becomes free to fell, or null when none will. */
export function nextFreeTreeAt(layer: MapLayer, area: Rect, range: number, now: number): number | null {
  let next: number | null = null;
  for (const t of layer.trees) {
    const at = regrowAt(t);
    if (at !== null && at > now && inRange(area, range, t.x, t.y) && (next === null || at < next)) next = at;
  }
  return next;
}

/** Adds grown trees on tiles without one (for tests and set-ups). */
export function addTrees(layer: MapLayer, tiles: readonly { x: number; y: number }[]): void {
  for (const { x, y } of tiles) if (!treeAt(layer, x, y)) layer.trees.push({ x, y, felledAt: null });
  changed(layer);
}

/** Adds a deposit (for tests and set-ups). */
export function addDeposit(layer: MapLayer, kind: DepositKind, area: Rect, amount = DEPOSITS[kind].amount(area.w * area.h)): Deposit {
  const d: Deposit = { kind, x: area.x, y: area.y, w: area.w, h: area.h, left: amount, amount };
  layer.deposits.push(d);
  changed(layer);
  return d;
}

/** Grows every stump back at once (the debug button). Trees being felled are left to their lodges. */
export function regrowAll(layer: MapLayer, now: number): number {
  let n = 0;
  for (const t of layer.trees) {
    if (treeStatus(t, now) === 'stump') {
      t.felledAt = null;
      n++;
    }
  }
  return n;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Deposits of `kind` under the footprint `area`. */
export function depositsUnder(layer: MapLayer, area: Rect, kind: DepositKind): Deposit[] {
  return layer.deposits.filter((d) => d.kind === kind && overlaps(d, area));
}

/** The deposit a quarry or mine on `area` takes from: the first of its kind under it with something left. */
export function workedDeposit(layer: MapLayer, area: Rect, kind: DepositKind): Deposit | null {
  return depositsUnder(layer, area, kind).find((d) => d.left > 0) ?? null;
}

/** Takes up to `qty` from the deposit; returns how much it gave. */
export function take(deposit: Deposit, qty: number): number {
  const n = Math.max(0, Math.min(qty, deposit.left));
  deposit.left -= n;
  return n;
}

/**
 * Building on `area` clears what it covers for good: stumps, and deposits that are used up (or, for a building
 * that doesn't stand on deposits, ones placement allowed). Returns true when something went.
 */
export function clearUnder(layer: MapLayer, area: Rect, now: number, type: string): boolean {
  const own = RESOURCES[type as ResourceType]?.deposit;
  const trees = layer.trees.filter((t) => !(dist2(area, t.x, t.y) === 0 && treeStatus(t, now) === 'stump'));
  const deposits = layer.deposits.filter((d) => !(overlaps(area, d) && d.left === 0 && d.kind !== own));
  if (trees.length === layer.trees.length && deposits.length === layer.deposits.length) return false;
  layer.trees = trees;
  layer.deposits = deposits;
  changed(layer);
  return true;
}

// Placement ------------------------------------------------------------------------------

registerPlacementRule((state, fp, x, y, type) => {
  const layer = mapOf(state);
  if (layer.trees.length === 0 && layer.deposits.length === 0) return null;
  const now = state.clock.elapsed;
  const need = type ? RESOURCES[type as ResourceType]?.deposit : undefined;
  let onDeposit = false;
  for (let ty = y; ty < y + fp.h; ty++) {
    for (let tx = x; tx < x + fp.w; tx++) {
      const tree = treeAt(layer, tx, ty);
      if (tree && treeStatus(tree, now) === 'grown') return 'tree';
      const d = depositAt(layer, tx, ty);
      if (!d || d.left === 0) continue;
      if (d.kind !== need) return 'deposit';
      onDeposit = true;
    }
  }
  if (need && !onDeposit) return need === 'stone' ? 'needs-outcrop' : 'needs-vein';
  return null;
});

// Generation ------------------------------------------------------------------------------

/** A small seeded random generator (mulberry32): the same seed always makes the same map. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Something on the farm the map is generated around. */
export interface Occupant extends Rect {
  type: string;
}

/** How the map is laid out. Tuned so the start has wood and stone at hand and iron is one block away. */
export const GEN = {
  /** Trees in the grove on the starting land. */
  startGrove: 10,
  /** Trees around each lodge of an older save. */
  lodgeGrove: 8,
  /** Forests out in the wild (beyond the starting land) and their size range. */
  forests: 7,
  forestTrees: [20, 34] as const,
  /** Stone outcrops out in the wild (besides the one at the start). */
  outcrops: 5,
  /** Iron veins out in the wild: one next to the start, the rest further out. */
  veins: 3,
} as const;

const STEPS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/** A block of the layout grid, at column `c` and row `r` of it. */
export interface Block extends Rect {
  c: number;
  r: number;
}

/** Blocks are at most this many tiles wide/tall. */
const BLOCK_MAX = 12;

/**
 * Splits the strip [from, to) into near-equal chunks of at most `max` tiles.
 * The bigger chunks come first, so walking outward from the farm they are next to it.
 */
function chunks(from: number, to: number, max: number, biggestFirst: boolean): [number, number][] {
  const len = to - from;
  if (len <= 0) return [];
  const n = Math.ceil(len / max);
  const sizes = Array.from({ length: n }, (_, i) => Math.floor(len / n) + (i < len % n ? 1 : 0));
  if (!biggestFirst) sizes.reverse();
  const out: [number, number][] = [];
  let at = from;
  for (const size of sizes) {
    out.push([at, size]);
    at += size;
  }
  return out;
}

/** Column (or row) bands: the start area is one band, the land on each side is chunked. */
function bands(start: number, size: number, total: number, max: number): [number, number][] {
  return [...chunks(0, start, max, false), [start, size], ...chunks(start + size, total, max, true)];
}

/**
 * The grid the map is laid out on: the starting land is one block, the rest of the map is split into blocks of up
 * to 12 tiles around it, one forest or deposit per block. The grid never changes: the same seed lays out the
 * same map, and existing farms' trees and deposits never move.
 */
export const MAP_BLOCKS: readonly Block[] = (() => {
  const cols = bands(START_LAND.x, START_LAND.w, MAP_WIDTH, BLOCK_MAX);
  const rows = bands(START_LAND.y, START_LAND.h, MAP_HEIGHT, BLOCK_MAX);
  return rows.flatMap(([y, h], r) => cols.map(([x, w], c) => ({ c, r, x, y, w, h })));
})();

/** The block (x, y) lies in, or undefined off the map. */
export function blockAt(x: number, y: number): Block | undefined {
  return MAP_BLOCKS.find((b) => inRect(b, x, y));
}

/** Is (x, y) on the starting land? */
export const onStartLand = (x: number, y: number): boolean => inRect(START_LAND, x, y);

/** Spots by a block's edges the layout keeps clear of trees and rocks (it always has: keeps a seed's map the same). */
function edgeSpots(p: Block): [number, number][] {
  const midX = p.x + Math.floor(p.w / 2);
  const midY = p.y + Math.floor(p.h / 2);
  return [
    [midX, p.y + p.h - Math.min(2, p.h)],
    [p.x + p.w - Math.min(2, p.w), midY],
    [midX, p.y],
    [p.x, midY],
  ];
}

/**
 * Lays out forests and deposits around what stands on the farm (never on top of it). New games call it with the
 * camp and the path in front of it; older saves with everything they have built, so their quarries and mines get a
 * deposit under them and their lodges a grove within reach.
 *
 * `home` is the farm's home ground: the starting land for a new game (`onStartLand`); for older saves (from before the whole map was
 * open), the land the farm held then. Everything else is the wild.
 *
 * - A grove of about 10 trees on the home ground, away from the fields and paths, and a 2×2 stone outcrop there
 *   (or, when it is built up, in the first ring of blocks).
 * - Iron veins only in the wild: one in a block next to the start, the others further out.
 * - More outcrops (2×2 or 3×3) and large forests in the wild, clear of the home ground's edge and the blocks' edge spots.
 */
export function generateMapLayer(home: (x: number, y: number) => boolean, occupants: readonly Occupant[], seed: number): MapLayer {
  const rnd = seededRandom(seed);
  const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(rnd() * list.length)];
  const shuffle = <T>(list: T[]): T[] => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  const land = MAP;
  const W = land.width;
  const H = land.height;
  const layer = emptyLayer();
  /** 1: something stands or lies here. */
  const taken = new Uint8Array(W * H);
  /** 1: next to an object or a deposit, or an edge spot: no new deposit or tree. */
  const near = new Uint8Array(W * H);
  const at = (x: number, y: number) => y * W + x;
  const markNear = (a: Rect, margin: number) => {
    for (let y = a.y - margin; y < a.y + a.h + margin; y++) for (let x = a.x - margin; x < a.x + a.w + margin; x++) if (inBounds(land, x, y)) near[at(x, y)] = 1;
  };
  const markTaken = (a: Rect) => {
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (inBounds(land, x, y)) taken[at(x, y)] = 1;
  };
  for (const o of occupants) {
    markTaken(o);
    markNear(o, 1);
  }
  for (const p of MAP_BLOCKS) for (const [x, y] of edgeSpots(p)) markNear({ x, y, w: 1, h: 1 }, 1);

  const free = (x: number, y: number, margin = true) => inBounds(land, x, y) && !taken[at(x, y)] && (!margin || !near[at(x, y)]);
  const atHome = (x: number, y: number) => inBounds(land, x, y) && home(x, y);
  /** Next to the home ground (or on it): features in the wild keep off its edge. */
  const byHome = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (atHome(x + dx, y + dy)) return true;
    return false;
  };
  const wild = (x: number, y: number) => !atHome(x, y) && !byHome(x, y);

  const addTree = (x: number, y: number) => {
    taken[at(x, y)] = 1;
    layer.trees.push({ x, y, felledAt: null });
  };
  const addDeposit = (kind: DepositKind, a: Rect, margin = 1) => {
    markTaken(a);
    markNear(a, margin);
    const amount = DEPOSITS[kind].amount(a.w * a.h);
    layer.deposits.push({ kind, ...a, left: amount, amount });
  };
  /** A clump of up to `count` trees grown out from `start` over tiles that pass `ok`. */
  const grove = (start: { x: number; y: number }, count: number, ok: (x: number, y: number) => boolean, gaps = 0) => {
    const frontier = [start];
    const seen = new Set<number>([at(start.x, start.y)]);
    let n = 0;
    while (n < count && frontier.length > 0) {
      // Mostly the tile nearest the middle, with some noise: a rounded clump with a ragged edge.
      let best = 0;
      let bestScore = Infinity;
      frontier.forEach((f, i) => {
        const score = (f.x - start.x) ** 2 + (f.y - start.y) ** 2 + rnd() * 8;
        if (score < bestScore) [best, bestScore] = [i, score];
      });
      const [t] = frontier.splice(best, 1);
      if (!ok(t.x, t.y)) continue;
      // A few gaps make clearings, so a forest isn't a solid block.
      if (n > 0 && rnd() < gaps) continue;
      addTree(t.x, t.y);
      n++;
      for (const [dx, dy] of STEPS) {
        const x = t.x + dx;
        const y = t.y + dy;
        if (inBounds(land, x, y) && !seen.has(at(x, y))) {
          seen.add(at(x, y));
          frontier.push({ x, y });
        }
      }
    }
    return n;
  };
  /** The w × h spots whose tiles all pass `ok`, nearest to `to` first (ties in a seeded order). */
  const spots = (w: number, h: number, ok: (x: number, y: number) => boolean, area: Rect, to: { x: number; y: number }) => {
    const out: { x: number; y: number; d: number }[] = [];
    for (let y = area.y; y + h <= area.y + area.h; y++) {
      for (let x = area.x; x + w <= area.x + area.w; x++) {
        let fits = true;
        for (let ty = y; ty < y + h && fits; ty++) for (let tx = x; tx < x + w && fits; tx++) fits = ok(tx, ty);
        if (fits) out.push({ x, y, d: (x + w / 2 - to.x) ** 2 + (y + h / 2 - to.y) ** 2 + rnd() * 0.01 });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  };

  // What is already built keeps working: a deposit under each quarry and mine, a grove by each lodge.
  for (const o of occupants) {
    const kind = RESOURCES[o.type as ResourceType]?.deposit;
    if (kind) {
      const amount = DEPOSITS[kind].amount(o.w * o.h);
      layer.deposits.push({ kind, x: o.x, y: o.y, w: o.w, h: o.h, left: amount, amount });
    }
  }
  for (const o of occupants) {
    const range = RESOURCES[o.type as ResourceType]?.range;
    if (!range) continue;
    // Leave a ring free around the lodge (for its path), and keep off other buildings' edges when there is room.
    const tiles: { x: number; y: number; d: number }[] = [];
    for (let y = o.y - range; y < o.y + o.h + range; y++) {
      for (let x = o.x - range; x < o.x + o.w + range; x++) {
        const d = dist2(o, x, y);
        if (d >= 4 && inRange(o, range, x, y) && free(x, y, false)) tiles.push({ x, y, d: d + (near[at(x, y)] ? 100 : 0) + rnd() });
      }
    }
    tiles.sort((a, b) => a.d - b.d);
    for (const t of tiles.slice(0, GEN.lodgeGrove)) addTree(t.x, t.y);
  }

  // The start: a grove at the back left of the starting land, a stone outcrop at the front right.
  const S = START_LAND;
  const groveAt = spots(1, 1, (x, y) => atHome(x, y) && free(x, y), S, { x: S.x + 2.5, y: S.y + S.h - 2.5 })[0];
  if (groveAt) grove(groveAt, GEN.startGrove, (x, y) => atHome(x, y) && free(x, y));
  for (const t of layer.trees) markNear({ x: t.x, y: t.y, w: 1, h: 1 }, 1);
  const startRock =
    spots(2, 2, (x, y) => atHome(x, y) && free(x, y), S, { x: S.x + S.w - 3, y: S.y + S.h - 2.5 })[0] ??
    spots(2, 2, (x, y) => wild(x, y) && free(x, y), { x: S.x - 12, y: S.y - 12, w: S.w + 24, h: S.h + 24 }, { x: S.x + S.w / 2, y: S.y + S.h / 2 })[0];
  if (startRock) addDeposit('stone', { x: startRock.x, y: startRock.y, w: 2, h: 2 });

  // Blocks by ring around the start (1: next to it).
  const start = MAP_BLOCKS.find((p) => p.x === S.x && p.y === S.y) ?? MAP_BLOCKS[0];
  const ring = (p: Block) => Math.max(Math.abs(p.c - start.c), Math.abs(p.r - start.r));
  const beside = (p: Block) => ring(p) === 1 && (p.c === start.c || p.r === start.r);
  const wildBlocks = MAP_BLOCKS.filter((p) => p !== start && spots(1, 1, wild, p, p).length > 0);
  const inner = (p: Block): Rect => ({ x: p.x + 1, y: p.y + 1, w: p.w - 2, h: p.h - 2 });
  const used = new Set<Block>();
  /** A deposit at a random free spot inside one of `blocks` (tried in order); false when none has room. */
  const depositIn = (kind: DepositKind, size: number, blocks: Block[]) => {
    for (const p of blocks) {
      const options = spots(size, size, (x, y) => wild(x, y) && free(x, y), inner(p), p);
      const spot = pick(options);
      if (!spot) continue;
      addDeposit(kind, { x: spot.x, y: spot.y, w: size, h: size }, 2);
      used.add(p);
      return true;
    }
    return false;
  };

  // Iron: a vein in a block next to the start (so the "Mine iron" goal is in easy reach), the rest further out.
  const veinFirst = shuffle(wildBlocks.filter(beside));
  const veinMore = shuffle(wildBlocks.filter((p) => !beside(p)));
  let veins = depositIn('iron', 2, [...veinFirst, ...veinMore]) ? 1 : 0;
  for (; veins < GEN.veins; veins++) if (!depositIn('iron', 2, shuffle(veinMore.filter((p) => !used.has(p))))) break;

  // Stone further out: 2×2 or 3×3.
  for (let i = 0; i < GEN.outcrops; i++) {
    const size = rnd() < 0.5 ? 3 : 2;
    depositIn('stone', size, shuffle(wildBlocks.filter((p) => !used.has(p))));
  }

  // Forests: large clumps in the wild, each from a block of its own when there are enough.
  const forestBlocks = shuffle([...wildBlocks]);
  for (let i = 0; i < GEN.forests && forestBlocks.length > 0; i++) {
    const p = forestBlocks.splice(0, 1)[0];
    const ok = (x: number, y: number) => wild(x, y) && free(x, y);
    const centre = pick(spots(1, 1, ok, inner(p), p).slice(0, Math.max(1, Math.floor((p.w * p.h) / 3))));
    if (!centre) continue;
    const [lo, hi] = GEN.forestTrees;
    grove(centre, lo + Math.floor(rnd() * (hi - lo + 1)), ok, 0.12);
  }
  return layer;
}

/** The farm's objects as rectangles to generate around. */
export function occupantsOf(objects: readonly { type: string; x: number; y: number }[]): Occupant[] {
  return objects.flatMap((o) => {
    const fp = getBuildable(o.type)?.footprint;
    return fp ? [{ type: o.type, x: o.x, y: o.y, w: fp.w, h: fp.h }] : [];
  });
}

/** A new farm's map, from a seed (random unless given). */
export function newMapLayer(state: GameState, seed = Math.floor(Math.random() * 0x100000000)): MapLayer {
  const layer = generateMapLayer(onStartLand, occupantsOf(state.objects), seed);
  checked.add(layer);
  return layer;
}

onNewGame((state) => {
  state.ext[MAP_SLICE] = newMapLayer(state);
});

/**
 * The map layer for a save from before it (version 10): generated around everything the save holds, from raw,
 * untrusted saved state. The seed comes from the save, so loading the same save twice gives the same map.
 */
export function migrateMapLayer(raw: Record<string, unknown>): MapLayer {
  // Saves back then owned land (a row-major grid, 1 = owned): it was the home ground. Broken: the starting land.
  const l = isPlainObject(raw.land) ? raw.land : {};
  const owned = l.width === MAP_WIDTH && l.height === MAP_HEIGHT && Array.isArray(l.owned) && l.owned.length === MAP_WIDTH * MAP_HEIGHT ? l.owned : null;
  const home = owned ? (x: number, y: number) => owned[y * MAP_WIDTH + x] === 1 : onStartLand;
  const objects = (Array.isArray(raw.objects) ? raw.objects : []).flatMap((o) =>
    isPlainObject(o) && typeof o.type === 'string' && isInt(o.x) && isInt(o.y) ? [{ type: o.type, x: o.x, y: o.y }] : [],
  );
  const clock = isPlainObject(raw.clock) ? raw.clock : {};
  const seed = (typeof clock.elapsed === 'number' && Number.isFinite(clock.elapsed) ? Math.floor(clock.elapsed) : 0) ^ 0x5eed;
  return generateMapLayer(home, occupantsOf(objects), seed);
}

/** Counts for `window.farm.map` and tests. */
export function mapCounts(layer: MapLayer, now: number): { grown: number; stumps: number } {
  let grown = 0;
  for (const t of layer.trees) if (treeStatus(t, now) === 'grown') grown++;
  return { grown, stumps: layer.trees.length - grown };
}
