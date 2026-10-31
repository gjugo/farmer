import { describe, expect, it } from 'vitest';
import { getBuildable } from '../data/buildables';
import { getItem } from '../data/items';
import { GOALS } from '../data/progression';
import { RESOURCES, SLOW_SEASONS, type ResourceType } from '../data/resourceBuildings';
import { FARMHOUSE_STORE } from '../data/storage';
import { COLLECT_WORK_MS } from '../data/workers';
import { START_LAYOUT } from './constants';
import { Game } from './game';
import { setOwned } from './land';
import { addDeposit, addTrees, inRange, mapOf } from './maplayer';
import { buyPrice } from './market';
import { catchUp } from './offline';
import { PROGRESSION, type ProgressionState } from './progression';
import { collect, cycleMsAt, idleReason, todayYield, type ResourceState } from './resources';
import { connectToFarmhouse } from './roads';
import { deserialize, serialize } from './save';
import { SEASON_MS } from './seasons';
import { getSlice } from './slices';
import { createNewGame } from './state';
import { capacity, used } from './storage';
import { maxLevelState } from './test-utils';
import type { PlacedObject } from './types';
import { workplaceNext } from './work';
import { assignFarmer, addFarmer, jobsByFarmer, unassignFarmer, workerAt, workersOf } from './workers';

const MIN = 60_000;
const HOUR = 60 * MIN;
// Tiles relative to the starting fields and farmhouse; the rows from Y + 5 down are free land.
const X = START_LAYOUT.x;
const Y = START_LAYOUT.y;
const TYPES = Object.keys(RESOURCES) as ResourceType[];

/** A top-level farm owning the whole map, with plenty of money and an empty inventory. */
function farm(): Game {
  const game = new Game(maxLevelState());
  game.earn(1_000_000);
  const land = game.state.land;
  for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) setOwned(land, x, y, true);
  return game;
}

/**
 * What the building works, so it never runs out in these tests: a deep deposit under a quarry or mine, and for a lodge
 * the 30 tiles of its reach from 3 rows below it on (clear of the roads and the other buildings).
 */
function supply(game: Game, type: ResourceType, x: number, y: number): void {
  const def = RESOURCES[type];
  const layer = mapOf(game.state);
  const area = { x, y, ...def.footprint };
  if (def.deposit) addDeposit(layer, def.deposit, area, 100_000);
  if (!def.range) return;
  const tiles: { x: number; y: number }[] = [];
  for (let ty = y + area.h + 2; ty < y + area.h + def.range; ty++) {
    for (let tx = x - def.range; tx < x + area.w + def.range; tx++) if (inRange(area, def.range, tx, ty)) tiles.push({ x: tx, y: ty });
  }
  addTrees(layer, tiles);
}

/** Places a finished resource building with all the materials it needs and, unless `road` is false, a path to it. */
function build(game: Game, type: ResourceType, x = X + 1, y = Y + 5, { road = true } = {}): PlacedObject<ResourceState> {
  supply(game, type, x, y);
  const inv = game.state.inventory;
  const before = { ...inv };
  for (const [id, qty] of Object.entries(RESOURCES[type].materials)) inv[id] = (inv[id] ?? 0) + qty;
  const r = game.place(type, x, y);
  if (!r.ok) throw new Error(`could not place ${type}: ${r.reason}`);
  game.state.inventory = before;
  if (road && !connectToFarmhouse(game.state, { x, y, ...getBuildable(type)!.footprint })) throw new Error(`no road to ${type}`);
  return r.object as unknown as PlacedObject<ResourceState>;
}

/** A farm with an empty storehouse pool (only the farmhouse's room) and `type` built, staffed and reachable. */
function staffed(type: ResourceType): { game: Game; obj: PlacedObject<ResourceState> } {
  const game = farm();
  game.state.inventory = {};
  const obj = build(game, type);
  expect(assignFarmer(game, obj.id).ok).toBe(true);
  return { game, obj };
}

