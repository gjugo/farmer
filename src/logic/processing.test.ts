import { describe, expect, it } from 'vitest';
import { PROCESSORS, QUEUE_LIMIT, type RecipeDef } from '../data/processing';
import { Game } from './game';
import { maxLevelState } from './test-utils';
import {
  checkStart,
  collect,
  currentProgress,
  readyCount,
  sanitize,
  settle,
  startJob,
  validateRecipe,
  type ProcessorState,
} from './processing';
import { deserialize, serialize } from './save';
import { setOwned } from './land';
import type { PlacedObject } from './types';

function setup(type: keyof typeof PROCESSORS = 'dairy') {
  const game = new Game(maxLevelState());
  game.earn(10_000);
  const land = game.state.land;
  for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) setOwned(land, x, y, true);
  const placed = game.place(type, 0, 0);
  if (!placed.ok) throw new Error(`could not place ${type}: ${placed.reason}`);
  return { game, obj: placed.object as unknown as PlacedObject<ProcessorState> };
}

/** Advances game time by `ms` and settles the building, as the scene does every frame. */
function wait(game: Game, obj: PlacedObject<ProcessorState>, ms: number): number {
  game.state.clock.elapsed += ms;
  return settle(game.state.clock, obj);
}

describe('recipe validation', () => {
  it('accepts every shipped recipe', () => {
    for (const p of Object.values(PROCESSORS)) for (const r of p.recipes) expect(validateRecipe(r)).toEqual([]);
  });

  it('recipe ids are unique', () => {
    const ids = Object.values(PROCESSORS).flatMap((p) => p.recipes.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects unknown items, bad quantities and durations', () => {
    const bad = {
      id: 'bad',
      inputs: { mud: 1, milk: 0 },
      output: { item: 'gold', qty: 1.5 },
      durationMs: 0,
    } as unknown as RecipeDef;
    const errors = validateRecipe(bad);
    expect(errors).toHaveLength(5);
    expect(validateRecipe({ id: 'empty', inputs: {}, output: { item: 'feed', qty: 1 }, durationMs: 1 })).toEqual([
      'empty: no inputs',
    ]);
  });
});

describe('starting jobs', () => {
  it('cheese: consumes 2 milk at once, ready after 8 min, collect adds 1 cheese', () => {
    const { game, obj } = setup('dairy');
    game.addItem('milk', 2);
    expect(startJob(game, obj, 'cheese')).toEqual({ ok: true });
    expect(game.count('milk')).toBe(0);
    expect(obj.state.queue).toHaveLength(1);

    expect(wait(game, obj, 479_999)).toBe(0);
    expect(readyCount(obj)).toBe(0);
    expect(wait(game, obj, 1)).toBe(1);
    expect(obj.state.ready).toEqual({ cheese: 1 });
    expect(obj.state.queue).toHaveLength(0);

    expect(collect(game, obj)).toEqual({ cheese: 1 });
    expect(game.count('cheese')).toBe(1);
    expect(readyCount(obj)).toBe(0);
    expect(collect(game, obj)).toEqual({});
  });

  it('refuses without enough inputs and never goes negative', () => {
    const { game, obj } = setup('dairy');
    game.addItem('milk', 1);
    expect(startJob(game, obj, 'cheese')).toEqual({ ok: false, reason: 'inputs' });
    expect(game.count('milk')).toBe(1);
    expect(obj.state.queue).toHaveLength(0);
  });

  it('bakery consumes both wheat and egg, and refuses when either is missing', () => {
    const { game, obj } = setup('bakery');
    game.addItem('wheat', 3);
    expect(startJob(game, obj, 'bread')).toEqual({ ok: false, reason: 'inputs' });
    expect(game.count('wheat')).toBe(3);
    game.addItem('egg', 1);
    expect(startJob(game, obj, 'bread').ok).toBe(true);
    expect(game.count('wheat')).toBe(0);
    expect(game.count('egg')).toBe(0);
    wait(game, obj, 300_000);
    expect(collect(game, obj)).toEqual({ bread: 1 });
  });

  it('feed mill turns wheat and corn into feed', () => {
    const { game, obj } = setup('feed-mill');
    game.addItem('wheat', 2);
    game.addItem('corn', 1);
    expect(startJob(game, obj, 'feed-from-wheat').ok).toBe(true);
    expect(startJob(game, obj, 'feed-from-corn').ok).toBe(true);
    expect(game.count('wheat')).toBe(0);
    expect(game.count('corn')).toBe(0);
    wait(game, obj, 240_000);
    expect(collect(game, obj)).toEqual({ feed: 5 });
    expect(game.count('feed')).toBe(5);
  });

  it('feed mill grinds barley into feed: 2 barley make 4', () => {
    const { game, obj } = setup('feed-mill');
    game.addItem('barley', 2);
    expect(startJob(game, obj, 'feed-from-barley').ok).toBe(true);
    expect(game.count('barley')).toBe(0);
    wait(game, obj, 120_000);
    expect(collect(game, obj)).toEqual({ feed: 4 });
  });

  it('rejects recipes of another building', () => {
    const { game, obj } = setup('dairy');
    game.addItem('wool', 2);
    expect(startJob(game, obj, 'cloth')).toEqual({ ok: false, reason: 'unknown-recipe' });
    expect(game.count('wool')).toBe(2);
  });
});

describe('queue', () => {
  it(`holds at most ${QUEUE_LIMIT} jobs; a 4th is refused without taking inputs`, () => {
    const { game, obj } = setup('dairy');
    game.addItem('milk', 4);
    for (let i = 0; i < QUEUE_LIMIT; i++) expect(startJob(game, obj, 'butter').ok).toBe(true);
    expect(checkStart(game, obj, 'butter')).toEqual({ ok: false, reason: 'queue-full' });
    expect(startJob(game, obj, 'butter')).toEqual({ ok: false, reason: 'queue-full' });
    expect(game.count('milk')).toBe(1);
  });

  it('works jobs one at a time, in order', () => {
    const { game, obj } = setup('dairy');
    game.addItem('milk', 3);
    startJob(game, obj, 'cheese'); // 8 min
    startJob(game, obj, 'butter'); // 4 min
    expect(obj.state.queue.map((j) => j.recipe)).toEqual(['cheese', 'butter']);
    expect(obj.state.queue[1].timer).toBeNull();

    wait(game, obj, 240_000); // butter must not have run in parallel
    expect(readyCount(obj)).toBe(0);
    expect(currentProgress(game.state.clock, obj)).toBeCloseTo(0.5);

    wait(game, obj, 240_000);
    expect(obj.state.ready).toEqual({ cheese: 1 });
    expect(obj.state.queue.map((j) => j.recipe)).toEqual(['butter']);
    expect(currentProgress(game.state.clock, obj)).toBe(0);

    wait(game, obj, 240_000);
    expect(obj.state.ready).toEqual({ cheese: 1, butter: 1 });
    expect(currentProgress(game.state.clock, obj)).toBeNull();
  });

  it('finished output does not block the next job, and a big time jump finishes several exactly', () => {
    const { game, obj } = setup('dairy');
    game.addItem('milk', 3);
    startJob(game, obj, 'butter');
    startJob(game, obj, 'butter');
    startJob(game, obj, 'butter');
    expect(wait(game, obj, 540_000)).toBe(2); // 2 × 4 min done, third 1 min in
    expect(obj.state.ready).toEqual({ butter: 2 });
    expect(currentProgress(game.state.clock, obj)).toBeCloseTo(60 / 240);
  });

  it('a job queued while idle starts from now, not from when the last one ended', () => {
    const { game, obj } = setup('dairy');
    game.addItem('milk', 2);
    startJob(game, obj, 'butter');
    wait(game, obj, 1_000_000);
    startJob(game, obj, 'butter');
    expect(currentProgress(game.state.clock, obj)).toBe(0);
  });
});

describe('save and load', () => {
  it('keeps the queue and progress across a reload', () => {
    const { game, obj } = setup('dairy');
    game.addItem('milk', 3);
    startJob(game, obj, 'cheese');
    startJob(game, obj, 'butter');
    wait(game, obj, 160_000);

    const loaded = deserialize(serialize(game.state));
    const game2 = new Game(loaded);
    const obj2 = game2.getObject(obj.id) as unknown as PlacedObject<ProcessorState>;
    sanitize(obj2, game2.state.clock);
    expect(obj2.state.queue.map((j) => j.recipe)).toEqual(['cheese', 'butter']);
    expect(currentProgress(game2.state.clock, obj2)).toBeCloseTo(1 / 3);
    wait(game2, obj2, 320_000);
    expect(obj2.state.ready).toEqual({ cheese: 1 });
  });

  it('sanitize drops junk and restarts a head job without a timer', () => {
    const { game, obj } = setup('dairy');
    (obj.state as unknown) = {
      queue: [{ recipe: 'nope' }, { recipe: 'butter', timer: 'x' }, 5, { recipe: 'cheese', timer: { start: 1, duration: 2 } }],
      ready: { cheese: 2, milk: -1, butter: 'a' },
    };
    sanitize(obj, game.state.clock);
    expect(obj.state.queue.map((j) => j.recipe)).toEqual(['butter', 'cheese']);
    expect(obj.state.queue[0].timer).toEqual({ start: game.now, duration: 240_000 });
    expect(obj.state.queue[1].timer).toBeNull();
    expect(obj.state.ready).toEqual({ cheese: 2 });
  });
});
