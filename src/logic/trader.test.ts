import { describe, expect, it } from 'vitest';
import { ANIMALS } from '../data/animals';
import { getItem } from '../data/items';
import { MATERIAL_IDS, MATERIAL_UNLOCK } from '../data/materials';
import { SEASON_DAYS } from '../data/seasons';
import { DAY_MS } from './constants';
import { Game } from './game';
import { buyPrice, PRICE_MAX_FACTOR } from './market';
import { catchUp } from './offline';
import { objectAt } from './placement';
import { doorOf, farmhouseOf } from './roads';
import { deserialize, serialize } from './save';
import { maxLevelState } from './test-utils';
import {
  buyFromTrader,
  dayStart,
  generateOffers,
  isTraderDay,
  makeableGoods,
  nextTraderDay,
  parkingSpot,
  sellToTrader,
  traderHere,
  traderInfo,
  traderNow,
  traderOf,
  updateTrader,
  VISIT_BLOCK_DAYS,
  WANT_MAX_FACTOR,
  WANT_MIN_FACTOR,
} from './trader';
import { footprintOf } from './game';
import type { PlacedObject } from './types';
import type { PenState } from './animals';

const SEED = 12345;

/** A farm at `level` with the trader seed fixed, at the start (+1 s) of `day`. */
function farm(level: number, day = 1): Game {
  const state = maxLevelState();
  state.inventory = {};
  state.clock.elapsed = dayStart(day) + 1000;
  const game = new Game(state);
  game.progression.setLevel(level);
  traderOf(game.state).seed = SEED;
  return game;
}

/** Moves the clock to game time `t` (nothing else happens on the way). */
function jumpTo(game: Game, t: number): void {
  game.state.clock.elapsed = t;
}

describe('trader schedule', () => {
  it('has exactly one trader day in every block, so about twice a season', () => {
    for (const seed of [1, SEED, 0xdeadbeef]) {
      for (let block = 0; block < 50; block++) {
        const days = Array.from({ length: VISIT_BLOCK_DAYS }, (_, i) => block * VISIT_BLOCK_DAYS + i + 1).filter((d) => isTraderDay(seed, d));
        expect(days).toHaveLength(1);
      }
      const perSeason = Array.from({ length: SEASON_DAYS * 10 }, (_, i) => i + 1).filter((d) => isTraderDay(seed, d)).length / 10;
      expect(perSeason).toBe(2);
    }
  });

  it('follows from the seed and the day alone', () => {
    const days = (seed: number) => Array.from({ length: 80 }, (_, i) => i + 1).filter((d) => isTraderDay(seed, d));
    expect(days(SEED)).toEqual(days(SEED));
    expect(days(SEED)).not.toEqual(days(SEED + 1));
    expect(generateOffers(SEED, 9, 5)).toEqual(generateOffers(SEED, 9, 5));
  });

  it('keeps its seed across a save and load, so a reload never rerolls him', () => {
    const game = farm(4);
    const day = nextTraderDay(SEED, 2);
    jumpTo(game, dayStart(day) + 5000);
    updateTrader(game);
    const visit = structuredClone(traderHere(game.state));
    expect(visit).not.toBeNull();
    const loaded = new Game(deserialize(serialize(game.state)));
    expect(traderOf(loaded.state).seed).toBe(SEED);
    expect(traderHere(loaded.state)).toEqual(visit);
    expect(updateTrader(loaded).arrived).toBeNull(); // already here: no second arrival
  });

  it('comes from level 3 only', () => {
    const day = nextTraderDay(SEED, 2);
    const low = farm(2, day - 1);
    updateTrader(low);
    jumpTo(low, dayStart(day) + 1000);
    expect(updateTrader(low).arrived).toBeNull();
    expect(traderHere(low.state)).toBeNull();
    expect(traderInfo(low)).toMatchObject({ here: false, arrivesAt: null, leavesAt: null });
  });

  it('is announced the day before, arrives for one day and leaves', () => {
    // A trader day whose day before has none.
    let day = nextTraderDay(SEED, 3);
    while (isTraderDay(SEED, day - 1)) day = nextTraderDay(SEED, day + 1);
    const game = farm(3, day - 1);
    expect(updateTrader(game).announced).toBe(day);
    expect(updateTrader(game).announced).toBeNull(); // once
    expect(traderInfo(game)).toMatchObject({ here: false, arrivesAt: dayStart(day), leavesAt: dayStart(day + 1) });
    jumpTo(game, dayStart(day));
    const r = updateTrader(game);
    expect(r.arrived?.day).toBe(day);
    expect(traderInfo(game).here).toBe(true);
    expect(traderInfo(game).wants.length).toBeGreaterThanOrEqual(2);
    jumpTo(game, dayStart(day + 1));
    expect(updateTrader(game).left?.day).toBe(day);
    expect(traderHere(game.state)).toBeNull();
  });

  it('×60 sees the same traders as ×1', () => {
    const slow = farm(3);
    const fast = farm(3);
    fast.setSpeed(60);
    const arrived = (g: Game, frames: number) => {
      const days: number[] = [];
      for (let i = 0; i < frames; i++) {
        g.tick(250);
        const r = updateTrader(g);
        if (r.arrived) days.push(r.arrived.day);
      }
      return days;
    };
    const span = 6 * DAY_MS;
    expect(arrived(fast, span / 250 / 60)).toEqual(arrived(slow, span / 250));
    expect(traderOf(fast.state)).toEqual(traderOf(slow.state));
  });

  it('a trader due while the player is away comes and goes without trading', () => {
    const game = farm(3);
    updateTrader(game);
    const r = catchUp(game, 6 * DAY_MS);
    const due = Array.from({ length: 6 }, (_, i) => i + 2).filter((d) => isTraderDay(SEED, d)).length;
    expect(due).toBeGreaterThan(0);
    expect(r.traders.missed).toBe(due);
    // Today's one (if any) stays out of reach: no wagon, no trading.
    expect(traderHere(game.state)).toBeNull();
    game.addItem('wheat', 10);
    expect(sellToTrader(game, 0, 1)).toEqual({ ok: false, reason: 'gone' });
  });

  it('a debug jump (not away) lets a trader due on the way arrive as in play', () => {
    const day = nextTraderDay(SEED, 3);
    const game = farm(3, day - 1);
    updateTrader(game);
    const r = catchUp(game, dayStart(day) + 10 - game.now, { away: false });
    expect(r.traders.missed).toBe(0);
    // The next frame brings him, announced as in play.
    expect(updateTrader(game).arrived?.day).toBe(day);
    expect(traderHere(game.state)?.day).toBe(day);
  });
});