/** Advances until `n` cycles have ended at the building (or `limit` has passed). */
function runCycles(game: Game, n: number, limit = 10 * HOUR): number {
  let made = 0;
  const off = game.activity.on('produced', () => made++);
  const end = game.now + limit;
  while (made < n && game.now < end) game.advance(MIN);
  off();
  return made;
}

describe('resource buildings', () => {
  it.each(TYPES)('an assigned %s produces its yield per cycle', (type) => {
    const { game, obj } = staffed(type);
    const def = RESOURCES[type];
    expect(runCycles(game, 1)).toBe(1);
    expect(game.count(def.output)).toBe(def.yield);
    expect(todayYield(game.state.clock, obj)).toBe(def.yield);
    expect(runCycles(game, 2)).toBe(2);
    expect(game.count(def.output)).toBe(3 * def.yield);
    // Nothing else came in: only the building's own material.
    expect(Object.keys(game.state.inventory)).toEqual([def.output]);
  });

  it('a cycle starts when the farmer gets there and ends with their work; then they walk home', () => {
    const { game, obj } = staffed('woodcutter');
    game.advance(1);
    const [job] = jobsByFarmer(game.state.clock, workersOf(game.state));
    expect(job?.kind).toBe('chop');
    const cycle = obj.state.cycle!;
    expect(cycle.start).toBe(job!.timer.start + job!.walkMs!);
    expect(cycle.duration).toBe(RESOURCES.woodcutter.cycleMs);
    game.advance(cycle.start + cycle.duration - game.now - 1);
    expect(game.count('wood')).toBe(0);
    game.advance(1);
    expect(game.count('wood')).toBe(4);
    // Walking home: still busy, and the next cycle only starts once they are free again.
    expect(jobsByFarmer(game.state.clock, workersOf(game.state))[0]).toBeDefined();
    expect(obj.state.cycle).toBeNull();
  });

  it('iron is the slowest and scarcest', () => {
    const perHour = (t: ResourceType) => (RESOURCES[t].yield * HOUR) / RESOURCES[t].cycleMs;
    expect(perHour('mine')).toBeLessThan(perHour('quarry'));
    expect(perHour('quarry')).toBeLessThan(perHour('woodcutter'));
    expect(RESOURCES.mine.cycleMs).toBeGreaterThan(RESOURCES.quarry.cycleMs);
    expect(RESOURCES.quarry.cycleMs).toBeGreaterThan(RESOURCES.woodcutter.cycleMs);
  });

  it('works in winter, a little slower', () => {
    const winter = 3 * SEASON_MS + 1;
    expect(cycleMsAt(RESOURCES.woodcutter, winter)).toBe(Math.round(RESOURCES.woodcutter.cycleMs * SLOW_SEASONS.winter!));
    const { game, obj } = staffed('woodcutter');
    game.state.clock.elapsed = winter;
    expect(runCycles(game, 1)).toBe(1);
    expect(game.count('wood')).toBe(4);
    expect(obj.state.day).toBeGreaterThan(0);
  });

  it('nothing is produced without a farmer', () => {
    const game = farm();
    game.state.inventory = {};
    const obj = build(game, 'woodcutter');
    game.advance(2 * HOUR);
    expect(game.count('wood')).toBe(0);
    expect(idleReason(game, obj)).toBe('no-farmer');
    // A free farmer never works it by themselves either.
    expect(jobsByFarmer(game.state.clock, workersOf(game.state)).filter(Boolean)).toEqual([]);
  });

  it('nothing is produced without a path from the farmhouse', () => {
    const game = farm();
    game.state.inventory = {};
    const obj = build(game, 'quarry', X + 7, Y + 6, { road: false });
    assignFarmer(game, obj.id);
    game.advance(2 * HOUR);
    expect(game.count('stone')).toBe(0);
    expect(idleReason(game, obj)).toBe('no-path');
    // Lay the path and it starts.
    connectToFarmhouse(game.state, { x: obj.x, y: obj.y, w: 2, h: 2 });
    expect(runCycles(game, 1)).toBe(1);
    expect(game.count('stone')).toBe(3);
  });

  it('nothing is produced while it is a construction site', () => {
    const game = farm();
    game.state.inventory = {};
    const r = game.place('woodcutter', X + 1, Y + 5, { site: true });
    if (!r.ok) throw new Error(r.reason);
    connectToFarmhouse(game.state, { x: X + 1, y: Y + 5, w: 2, h: 2 });
    expect(assignFarmer(game, r.object.id)).toEqual({ ok: false, reason: 'site' });
    expect(workplaceNext(game, r.object)).toEqual({ wait: 'site' });
  });

  it('a full storehouse holds the output in the building and frees the farmer', () => {
    const { game, obj } = staffed('woodcutter');
    // Room for 2 more wood only.
    game.state.inventory = { stone: FARMHOUSE_STORE.materials - 2 };
    expect(runCycles(game, 1)).toBe(1);
    expect(game.count('wood')).toBe(2);
    expect(obj.state.waiting).toBe(2);
    expect(used(game.state, 'materials')).toBe(capacity(game.state, 'materials'));
    // The farmer comes home and waits; no new cycle while output waits.
    game.advance(10 * MIN);
    expect(jobsByFarmer(game.state.clock, workersOf(game.state))[0]).toBeUndefined();
    expect(workplaceNext(game, obj)).toEqual({ wait: 'storehouse-full' });
    expect(idleReason(game, obj)).toBe('storehouse-full');
    game.advance(HOUR);
    expect(obj.state.waiting).toBe(2);
    expect(obj.state.cycle).toBeNull();
    // Free for other work: they build a site meanwhile.
    const site = game.place('field', X + 4, Y + 5, { site: true });
    if (!site.ok) throw new Error(site.reason);
    connectToFarmhouse(game.state, { x: X + 4, y: Y + 5, w: 2, h: 2 });
    game.advance(1);
    expect(jobsByFarmer(game.state.clock, workersOf(game.state))[0]?.kind).toBe('build');
    // Room again: once free, the farmer carries the waiting wood in, then cuts more. Nothing was lost.
    game.advance(HOUR);
    game.removeItem('stone', 10);
    game.advance(1);
    const [job] = jobsByFarmer(game.state.clock, workersOf(game.state));
    expect(job?.kind).toBe('collect');
    expect(game.count('wood')).toBe(4);
    expect(obj.state.waiting).toBe(0);
    game.advance(job!.timer.duration);
    expect(jobsByFarmer(game.state.clock, workersOf(game.state))[0]?.kind).toBe('chop');
    expect(COLLECT_WORK_MS).toBeGreaterThan(0);
  });

  it('the player can carry waiting output in by tapping, as far as there is room', () => {
    const { game, obj } = staffed('woodcutter');
    unassignFarmer(game, 0);
    obj.state.waiting = 5;
    game.state.inventory = { stone: FARMHOUSE_STORE.materials - 3 };
    expect(collect(game, obj)).toBe(3);
    expect(obj.state.waiting).toBe(2);
    expect(collect(game, obj)).toBe(0);
  });

  it('a farmer moved mid-cycle still finishes it; the next one starts only when someone works there', () => {
    const { game, obj } = staffed('woodcutter');
    game.advance(1);
    expect(obj.state.cycle).not.toBeNull();
    unassignFarmer(game, 0);
    expect(runCycles(game, 1)).toBe(1);
    expect(game.count('wood')).toBe(4);
    game.advance(HOUR);
    expect(game.count('wood')).toBe(4);
  });

  it('several staffed buildings work at once', () => {
    const game = farm();
    game.state.inventory = {};
    addFarmer(game);
    addFarmer(game);
    game.state.inventory = { wood: 8, stone: 8 };
    const store = game.place('storehouse', X + 4, Y + 8);
    if (!store.ok) throw new Error(store.reason);
    store.object.state.level = 3;
    // Food for the three families, so none of them leaves.
    game.state.inventory = { wheat: 50, carrot: 50 };
    const ids = [build(game, 'woodcutter', X + 1, Y + 5), build(game, 'quarry', X + 4, Y + 5), build(game, 'mine', X + 7, Y + 5)].map((o) => o.id);
    for (const id of ids) expect(assignFarmer(game, id).ok).toBe(true);
    game.advance(HOUR);
    expect(game.count('wood')).toBeGreaterThanOrEqual(4 * 10);
    expect(game.count('stone')).toBeGreaterThanOrEqual(3 * 8);
    expect(game.count('iron')).toBeGreaterThanOrEqual(7);
    expect(ids.map((id) => workerAt(game.state, id))).toEqual([0, 1, 2]);
  });
});

