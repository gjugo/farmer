import { describe, expect, it } from 'vitest';
import { FIELD } from '../data/crops';
import { FARMHOUSE, PATH } from '../data/farmhouse';
import { START_LAYOUT } from './constants';
import { STARTING_FIELDS } from './crops';
import { Game } from './game';
import { doorOf, ensureFarmhouse, farmhouseOf, findRoute, STARTING_FARMHOUSE, type Tile } from './roads';
import { deserialize, serialize } from './save';
import { createNewGame } from './state';
import { fromV6, v6Land, V6_START } from './test-utils';
import type { GameState } from './types';

const field = (t: Tile) => ({ ...t, w: 2, h: 2 });
const paths = (state: GameState) => state.objects.filter((o) => o.type === PATH);
const isNeighbour = (a: Tile, b: Tile) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

describe('farmhouse and roads', () => {
  it('a new farm has a farmhouse with a road from its door to both starting fields', () => {
    const state = createNewGame();
    const house = farmhouseOf(state)!;
    expect(house).toMatchObject({ type: FARMHOUSE, ...STARTING_FARMHOUSE });
    for (const f of STARTING_FIELDS) {
      const route = findRoute(state, field(f))!;
      expect(route.tiles[0]).toEqual(doorOf(house));
      route.tiles.slice(1).forEach((t, i) => expect(isNeighbour(t, route.tiles[i])).toBe(true));
      // The farmer works on the field tile next to the last path tile.
      const last = route.tiles[route.tiles.length - 1];
      const work = { x: route.work.x - 0.5, y: route.work.y - 0.5 };
      expect(isNeighbour(last, work)).toBe(true);
      expect(work.x - f.x).toBeGreaterThanOrEqual(0);
      expect(work.y - f.y).toBeGreaterThanOrEqual(0);
      expect(work.x - f.x).toBeLessThan(2);
      expect(work.y - f.y).toBeLessThan(2);
    }
  });

  it('there is no route to a site no path touches, until one is built', () => {
    const game = new Game();
    const site = field({ x: START_LAYOUT.x + 5, y: START_LAYOUT.y + 4 });
    expect(game.place(FIELD, site.x, site.y).ok).toBe(true);
    expect(findRoute(game.state, site)).toBeNull();
    // Down from the road in front of the fields to the new field's top edge.
    const road = findRoute(game.state, field(STARTING_FIELDS[1]))!.tiles;
    const from = road.find((t) => t.x === site.x)!;
    for (let y = from.y + 1; y < site.y; y++) expect(game.place(PATH, site.x, y).ok).toBe(true);
    const route = findRoute(game.state, site)!;
    expect(route.tiles[route.tiles.length - 1]).toEqual({ x: site.x, y: site.y - 1 });
    expect(route.work).toEqual({ x: site.x + 0.5, y: site.y + 0.5 });
  });

  it('demolishing a path cuts the road', () => {
    const game = new Game();
    const site = field(STARTING_FIELDS[0]);
    const [, second] = findRoute(game.state, site)!.tiles;
    const piece = game.objectAt(second.x, second.y)!;
    game.demolish(piece.id);
    expect(findRoute(game.state, site)).toBeNull();
  });

  it('the road must start at the door', () => {
    const game = new Game();
    const door = doorOf(farmhouseOf(game.state)!);
    game.demolish(game.objectAt(door.x, door.y)!.id);
    for (const f of STARTING_FIELDS) expect(findRoute(game.state, field(f))).toBeNull();
  });

  it('the farmhouse is not in the build menu and cannot be demolished', () => {
    const game = new Game();
    const house = farmhouseOf(game.state)!;
    expect(game.demolish(house.id)).toBeNull();
    expect(farmhouseOf(game.state)).toBe(house);
  });

  it('a farm from before farmhouses gets one, with roads to what is built', () => {
    // Version-5 coordinates: the 32×24 map with its starting land at (11, 8).
    const objects = [
      { id: 'o1', type: FIELD, x: V6_START.x + 1, y: V6_START.y + 5, state: {} },
      { id: 'o2', type: 'coop', x: V6_START.x + 6, y: V6_START.y + 4, state: { animals: [] } },
    ];
    const state = deserialize(JSON.stringify({ version: 5, savedAt: null, state: { land: v6Land(), objects, nextObjectId: 3 } }));
    expect(farmhouseOf(state)).toMatchObject(STARTING_FARMHOUSE);
    expect(findRoute(state, { ...fromV6(objects[0].x, objects[0].y), w: 2, h: 2 })).not.toBeNull();
    expect(findRoute(state, { ...fromV6(objects[1].x, objects[1].y), w: 3, h: 3 })).not.toBeNull();
    // Loading again changes nothing.
    const again = deserialize(serialize(state));
    expect(again.objects).toEqual(state.objects);
  });

  it('the farmhouse goes on the nearest free spot when its usual one is taken', () => {
    const state = createNewGame();
    state.objects = [{ id: 'o1', type: 'coop', x: STARTING_FARMHOUSE.x, y: STARTING_FARMHOUSE.y, state: { animals: [] } }];
    ensureFarmhouse(state);
    const house = farmhouseOf(state)!;
    expect(house).not.toMatchObject(STARTING_FARMHOUSE);
    expect(findRoute(state, { x: STARTING_FARMHOUSE.x, y: STARTING_FARMHOUSE.y, w: 3, h: 3 })).not.toBeNull();
    expect(paths(state).some((p) => p.x === doorOf(house).x && p.y === doorOf(house).y)).toBe(true);
  });
});
