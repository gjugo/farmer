import { getBuildable } from '../data/buildables';
import { FARMHOUSE, FARMHOUSE_DEF, FARMHOUSE_FOOTPRINT, MAX_FARMHOUSE_LEVEL, PATH, type FarmhouseLevel } from '../data/farmhouse';
import type { Game } from './game';
import { farmhouseLevel } from './homes';
import { inBounds } from './land';
import { isRoadTile, roadTiles } from './mainroad';
import { clearUnder, mapOf, removeTrees, treeAt } from './maplayer';
import { ruleBlock } from './placement';
import { farmhouseDoor, farmhouseOf, layRoad, type Area, type Tile } from './roads';
import { getSlice, registerStateSlice } from './slices';
import { addStartingObject } from './state';
import type { GameState, PlacedObject } from './types';
import type { Job } from './workers';
import { applyUpgrade, checkUpgrade, nextLevel, upgradeChecklist, type CheckLine, type UpgradeChecklist, type UpgradeDef } from './upgrades';

/**
 * Farmhouse levels, like Manor Lords' manor: the farmhouse grows into a manor house and then a manor hall, each
 * housing more families, storing more and adding more approval (`FARMHOUSE_DEF.levels`, `src/data/farmhouse.ts`). Like a
 * cottage's, an upgrade needs the farm's level and a winter's firewood left after its wood, and the farmhouse also asks
 * for enough families and approval; then the cost is paid and a free farmer rebuilds it. It never goes down a level.
 * The checklist and upgrade are shared with the cottage (`src/logic/upgrades.ts`).
 */

const FARMHOUSE_UPGRADE: UpgradeDef = { type: FARMHOUSE, levels: FARMHOUSE_DEF.levels };

export type FarmhouseUpgrade = Required<FarmhouseLevel>['upgrade'] & { level: number; room: number };

/** The next level and what it asks, or null at the top level (or for anything that isn't the farmhouse). */
export function nextFarmhouseLevel(obj: PlacedObject): FarmhouseUpgrade | null {
  return nextLevel(FARMHOUSE_UPGRADE, obj) as FarmhouseUpgrade | null;
}

export type FarmhouseChecklist = UpgradeChecklist & { families: CheckLine; approval: CheckLine };

/** The upgrade's checklist (level, families, approval, fuel, cost); `blocked: 'max'` at the top level. Pure. */
export function farmhouseChecklist(game: Game, obj: PlacedObject): FarmhouseChecklist {
  return upgradeChecklist(game, FARMHOUSE_UPGRADE, obj) as FarmhouseChecklist;
}

export type FarmhouseUpgradeResult = { ok: true; level: number } | { ok: false; reason: 'not-farmhouse' | 'site' | 'max' | 'needs' };

/** Checks without changing anything; `upgradeFarmhouse` gives the same answer. */
export function checkFarmhouseUpgrade(game: Game, obj: PlacedObject): FarmhouseUpgradeResult {
  return checkUpgrade(game, FARMHOUSE_UPGRADE, obj, 'not-farmhouse');
}

/** Charges the next level's money and materials and raises the level (room, store, approval). Nothing changes when it fails. */
export function upgradeFarmhouse(game: Game, obj: PlacedObject): FarmhouseUpgradeResult {
  return applyUpgrade(game, FARMHOUSE_UPGRADE, obj, 'not-farmhouse');
}

/** What a level gives. */
export function farmhouseLevelDef(level: number): FarmhouseLevel {
  return FARMHOUSE_DEF.levels[Math.max(1, Math.min(MAX_FARMHOUSE_LEVEL, level)) - 1];
}

/** Debug: raises the farmhouse a level for free, skipping the needs (built or not). False when there is none or it is at the top. */
export function raiseFarmhouse(game: Game): boolean {
  const house = farmhouseOf(game.state);
  if (!house) return false;
  const level = farmhouseLevel(house);
  if (level >= MAX_FARMHOUSE_LEVEL) return false;
  house.state.level = level + 1;
  game.touch(house);
  return true;
}

