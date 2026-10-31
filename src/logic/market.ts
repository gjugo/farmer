import { getItem } from '../data/items';
import { isMaterial, MATERIAL_UNLOCK } from '../data/materials';
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

/** Buy prices swing between these multiples of the base price, moving with the day's sell price. */
export const BUY_MIN_FACTOR = 1.3;
export const BUY_MAX_FACTOR = 1.6;

/**
 * What the Market charges for one unit on `day`, in whole dollars, or null for anything it does not sell
 * (only building materials). Always above the highest price the Market ever pays for the item, so buying
 * and selling back never makes money, whatever the days.
 */
export function buyPrice(day: number, itemId: ItemId): number | null {
  const item = getItem(itemId);
  if (!item || !isMaterial(itemId)) return null;
  const unit = (priceFactor(day, itemId) - PRICE_MIN_FACTOR) / (PRICE_MAX_FACTOR - PRICE_MIN_FACTOR);
  const price = Math.round(item.price * (BUY_MIN_FACTOR + (BUY_MAX_FACTOR - BUY_MIN_FACTOR) * unit));
  return Math.max(Math.floor(item.price * PRICE_MAX_FACTOR) + 1, price);
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
  /** Money that gives no XP: selling back materials bought at the Market. */
  earn(amount: number): void;
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
  // Bought materials sold back are not farm income: otherwise money would buy XP.
  if (isMaterial(itemId)) game.earn(total);
  else game.earnIncome(total);
  game.activity.emit('sold', { item: itemId, qty: n, earned: total });
  return total;
}

/** Sells every sellable item in the inventory but building materials, which are kept for building. Returns the total earned. */
export function sellAll(game: Seller): number {
  let total = 0;
  for (const itemId of Object.keys(game.state.inventory)) if (!isMaterial(itemId)) total += sell(game, itemId);
  return total;
}

/** The parts of `Game` that buying needs. */
export interface Buyer {
  readonly day: number;
  readonly money: number;
  isUnlocked(unlockLevel: number | undefined): boolean;
  spend(amount: number): boolean;
  addItem(itemId: ItemId, qty?: number): void;
  readonly activity: Emitter<ActivityEvents>;
}

export type BuyResult = { ok: true; qty: number; spent: number } | { ok: false; reason: 'not-for-sale' | 'level' | 'money' };

/** Level from which the Market sells an item; Infinity when it never does. */
export function buyUnlockLevel(itemId: ItemId): number {
  return isMaterial(itemId) ? MATERIAL_UNLOCK[itemId] : Infinity;
}

/** Buys `qty` units at today's price. Refuses (nothing changes) when it is not for sale, still locked, or too dear. */
export function buy(game: Buyer, itemId: ItemId, qty: number): BuyResult {
  const price = buyPrice(game.day, itemId);
  const n = Math.floor(qty);
  if (price === null || !(n > 0)) return { ok: false, reason: 'not-for-sale' };
  if (!game.isUnlocked(buyUnlockLevel(itemId))) return { ok: false, reason: 'level' };
  const total = n * price;
  if (!game.spend(total)) return { ok: false, reason: 'money' };
  game.addItem(itemId, n);
  game.activity.emit('bought', { item: itemId, qty: n, spent: total });
  return { ok: true, qty: n, spent: total };
}
