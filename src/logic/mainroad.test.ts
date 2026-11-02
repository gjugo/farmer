import { describe, expect, it } from 'vitest';
import { PATH } from '../data/farmhouse';
import { MAP_HEIGHT, MAP_WIDTH, START_LAND } from './constants';
import { Game } from './game';
import {
  depthIn,
  ensureMainRoad,
  isRoadTile,
  MAX_MERCHANTS,
  MERCHANT_MS_PER_TILE,
  merchantsAt,
  planRoad,
  ROAD_BAND,
  ROAD_SLICE,
  roadOf,
  type RoadState,
} from './mainroad';
import { depositAt, mapOf, treeAt } from './maplayer';
import { canPlace } from './placement';
import { connectToFarmhouse, doorOf, farmhouseOf, findRoute, pathNetwork } from './roads';
import { footprintOf } from './game';
import { POND, sceneryArt } from './scenery';
import { createNewGame } from './state';
import type { GameState } from './types';

/** A new farm whose road is laid from `seed` (the map around it is the new farm's own, random). */
function farmWithRoad(seed: number): GameState {
  const state = createNewGame();
  state.ext[ROAD_SLICE] = { seed, side: null, tiles: [], pending: true } satisfies RoadState;
  ensureMainRoad(state);
  return state;
}

const SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i * 7919);

describe('main road', () => {
  it('a new farm has one, laid at once', () => {
    const road = roadOf(createNewGame());
    expect(road.side).not.toBeNull();
    expect(road.tiles.length).toBeGreaterThan(Math.min(MAP_WIDTH, MAP_HEIGHT));
    expect(road.pending).toBe(false);
  });

  it('runs from map edge to map edge along its side, each tile next to the last, in the band 2–7 tiles in', () => {
    for (const seed of SEEDS) {
      const road = roadOf(farmWithRoad(seed));
      const { side, tiles } = road;
      const first = tiles[0];
      const last = tiles[tiles.length - 1];
      if (side === 'north' || side === 'south') {
        expect(first.x, `${seed}`).toBe(0);
        expect(last.x, `${seed}`).toBe(MAP_WIDTH - 1);
      } else {
        expect(first.y, `${seed}`).toBe(0);
        expect(last.y, `${seed}`).toBe(MAP_HEIGHT - 1);
      }
      for (let i = 1; i < tiles.length; i++) expect(Math.abs(tiles[i].x - tiles[i - 1].x) + Math.abs(tiles[i].y - tiles[i - 1].y)).toBe(1);
      expect(new Set(tiles.map((t) => `${t.x},${t.y}`)).size).toBe(tiles.length);
      for (const t of tiles) {
        const d = depthIn(side!, t.x, t.y);
        expect(d, `${seed}: ${t.x},${t.y}`).toBeGreaterThanOrEqual(ROAD_BAND.min);
        expect(d, `${seed}: ${t.x},${t.y}`).toBeLessThanOrEqual(ROAD_BAND.max);
      }
    }
  });

  it('winds gently: it moves in or out of its line now and then, never straight across', () => {
    let bends = 0;
    for (const seed of SEEDS) {
      const { side, tiles } = roadOf(farmWithRoad(seed));
      const depths = new Set(tiles.map((t) => depthIn(side!, t.x, t.y)));
      if (depths.size > 1) bends++;
    }
    expect(bends).toBeGreaterThan(SEEDS.length / 2);
  });

  it('different seeds put it on different sides', () => {
    const sides = new Set(SEEDS.map((seed) => roadOf(farmWithRoad(seed)).side));
    expect(sides.size).toBeGreaterThanOrEqual(3);
  });

  it('never goes through the start, and stays a real walk from the farmhouse', () => {
    for (const seed of SEEDS) {
      const state = farmWithRoad(seed);
      const door = doorOf(farmhouseOf(state)!);
      let nearest = Infinity;
      for (const t of roadOf(state).tiles) {
        const inStart = t.x >= START_LAND.x && t.y >= START_LAND.y && t.x < START_LAND.x + START_LAND.w && t.y < START_LAND.y + START_LAND.h;
        expect(inStart, `${seed}: ${t.x},${t.y}`).toBe(false);
        nearest = Math.min(nearest, Math.abs(t.x - door.x) + Math.abs(t.y - door.y));
      }
      expect(nearest, `${seed}`).toBeGreaterThanOrEqual(12);
    }
  });

  it('avoids ponds and deposits and cuts through forests: no tree is left on it', () => {
    for (const seed of SEEDS) {
      const state = farmWithRoad(seed);
      const layer = mapOf(state);
      for (const t of roadOf(state).tiles) {
        expect(sceneryArt(t.x, t.y), `${seed}: ${t.x},${t.y}`).not.toBe(POND);
        expect(depositAt(layer, t.x, t.y), `${seed}: ${t.x},${t.y}`).toBeUndefined();
        expect(treeAt(layer, t.x, t.y), `${seed}: ${t.x},${t.y}`).toBeUndefined();
      }
    }
  });

  it('goes round a pond, deposit or building on its line', () => {
    const state = farmWithRoad(4242);
    const road = roadOf(state);
    // A wall of buildings across the middle of the road, with no gap in the band.
    const mid = road.tiles[Math.floor(road.tiles.length / 2)];
    const blockers = [];
    for (let d = ROAD_BAND.min; d <= ROAD_BAND.max; d++) {
      const t = road.side === 'north' || road.side === 'south' ? { x: mid.x, y: road.side === 'north' ? d : MAP_HEIGHT - 1 - d } : { x: road.side === 'west' ? d : MAP_WIDTH - 1 - d, y: mid.y };
      blockers.push({ ...t, w: 1, h: 1 });
    }
    const plan = planRoad(state, road.seed, blockers)!;
    expect(plan.side).toBe(road.side);
    for (const t of plan.tiles) expect(blockers.some((b) => b.x === t.x && b.y === t.y)).toBe(false);
    // It had to leave the band to get round: the wider band was used.
    expect(plan.tiles.some((t) => depthIn(plan.side, t.x, t.y) < ROAD_BAND.min || depthIn(plan.side, t.x, t.y) > ROAD_BAND.max)).toBe(true);
  });

  it('is laid out the same from the same seed', () => {
    const a = farmWithRoad(77);
    const b = farmWithRoad(77);
    // The maps differ (random per new farm), so only compare where the maps leave it alone: the side.
    expect(roadOf(a).side).toBe(roadOf(b).side);
    const s = createNewGame();
    expect(planRoad(s, 5)).toEqual(planRoad(s, 5));
  });

  it('nothing is built on it: a path on it is refused too', () => {
    const state = farmWithRoad(9);
    const t = roadOf(state).tiles[5];
    expect(canPlace(state, { w: 1, h: 1 }, t.x, t.y, footprintOf, PATH)).toEqual({ ok: false, reason: 'road' });
    expect(canPlace(state, { w: 1, h: 1 }, t.x, t.y, footprintOf, 'granary')).toEqual({ ok: false, reason: 'road' });
    const game = new Game(state);
    const n = state.objects.length;
    expect(game.place(PATH, t.x, t.y).ok).toBe(false);
    expect(state.objects.length).toBe(n);
  });

  it('counts as path: a path from the farmhouse to it reaches whatever stands by the road', () => {
    const game = new Game(farmWithRoad(31));
    const state = game.state;
    const road = roadOf(state).tiles;
    // A site beside the road, far along it from where the farm's path meets it.
    const far = road[road.length - 3];
    const site = [
      { x: far.x, y: far.y - 1 },
      { x: far.x, y: far.y + 1 },
      { x: far.x - 1, y: far.y },
      { x: far.x + 1, y: far.y },
    ].find((t) => !isRoadTile(state, t.x, t.y) && t.x >= 0 && t.y >= 0 && t.x < MAP_WIDTH && t.y < MAP_HEIGHT)!;
    const area = { ...site, w: 1, h: 1 };
    expect(findRoute(state, area)).toBeNull();
    // Lay a path from the door to the nearest road tile (free paths, like a new farm's).
    const near = [...road].sort((a, b) => {
      const d = doorOf(farmhouseOf(state)!);
      return Math.abs(a.x - d.x) + Math.abs(a.y - d.y) - (Math.abs(b.x - d.x) + Math.abs(b.y - d.y));
    })[0];
    layPathTo(state, near);
    expect(pathNetwork(state).has(`${far.x},${far.y}`)).toBe(true);
    const route = findRoute(state, area)!;
    expect(route).not.toBeNull();
    expect(route.tiles.some((t) => isRoadTile(state, t.x, t.y))).toBe(true);
  });
});

