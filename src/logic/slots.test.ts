import { describe, expect, it } from 'vitest';
import { START_LAND } from './constants';
import { Game } from './game';
import { SAVE_KEY, SAVE_VERSION, saveToStorage, serialize, type SaveStorage } from './save';
import { SAVE_V6 } from './save-v6.fixture';
import {
  deleteSlot,
  exportFileName,
  importSlot,
  listSlots,
  parseSaveFile,
  readSlot,
  readSlotText,
  SaveFileError,
  slotKey,
  STORAGE_FULL,
  writeSlot,
} from './slots';

function memoryStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** A farm that has done a few things: money, goods, a path, a day or so on the clock and some XP. */
function playedGame(): Game {
  const g = new Game();
  g.earn(1234);
  g.addItem('egg', 7);
  g.place('path', START_LAND.x + 2, START_LAND.y + 9);
  g.setSpeed(60);
  for (let i = 0; i < 40; i++) g.tick(250);
  g.progression.addXp(500);
  return g;
}

describe('save slots', () => {
  it('lists the autosave and three empty slots on a fresh browser', () => {
    expect(listSlots(memoryStorage())).toEqual([
      { id: 'auto', empty: true },
      { id: 1, empty: true },
      { id: 2, empty: true },
      { id: 3, empty: true },
    ]);
  });

  it('keeps each slot in its own key, beside the autosave', () => {
    expect(slotKey('auto')).toBe(SAVE_KEY);
    expect(new Set([slotKey(1), slotKey(2), slotKey(3), slotKey('auto')]).size).toBe(4);
  });

  it('saves a farm to a slot and lists its summary', () => {
    const storage = memoryStorage();
    const g = playedGame();
    expect(writeSlot(storage, 2, g.state, 1_700_000_000_000)).toEqual({ ok: true });
    const slots = listSlots(storage);
    expect(slots[0]).toEqual({ id: 'auto', empty: true });
    expect(slots[2]).toEqual({ id: 2, empty: false, day: g.day, season: 'spring', level: g.level, money: g.money, savedAt: 1_700_000_000_000 });
    expect(g.level).toBeGreaterThan(1);
    expect(slots[1]).toEqual({ id: 1, empty: true });
  });

  it('lists the autosave written by the game', () => {
    const storage = memoryStorage();
    const g = playedGame();
    saveToStorage(storage, g.state, 42);
    expect(listSlots(storage)[0]).toMatchObject({ id: 'auto', empty: false, money: g.money, savedAt: 42 });
  });

  it('loads a slot back exactly as it was saved', () => {
    const storage = memoryStorage();
    const g = playedGame();
    writeSlot(storage, 1, g.state, 99);
    const saved = structuredClone(g.state);
    // Play on: the slot keeps the snapshot.
    g.earn(500);
    g.tick(10_000);
    const loaded = readSlot(storage, 1)!;
    expect(loaded.savedAt).toBe(99);
    expect(loaded.state).toEqual({ ...saved, clock: { ...saved.clock, speed: 1 } });
  });

  it('overwrites a slot with the newer farm', () => {
    const storage = memoryStorage();
    const g = playedGame();
    writeSlot(storage, 3, g.state, 1);
    g.earn(1000);
    writeSlot(storage, 3, g.state, 2);
    expect(readSlot(storage, 3)).toMatchObject({ savedAt: 2, state: { money: g.money } });
  });

  it('deletes a slot and leaves the others alone', () => {
    const storage = memoryStorage();
    const g = playedGame();
    writeSlot(storage, 1, g.state);
    writeSlot(storage, 2, g.state);
    saveToStorage(storage, g.state);
    deleteSlot(storage, 1);
    expect(readSlot(storage, 1)).toBeNull();
    expect(readSlot(storage, 2)).not.toBeNull();
    expect(readSlot(storage, 'auto')).not.toBeNull();
  });

  it('reports a full or blocked storage without throwing, and keeps the old slot', () => {
    const storage = memoryStorage();
    const g = playedGame();
    writeSlot(storage, 1, g.state, 1);
    const before = storage.data.get(slotKey(1));
    storage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    g.earn(10);
    expect(writeSlot(storage, 1, g.state, 2)).toEqual({ ok: false, error: STORAGE_FULL });
    expect(storage.data.get(slotKey(1))).toBe(before);
  });

  it('treats an unreadable slot as empty, and a blocked storage as empty slots', () => {
    const storage = memoryStorage();
    storage.data.set(slotKey(2), '{not json');
    expect(readSlot(storage, 2)).toBeNull();
    expect(listSlots(storage)[2]).toEqual({ id: 2, empty: true });
    const blocked: SaveStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(listSlots(blocked).every((s) => s.empty)).toBe(true);
    expect(() => deleteSlot(blocked, 1)).not.toThrow();
  });

  it('exports the saved text and names the file by date', () => {
    const storage = memoryStorage();
    writeSlot(storage, 1, playedGame().state, 5);
    expect(readSlotText(storage, 1)).toBe(storage.data.get(slotKey(1)));
    expect(readSlotText(storage, 2)).toBeNull();
    expect(exportFileName(new Date(2026, 9, 31, 14, 5))).toBe('farmer-save-2026-10-31.json');
  });
});

