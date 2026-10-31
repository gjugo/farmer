import { describe, expect, it } from 'vitest';
import { getBuildable } from '../data/buildables';
import { RESOURCES, type ResourceType } from '../data/resourceBuildings';
import { START_LAND, START_LAYOUT } from './constants';
import { Game } from './game';
import { isOwned, setOwned } from './land';
import {
  addDeposit,
  addTrees,
  depositsUnder,
  generateMapLayer,
  MAP_SLICE,
  mapCounts,
  mapOf,
  newMapLayer,
  occupantsOf,
  regrowAll,
  REGROW_MS,
  sanitizeLayer,
  treeAt,
  treesInRange,
  treeStatus,
  type MapLayer,
} from './maplayer';
import { catchUp } from './offline';
import { buyParcel, FARM_PARCELS, parcelAt } from './parcels';
import { idleReason, type ResourceState } from './resources';
import { connectToFarmhouse } from './roads';
import { deserialize, serialize } from './save';
import { SEASON_MS } from './seasons';
import { createNewGame } from './state';
import { bareMap, maxLevelState } from './test-utils';
import type { GameState, PlacedObject } from './types';
import { nextWorkEvent, workplaceNext } from './work';
import { assignFarmer, hireFarmer } from './workers';

const MIN = 60_000;
const HOUR = 60 * MIN;
const X = START_LAYOUT.x;
const Y = START_LAYOUT.y;
const SEEDS = [1, 2, 3, 42, 777, 20261031, 0xdeadbeef];

const footprint = (o: PlacedObject) => ({ x: o.x, y: o.y, ...getBuildable(o.type)!.footprint });
const inside = (a: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= a.x && y >= a.y && x < a.x + a.w && y < a.y + a.h;
const near = (a: { x: number; y: number; w: number; h: number }, x: number, y: number, margin: number) =>
  x >= a.x - margin && y >= a.y - margin && x < a.x + a.w + margin && y < a.y + a.h + margin;

function newGameWith(seed: number): GameState {
  const state = createNewGame();
  state.ext[MAP_SLICE] = newMapLayer(state, seed);
  return state;
}

/** A top-level farm on a bare map, rich, with an empty inventory, owning the whole map unless `ownAll` is false. */
function farm(ownAll = true): Game {
  const game = new Game(maxLevelState());
  game.earn(1_000_000);
  game.state.inventory = {};
  const land = game.state.land;
  if (ownAll) for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) setOwned(land, x, y, true);
  return game;
}

/** Places a finished, staffed building with a path to it (the map must already have what it needs). */
function staff(game: Game, type: ResourceType, x = X + 1, y = Y + 5): PlacedObject<ResourceState> {
  for (const [id, qty] of Object.entries(RESOURCES[type].materials)) game.state.inventory[id] = (game.state.inventory[id] ?? 0) + qty;
  const r = game.place(type, x, y);
  if (!r.ok) throw new Error(`could not place ${type}: ${r.reason}`);
  game.state.inventory = {};
  if (!connectToFarmhouse(game.state, footprint(r.object))) throw new Error('no road');
  if (!assignFarmer(game, r.object.id).ok) {
    hireFarmer(game);
    assignFarmer(game, r.object.id);
  }
  return r.object as unknown as PlacedObject<ResourceState>;
}

/** Wood (or stone, iron) made over `ms`, in steps of `step`. */
function run(game: Game, ms: number, step = MIN): void {
  const end = game.now + ms;
  while (game.now < end) game.advance(Math.min(step, end - game.now));
}

const lodgeAt = { x: X + 1, y: Y + 5 } as const;
const lodgeArea = { ...lodgeAt, w: 2, h: 2 };

