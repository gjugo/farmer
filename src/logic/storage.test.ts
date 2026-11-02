import { describe, expect, it } from 'vitest';
import { FEED_PACK } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { CROPS, FIELD } from '../data/crops';
import { GOALS } from '../data/progression';
import { FARMHOUSE_STORE, STORAGE } from '../data/storage';
import { buyAnimal, buyFeed, collect, feedAll, readyCount, type PenState } from './animals';
import { cropStage, harvest, plant, type FieldState } from './crops';
import { START_LAND } from './constants';
import { demolishRefund, Game } from './game';
import { buy, buyPrice, sell } from './market';
import { catchUp } from './offline';
import { collect as collectOutput, readyCount as outputReady, settle, startJob, type ProcessorState } from './processing';
import { PROGRESSION, type ProgressionState } from './progression';
import { deserialize, serialize } from './save';
import { getSlice } from './slices';
import { createNewGame } from './state';
import {
  capacity,
  checkUpgrade,
  excessWithout,
  poolOf,
  spaceFor,
  storageInfo,
  storageNoticeMessage,
  takeStorageNotice,
  upgrade,
  used,
} from './storage';
import { maxLevelState, noCamp } from './test-utils';
import type { GameState, PlacedObject } from './types';

// Free land in the starting land's top-left corner, above the starting fields and the farmhouse.
const fx = START_LAND.x;
const fy = START_LAND.y;

/** A top-level farm holding exactly `inventory`, with `money`. */
function farm(inventory: Record<string, number> = {}, money = 10_000): Game {
  const state = maxLevelState();
  state.inventory = { ...inventory };
  state.money = money;
  return new Game(state);
}

/** Places `type` for free: its cost is handed over just before placing, so money and inventory stay as they were. */
function build<S extends object = Record<string, unknown>>(game: Game, type: string, x: number, y: number): PlacedObject<S> {
  const def = getBuildable(type)!;
  const inventory = { ...game.state.inventory };
  const money = game.state.money;
  game.state.inventory = { ...inventory, ...def.materials };
  game.state.money += def.cost;
  const r = game.place(type, x, y);
  if (!r.ok) throw new Error(`${type}: ${r.reason}`);
  game.state.inventory = inventory;
  game.state.money = money;
  return r.object as PlacedObject<S>;
}

/** Everything the farm holds: inventory plus goods waiting in pens and buildings. */
function holdings(state: GameState): Record<string, number> {
  const out: Record<string, number> = { ...state.inventory };
  for (const o of state.objects) {
    const ready = (o.state as Partial<ProcessorState>).ready;
    if (ready) for (const [id, n] of Object.entries(ready)) out[id] = (out[id] ?? 0) + n;
  }
  return out;
}

function ripeWheat(game: Game): PlacedObject<FieldState> {
  const field = game.objectsOfType(FIELD)[0] as PlacedObject<FieldState>;
  expect(plant(game, field, 'wheat').ok).toBe(true);
  game.state.clock.elapsed += CROPS.wheat.growMs;
  expect(cropStage(game.state.clock, field.state)).toBe('ripe');
  return field;
}

describe('capacity', () => {
  it("is the farmhouse store on a new farm, for goods and for materials, plus the camp's supplies", () => {
    const game = new Game(createNewGame());
    // 15 bread and 15 carrots, 40 wood and 20 stone: the camp makes room for exactly what it brought.
    expect(storageInfo(game.state)).toEqual({ goods: { used: 30, capacity: 60 }, materials: { used: 60, capacity: 90 } });
    expect(storageInfo(noCamp(game.state))).toEqual({ goods: { used: 0, capacity: 30 }, materials: { used: 0, capacity: 30 } });
    expect(FARMHOUSE_STORE).toEqual({ goods: 30, materials: 30 });
  });

  it('sums every building of the pool plus the farmhouse, by level', () => {
    const game = farm();
    build(game, 'granary', fx, fy);
    expect(capacity(game.state, 'goods')).toBe(30 + 100);
    const second = build(game, 'granary', fx + 2, fy);
    expect(capacity(game.state, 'goods')).toBe(30 + 100 + 100);
    second.state.level = 3;
    expect(capacity(game.state, 'goods')).toBe(30 + 100 + 500);
    // A storehouse only adds room for materials.
    build(game, 'storehouse', fx + 4, fy);
    expect(capacity(game.state, 'goods')).toBe(630);
    expect(capacity(game.state, 'materials')).toBe(30 + 60);
  });

  it('a granary still being built holds nothing and cannot be upgraded; once finished it does', () => {
    const game = farm({ wood: 50, stone: 50 });
    const r = game.place('granary', fx, fy, { site: true });
    if (!r.ok) throw new Error(r.reason);
    expect(r.object.site).toBeDefined();
    expect(capacity(game.state, 'goods')).toBe(30);
    expect(checkUpgrade(game, r.object)).toEqual({ ok: false, reason: 'site' });
    expect(excessWithout(game.state, r.object)).toBe(0);
    delete r.object.site;
    expect(capacity(game.state, 'goods')).toBe(130);
    expect(checkUpgrade(game, r.object)).toEqual({ ok: true, level: 2 });
  });

  it('goods hold every item but materials, which go in the storehouse', () => {
    expect(['wheat', 'egg', 'feed', 'cheese', 'cloth'].map(poolOf)).toEqual(['goods', 'goods', 'goods', 'goods', 'goods']);
    expect(['wood', 'stone', 'iron'].map(poolOf)).toEqual(['materials', 'materials', 'materials']);
    const game = farm({ wheat: 10, egg: 5, wood: 7 });
    expect(used(game.state, 'goods')).toBe(15);
    expect(used(game.state, 'materials')).toBe(7);
    expect(spaceFor(game.state, 'milk')).toBe(15);
    expect(spaceFor(game.state, 'iron')).toBe(23);
  });

  it('a level saved with junk counts as level 1, and a level above the top as the top', () => {
    const game = farm();
    const g = build(game, 'granary', fx, fy);
    g.state.level = 'x';
    expect(capacity(game.state, 'goods')).toBe(130);
    g.state.level = 9;
    expect(capacity(game.state, 'goods')).toBe(530);
  });
});

