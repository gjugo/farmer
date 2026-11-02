import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANIMALS } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { CROP_LIST, CROPS, FIELD } from '../data/crops';
import { PROCESSORS, QUEUE_LIMIT } from '../data/processing';
import { buildWorkMs, PLANT_WORK_MS } from '../data/workers';
import type { FarmContext } from '../game/context';
import { withFarmer } from '../game/workers';
import { buyAnimal, type PenState } from './animals';
import { DAY_MS, START_LAYOUT } from './constants';
import { cropStage, isPloughed, seasonCheck, type FieldState } from './crops';
import { Game } from './game';
import { catchUp } from './offline';
import type { ProcessorState } from './processing';
import { connectToFarmhouse } from './roads';
import { familiesOf } from './families';
import { deserialize, serialize } from './save';
import { SEASON_MS, seasonOf } from './seasons';
import { maxLevelState } from './test-utils';
import type { PlacedObject } from './types';
import { nextWorkEvent, plannedCrop, runWork, siteProgress, workplaceNext } from './work';
import {
  assignFarmer,
  cropPlanOf,
  addFarmer,
  jobsByFarmer,
  keepMakingOf,
  PLAN_BEST,
  setCropPlan,
  setKeepMaking,
  unassignFarmer,
  workerAt,
  workersOf,
} from './workers';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** One tile above and left of the new farm's layout: the spots below are free and the road reaches them. */
const X = START_LAYOUT.x - 1;
const Y = START_LAYOUT.y - 1;

/** A top-level farm, with plenty of money. */
function farm(): Game {
  const game = new Game(maxLevelState());
  game.earn(1_000_000);
  return game;
}

/** Places a finished building (or a site) and, unless `road` is false, lays a path from the farmhouse to it. */
function build<S extends object>(game: Game, type: string, x: number, y: number, { site = false, road = true } = {}): PlacedObject<S> {
  const r = game.place(type, x, y, { site });
  if (!r.ok) throw new Error(`could not place ${type}: ${r.reason}`);
  const fp = getBuildable(type)!.footprint;
  if (road && !connectToFarmhouse(game.state, { x, y, ...fp })) throw new Error(`no road to ${type}`);
  return r.object as unknown as PlacedObject<S>;
}

/** Room for a long run: `n` top-level granaries in free spots far from the farmhouse. */
function granaries(game: Game, n: number): void {
  const { width, height } = game.state.land;
  for (let y = height - 2; y >= 0 && n > 0; y--) {
    for (let x = width - 2; x >= 0 && n > 0; x--) {
      if (!game.checkPlacement('granary', x, y).ok) continue;
      const r = game.place('granary', x, y);
      if (!r.ok) continue;
      r.object.state.level = 3;
      n--;
    }
  }
  if (n > 0) throw new Error('no room for the granaries');
}

/** Plays `ms` of game time in frames of `frameMs` (×1). */
function play(game: Game, ms: number, frameMs = 250): void {
  for (let t = 0; t < ms; t += frameMs) game.tick(Math.min(frameMs, ms - t));
}

/** The activity events of `kinds`, in order. */
function record(game: Game, kinds: ('ploughed' | 'planted' | 'harvested' | 'fed' | 'collected' | 'made' | 'jobStarted' | 'built')[]): string[] {
  const log: string[] = [];
  for (const kind of kinds) game.activity.on(kind, () => log.push(kind));
  return log;
}

function fakeCtx(game: Game): FarmContext {
  return { game, ui: { toast: vi.fn() } } as unknown as FarmContext;
}

