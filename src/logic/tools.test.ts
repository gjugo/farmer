import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBuildable } from '../data/buildables';
import { FIELD } from '../data/crops';
import { PROCESSORS } from '../data/processing';
import { RESOURCES } from '../data/resourceBuildings';
import { TOOL_SPEED, TOOL_USES } from '../data/tools';
import { PLOUGH_WORK_MS } from '../data/workers';
import { buyAnimal, type PenState } from './animals';
import { DAY_MS, START_LAYOUT } from './constants';
import type { FieldState } from './crops';
import { Game } from './game';
import { setOwned } from './land';
import { addDeposit, mapOf } from './maplayer';
import { catchUp } from './offline';
import { buildTime } from './perks';
import type { ProcessorState } from './processing';
import type { ResourceState } from './resources';
import { connectToFarmhouse } from './roads';
import { deserialize, parseSave, serialize } from './save';
import { maxLevelState } from './test-utils';
import { onToolsWornOut, toolFactor, toolOf, toolsSummary, useTool } from './tools';
import type { PlacedObject } from './types';
import { runWork, workplaceNext } from './work';
import { addFarmer, assignFarmer, assignJob, jobsByFarmer, setKeepMaking, workersOf, type Job } from './workers';

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

/** Places a finished building (or a site) with a path from the farmhouse to it. */
function build<S extends object>(game: Game, type: string, x: number, y: number, { site = false } = {}): PlacedObject<S> {
  const r = game.place(type, x, y, { site });
  if (!r.ok) throw new Error(`could not place ${type}: ${r.reason}`);
  if (!connectToFarmhouse(game.state, { x, y, ...getBuildable(type)!.footprint })) throw new Error(`no road to ${type}`);
  return r.object as unknown as PlacedObject<S>;
}

/** Puts `n` tools in store (the test farm's storehouse is full of building materials, so straight into the inventory). */
function stock(game: Game, n: number): void {
  game.state.inventory.tools = (game.state.inventory.tools ?? 0) + n;
}

/** Room and food so no family leaves on a long run: `n` top-level granaries far from the farmhouse, stocked. */
function provisions(game: Game, n = 2): void {
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
  for (const food of ['wheat', 'carrot', 'potato', 'cabbage', 'bread', 'cheese']) game.state.inventory[food] = 60;
}

/** Farmer `i`'s running job. */
function jobOf(game: Game, i = 0): Job | undefined {
  return jobsByFarmer(game.state.clock, workersOf(game.state))[i];
}

/** Game ms of a job's work: its timer less the walk there and back. */
function workOf(job: Job): number {
  return job.timer.duration - 2 * (job.walkMs ?? 0);
}

/** A farm with a fresh (unploughed) field assigned to farmer 0, and `tools` tools in store. */
function ploughing(tools: number): Game {
  const game = farm();
  const field = build<FieldState>(game, FIELD, X + 1, Y + 5);
  if (tools > 0) stock(game, tools);
  assignFarmer(game, field.id);
  game.advance(1);
  return game;
}

/** A farm with a staffed mine on a deep vein, and `tools` tools in store. */
function mining(tools: number): { game: Game; mine: PlacedObject<ResourceState> } {
  const game = farm();
  game.state.inventory = {};
  addDeposit(mapOf(game.state), 'iron', { x: X + 1, y: Y + 5, ...RESOURCES.mine.footprint }, 100_000);
  game.state.inventory = { ...RESOURCES.mine.materials };
  const mine = build<ResourceState>(game, 'mine', X + 1, Y + 5);
  if (tools > 0) stock(game, tools);
  assignFarmer(game, mine.id);
  game.advance(1);
  return { game, mine };
}