/** Counts the wood the families burn as firewood from now on. */
function firewoodOf(game: Game): { wood: number } {
  const burned = { wood: 0 };
  game.events.on('inventory', ({ itemId, delta }) => {
    if (itemId === 'wood' && delta < 0) burned.wood -= delta;
  });
  return burned;
}

describe('offline catch-up', () => {
  it('produces over hours as running live does, within one cycle, up to the storehouse capacity', () => {
    const live = staffed('woodcutter');
    const away = new Game(deserialize(serialize(live.game.state)));
    for (let t = 0; t < 3 * HOUR; t += 250) live.game.tick(250);
    const burned = firewoodOf(away);
    const result = catchUp(away, 3 * HOUR);
    const diff = Math.abs(live.game.count('wood') - away.count('wood'));
    expect(diff).toBeLessThanOrEqual(RESOURCES.woodcutter.yield);
    expect(away.count('wood')).toBeGreaterThan(0);
    expect(result.work.materials.wood).toBe(away.count('wood') + (away.getObject(live.obj.id)!.state.waiting as number) + burned.wood);
  });

  it('stops at the storehouse capacity, holds one cycle in the building, and the summary says so', () => {
    const { game, obj } = staffed('woodcutter');
    const burned = firewoodOf(game);
    const result = catchUp(game, 24 * HOUR);
    expect(burned.wood).toBeGreaterThan(0); // the family's winter firewood
    expect(game.count('wood')).toBe(FARMHOUSE_STORE.materials);
    const waiting = (game.getObject(obj.id)!.state as ResourceState).waiting;
    expect(waiting).toBeGreaterThan(0);
    expect(waiting).toBeLessThanOrEqual(RESOURCES.woodcutter.yield);
    expect(result.work.materials.wood).toBeGreaterThanOrEqual(FARMHOUSE_STORE.materials + waiting + burned.wood);
    expect(result.produced.wood).toBe(waiting);
    expect(result.changed).toContain(obj.id);
  });
});

