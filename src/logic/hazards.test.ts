import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CROPS, FIELD } from '../data/crops';
import { COTTAGE } from '../data/families';
import { CROWS, DROUGHT, HARSH_WINTER, KENNEL, QUIET_DAYS, SCARECROW, WELL } from '../data/hazards';
import { SEASON_DAYS } from '../data/seasons';
import { buyAnimal, type PenState } from './animals';
import { DAY_MS, START_LAYOUT } from './constants';
import { harvest, harvestYield, plant, plough, type FieldState } from './crops';
import { familiesOf } from './families';
import { Game } from './game';
import {
  chickensOf,
  coverage,
  droughtRemaining,
  firewoodPerHome,
  harshWinterAt,
  hazardsOf,
  isProtected,
  reaches,
  roll,
  setHazardsEnabled,
  triggerHazard,
  type HazardNote,
} from './hazards';
import { setOwned } from './land';
import { catchUp } from './offline';
import { stateGoalValue } from './progression';
import { getGoal } from '../data/progression';
import { deserialize, serialize } from './save';
import { SEASON_MS } from './seasons';
import { maxLevelState } from './test-utils';
import type { PlacedObject } from './types';
import { addFarmer, assignFarmer, PLAN_BEST, setCropPlan } from './workers';

/**
 * The effect tests trigger hazards by hand (`triggerHazard`) with the schedule off, so no roll gets in the way; the
 * schedule and fairness tests turn it on.
 */
function withSchedule(): void {
  beforeAll(() => setHazardsEnabled(true));
  afterAll(() => setHazardsEnabled(false));
}

const YEAR_DAYS = SEASON_DAYS * 4;
/** A spot clear of the starting fields and farmhouse. */
const X = START_LAYOUT.x;
const Y = START_LAYOUT.y + 6;

/** A top-level farm owning the whole map, with plenty of money and the given hazard seed. */
function farm(seed = 1): Game {
  const state = maxLevelState();
  hazardsOf(state).seed = seed;
  const game = new Game(state);
  game.earn(100_000);
  const land = game.state.land;
  for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) setOwned(land, x, y, true);
  return game;
}

function place<S extends object>(game: Game, type: string, x: number, y: number): PlacedObject<S> {
  const r = game.place(type, x, y);
  if (!r.ok) throw new Error(`could not place ${type} at ${x},${y}: ${r.reason}`);
  return r.object as unknown as PlacedObject<S>;
}

/** A ploughed field at (x, y) with wheat sown now. */
function sownField(game: Game, x = X, y = Y): PlacedObject<FieldState> {
  const f = place<FieldState>(game, FIELD, x, y);
  expect(plough(game, f).ok).toBe(true);
  expect(plant(game, f, 'wheat').ok).toBe(true);
  return f;
}

function coop(game: Game, chickens: number, x = X + 8, y = Y): PlacedObject<PenState> {
  const c = place<PenState>(game, 'coop', x, y);
  for (let i = 0; i < chickens; i++) expect(buyAnimal(game, c, 'chicken').ok).toBe(true);
  return c;
}

/** Jumps the clock to the start of summer of year 0 (no hazards run on the way: they are planned at day boundaries). */
function toSummer(game: Game): void {
  game.advance(SEASON_MS - game.now);
}