describe('map generation', () => {
  it.each(SEEDS)('seed %i: a grove of about 10 trees on the starting land, clear of the fields and paths', (seed) => {
    const state = newGameWith(seed);
    const layer = mapOf(state);
    const grove = layer.trees.filter((t) => inside(START_LAND, t.x, t.y));
    expect(grove.length).toBeGreaterThanOrEqual(8);
    expect(grove.length).toBeLessThanOrEqual(12);
    for (const o of state.objects) for (const t of grove) expect(near(footprint(o), t.x, t.y, 2), `${o.type} by ${t.x},${t.y}`).toBe(false);
  });

  it.each(SEEDS)('seed %i: a stone outcrop on the starting land, more out on locked land', (seed) => {
    const state = newGameWith(seed);
    const stone = mapOf(state).deposits.filter((d) => d.kind === 'stone');
    const start = stone.filter((d) => inside(START_LAND, d.x, d.y));
    expect(start).toHaveLength(1);
    expect(start[0]).toMatchObject({ w: 2, h: 2, left: 400, amount: 400 });
    expect(stone.length).toBeGreaterThanOrEqual(4);
    for (const d of stone) expect([2, 3]).toContain(d.w);
  });

  it.each(SEEDS)('seed %i: iron veins only on locked land, at least 2, one in a parcel next to the start', (seed) => {
    const state = newGameWith(seed);
    const veins = mapOf(state).deposits.filter((d) => d.kind === 'iron');
    expect(veins.length).toBeGreaterThanOrEqual(2);
    for (const v of veins) for (let y = v.y; y < v.y + v.h; y++) for (let x = v.x; x < v.x + v.w; x++) expect(isOwned(state.land, x, y)).toBe(false);
    const beside = (x: number, y: number) => {
      const p = parcelAt(FARM_PARCELS, x, y)!;
      const sharesEdge = (p.x === START_LAND.x && (p.y + p.h === START_LAND.y || p.y === START_LAND.y + START_LAND.h)) ||
        (p.y === START_LAND.y && (p.x + p.w === START_LAND.x || p.x === START_LAND.x + START_LAND.w));
      return sharesEdge;
    };
    expect(veins.some((v) => beside(v.x, v.y))).toBe(true);
    for (const v of veins) expect(v).toMatchObject({ left: 150, amount: 150 });
  });

  it.each(SEEDS)('seed %i: large forests on locked land; nothing overlaps anything', (seed) => {
    const state = newGameWith(seed);
    const layer = mapOf(state);
    const locked = layer.trees.filter((t) => !isOwned(state.land, t.x, t.y));
    expect(locked.length).toBeGreaterThanOrEqual(100);
    expect(layer.trees.length).toBeLessThanOrEqual(300); // sprites stay bounded
    const tiles = new Set<string>();
    const claim = (x: number, y: number) => {
      expect(tiles.has(`${x},${y}`), `${x},${y}`).toBe(false);
      tiles.add(`${x},${y}`);
    };
    for (const o of state.objects) for (let y = o.y; y < o.y + footprint(o).h; y++) for (let x = o.x; x < o.x + footprint(o).w; x++) claim(x, y);
    for (const t of layer.trees) claim(t.x, t.y);
    for (const d of layer.deposits) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) claim(x, y);
    // All grown, none felled yet.
    expect(mapCounts(layer, 0)).toEqual({ grown: layer.trees.length, stumps: 0 });
  });

  it('the same seed makes the same map; another seed another', () => {
    expect(newGameWith(5).ext[MAP_SLICE]).toEqual(newGameWith(5).ext[MAP_SLICE]);
    expect(newGameWith(5).ext[MAP_SLICE]).not.toEqual(newGameWith(6).ext[MAP_SLICE]);
  });

  it('a new game gets a map', () => {
    const layer = mapOf(createNewGame());
    expect(layer.trees.length).toBeGreaterThan(0);
    expect(layer.deposits.length).toBeGreaterThan(0);
  });
});

