import { CUSTOMERS } from '../data/customers';
import { getItem, type ItemDef } from '../data/items';
import type { ActivityEvents } from './activity';
import { campInfo } from './camp';
import { startTimer, timerDone, type Timer } from './clock';
import type { Emitter } from './events';
import { dailyPrice } from './market';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import { tradeOpen } from './tradegate';
import type { GameState, Inventory, ItemId } from './types';

/**
 * The Orders board: customers ask for bundles of goods the player has already had
 * and pay more than the market for the whole bundle. State lives in `ext.orders`.
 */

export const ORDER_SLOTS = 3;
/** Game time before a fulfilled / discarded slot gets a new order. */
export const FULFIL_REFILL_MS = 8 * 60_000;
export const DISCARD_REFILL_MS = 20 * 60_000;
/** Reward = base value of the goods × a factor in this range (the market pays at most 1.2×). */
export const REWARD_MIN_FACTOR = 1.25;
export const REWARD_MAX_FACTOR = 1.6;
/** Asked for when the player knows no goods yet: the starting crop. */
export const STARTING_GOOD: ItemId = 'wheat';

export interface OrderItem {
  itemId: ItemId;
  qty: number;
}

export interface Order {
  id: number;
  customer: string;
  items: OrderItem[];
  reward: number;
}

/** An open order, or an empty slot waiting for `refill`. A slot with neither is filled right away. */
export interface OrderSlot {
  order: Order | null;
  refill: Timer | null;
  /** Why the slot is empty (only while waiting). */
  reason?: 'fulfilled' | 'discarded';
}

export interface OrdersState {
  /** Goods the player has had in the inventory at least once, in the order they were first seen. */
  known: ItemId[];
  /** Seeded RNG state (mulberry32), saved so a reload never rerolls. */
  rng: number;
  nextId: number;
  slots: OrderSlot[];
}

export const ORDERS_SLICE = 'orders';

export function createOrdersState(seed: number): OrdersState {
  return { known: [], rng: seed >>> 0, nextId: 1, slots: [] };
}

/** A new farm knows its starting crop. */
registerStateSlice<OrdersState>(ORDERS_SLICE, () => ({ ...createOrdersState(Math.floor(Math.random() * 0x100000000)), known: [STARTING_GOOD] }));

/** Slices already repaired; after that only the functions below change them. */
const checked = new WeakSet<OrdersState>();

/** The orders slice, repaired in place (once) if a save held anything malformed. */
export function ordersOf(state: GameState): OrdersState {
  const s = getSlice<OrdersState>(state, ORDERS_SLICE);
  if (checked.has(s)) return s;
  checked.add(s);
  if (!Array.isArray(s.known)) s.known = [];
  s.known = [...new Set(s.known.filter((id) => typeof id === 'string' && getItem(id)))];
  if (!Number.isFinite(s.rng)) s.rng = 1;
  if (!Number.isInteger(s.nextId) || s.nextId < 1) s.nextId = 1;
  if (!Array.isArray(s.slots)) s.slots = [];
  s.slots = Array.from({ length: ORDER_SLOTS }, (_, i) => normalizeSlot(s.slots[i]));
  return s;
}

function normalizeSlot(v: unknown): OrderSlot {
  if (!isPlainObject(v)) return { order: null, refill: null };
  const order = isValidOrder(v.order) ? v.order : null;
  if (order) return { order, refill: null };
  const t = v.refill;
  if (isPlainObject(t) && Number.isFinite(t.start) && Number.isFinite(t.duration)) {
    const reason = v.reason === 'fulfilled' || v.reason === 'discarded' ? v.reason : undefined;
    return { order: null, refill: { start: t.start as number, duration: t.duration as number }, ...(reason ? { reason } : {}) };
  }
  return { order: null, refill: null };
}

function isValidOrder(v: unknown): v is Order {
  if (!isPlainObject(v) || !Array.isArray(v.items) || !v.items.length) return false;
  if (typeof v.customer !== 'string' || !Number.isInteger(v.reward) || !Number.isInteger(v.id)) return false;
  return v.items.every((it) => isPlainObject(it) && typeof it.itemId === 'string' && !!getItem(it.itemId) && Number.isInteger(it.qty) && (it.qty as number) > 0);
}