describe('rolls and reach', () => {
  it('a roll depends only on the seed, the tag and the number', () => {
    expect(roll(7, 'crows', 12)).toBe(roll(7, 'crows', 12));
    expect(roll(7, 'crows', 12)).not.toBe(roll(8, 'crows', 12));
    expect(roll(7, 'crows', 12)).not.toBe(roll(7, 'fox', 12));
    for (let i = 0; i < 200; i++) {
      const r = roll(i * 7919, 'winter', i);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });

  it('about one winter and one summer in three is harsh or dry', () => {
    let winters = 0;
    let droughts = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) {
      if (roll(12345, 'winter', i) < HARSH_WINTER.chance) winters++;
      if (roll(12345, 'drought', i) < DROUGHT.chance) droughts++;
    }
    expect(winters / n).toBeGreaterThan(0.28);
    expect(winters / n).toBeLessThan(0.39);
    expect(droughts / n).toBeGreaterThan(0.28);
    expect(droughts / n).toBeLessThan(0.39);
  });

  it('reach is measured edge to edge, in tiles', () => {
    const well = { x: 0, y: 0, w: 1, h: 1 };
    expect(reaches(well, 4, { x: 5, y: 0, w: 2, h: 2 })).toBe(false);
    expect(reaches(well, 4, { x: 4, y: 0, w: 2, h: 2 })).toBe(true);
    expect(reaches(well, 4, { x: 3, y: 3, w: 2, h: 2 })).toBe(false); // 3² + 3² > 4²
    expect(reaches(well, 4, { x: -5, y: -1, w: 2, h: 2 })).toBe(true);
  });

  it('coverage lists the finished defences reaching a tile; a construction site guards nothing', () => {
    const game = farm();
    place(game, WELL, X, Y);
    expect(coverage(game.state, X + 4, Y)).toEqual([WELL]);
    expect(coverage(game.state, X + 5, Y)).toEqual([]);
    game.place(SCARECROW, X + 1, Y, { site: true });
    expect(coverage(game.state, X + 2, Y)).toEqual([WELL]);
  });
});

describe('drought', () => {
  it('grows a crop at half speed until it ends, then at full speed', () => {
    expect(droughtRemaining(100, 0, 1000)).toBe(100 / DROUGHT.growth);
    // 100 ms of slow growth does 50 ms of work; the other 50 go at full speed after it.
    expect(droughtRemaining(100, 0, 100)).toBe(100 + (100 - 100 * DROUGHT.growth));
    expect(droughtRemaining(100, 500, 400)).toBe(100);
  });

  it('slows a growing field without a well and cuts its harvest by 30%; a field with a well grows as usual', () => {
    const game = farm();
    toSummer(game);
    const dry = sownField(game);
    const watered = sownField(game, X + 10, Y);
    place(game, WELL, X + 13, Y);
    expect(isProtected(game.state, watered, 'drought')).toBe(true);
    expect(isProtected(game.state, dry, 'drought')).toBe(false);
    const full = harvestYield({ elapsed: dry.state.timer!.start + dry.state.timer!.duration, speed: 1 }, dry);
    const ends = { dry: dry.state.timer!.start + dry.state.timer!.duration, watered: watered.state.timer!.start + watered.state.timer!.duration };

    game.advance(CROPS.wheat.growMs / 2);
    expect(triggerHazard(game, 'drought').ok).toBe(true);
    expect(hazardsOf(game.state).current.map((e) => e.kind)).toEqual(['drought']);
    // Half grown: the other half takes twice as long.
    expect(dry.state.timer!.start + dry.state.timer!.duration).toBe(ends.dry + CROPS.wheat.growMs / 2);
    expect(watered.state.timer!.start + watered.state.timer!.duration).toBe(ends.watered);
    expect(dry.state.parched).toBe(true);
    expect(watered.state.parched).toBeUndefined();

    game.advance(CROPS.wheat.growMs);
    expect(harvestYield(game.state.clock, watered)).toBe(full);
    expect(harvestYield(game.state.clock, dry)).toBe(Math.round(full * DROUGHT.yield));
    const before = game.count('wheat');
    expect(harvest(game, dry).ok).toBe(true);
    expect(game.count('wheat') - before).toBe(Math.round(full * DROUGHT.yield));
    expect(dry.state.parched).toBeUndefined();
  });

  it('a crop sown during a drought grows slower without a well', () => {
    const game = farm();
    toSummer(game);
    expect(triggerHazard(game, 'drought').ok).toBe(true);
    const dry = sownField(game);
    const watered = sownField(game, X + 10, Y);
    place(game, WELL, X + 13, Y); // built after sowing: too late for that crop's timer, but it is noted as unprotected
    expect(dry.state.timer!.duration).toBe(CROPS.wheat.growMs / DROUGHT.growth);
    expect(dry.state.parched).toBe(true);
    void watered;
    const later = sownField(game, X + 10, Y + 3);
    expect(later.state.timer!.duration).toBe(CROPS.wheat.growMs);
    expect(later.state.parched).toBeUndefined();
  });

  it('ends with the season: the field grows at full speed again', () => {
    const game = farm();
    toSummer(game);
    triggerHazard(game, 'drought');
    game.advance(SEASON_MS);
    expect(hazardsOf(game.state).current).toEqual([]);
    const f = sownField(game);
    expect(f.state.timer!.duration).toBe(CROPS.wheat.growMs);
    expect(hazardsOf(game.state).log[0].outcome).toBe('ended');
  });
});