describe('economy and unlocks', () => {
  it("a new farm can afford the woodcutter's lodge with what it starts with", () => {
    const game = new Game(createNewGame());
    expect(game.isUnlocked(RESOURCES.woodcutter.unlockLevel)).toBe(true);
    expect(game.canPayFor('woodcutter')).toBe(true);
  });

  it('the quarry costs money and wood, unlocked early; the mine money, wood and stone, later', () => {
    expect(RESOURCES.quarry.unlockLevel).toBeLessThanOrEqual(2);
    expect(Object.keys(RESOURCES.quarry.materials)).toEqual(['wood']);
    expect(RESOURCES.mine.unlockLevel).toBeGreaterThan(RESOURCES.quarry.unlockLevel);
    expect(Object.keys(RESOURCES.mine.materials).sort()).toEqual(['stone', 'wood']);
  });

  it('the mine never needs iron to build; no building needs its own output', () => {
    expect(RESOURCES.mine.materials.iron ?? 0).toBe(0);
    for (const def of Object.values(RESOURCES)) {
      expect(def.materials[def.output] ?? 0).toBe(0);
      // Its materials come from buildings unlocked no later than itself.
      for (const id of Object.keys(def.materials)) {
        const maker = Object.values(RESOURCES).find((r) => r.output === id)!;
        expect(maker.unlockLevel).toBeLessThanOrEqual(def.unlockLevel);
      }
    }
  });

  it('producing is clearly cheaper per unit than buying: a building pays for itself within two hours of work', () => {
    for (const def of Object.values(RESOURCES)) {
      // The dearest the Market ever asks for its materials, and the least it ever asks for the output.
      const dearest = (id: string) => Math.max(...Array.from({ length: 60 }, (_, d) => buyPrice(d + 1, id)!));
      const cheapest = Math.min(...Array.from({ length: 60 }, (_, d) => buyPrice(d + 1, def.output)!));
      const cost = def.cost + Object.entries(def.materials).reduce((sum, [id, qty]) => sum + qty * dearest(id), 0);
      const unitsIn2h = Math.floor((2 * HOUR) / (def.cycleMs * SLOW_SEASONS.winter!)) * def.yield;
      expect(unitsIn2h * cheapest, def.id).toBeGreaterThan(cost);
      // And the Market's buy price is over the base (sell) price, which stays the fallback.
      expect(cheapest).toBeGreaterThan(getItem(def.output)!.price);
    }
  });
});

