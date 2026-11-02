import { describe, expect, it } from 'vitest';
import { getBuildable } from '../data/buildables';
import { CAMP, CAMP_FOOTPRINT, CAMP_SUPPLIES } from '../data/camp';
import { FIELD } from '../data/crops';
import { FARMHOUSE, PATH } from '../data/farmhouse';
import { FARMHOUSE_STORE } from '../data/storage';
import { campInfo, campOf, campSlice } from './camp';
import { DAY_MS } from './constants';
import { Game } from './game';
import { depositAt, MAP_SLICE, mapOf, newMapLayer, treeAt } from './maplayer';
import { sell } from './market';
import { deserialize, serialize } from './save';
import { createNewGame } from './state';
import { capacity, spaceFor, storageInfo } from './storage';
import { bareMap, noCamp } from './test-utils';
import type { GameState, PlacedObject } from './types';

const SUPPLY_ROOM = { goods: 30, materials: 60 };

function newFarm(): Game {
  const game = new Game(bareMap(createNewGame()));
  game.earn(10_000);
  return game;
}

/** Takes `qty` of `id` out the way the game does (building, meals, selling all end in `removeItem`). */
function take(game: Game, id: string, qty: number): void {
  expect(game.removeItem(id, qty)).toBe(true);
}

function area(o: PlacedObject) {
  const fp = getBuildable(o.type)!.footprint;
  return { x: o.x, y: o.y, w: fp.w, h: fp.h };
}

function touches(a: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  const inside = (tx: number, ty: number) => tx >= a.x && ty >= a.y && tx < a.x + a.w && ty < a.y + a.h;
  return !inside(x, y) && [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => inside(x + dx, y + dy));
}

describe('a new game', () => {
  it('has a 3×3 camp beside the farmhouse, next to the path, on the side away from the fields', () => {
    const state = createNewGame();
    const camp = campOf(state)!;
    expect(camp).toBeDefined();
    expect(getBuildable(CAMP)!.footprint).toEqual(CAMP_FOOTPRINT);
    const house = state.objects.find((o) => o.type === FARMHOUSE)!;
    const fields = state.objects.filter((o) => o.type === FIELD);
    const cx = (o: PlacedObject) => area(o).x + area(o).w / 2;
    // The fields lie on one side of the farmhouse, the camp on the other.
    for (const f of fields) expect(Math.sign(cx(camp) - cx(house))).toBe(-Math.sign(cx(f) - cx(house)));
    expect(Math.abs(cx(camp) - cx(house))).toBeLessThanOrEqual(3);
    expect(state.objects.some((o) => o.type === PATH && touches(area(camp), o.x, o.y))).toBe(true);
  });

  it('starts with the supplies as ordinary stock, the camp recording them as left and making room for them', () => {
    const state = createNewGame();
    expect(state.inventory).toEqual(CAMP_SUPPLIES);
    expect(campInfo(state)).toEqual({ id: campOf(state)!.id, left: CAMP_SUPPLIES, room: SUPPLY_ROOM, packed: false, families: 0, waiting: 0 });
    expect(storageInfo(state)).toEqual({
      goods: { used: 30, capacity: FARMHOUSE_STORE.goods + SUPPLY_ROOM.goods },
      materials: { used: 60, capacity: FARMHOUSE_STORE.materials + SUPPLY_ROOM.materials },
    });
  });

  it('keeps the camp clear of the generated trees and rocks, whatever the seed', () => {
    for (const seed of [1, 3, 777, 20261031, 99]) {
      const state = createNewGame();
      state.ext[MAP_SLICE] = newMapLayer(state, seed);
      const camp = campOf(state)!;
      const layer = mapOf(state);
      for (let y = camp.y; y < camp.y + CAMP_FOOTPRINT.h; y++) {
        for (let x = camp.x; x < camp.x + CAMP_FOOTPRINT.w; x++) {
          expect(treeAt(layer, x, y), `tree at ${x},${y} (seed ${seed})`).toBeUndefined();
          expect(depositAt(layer, x, y), `deposit at ${x},${y} (seed ${seed})`).toBeUndefined();
        }
      }
    }
  });

  it('cannot be demolished and is not in the build menu', () => {
    const game = newFarm();
    expect(getBuildable(CAMP)!.fixed).toBe(true);
    expect(game.checkDemolish(campOf(game.state)!.id)).toEqual({ ok: false, reason: 'fixed' });
  });
});