describe('the map is saved', () => {
  it('trees, stumps and deposits survive a reload', () => {
    const state = newGameWith(9);
    const layer = mapOf(state);
    layer.trees[0].felledAt = 1234;
    layer.deposits[0].left = 17;
    const loaded = mapOf(deserialize(serialize(state)));
    expect(loaded).toEqual(layer);
  });

  it('trees and deposits stay when their land is bought', () => {
    const game = new Game(newGameWith(9));
    game.earn(100_000);
    const before = structuredClone(mapOf(game.state));
    const vein = before.deposits.find((d) => d.kind === 'iron' && parcelAt(FARM_PARCELS, d.x, d.y))!;
    const parcel = parcelAt(FARM_PARCELS, vein.x, vein.y)!;
    expect(buyParcel(game, FARM_PARCELS, START_LAND, parcel).ok).toBe(true);
    expect(isOwned(game.state.land, vein.x, vein.y)).toBe(true);
    expect(mapOf(game.state)).toEqual(before);
  });

  it('garbage in a save is dropped, tree by tree and deposit by deposit', () => {
    const land = createNewGame().land;
    const layer = sanitizeLayer(
      {
        trees: [{ x: 1, y: 2, felledAt: null }, { x: 1, y: 2, felledAt: 5 }, { x: -1, y: 0 }, { x: 3, y: 3, felledAt: 'soon' }, 'tree'],
        deposits: [{ kind: 'gold', x: 0, y: 0, w: 2, h: 2, left: 5 }, { kind: 'stone', x: 5, y: 5, w: 2, h: 2, left: -3 }, { kind: 'iron', x: 63, y: 0, w: 2, h: 2, left: 5 }],
      },
      land,
    );
    expect(layer.trees).toEqual([
      { x: 1, y: 2, felledAt: null },
      { x: 3, y: 3, felledAt: null },
    ]);
    expect(layer.deposits).toEqual([{ kind: 'stone', x: 5, y: 5, w: 2, h: 2, left: 400, amount: 400 }]);
    expect(sanitizeLayer('nonsense', land)).toEqual({ trees: [], deposits: [] });
  });
});

describe('placement', () => {
  it('grown trees and deposits block building, with a reason', () => {
    const game = farm();
    const layer = mapOf(game.state);
    addTrees(layer, [{ x: X + 1, y: Y + 6 }]);
    addDeposit(layer, 'stone', { x: X + 6, y: Y + 6, w: 2, h: 2 });
    expect(game.checkPlacement('path', X + 1, Y + 6)).toEqual({ ok: false, reason: 'tree' });
    expect(game.checkPlacement('field', X, Y + 5)).toEqual({ ok: false, reason: 'tree' });
    expect(game.checkPlacement('path', X + 7, Y + 7)).toEqual({ ok: false, reason: 'deposit' });
    expect(game.checkPlacement('mine', X + 6, Y + 6)).toEqual({ ok: false, reason: 'deposit' });
    expect(game.checkPlacement('path', X + 3, Y + 6).ok).toBe(true);
  });

  it('a quarry must stand on an outcrop, a mine on a vein: at least one tile on it', () => {
    const game = farm();
    const layer = mapOf(game.state);
    addDeposit(layer, 'stone', { x: X + 6, y: Y + 6, w: 2, h: 2 });
    addDeposit(layer, 'iron', { x: X + 12, y: Y + 6, w: 2, h: 2 });
    expect(game.checkPlacement('quarry', X + 1, Y + 6)).toEqual({ ok: false, reason: 'needs-outcrop' });
    expect(game.checkPlacement('mine', X + 1, Y + 6)).toEqual({ ok: false, reason: 'needs-vein' });
    expect(game.checkPlacement('quarry', X + 6, Y + 6).ok).toBe(true);
    expect(game.checkPlacement('quarry', X + 5, Y + 5).ok).toBe(true); // one corner tile on it
    expect(game.checkPlacement('quarry', X + 12, Y + 6)).toEqual({ ok: false, reason: 'deposit' });
    expect(game.checkPlacement('mine', X + 12, Y + 6).ok).toBe(true);
  });

  it('a used-up deposit no longer counts, and can be built over', () => {
    const game = farm();
    const d = addDeposit(mapOf(game.state), 'stone', { x: X + 6, y: Y + 6, w: 2, h: 2 });
    d.left = 0;
    expect(game.checkPlacement('quarry', X + 6, Y + 6)).toEqual({ ok: false, reason: 'needs-outcrop' });
    expect(game.place('path', X + 6, Y + 6).ok).toBe(true);
    expect(mapOf(game.state).deposits).toHaveLength(0);
  });

  it('stumps can be built over, which removes the tree for good', () => {
    const game = farm();
    const layer = mapOf(game.state);
    addTrees(layer, [{ x: X + 1, y: Y + 6 }]);
    treeAt(layer, X + 1, Y + 6)!.felledAt = game.now;
    expect(treeStatus(treeAt(layer, X + 1, Y + 6)!, game.now)).toBe('stump');
    let mapEvents = 0;
    game.events.on('map', () => mapEvents++);
    expect(game.place('path', X + 1, Y + 6).ok).toBe(true);
    expect(treeAt(mapOf(game.state), X + 1, Y + 6)).toBeUndefined();
    expect(mapEvents).toBe(1);
    run(game, 2 * SEASON_MS, HOUR);
    expect(treeAt(mapOf(game.state), X + 1, Y + 6)).toBeUndefined();
  });

  it('roads laid for new farms go around trees', () => {
    const game = farm();
    const layer = mapOf(game.state);
    // A wall of trees with one gap, between the farmhouse lane and a site below it.
    addTrees(layer, Array.from({ length: 12 }, (_, i) => ({ x: X - 2 + i, y: Y + 4 })).filter((t) => t.x !== X + 9));
    expect(connectToFarmhouse(game.state, { x: X + 1, y: Y + 7, w: 2, h: 2 })).toBe(true);
    for (const o of game.state.objects) if (o.type === 'path') expect(treeAt(layer, o.x, o.y)).toBeUndefined();
  });
});

