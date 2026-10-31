import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANIMALS } from '../data/animals';
import { CROPS, FIELD } from '../data/crops';
import { MAX_OFFLINE_MS, SUMMARY_MIN_AWAY_MS } from '../data/offline';
import { PROCESSORS, QUEUE_LIMIT } from '../data/processing';
import { animalStatus, buyAnimal, feedAll, type PenState } from './animals';
import { DAY_MS } from './constants';
import { cropStage, plant, plough, type FieldState } from './crops';
import { Game } from './game';
import { setOwned } from './land';
import { catchUp, catchUpGame, formatAway, shouldShowSummary } from './offline';
import { settle, startJob, type ProcessorState } from './processing';
import { parseSave, serialize } from './save';
import { maxLevelState } from './test-utils';
import type { PlacedObject } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;

function farm(): Game {
  const game = new Game(maxLevelState());
  game.earn(1_000_000);
  const land = game.state.land;
  for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) setOwned(land, x, y, true);
  return game;
}

function place<S extends object>(game: Game, type: string, x: number, y: number): PlacedObject<S> {
  const r = game.place(type, x, y);
  if (!r.ok) throw new Error(`could not place ${type}: ${r.reason}`);
  return r.object as unknown as PlacedObject<S>;
}

function fields(game: Game): PlacedObject<FieldState>[] {
  return game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
}