describe('goals and saves', () => {
  it('goals come in unlock order: lodge, 20 wood, quarry, 5 iron; a lodge or quarry built earlier counts', () => {
    const ids = GOALS.map((g) => g.id);
    const at = (id: string) => ids.indexOf(id);
    expect(at('build-woodcutter')).toBeGreaterThan(-1);
    expect(at('build-woodcutter')).toBeLessThan(at('produce-wood'));
    expect(at('produce-wood')).toBeLessThan(at('build-quarry'));
    expect(at('build-quarry')).toBeLessThan(at('mine-iron'));
    const { game, obj } = staffed('woodcutter');
    getSlice<ProgressionState>(game.state, PROGRESSION).goals = [{ id: 'build-woodcutter', progress: 0 }];
    game.touch(obj);
    expect(game.progression.goals()[0].complete).toBe(true);
  });

  it('"Produce 20 wood" counts wood made by the lodge, not wood bought', () => {
    const { game } = staffed('woodcutter');
    getSlice<ProgressionState>(game.state, PROGRESSION).goals = [{ id: 'produce-wood', progress: 0 }];
    game.addItem('wood', 3);
    expect(game.progression.goals()[0].progress).toBe(0);
    game.state.inventory = {};
    runCycles(game, 5);
    expect(game.progression.goals()[0].complete).toBe(true);
  });

  it('save and load keep the buildings, their cycle and their waiting output', () => {
    const { game, obj } = staffed('mine');
    obj.state.waiting = 1;
    game.state.inventory = {};
    game.advance(1);
    const loaded = new Game(deserialize(serialize(game.state)));
    const copy = loaded.getObject(obj.id)!;
    expect(copy.type).toBe('mine');
    expect(copy.state).toEqual(obj.state);
    expect(workerAt(loaded.state, obj.id)).toBe(0);
  });

  it('an old save (version 8) skips the new goals it is past', () => {
    const file = (nextGoal: number) => {
      const state = createNewGame();
      getSlice<ProgressionState>(state, PROGRESSION).nextGoal = nextGoal;
      const raw = JSON.parse(serialize(state));
      raw.version = 8;
      return getSlice<ProgressionState>(deserialize(JSON.stringify(raw)), PROGRESSION).nextGoal;
    };
    // In version 8, index 7 was "collect-eggs", 14 "make-cheese", 16 "buy-land", 17 "make-feed" and 18 "own-sheep".
    expect(GOALS[file(7)].id).toBe('collect-eggs');
    // Not offered "make-cheese" yet: version 10's "spread-manure", inserted before it, comes first.
    expect(GOALS[file(14)].id).toBe('spread-manure');
    expect(GOALS[file(16)].id).toBe('buy-land');
    // Offered up to "buy-land": the lodge comes next. Offered "make-feed" too: past the lodge, wood and quarry goals.
    expect(GOALS[file(17)].id).toBe('build-woodcutter');
    expect(GOALS[file(18)].id).toBe('mine-iron');
  });
});