describe("the woodcutter's lodge fells trees in range", () => {
  /** A staffed lodge with trees at 2, 3 and 5 tiles below it, and one out of range. */
  function lodge() {
    const game = farm();
    addTrees(mapOf(game.state), [
      { x: lodgeAt.x, y: lodgeAt.y + 4 },
      { x: lodgeAt.x, y: lodgeAt.y + 5 },
      { x: lodgeAt.x, y: lodgeAt.y + 7 },
      { x: lodgeAt.x, y: lodgeAt.y + 9 },
    ]);
    const obj = staff(game, 'woodcutter', lodgeAt.x, lodgeAt.y);
    return { game, obj, layer: mapOf(game.state) };
  }

  it('counts the trees within 6 tiles of its footprint', () => {
    const { layer } = lodge();
    expect(treesInRange(layer, lodgeArea, 6).map((t) => t.y - lodgeAt.y)).toEqual([4, 5, 7]);
  });

  it('each cycle fells the nearest grown tree in range, which turns into a stump when the cycle ends', () => {
    const { game, obj, layer } = lodge();
    game.advance(1);
    const cycle = obj.state.cycle!;
    const first = treeAt(layer, lodgeAt.x, lodgeAt.y + 4)!;
    expect(first.felledAt).toBe(cycle.start + cycle.duration);
    // It stands (and blocks building) until the farmer has felled it.
    expect(treeStatus(first, game.now)).toBe('grown');
    expect(game.checkPlacement('path', first.x, first.y)).toEqual({ ok: false, reason: 'tree' });
    run(game, cycle.start + cycle.duration - game.now);
    expect(treeStatus(first, game.now)).toBe('stump');
    expect(game.count('wood')).toBe(4);
    expect(game.checkPlacement('path', first.x, first.y).ok).toBe(true);
    // Then the next nearest, and the one after.
    run(game, 30 * MIN);
    expect([4, 5, 7].map((dy) => treeStatus(treeAt(layer, lodgeAt.x, lodgeAt.y + dy)!, game.now))).toEqual(['stump', 'stump', 'stump']);
    expect(treeStatus(treeAt(layer, lodgeAt.x, lodgeAt.y + 9)!, game.now)).toBe('grown'); // out of range
    expect(game.count('wood')).toBe(12);
  });

  it('with nothing in range it waits `no-trees`, wakes when a stump regrows, and resumes', () => {
    const { game, obj, layer } = lodge();
    run(game, 30 * MIN);
    expect(game.count('wood')).toBe(12);
    expect(workplaceNext(game, obj)).toEqual({ wait: 'no-trees' });
    expect(idleReason(game, obj)).toBe('no-trees');
    const first = treeAt(layer, lodgeAt.x, lodgeAt.y + 4)!;
    const regrow = first.felledAt! + REGROW_MS;
    expect(nextWorkEvent(game)).toBe(regrow);
    // About a season of game time.
    expect(REGROW_MS).toBe(32 * MIN);
    run(game, regrow - game.now - 1);
    expect(game.count('wood')).toBe(12);
    expect(treeStatus(first, game.now)).toBe('stump');
    game.advance(1);
    expect(treeStatus(first, game.now)).toBe('grown');
    const cycle = obj.state.cycle!; // the farmer set off at once
    expect(first.felledAt).toBe(cycle.start + cycle.duration);
    run(game, cycle.start + cycle.duration - game.now);
    expect(game.count('wood')).toBe(16);
  });

  it('×1, ×60 and offline catch-up give the same map', () => {
    const results = [MIN, 4 * HOUR].map((step) => {
      const { game } = lodge();
      run(game, 4 * HOUR, step);
      return { map: mapOf(game.state), wood: game.count('wood') };
    });
    const ticks = (() => {
      const { game } = lodge();
      game.setSpeed(60);
      while (game.now < 4 * HOUR) game.tick(Math.min(250, (4 * HOUR - game.now) / 60));
      return { map: mapOf(game.state), wood: game.count('wood') };
    })();
    const offline = (() => {
      const { game } = lodge();
      catchUp(game, 4 * HOUR);
      return { map: mapOf(game.state), wood: game.count('wood') };
    })();
    expect(results[0].wood).toBeGreaterThan(12);
    expect(results[1]).toEqual(results[0]);
    expect(ticks).toEqual(results[0]);
    expect(offline).toEqual(results[0]);
  });

  it('two lodges never fell the same tree', () => {
    const game = farm();
    addTrees(mapOf(game.state), [{ x: lodgeAt.x + 3, y: lodgeAt.y + 4 }]);
    staff(game, 'woodcutter', lodgeAt.x, lodgeAt.y);
    const second = staff(game, 'woodcutter', lodgeAt.x + 5, lodgeAt.y);
    game.advance(1);
    expect(workplaceNext(game, second)).toEqual({ wait: 'no-trees' });
    run(game, 20 * MIN);
    expect(game.count('wood')).toBe(4);
  });

  it('the debug button grows every stump back', () => {
    const { game, layer } = lodge();
    run(game, 30 * MIN);
    expect(mapCounts(layer, game.now).stumps).toBe(3);
    expect(regrowAll(layer, game.now)).toBe(3);
    expect(mapCounts(layer, game.now)).toEqual({ grown: 4, stumps: 0 });
  });
});