describe('adding items', () => {
  it('takes what fits and says how many went in (debug +10 included)', () => {
    const game = farm({ wheat: 25 });
    expect(game.addItem('egg', 10)).toBe(5);
    expect(game.count('egg')).toBe(5);
    expect(game.addItem('egg', 10)).toBe(0);
    expect(game.count('egg')).toBe(5);
    // Materials have their own room.
    expect(game.addItem('wood', 10)).toBe(10);
  });

  it('frees room at once when selling or when processing takes inputs', () => {
    const game = farm({ wheat: 26, egg: 4 });
    const bakery = build<ProcessorState>(game, 'bakery', fx, fy);
    expect(spaceFor(game.state, 'milk')).toBe(0);
    expect(startJob(game, bakery, 'bread').ok).toBe(true);
    expect(spaceFor(game.state, 'milk')).toBe(4);
    sell(game, 'wheat', 3);
    expect(spaceFor(game.state, 'milk')).toBe(7);
  });
});

describe('upgrades', () => {
  it('raise the capacity and charge the money and materials exactly', () => {
    const game = farm({ wood: 20, stone: 12 }, 1000);
    const g = build(game, 'granary', fx, fy);
    const cost = STORAGE.granary.levels[1].upgrade!;
    expect(upgrade(game, g)).toEqual({ ok: true, level: 2 });
    expect(g.state.level).toBe(2);
    expect(capacity(game.state, 'goods')).toBe(30 + 250);
    expect(game.money).toBe(1000 - cost.cost);
    expect(game.state.inventory).toEqual({ wood: 20 - cost.materials.wood!, stone: 12 - cost.materials.stone! });
  });

  it('level 3 needs iron; at the top level there is nothing more', () => {
    const game = farm({ wood: 100, stone: 100 }, 5000);
    const g = build(game, 'granary', fx, fy);
    expect(upgrade(game, g).ok).toBe(true);
    expect(upgrade(game, g)).toEqual({ ok: false, reason: 'materials' });
    game.state.inventory.iron = 4;
    expect(upgrade(game, g)).toEqual({ ok: true, level: 3 });
    expect(capacity(game.state, 'goods')).toBe(530);
    expect(checkUpgrade(game, g)).toEqual({ ok: false, reason: 'max' });
  });

  it('are refused without the money or the materials, and nothing changes', () => {
    const poor = farm({ wood: 100, stone: 100 }, 10);
    const g = build(poor, 'granary', fx, fy);
    const before = structuredClone(poor.state);
    expect(upgrade(poor, g)).toEqual({ ok: false, reason: 'money' });
    expect(poor.state).toEqual(before);

    const bare = farm({}, 5000);
    const s = build(bare, 'storehouse', fx, fy);
    expect(upgrade(bare, s)).toEqual({ ok: false, reason: 'materials' });
    expect(bare.money).toBe(5000);
    expect(s.state.level).toBe(1);
  });

  it('only storage buildings can be upgraded', () => {
    const game = farm();
    expect(checkUpgrade(game, game.objectsOfType(FIELD)[0])).toEqual({ ok: false, reason: 'not-storage' });
  });
});

