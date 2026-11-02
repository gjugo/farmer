import { describe, expect, it } from 'vitest';
import { getBuildable } from '../data/buildables';
import { CART_CAPACITY, CART_LOAD_MS, CART_UNLOAD_MS, OX_BARN, OX_MS_PER_TILE, OX_PRICE, YARD_CYCLES } from '../data/haul';
import { RESOURCES, type ResourceType } from '../data/resourceBuildings';
import { FARMHOUSE_STORE } from '../data/storage';
import { WALK_MS_PER_TILE } from '../data/farmhouse';
import { START_LAYOUT } from './constants';
import { Game } from './game';
import { barnWait, buyOx, cartsOf, goodsOnCarts, legEnds, planHaul, sanitizeBarn, tripsOf, type BarnState, type HaulTrip } from './haul';
import { addDeposit, addTrees, inRange, mapOf } from './maplayer';
import { catchUp } from './offline';
import type { ProcessorState } from './processing';
import type { ResourceState } from './resources';
import { connectToFarmhouse, wayLength } from './roads';
import { deserialize, parseSave, SAVE_VERSION, serialize } from './save';
import { maxLevelState } from './test-utils';
import type { PlacedObject } from './types';
import { nextWorkEvent, workplaceNext } from './work';
import { addFarmer, assignFarmer, jobsByFarmer, workersOf } from './workers';

const MIN = 60_000;
const HOUR = 60 * MIN;
// The rows from Y + 5 down are free land, clear of the starting fields and the farmhouse.
const X = START_LAYOUT.x;
const Y = START_LAYOUT.y;

/** A top-level farm, with plenty of money, food for its families and no materials. */
function farm(farmers = 1): Game {
  const game = new Game(maxLevelState());
  game.earn(1_000_000);
  game.state.inventory = { wheat: 10, carrot: 10 };
  for (let i = 1; i < farmers; i++) addFarmer(game);
  return game;
}

/** Places a finished building (paying no materials) and, unless `road` is false, lays a path from the farmhouse to it. */
function build<S extends object = Record<string, unknown>>(game: Game, type: string, x: number, y: number, { road = true } = {}): PlacedObject<S> {
  const before = { ...game.state.inventory };
  for (const [id, qty] of Object.entries(getBuildable(type)!.materials ?? {})) game.state.inventory[id] = (game.state.inventory[id] ?? 0) + qty;
  const r = game.place(type, x, y);
  if (!r.ok) throw new Error(`could not place ${type}: ${r.reason}`);
  game.state.inventory = before;
  if (road && !connectToFarmhouse(game.state, { x, y, ...getBuildable(type)!.footprint })) throw new Error(`no road to ${type}`);
  return r.object as unknown as PlacedObject<S>;
}

/** What a resource building works, so it never runs out: a deep deposit, or trees in reach below it. */
function supply(game: Game, type: ResourceType, x: number, y: number): void {
  const def = RESOURCES[type];
  const area = { x, y, ...def.footprint };
  if (def.deposit) addDeposit(mapOf(game.state), def.deposit, area, 100_000);
  if (!def.range) return;
  const tiles: { x: number; y: number }[] = [];
  for (let ty = y + area.h + 2; ty < y + area.h + def.range; ty++) {
    for (let tx = x - def.range; tx < x + area.w + def.range; tx++) if (inRange(area, def.range, tx, ty)) tiles.push({ x: tx, y: ty });
  }
  addTrees(mapOf(game.state), tiles);
}

/** A barn with an ox and a carter (farmer 0). */
function barnWithCart(game: Game, x = X + 4, y = Y + 5): PlacedObject<BarnState> {
  const barn = build<BarnState>(game, OX_BARN, x, y);
  expect(buyOx(game, barn, true)).toEqual({ ok: true });
  expect(assignFarmer(game, barn.id, 0).ok).toBe(true);
  return barn;
}

/** An unstaffed lodge whose yard holds `waiting` wood. */
function yard(game: Game, x: number, y: number, waiting: number, options = {}): PlacedObject<ResourceState> {
  const lodge = build<ResourceState>(game, 'woodcutter', x, y, options);
  lodge.state.waiting = waiting;
  return lodge;
}

