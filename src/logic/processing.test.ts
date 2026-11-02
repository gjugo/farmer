import { describe, expect, it } from 'vitest';
import { PROCESSORS, QUEUE_LIMIT, recipeUnlockLevel, type RecipeDef } from '../data/processing';
import { CROPS } from '../data/crops';
import { getItem } from '../data/items';
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
import type { PlacedObject } from './types';

function setup(type: keyof typeof PROCESSORS = 'dairy') {
  const game = new Game(maxLevelState());
  game.earn(10_000);
  const placed = game.place(type, 0, 0);
  if (!placed.ok) throw new Error(`could not place ${type}: ${placed.reason}`);
  return { game, obj: placed.object as unknown as PlacedObject<ProcessorState> };
}

/** Another building of `type` beside the first one. */
function second(game: Game, type: keyof typeof PROCESSORS): PlacedObject<ProcessorState> {
  const placed = game.place(type, 4, 0);
  if (!placed.ok) throw new Error(`could not place ${type}: ${placed.reason}`);
  return placed.object as unknown as PlacedObject<ProcessorState>;
}

/** Advances game time by `ms` and settles the building, as the scene does every frame. */
function wait(game: Game, obj: PlacedObject<ProcessorState>, ms: number): number {
  game.state.clock.elapsed += ms;
  return settle(game.state, obj);
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

  it('wheat → flour → bread: the Windmill grinds 3 wheat into 3 flour, the bakery bakes 2 flour into 3 bread, no egg', () => {
    const { game, obj: mill } = setup('feed-mill');
    game.addItem('wheat', 3);
    expect(startJob(game, mill, 'flour').ok).toBe(true);
    expect(game.count('wheat')).toBe(0);
    expect(wait(game, mill, 119_999)).toBe(0);
    expect(wait(game, mill, 1)).toBe(1);
    expect(collect(game, mill)).toEqual({ flour: 3 });
    const bakery = second(game, 'bakery');
    game.addItem('egg', 1);
    expect(startJob(game, bakery, 'bread').ok).toBe(true);
    expect(game.count('flour')).toBe(1);
    expect(game.count('egg')).toBe(1);
    expect(checkStart(game, bakery, 'bread')).toEqual({ ok: false, reason: 'inputs' });
    wait(game, bakery, 240_000);
    expect(collect(game, bakery)).toEqual({ bread: 3 });
  });

  it('rye → rye flour → rye bread, the same way', () => {
    const { game, obj: mill } = setup('feed-mill');
    game.addItem('rye', 3);
    expect(startJob(game, mill, 'rye-flour').ok).toBe(true);
    wait(game, mill, 120_000);
    expect(collect(game, mill)).toEqual({ 'rye-flour': 3 });
    const bakery = second(game, 'bakery');
    expect(startJob(game, bakery, 'rye-bread').ok).toBe(true);
    expect(game.count('rye-flour')).toBe(1);
    // Wheat flour doesn't make rye bread, nor rye flour bread.
    expect(checkStart(game, bakery, 'bread')).toEqual({ ok: false, reason: 'inputs' });
    wait(game, bakery, 240_000);
    expect(collect(game, bakery)).toEqual({ 'rye-bread': 3 });
  });

  it('the Windmill makes flour from level 2 and rye flour from level 3; it makes no feed (the Feed Barn does)', () => {
    const mill = PROCESSORS['feed-mill'];
    expect(mill).toMatchObject({ name: 'Windmill', unlockLevel: 2, anim: 'sails', description: 'Grinds wheat and rye into flour for the bakery.' });
    expect(mill.recipes.map((r) => [r.id, recipeUnlockLevel(mill, r)])).toEqual([
      ['flour', 2],
      ['rye-flour', 3],
    ]);
    expect(mill.recipes.some((r) => r.output.item === 'feed')).toBe(false);
    const bakery = PROCESSORS.bakery;
    expect(bakery.recipes.map((r) => [r.id, recipeUnlockLevel(bakery, r)])).toEqual([
      ['bread', 2],
      ['rye-bread', 3],
    ]);
  });

  it('milling and baking earn more than selling the grain raw, but per minute no more than twice what a wheat field does', () => {
    const price = (id: string) => getItem(id)!.price;
    // A wheat field's farmer: a harvest's worth less the seed, over its growing time.
    const field = (CROPS.wheat.harvestQty * price('wheat') - CROPS.wheat.plantCost) / (CROPS.wheat.growMs / 60_000);
    for (const type of ['feed-mill', 'bakery'] as const) {
      for (const r of PROCESSORS[type].recipes) {
        const inputs = Object.entries(r.inputs).reduce((sum, [id, n]) => sum + price(id) * n!, 0);
        const added = price(r.output.item) * r.output.qty - inputs;
        expect(added, r.id).toBeGreaterThan(0);
        expect(added / (r.durationMs / 60_000), r.id).toBeLessThanOrEqual(2 * field);
      }
    }
    expect(price('rye-bread')).toBeGreaterThan(price('bread'));
  });

  it('malthouse malts barley: 3 barley make 2 malt in 5 min', () => {
    const { game, obj } = setup('malthouse');
    game.addItem('barley', 3);
    expect(startJob(game, obj, 'malt').ok).toBe(true);
    expect(game.count('barley')).toBe(0);
    expect(wait(game, obj, 299_999)).toBe(0);
    expect(wait(game, obj, 1)).toBe(1);
    expect(collect(game, obj)).toEqual({ malt: 2 });
  });

  it('brewery brews malt into ale: 2 malt make 1 ale in 10 min', () => {
    const { game, obj } = setup('brewery');
    game.addItem('malt', 3);
    expect(startJob(game, obj, 'ale').ok).toBe(true);
    expect(game.count('malt')).toBe(1);
    expect(checkStart(game, obj, 'ale')).toEqual({ ok: false, reason: 'inputs' });
    wait(game, obj, 600_000);
    expect(collect(game, obj)).toEqual({ ale: 1 });
  });

  it('the loom weaves flax into linen as well as wool into cloth', () => {
    const { game, obj } = setup('loom');
    game.addItem('flax', 3);
    game.addItem('wool', 2);
    expect(startJob(game, obj, 'linen').ok).toBe(true);
    expect(startJob(game, obj, 'cloth').ok).toBe(true);
    expect(game.count('flax') + game.count('wool')).toBe(0);
    wait(game, obj, 480_000 + 600_000);
    expect(collect(game, obj)).toEqual({ linen: 1, cloth: 1 });
  });

  it('the tailor sews clothes from 2 cloth or from 2 linen', () => {
    const { game, obj } = setup('tailor');
    game.addItem('cloth', 2);
    game.addItem('linen', 2);
    expect(startJob(game, obj, 'clothes-from-cloth').ok).toBe(true);
    expect(startJob(game, obj, 'clothes-from-linen').ok).toBe(true);
    expect(game.count('cloth') + game.count('linen')).toBe(0);
    wait(game, obj, 1_200_000);
    expect(collect(game, obj)).toEqual({ clothes: 2 });
  });

  it('no goods recipe is worth less than its inputs at base prices (feed is a supply, not for sale)', () => {
    // Cloth → clothes only breaks even: the clothes are for the families (+15 approval instead of cloth's +10).
    for (const p of Object.values(PROCESSORS)) {
      for (const r of p.recipes.filter((x) => getItem(x.output.item)!.category === 'processed')) {
        const cost = Object.entries(r.inputs).reduce((sum, [id, n]) => sum + getItem(id)!.price * n!, 0);
        expect(getItem(r.output.item)!.price * r.output.qty, `${p.id}/${r.id}`).toBeGreaterThanOrEqual(cost);
      }
    }
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
    sanitize(obj2, game2.state);
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
    sanitize(obj, game.state);
    expect(obj.state.queue.map((j) => j.recipe)).toEqual(['butter', 'cheese']);
    expect(obj.state.queue[0].timer).toEqual({ start: game.now, duration: 240_000 });
    expect(obj.state.queue[1].timer).toBeNull();
    expect(obj.state.ready).toEqual({ cheese: 2 });
  });
});