describe('harvest', () => {
  it('is refused while the granary is full: the crop stays ripe and nothing changes; after selling it works', () => {
    const game = farm({ egg: 28 });
    const field = ripeWheat(game);
    const before = structuredClone(game.state);
    expect(harvest(game, field)).toEqual({ ok: false, reason: 'full' });
    expect(game.state).toEqual(before);
    expect(cropStage(game.state.clock, field.state)).toBe('ripe');

    // The starting field lies on rich soil: its harvest is 12 wheat.
    sell(game, 'egg', 10);
    expect(harvest(game, field).ok).toBe(true);
    expect(game.count('wheat')).toBe(12);
    expect(used(game.state, 'goods')).toBe(30);
  });
});

describe('collecting', () => {
  it('a pen gives what fits; the rest stays ready in the pen and nothing is lost or duplicated', () => {
    const game = farm({ feed: 20 });
    const coop = build<PenState>(game, 'coop', fx, fy);
    for (let i = 0; i < 5; i++) buyAnimal(game, coop, 'chicken');
    expect(feedAll(game, coop)).toBe(5);
    game.state.inventory = { wheat: 28 };
    game.state.clock.elapsed += 10 * 60_000;
    expect(readyCount(game.state.clock, coop)).toBe(5);

    expect(collect(game, coop)).toEqual({ egg: 2 });
    expect(game.count('egg')).toBe(2);
    expect(readyCount(game.state.clock, coop)).toBe(3);
    expect(collect(game, coop)).toEqual({});
    sell(game, 'wheat', 28);
    expect(collect(game, coop)).toEqual({ egg: 3 });
    expect(readyCount(game.state.clock, coop)).toBe(0);
    expect(game.count('egg')).toBe(5);
  });

  it('a processing building gives what fits; the rest waits in it', () => {
    const game = farm({ milk: 6 });
    const dairy = build<ProcessorState>(game, 'dairy', fx, fy);
    for (let i = 0; i < 3; i++) expect(startJob(game, dairy, 'cheese').ok).toBe(true);
    game.state.inventory.wheat = 29;
    game.state.clock.elapsed += 60 * 60_000;
    settle(game.state, dairy);
    const total = holdings(game.state);
    expect(collectOutput(game, dairy)).toEqual({ cheese: 1 });
    expect(outputReady(dairy)).toBe(2);
    expect(holdings(game.state)).toEqual(total);
    sell(game, 'wheat');
    expect(collectOutput(game, dairy)).toEqual({ cheese: 2 });
    expect(outputReady(dairy)).toBe(0);
  });
});

describe('buying', () => {
  it('feed is refused when the whole pack does not fit, and no money is taken', () => {
    const game = farm({ wheat: 30 - FEED_PACK.qty + 1 }, 1000);
    expect(buyFeed(game)).toEqual({ ok: false, reason: 'full' });
    expect(game.money).toBe(1000);
    expect(game.count('feed')).toBe(0);
    sell(game, 'wheat', 1);
    expect(buyFeed(game)).toEqual({ ok: true });
    expect(game.count('feed')).toBe(FEED_PACK.qty);
  });

  it('materials are capped at the room left, charging only for what was bought', () => {
    const game = farm({ wood: 25 }, 1000);
    const r = buy(game, 'stone', 10);
    if (!r.ok) throw new Error(r.reason);
    expect(r.qty).toBe(5);
    expect(game.count('stone')).toBe(5);
    expect(game.money).toBe(1000 - r.spent);
    expect(r.spent).toBe(5 * buyPrice(game.day, 'stone')!);
    expect(buy(game, 'stone', 1)).toEqual({ ok: false, reason: 'full' });
    expect(game.money).toBe(1000 - r.spent);
  });
});

describe('demolishing', () => {
  it('refunds materials only as far as they fit; the confirm can say what is lost', () => {
    const game = farm({}, 1000);
    const coop = build(game, 'coop', fx, fy); // 8 wood: 4 come back
    game.state.inventory = { stone: 28 };
    expect(game.checkDemolish(coop.id)).toEqual({ ok: true, money: demolishRefund(getBuildable('coop')), materials: { wood: 2 }, lost: { wood: 2 } });
    game.demolish(coop.id);
    expect(game.state.inventory).toEqual({ stone: 28, wood: 2 });
  });

  it('a granary is refused while its stock would not fit without it, and goes once enough is sold', () => {
    const game = farm({}, 1000);
    const g = build(game, 'granary', fx, fy);
    game.state.inventory = { wheat: 70 };
    expect(excessWithout(game.state, g)).toBe(40);
    expect(game.checkDemolish(g.id)).toEqual({ ok: false, reason: 'storage', excess: 40 });
    const before = structuredClone(game.state);
    expect(game.demolish(g.id)).toBeNull();
    expect(game.state).toEqual(before);
    sell(game, 'wheat', 40);
    expect(game.demolish(g.id)).not.toBeNull();
    expect(game.getObject(g.id)).toBeUndefined();
  });

  it('a storehouse refund fits in what is left once it is gone', () => {
    const game = farm({}, 1000);
    const s = build(game, 'storehouse', fx, fy); // 8 wood + 8 stone: 4 + 4 come back
    game.state.inventory = { iron: 26 };
    expect(game.checkDemolish(s.id)).toMatchObject({ ok: true, materials: { wood: 4 }, lost: { stone: 4 } });
    game.demolish(s.id);
    expect(used(game.state, 'materials')).toBe(30);
  });
});