/** A full granary of food, so the families stay (and burn no wood they'd miss). */
function fed(game: Game): void {
  build(game, 'granary', X + 12, Y + 12).state.level = 3;
  game.state.inventory = { ...game.state.inventory, wheat: 100, carrot: 100 };
}

const tripOf = (game: Game): HaulTrip | undefined => tripsOf(game.state)[0]?.trip;

/** Plays `ms` of game time at ×1 in frames of `frameMs`. */
function play(game: Game, ms: number, frameMs = 250): void {
  for (let t = 0; t < ms; t += frameMs) game.tick(Math.min(frameMs, ms - t));
}

describe('the ox barn', () => {
  it('is a level-3 workplace of 3×2 tiles, built with wood and stone', () => {
    const def = getBuildable(OX_BARN)!;
    expect(def.footprint).toEqual({ w: 3, h: 2 });
    expect(def.unlockLevel).toBe(3);
    expect(Object.keys(def.materials ?? {}).sort()).toEqual(['stone', 'wood']);
  });

  it('sells one ox for $300; the debug button gives it free', () => {
    const game = farm();
    const barn = build<BarnState>(game, OX_BARN, X + 4, Y + 5);
    const money = game.state.money;
    expect(buyOx(game, barn)).toEqual({ ok: true });
    expect(game.state.money).toBe(money - OX_PRICE);
    expect(barn.state.ox).toBe(true);
    expect(buyOx(game, barn)).toEqual({ ok: false, reason: 'has-ox' });
    const poor = farm();
    const other = build<BarnState>(poor, OX_BARN, X + 4, Y + 5);
    poor.spend(poor.state.money);
    expect(buyOx(poor, other)).toEqual({ ok: false, reason: 'money' });
    expect(buyOx(poor, other, true)).toEqual({ ok: true });
    expect(poor.state.money).toBe(0);
  });

  it('keeps the bought ox when a money listener repairs the barn (the open panel redraws)', () => {
    const game = farm();
    const barn = build<BarnState>(game, OX_BARN, X + 4, Y + 5);
    game.events.on('money', () => sanitizeBarn(barn));
    expect(buyOx(game, barn)).toEqual({ ok: true });
    expect(barn.state.ox).toBe(true);
    expect(cartsOf(game.state).map((c) => c.barn)).toEqual([barn.id]);
  });

  it('allows several barns, each with its own carter', () => {
    const game = farm(2);
    const a = barnWithCart(game, X + 4, Y + 5);
    const b = build<BarnState>(game, OX_BARN, X + 8, Y + 5);
    buyOx(game, b, true);
    expect(assignFarmer(game, b.id, 1).ok).toBe(true);
    expect(workersOf(game.state).workplaces).toEqual([a.id, b.id]);
  });
});

describe('the yard', () => {
  it('holds three cycles of yield', () => {
    expect(YARD_CYCLES).toBe(3);
  });
});

describe('wait reasons', () => {
  it('no ox, no carter, nothing to haul', () => {
    const game = farm();
    const barn = build<BarnState>(game, OX_BARN, X + 4, Y + 5);
    expect(barnWait(game, barn)).toEqual({ wait: 'no-ox' });
    expect(workplaceNext(game, barn)).toMatchObject({ wait: 'no-ox' });
    buyOx(game, barn, true);
    expect(barnWait(game, barn)).toEqual({ wait: 'no-carter' });
    assignFarmer(game, barn.id, 0);
    expect(barnWait(game, barn)).toMatchObject({ wait: 'nothing-to-haul' });
    game.advance(HOUR);
    expect(jobsByFarmer(game.state.clock, workersOf(game.state))[0]).toBeUndefined();
  });

  it('stores full: the goods wait in the yard until there is room', () => {
    const game = farm();
    const barn = barnWithCart(game);
    const lodge = yard(game, X + 1, Y + 5, 8);
    game.state.inventory.stone = FARMHOUSE_STORE.materials;
    expect(barnWait(game, barn)).toMatchObject({ wait: 'stores-full' });
    game.advance(HOUR);
    expect(lodge.state.waiting).toBe(8);
    game.removeItem('stone', FARMHOUSE_STORE.materials);
    game.advance(1);
    expect(tripOf(game)?.from).toBe(lodge.id);
  });

  it('no path to a yard the cart cannot reach', () => {
    const game = farm();
    const barn = barnWithCart(game);
    const lodge = yard(game, X + 1, Y + 9, 8, { road: false });
    expect(barnWait(game, barn)).toEqual({ wait: 'no-path', to: lodge.id });
  });

  it('no path to the stores', () => {
    const game = farm();
    const barn = barnWithCart(game);
    // The yard is joined to the barn by its own path, but not to the farmhouse.
    const lodge = yard(game, X + 4, Y + 8, 8, { road: false });
    const r = game.place('path', X + 5, Y + 7);
    if (!r.ok) throw new Error(r.reason);
    expect(planHaul(game, barn)).toMatchObject({ wait: 'no-path' });
    expect((planHaul(game, barn) as { to: string }).to).toBe(game.objectsOfType('farmhouse')[0].id);
    expect(lodge.state.waiting).toBe(8);
  });
});

