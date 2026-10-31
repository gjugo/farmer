import { describe, expect, it, vi } from 'vitest';
import { FIELD } from '../data/crops';
import { WALK_MS_PER_TILE } from '../data/farmhouse';
import {
  BASE_HIRE_COST,
  buildWorkMs,
  BUILD_WORK_MAX_MS,
  BUILD_WORK_MIN_MS,
  FEED_WORK_MS,
  HARVEST_WORK_MS,
  MAX_FARMERS,
  PLANT_WORK_MS,
  PLOUGH_WORK_MS,
} from '../data/workers';
import type { FarmContext } from '../game/context';
import { NO_ROAD_MESSAGE, withFarmer } from '../game/workers';
import { START_LAND } from './constants';
import { STARTING_FIELDS } from './crops';
import { Game } from './game';
import { deserialize, serialize } from './save';
import { findRoute } from './roads';
import { activeJobs, assignJob, busyFarmers, freeFarmers, hireCost, hireFarmer, jobPhase, nextFreeIn, walkMs, workersOf } from './workers';

/** Advances game time by `ms` in frame-sized steps. */
function run(game: Game, ms: number): void {
  for (let t = 0; t < ms; t += 100) game.tick(100);
}

/** Just enough context for `withFarmer`: the game and a toast spy. */
function fakeCtx(game: Game): FarmContext & { toast: ReturnType<typeof vi.fn> } {
  const toast = vi.fn();
  return { game, ui: { toast }, toast } as unknown as FarmContext & { toast: ReturnType<typeof vi.fn> };
}

describe('farmers', () => {
  it('a new farm starts with one free farmer', () => {
    const game = new Game();
    expect(workersOf(game.state)).toEqual({ farmers: 1, jobs: [] });
    expect(freeFarmers(game.state)).toBe(1);
  });

  it('a job keeps a farmer busy until its timer ends', () => {
    const game = new Game();
    expect(assignJob(game, 'plant', 1, 1, 4000)).toBe(true);
    expect(busyFarmers(game.state)).toBe(1);
    expect(freeFarmers(game.state)).toBe(0);
    expect(assignJob(game, 'plant', 2, 2, 4000)).toBe(false);
    expect(workersOf(game.state).jobs).toHaveLength(1);
    run(game, 1000);
    expect(nextFreeIn(game.state)).toBe(3000);
    run(game, 3000);
    expect(freeFarmers(game.state)).toBe(1);
    expect(nextFreeIn(game.state)).toBe(0);
    expect(assignJob(game, 'feed', 2, 2, 4000)).toBe(true);
    expect(workersOf(game.state).jobs).toHaveLength(1); // the finished job was dropped
  });

  it('a 0 ms job needs no farmer', () => {
    const game = new Game();
    assignJob(game, 'plant', 1, 1, 4000);
    expect(assignJob(game, 'build', 1, 1, 0)).toBe(true);
    expect(workersOf(game.state).jobs).toHaveLength(1);
  });

  it('hiring costs money, rises with each farmer and stops at the maximum', () => {
    const game = new Game();
    game.earn(1_000_000);
    expect(hireCost(game.state)).toBe(BASE_HIRE_COST);
    const costs: number[] = [];
    while (hireCost(game.state) !== null) {
      const cost = hireCost(game.state)!;
      const before = game.money;
      costs.push(cost);
      expect(hireFarmer(game).ok).toBe(true);
      expect(game.money).toBe(before - cost);
    }
    expect(workersOf(game.state).farmers).toBe(MAX_FARMERS);
    expect(costs).toHaveLength(MAX_FARMERS - 1);
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1]);
    expect(hireFarmer(game)).toEqual({ ok: false, reason: 'max' });
  });

  it('cannot hire without the money, and nothing changes', () => {
    const game = new Game();
    game.spend(game.money - (BASE_HIRE_COST - 1));
    expect(hireFarmer(game)).toEqual({ ok: false, reason: 'money' });
    expect(workersOf(game.state).farmers).toBe(1);
    expect(game.money).toBe(BASE_HIRE_COST - 1);
  });

  it('two farmers can work at once', () => {
    const game = new Game();
    hireFarmer(game);
    expect(assignJob(game, 'plant', 1, 1, 4000)).toBe(true);
    expect(assignJob(game, 'feed', 5, 5, 4000)).toBe(true);
    expect(assignJob(game, 'harvest', 3, 3, 4000)).toBe(false);
    expect(activeJobs(game.state.clock, workersOf(game.state))).toHaveLength(2);
  });

  it('farmers and running jobs survive save/load; broken saves fall back to one farmer', () => {
    const game = new Game();
    hireFarmer(game);
    assignJob(game, 'plant', 1, 1, 4000);
    const loaded = new Game(deserialize(serialize(game.state)));
    expect(workersOf(loaded.state).farmers).toBe(2);
    expect(freeFarmers(loaded.state)).toBe(1);

    const broken = new Game();
    broken.state.ext.workers = { farmers: -3, jobs: [null, { kind: 'plant' }] };
    expect(workersOf(broken.state)).toEqual({ farmers: 1, jobs: [] });
  });

  it('building time grows with the footprint, within limits; paths need no farmer', () => {
    expect(buildWorkMs('path')).toBe(0);
    expect(buildWorkMs(FIELD)).toBeGreaterThanOrEqual(BUILD_WORK_MIN_MS);
    expect(buildWorkMs(FIELD)).toBeLessThanOrEqual(BUILD_WORK_MAX_MS);
  });

  it('farm work takes a while: building 30 s to 3 min by size, ploughing and harvesting 40 s, sowing 30 s, feeding 20 s', () => {
    expect([BUILD_WORK_MIN_MS, BUILD_WORK_MAX_MS]).toEqual([30_000, 180_000]);
    expect(buildWorkMs(FIELD)).toBe(60_000); // 2×2
    expect(buildWorkMs('coop')).toBe(135_000); // 3×3
    expect(buildWorkMs('pasture')).toBe(180_000); // 4×4, capped
    expect([PLOUGH_WORK_MS, PLANT_WORK_MS, HARVEST_WORK_MS, FEED_WORK_MS]).toEqual([40_000, 30_000, 40_000, 20_000]);
  });
});