describe('offline catch-up', () => {
  it('puts nothing in the inventory: goods wait in pens and buildings, even with the granary full', () => {
    const game = farm({ wheat: 30, milk: 2 });
    const dairy = build<ProcessorState>(game, 'dairy', fx, fy);
    startJob(game, dairy, 'cheese');
    game.state.inventory.wheat = 30;
    const g = new Game(game.state);
    const added: string[] = [];
    g.events.on('inventory', ({ itemId, delta }) => delta > 0 && added.push(itemId));
    const r = catchUp(g, 60 * 60_000);
    expect(r.produced).toEqual({ cheese: 1 });
    // Only the family's meals left the store; nothing came in.
    expect(added).toEqual([]);
    expect(game.state.inventory.wheat).toBe(30 - 2 * 7);
    expect(outputReady(dairy)).toBe(1);
  });
});

describe('old saves', () => {
  /** A version-6 save (from before storage) holding `inventory`. */
  function oldSave(inventory: Record<string, number>, nextGoal?: number): string {
    const state = noCamp(createNewGame());
    state.inventory = { ...inventory };
    delete state.ext.storage;
    const file = JSON.parse(serialize(state));
    file.version = 6;
    if (nextGoal !== undefined) getSlice<ProgressionState>(file.state, PROGRESSION).nextGoal = nextGoal;
    return JSON.stringify(file);
  }

  it('keep everything they hold above capacity, but nothing new comes in until the pool is back under', () => {
    const game = new Game(deserialize(oldSave({ wheat: 50, wood: 40 })));
    expect(game.state.inventory).toEqual({ wheat: 50, wood: 40 });
    expect(storageInfo(game.state)).toEqual({ goods: { used: 50, capacity: 30 }, materials: { used: 40, capacity: 30 } });
    expect(game.addItem('egg', 1)).toBe(0);
    expect(buy(game, 'stone', 1)).toEqual({ ok: false, reason: 'full' });
    const field = ripeWheat(game);
    expect(harvest(game, field)).toEqual({ ok: false, reason: 'full' });
    sell(game, 'wheat', 22); // 28 left: room for 2
    expect(harvest(game, field)).toEqual({ ok: false, reason: 'full' });
    expect(game.addItem('egg', 5)).toBe(2);
    sell(game, 'wheat', 10);
    expect(harvest(game, field).ok).toBe(true);
  });

  it('tell the player once to build a granary; new farms are not told', () => {
    const state = deserialize(oldSave({ wheat: 50 }));
    expect(storageNoticeMessage(state)).toContain('build a 🌾 Granary');
    expect(storageNoticeMessage(state)).toContain('goods (50/30)');
    expect(takeStorageNotice(state)).toBe(true);
    expect(takeStorageNotice(state)).toBe(false);
    // Saved and loaded again: still told only once.
    expect(takeStorageNotice(deserialize(serialize(state)))).toBe(false);
    expect(takeStorageNotice(createNewGame())).toBe(false);
  });

  it('skip the new goals they are already past', () => {
    // In version 6, index 3 was "buy-wood", 10 "reach-3" and 12 "make-cheese".
    const early = deserialize(oldSave({}, 3));
    expect(GOALS[getSlice<ProgressionState>(early, PROGRESSION).nextGoal].id).toBe('buy-wood');
    // Offered everything up to "own-fields": "upgrade a granary" now comes next.
    const late = deserialize(oldSave({}, 10));
    expect(GOALS[getSlice<ProgressionState>(late, PROGRESSION).nextGoal].id).toBe('upgrade-granary');
    // Not offered "make-cheese" yet: "spread-manure" (version 10), inserted just before it, comes first.
    const later = deserialize(oldSave({}, 12));
    expect(GOALS[getSlice<ProgressionState>(later, PROGRESSION).nextGoal].id).toBe('spread-manure');
  });
});

describe('save and load', () => {
  it('keeps storage levels and capacity', () => {
    const game = farm({ wood: 100, stone: 100 });
    const g = build(game, 'granary', fx, fy);
    upgrade(game, g);
    build(game, 'storehouse', fx + 2, fy);
    const loaded = new Game(deserialize(serialize(game.state)));
    expect(loaded.getObject(g.id)?.state.level).toBe(2);
    expect(storageInfo(loaded.state)).toEqual(storageInfo(game.state));
    expect(storageInfo(loaded.state).goods.capacity).toBe(280);
  });
});
