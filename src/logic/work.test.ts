import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANIMALS } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { CROPS, FIELD } from '../data/crops';
import { PROCESSORS } from '../data/processing';
import { buildWorkMs, PLANT_WORK_MS } from '../data/workers';
import type { FarmContext } from '../game/context';
import { withFarmer } from '../game/workers';
import { buyAnimal, type PenState } from './animals';
import { START_LAYOUT } from './constants';
import { cropStage, isPloughed, type FieldState } from './crops';
import { Game } from './game';
import { setOwned } from './land';
import { catchUp } from './offline';
import type { ProcessorState } from './processing';
import { connectToFarmhouse } from './roads';
import { deserialize, serialize } from './save';
import { SEASON_MS } from './seasons';
import { maxLevelState } from './test-utils';
import type { PlacedObject } from './types';
import { nextWorkEvent, plannedCrop, siteProgress, workplaceNext } from './work';
import {
  assignFarmer,
  cropPlanOf,
  hireFarmer,
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

/** A top-level farm owning the whole map, with plenty of money. */
function farm(): Game {
  const game = new Game(maxLevelState());
  game.earn(1_000_000);
  const land = game.state.land;
  for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) setOwned(land, x, y, true);
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

    expect(assignFarmer(game, field.id)).toEqual({ ok: true, farmer: 0 });
    expect(cropPlanOf(game.state, field.id)).toBe(PLAN_BEST);
    // Corn takes half a season, so a season alone has room for one corn harvest.
    play(game, 2 * SEASON_MS);

    expect(log.slice(0, 3)).toEqual(['ploughed', 'planted', 'harvested']);
    expect(log.filter((e) => e === 'harvested').length).toBeGreaterThanOrEqual(3);
    // At the top level the best crop of spring is corn, the longest grower.
    expect(game.count('corn')).toBeGreaterThanOrEqual(3 * CROPS.corn.harvestQty);
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

  it('pens get fed and collected', () => {
    const game = farm();
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

  it('processing keeps making its recipe while inputs last, and collects the goods', () => {
    const game = farm();
    const dairy = build<ProcessorState>(game, 'dairy', X + 1, Y + 5);
    game.addItem('milk', 4);
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
      hireFarmer(game);
      hireFarmer(game);
      const [a, b] = game.objectsOfType(FIELD);
      const coop = build<PenState>(game, 'coop', X + 1, Y + 5);
      for (let i = 0; i < 3; i++) buyAnimal(game, coop, 'chicken');
      game.addItem('feed', 30);
      assignFarmer(game, a.id);
      assignFarmer(game, b.id);
      assignFarmer(game, coop.id);
      build(game, 'dairy', X + 6, Y + 5, { site: true });
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
    for (let i = 0; i < 5; i++) hireFarmer(game);
    for (const f of game.objectsOfType(FIELD)) assignFarmer(game, f.id);
    const coop = build<PenState>(game, 'coop', X + 1, Y + 5);
    for (let i = 0; i < 6; i++) buyAnimal(game, coop, 'chicken');
    game.addItem('feed', 500);
    assignFarmer(game, coop.id);
    const mill = build<ProcessorState>(game, 'feed-mill', X + 6, Y + 5);
    setKeepMaking(game, mill.id, 'feed-from-wheat');
    game.addItem('wheat', 400);
    assignFarmer(game, mill.id);

    const started = performance.now();
    const result = catchUp(game, 7 * 24 * HOUR);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(result.work.harvested.corn).toBeGreaterThan(0);
    expect(result.work.made.feed).toBeGreaterThan(0);
    expect(nextWorkEvent(game)).toBeGreaterThan(game.now);
  });

  it('assignments, plans, recipes and sites survive save/load; old saves have none', () => {
    const game = farm();
    hireFarmer(game);
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
    hireFarmer(game);
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
    game.state.clock.elapsed = 2 * SEASON_MS; // autumn: no corn
    expect(plannedCrop(game, field.id)?.id).toBe('carrot');
    game.state.clock.elapsed = 4 * SEASON_MS - 1000; // the end of winter
    expect(plannedCrop(game, field.id)).toBeNull();
  });
});