describe('work scheduler', () => {
  // A new farm seeds its orders from Math.random; pin it so two farms built alike are equal.
  beforeEach(() => void vi.spyOn(Math, 'random').mockReturnValue(0.5));
  afterEach(() => vi.restoreAllMocks());

  it('an assigned field goes plough → sow → harvest through spring and summer with no input', () => {
    const game = farm();
    const field = build<FieldState>(game, FIELD, X + 1, Y + 5);
    expect(isPloughed(game.state.clock, field.state)).toBe(false);
    const log = record(game, ['ploughed', 'planted', 'harvested']);
    let corn = 0;
    let other = 0;
    game.activity.on('harvested', ({ item, qty }) => (item === 'corn' ? (corn += qty) : (other += qty)));

    expect(assignFarmer(game, field.id)).toEqual({ ok: true, farmer: 0 });
    expect(cropPlanOf(game.state, field.id)).toBe(PLAN_BEST);
    granaries(game, 1); // three corn harvests are more than the farmhouse holds
    // Corn takes half a season, so a season alone has room for one corn harvest.
    play(game, 2 * SEASON_MS);

    expect(log.slice(0, 3)).toEqual(['ploughed', 'planted', 'harvested']);
    expect(log.filter((e) => e === 'harvested').length).toBeGreaterThanOrEqual(3);
    // At the top level the best crop of spring is corn, the longest grower; then it rotates.
    // (Counted as harvested: the family eats some of it.)
    expect(corn).toBeGreaterThanOrEqual(CROPS.corn.harvestQty);
    expect(other).toBeGreaterThan(0);
  });

  it('"Best in season" rotates: it never sows the last harvested crop again while another can be sown', () => {
    const game = farm();
    const field = build<FieldState>(game, FIELD, X + 1, Y + 5);
    // Each sowing, and whether another crop could have been sown then.
    const sown: { crop: string; other: boolean }[] = [];
    game.activity.on('planted', ({ crop }) =>
      sown.push({ crop, other: CROP_LIST.some((c) => c.id !== crop && seasonCheck(game.state.clock, c) === 'ok') }),
    );
    assignFarmer(game, field.id);
    granaries(game, 1);
    play(game, 2 * SEASON_MS);
    const crops = sown.map((s) => s.crop).join(',');
    expect(sown[0].crop).toBe('corn');
    expect(new Set(sown.map((s) => s.crop)).size, crops).toBeGreaterThanOrEqual(2);
    // The same crop twice in a row only when nothing else could be sown (late summer: wheat only).
    for (let i = 1; i < sown.length; i++) if (sown[i].crop === sown[i - 1].crop) expect(sown[i].other, crops).toBe(false);
  });

  it('a field sows its crop plan, and nothing with "None"', () => {
    const game = farm();
    const [field] = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    assignFarmer(game, field.id);
    setCropPlan(game, field.id, 'wheat');
    play(game, 10_000);
    expect(field.state.crop).toBe('wheat');

    const other = game.objectsOfType(FIELD)[1] as PlacedObject<FieldState>;
    unassignFarmer(game, 0);
    assignFarmer(game, other.id, 0);
    setCropPlan(game, other.id, 'none');
    play(game, 10 * MIN);
    expect(other.state.crop).toBeNull();
    expect(workplaceNext(game, other)).toEqual({ wait: 'no-plan' });
  });

  it('a field waits while money is short', () => {
    const game = farm();
    const [field] = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    game.spend(game.money - 3);
    assignFarmer(game, field.id);
    play(game, 10_000);
    expect(field.state.crop).toBeNull();
    expect(workplaceNext(game, field)).toMatchObject({ wait: 'money', cost: CROPS.corn.plantCost });
    game.earn(100);
    play(game, 250);
    expect(field.state.crop).toBe('corn');
  });

  it('an unploughed field is ploughed for free, even with no money', () => {
    const game = farm();
    const [field] = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    field.state.ploughedAt = null;
    game.spend(game.money);
    assignFarmer(game, field.id);
    expect(workplaceNext(game, field)).toMatchObject({ task: { kind: 'plough' } });
    play(game, 10_000);
    expect(isPloughed(game.state.clock, field.state)).toBe(true);
    expect(game.money).toBe(0);
  });

  it('pens get fed and collected in winter', () => {
    const game = farm();
    game.state.clock.elapsed = 3 * SEASON_MS; // winter: a cycle takes feed
    const coop = build<PenState>(game, 'coop', X + 1, Y + 5);
    buyAnimal(game, coop, 'chicken');
    buyAnimal(game, coop, 'chicken');
    game.addItem('feed', 4);
    assignFarmer(game, coop.id);
    const log = record(game, ['fed', 'collected']);

    play(game, 2 * ANIMALS.chicken.cycleMs + 30_000);

    expect(log.slice(0, 3)).toEqual(['fed', 'collected', 'fed']);
    expect(game.count('egg')).toBe(4);
    expect(game.count('feed')).toBe(0);
    // Out of feed: the farmer waits, and says why.
    expect(workplaceNext(game, coop)).toEqual({ wait: 'feed' });
  });

  it('from spring to autumn pens run full cycles on grazing: no feed taken, never waiting for feed', () => {
    for (const season of [0, 1, 2]) {
      const game = farm();
      game.state.clock.elapsed = season * SEASON_MS;
      const coop = build<PenState>(game, 'coop', X + 1, Y + 5);
      buyAnimal(game, coop, 'chicken');
      buyAnimal(game, coop, 'chicken');
      assignFarmer(game, coop.id);
      const log = record(game, ['fed', 'collected']);

      play(game, 2 * ANIMALS.chicken.cycleMs + 30_000);

      expect(log.slice(0, 3)).toEqual(['fed', 'collected', 'fed']);
      expect(game.count('egg')).toBeGreaterThanOrEqual(2);
      expect(game.count('feed')).toBe(0);
      expect(['grazing', undefined]).toContain((workplaceNext(game, coop) as { wait?: string }).wait);
    }
  });

  it('processing keeps making its recipe while inputs last, and collects the goods', () => {
    const game = farm();
    const dairy = build<ProcessorState>(game, 'dairy', X + 1, Y + 5);
    game.addItem('milk', 4);
    // The family eats from the first foods in stock (carrots, potatoes), leaving the milk and butter alone.
    Object.assign(game.state.inventory, { potato: 4, carrot: 4 });
    setKeepMaking(game, dairy.id, 'butter');
    expect(keepMakingOf(game.state, dairy.id)).toBe('butter');
    assignFarmer(game, dairy.id);

    const butterMs = PROCESSORS.dairy.recipes.find((r) => r.id === 'butter')!.durationMs;
    play(game, 4 * butterMs + MIN);

    expect(game.count('milk')).toBe(0);
    expect(game.count('butter')).toBe(4);
    expect(dairy.state.queue).toHaveLength(0);
    expect(workplaceNext(game, dairy)).toEqual({ wait: 'inputs' });
  });

  it.each([
    ['malthouse', 'malt'],
    ['brewery', 'ale'],
    ['loom', 'linen'],
    ['tailor', 'clothes-from-cloth'],
    ['tailor', 'clothes-from-linen'],
  ] as const)('an assigned farmer keeps the %s making %s up to the queue limit, and collects it', (type, recipeId) => {
    const game = farm();
    granaries(game, 2);
    const obj = build<ProcessorState>(game, type, X + 1, Y + 5);
    const recipe = PROCESSORS[type].recipes.find((r) => r.id === recipeId)!;
    const batches = QUEUE_LIMIT + 1;
    for (const [id, n] of Object.entries(recipe.inputs)) game.addItem(id, n! * batches);
    Object.assign(game.state.inventory, { potato: 20, carrot: 20 });
    // The family drinks ale as it comes in: count what they drank as made too.
    let drunk = 0;
    game.activity.on('familiesSettled', () => (drunk += familiesOf(game.state).lastDay?.aleDrunk ?? 0));
    const made = () => game.count(recipe.output.item) + (recipe.output.item === 'ale' ? drunk : 0);
    setKeepMaking(game, obj.id, recipeId);
    assignFarmer(game, obj.id);

    play(game, recipe.durationMs - MIN);
    // The queue fills up to its limit, and no further, before the first batch is done.
    expect(obj.state.queue.length).toBe(QUEUE_LIMIT);
    expect(made()).toBe(0);
    play(game, batches * recipe.durationMs + 2 * MIN);
    for (const id of Object.keys(recipe.inputs)) expect(game.count(id), id).toBe(0);
    expect(made()).toBe(batches * recipe.output.qty);
    expect(obj.state.queue).toHaveLength(0);
    expect(workplaceNext(game, obj)).toEqual({ wait: 'inputs' });
  });

  it('a farmer whose workplace is idle builds a site, takes a hand-ordered job, then goes back', () => {
    const game = farm();
    const [field, other] = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    assignFarmer(game, field.id);
    play(game, 1000); // the farmer is out sowing corn
    const coop = build<PenState>(game, 'coop', X + 1, Y + 5, { site: true });
    expect(coop.site).toBeDefined();

    // Back from sowing, nothing to do at the field while the corn grows: build the coop.
    play(game, PLANT_WORK_MS + 20_000);
    expect(jobsByFarmer(game.state.clock, workersOf(game.state))[0]).toMatchObject({ kind: 'build', target: coop.id });
    expect(siteProgress(game.state, coop.id)?.farmer).toBe(0);
    play(game, buildWorkMs('coop') + 10_000);
    expect(coop.site).toBeUndefined();

    // Idle again: a tap on the other field gets this farmer.
    expect(withFarmer(fakeCtx(game), 'plant', other, PLANT_WORK_MS, () => true)).toBe(true);
    expect(jobsByFarmer(game.state.clock, workersOf(game.state))[0]).toMatchObject({ kind: 'plant' });

    // The corn ripens: after that job the farmer goes back and harvests it.
    const log = record(game, ['harvested']);
    play(game, CROPS.corn.growMs);
    expect(log).toContain('harvested');
    expect(cropStage(game.state.clock, field.state)).not.toBe('ripe');
  });

  it('a site cannot be used before it is finished, and demolishing it refunds everything', () => {
    const game = farm();
    const coop = build<PenState>(game, 'coop', X + 1, Y + 5, { site: true, road: false });
    expect(coop.site).toEqual({ workMs: buildWorkMs('coop'), paid: getBuildable('coop')!.cost });
    expect(assignFarmer(game, coop.id)).toEqual({ ok: false, reason: 'site' });
    expect(workplaceNext(game, coop)).toEqual({ wait: 'site' });
    // No path: never built.
    play(game, 5 * MIN);
    expect(coop.site).toBeDefined();
    expect(siteProgress(game.state, coop.id)).toBeNull();

    const before = game.money;
    expect(game.demolish(coop.id)).toBe(getBuildable('coop')!.cost);
    expect(game.money).toBe(before + getBuildable('coop')!.cost);
  });

  it('free farmers build sites oldest first; demolishing a site sends its builder home', () => {
    const game = farm();
    const first = build(game, 'coop', X + 1, Y + 5, { site: true });
    const second = build(game, FIELD, X + 6, Y + 5, { site: true });
    play(game, 250);
    expect(siteProgress(game.state, first.id)).not.toBeNull();
    expect(siteProgress(game.state, second.id)).toBeNull();
    game.demolish(first.id);
    play(game, 250);
    expect(siteProgress(game.state, second.id)?.farmer).toBe(0);
  });

  it('nothing happens without a path from the farmhouse', () => {
    const game = farm();
    const field = build<FieldState>(game, FIELD, X + 1, Y + 5, { road: false });
    assignFarmer(game, field.id);
    const money = game.money;
    play(game, SEASON_MS);
    expect(isPloughed(game.state.clock, field.state)).toBe(false);
    expect(game.money).toBe(money);
    expect(workersOf(game.state).jobs).toHaveLength(0);
  });

  it('runs on game time: any clock speed gives the same farm', () => {
    const setUp = () => {
      const game = farm();
      const [field] = game.objectsOfType(FIELD);
      assignFarmer(game, field.id);
      return game;
    };
    const slow = setUp();
    play(slow, 20 * MIN, 250);
    const fast = setUp();
    fast.setSpeed(60);
    for (let i = 0; i < (20 * MIN) / (250 * 60); i++) fast.tick(250);
    fast.setSpeed(1);
    expect(fast.state).toEqual(slow.state);
  });

  it('catching up over hours matches running live', () => {
    const setUp = () => {
      const game = farm();
      addFarmer(game);
      addFarmer(game);
      const [a, b] = game.objectsOfType(FIELD);
      const coop = build<PenState>(game, 'coop', X + 1, Y + 5);
      for (let i = 0; i < 3; i++) buyAnimal(game, coop, 'chicken');
      game.addItem('feed', 30);
      assignFarmer(game, a.id);
      assignFarmer(game, b.id);
      assignFarmer(game, coop.id);
      build(game, 'dairy', X + 6, Y + 5, { site: true });
      granaries(game, 2);
      return game;
    };
    const live = setUp();
    play(live, 3 * HOUR, 250);
    const away = setUp();
    const result = catchUp(away, 3 * HOUR);

    expect(away.state.inventory).toEqual(live.state.inventory);
    expect(away.money).toBe(live.money);
    expect(away.state.objects).toEqual(live.state.objects);
    expect(result.work.harvested.corn).toBeGreaterThan(0);
    expect(result.work.sown.corn).toBeGreaterThan(0);
    expect(result.work.collected.egg).toBeGreaterThan(0);
    expect(result.work.built).toEqual({ dairy: 1 });
  });

  it('catches up on a week away quickly, stepping from one job to the next', () => {
    const game = farm();
    for (let i = 0; i < 5; i++) addFarmer(game);
    // Corn and wheat (for the mill): flax, which nobody eats yet, would fill the granary over a week.
    for (const [i, f] of game.objectsOfType(FIELD).entries()) {
      assignFarmer(game, f.id);
      setCropPlan(game, f.id, i === 0 ? 'corn' : 'wheat');
    }
    const coop = build<PenState>(game, 'coop', X + 1, Y + 5);
    for (let i = 0; i < 6; i++) buyAnimal(game, coop, 'chicken');
    game.addItem('feed', 500);
    assignFarmer(game, coop.id);
    const mill = build<ProcessorState>(game, 'feed-mill', X + 6, Y + 5);
    setKeepMaking(game, mill.id, 'flour');
    game.addItem('wheat', 400);
    assignFarmer(game, mill.id);
    granaries(game, 4);

    const started = performance.now();
    const result = catchUp(game, 7 * 24 * HOUR);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(result.work.harvested.corn).toBeGreaterThan(0);
    expect(result.work.made.flour).toBeGreaterThan(0);
    expect(nextWorkEvent(game)).toBeGreaterThan(game.now);
  });

  it('a full granary: the field and pen wait, and work goes on once there is room', () => {
    const game = farm();
    const [field] = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    addFarmer(game);
    game.addItem('potato', 6); // the families' first meals, until the corn comes in
    assignFarmer(game, field.id);
    setCropPlan(game, field.id, 'corn');
    // Two corn harvests come in, and a third is sown.
    play(game, 2 * CROPS.corn.growMs + 5 * MIN);
    // Fill the store, so the third harvest has no room.
    game.addItem('potato', game.spaceFor('potato'));
    play(game, CROPS.corn.growMs);
    expect(cropStage(game.state.clock, field.state)).toBe('ripe');
    expect(game.spaceFor('corn')).toBeLessThan(CROPS.corn.harvestQty);

    const coop = build<PenState>(game, 'coop', X + 1, Y + 5);
    for (let i = 0; i < 3; i++) buyAnimal(game, coop, 'chicken');
    game.addItem('feed', 10);
    assignFarmer(game, coop.id);
    const log = record(game, ['harvested', 'collected', 'fed']);
    play(game, 20_000);
    expect(log).toEqual(['fed']); // the field's farmer stays put: no room for the corn
    // On to a new day, so no meal frees room in the store during the cycle below, and to the hens' next feeding.
    play(game, (Math.floor(game.now / DAY_MS) + 1) * DAY_MS - game.now + 1000);
    game.state.inventory.feed = (game.state.inventory.feed ?? 0) + 10;
    log.length = 0;
    for (let i = 0; i < 300 && !log.includes('fed'); i++) play(game, 1000);
    expect(log).toContain('fed');
    game.addItem('potato', 1000); // fill the farmhouse store (feeding freed some)
    log.length = 0;
    play(game, ANIMALS.chicken.cycleMs);

    expect(game.spaceFor('corn')).toBe(0);
    expect(log).toEqual([]);
    expect(workplaceNext(game, field)).toEqual({ wait: 'full' });
    expect(workplaceNext(game, coop)).toEqual({ wait: 'full' });

    for (const id of ['potato', 'corn']) game.removeItem(id, game.count(id));
    play(game, MIN);
    expect(log).toContain('harvested');
    expect(log).toContain('collected');
  });

  it('a building keeps loading its queue while its goods wait for room', () => {
    const game = farm();
    const mill = build<ProcessorState>(game, 'feed-mill', X + 6, Y + 5);
    mill.state.ready = { flour: 5 };
    game.addItem('wheat', 10);
    game.addItem('corn', 1000); // fill the farmhouse store
    expect(game.spaceFor('flour')).toBe(0);
    expect(workplaceNext(game, mill)).toEqual({ wait: 'full' });
    setKeepMaking(game, mill.id, 'flour');
    expect(workplaceNext(game, mill)).toMatchObject({ task: { kind: 'load' } });
  });

  it('assignments, plans, recipes and sites survive save/load; old saves have none', () => {
    const game = farm();
    addFarmer(game);
    const [field] = game.objectsOfType(FIELD);
    const dairy = build(game, 'dairy', X + 1, Y + 5);
    const site = build(game, 'coop', X + 6, Y + 5, { site: true, road: false });
    assignFarmer(game, field.id);
    setCropPlan(game, field.id, 'carrot');
    assignFarmer(game, dairy.id);
    setKeepMaking(game, dairy.id, 'cheese');

    const loaded = new Game(deserialize(serialize(game.state)));
    expect(workerAt(loaded.state, field.id)).toBe(0);
    expect(workerAt(loaded.state, dairy.id)).toBe(1);
    expect(cropPlanOf(loaded.state, field.id)).toBe('carrot');
    expect(keepMakingOf(loaded.state, dairy.id)).toBe('cheese');
    expect(loaded.getObject(site.id)?.site).toEqual(site.site);

    const old = JSON.parse(serialize(game.state));
    old.state.ext.workers = { farmers: 2, jobs: [] };
    for (const o of old.state.objects) delete o.site;
    const oldGame = new Game(deserialize(JSON.stringify(old)));
    expect(workersOf(oldGame.state)).toMatchObject({ farmers: 2, workplaces: [null, null], plans: {}, recipes: {} });
    expect(oldGame.state.objects.some((o) => o.site)).toBe(false);
  });

  it('demolishing a workplace frees its farmer; one farmer per workplace', () => {
    const game = farm();
    addFarmer(game);
    const [a, b] = game.objectsOfType(FIELD);
    assignFarmer(game, a.id);
    expect(assignFarmer(game, a.id)).toEqual({ ok: false, reason: 'taken' });
    // Assigning a farmer elsewhere moves them.
    assignFarmer(game, b.id, 0);
    expect(workerAt(game.state, a.id)).toBeNull();
    expect(workerAt(game.state, b.id)).toBe(0);
    game.demolish(b.id);
    expect(workersOf(game.state).workplaces).toEqual([null, null]);
  });

  it('"Best in season" picks the longest crop that is ripe before its seasons end', () => {
    const game = farm();
    const [field] = game.objectsOfType(FIELD);
    assignFarmer(game, field.id);
    expect(plannedCrop(game, field.id)?.id).toBe('corn');
    game.state.clock.elapsed = SEASON_MS; // summer: pumpkin, the longest grower, is ripe before autumn ends
    expect(plannedCrop(game, field.id)?.id).toBe('pumpkin');
    game.state.clock.elapsed = 2 * SEASON_MS; // autumn: cabbage, which ripens in winter
    expect(plannedCrop(game, field.id)?.id).toBe('cabbage');
    game.state.clock.elapsed = 3 * SEASON_MS - CROPS.pumpkin.growMs + 1; // late autumn: pumpkin no longer ripens in time
    expect(plannedCrop(game, field.id)?.id).toBe('cabbage');
    game.state.clock.elapsed = 4 * SEASON_MS - CROPS.cabbage.growMs + 1; // too late for cabbage: winter rye still ripens
    expect(plannedCrop(game, field.id)?.id).toBe('rye');
    game.state.clock.elapsed = 4 * SEASON_MS - CROPS.rye.growMs + 1; // too late for rye, and so for everything
    expect(plannedCrop(game, field.id)).toBeNull();
    game.state.clock.elapsed = 3 * SEASON_MS + 1000; // winter: nothing is sown, not even cabbage
    expect(plannedCrop(game, field.id)).toBeNull();
    game.state.clock.elapsed = 4 * SEASON_MS - 1000; // the end of winter
    expect(plannedCrop(game, field.id)).toBeNull();
  });

  it('a farmer sows cabbage in autumn and harvests it in winter, after the frost', () => {
    const game = farm();
    const [field] = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
    game.addItem('potato', 20); // the family's meals
    game.state.clock.elapsed = 2 * SEASON_MS; // autumn
    assignFarmer(game, field.id);
    setCropPlan(game, field.id, 'cabbage');
    const log: { kind: string; season: string }[] = [];
    for (const kind of ['planted', 'harvested'] as const) game.activity.on(kind, () => log.push({ kind, season: seasonOf(game.state.clock) }));
    runWork(game, 4 * SEASON_MS - 1000); // to the end of winter
    expect(log[0]).toEqual({ kind: 'planted', season: 'autumn' });
    expect(log).toContainEqual({ kind: 'harvested', season: 'winter' });
    // Nothing more is sown in winter: the field waits for spring.
    expect(log.filter((e) => e.kind === 'planted')).toHaveLength(1);
    expect(game.count('cabbage')).toBeGreaterThan(0);
  });

  it('"Best in season" weighs all nine crops by level: corn at level 4, potato and winter rye at level 3', () => {
    const game = farm();
    const [field] = game.objectsOfType(FIELD);
    assignFarmer(game, field.id);
    expect(CROP_LIST).toHaveLength(9);
    game.progression.setLevel(3);
    expect(plannedCrop(game, field.id)?.id).toBe('potato');
    game.state.clock.elapsed = 2 * SEASON_MS; // autumn at level 3: winter rye (no cabbage before level 6)
    expect(plannedCrop(game, field.id)?.id).toBe('rye');
    game.progression.setLevel(2); // and carrot before rye comes
    expect(plannedCrop(game, field.id)?.id).toBe('carrot');
    game.progression.setLevel(6);
    expect(plannedCrop(game, field.id)?.id).toBe('cabbage');
    game.state.clock.elapsed = SEASON_MS; // summer at level 6: no pumpkin yet, so corn
    expect(plannedCrop(game, field.id)?.id).toBe('corn');
    // Rotation: after a corn harvest it sows the next longest, flax.
    (game.getObject(field.id)!.state as FieldState).lastCrop = 'corn';
    expect(plannedCrop(game, field.id)?.id).toBe('flax');
  });
});
