import { getItem, ITEM_LIST } from '../data/items';
import { isMaterial, isStoredMaterial, MATERIAL_UNLOCK } from '../data/materials';
import type { ActivityEvents } from './activity';
import { dayOf } from './clock';
import { DAY_MS } from './constants';
import type { Emitter } from './events';
import { perkFactor } from './perks';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import type { ClockState, GameState, ItemId } from './types';

/** Daily prices swing between these multiples of the base price. */
export const PRICE_MIN_FACTOR = 0.8;
export const PRICE_MAX_FACTOR = 1.2;

/** FNV-1a string hash, finished with a murmur3-style mix so nearby days differ a lot. */
export function hash(text: string): number {
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

/**
 * What the Market pays for one unit on `day` with a sell bonus of `bonus` (Haggler: 1.1), in whole dollars, or null
 * for items outside the catalogue. Building materials get no bonus, and nothing ever sells for as much as the Market
 * charges for it (`buyPrice`), so buying and selling back never makes money.
 */
export function sellPrice(day: number, itemId: ItemId, bonus = 1): number | null {
  const price = dailyPrice(day, itemId);
  if (price === null || bonus === 1 || isMaterial(itemId)) return price;
  const boosted = Math.round(price * bonus);
  const buy = buyPrice(day, itemId);
  return buy === null ? boosted : Math.min(boosted, buy - 1);
}

/** Today's sell price on this farm (with Haggler when taken). */
export function farmSellPrice(state: Pick<GameState, 'ext'>, day: number, itemId: ItemId): number | null {
  return sellPrice(day, itemId, perkFactor(state, 'haggler'));
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

// Saturation ------------------------------------------------------------------------

/**
 * The Market takes about this much of each item a day (at its base price) before it is flooded: e.g. 37 wheat, 3 cheese.
 * Every unit sold past that lowers the item's price by `DROP_PER_UNIT`, down to `MAX_DROP` off the day's price; each
 * new day takes `RECOVERY` of the drop away. Drops are kept in basis points (1% = 100) so the daily recovery is exact
 * integer arithmetic: live play, ×60 and offline catch-up give the same prices.
 */
export const ALLOWANCE_VALUE = 150;
export const DROP_PER_UNIT = 100;
export const MAX_DROP = 5000;
/** Share of the drop that recovers each new day (as a fraction: 1/4). */
export const RECOVERY = 0.25;

export interface MarketState {
  /** The game day the drops and sales below are for. */
  day: number;
  /** Item id → price drop in basis points (100 = 1%), 0..MAX_DROP. Items without a drop are left out. */
  drops: Record<ItemId, number>;
  /** Item id → units sold at the Market on `day`. */
  sold: Record<ItemId, number>;
}

export const MARKET_SLICE = 'market';

registerStateSlice<MarketState>(MARKET_SLICE, () => ({ day: 0, drops: {}, sold: {} }));

/** Units of an item the Market takes each day before its price starts to fall. */
export function allowance(itemId: ItemId): number {
  const item = getItem(itemId);
  return item ? Math.max(1, Math.floor(ALLOWANCE_VALUE / item.price)) : 0;
}

/** A drop after one more day: a quarter of it gone (rounded so it always reaches 0). */
export function recoverDrop(bp: number): number {
  return Math.floor(bp * (1 - RECOVERY));
}

function counts(v: unknown, max: number): Record<ItemId, number> {
  const out: Record<ItemId, number> = {};
  if (!isPlainObject(v)) return out;
  for (const [id, n] of Object.entries(v)) if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[id] = Math.min(max, n);
  return out;
}

/**
 * The Market's saturation, repaired if a save held anything malformed and brought up to today: each day passed since
 * it was last used recovers the drops and clears the day's sales. It depends on the day alone, never on when it is read.
 */
export function marketOf(state: GameState): MarketState {
  const s = getSlice<MarketState>(state, MARKET_SLICE);
  const today = dayOf(state.clock);
  // A new slice (or a broken day) starts today.
  if (!Number.isInteger(s.day) || s.day < 1) s.day = today;
  s.drops = counts(s.drops, MAX_DROP);
  s.sold = counts(s.sold, Number.MAX_SAFE_INTEGER);
  if (s.day < today) {
    for (let d = s.day; d < today && Object.keys(s.drops).length; d++) {
      for (const id of Object.keys(s.drops)) {
        const bp = recoverDrop(s.drops[id]);
        if (bp > 0) s.drops[id] = bp;
        else delete s.drops[id];
      }
    }
    s.sold = {};
    s.day = today;
  }
  return s;
}

/** The day's price less a drop of `bp` basis points, in whole dollars (at least $1). */
export function droppedPrice(dayPrice: number, bp: number): number {
  return Math.max(1, Math.round((dayPrice * (10_000 - bp)) / 10_000));
}

/**
 * What one unit of the item fetches at the Market right now: the farm's price for the day (with Haggler when taken)
 * less its drop, or null when it has no price. Saturation applies after the perk.
 */
export function currentPrice(state: GameState, itemId: ItemId): number | null {
  const price = farmSellPrice(state, dayOf(state.clock), itemId);
  return price === null ? null : droppedPrice(price, marketOf(state).drops[itemId] ?? 0);
}

/** How far the item's price is down today, as a fraction (0..0.5). */
export function priceDrop(state: GameState, itemId: ItemId): number {
  return (marketOf(state).drops[itemId] ?? 0) / 10_000;
}

/** What selling `qty` units now would pay, unit by unit at the falling price, and where the price ends up. */
export interface SaleQuote {
  qty: number;
  total: number;
  /** Price of the first unit, and of the next one after the sale. */
  priceNow: number;
  priceAfter: number;
  /** The drop after the sale, in basis points. */
  dropAfter: number;
  /** True when the sale goes past the day's allowance (the price falls). */
  floods: boolean;
}

/** Prices a sale without changing anything; null when the item has no price. */
export function quoteSale(state: GameState, itemId: ItemId, qty: number): SaleQuote | null {
  const price = farmSellPrice(state, dayOf(state.clock), itemId);
  if (price === null) return null;
  const market = marketOf(state);
  const n = Math.max(0, Math.floor(qty));
  const limit = allowance(itemId);
  let bp = market.drops[itemId] ?? 0;
  let sold = market.sold[itemId] ?? 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += droppedPrice(price, bp);
    sold++;
    if (sold > limit) bp = Math.min(MAX_DROP, bp + DROP_PER_UNIT);
  }
  return { qty: n, total, priceNow: droppedPrice(price, market.drops[itemId] ?? 0), priceAfter: droppedPrice(price, bp), dropAfter: bp, floods: sold > limit };
}

/** Every priced item's price at the Market now and its drop (a fraction), for `window.farm.market`. */
export function marketPrices(state: GameState): Record<ItemId, { price: number; drop: number }> {
  const out: Record<ItemId, { price: number; drop: number }> = {};
  for (const item of ITEM_LIST) {
    const price = currentPrice(state, item.id);
    if (price !== null) out[item.id] = { price, drop: priceDrop(state, item.id) };
  }
  return out;
}

/** Debug: every drop and the day's sales forgotten. */
export function clearDrops(state: GameState): void {
  const market = marketOf(state);
  market.drops = {};
  market.sold = {};
}

/** The parts of `Game` that selling needs. */
export interface Seller {
  readonly day: number;
  readonly state: GameState;
  count(itemId: ItemId): number;
  removeItem(itemId: ItemId, qty?: number): boolean;
  /** Sales are income: they give XP. */
  earnIncome(amount: number): void;
  /** Money that gives no XP: selling back materials bought at the Market. */
  earn(amount: number): void;
  readonly activity: Emitter<ActivityEvents>;
}

/**
 * Sells up to `qty` of an item at the Market (default: all of it), unit by unit at the day's price less its drop:
 * past the day's allowance each unit lowers the price (see `quoteSale`). Returns the money earned; 0 when there is
 * nothing to sell or the item has no price.
 */
export function sell(game: Seller, itemId: ItemId, qty = game.count(itemId)): number {
  const n = Math.min(Math.floor(qty), game.count(itemId));
  if (!(n > 0)) return 0;
  const quote = quoteSale(game.state, itemId, n);
  if (!quote) return 0;
  if (!game.removeItem(itemId, n)) return 0;
  const market = marketOf(game.state);
  market.sold[itemId] = (market.sold[itemId] ?? 0) + n;
  if (quote.dropAfter > 0) market.drops[itemId] = quote.dropAfter;
  const total = quote.total;
  // Bought materials sold back are not farm income: otherwise money would buy XP.
  if (isMaterial(itemId)) game.earn(total);
  else game.earnIncome(total);
  game.activity.emit('sold', { item: itemId, qty: n, earned: total });
  return total;
}

/** Items "sell everything" sells: everything in the inventory but building materials and manure, kept for building and the fields. */
export function sellAllItems(state: GameState): ItemId[] {
  return Object.keys(state.inventory).filter((id) => !isStoredMaterial(id) && dailyPrice(dayOf(state.clock), id) !== null);
}

/** What "sell everything" would pay now, at the falling prices. */
export function quoteSellAll(state: GameState): { total: number; floods: ItemId[] } {
  let total = 0;
  const floods: ItemId[] = [];
  for (const id of sellAllItems(state)) {
    const q = quoteSale(state, id, state.inventory[id] ?? 0);
    if (!q) continue;
    total += q.total;
    if (q.floods) floods.push(id);
  }
  return { total, floods };
}

/** Sells every item `sellAllItems` lists. Returns the total earned. */
export function sellAll(game: Seller): number {
  let total = 0;
  for (const itemId of sellAllItems(game.state)) total += sell(game, itemId);
  return total;
}

/** The parts of `Game` that buying needs. */
export interface Buyer {
  readonly day: number;
  readonly money: number;
  isUnlocked(unlockLevel: number | undefined): boolean;
  spend(amount: number): boolean;
  /** How many more of the item there is room for. */
  spaceFor(itemId: ItemId): number;
  addItem(itemId: ItemId, qty?: number): number;
  readonly activity: Emitter<ActivityEvents>;
}

/** `qty` is what was bought: fewer than asked when the storehouses only had room for that many. */
export type BuyResult = { ok: true; qty: number; spent: number } | { ok: false; reason: 'not-for-sale' | 'level' | 'money' | 'full' };

/** Level from which the Market sells an item; Infinity when it never does. */
export function buyUnlockLevel(itemId: ItemId): number {
  return isMaterial(itemId) ? MATERIAL_UNLOCK[itemId] : Infinity;
}

/**
 * Buys `qty` units at today's price, or as many of them as the storehouses have room for. Refuses (nothing
 * changes) when it is not for sale, still locked, there is no room at all, or the money isn't there.
 */
export function buy(game: Buyer, itemId: ItemId, qty: number): BuyResult {
  const price = buyPrice(game.day, itemId);
  const asked = Math.floor(qty);
  if (price === null || !(asked > 0)) return { ok: false, reason: 'not-for-sale' };
  if (!game.isUnlocked(buyUnlockLevel(itemId))) return { ok: false, reason: 'level' };
  const n = Math.min(asked, game.spaceFor(itemId));
  if (n <= 0) return { ok: false, reason: 'full' };
  const total = n * price;
  if (!game.spend(total)) return { ok: false, reason: 'money' };
  game.addItem(itemId, n);
  game.activity.emit('bought', { item: itemId, qty: n, spent: total });
  return { ok: true, qty: n, spent: total };
}