describe('what is left', () => {
  it('building with wood or stone takes it out of the camp first', () => {
    const game = newFarm();
    const camp = campOf(game.state)!;
    const r = game.place('granary', camp.x, camp.y + 4); // free land in front of the camp
    expect(r.ok).toBe(true);
    expect(campInfo(game.state)!.left.wood).toBe(40 - getBuildable('granary')!.materials!.wood!);
    expect(campInfo(game.state)!.left.wood).toBe(game.count('wood'));
  });

  it('selling takes it out of the camp first', () => {
    const game = newFarm();
    expect(sell(game, 'bread', 5)).toBeGreaterThan(0);
    expect(campInfo(game.state)!.left.bread).toBe(10);
  });

  it("the families' meals come out of the camp", () => {
    const game = newFarm();
    game.advance(2 * DAY_MS);
    const left = campInfo(game.state)!.left;
    // One family, 2 food a day, spread over bread and carrots.
    expect((left.bread ?? 0) + (left.carrot ?? 0)).toBe(30 - 2 * 2);
    expect(left.bread).toBe(game.count('bread'));
  });

  it('new stock never refills it, and is spent before the camp is touched', () => {
    const game = newFarm();
    take(game, 'wood', 10);
    expect(campInfo(game.state)!.left.wood).toBe(30);
    // More room came with the farmhouse store: lodge wood or a purchase goes into the inventory, not the camp.
    expect(game.addItem('wood', 20)).toBe(20);
    expect(game.count('wood')).toBe(50);
    expect(campInfo(game.state)!.left.wood).toBe(30);
    take(game, 'wood', 15); // 35 in stock: still more than the camp's 30
    expect(campInfo(game.state)!.left.wood).toBe(30);
    take(game, 'wood', 10); // 25 in stock: the camp has given 5 more
    expect(campInfo(game.state)!.left.wood).toBe(25);
  });
});

describe('storage room', () => {
  it('the camp adds its left in each pool, so the supplies fit, and the room shrinks as they go', () => {
    const game = newFarm();
    expect(capacity(game.state, 'materials')).toBe(FARMHOUSE_STORE.materials + 60);
    // Exactly the farmhouse store is free for anything new.
    expect(spaceFor(game.state, 'wood')).toBe(FARMHOUSE_STORE.materials);
    expect(spaceFor(game.state, 'wheat')).toBe(FARMHOUSE_STORE.goods);
    take(game, 'stone', 8);
    expect(capacity(game.state, 'materials')).toBe(FARMHOUSE_STORE.materials + 52);
    // Nothing new is ever stored in the camp: spending supplies frees no room.
    expect(spaceFor(game.state, 'wood')).toBe(FARMHOUSE_STORE.materials);
  });
});

describe('packing away', () => {
  function useUp(game: Game): PlacedObject[] {
    const removed: PlacedObject[] = [];
    game.events.on('objectRemoved', (o) => removed.push(o));
    for (const [id, n] of Object.entries(CAMP_SUPPLIES)) take(game, id, n!);
    return removed;
  }

  it('happens once every left is 0: the camp goes and its tiles are free to build on', () => {
    const game = newFarm();
    const camp = campOf(game.state)!;
    for (const [id, n] of Object.entries(CAMP_SUPPLIES)) {
      expect(campOf(game.state)).toBeDefined(); // not before the last of them
      take(game, id, n!);
    }
    expect(campOf(game.state)).toBeUndefined();
    expect(campInfo(game.state)).toEqual({ id: camp.id, left: {}, room: { goods: 0, materials: 0 }, packed: true, families: 0, waiting: 0 });
    expect(storageInfo(game.state).materials.capacity).toBe(FARMHOUSE_STORE.materials);
    expect(game.checkPlacement('granary', camp.x, camp.y)).toEqual({ ok: true });
  });

  it('announces the removal once, with the camp object', () => {
    const game = newFarm();
    const id = campOf(game.state)!.id;
    const removed = useUp(game);
    expect(removed.map((o) => [o.type, o.id])).toEqual([[CAMP, id]]);
    game.addItem('wood', 5);
    take(game, 'wood', 5);
    expect(removed).toHaveLength(1);
  });

  it('is not undone by new stock', () => {
    const game = newFarm();
    useUp(game);
    game.addItem('bread', 3);
    expect(campInfo(game.state)!.packed).toBe(true);
    expect(campOf(game.state)).toBeUndefined();
  });
});

describe('saves', () => {
  it('keep what is left', () => {
    const game = newFarm();
    take(game, 'wood', 8);
    take(game, 'bread', 3);
    const loaded = deserialize(serialize(game.state));
    expect(campInfo(loaded)).toEqual(campInfo(game.state));
    expect(campInfo(loaded)!.left).toEqual({ wood: 32, stone: 20, bread: 12, carrot: 15 });
  });

  it('keep the camp packed away', () => {
    const game = newFarm();
    for (const [id, n] of Object.entries(CAMP_SUPPLIES)) take(game, id, n!);
    const loaded = deserialize(serialize(game.state));
    expect(campOf(loaded)).toBeUndefined();
    expect(campInfo(loaded)!.packed).toBe(true);
  });

  it('from before the camp load with no camp and the same stock', () => {
    const old: GameState = noCamp(createNewGame());
    old.inventory = { wheat: 12, wood: 4 };
    delete old.ext.camp;
    const loaded = deserialize(serialize(old));
    expect(campInfo(loaded)).toBeNull();
    expect(campSlice(loaded)).toEqual({ id: null, packed: false, families: 0 });
    expect(loaded.inventory).toEqual({ wheat: 12, wood: 4 });
    expect(storageInfo(loaded).goods.capacity).toBe(FARMHOUSE_STORE.goods);
    // Spending their stock never makes a camp appear or vanish.
    const game = new Game(loaded);
    take(game, 'wood', 4);
    expect(campInfo(game.state)).toBeNull();
  });
});
