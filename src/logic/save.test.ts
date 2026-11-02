import { describe, expect, it } from 'vitest';
import { registerBuildable } from '../data/buildables';
import { FIELD } from '../data/crops';
import { SOIL_QUALITY } from '../data/soil';
import { MAP_HEIGHT, MAP_WIDTH, START_LAND } from './constants';
import { footprintOf, Game } from './game';
import { isRoadTile } from './mainroad';
import { MAP_SLICE, mapOf, type MapLayer } from './maplayer';
import { canPlace } from './placement';
import { deserialize, loadFromStorage, loadSave, parseSave, SAVE_KEY, SAVE_VERSION, saveToStorage, serialize, type SaveStorage } from './save';
import { getSlice, registerStateSlice } from './slices';
import { GOALS } from '../data/progression';
import { PROGRESSION, type ProgressionState } from './progression';
import { areaSoil } from './soil';
import { createNewGame } from './state';
import { bareMap, fromV6, v6Land, V6_START } from './test-utils';

function memoryStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

// Free land below the starting fields, the farmhouse and the road between them.
const ix = START_LAND.x + 2;
const iy = START_LAND.y + 9;
// A free tile of the version-6 map (32×24, starting land at (11, 8)), for old saves.
const oldTile = { x: V6_START.x + 2, y: V6_START.y + 5 };