describe('tools', () => {
  beforeEach(() => void vi.spyOn(Math, 'random').mockReturnValue(0.5));
  afterEach(() => vi.restoreAllMocks());

  it('a new farm has an empty tool slot for every farmer, and more as families move in', () => {
    const game = farm();
    expect(workersOf(game.state).tools).toEqual([null]);
    addFarmer(game);
    expect(workersOf(game.state).tools).toEqual([null, null]);
    expect(toolsSummary(game.state)).toEqual({ inStore: 0, equipped: 0, farmers: 2 });
  });

  it('without tools in store, a ploughing takes exactly as long as before tools', () => {
    const game = ploughing(0);
    const job = jobOf(game)!;
    expect(job.kind).toBe('plough');
    expect(workOf(job)).toBe(PLOUGH_WORK_MS);
    expect(toolOf(game.state, 0)).toBeNull();
  });

  it('a farmer setting off takes tools from the store and ploughs 25% faster', () => {
    const game = ploughing(2);
    const job = jobOf(game)!;
    expect(job.kind).toBe('plough');
    expect(workOf(job)).toBe(PLOUGH_WORK_MS / TOOL_SPEED);
    // One taken from the store, one job of it used.
    expect(game.count('tools')).toBe(1);
    expect(toolOf(game.state, 0)).toBe(TOOL_USES - 1);
    expect(toolsSummary(game.state)).toEqual({ inStore: 1, equipped: 1, farmers: 1 });
  });

  it("a mine's cycle with tools ends with the farmer's shorter work: the iron arrives sooner", () => {
    const yieldAt = (tools: number) => {
      const { game, mine } = mining(tools);
      const job = jobOf(game)!;
      expect(job.kind).toBe('mine');
      const cycle = mine.state.cycle!;
      // The cycle is the farmer's work: from their arrival to the end of their work.
      expect(cycle.start).toBe(job.timer.start + job.walkMs!);
      expect(cycle.duration).toBe(workOf(job));
      let at = -1;
      game.activity.on('produced', () => (at = game.now));
      game.advance(cycle.start + cycle.duration - game.now);
      expect(mine.state.waiting).toBe(RESOURCES.mine.yield);
      return { at, duration: cycle.duration };
    };
    const plain = yieldAt(0);
    const tooled = yieldAt(1);
    expect(plain.duration).toBe(RESOURCES.mine.cycleMs);
    expect(tooled.duration).toBe(Math.round(RESOURCES.mine.cycleMs / TOOL_SPEED));
    expect(tooled.at).toBe(plain.at - (plain.duration - tooled.duration));
  });

  it('a building site with tools is finished 25% sooner, and its doneAt says so', () => {
    const finishAt = (tools: number) => {
      const game = farm();
      const site = build(game, 'blacksmith', X + 1, Y + 5, { site: true });
      if (tools > 0) stock(game, tools);
      game.advance(1);
      const job = jobOf(game)!;
      expect(job.kind).toBe('build');
      expect(job.doneAt).toBe(job.timer.start + job.walkMs! + workOf(job));
      let at = -1;
      game.activity.on('built', () => (at = game.now));
      game.advance(job.doneAt! - game.now);
      expect(site.site).toBeUndefined();
      return { at, work: workOf(job) };
    };
    const plain = finishAt(0);
    const tooled = finishAt(1);
    expect(plain.work).toBe(buildTime(maxLevelState(), 'blacksmith'));
    expect(tooled.work).toBe(Math.round(plain.work / TOOL_SPEED));
    expect(tooled.at).toBe(plain.at - (plain.work - tooled.work));
  });

  it('hauling, walking and processing batches are not sped up', () => {
    const game = farm();
    stock(game, 1);
    expect(toolFactor(game.state, 0, 'haul')).toBe(1);
    expect(toolFactor(game.state, 0, 'plough')).toBe(TOOL_SPEED);
    // A haul takes no tools from the store.
    expect(useTool(game, 0, 'haul')).toBe(1);
    expect(game.count('tools')).toBe(1);
  });

  it(`tools last ${TOOL_USES} jobs, break at the end of the last one, and the next job takes new ones`, () => {
    const game = farm();
    stock(game, 2);
    const broke: number[] = [];
    game.activity.on('toolBroke', ({ inStore }) => broke.push(inStore));
    const job = () => {
      expect(assignJob(game, 'plant', X, Y, 1000)).toBe(true);
      return jobOf(game)!;
    };
    for (let i = 1; i <= TOOL_USES; i++) {
      const j = job();
      expect(workOf(j)).toBe(1000 / TOOL_SPEED);
      expect(toolOf(game.state, 0)).toBe(TOOL_USES - i);
      if (i < TOOL_USES) game.advance(j.timer.duration);
    }
    // Worn out, but they finish the job with them.
    expect(toolOf(game.state, 0)).toBe(0);
    expect(game.count('tools')).toBe(1);
    game.advance(jobOf(game)!.timer.duration - 1);
    expect(toolOf(game.state, 0)).toBe(0);
    game.advance(1);
    expect(toolOf(game.state, 0)).toBeNull();
    expect(broke).toEqual([1]);
    // The next job takes the last tools in store.
    job();
    expect(game.count('tools')).toBe(0);
    expect(toolOf(game.state, 0)).toBe(TOOL_USES - 1);
  });

  it('with none in store, a farmer whose tools broke works at normal speed and nothing is refused', () => {
    const game = farm();
    stock(game, 1);
    for (let i = 0; i < TOOL_USES; i++) {
      expect(assignJob(game, 'plant', X, Y, 1000)).toBe(true);
      game.advance(jobOf(game)!.timer.duration);
    }
    expect(toolOf(game.state, 0)).toBeNull();
    expect(assignJob(game, 'plant', X, Y, 1000)).toBe(true);
    expect(workOf(jobOf(game)!)).toBe(1000);
    expect(toolOf(game.state, 0)).toBeNull();
  });

  it('warns when tools break with none left in store, at most once a game day', () => {
    const game = farm();
    for (let i = 0; i < 3; i++) addFarmer(game);
    const warn = vi.fn();
    onToolsWornOut(game, warn);
    const breakAll = () => {
      for (let i = 0; i < 4; i++) workersOf(game.state).tools[i] = 0;
      game.advance(1);
    };
    // Tools left in store: no warning.
    stock(game, 5);
    breakAll();
    expect(warn).not.toHaveBeenCalled();
    game.state.inventory.tools = 0;
    breakAll();
    breakAll();
    expect(warn).toHaveBeenCalledTimes(1);
    game.advance(DAY_MS);
    breakAll();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('the blacksmith forges 1 tools from 1 iron and 1 wood, and Keep making stops at one in store per farmer', () => {
    const game = farm();
    const smith = build<ProcessorState>(game, 'blacksmith', X + 1, Y + 5);
    game.state.inventory = { iron: 10, wood: 10 };
    const recipe = PROCESSORS.blacksmith.recipes[0];
    expect(recipe).toMatchObject({ id: 'tools', inputs: { iron: 1, wood: 1 }, output: { item: 'tools', qty: 1 }, durationMs: 6 * MIN });
    setKeepMaking(game, smith.id, 'tools');
    assignFarmer(game, smith.id);
    game.advance(1);
    // One farmer: one batch queued, and no more while it is under way.
    expect(smith.state.queue).toHaveLength(1);
    expect([game.count('iron'), game.count('wood')]).toEqual([9, 9]);
    expect(workplaceNext(game, smith)).toEqual({ wait: 'enough-tools', have: 1, need: 1 });
    game.advance(HOUR);
    // The smith collected the first tools and took them on the way out (store empty), so a second set was forged.
    expect(toolOf(game.state, 0)).not.toBeNull();
    expect(game.count('tools')).toBe(1);
    expect(smith.state.queue).toHaveLength(0);
    expect([game.count('iron'), game.count('wood')]).toEqual([8, 8]);
    expect(workplaceNext(game, smith)).toEqual({ wait: 'enough-tools', have: 1, need: 1 });
    // A family moves in: one more wanted.
    addFarmer(game);
    expect('task' in workplaceNext(game, smith)).toBe(true);
  });

  it('×1, ×60 and offline catch-up give the same tool counts and wear', () => {
    const setUp = () => {
      const game = farm();
      for (let i = 0; i < 3; i++) addFarmer(game);
      const [a, b] = game.objectsOfType(FIELD);
      const coop = build<PenState>(game, 'coop', X + 1, Y + 5);
      for (let i = 0; i < 3; i++) buyAnimal(game, coop, 'chicken');
      game.addItem('feed', 60);
      stock(game, 2);
      assignFarmer(game, a.id);
      assignFarmer(game, b.id);
      assignFarmer(game, coop.id);
      provisions(game);
      // Nearly worn out: they break early on, two farmers take the two in store, and the others work on without.
      workersOf(game.state).tools = [4, 3, 2, 1];
      // Farmer 3 builds sites.
      build(game, 'dairy', X + 6, Y + 5, { site: true });
      build(game, 'loom', X + 10, Y + 5, { site: true });
      return game;
    };
    const live = setUp();
    let broke = 0;
    live.activity.on('toolBroke', () => broke++);
    for (let t = 0; t < 3 * HOUR; t += 250) live.tick(250);
    const fast = setUp();
    fast.setSpeed(60);
    for (let i = 0; i < (3 * HOUR) / (250 * 60); i++) fast.tick(250);
    fast.setSpeed(1);
    const away = setUp();
    const result = catchUp(away, 3 * HOUR);

    const tools = (g: Game) => ({ slots: workersOf(g.state).tools, inStore: g.count('tools') });
    expect(tools(fast)).toEqual(tools(live));
    expect(tools(away)).toEqual(tools(live));
    expect(fast.state).toEqual(live.state);
    expect(away.state.objects).toEqual(live.state.objects);
    // The four worn sets broke, both sets in store were taken.
    expect(live.count('tools')).toBe(0);
    expect(broke).toBeGreaterThanOrEqual(4);
    expect(workersOf(live.state).tools.filter((t) => t !== null)).toHaveLength(2);
    expect(result.tools.wornOut).toBe(broke);
  });

  it('runWork alone (no frames) agrees too', () => {
    const a = ploughing(1);
    const b = ploughing(1);
    a.advance(2 * HOUR);
    runWork(b, b.now + 2 * HOUR);
    expect(workersOf(b.state).tools).toEqual(workersOf(a.state).tools);
  });
});

describe('tools in saves', () => {
  it('slots survive save and load', () => {
    const game = ploughing(3);
    const loaded = new Game(deserialize(serialize(game.state)));
    expect(workersOf(loaded.state).tools).toEqual([TOOL_USES - 1]);
    expect(loaded.count('tools')).toBe(2);
  });

  it('a version-13 save loads with an empty tool slot for every farmer', () => {
    const game = farm();
    addFarmer(game);
    addFarmer(game);
    const raw = JSON.parse(serialize(game.state));
    raw.version = 13;
    delete raw.state.ext.workers.tools;
    const { state } = parseSave(JSON.stringify(raw));
    expect((state.ext.workers as { tools: unknown }).tools).toEqual([null, null, null]);
    expect(workersOf(state).tools).toEqual([null, null, null]);
  });

  it('broken slots are repaired: anything but null or 0..30 jobs left is emptied', () => {
    const game = farm();
    addFarmer(game);
    addFarmer(game);
    workersOf(game.state).tools = [5, 'x', 99] as unknown as (number | null)[];
    expect(workersOf(game.state).tools).toEqual([5, null, null]);
  });
});

describe('tools in the welcome-back summary', () => {
  it('lists the tools forged and worn out while away', async () => {
    const { summaryLines } = await import('../ui/welcome');
    const game = farm();
    const smith = build<ProcessorState>(game, 'blacksmith', X + 1, Y + 5);
    game.state.inventory = { iron: 5, wood: 5 };
    setKeepMaking(game, smith.id, 'tools');
    assignFarmer(game, smith.id);
    workersOf(game.state).tools = [1];
    const result = catchUp(game, HOUR);
    expect(result.tools.wornOut).toBe(1);
    expect(result.tools.forged).toBeGreaterThan(0);
    const lines = summaryLines(result);
    expect(lines).toContain(`🛠️ Tools forged at the blacksmith: ${result.tools.forged}`);
    expect(lines).toContain('🛠️ Tools worn out by the farmers: 1');
  });
});