/** `window.farm.farmhouse`: null without one; else its level, room, store and the upgrade checklist. */
export function farmhouseInfo(game: Game): {
  id: string;
  site: boolean;
  level: number;
  name: string;
  room: number;
  store: FarmhouseLevel['store'];
  approval: number;
  upgrade: Omit<FarmhouseChecklist, 'lines'> & { lines: { id: string; ok: boolean; text: string }[] };
} | null {
  const house = farmhouseOf(game.state);
  if (!house) return null;
  const at = farmhouseLevelDef(farmhouseLevel(house));
  return structuredClone({
    id: house.id,
    site: !!house.site,
    level: farmhouseLevel(house),
    name: at.name,
    room: at.room,
    store: at.store,
    approval: at.approval,
    upgrade: farmhouseChecklist(game, house),
  });
}

// Old saves: the 2×2 farmhouse grows to 3×3 ---------------------------------------------------------------------

/** Saves older than this have a 2×2 farmhouse, which grows to the 3×3 one at level 1 when they load (`growFarmhouse`). */
export const FARMHOUSE_GROWN_IN = 18;

/** The old farmhouse: 2×2, the tile in front of its door at (1, 2) from its top-left tile. */
const OLD_FOOTPRINT = { w: 2, h: 2 } as const;

/**
 * Where the 3×3 can stand over the old 2×2, as offsets of its top-left tile: first the one that keeps the door tile
 * (one row further back, the door in the same place), then the others that cover the old footprint.
 */
const OVER_OLD: readonly Tile[] = [
  { x: 0, y: -1 },
  { x: 0, y: 0 },
  { x: -1, y: -1 },
  { x: -1, y: 0 },
];

export const FARMHOUSE_SLICE = 'farmhouse';

export interface FarmhouseNoticeState {
  /** Tell the player once that the farmhouse had to move to grow (set when an old save loads). */
  movedNotice: boolean;
}

registerStateSlice<FarmhouseNoticeState>(FARMHOUSE_SLICE, () => ({ movedNotice: false }));

/** True once after an old save's farmhouse moved to grow: the caller shows the toast. */
export function takeFarmhouseMovedNotice(state: GameState): boolean {
  const s = getSlice<FarmhouseNoticeState>(state, FARMHOUSE_SLICE);
  if (s.movedNotice !== true) return false;
  s.movedNotice = false;
  return true;
}

export const FARMHOUSE_MOVED_MESSAGE = '🏠 The farmhouse grew into a bigger house: there was no room where it stood, so it moved nearby. Its paths are joined up.';

const tileKey = (x: number, y: number) => `${x},${y}`;
const STEPS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

function areaTiles(a: Area): Tile[] {
  const out: Tile[] = [];
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) out.push({ x, y });
  return out;
}

function inArea(a: Area, x: number, y: number): boolean {
  return x >= a.x && y >= a.y && x < a.x + a.w && y < a.y + a.h;
}

/** Path tiles (the main road's too), as keys. */
function pathKeys(state: GameState): Set<string> {
  const out = new Set(roadTiles(state).map((t) => tileKey(t.x, t.y)));
  for (const o of state.objects) if (o.type === PATH) out.add(tileKey(o.x, o.y));
  return out;
}

/** The path tiles joined (along paths) to a path along the edges of `area`. */
function networkAt(paths: ReadonlySet<string>, area: Area): Set<string> {
  const seen = new Set<string>();
  const queue: Tile[] = [];
  for (let y = area.y - 1; y <= area.y + area.h; y++) {
    for (let x = area.x - 1; x <= area.x + area.w; x++) {
      if (inArea(area, x, y) || !paths.has(tileKey(x, y))) continue;
      // Edges only, not the corners.
      if ((x < area.x || x >= area.x + area.w) && (y < area.y || y >= area.y + area.h)) continue;
      seen.add(tileKey(x, y));
      queue.push({ x, y });
    }
  }
  for (let i = 0; i < queue.length; i++) {
    for (const [dx, dy] of STEPS) {
      const k = tileKey(queue[i].x + dx, queue[i].y + dy);
      if (seen.has(k) || !paths.has(k)) continue;
      seen.add(k);
      queue.push({ x: queue[i].x + dx, y: queue[i].y + dy });
    }
  }
  return seen;
}