describe('crows', () => {
  it('eat 30% of an unprotected growing field\'s harvest, and stay a while', () => {
    const game = farm();
    const f = sownField(game);
    const full = harvestYield({ elapsed: f.state.timer!.start + f.state.timer!.duration, speed: 1 }, f);
    expect(triggerHazard(game, 'crows').ok).toBe(true);
    expect(f.state.pecked).toBe(true);
    const s = hazardsOf(game.state);
    expect(s.current).toEqual([{ kind: 'crows', start: game.now, end: game.now + CROWS.eatMs, target: f.id }]);
    expect(s.log[0]).toMatchObject({ kind: 'crows', outcome: 'loss', target: f.id });
    game.advance(CROWS.eatMs);
    expect(s.current).toEqual([]);
    game.advance(CROPS.wheat.growMs);
    expect(harvestYield(game.state.clock, f)).toBe(Math.round(full * (1 - CROWS.take)));
    // The same field is not picked twice for one crop.
    expect(triggerHazard(game, 'crows').ok).toBe(false);
  });

  it('a scarecrow within 3 tiles keeps them off', () => {
    const game = farm();
    const f = sownField(game);
    place(game, SCARECROW, X + 4, Y);
    expect(triggerHazard(game, 'crows').ok).toBe(true);
    expect(f.state.pecked).toBeUndefined();
    expect(hazardsOf(game.state).current).toEqual([]);
    expect(hazardsOf(game.state).log[0]).toMatchObject({ kind: 'crows', outcome: 'defended', target: f.id });
  });

  it('a drought and crows together leave 49% of the harvest', () => {
    const game = farm();
    toSummer(game);
    const f = sownField(game);
    const full = harvestYield({ elapsed: f.state.timer!.start + f.state.timer!.duration, speed: 1 }, f);
    triggerHazard(game, 'drought');
    triggerHazard(game, 'crows');
    game.advance(2 * CROPS.wheat.growMs);
    expect(harvestYield(game.state.clock, f)).toBe(Math.round(full * DROUGHT.yield * (1 - CROWS.take)));
  });
});

describe('fox', () => {
  it('takes one chicken from an unprotected coop', () => {
    const game = farm();
    const c = coop(game, 3);
    expect(triggerHazard(game, 'fox').ok).toBe(true);
    expect(c.state.animals).toHaveLength(2);
    expect(hazardsOf(game.state).log[0]).toMatchObject({ kind: 'fox', outcome: 'loss', target: c.id, lost: { chicken: 1 } });
  });

  it('a kennel within 6 tiles keeps it away', () => {
    const game = farm();
    const c = coop(game, 3);
    place(game, KENNEL, X + 8 + 2 + 6, Y);
    expect(isProtected(game.state, c, 'fox')).toBe(true);
    expect(triggerHazard(game, 'fox').ok).toBe(true);
    expect(c.state.animals).toHaveLength(3);
    expect(hazardsOf(game.state).log[0]).toMatchObject({ kind: 'fox', outcome: 'defended' });
    expect(stateGoalValue(game.state, getGoal('guard-coop')!)).toBe(1);
  });

  it('never takes the farm\'s last chicken', () => {
    const game = farm();
    const c = coop(game, 1);
    expect(triggerHazard(game, 'fox').ok).toBe(false);
    expect(c.state.animals).toHaveLength(1);
    // Two coops with one chicken each: one may go, never both.
    coop(game, 1, X + 14, Y);
    expect(triggerHazard(game, 'fox').ok).toBe(true);
    expect(triggerHazard(game, 'fox').ok).toBe(false);
    expect(chickensOf(game.state)).toBe(1);
  });
});