// Random numbers -------------------------------------------------------------------

/** mulberry32: next number in [0, 1), advancing the saved state. */
export function nextRandom(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
}

/** Integer in [min, max]. */
function randInt(s: { rng: number }, min: number, max: number): number {
  return min + Math.floor(nextRandom(s) * (max - min + 1));
}

// Known goods ----------------------------------------------------------------------

/** Feed and building materials are supplies the farm buys, not goods customers order. */
export function isOrderable(item: ItemDef | undefined): item is ItemDef {
  return !!item && item.category !== 'feed' && item.category !== 'material';
}

/** Records that the player has had `itemId`. Returns true when it was new. */
export function noteKnown(orders: OrdersState, itemId: ItemId): boolean {
  if (!getItem(itemId) || orders.known.includes(itemId)) return false;
  orders.known.push(itemId);
  return true;
}

/** Goods in the inventory the farm has had beyond the starting camp's supplies (those teach customers nothing). */
function ownGoods(state: GameState): ItemId[] {
  const left = campInfo(state)?.left ?? {};
  return Object.keys(state.inventory).filter((id) => (state.inventory[id] ?? 0) > (left[id] ?? 0));
}

/** Goods an order may ask for: known orderable goods, or the starting crop when there are none. */
export function orderPool(orders: OrdersState): ItemId[] {
  const pool = orders.known.filter((id) => isOrderable(getItem(id)));
  return pool.length ? pool : [STARTING_GOOD];
}

// Generating -----------------------------------------------------------------------

/** Processed goods worth this much or more are ordered 1–3 at a time. */
const DEAR_GOODS = 12;

/**
 * Quantity range for one item: cheap goods in larger amounts (up to 10), the dear processed goods 1–3. Bread and flour
 * are cheap processed goods, ordered by the dozen like crops.
 */
export function qtyRange(item: ItemDef): { min: number; max: number } {
  if (item.category === 'processed' && item.price >= DEAR_GOODS) return { min: 1, max: 3 };
  const max = Math.min(10, Math.max(2, Math.round(60 / item.price)));
  return { min: Math.ceil(max / 2), max };
}

/** Catalogue base value of the goods (what the market pays at 1.0×). */
export function baseValue(items: readonly OrderItem[]): number {
  return items.reduce((sum, it) => sum + (getItem(it.itemId)?.price ?? 0) * it.qty, 0);
}

/** Smallest and largest reward allowed for these goods, in whole dollars. */
export function rewardBounds(items: readonly OrderItem[]): { min: number; max: number } {
  const base = baseValue(items);
  return { min: Math.ceil(base * REWARD_MIN_FACTOR), max: Math.floor(base * REWARD_MAX_FACTOR) };
}

/** What the market would pay for the goods on `day`. */
export function marketValue(day: number, items: readonly OrderItem[]): number {
  return items.reduce((sum, it) => sum + (dailyPrice(day, it.itemId) ?? 0) * it.qty, 0);
}

/** Draws a new order from known goods. Avoids customers in `busy` while others are free. */
export function generateOrder(orders: OrdersState, busy: readonly string[] = []): Order {
  const pool = [...orderPool(orders)];
  const n = randInt(orders, 1, Math.min(3, pool.length));
  const items: OrderItem[] = [];
  for (let i = 0; i < n; i++) {
    const [itemId] = pool.splice(randInt(orders, 0, pool.length - 1), 1);
    const { min, max } = qtyRange(getItem(itemId)!);
    items.push({ itemId, qty: randInt(orders, min, max) });
  }
  const free = CUSTOMERS.filter((c) => !busy.includes(c));
  const names = free.length ? free : CUSTOMERS;
  const customer = names[randInt(orders, 0, names.length - 1)];
  const factor = REWARD_MIN_FACTOR + (REWARD_MAX_FACTOR - REWARD_MIN_FACTOR) * nextRandom(orders);
  const { min, max } = rewardBounds(items);
  const reward = Math.min(max, Math.max(min, Math.round(baseValue(items) * factor)));
  return { id: orders.nextId++, customer, items, reward };
}