describe('withFarmer', () => {
  const [near, far] = STARTING_FIELDS;

  it('runs the action and sends a farmer along the path to the site', () => {
    const game = new Game();
    const ctx = fakeCtx(game);
    const action = vi.fn(() => true);
    expect(withFarmer(ctx, 'plant', { type: FIELD, ...near }, PLANT_WORK_MS, action)).toBe(true);
    expect(action).toHaveBeenCalledOnce();
    const [job] = workersOf(game.state).jobs;
    const route = findRoute(game.state, { ...near, w: 2, h: 2 })!;
    expect(job).toMatchObject({ kind: 'plant', farmer: 0, route: route.tiles, ...route.work });
    expect(job.walkMs).toBe(walkMs(route));
    expect(job.timer.duration).toBe(PLANT_WORK_MS + 2 * walkMs(route));
    expect(ctx.toast).not.toHaveBeenCalled();
  });

  it('refuses with a toast, without running the action, when every farmer is busy', () => {
    const game = new Game();
    const ctx = fakeCtx(game);
    withFarmer(ctx, 'plant', { type: FIELD, ...near }, PLANT_WORK_MS, () => true);
    const action = vi.fn(() => true);
    expect(withFarmer(ctx, 'harvest', { type: FIELD, ...far }, PLANT_WORK_MS, action)).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(ctx.toast).toHaveBeenCalledWith(expect.stringContaining('All farmers are busy'), 'error');
  });

  it('refuses with a toast, without running the action, when no path leads to the site', () => {
    const game = new Game();
    const ctx = fakeCtx(game);
    const action = vi.fn(() => true);
    const loose = { type: FIELD, x: START_LAND.x, y: START_LAND.y + 5 };
    expect(withFarmer(ctx, 'plant', loose, PLANT_WORK_MS, action)).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(ctx.toast).toHaveBeenCalledWith(NO_ROAD_MESSAGE, 'error');
    expect(freeFarmers(game.state)).toBe(1);
  });

  it('work that needs no farmer needs no path either', () => {
    const game = new Game();
    const action = vi.fn(() => true);
    expect(withFarmer(fakeCtx(game), 'build', { type: 'path', x: START_LAND.x, y: START_LAND.y + 6 }, 0, action)).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it('keeps the farmer free when the action fails', () => {
    const game = new Game();
    const ctx = fakeCtx(game);
    expect(withFarmer(ctx, 'plant', { type: FIELD, ...near }, PLANT_WORK_MS, () => false)).toBe(false);
    expect(freeFarmers(game.state)).toBe(1);
  });

  it('each farmer at work keeps their own number; a freed number is reused', () => {
    const game = new Game();
    hireFarmer(game);
    const ctx = fakeCtx(game);
    withFarmer(ctx, 'plant', { type: FIELD, ...near }, 1000, () => true);
    withFarmer(ctx, 'plant', { type: FIELD, ...far }, 60_000, () => true);
    expect(workersOf(game.state).jobs.map((j) => j.farmer)).toEqual([0, 1]);
    run(game, workersOf(game.state).jobs[0].timer.duration);
    withFarmer(ctx, 'harvest', { type: FIELD, ...near }, 1000, () => true);
    expect(activeJobs(game.state.clock, workersOf(game.state)).map((j) => j.farmer)).toEqual([1, 0]);
  });
});

describe('job phases', () => {
  it('walks out, works, then walks back home', () => {
    const game = new Game();
    assignJob(game, 'plant', 1, 1, 4000, { tiles: [{ x: 0, y: 0 }], work: { x: 0.5, y: 1.5 } });
    const job = workersOf(game.state).jobs[0];
    expect(job.walkMs).toBe(2 * WALK_MS_PER_TILE); // bench → door, door → work spot
    const phase = () => jobPhase(game.state.clock, job);
    expect(phase()).toEqual({ phase: 'out', t: 0 });
    run(game, WALK_MS_PER_TILE);
    expect(phase()).toEqual({ phase: 'out', t: 0.5 });
    run(game, WALK_MS_PER_TILE);
    expect(phase()).toEqual({ phase: 'work', t: 0 });
    run(game, 2000);
    expect(phase()).toEqual({ phase: 'work', t: 0.5 });
    run(game, 2000);
    expect(phase()).toEqual({ phase: 'back', t: 0 });
    run(game, 2 * WALK_MS_PER_TILE - 100);
    expect(freeFarmers(game.state)).toBe(0);
    run(game, 100);
    expect(freeFarmers(game.state)).toBe(1);
  });

  it('a job without a route (an older save) is all work', () => {
    const game = new Game();
    assignJob(game, 'plant', 1, 1, 4000);
    expect(jobPhase(game.state.clock, workersOf(game.state).jobs[0])).toEqual({ phase: 'work', t: 0 });
  });
});