/** The object other than `house` covering tile (x, y). */
function objectOn(state: GameState, house: PlacedObject, x: number, y: number): PlacedObject | undefined {
  return state.objects.find((o) => {
    if (o === house) return false;
    const fp = getBuildable(o.type)?.footprint ?? { w: 1, h: 1 };
    return x >= o.x && y >= o.y && x < o.x + fp.w && y < o.y + fp.h;
  });
}

/** Can a tile be cleared for the house: in the map, nothing but a path, a tree, a stump or decor on it, not the main road? */
function clearable(state: GameState, house: PlacedObject, x: number, y: number): boolean {
  if (!inBounds(state.land, x, y) || isRoadTile(state, x, y)) return false;
  const o = objectOn(state, house, x, y);
  if (o && o.type !== PATH) return false;
  return !!treeAt(mapOf(state), x, y) || !ruleBlock(state, { w: 1, h: 1 }, x, y);
}

/** Can the tile in front of the door be walked once cleared: a path, the main road, or a tile that can take one? */
function doorClear(state: GameState, house: PlacedObject, door: Tile): boolean {
  return isRoadTile(state, door.x, door.y) || clearable(state, house, door.x, door.y);
}

/** The 3×3 can stand at (x, y) over what is there now, clearing paths, trees and stumps. */
function fitsOver(state: GameState, house: PlacedObject, x: number, y: number): boolean {
  const area = { x, y, ...FARMHOUSE_FOOTPRINT };
  return areaTiles(area).every((t) => clearable(state, house, t.x, t.y)) && doorClear(state, house, farmhouseDoor(area));
}

/**
 * Grows an old save's 2×2 farmhouse (finished or a site) into the 3×3 one at level 1, keeping its id, store and
 * families: over its old footprint when it fits there (the placement that keeps the door tile first), clearing the
 * paths, trees and stumps on the new tiles; else on the nearest free 3×3 whose door is next to a path (the player is
 * told once, `takeFarmhouseMovedNotice`). The door gets a path, and every path that reached the old house is joined to
 * the new one. Farmers on their way to it (or along a path that went) go back to idle. A farm without a farmhouse is
 * untouched. Only for saves from before version `FARMHOUSE_GROWN_IN` (`src/logic/save.ts`).
 */
export function growFarmhouse(state: GameState): 'none' | 'in-place' | 'moved' | 'stuck' {
  const house = farmhouseOf(state);
  if (!house) return 'none';
  const old = { x: house.x, y: house.y, ...OLD_FOOTPRINT };
  const before = networkAt(pathKeys(state), old);
  let at = OVER_OLD.map((d) => ({ x: old.x + d.x, y: old.y + d.y })).find((t) => fitsOver(state, house, t.x, t.y));
  const moved = !at;
  if (!at) at = nearestSpot(state, house, old) ?? undefined;
  if (!at) return 'stuck';

  // Clear the new tiles and the tile in front of the door.
  const area = { x: at.x, y: at.y, ...FARMHOUSE_FOOTPRINT };
  const door = farmhouseDoor(area);
  const gone = new Set(areaTiles(area).map((t) => tileKey(t.x, t.y)));
  state.objects = state.objects.filter((o) => !(o.type === PATH && gone.has(tileKey(o.x, o.y))));
  const layer = mapOf(state);
  removeTrees(layer, [...areaTiles(area), door]);
  clearUnder(layer, area, state.clock.elapsed, FARMHOUSE);
  house.x = area.x;
  house.y = area.y;
  if (!Number.isInteger(house.state.level)) house.state.level = 1;
  if (!isRoadTile(state, door.x, door.y) && !objectOn(state, house, door.x, door.y)) addStartingObject(state, PATH, door.x, door.y);

  // Every path that reached the old house reaches the new one.
  const starts = [door, ...edgeTiles(area)];
  for (const k of before) {
    if (gone.has(k)) continue;
    const [x, y] = k.split(',').map(Number);
    if (networkAt(pathKeys(state), area).has(k)) continue;
    layRoad(state, starts, { x, y, w: 1, h: 1 });
  }

  stopWalkersTo(state, house.id, gone, moved);
  if (moved) getSlice<FarmhouseNoticeState>(state, FARMHOUSE_SLICE).movedNotice = true;
  return moved ? 'moved' : 'in-place';
}