function busyCustomers(orders: OrdersState, except: number): string[] {
  return orders.slots.flatMap((s, i) => (i !== except && s.order ? [s.order.customer] : []));
}

function fillSlot(orders: OrdersState, index: number): void {
  orders.slots[index] = { order: generateOrder(orders, busyCustomers(orders, index)), refill: null };
}

// Updating -------------------------------------------------------------------------

/**
 * Learns goods now in the inventory (beyond the camp's supplies) and fills slots that are empty or whose refill
 * timer has run out. Call often (every frame is fine). Returns true when anything changed.
 */
export function updateOrders(state: GameState): boolean {
  const orders = ordersOf(state);
  let changed = false;
  for (const id of ownGoods(state)) if (noteKnown(orders, id)) changed = true;
  orders.slots.forEach((slot, i) => {
    if (slot.order || (slot.refill && !timerDone(state.clock, slot.refill))) return;
    fillSlot(orders, i);
    changed = true;
  });
  return changed;
}

/** Debug: replaces every slot with a fresh order now. */
export function refreshOrders(state: GameState): void {
  const orders = ordersOf(state);
  for (const id of ownGoods(state)) noteKnown(orders, id);
  orders.slots = orders.slots.map(() => ({ order: null, refill: null }));
  for (let i = 0; i < ORDER_SLOTS; i++) fillSlot(orders, i);
}

export function hasGoods(inventory: Inventory, order: Order): boolean {
  return order.items.every((it) => (inventory[it.itemId] ?? 0) >= it.qty);
}

/** Number of open orders the inventory can fulfil right now (for the HUD badge). */
export function fulfillableCount(state: GameState): number {
  return ordersOf(state).slots.filter((s) => s.order && hasGoods(state.inventory, s.order)).length;
}

/** The parts of `Game` that fulfilling needs. */
export interface OrderGame {
  readonly state: GameState;
  removeItem(itemId: ItemId, qty?: number): boolean;
  /** Orders are income: they give XP. */
  earnIncome(amount: number): void;
  readonly activity: Emitter<ActivityEvents>;
}

/**
 * Hands over the goods and collects the reward (through `earnIncome`, the shared income path).
 * Returns the reward, or null (nothing changes) when the slot has no order or goods are missing.
 */
export function fulfilOrder(game: OrderGame, index: number): number | null {
  if (!tradeOpen(game.state)) return null;
  const orders = ordersOf(game.state);
  const order = orders.slots[index]?.order;
  if (!order || !hasGoods(game.state.inventory, order)) return null;
  for (const it of order.items) game.removeItem(it.itemId, it.qty);
  game.earnIncome(order.reward);
  orders.slots[index] = { order: null, refill: startTimer(game.state.clock, FULFIL_REFILL_MS), reason: 'fulfilled' };
  game.activity.emit('orderFulfilled', { reward: order.reward });
  return order.reward;
}

/** Drops an order for free; the slot refills after `DISCARD_REFILL_MS`. */
export function discardOrder(state: GameState, index: number): boolean {
  const orders = ordersOf(state);
  if (!orders.slots[index]?.order) return false;
  orders.slots[index] = { order: null, refill: startTimer(state.clock, DISCARD_REFILL_MS), reason: 'discarded' };
  return true;
}

/**
 * Save migration (version 1 → 2): an old farm knows what its inventory holds now
 * and starts with empty slots, which `updateOrders` fills with fresh orders.
 */
export function migrateOrdersSlice(state: Record<string, unknown>): Record<string, unknown> {
  const inventory = isPlainObject(state.inventory) ? state.inventory : {};
  const known = Object.keys(inventory).filter((id) => typeof inventory[id] === 'number' && (inventory[id] as number) > 0);
  const ext = isPlainObject(state.ext) ? state.ext : {};
  const orders = { ...createOrdersState(Math.floor(Math.random() * 0x100000000)), known };
  return { ...state, ext: { ...ext, [ORDERS_SLICE]: orders } };
}