describe('a haul trip', () => {
  it('goes to the fullest yard', () => {
    const game = farm();
    const barn = barnWithCart(game);
    yard(game, X + 1, Y + 5, 5);
    const fuller = yard(game, X + 8, Y + 5, 9);
    const plan = planHaul(game, barn);
    expect('trip' in plan && plan.trip.from).toBe(fuller.id);
  });

  it('or the processing building with the most finished goods', () => {
    const game = farm();
    const barn = barnWithCart(game);
    yard(game, X + 1, Y + 5, 5);
    const mill = build<ProcessorState>(game, 'feed-mill', X + 8, Y + 5);
    mill.state.ready = { feed: 12 };
    const plan = planHaul(game, barn);
    expect('trip' in plan && plan.trip.from).toBe(mill.id);
    game.advance(1);
    const trip = tripOf(game)!;
    game.advance(legEnds(trip)[1] - game.now);
    expect(trip.load).toEqual({ feed: 12 });
    expect(mill.state.ready).toEqual({});
  });

  it('loads at most 20 units', () => {
    const game = farm();
    barnWithCart(game);
    const lodge = yard(game, X + 1, Y + 5, 26);
    game.advance(1);
    const trip = tripOf(game)!;
    expect(trip.planned).toBe(CART_CAPACITY);
    game.advance(legEnds(trip)[1] - game.now);
    expect(trip.load).toEqual({ wood: CART_CAPACITY });
    expect(lodge.state.waiting).toBe(26 - CART_CAPACITY);
  });

  it('unloads at the nearest store with room', () => {
    const game = farm();
    barnWithCart(game, X + 4, Y + 5);
    yard(game, X + 1, Y + 9, 8);
    const near = build(game, 'storehouse', X + 1, Y + 12);
    build(game, 'storehouse', X + 12, Y + 12);
    game.advance(1);
    expect(tripOf(game)?.to).toBe(near.id);
  });

  it('times its legs: the carter walks to the barn, the ox drives at 0.6 s a tile, loads, drives, unloads, drives back', () => {
    const game = farm();
    const barn = barnWithCart(game);
    const lodge = yard(game, X + 1, Y + 5, 8);
    const start = game.now;
    game.advance(1);
    const [job] = jobsByFarmer(game.state.clock, workersOf(game.state));
    expect(job?.kind).toBe('haul');
    const trip = job!.haul!;
    expect(trip.legs.map((l) => l.kind)).toEqual(['drive', 'load', 'drive', 'unload', 'drive']);
    for (const leg of trip.legs.filter((l) => l.kind === 'drive')) expect(leg.ms).toBe(Math.round(wayLength(leg.way) * OX_MS_PER_TILE));
    expect(trip.legs[1].ms).toBe(CART_LOAD_MS);
    expect(trip.legs[3].ms).toBe(CART_UNLOAD_MS);
    // The carter walks (0.4 s a tile) to the barn first and home after.
    expect(OX_MS_PER_TILE).toBe(600);
    expect(WALK_MS_PER_TILE).toBe(400);
    expect(trip.start).toBe(start + job!.walkMs!);
    expect(job!.timer.duration).toBe(2 * job!.walkMs! + trip.legs.reduce((n, l) => n + l.ms, 0));
    const [, loadAt, , unloadAt, parkAt] = legEnds(trip);
    // The goods are in the yard until loaded...
    game.advance(loadAt - 1 - game.now);
    expect(lodge.state.waiting).toBe(8);
    expect(cartsOf(game.state)[0]).toMatchObject({ barn: barn.id, farmer: 0, leg: 'load', load: {}, from: lodge.id, to: trip.to });
    game.advance(1);
    expect(lodge.state.waiting).toBe(0);
    // ...on the cart until unloaded, and only then in the stores.
    game.advance(unloadAt - 1 - game.now);
    expect(game.count('wood')).toBe(0);
    expect(cartsOf(game.state)[0]).toMatchObject({ leg: 'unload', load: { wood: 8 } });
    game.advance(1);
    expect(game.count('wood')).toBe(8);
    expect(cartsOf(game.state)[0]).toMatchObject({ leg: 'drive', load: {} });
    game.advance(parkAt - game.now);
    expect(cartsOf(game.state)[0]).toMatchObject({ leg: 'walk', load: {} });
    game.advance(job!.timer.start + job!.timer.duration - game.now);
    expect(cartsOf(game.state)[0]).toMatchObject({ leg: 'parked', farmer: 0 });
  });

  it('empties the yards before they fill, so the farmer working there keeps producing', () => {
    const game = farm(2);
    supply(game, 'woodcutter', X + 1, Y + 5);
    const lodge = build<ResourceState>(game, 'woodcutter', X + 1, Y + 5);
    assignFarmer(game, lodge.id, 1);
    barnWithCart(game, X + 4, Y + 5);
    build(game, 'storehouse', X + 4, Y + 12).state.level = 3;
    fed(game);
    let collects = 0;
    game.activity.on('workStarted', ({ kind }) => {
      if (kind === 'collect') collects++;
    });
    let produced = 0;
    game.activity.on('produced', ({ qty }) => (produced += qty));
    game.advance(3 * HOUR);
    expect(collects).toBe(0);
    expect(produced).toBeGreaterThanOrEqual(4 * 30);
    expect(lodge.state.waiting).toBeLessThan(YARD_CYCLES * 4);
    // Nothing was lost: what was made is in the stores (some burned as firewood), the yard or on the cart.
    const stored = game.count('wood') + lodge.state.waiting + (goodsOnCarts(game.state).wood ?? 0);
    expect(stored).toBeLessThanOrEqual(produced);
    expect(stored).toBeGreaterThan(produced - 40);
  });

  it('keeps what did not fit on the cart, parks it in the barn and delivers it once there is room', () => {
    const game = farm();
    const barn = barnWithCart(game);
    const lodge = yard(game, X + 1, Y + 5, 12);
    game.state.inventory.stone = FARMHOUSE_STORE.materials - 5;
    let hauled = 0;
    game.activity.on('hauled', ({ qty }) => (hauled += qty));
    game.advance(1);
    const trip = tripOf(game)!;
    game.advance(legEnds(trip)[3] - game.now);
    expect(game.count('wood')).toBe(5);
    expect(trip.load).toEqual({ wood: 7 });
    game.advance(legEnds(trip)[4] - game.now);
    expect(barn.state.cargo).toEqual({ wood: 7 });
    expect(barnWait(game, barn)).toMatchObject({ wait: 'stores-full' });
    game.advance(HOUR);
    game.removeItem('stone', 10);
    game.advance(1);
    const next = tripOf(game)!;
    expect(next.from).toBeNull();
    expect(barn.state.cargo).toEqual({});
    expect(next.load).toEqual({ wood: 7 });
    game.advance(HOUR);
    expect(hauled).toBe(12);
    expect(goodsOnCarts(game.state)).toEqual({});
    expect(lodge.state.waiting).toBe(0);
  });

  it('demolishing a barn puts the goods parked on its cart into the stores', () => {
    const game = farm();
    const barn = barnWithCart(game);
    barn.state.cargo = { wood: 7 };
    game.state.inventory.stone = FARMHOUSE_STORE.materials;
    expect(game.demolish(barn.id)).not.toBeNull();
    expect(game.count('wood')).toBe(7);
  });

  it('two carts share a yard instead of both driving for the same goods', () => {
    const game = farm(2);
    barnWithCart(game, X + 4, Y + 5);
    const b = build<BarnState>(game, OX_BARN, X + 8, Y + 5);
    buyOx(game, b, true);
    assignFarmer(game, b.id, 1);
    const lodge = yard(game, X + 1, Y + 5, 26);
    game.advance(1);
    const trips = tripsOf(game.state).map((t) => t.trip);
    expect(trips.map((t) => [t.from, t.planned])).toEqual([
      [lodge.id, 20],
      [lodge.id, 6],
    ]);
  });

  it('the carts hook lists every barn with an ox', () => {
    const game = farm();
    const barn = barnWithCart(game);
    expect(cartsOf(game.state)).toEqual([{ barn: barn.id, farmer: 0, leg: 'parked', at: expect.any(Object), load: {}, from: null, to: null }]);
  });
});