describe('trader offers', () => {
  it('wants only goods the farm can make at its level, at +40–80%', () => {
    for (const level of [3, 4, 5]) {
      const makeable = makeableGoods(level);
      for (let day = 1; day <= 60; day++) {
        const { wants } = generateOffers(SEED, day, level);
        expect(wants.length).toBeGreaterThanOrEqual(2);
        expect(wants.length).toBeLessThanOrEqual(3);
        expect(new Set(wants.map((w) => w.item)).size).toBe(wants.length);
        for (const w of wants) {
          expect(makeable).toContain(w.item);
          const base = getItem(w.item)!.price;
          expect(w.price).toBeGreaterThanOrEqual(base * WANT_MIN_FACTOR);
          expect(w.price).toBeLessThanOrEqual(base * WANT_MAX_FACTOR);
          expect(w.left).toBeGreaterThan(0);
        }
      }
    }
    // Level 3 makes no corn, wool or cloth yet.
    expect(makeableGoods(3)).not.toContain('corn');
    expect(makeableGoods(3)).not.toContain('wool');
    expect(makeableGoods(3)).not.toContain('cloth');
    expect(makeableGoods(3)).not.toContain('feed');
  });

  it('sells only unlocked things, materials below the Market and never at a profit', () => {
    for (const level of [3, 4, 5]) {
      for (let day = 1; day <= 60; day++) {
        const { sells } = generateOffers(SEED, day, level);
        expect(sells.length).toBeGreaterThanOrEqual(2);
        expect(sells.length).toBeLessThanOrEqual(3);
        for (const offer of sells) {
          expect(offer.left).toBeGreaterThan(0);
          if ('animal' in offer) {
            expect(ANIMALS[offer.animal].unlockLevel).toBeLessThanOrEqual(level);
            expect(offer.price).toBe(Math.round(ANIMALS[offer.animal].price * 0.75));
            continue;
          }
          // Whatever he sells, the Market never pays more for it.
          expect(offer.price).toBeGreaterThanOrEqual(Math.floor(getItem(offer.item)!.price * PRICE_MAX_FACTOR));
          if ((MATERIAL_IDS as readonly string[]).includes(offer.item)) {
            expect(MATERIAL_UNLOCK[offer.item as keyof typeof MATERIAL_UNLOCK]).toBeLessThanOrEqual(level);
            expect(offer.price).toBeLessThan(buyPrice(day, offer.item)!);
          } else expect(offer.item).toBe('feed');
        }
      }
    }
    // Sheep come at level 5.
    const animalsAt3 = Array.from({ length: 60 }, (_, d) => generateOffers(SEED, d + 1, 3).sells).flat().flatMap((o) => ('animal' in o ? [o.animal] : []));
    expect(animalsAt3).not.toContain('sheep');
  });
});

