import { describe, expect, it } from 'vitest';
import { ITEM_LIST, ITEMS } from '../data/items';
import { DAY_MS } from './constants';
import { Game } from './game';
import { maxLevelState } from './test-utils';
import { dailyPrice, msUntilNextDay, priceFactor, priceTrend, sell, sellAll } from './market';
import { deserialize, serialize } from './save';

/** A max-level farm on `day` with an empty inventory. */
function gameOnDay(day: number): Game {
  const state = maxLevelState();
  state.inventory = {};
  state.clock.elapsed = (day - 1) * DAY_MS + 1000;
  return new Game(state);
}

describe('daily prices', () => {
  it('keeps every factor and price within ±20% of the base price', () => {
    for (let day = 1; day <= 200; day++) {
      for (const item of ITEM_LIST) {
        const f = priceFactor(day, item.id);
        expect(f).toBeGreaterThanOrEqual(0.8);
        expect(f).toBeLessThanOrEqual(1.2);
        const price = dailyPrice(day, item.id)!;
        expect(Number.isInteger(price)).toBe(true);
        expect(price).toBeGreaterThanOrEqual(item.price * 0.8);
        expect(price).toBeLessThanOrEqual(item.price * 1.2);
      }
    }
  });

  it('is deterministic for the same day and item', () => {
    expect(priceFactor(7, 'milk')).toBe(priceFactor(7, 'milk'));
    expect(dailyPrice(7, 'cheese')).toBe(dailyPrice(7, 'cheese'));
  });

  it('changes between days', () => {
    const cheese = new Set(Array.from({ length: 10 }, (_, i) => dailyPrice(i + 1, 'cheese')));
    expect(cheese.size).toBeGreaterThan(3);
    // Consecutive days give a different price list overall.
    const list = (day: number) => ITEM_LIST.map((i) => dailyPrice(day, i.id)).join(',');
    for (let day = 1; day < 30; day++) expect(list(day)).not.toBe(list(day + 1));
  });

  it('differs between items on the same day', () => {
    const factors = new Set(ITEM_LIST.map((i) => priceFactor(3, i.id)));
    expect(factors.size).toBe(ITEM_LIST.length);
  });

  it('spreads factors over the whole range', () => {
    const fs = Array.from({ length: 500 }, (_, d) => priceFactor(d + 1, 'cloth'));
    expect(Math.min(...fs)).toBeLessThan(0.85);
    expect(Math.max(...fs)).toBeGreaterThan(1.15);
  });

  it('has no price for unknown items', () => {
    expect(dailyPrice(1, 'unobtainium')).toBeNull();
    expect(priceTrend(1, 'unobtainium')).toBe(0);
  });

  it('reports the trend against the base price', () => {
    for (let day = 1; day <= 50; day++) {
      const price = dailyPrice(day, 'cheese')!;
      expect(priceTrend(day, 'cheese')).toBe(Math.sign(price - ITEMS.cheese.price));
    }
  });

  it('is the same after a save/load on the same day', () => {
    const game = gameOnDay(4);
    const loaded = new Game(deserialize(serialize(game.state)));
    expect(loaded.day).toBe(4);
    for (const item of ITEM_LIST) expect(dailyPrice(loaded.day, item.id)).toBe(dailyPrice(game.day, item.id));
  });

  it('counts down to the next day', () => {
    const game = gameOnDay(2);
    expect(msUntilNextDay(game.state.clock)).toBe(DAY_MS - 1000);
    game.state.clock.elapsed = DAY_MS;
    expect(msUntilNextDay(game.state.clock)).toBe(DAY_MS);
  });
});

describe('selling', () => {
  it('sell 1 adds exactly today’s price', () => {
    const game = gameOnDay(5);
    game.addItem('milk', 10);
    const price = dailyPrice(5, 'milk')!;
    expect(sell(game, 'milk', 1)).toBe(price);
    expect(game.money).toBe(500 + price);
    expect(game.count('milk')).toBe(9);
  });

  it('sell all adds count × today’s price', () => {
    const game = gameOnDay(9);
    game.addItem('egg', 10);
    const price = dailyPrice(9, 'egg')!;
    expect(sell(game, 'egg')).toBe(10 * price);
    expect(game.money).toBe(500 + 10 * price);
    expect(game.count('egg')).toBe(0);
    expect(game.state.inventory).not.toHaveProperty('egg');
  });

  it('never sells more than there is', () => {
    const game = gameOnDay(1);
    game.addItem('corn', 3);
    expect(sell(game, 'corn', 50)).toBe(3 * dailyPrice(1, 'corn')!);
    expect(game.count('corn')).toBe(0);
    expect(sell(game, 'corn', 1)).toBe(0);
    expect(game.count('corn')).toBe(0);
    expect(game.money).toBe(500 + 3 * dailyPrice(1, 'corn')!);
  });

  it('ignores zero, negative and fractional quantities safely', () => {
    const game = gameOnDay(1);
    game.addItem('wool', 2);
    expect(sell(game, 'wool', 0)).toBe(0);
    expect(sell(game, 'wool', -4)).toBe(0);
    expect(sell(game, 'wool', 1.7)).toBe(dailyPrice(1, 'wool'));
    expect(game.count('wool')).toBe(1);
  });

  it('does not sell items without a price', () => {
    const game = gameOnDay(1);
    game.addItem('unobtainium', 2);
    expect(sell(game, 'unobtainium')).toBe(0);
    expect(game.count('unobtainium')).toBe(2);
    expect(game.money).toBe(500);
  });

  it('sell everything sells every item at today’s price', () => {
    const game = gameOnDay(12);
    game.addItem('wheat', 10);
    game.addItem('cheese', 2);
    const expected = 10 * dailyPrice(12, 'wheat')! + 2 * dailyPrice(12, 'cheese')!;
    expect(sellAll(game)).toBe(expected);
    expect(game.money).toBe(500 + expected);
    expect(game.state.inventory).toEqual({});
  });

  it('emits money and inventory events', () => {
    const game = gameOnDay(1);
    game.addItem('butter', 4);
    const money: number[] = [];
    const inv: number[] = [];
    game.events.on('money', (e) => money.push(e.delta));
    game.events.on('inventory', (e) => inv.push(e.delta));
    sell(game, 'butter', 2);
    expect(money).toEqual([2 * dailyPrice(1, 'butter')!]);
    expect(inv).toEqual([-2]);
  });
});