describe('the scheduler', () => {
  /** A busy farm: a staffed lodge and quarry, a barn with its cart, a storehouse. */
  function busy(): Game {
    const game = farm(3);
    supply(game, 'woodcutter', X + 1, Y + 5);
    supply(game, 'quarry', X + 8, Y + 5);
    const lodge = build(game, 'woodcutter', X + 1, Y + 5);
    const quarry = build(game, 'quarry', X + 8, Y + 5);
    assignFarmer(game, lodge.id, 1);
    assignFarmer(game, quarry.id, 2);
    barnWithCart(game, X + 4, Y + 5);
    const store = build(game, 'storehouse', X + 4, Y + 12);
    store.state.level = 3;
    fed(game);
    return game;
  }

  /** What the farm holds and where: stores, yards, carts and barns, and the carters' trips. */
  function snapshot(game: Game) {
    return {
      inventory: game.state.inventory,
      yards: game.state.objects.filter((o) => o.state.waiting !== undefined).map((o) => o.state.waiting),
      carts: cartsOf(game.state),
      onCarts: goodsOnCarts(game.state),
    };
  }

  it('offline catch-up and ×60 give the same farm as playing at ×1', () => {
    const live = busy();
    const away = new Game(deserialize(serialize(live.state)));
    const fast = new Game(deserialize(serialize(live.state)));
    play(live, 2 * HOUR);
    catchUp(away, 2 * HOUR);
    fast.state.clock.speed = 60;
    play(fast, (2 * HOUR) / 60, 100);
    expect(live.count('wood')).toBeGreaterThan(0);
    expect(snapshot(away)).toEqual(snapshot(live));
    expect(snapshot(fast)).toEqual(snapshot(live));
  });

  it('loading, unloading and parking are work events', () => {
    const game = farm();
    barnWithCart(game);
    yard(game, X + 1, Y + 5, 8);
    game.advance(1);
    const trip = tripOf(game)!;
    const ends = legEnds(trip);
    const events: number[] = [];
    while (game.now < ends[4]) {
      const next = nextWorkEvent(game);
      events.push(next);
      game.advance(next - game.now);
    }
    expect(events).toEqual(expect.arrayContaining([ends[1], ends[3], ends[4]]));
  });
});