describe('quarries and mines take from their deposit', () => {
  it.each([
    ['quarry', 'stone'],
    ['mine', 'iron'],
  ] as const)('each %s cycle lowers what is left; an empty deposit stops it with `exhausted`', (type, kind) => {
    const game = farm();
    const def = RESOURCES[type];
    const d = addDeposit(mapOf(game.state), kind, { x: X + 1, y: Y + 5, w: 2, h: 2 }, def.yield * 2 + 1);
    const obj = staff(game, type);
    run(game, 3 * HOUR);
    // Two full cycles, then the last unit.
    expect(game.count(def.output)).toBe(def.yield * 2 + 1);
    expect(d.left).toBe(0);
    expect(workplaceNext(game, obj)).toEqual({ wait: 'exhausted' });
    expect(idleReason(game, obj)).toBe('exhausted');
    run(game, 3 * HOUR);
    expect(game.count(def.output)).toBe(def.yield * 2 + 1);
    // It can be demolished.
    expect(game.demolish(obj.id)).not.toBeNull();
  });

  it('a new outcrop holds about 400 stone, a vein 150 iron', () => {
    const layer = mapOf(newGameWith(3));
    for (const d of layer.deposits) expect(d.left).toBe(d.kind === 'iron' ? 150 : d.w === 3 ? 600 : 400);
  });
});