/** The tiles around an area's edges (not its corners). */
function edgeTiles(a: Area): Tile[] {
  const out: Tile[] = [];
  for (let x = a.x; x < a.x + a.w; x++) out.push({ x, y: a.y + a.h }, { x, y: a.y - 1 });
  for (let y = a.y; y < a.y + a.h; y++) out.push({ x: a.x + a.w, y }, { x: a.x - 1, y });
  return out;
}

/**
 * The nearest free 3×3 (nothing on it, nothing in the way) whose door tile is a path or the main road, or a free tile
 * beside one; failing that, the nearest free 3×3 with a free tile in front of its door. Null when there is none.
 */
function nearestSpot(state: GameState, house: PlacedObject, old: Area): Tile | null {
  const paths = pathKeys(state);
  const spots: Tile[] = [];
  for (let y = 0; y < state.land.height; y++) for (let x = 0; x < state.land.width; x++) spots.push({ x, y });
  const dist = (t: Tile) => Math.abs(t.x - old.x) + Math.abs(t.y - old.y);
  spots.sort((a, b) => dist(a) - dist(b) || a.y - b.y || a.x - b.x);
  const free = (t: Tile) => {
    const area = { x: t.x, y: t.y, ...FARMHOUSE_FOOTPRINT };
    return areaTiles(area).every((c) => inBounds(state.land, c.x, c.y) && !objectOn(state, house, c.x, c.y) && !ruleBlock(state, { w: 1, h: 1 }, c.x, c.y));
  };
  const doorFree = (t: Tile) => {
    const d = farmhouseDoor(t);
    if (!inBounds(state.land, d.x, d.y)) return false;
    if (paths.has(tileKey(d.x, d.y))) return true;
    return !objectOn(state, house, d.x, d.y) && !ruleBlock(state, { w: 1, h: 1 }, d.x, d.y);
  };
  const byPath = (t: Tile) => {
    const d = farmhouseDoor(t);
    return paths.has(tileKey(d.x, d.y)) || STEPS.some(([dx, dy]) => paths.has(tileKey(d.x + dx, d.y + dy)) && !inArea({ ...t, ...FARMHOUSE_FOOTPRINT }, d.x + dx, d.y + dy));
  };
  return spots.find((t) => free(t) && doorFree(t) && byPath(t)) ?? spots.find((t) => free(t) && doorFree(t)) ?? null;
}

/**
 * Farmers on their way to the farmhouse, or walking a path that went, go back to idle: their jobs end (a cart's load
 * goes into the stores).
 */
function stopWalkersTo(state: GameState, id: string, gone: ReadonlySet<string>, moved: boolean): void {
  const w = getSlice<{ jobs?: unknown }>(state, 'workers');
  if (!Array.isArray(w.jobs)) return;
  w.jobs = (w.jobs as Job[]).filter((j) => {
    const stop =
      j.target === id ||
      j.haul?.to === id ||
      (Array.isArray(j.route) && j.route.some((t) => gone.has(tileKey(t.x, t.y)))) ||
      // Moved: every route started at the old door.
      (moved && Array.isArray(j.route) && j.route.length > 0);
    if (stop && j.haul) for (const [item, n] of Object.entries(j.haul.load ?? {})) if (n > 0) state.inventory[item] = (state.inventory[item] ?? 0) + n;
    return !stop;
  });
}