describe('trading', () => {
  it('buys wanted goods up to his quantity, at his price, as income', () => {
    const game = farm(5);
    const visit = traderNow(game);
    const want = visit.wants[0];
    const wanted = want.left;
    game.state.inventory[want.item] = wanted + 10;
    const before = game.money;
    let xp = 0;
    game.activity.on('income', ({ amount }) => (xp += amount));
    expect(sellToTrader(game, 0, 1000)).toEqual({ ok: true, qty: wanted, money: wanted * want.price });
    expect(game.count(want.item)).toBe(10);
    expect(game.money).toBe(before + wanted * want.price);
    expect(xp).toBe(wanted * want.price);
    expect(traderHere(game.state)!.wants[0].left).toBe(0);
    expect(sellToTrader(game, 0, 1)).toEqual({ ok: false, reason: 'sold-out' });
  });

  it('sells to him are not saturated: the last unit pays the same as the first', () => {
    const game = farm(5);
    const visit = traderNow(game);
    const i = visit.wants.findIndex((w) => w.left >= 5);
    const want = visit.wants[i];
    game.state.inventory[want.item] = 200;
    const first = sellToTrader(game, i, 1);
    const rest = sellToTrader(game, i, want.left);
    expect(first.ok && rest.ok && rest.money / rest.qty).toBe(want.price);
  });

  it('limits purchases to his stock, the money and the room in storage', () => {
    const game = farm(5);
    const visit = traderNow(game);
    visit.sells = [{ item: 'wood', price: 4, left: 20 }, { item: 'feed', price: 4, left: 30 }];
    game.earn(10_000);
    // Stock.
    let r = buyFromTrader(game, 0, 50);
    expect(r).toEqual({ ok: true, qty: 20, money: 80 });
    expect(buyFromTrader(game, 0, 1)).toEqual({ ok: false, reason: 'sold-out' });
    // Room: the granary takes only 7 more.
    game.spaceFor = (id) => (id === 'feed' ? 7 : 0);
    r = buyFromTrader(game, 1, 30);
    expect(r).toEqual({ ok: true, qty: 7, money: 28 });
    expect(traderHere(game.state)!.sells[1].left).toBe(23);
    game.spaceFor = () => 0;
    expect(buyFromTrader(game, 1, 5)).toEqual({ ok: false, reason: 'full' });
    // Money.
    game.spaceFor = () => 100;
    game.spend(game.money - 9);
    expect(buyFromTrader(game, 1, 10)).toEqual({ ok: true, qty: 2, money: 8 });
    expect(buyFromTrader(game, 1, 10)).toEqual({ ok: false, reason: 'money' });
  });

  it('puts a bought animal in a pen with room, and needs one', () => {
    const game = farm(5);
    const visit = traderNow(game);
    visit.sells = [{ animal: 'chicken', price: 45, left: 2 }];
    expect(buyFromTrader(game, 0, 1)).toEqual({ ok: false, reason: 'no-pen' });
    const { width, height } = game.state.land;
    const spots = Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width) }));
    const spot = spots.find((t) => game.checkPlacement('coop', t.x, t.y).ok)!;
    game.state.inventory.wood = 20;
    const placed = game.place('coop', spot.x, spot.y);
    expect(placed.ok).toBe(true);
    const coop = (placed as unknown as { object: PlacedObject<PenState> }).object;
    expect(buyFromTrader(game, 0, 5)).toEqual({ ok: true, qty: 2, money: 90 });
    expect(coop.state.animals).toHaveLength(2);
  });

  it('counts for the trade goal', () => {
    const game = farm(5);
    const visit = traderNow(game);
    const events: string[] = [];
    game.activity.on('traded', ({ kind }) => events.push(kind));
    game.state.inventory[visit.wants[0].item] = 1;
    sellToTrader(game, 0, 1);
    expect(events).toEqual(['sell']);
  });

  it('parks next to the farmhouse door on free land, or on the nearest path', () => {
    const game = farm(5);
    const house = farmhouseOf(game.state)!;
    const door = doorOf(house);
    const spot = parkingSpot(game.state)!;
    expect(Math.abs(spot.x - door.x) + Math.abs(spot.y - door.y)).toBe(1);
    expect(objectAt(game.state, spot.x, spot.y, footprintOf)).toBeUndefined();
    const visit = traderNow(game);
    expect(visit.tile).toEqual(spot);
  });
});