describe('harsh winter', () => {
  it('doubles the firewood each home burns, and the approval rules count the cold homes', () => {
    const game = farm();
    place(game, COTTAGE, X, Y);
    place(game, 'granary', X + 4, Y);
    addFarmer(game);
    game.addItem('wheat', 80);
    // Autumn: announce the coming winter as harsh.
    game.advance(2 * SEASON_MS - game.now);
    expect(triggerHazard(game, 'harsh-winter').ok).toBe(true);
    const warning = hazardsOf(game.state).log[0];
    expect(warning.outcome).toBe('warning');
    // Two homes × 2 wood × 4 days.
    expect(warning.text).toContain('Stock 16 🪵 wood');
    const winter = 3 * SEASON_MS;
    expect(harshWinterAt(game.state, winter)).toBe(true);
    expect(firewoodPerHome(game.state, winter)).toBe(HARSH_WINTER.firewoodFactor);
    expect(firewoodPerHome(game.state, winter + SEASON_MS)).toBe(1);

    // Enough for a normal winter day (2 homes), not a harsh one.
    game.removeItem('wood', game.count('wood') - 3);
    game.advance(winter - game.now);
    const day = familiesOf(game.state).lastDay!;
    expect(day.firewoodNeeded).toBe(4);
    expect(day.firewood).toBe(3);
    expect(familiesOf(game.state).breakdown.find((p) => p.id === 'firewood')!.points).toBeLessThan(0);
    expect(hazardsOf(game.state).current.map((e) => e.kind)).toEqual(['harsh-winter']);
  });

  it('with the wood stocked every home stays warm', () => {
    const game = farm();
    game.advance(2 * SEASON_MS - game.now);
    triggerHazard(game, 'harsh-winter');
    game.addItem('wheat', 50);
    game.addItem('wood', 20);
    game.advance(3 * SEASON_MS - game.now);
    expect(familiesOf(game.state).lastDay!.firewood).toBe(2);
    expect(familiesOf(game.state).breakdown.find((p) => p.id === 'firewood')!.points).toBeGreaterThan(0);
  });
});

/** A working farm: two farmers on the two starting fields, a coop with chickens, a cottage. */
function workingFarm(seed: number): Game {
  const game = farm(seed);
  addFarmer(game);
  const fields = game.objectsOfType(FIELD);
  fields.forEach((f, i) => {
    setCropPlan(game, f.id, PLAN_BEST);
    assignFarmer(game, f.id, i);
  });
  place(game, COTTAGE, X, Y);
  coop(game, 5, X + 4, Y);
  game.addItem('wheat', 40);
  return game;
}

/** What the hazards did and left behind: the log and the farm's objects. */
function outcome(game: Game): string {
  const s = hazardsOf(game.state);
  return JSON.stringify({ log: s.log, current: s.current, upcoming: s.upcoming, objects: game.state.objects, money: game.money });
}

/** A seed whose first two years have a harsh winter (year 0) and a drought (year 1). */
function eventfulSeed(): number {
  for (let seed = 1; ; seed++) if (roll(seed, 'winter', 0) < HARSH_WINTER.chance && roll(seed, 'drought', 1) < DROUGHT.chance) return seed;
}

