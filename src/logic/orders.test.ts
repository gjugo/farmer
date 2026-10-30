import { describe, expect, it } from 'vitest';
import { getItem, ITEMS } from '../data/items';
import { Game } from './game';
import { dailyPrice } from './market';
import {
  baseValue,
  createOrdersState,
  discardOrder,
  DISCARD_REFILL_MS,
  fulfilOrder,
  fulfillableCount,
  FULFIL_REFILL_MS,
  generateOrder,
  hasGoods,
  marketValue,
  ORDER_SLOTS,
  ordersOf,
  ORDERS_SLICE,
  refreshOrders,
  rewardBounds,
  updateOrders,
  type Order,
} from './orders';
import { deserialize, serialize } from './save';

function newGame(seed = 42): Game {
  const game = new Game();
  game.state.ext[ORDERS_SLICE] = { ...createOrdersState(seed), known: ['wheat'] };
  updateOrders(game.state);
  return game;
}

function openOrders(game: Game): Order[] {
  return ordersOf(game.state).slots.flatMap((s) => (s.order ? [s.order] : []));
}

/** Gives the game exactly the goods of `order`. */
function stock(game: Game, order: Order): void {
  for (const it of order.items) game.addItem(it.itemId, it.qty);
}

/** Advances game time by `ms` (at ×60 so ticks are big). */
function passTime(game: Game, ms: number): void {
  game.setSpeed(60);
  const step = 250 * 60;
  for (let t = 0; t < ms; t += step) game.tick(250);
  game.setSpeed(1);
}