describe('offline catch-up', () => {
  // A new farm seeds its orders from Math.random; pin it so two farms built alike are equal.
  beforeEach(() => void vi.spyOn(Math, 'random').mockReturnValue(0.5));
  afterEach(() => vi.restoreAllMocks());

  it('ripens crops that would have finished, and leaves the rest growing', () => {
    const game = new Game(maxLevelState());
    const [a, b] = fields(game);
    plant(game, a, 'wheat');
    plant(game, b, 'corn');

    const r = catchUp(game, CROPS.wheat.growMs + 1000);

    expect(cropStage(game.state.clock, a.state)).toBe('ripe');
    expect(cropStage(game.state.clock, b.state)).not.toBe('ripe');
    expect(r.cropsReady).toEqual({ wheat: 1 });
    expect(r.changed).toEqual([a.id]);

    // Long after, the crops are still there and ripe (no wilting).
    const r2 = catchUp(game, 3 * 24 * HOUR);
    expect(cropStage(game.state.clock, a.state)).toBe('ripe');
    expect(a.state.crop).toBe('wheat');
    expect(r2.cropsReady).toEqual({ corn: 1 }); // wheat was already ripe, so it is not counted again
  });

  it('fed animals finish their cycle; animals left hungry for lack of feed produce nothing', () => {
    const game = farm();
    const coop = place<PenState>(game, 'coop', 0, 0);
    for (let i = 0; i < 3; i++) buyAnimal(game, coop, 'chicken');
    game.addItem('feed', 2); // enough for two of the three
    expect(feedAll(game, coop)).toBe(2);
    expect(game.count('feed')).toBe(0);

    const r = catchUp(game, 2 * HOUR);

    expect(r.produced).toEqual({ egg: 2 });
    expect(coop.state.animals.map((a) => animalStatus(game.state.clock, a))).toEqual(['ready', 'ready', 'hungry']);
    expect(game.count('feed')).toBe(0); // feed never goes negative and nothing is fed while away
  });

  it('counts an animal cycle only when it ends while away', () => {
    const game = farm();
    const pasture = place<PenState>(game, 'pasture', 0, 0);
    buyAnimal(game, pasture, 'cow');
    buyAnimal(game, pasture, 'sheep');
    game.addItem('feed', 3);
    feedAll(game, pasture);

    // The cow (90 s) finishes, the sheep (120 s) does not.
    const r = catchUp(game, ANIMALS.cow.cycleMs);
    expect(r.produced).toEqual({ milk: 1 });
    expect(catchUp(game, ANIMALS.sheep.cycleMs).produced).toEqual({ wool: 1 });
  });

  it('finishes queued jobs in order, each starting when the previous one ended', () => {
    const game = farm();
    const dairy = place<ProcessorState>(game, 'dairy', 0, 0);
    game.addItem('milk', 5);
    startJob(game, dairy, 'cheese'); // 90 s
    startJob(game, dairy, 'butter'); // 45 s
    startJob(game, dairy, 'cheese'); // 90 s
    expect(dairy.state.queue).toHaveLength(QUEUE_LIMIT);

    const r = catchUp(game, 90_000 + 45_000 + 10_000);

    expect(r.jobsFinished).toBe(2);
    expect(r.produced).toEqual({ cheese: 1, butter: 1 });
    expect(dairy.state.ready).toEqual({ cheese: 1, butter: 1 });
    // The last cheese started exactly when the butter finished, so 10 s of it are done.
    expect(dairy.state.queue).toEqual([{ recipe: 'cheese', timer: { start: 135_000, duration: 90_000 } }]);
    expect(game.count('milk')).toBe(0); // inputs were taken when queued, as in play
  });

  it('gives the same farm as playing through the same time frame by frame', () => {
    const build = () => {
      const game = farm();
      const dairy = place<ProcessorState>(game, 'dairy', 0, 0);
      game.addItem('milk', 5);
      startJob(game, dairy, 'cheese');
      startJob(game, dairy, 'butter');
      startJob(game, dairy, 'cheese');
      plant(game, fields(game)[0], 'carrot');
      return { game, dairy };
    };
    const away = 200_000;
    const played = build();
    for (let t = 0; t < away; t += 250) {
      played.game.tick(250);
      settle(played.game.state.clock, played.dairy);
    }
    const caught = build();
    catchUp(caught.game, away);
    expect(caught.game.state).toEqual(played.game.state);
  });

  it('moves the market to the right day', () => {
    const game = new Game(maxLevelState());
    const r = catchUp(game, 2 * DAY_MS + 1);
    expect(r.dayBefore).toBe(1);
    expect(r.dayAfter).toBe(3);
    expect(game.day).toBe(3);
  });

  it('caps the catch-up at 7 days and says so', () => {
    const game = new Game(maxLevelState());
    const r = catchUp(game, MAX_OFFLINE_MS + 5 * HOUR);
    expect(r.appliedMs).toBe(MAX_OFFLINE_MS);
    expect(r.capped).toBe(true);
    expect(game.now).toBe(MAX_OFFLINE_MS);
    expect(catchUp(game, MAX_OFFLINE_MS).capped).toBe(false);
  });

  it('applies nothing when the device clock went backwards (or the time is garbage)', () => {
    const game = new Game(maxLevelState());
    plant(game, fields(game)[0], 'wheat');
    const before = structuredClone(game.state);
    for (const away of [-HOUR, 0, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const r = catchUp(game, away);
      expect(r.appliedMs).toBe(0);
      expect(shouldShowSummary(r)).toBe(false);
    }
    expect(game.state).toEqual(before);
  });

  it('always runs at ×1, whatever the debug speed is', () => {
    const game = new Game(maxLevelState());
    game.setSpeed(60);
    catchUp(game, 10 * MIN);
    expect(game.now).toBe(10 * MIN);
    expect(game.speed).toBe(60);
  });

  it('runs 7 days on a busy farm well under a second', () => {
    const game = farm();
    game.addItem('feed', 1000);
    game.addItem('milk', 1000);
    game.addItem('wheat', 1000);
    game.addItem('egg', 1000);
    game.addItem('wool', 1000);
    for (const f of fields(game)) plant(game, f, 'corn');
    for (let i = 0; i < 6; i++) {
      const coop = place<PenState>(game, 'coop', i * 3, 0);
      for (let n = 0; n < 6; n++) buyAnimal(game, coop, 'chicken');
      feedAll(game, coop);
      const pasture = place<PenState>(game, 'pasture', i * 4, 4);
      for (let n = 0; n < 4; n++) buyAnimal(game, pasture, n % 2 ? 'cow' : 'sheep');
      feedAll(game, pasture);
      const field = place<FieldState>(game, FIELD, i * 2, 8);
      plough(game, field);
      plant(game, field, 'wheat');
    }
    const recipes = { 'feed-mill': 'feed-from-wheat', dairy: 'cheese', bakery: 'bread', loom: 'cloth' } as const;
    let x = 0;
    for (const type of Object.keys(PROCESSORS) as (keyof typeof recipes)[]) {
      for (let i = 0; i < 3; i++) {
        const p = place<ProcessorState>(game, type, x, 12);
        x += PROCESSORS[type].footprint.w;
        for (let j = 0; j < QUEUE_LIMIT; j++) startJob(game, p, recipes[type]);
      }
    }

    const t0 = performance.now();
    const r = catchUp(game, 30 * 24 * HOUR);
    const ms = performance.now() - t0;

    expect(ms).toBeLessThan(200);
    expect(r.capped).toBe(true);
    expect(r.cropsReady).toEqual({ corn: 2, wheat: 6 });
    expect(r.produced.egg).toBe(36);
    expect(r.produced.milk).toBe(12);
    expect(r.produced.wool).toBe(12);
    expect(r.jobsFinished).toBe(12 * QUEUE_LIMIT);
  });

  it('a save whose time was moved back gives the same result as simulating that time away', () => {
    const build = () => {
      const game = new Game(maxLevelState());
      plant(game, fields(game)[0], 'wheat');
      return game;
    };
    const now = 1_800_000_000_000;
    const loaded = parseSave(serialize(build().state, now - 2 * HOUR));
    const real = catchUp(loaded.state, now - loaded.savedAt!);

    const simulated = build();
    const sim = catchUp(simulated.state, 2 * HOUR);

    expect(real).toEqual(sim);
    expect(loaded.state).toEqual(simulated.state);
  });

  it('on a live game, announces the new day and the changed objects', () => {
    const game = new Game(maxLevelState());
    const field = fields(game)[0];
    plant(game, field, 'wheat');
    const days: number[] = [];
    const touched: string[] = [];
    game.events.on('day', (d) => days.push(d));
    game.events.on('objectChanged', (o) => touched.push(o.id));

    catchUpGame(game, DAY_MS);

    expect(days).toEqual([2]);
    expect(touched).toEqual([field.id]);
  });
});

describe('welcome-back summary', () => {
  it('is shown only after more than a minute away', () => {
    const game = new Game(maxLevelState());
    expect(shouldShowSummary(catchUp(game, SUMMARY_MIN_AWAY_MS - 1))).toBe(false);
    expect(shouldShowSummary(catchUp(game, SUMMARY_MIN_AWAY_MS))).toBe(false);
    expect(shouldShowSummary(catchUp(game, SUMMARY_MIN_AWAY_MS + 1))).toBe(true);
  });

  it('formats the time away', () => {
    expect(formatAway(40_000)).toBe('40 s');
    expect(formatAway(12 * MIN + 5000)).toBe('12 min');
    expect(formatAway(2 * HOUR)).toBe('2 h');
    expect(formatAway(2 * HOUR + 5 * MIN)).toBe('2 h 5 min');
    expect(formatAway(MAX_OFFLINE_MS)).toBe('7 d');
    expect(formatAway(3 * 24 * HOUR + 4 * HOUR)).toBe('3 d 4 h');
  });
});