describe('saves', () => {
  it('a version-12 save keeps its waiting output, now in the yard, and its farmer carries it in', () => {
    const game = farm();
    supply(game, 'woodcutter', X + 1, Y + 5);
    const lodge = build<ResourceState>(game, 'woodcutter', X + 1, Y + 5);
    assignFarmer(game, lodge.id, 0);
    lodge.state.waiting = 7;
    const raw = JSON.parse(serialize(game.state));
    raw.version = 12;
    const loaded = new Game(parseSave(JSON.stringify(raw)).state);
    expect(SAVE_VERSION).toBe(19);
    const obj = loaded.getObject(lodge.id)!;
    expect(obj.state.waiting).toBe(7);
    // Not full yet: the farmer works on, and the yard fills up and is carried in. Nothing was lost.
    let produced = 0;
    loaded.activity.on('produced', ({ qty }) => (produced += qty));
    loaded.advance(30 * MIN);
    expect(loaded.count('wood') + (obj.state.waiting as number)).toBeGreaterThanOrEqual(7 + produced - 10);
  });

  it('a trip under way survives a save and load', () => {
    const game = farm();
    barnWithCart(game);
    yard(game, X + 1, Y + 5, 8);
    game.advance(1);
    const trip = tripOf(game)!;
    game.advance(legEnds(trip)[1] - game.now);
    const loaded = new Game(deserialize(serialize(game.state)));
    expect(tripOf(loaded)?.load).toEqual({ wood: 8 });
    loaded.advance(HOUR);
    expect(loaded.count('wood')).toBe(8);
  });
});