describe('the schedule', () => {
  withSchedule();
  const SPAN = 2 * YEAR_DAYS * DAY_MS;

  it('is the same at ×1, ×60, after a reload and in offline catch-up', () => {
    const seed = eventfulSeed();
    const live = workingFarm(seed);
    for (let t = 0; t < SPAN; t += 1000) live.advance(1000);

    const fast = workingFarm(seed);
    for (let t = 0; t < SPAN; t += 60_000) fast.advance(60_000);

    let reloaded = workingFarm(seed);
    reloaded.advance(SPAN / 2 + 12_345);
    reloaded = new Game(deserialize(serialize(reloaded.state)));
    reloaded.advance(SPAN - reloaded.now);

    const away = workingFarm(seed);
    const result = catchUp(away, SPAN);

    const kinds = new Set(hazardsOf(live.state).log.map((n) => n.kind));
    expect([...kinds].sort()).toEqual(['crows', 'drought', 'fox', 'harsh-winter']);
    expect(outcome(fast)).toBe(outcome(live));
    expect(outcome(reloaded)).toBe(outcome(live));
    expect(outcome(away)).toBe(outcome(live));
    // The welcome-back summary gets every note, oldest first.
    expect(result.hazards).toEqual([...hazardsOf(live.state).log].reverse().slice(-result.hazards.length));
  });

  it('a different seed gives a different farm', () => {
    const a = workingFarm(eventfulSeed());
    const b = workingFarm(eventfulSeed() + 1);
    a.advance(SPAN);
    b.advance(SPAN);
    expect(hazardsOf(a.state).log).not.toEqual(hazardsOf(b.state).log);
  });
});

describe('fairness', () => {
  withSchedule();
  let runs: { game: Game; notes: HazardNote[] }[] = [];
  beforeAll(() => {
    runs = Array.from({ length: 12 }, (_, i) => {
      const game = workingFarm(1000 + i * 7);
      const notes: HazardNote[] = [];
      game.activity.on('hazard', (n) => notes.push(n));
      game.advance(3 * YEAR_DAYS * DAY_MS);
      return { game, notes };
    });
  });

  it('nothing happens in a new farm\'s first season', () => {
    for (const { notes } of runs) expect(notes.filter((n) => n.at < QUIET_DAYS * DAY_MS)).toEqual([]);
    expect(runs.some(({ notes }) => notes.length > 0)).toBe(true);
  });

  it('at most one new event a day', () => {
    for (const { notes } of runs) {
      const perDay = new Map<number, number>();
      for (const n of notes) {
        if (n.outcome === 'warning' || n.outcome === 'ended') continue;
        const day = Math.floor(n.at / DAY_MS);
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
      }
      expect(Math.max(0, ...perDay.values())).toBeLessThanOrEqual(1);
    }
  });

  it('a fox never takes the last chicken, and losses never take money', () => {
    for (const { game, notes } of runs) {
      expect(chickensOf(game.state)).toBeGreaterThanOrEqual(1);
      expect(notes.every((n) => !n.lost || !('money' in n.lost))).toBe(true);
    }
    // A fox visit and crows landing leave the money as it was.
    const game = farm();
    sownField(game);
    coop(game, 3);
    const money = game.money;
    triggerHazard(game, 'crows');
    triggerHazard(game, 'fox');
    expect(game.money).toBe(money);
  });

  it('crows and foxes keep coming at their rates', () => {
    const all = runs.flatMap((r) => r.notes);
    const years = runs.length * 3;
    const crows = all.filter((n) => n.kind === 'crows' && n.outcome !== 'warning').length / years;
    const foxes = all.filter((n) => n.kind === 'fox').length / years;
    expect(crows).toBeGreaterThan(1);
    expect(foxes).toBeGreaterThan(1);
  });
});

describe('hazards off', () => {
  withSchedule();
  it('plan nothing', () => {
    setHazardsEnabled(false);
    try {
      const game = workingFarm(eventfulSeed());
      game.advance(2 * YEAR_DAYS * DAY_MS);
      expect(hazardsOf(game.state).log).toEqual([]);
    } finally {
      setHazardsEnabled(true);
    }
  });
});
