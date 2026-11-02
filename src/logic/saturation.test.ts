import { describe, expect, it } from 'vitest';
import { ITEM_LIST } from '../data/items';
import { DAY_MS } from './constants';
import { Game } from './game';
import {
  allowance,
  buyPrice,
  clearDrops,
  currentPrice,
  dailyPrice,
  DROP_PER_UNIT,
  droppedPrice,
  farmSellPrice,
  MAX_DROP,
  marketOf,
  marketPrices,
  priceDrop,
  quoteSale,
  quoteSellAll,
  recoverDrop,
  sell,
  sellAll,
} from './market';
import { catchUp } from './offline';
import { perksOf } from './perks';
import { deserialize, serialize } from './save';
import { maxLevelState } from './test-utils';

/** A max-level farm on `day` with an empty inventory and room for plenty. */
function gameOnDay(day: number): Game {
  const state = maxLevelState();
  state.inventory = {};
  state.clock.elapsed = (day - 1) * DAY_MS + 1000;
  const game = new Game(state);
  game.spaceFor = () => Infinity;
  return game;
}

/** Puts `qty` of an item in the inventory, whatever the storage. */
function stock(game: Game, id: string, qty: number): void {
  game.state.inventory[id] = (game.state.inventory[id] ?? 0) + qty;
}

