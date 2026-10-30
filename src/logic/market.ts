import { getItem } from '../data/items';
import type { ActivityEvents } from './activity';
import { DAY_MS } from './constants';
import type { Emitter } from './events';
import type { ClockState, Inventory, ItemId } from './types';

/** Daily prices swing between these multiples of the base price. */
export const PRICE_MIN_FACTOR = 0.8;
export const PRICE_MAX_FACTOR = 1.2;

/** FNV-1a string hash, finished with a murmur3-style mix so nearby days differ a lot. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Today's price multiplier for an item: in [0.8, 1.2], the same for every load of the same day. */
export function priceFactor(day: number, itemId: ItemId): number {
  const unit = hash(`${day}:${itemId}`) / 0x100000000;
  return PRICE_MIN_FACTOR + (PRICE_MAX_FACTOR - PRICE_MIN_FACTOR) * unit;
}

/**
 * Price of one unit on `day`, in whole dollars, or null for items outside the catalogue.
 * Rounded, then kept inside ±20% of the base price (so a $4 item always sells for $4).
 */
export function dailyPrice(day: number, itemId: ItemId): number | null {
  const item = getItem(itemId);
  if (!item) return null;
  const lo = Math.ceil(item.price * PRICE_MIN_FACTOR);
  const hi = Math.floor(item.price * PRICE_MAX_FACTOR);
  return Math.min(hi, Math.max(lo, Math.round(item.price * priceFactor(day, itemId))));
}

/** -1 below the base price, 0 at it, 1 above it. */
export function priceTrend(day: number, itemId: ItemId): -1 | 0 | 1 {
  const price = dailyPrice(day, itemId);
  const base = getItem(itemId)?.price;
  if (price === null || base === undefined) return 0;
  return price > base ? 1 : price < base ? -1 : 0;
}

/** Game milliseconds until the next day starts (and prices change). */
export function msUntilNextDay(clock: ClockState): number {
  return DAY_MS - (clock.elapsed % DAY_MS);
}

/** The parts of `Game` that selling needs. */
export interface Seller {
  readonly day: number;
  readonly state: { inventory: Inventory };
  count(itemId: ItemId): number;
  removeItem(itemId: ItemId, qty?: number): boolean;
  /** Sales are income: they give XP. */
  earnIncome(amount: number): void;
  readonly activity: Emitter<ActivityEvents>;
}

/**
 * Sells up to `qty` of an item at today's price (default: all of it).
 * Returns the money earned; 0 when there is nothing to sell or the item has no price.
 */
export function sell(game: Seller, itemId: ItemId, qty = game.count(itemId)): number {
  const price = dailyPrice(game.day, itemId);
  const n = Math.min(Math.floor(qty), game.count(itemId));
  if (price === null || !(n > 0)) return 0;
  if (!game.removeItem(itemId, n)) return 0;
  const total = n * price;
  game.earnIncome(total);
  game.activity.emit('sold', { item: itemId, qty: n, earned: total });
  return total;
}

/** Sells every sellable item in the inventory. Returns the total earned. */
export function sellAll(game: Seller): number {
  let total = 0;
  for (const itemId of Object.keys(game.state.inventory)) total += sell(game, itemId);
  return total;
}