describe('import', () => {
  it('imports an exported file into a slot, which then loads', () => {
    const g = playedGame();
    const file = serialize(g.state, 123);
    const storage = memoryStorage();
    expect(importSlot(storage, 3, file)).toEqual({ ok: true });
    expect(readSlot(storage, 3)).toMatchObject({ savedAt: 123, state: { money: g.money, inventory: g.state.inventory } });
  });

  it('migrates an older file (version 8) on import', () => {
    const g = playedGame();
    const v8 = JSON.parse(serialize(g.state, 7));
    v8.version = 8;
    const storage = memoryStorage();
    expect(importSlot(storage, 1, JSON.stringify(v8))).toEqual({ ok: true });
    expect(JSON.parse(storage.data.get(slotKey(1))!).version).toBe(SAVE_VERSION);
    expect(readSlot(storage, 1)).toMatchObject({ savedAt: 7, state: { money: g.money } });
  });

  it('migrates a version-6 file (the old, smaller map)', () => {
    const storage = memoryStorage();
    expect(importSlot(storage, 2, JSON.stringify(SAVE_V6))).toEqual({ ok: true });
    expect(readSlot(storage, 2)!.state.land.width).toBe(64);
  });

  it.each([
    ['broken JSON', '{"version": 9, "state": '],
    ['a JSON array', '[1, 2, 3]'],
    ['a JSON string', '"farm"'],
    ['foreign JSON', JSON.stringify({ name: 'my-package', version: '1.0.0' })],
    ['foreign JSON without a version', JSON.stringify({ hello: 'world' })],
    ['a save without a state', JSON.stringify({ version: 9, savedAt: 1 })],
    ['a state of the wrong shape', JSON.stringify({ version: 9, savedAt: 1, state: { money: 'lots', objects: [], clock: {} } })],
    ['a newer version', JSON.stringify({ version: SAVE_VERSION + 1, savedAt: 1, state: { money: 1, objects: [], clock: {} } })],
    ['an empty file', ''],
  ])('refuses %s and leaves the slot as it was', (_name, json) => {
    const storage = memoryStorage();
    writeSlot(storage, 1, playedGame().state, 1);
    const before = storage.data.get(slotKey(1));
    const result = importSlot(storage, 1, json);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Farmer|read/);
    expect(storage.data.get(slotKey(1))).toBe(before);
    expect(() => parseSaveFile(json)).toThrow(SaveFileError);
  });

  it('accepts a version-0 save (state fields at the top level)', () => {
    const v0 = JSON.stringify({ money: 77, inventory: {}, objects: [], clock: { elapsed: 0, speed: 1 } });
    expect(parseSaveFile(v0).state.money).toBe(77);
  });

  it('reports a full storage on import', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    expect(importSlot(storage, 1, serialize(playedGame().state, 1))).toEqual({ ok: false, error: STORAGE_FULL });
  });
});