describe('market saturation', () => {
  it('gives each item a daily allowance worth about $150 at its base price', () => {
    expect(allowance('wheat')).toBe(37);
    expect(allowance('cheese')).toBe(3);
    for (const item of ITEM_LIST) {
      expect(allowance(item.id) * item.price).toBeLessThanOrEqual(150);
      expect((allowance(item.id) + 1) * item.price).toBeGreaterThan(150);
    }
  });

  it('pays the day’s price within the allowance, and nothing drops', () => {
    const game = gameOnDay(3);
    stock(game, 'wheat', 37);
    const price = dailyPrice(3, 'wheat')!;
    expect(sell(game, 'wheat')).toBe(37 * price);
    expect(priceDrop(game.state, 'wheat')).toBe(0);
    expect(currentPrice(game.state, 'wheat')).toBe(price);
  });

  it('lowers the price 1% for every unit sold past the allowance', () => {
    const game = gameOnDay(3);
    stock(game, 'cheese', 13);
    sell(game, 'cheese', 3);
    expect(priceDrop(game.state, 'cheese')).toBe(0);
    sell(game, 'cheese', 10);
    expect(marketOf(game.state).drops.cheese).toBe(10 * DROP_PER_UNIT);
    expect(priceDrop(game.state, 'cheese')).toBeCloseTo(0.1);
    expect(currentPrice(game.state, 'cheese')).toBe(Math.round(dailyPrice(3, 'cheese')! * 0.9));
  });

  it('pays the falling price unit by unit, the same in one sale or many', () => {
    const one = gameOnDay(7);
    const many = gameOnDay(7);
    stock(one, 'milk', 40);
    stock(many, 'milk', 40);
    const quote = quoteSale(one.state, 'milk', 40)!;
    expect(sell(one, 'milk', 40)).toBe(quote.total);
    let total = 0;
    for (let i = 0; i < 40; i++) total += sell(many, 'milk', 1);
    expect(total).toBe(quote.total);
    expect(marketOf(many.state).drops).toEqual(marketOf(one.state).drops);
    // Units past the allowance fetch less than the day's price.
    expect(quote.total).toBeLessThan(40 * dailyPrice(7, 'milk')!);
    expect(quote.floods).toBe(true);
  });

  it('stops at half the day’s price', () => {
    const game = gameOnDay(2);
    stock(game, 'wheat', 500);
    const price = dailyPrice(2, 'wheat')!;
    // Unit i (from 0) sells at the drop the units before it past the allowance (37) made, never past the floor.
    let expected = 0;
    for (let i = 0; i < 500; i++) expected += droppedPrice(price, Math.min(MAX_DROP, DROP_PER_UNIT * Math.max(0, i - 37)));
    expect(sell(game, 'wheat')).toBe(expected);
    expect(marketOf(game.state).drops.wheat).toBe(MAX_DROP);
    expect(priceDrop(game.state, 'wheat')).toBe(0.5);
    expect(currentPrice(game.state, 'wheat')).toBe(droppedPrice(dailyPrice(2, 'wheat')!, MAX_DROP));
    expect(currentPrice(game.state, 'wheat')).toBeGreaterThanOrEqual(Math.floor(dailyPrice(2, 'wheat')! / 2));
  });

  it('selling 150 wheat drops its price', () => {
    const game = gameOnDay(5);
    stock(game, 'wheat', 150);
    const before = currentPrice(game.state, 'wheat')!;
    sell(game, 'wheat');
    expect(currentPrice(game.state, 'wheat')!).toBeLessThan(before);
    expect(priceDrop(game.state, 'wheat')).toBe(0.5); // 113 past the allowance of 37: the floor
  });

  it('recovers a quarter of the drop each new day, and the allowance starts again', () => {
    const game = gameOnDay(4);
    stock(game, 'cheese', 43);
    sell(game, 'cheese'); // 40 past the allowance
    expect(marketOf(game.state).drops.cheese).toBe(4000);
    game.state.clock.elapsed += DAY_MS;
    expect(marketOf(game.state).drops.cheese).toBe(3000);
    expect(marketOf(game.state).sold).toEqual({});
    game.state.clock.elapsed += 2 * DAY_MS;
    expect(marketOf(game.state).drops.cheese).toBe(recoverDrop(recoverDrop(3000)));
    // Long enough, and it is gone.
    game.state.clock.elapsed += 60 * DAY_MS;
    expect(marketOf(game.state).drops).toEqual({});
  });

  it('recovers the same whenever it is looked at', () => {
    const daily = gameOnDay(1);
    const once = gameOnDay(1);
    for (const g of [daily, once]) {
      stock(g, 'egg', 60);
      sell(g, 'egg');
    }
    for (let d = 0; d < 5; d++) {
      daily.state.clock.elapsed += DAY_MS;
      marketOf(daily.state);
    }
    once.state.clock.elapsed += 5 * DAY_MS;
    expect(marketOf(once.state)).toEqual(marketOf(daily.state));
  });

  it('never pays more than the Market charges, whatever is sold', () => {
    for (let day = 1; day <= 60; day++) {
      const game = gameOnDay(day);
      for (const id of ['wood', 'stone', 'iron']) {
        stock(game, id, 5);
        const buy = buyPrice(day, id)!;
        expect(currentPrice(game.state, id)!).toBeLessThan(buy);
        expect(sell(game, id, 5)).toBeLessThan(5 * buy);
      }
    }
  });

  it('quotes sell-everything at the falling prices, and sells for exactly that', () => {
    const game = gameOnDay(6);
    stock(game, 'wheat', 120);
    stock(game, 'egg', 4);
    stock(game, 'wood', 30); // kept for building
    const quote = quoteSellAll(game.state);
    expect(quote.floods).toEqual(['wheat']);
    expect(quote.total).toBe(quoteSale(game.state, 'wheat', 120)!.total + 4 * dailyPrice(6, 'egg')!);
    expect(sellAll(game)).toBe(quote.total);
    expect(game.count('wood')).toBe(30);
  });

  it('is saved, and a load gives the same prices', () => {
    const game = gameOnDay(3);
    stock(game, 'corn', 60);
    sell(game, 'corn');
    const loaded = new Game(deserialize(serialize(game.state)));
    expect(marketPrices(loaded.state)).toEqual(marketPrices(game.state));
    expect(priceDrop(loaded.state, 'corn')).toBeGreaterThan(0);
  });

  it('offline catch-up gives the same prices as playing through', () => {
    const played = gameOnDay(2);
    const caught = gameOnDay(2);
    for (const g of [played, caught]) {
      stock(g, 'wheat', 90);
      sell(g, 'wheat');
    }
    const away = 3 * DAY_MS + 5000;
    for (let t = 0; t < away; t += 250) {
      played.tick(250);
      marketPrices(played.state); // the Market panel reads prices every frame
    }
    catchUp(caught, away);
    expect(caught.day).toBe(played.day);
    expect(marketPrices(caught.state)).toEqual(marketPrices(played.state));
    expect(marketOf(caught.state)).toEqual(marketOf(played.state));
  });

  it('×60 gives the same prices as ×1', () => {
    const slow = gameOnDay(1);
    const fast = gameOnDay(1);
    for (const g of [slow, fast]) {
      stock(g, 'milk', 50);
      sell(g, 'milk');
    }
    fast.setSpeed(60);
    for (let t = 0; t < 2 * DAY_MS; t += 250) slow.tick(250);
    for (let t = 0; t < (2 * DAY_MS) / 60; t += 250) fast.tick(250);
    expect(fast.now).toBe(slow.now);
    expect(marketOf(fast.state)).toEqual(marketOf(slow.state));
  });

  it('applies after the Haggler perk: the drop comes off the boosted price', () => {
    const game = gameOnDay(8);
    perksOf(game.state).taken = [{ level: 2, id: 'haggler' }];
    const boosted = farmSellPrice(game.state, 8, 'cheese')!;
    expect(boosted).toBeGreaterThan(dailyPrice(8, 'cheese')!);
    stock(game, 'cheese', 23);
    sell(game, 'cheese'); // 20 past the allowance
    expect(currentPrice(game.state, 'cheese')).toBe(droppedPrice(boosted, 2000));
  });

  it('clears every drop for the debug button', () => {
    const game = gameOnDay(1);
    stock(game, 'wheat', 100);
    sell(game, 'wheat');
    clearDrops(game.state);
    expect(priceDrop(game.state, 'wheat')).toBe(0);
    expect(currentPrice(game.state, 'wheat')).toBe(dailyPrice(1, 'wheat'));
  });

  it('repairs a malformed saved slice', () => {
    const game = gameOnDay(1);
    game.state.ext.market = { day: 'x', drops: { wheat: 99999, egg: -3, corn: 1.5 }, sold: null };
    const m = marketOf(game.state);
    expect(m.drops).toEqual({ wheat: MAX_DROP });
    expect(m.sold).toEqual({});
  });
});
