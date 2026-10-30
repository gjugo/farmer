import { describe, expect, it, vi } from 'vitest';
import { FIELD } from '../data/crops';
import { BASE_HIRE_COST, buildWorkMs, BUILD_WORK_MAX_MS, BUILD_WORK_MIN_MS, MAX_FARMERS, PLANT_WORK_MS } from '../data/workers';
import type { FarmContext } from '../game/context';
import { withFarmer } from '../game/workers';
import { Game } from './game';
import { deserialize, serialize } from './save';
import { activeJobs, assignJob, busyFarmers, freeFarmers, hireCost, hireFarmer, nextFreeIn, workersOf } from './workers';

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
});

describe('withFarmer', () => {
  it('runs the action and puts a farmer to work at the centre of the site', () => {
    const game = new Game();
    const ctx = fakeCtx(game);
    const action = vi.fn(() => true);
    expect(withFarmer(ctx, 'plant', { type: FIELD, x: 4, y: 6 }, PLANT_WORK_MS, action)).toBe(true);
    expect(action).toHaveBeenCalledOnce();
    expect(workersOf(game.state).jobs).toMatchObject([{ kind: 'plant', x: 5, y: 7 }]);
    expect(ctx.toast).not.toHaveBeenCalled();
  });

  it('refuses with a toast, without running the action, when every farmer is busy', () => {
    const game = new Game();
    const ctx = fakeCtx(game);
    withFarmer(ctx, 'plant', { type: FIELD, x: 4, y: 6 }, PLANT_WORK_MS, () => true);
    const action = vi.fn(() => true);
    expect(withFarmer(ctx, 'harvest', { type: FIELD, x: 8, y: 6 }, PLANT_WORK_MS, action)).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(ctx.toast).toHaveBeenCalledWith(expect.stringContaining('All farmers are busy'), 'error');
  });

  it('keeps the farmer free when the action fails', () => {
    const game = new Game();
    const ctx = fakeCtx(game);
    expect(withFarmer(ctx, 'plant', { type: FIELD, x: 4, y: 6 }, PLANT_WORK_MS, () => false)).toBe(false);
    expect(freeFarmers(game.state)).toBe(1);
  });
});