describe('saves from before the map (version 10)', () => {
  /** A version-10 save of a farm with a lodge, a quarry and a mine built, staffed and working. */
  function v10(): string {
    const game = farm(false);
    // In version 10 they stood anywhere: give them what they need here, then drop the map from the save.
    addDeposit(mapOf(game.state), 'stone', { x: X + 4, y: Y + 5, w: 2, h: 2 });
    addDeposit(mapOf(game.state), 'iron', { x: X + 7, y: Y + 5, w: 2, h: 2 });
    staff(game, 'woodcutter', X + 1, Y + 5);
    staff(game, 'quarry', X + 4, Y + 5);
    staff(game, 'mine', X + 7, Y + 5);
    game.advance(MIN);
    const raw = JSON.parse(serialize(game.state));
    raw.version = 10;
    delete raw.state.ext[MAP_SLICE];
    return JSON.stringify(raw);
  }

  it('loads with a map generated around its objects, never on top of them', () => {
    const state = deserialize(v10());
    const layer = mapOf(state);
    expect(layer.trees.length).toBeGreaterThan(50);
    for (const o of state.objects) {
      const a = footprint(o);
      for (const t of layer.trees) expect(inside(a, t.x, t.y), `${o.type} ${t.x},${t.y}`).toBe(false);
      if (!RESOURCES[o.type as ResourceType]?.deposit) for (const d of layer.deposits) expect(inside(d, a.x, a.y), `${o.type} on a deposit`).toBe(false);
    }
  });

  it('every quarry and mine gets a matching deposit under it, every lodge a grove of about 8 trees in range', () => {
    const state = deserialize(v10());
    const layer = mapOf(state);
    for (const o of state.objects) {
      const def = RESOURCES[o.type as ResourceType];
      if (def?.deposit) expect(depositsUnder(layer, footprint(o), def.deposit)[0]).toMatchObject({ ...footprint(o), left: def.deposit === 'iron' ? 150 : 400 });
      if (def?.range) expect(treesInRange(layer, footprint(o), def.range).length).toBeGreaterThanOrEqual(8);
    }
  });

  it('its lodges, quarries and mines keep working', () => {
    const game = new Game(deserialize(v10()));
    const produced: Record<string, number> = {};
    game.activity.on('produced', ({ item, qty }) => (produced[item] = (produced[item] ?? 0) + qty));
    run(game, 2 * HOUR);
    expect(produced.wood).toBeGreaterThanOrEqual(20);
    expect(produced.stone).toBeGreaterThanOrEqual(9);
    expect(produced.iron).toBeGreaterThanOrEqual(3);
  });

  it('the same save always gets the same map', () => {
    const save = v10();
    expect(mapOf(deserialize(save))).toEqual(mapOf(deserialize(save)));
  });
});

describe('generateMapLayer', () => {
  it('works around a crowded farm: no grove fits the starting land, the outcrop moves out', () => {
    const state = bareMap(createNewGame());
    // Paths over every free owned tile.
    const taken = new Set(state.objects.flatMap((o) => {
      const a = footprint(o);
      return Array.from({ length: a.w * a.h }, (_, i) => `${a.x + (i % a.w)},${a.y + Math.floor(i / a.w)}`);
    }));
    const objects = [...state.objects];
    for (let y = START_LAND.y; y < START_LAND.y + START_LAND.h; y++) {
      for (let x = START_LAND.x; x < START_LAND.x + START_LAND.w; x++) if (!taken.has(`${x},${y}`)) objects.push({ id: `p${x}-${y}`, type: 'path', x, y, state: {} });
    }
    const layer: MapLayer = generateMapLayer(state.land, occupantsOf(objects), 4);
    expect(layer.trees.filter((t) => isOwned(state.land, t.x, t.y))).toHaveLength(0);
    const stone = layer.deposits.filter((d) => d.kind === 'stone');
    expect(stone.length).toBeGreaterThanOrEqual(1);
    for (const d of layer.deposits) expect(isOwned(state.land, d.x, d.y)).toBe(false);
  });
});
