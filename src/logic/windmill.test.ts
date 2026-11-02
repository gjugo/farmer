import { describe, expect, it } from 'vitest';
import { MILL } from '../data/processing';
import { Game } from './game';
import { collect, sanitize, type ProcessorState } from './processing';
import { parseSave, SAVE_VERSION, serialize } from './save';
import { capacity, used } from './storage';
import { maxLevelState } from './test-utils';
import type { GameState, PlacedObject } from './types';
import { keepMakingOf, setKeepMaking } from './workers';

/**
 * A version-19 export (before the Windmill): a feed mill running wheat into feed with corn queued behind it, feed
 * waiting to be collected and "Keep making" on feed; a bakery baking the old bread (3 wheat + 1 egg) and kept on it.
 */
function v19Export(fill?: (state: GameState) => void): { json: string; mill: string; bakery: string } {
  const game = new Game(maxLevelState());
  game.earn(10_000);
  const place = (type: string, x: number) => {
    const r = game.place(type, x, 0);
    if (!r.ok) throw new Error(r.reason);
    return r.object as unknown as PlacedObject<ProcessorState>;
  };
  const mill = place(MILL, 0);
  const bakery = place('bakery', 4);
  mill.state.queue = [
    { recipe: 'feed-from-wheat', timer: { start: 0, duration: 120_000 } },
    { recipe: 'feed-from-corn', timer: null },
  ];
  mill.state.ready = { feed: 4 };
  bakery.state.queue = [{ recipe: 'bread', timer: { start: 0, duration: 300_000 } }];
  setKeepMaking(game, mill.id, 'bread');
  setKeepMaking(game, bakery.id, 'bread');
  game.state.inventory = { wood: 50, stone: 50 };
  fill?.(game.state);
  // Written by the old code: its own version, and the mill's feed recipe kept (today's code would not set it).
  const file = JSON.parse(serialize(game.state, 1));
  file.version = 19;
  file.state.ext.workers.recipes[mill.id] = 'feed-from-wheat';
  return { json: JSON.stringify(file), mill: mill.id, bakery: bakery.id };
}

function load(json: string) {
  const game = new Game(parseSave(json).state);
  const obj = (id: string) => game.getObject(id) as unknown as PlacedObject<ProcessorState>;
  return { game, obj };
}

describe('an old save with a feed mill (version 19)', () => {
  it('refunds the mill’s feed jobs, clears its feed "Keep making" and keeps its ready feed collectable', () => {
    expect(SAVE_VERSION).toBe(20);
    const { json, mill, bakery } = v19Export();
    const { game, obj } = load(json);
    // The running wheat job and the queued corn job give back their inputs.
    expect(game.count('wheat')).toBe(2);
    expect(game.count('corn')).toBe(1);
    expect(obj(mill).state.queue).toEqual([]);
    expect(keepMakingOf(game.state, mill)).toBeNull();
    // The bakery keeps its recipe and its job on the old bread just finishes.
    expect(keepMakingOf(game.state, bakery)).toBe('bread');
    sanitize(obj(bakery), game.state);
    expect(obj(bakery).state.queue.map((j) => j.recipe)).toEqual(['bread']);
    game.state.clock.elapsed = 300_000;
    expect(collect(game, obj(bakery))).toEqual({ bread: 3 });
    // The feed made before stays in the mill until it is collected.
    sanitize(obj(mill), game.state);
    expect(obj(mill).state.ready).toEqual({ feed: 4 });
    expect(collect(game, obj(mill))).toEqual({ feed: 4 });
  });

  it('reloading the migrated save changes nothing', () => {
    const { json } = v19Export();
    const once = parseSave(json).state;
    const again = parseSave(serialize(once, 1)).state;
    expect(again).toEqual(once);
  });

  it('refunds only what fits: with the granary full the inputs are lost', () => {
    const { json, mill } = v19Export((state) => {
      state.inventory.potato = capacity(state, 'goods') - used(state, 'goods') - 1;
    });
    const { game, obj } = load(json);
    // Room for one more good: one wheat comes back, the rest is dropped.
    expect(game.count('wheat') + game.count('corn')).toBe(1);
    expect(obj(mill).state.queue).toEqual([]);
  });

  it('a save from today keeps a Windmill queue as it is', () => {
    const game = new Game(maxLevelState());
    const r = game.place(MILL, 0, 0);
    if (!r.ok) throw new Error(r.reason);
    const mill = r.object as unknown as PlacedObject<ProcessorState>;
    mill.state.queue = [{ recipe: 'flour', timer: { start: 0, duration: 120_000 } }];
    const loaded = parseSave(serialize(game.state, 1)).state;
    expect((loaded.objects.find((o) => o.id === mill.id)!.state as ProcessorState).queue).toEqual(mill.state.queue);
  });
});
