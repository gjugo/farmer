import { describe, expect, it } from 'vitest';
import { registerBuildable } from '../data/buildables';
import { START_LAND } from './constants';
import { Game } from './game';
import { deserialize, loadFromStorage, loadSave, parseSave, SAVE_KEY, SAVE_VERSION, saveToStorage, serialize, type SaveStorage } from './save';
import { getSlice, registerStateSlice } from './slices';
import { createNewGame } from './state';

function memoryStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const ix = START_LAND.x + 2;
const iy = START_LAND.y + 2;

describe('save / load', () => {
  it('round-trips money, inventory, objects, land and day', () => {
    const g = new Game();
    g.earn(1000);
    g.addItem('milk', 3);
    g.addItem('egg', 10);
    g.place('path', ix, iy);
    g.place('path', ix + 1, iy);
    g.setLandOwned(0, 0, true);
    g.setSpeed(60);
    for (let i = 0; i < 100; i++) g.tick(250); // 1.5M game ms ≈ day 7

    const storage = memoryStorage();
    expect(saveToStorage(storage, g.state)).toBe(true);
    const loaded = loadFromStorage(storage);

    expect(loaded.money).toBe(1490);
    expect(loaded.inventory).toEqual({ milk: 3, egg: 10 });
    expect(loaded.objects.map((o) => [o.type, o.x, o.y])).toEqual([
      ['path', ix, iy],
      ['path', ix + 1, iy],
    ]);
    expect(loaded.land.owned[0]).toBe(1);
    expect(loaded.clock.elapsed).toBe(g.state.clock.elapsed);
    expect(new Game(loaded).day).toBe(g.day);
    expect(g.day).toBeGreaterThan(1);
    // Debug speed is a session setting; reloads start at x1.
    expect(loaded.clock.speed).toBe(1);
    // New ids never collide with loaded ones.
    const g2 = new Game(loaded);
    const r = g2.place('path', ix + 2, iy);
    expect(r.ok && r.object.id).toBe('o3');
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
      objects: [{ id: 'o7', type: 'path', x: ix, y: iy }],
    });
    const s = deserialize(old);
    expect(s.money).toBe(742);
    expect(s.inventory).toEqual({ wheat: 12 });
    expect(s.objects).toEqual([{ id: 'o7', type: 'path', x: ix, y: iy, state: {} }]);
    expect(s.nextObjectId).toBe(8);
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
      const old = JSON.stringify({ version, savedAt: 1_700_000_000_000, state: { ...createNewGame(), money: 321 } });
      const loaded = parseSave(old);
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