describe('save / load', () => {
  it('round-trips money, inventory, objects, land and day', () => {
    const g = new Game(bareMap(createNewGame()));
    g.earn(1000);
    g.addItem('milk', 3);
    g.addItem('egg', 10);
    g.place('path', ix, iy);
    g.place('path', ix + 1, iy);
    g.setSpeed(60);
    for (let i = 0; i < 100; i++) g.tick(250); // 1.5M game ms ≈ day 7

    const storage = memoryStorage();
    expect(saveToStorage(storage, g.state)).toBe(true);
    const loaded = loadFromStorage(storage);

    expect(loaded.money).toBe(1500); // paths are free
    // The family ate a little of it on the way (2 food a day).
    expect(loaded.inventory).toEqual(g.state.inventory);
    expect(loaded.inventory.egg).toBeGreaterThan(0);
    expect(loaded.objects).toEqual(g.state.objects);
    expect(loaded.objects.slice(-2).map((o) => [o.type, o.x, o.y])).toEqual([
      ['path', ix, iy],
      ['path', ix + 1, iy],
    ]);
    expect(loaded.land).toEqual({ width: MAP_WIDTH, height: MAP_HEIGHT });
    expect(loaded.clock.elapsed).toBe(g.state.clock.elapsed);
    expect(new Game(loaded).day).toBe(g.day);
    expect(g.day).toBeGreaterThan(1);
    // Debug speed is a session setting; reloads start at x1.
    expect(loaded.clock.speed).toBe(1);
    // New ids never collide with loaded ones.
    const g2 = new Game(loaded);
    const r = g2.place('path', ix + 2, iy);
    expect(r.ok && r.object.id).toBe(`o${g.state.nextObjectId}`);
    expect(new Set(g2.state.objects.map((o) => o.id)).size).toBe(g2.state.objects.length);
  });

  it('writes a versioned save file', () => {
    const parsed = JSON.parse(serialize(createNewGame(), 123));
    expect(parsed.version).toBe(SAVE_VERSION);
    expect(parsed.savedAt).toBe(123);
    expect(parsed.state.money).toBe(500);
  });

  it('loads an older (version 0, unversioned) save and fills missing fields with defaults', () => {
    // Pre-release shape: state at the top level, no version, no land/clock/ext.
    const old = JSON.stringify({
      money: 742,
      inventory: { wheat: 12, bogus: -3 },
      objects: [{ id: 'o7', type: 'path', ...oldTile }],
    });
    const s = deserialize(old);
    expect(s.money).toBe(742);
    expect(s.inventory).toEqual({ wheat: 12 });
    expect(s.objects[0]).toEqual({ id: 'o7', type: 'path', ...fromV6(oldTile.x, oldTile.y), state: {} });
    // A farm from before farmhouses gets one, with a path at its door.
    expect(s.objects.slice(1).map((o) => [o.id, o.type])).toEqual([
      ['o8', 'farmhouse'],
      ['o9', 'path'],
    ]);
    expect(s.nextObjectId).toBe(10);
    expect(s.clock).toEqual({ elapsed: 0, speed: 1 });
    expect(s.land).toEqual(createNewGame().land);
  });

  it('keeps the real time the save was written', () => {
    const storage = memoryStorage();
    saveToStorage(storage, createNewGame(), 1_700_000_000_000);
    expect(loadSave(storage).savedAt).toBe(1_700_000_000_000);
    expect(parseSave(serialize(createNewGame())).savedAt).toBeNull();
    expect(parseSave(null).savedAt).toBeNull();
  });

  it('loads version 1 and 2 saves without a saved time, so the first load does not catch up', () => {
    for (const version of [1, 2]) {
      const file = JSON.stringify({ version, savedAt: 1_700_000_000_000, state: { land: v6Land(), money: 321 } });
      const loaded = parseSave(file);
      expect(loaded.state.money).toBe(321);
      expect(loaded.savedAt).toBeNull();
    }
    expect(parseSave(JSON.stringify({ money: 99 })).savedAt).toBeNull(); // version 0 too
  });

  it('fills fields that later features add (object state and ext slices)', () => {
    registerBuildable({
      id: 'test-coop',
      name: 'Coop',
      cost: 10,
      footprint: { w: 2, h: 2 },
      texture: 'path',
      initialState: () => ({ hens: 0, eggs: 0 }),
    });
    registerStateSlice('test-market', () => ({ demand: 1, history: [] as number[] }));

    const saved = {
      version: SAVE_VERSION,
      savedAt: 1,
      state: {
        ...createNewGame(),
        ext: { 'test-market': { demand: 2 } },
        objects: [{ id: 'o1', type: 'test-coop', x: ix, y: iy, state: { hens: 3 } }],
      },
    };
    const s = deserialize(JSON.stringify(saved));
    expect(s.objects[0].state).toEqual({ hens: 3, eggs: 0 });
    expect(getSlice(s, 'test-market')).toEqual({ demand: 2, history: [] });
  });

  it('loads a version 9 save with fertility filled in: the soil quality of each field, no last crop', () => {
    const state = createNewGame();
    state.clock.elapsed = 5000;
    const [a, b] = state.objects.filter((o) => o.type === FIELD);
    // Version 9 fields had crop state only.
    a.state = { crop: null, timer: null, ploughedAt: 0 };
    b.state = { crop: 'wheat', timer: { start: 0, duration: 480_000 }, ploughedAt: 0 };
    const loaded = parseSave(JSON.stringify({ version: 9, savedAt: 1, state })).state;
    const fields = loaded.objects.filter((o) => o.type === FIELD);
    expect(SAVE_VERSION).toBe(19);
    expect(fields[0].state).toEqual({ crop: null, timer: null, ploughedAt: 0, fertility: SOIL_QUALITY.rich, restingSince: 5000, lastCrop: null });
    expect(fields[1].state).toMatchObject({ crop: 'wheat', fertility: SOIL_QUALITY.rich, restingSince: null, lastCrop: null });
    expect(fields.map((f) => f.state.fertility)).toEqual(fields.map((f) => areaSoil({ x: f.x, y: f.y, w: 2, h: 2 })));
  });

  it('a version 9 save skips the "spread-manure" goal once it is past it', () => {
    const next = (nextGoal: number) => {
      const state = createNewGame();
      getSlice<ProgressionState>(state, PROGRESSION).nextGoal = nextGoal;
      return getSlice<ProgressionState>(parseSave(JSON.stringify({ version: 9, savedAt: 1, state })).state, PROGRESSION).nextGoal;
    };
    // In version 9, index 13 was "own-cows" and 14 "make-cheese". (Version 11 inserted "house-families" just before
    // "own-cows", so a farm about to be offered the cows gets that first.)
    expect(GOALS[next(13)].id).toBe('house-families');
    expect(GOALS[next(14)].id).toBe('spread-manure');
    expect(GOALS[next(15)].id).toBe('earn-1000');
  });

  it('opens the whole map to a version 14 save, bought land or not, and moves nothing', () => {
    const state = createNewGame();
    // Version 14 owned land tile by tile: the starting land plus a bought block to its left.
    const owned = new Array<number>(MAP_WIDTH * MAP_HEIGHT).fill(0);
    const own = (x0: number, y0: number, w: number, h: number) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) owned[y * MAP_WIDTH + x] = 1;
    };
    own(START_LAND.x, START_LAND.y, START_LAND.w, START_LAND.h);
    own(START_LAND.x - 12, START_LAND.y, 12, START_LAND.h);
    const raw = JSON.parse(JSON.stringify({ version: 14, savedAt: 1, state: { ...state, land: { width: MAP_WIDTH, height: MAP_HEIGHT, owned } } }));
    const loaded = parseSave(JSON.stringify(raw)).state;
    expect(loaded.land).toEqual({ width: MAP_WIDTH, height: MAP_HEIGHT });
    // The same trees, deposits and buildings (but the trees the main road, laid in version 16, cut through).
    const raws = raw.state.ext[MAP_SLICE] as MapLayer;
    expect(mapOf(loaded).deposits).toEqual(raws.deposits);
    expect(mapOf(loaded).trees).toEqual(raws.trees.filter((t) => !isRoadTile(loaded, t.x, t.y)));
    expect(loaded.objects).toEqual(raw.state.objects);
    // Land that was never bought takes buildings now: the far corner, and a tile next to the bought block.
    const free = (x: number, y: number) =>
      !loaded.objects.some((o) => x >= o.x && y >= o.y && x < o.x + footprintOf(o).w && y < o.y + footprintOf(o).h) &&
      canPlace(loaded, { w: 1, h: 1 }, x, y, footprintOf).ok;
    let tiles = 0;
    for (let y = 0; y < MAP_HEIGHT; y++) for (let x = 0; x < MAP_WIDTH; x++) if (owned[y * MAP_WIDTH + x] === 0 && free(x, y)) tiles++;
    // Most of the unbought land is open (the rest under trees, deposits and ponds).
    expect(tiles).toBeGreaterThan(MAP_WIDTH * MAP_HEIGHT * 0.6);
    expect(loaded.money).toBe(state.money);
  });

  it('a version 14 save with "Buy a plot of land" active gets "Own 10 fields" in its slot', () => {
    const state = createNewGame();
    const p = getSlice<ProgressionState>(state, PROGRESSION);
    p.goals = [
      { id: 'earn-1000', progress: 400 },
      { id: 'buy-land', progress: 0 },
      { id: 'build-woodcutter', progress: 0 },
    ];
    p.nextGoal = GOALS.findIndex((g) => g.id === 'build-woodcutter') + 1;
    const loaded = getSlice<ProgressionState>(parseSave(JSON.stringify({ version: 14, savedAt: 1, state })).state, PROGRESSION);
    expect(loaded.goals.map((g) => g.id)).toEqual(['earn-1000', 'own-10-fields', 'build-woodcutter']);
    expect(loaded.goals[0].progress).toBe(400);
    expect(loaded.nextGoal).toBe(p.nextGoal);
    // The slot did not move: "Own 10 fields" stands where "Buy a plot of land" stood, between the same goals.
    const at = GOALS.findIndex((g) => g.id === 'own-10-fields');
    expect([GOALS[at - 1].id, GOALS[at + 1].id]).toEqual(['earn-1000', 'build-woodcutter']);
    expect(GOALS[at]).toMatchObject({ title: 'Own 10 fields', kind: 'own-buildings', type: FIELD, count: 10, reward: { money: 200, xp: 75 } });
  });

  it('falls back to a new game for missing, corrupt or unknown saves', () => {
    expect(deserialize(null).money).toBe(500);
    expect(deserialize('{not json').money).toBe(500);
    expect(deserialize('[1,2]').money).toBe(500);
    expect(deserialize(JSON.stringify({ version: 1, state: { money: -50 } })).money).toBe(500);
    const storage = memoryStorage();
    storage.data.set(SAVE_KEY, 'garbage');
    expect(loadFromStorage(storage).money).toBe(500);
  });

  it('keeps playing when storage throws', () => {
    const broken: SaveStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(saveToStorage(broken, createNewGame())).toBe(false);
    expect(loadFromStorage(broken).money).toBe(500);
  });
});