describe('order generation', () => {
  it('starts a new game with 3 wheat orders', () => {
    const game = new Game();
    updateOrders(game.state);
    expect(ordersOf(game.state).known).toEqual(['wheat']);
    const orders = openOrders(game);
    expect(orders).toHaveLength(ORDER_SLOTS);
    for (const o of orders) expect(o.items.map((i) => i.itemId)).toEqual(['wheat']);
  });

  it('only ever asks for known goods (never feed)', () => {
    const s = createOrdersState(7);
    s.known = ['wheat', 'egg', 'feed', 'cheese'];
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const o = generateOrder(s);
      expect(o.items.length).toBeGreaterThanOrEqual(1);
      expect(o.items.length).toBeLessThanOrEqual(3);
      expect(new Set(o.items.map((it) => it.itemId)).size).toBe(o.items.length);
      for (const it of o.items) seen.add(it.itemId);
    }
    expect([...seen].sort()).toEqual(['cheese', 'egg', 'wheat']);
  });

  it('learns goods once they reach the inventory and then may order them', () => {
    const game = newGame();
    game.addItem('cheese', 1);
    updateOrders(game.state);
    expect(ordersOf(game.state).known).toContain('cheese');
    // Learned goods stay known after the inventory is empty again.
    game.removeItem('cheese', 1);
    updateOrders(game.state);
    expect(ordersOf(game.state).known).toContain('cheese');
    const s = ordersOf(game.state);
    const items = Array.from({ length: 200 }, () => generateOrder(s).items.map((i) => i.itemId)).flat();
    expect(items).toContain('cheese');
    expect(new Set(items)).toEqual(new Set(['wheat', 'cheese']));
  });

  it('scales quantities with value: raw goods up to 10, processed 1–3', () => {
    const s = createOrdersState(3);
    s.known = Object.keys(ITEMS);
    for (let i = 0; i < 500; i++) {
      for (const it of generateOrder(s).items) {
        const item = getItem(it.itemId)!;
        expect(it.qty).toBeGreaterThanOrEqual(1);
        expect(it.qty).toBeLessThanOrEqual(item.category === 'processed' ? 3 : 10);
        if (it.itemId === 'wheat') expect(it.qty).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('keeps rewards within 1.25–1.6× base value and above the market on any day', () => {
    const s = createOrdersState(11);
    s.known = Object.keys(ITEMS);
    for (let i = 0; i < 1000; i++) {
      const o = generateOrder(s);
      const base = baseValue(o.items);
      expect(Number.isInteger(o.reward)).toBe(true);
      expect(o.reward).toBeGreaterThanOrEqual(base * 1.25);
      expect(o.reward).toBeLessThanOrEqual(base * 1.6);
      const { min, max } = rewardBounds(o.items);
      expect(o.reward).toBeGreaterThanOrEqual(min);
      expect(o.reward).toBeLessThanOrEqual(max);
      for (const day of [1, 2, 3, 17]) expect(o.reward).toBeGreaterThan(marketValue(day, o.items));
    }
  });

  it('sums market value from today’s prices', () => {
    const items = [
      { itemId: 'wheat', qty: 5 },
      { itemId: 'milk', qty: 2 },
    ];
    expect(marketValue(4, items)).toBe(5 * dailyPrice(4, 'wheat')! + 2 * dailyPrice(4, 'milk')!);
    expect(baseValue(items)).toBe(5 * 4 + 2 * 18);
  });

  it('is deterministic for the same RNG state', () => {
    const a = createOrdersState(99);
    const b = createOrdersState(99);
    a.known = b.known = ['wheat', 'carrot', 'egg'];
    for (let i = 0; i < 20; i++) expect(generateOrder(a)).toEqual(generateOrder(b));
  });
});

describe('fulfil and discard', () => {
  it('refuses without the goods and changes nothing', () => {
    const game = newGame();
    const [order] = openOrders(game);
    expect(fulfillableCount(game.state)).toBe(0);
    game.addItem('wheat', order.items[0].qty - 1);
    expect(hasGoods(game.state.inventory, order)).toBe(false);
    expect(fulfilOrder(game, 0)).toBeNull();
    expect(game.money).toBe(500);
    expect(game.count('wheat')).toBe(order.items[0].qty - 1);
    expect(ordersOf(game.state).slots[0].order).toEqual(order);
    game.addItem('wheat', 1);
    expect(fulfillableCount(game.state)).toBeGreaterThanOrEqual(1);
  });

  it('removes exactly the goods and pays exactly the reward through earn', () => {
    const game = newGame();
    game.addItem('egg', 1);
    updateOrders(game.state);
    const order: Order = {
      id: 999,
      customer: 'Test',
      items: [
        { itemId: 'wheat', qty: 6 },
        { itemId: 'egg', qty: 3 },
      ],
      reward: 70,
    };
    ordersOf(game.state).slots[1] = { order, refill: null };
    game.addItem('wheat', 10);
    game.addItem('egg', 4);
    const deltas: number[] = [];
    game.events.on('money', ({ delta }) => deltas.push(delta));
    const fulfilled: number[] = [];
    game.activity.on('orderFulfilled', ({ reward }) => fulfilled.push(reward));

    expect(fulfillableCount(game.state)).toBeGreaterThanOrEqual(1);
    expect(fulfilOrder(game, 1)).toBe(70);
    expect(fulfilled).toEqual([70]);
    expect(game.money).toBe(570);
    expect(deltas).toEqual([70]);
    expect(game.count('wheat')).toBe(4);
    expect(game.count('egg')).toBe(2);
    const slot = ordersOf(game.state).slots[1];
    expect(slot.order).toBeNull();
    expect(slot.reason).toBe('fulfilled');
    // A second click does nothing.
    expect(fulfilOrder(game, 1)).toBeNull();
    expect(game.money).toBe(570);
    expect(fulfilled).toEqual([70]);
    // Order rewards are income: 1 XP per $1.
    expect(game.progression.xp).toBe(70);
  });

  it('refills a fulfilled slot after 2 game-minutes', () => {
    const game = newGame();
    const [order] = openOrders(game);
    stock(game, order);
    fulfilOrder(game, 0);
    passTime(game, FULFIL_REFILL_MS - 30_000);
    updateOrders(game.state);
    expect(ordersOf(game.state).slots[0].order).toBeNull();
    passTime(game, 30_000);
    updateOrders(game.state);
    const fresh = ordersOf(game.state).slots[0].order;
    expect(fresh).not.toBeNull();
    expect(fresh!.id).not.toBe(order.id);
  });

  it('discards for free and refills after 5 game-minutes', () => {
    const game = newGame();
    const before = JSON.stringify(game.state.inventory);
    expect(discardOrder(game.state, 2)).toBe(true);
    expect(game.money).toBe(500);
    expect(JSON.stringify(game.state.inventory)).toBe(before);
    expect(ordersOf(game.state).slots[2].reason).toBe('discarded');
    expect(discardOrder(game.state, 2)).toBe(false);
    passTime(game, FULFIL_REFILL_MS);
    updateOrders(game.state);
    expect(ordersOf(game.state).slots[2].order).toBeNull();
    passTime(game, DISCARD_REFILL_MS - FULFIL_REFILL_MS);
    updateOrders(game.state);
    expect(ordersOf(game.state).slots[2].order).not.toBeNull();
  });

  it('debug refresh fills every slot now', () => {
    const game = newGame();
    discardOrder(game.state, 0);
    const ids = openOrders(game).map((o) => o.id);
    refreshOrders(game.state);
    const fresh = openOrders(game);
    expect(fresh).toHaveLength(ORDER_SLOTS);
    for (const o of fresh) expect(ids).not.toContain(o.id);
  });
});

describe('orders save data', () => {
  it('keeps orders, countdowns, known goods and the RNG across a reload', () => {
    const game = newGame(5);
    game.addItem('milk', 2);
    updateOrders(game.state);
    discardOrder(game.state, 1);
    passTime(game, 60_000);
    const loaded = new Game(deserialize(serialize(game.state)));
    expect(ordersOf(loaded.state)).toEqual(ordersOf(game.state));
    updateOrders(loaded.state);
    updateOrders(game.state);
    expect(ordersOf(loaded.state)).toEqual(ordersOf(game.state));
    // The next roll is the same too.
    expect(generateOrder(ordersOf(loaded.state))).toEqual(generateOrder(ordersOf(game.state)));
  });

  it('migrates a version-1 save: known goods = its inventory, 3 fresh orders', () => {
    const v1 = JSON.stringify({ version: 1, savedAt: 0, state: { money: 900, inventory: { cheese: 2, egg: 5 }, ext: { market: {} } } });
    const state = deserialize(v1);
    expect(state.money).toBe(900);
    updateOrders(state);
    const orders = ordersOf(state);
    expect(orders.known.sort()).toEqual(['cheese', 'egg']);
    expect(orders.slots.every((s) => s.order)).toBe(true);
    for (const s of orders.slots) for (const it of s.order!.items) expect(['cheese', 'egg']).toContain(it.itemId);
  });

  it('repairs malformed order data', () => {
    const raw = JSON.parse(serialize(newGame().state));
    raw.state.ext.orders = { known: ['wheat', 42, 'nope'], rng: 'x', slots: [{ order: { id: 1, items: [] } }, 'junk'] };
    const state = deserialize(JSON.stringify(raw));
    updateOrders(state);
    const orders = ordersOf(state);
    expect(orders.known).toEqual(['wheat']);
    expect(orders.slots).toHaveLength(ORDER_SLOTS);
    expect(orders.slots.every((s) => s.order)).toBe(true);
  });
});