/** Lays free paths from the farmhouse door to a tile next to the road tile `to`. */
function layPathTo(state: GameState, to: { x: number; y: number }): void {
  expect(connectToFarmhouse(state, { x: to.x, y: to.y, w: 1, h: 1 })).toBe(true);
}

describe('merchants', () => {
  const road = { seed: 123, tiles: Array.from({ length: 64 }, (_, x) => ({ x, y: 4 })) };
  const travel = 63 * MERCHANT_MS_PER_TILE;

  it('cross the road now and then, never more than two at once, and are the same for the same time', () => {
    let seen = 0;
    let most = 0;
    for (let t = 0; t < travel * 40; t += travel / 25) {
      const m = merchantsAt(road, t);
      most = Math.max(most, m.length);
      seen += m.length;
      expect(merchantsAt(road, t)).toEqual(m);
    }
    expect(seen).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(MAX_MERCHANTS);
    expect(most).toBe(2);
  });

  it('drive along the road from one end to the other, facing their way, both ways', () => {
    const dirs = new Set<number>();
    for (let t = 0; t < travel * 40; t += travel / 10) {
      for (const m of merchantsAt(road, t)) {
        expect(m.y).toBeCloseTo(4.5);
        expect(m.x).toBeGreaterThanOrEqual(0.5);
        expect(m.x).toBeLessThanOrEqual(63.5);
        expect(Math.abs(m.dx) + Math.abs(m.dy)).toBe(1);
        dirs.add(m.dx);
        // Later the same cart is further along its way.
        const later = merchantsAt(road, t + MERCHANT_MS_PER_TILE).find((n) => n.id === m.id);
        if (later) expect((later.x - m.x) * m.dx).toBeGreaterThan(0);
      }
    }
    expect(dirs).toEqual(new Set([1, -1]));
  });

  it('none on a farm without a road', () => {
    expect(merchantsAt({ seed: 1, tiles: [] }, 1e9)).toEqual([]);
  });
});
