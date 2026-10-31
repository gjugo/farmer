import { MAP_HEIGHT, MAP_WIDTH, START_LAND } from './constants';
import { isOwned, type Rect } from './land';
import type { ActivityEvents } from './activity';
import type { Emitter } from './events';
import type { LandState } from './types';

/** Locked land is cut into parcels at most this many tiles wide/tall. */
export const PARCEL_MAX_SIZE = 12;
export const FIRST_PARCEL_PRICE = 1000;
export const PARCEL_PRICE_GROWTH = 1.25;

export interface Parcel extends Rect {
  /** Stable id from the parcel's grid position, e.g. `p0-2`. */
  id: string;
}

/**
 * Splits the strip [from, to) into near-equal chunks of at most `max` tiles.
 * The bigger chunks come first, so walking outward from the farm they are next to it.
 */
function chunks(from: number, to: number, max: number, biggestFirst: boolean): [number, number][] {
  const len = to - from;
  if (len <= 0) return [];
  const n = Math.ceil(len / max);
  const sizes = Array.from({ length: n }, (_, i) => Math.floor(len / n) + (i < len % n ? 1 : 0));
  if (!biggestFirst) sizes.reverse();
  const out: [number, number][] = [];
  let at = from;
  for (const size of sizes) {
    out.push([at, size]);
    at += size;
  }
  return out;
}

/** Column (or row) bands: the start area is one band, the land on each side is chunked. */
function bands(start: number, size: number, total: number, max: number): [number, number][] {
  return [...chunks(0, start, max, false), [start, size], ...chunks(start + size, total, max, true)];
}

/**
 * The parcel grid for a map. The starting land is one parcel (already owned); the
 * rest of the map is split into blocks of up to `PARCEL_MAX_SIZE` tiles around it.
 */
export function createParcels(width: number, height: number, start: Rect, max = PARCEL_MAX_SIZE): Parcel[] {
  const cols = bands(start.x, start.w, width, max);
  const rows = bands(start.y, start.h, height, max);
  const parcels: Parcel[] = [];
  rows.forEach(([y, h], r) => cols.forEach(([x, w], c) => parcels.push({ id: `p${c}-${r}`, x, y, w, h })));
  return parcels;
}

function tiles(p: Rect): [number, number][] {
  const out: [number, number][] = [];
  for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) out.push([x, y]);
  return out;
}

export function isParcelOwned(land: LandState, p: Rect): boolean {
  return tiles(p).every(([x, y]) => isOwned(land, x, y));
}

/** True when some tile just outside the parcel's edge (not diagonally) is owned. */
export function isNextToOwned(land: LandState, p: Rect): boolean {
  for (let x = p.x; x < p.x + p.w; x++) {
    if (isOwned(land, x, p.y - 1) || isOwned(land, x, p.y + p.h)) return true;
  }
  for (let y = p.y; y < p.y + p.h; y++) {
    if (isOwned(land, p.x - 1, y) || isOwned(land, p.x + p.w, y)) return true;
  }
  return false;
}

/** Locked parcels next to owned land: the ones that get a "For sale" sign. */
export function parcelsForSale(land: LandState, parcels: readonly Parcel[]): Parcel[] {
  return parcels.filter((p) => !isParcelOwned(land, p) && isNextToOwned(land, p));
}

/** Rounds to the nearest $10. */
function roundTo10(amount: number): number {
  return Math.round(amount / 10) * 10;
}

/** Price of the next parcel after `bought` have been bought: $1,000, $1,250, $1,560, ... */
export function parcelPrice(bought: number): number {
  let price = FIRST_PARCEL_PRICE;
  for (let i = 0; i < bought; i++) price = roundTo10(price * PARCEL_PRICE_GROWTH);
  return price;
}

/** Parcels the player has bought: owned parcels other than the starting land. */
export function parcelsBought(land: LandState, parcels: readonly Parcel[], start: Rect): number {
  return parcels.filter(
    (p) => !(p.x === start.x && p.y === start.y && p.w === start.w && p.h === start.h) && isParcelOwned(land, p),
  ).length;
}

export type BuyCheck = { ok: true; price: number } | { ok: false; reason: 'owned' | 'not-adjacent' | 'money'; price: number };

/** Can a parcel be bought with `money`? */
export function checkBuy(land: LandState, parcels: readonly Parcel[], start: Rect, p: Parcel, money: number): BuyCheck {
  const price = parcelPrice(parcelsBought(land, parcels, start));
  if (isParcelOwned(land, p)) return { ok: false, reason: 'owned', price };
  if (!isNextToOwned(land, p)) return { ok: false, reason: 'not-adjacent', price };
  if (money < price) return { ok: false, reason: 'money', price };
  return { ok: true, price };
}

/** The parts of `Game` that buying land needs. */
export interface LandBuyer {
  readonly money: number;
  readonly state: { land: LandState };
  spend(amount: number): boolean;
  setLandOwned(x: number, y: number, owned: boolean): void;
  readonly activity: Emitter<ActivityEvents>;
}

/** Buys a parcel: charges its price and makes its tiles owned. Nothing changes when it fails. */
export function buyParcel(game: LandBuyer, parcels: readonly Parcel[], start: Rect, p: Parcel): BuyCheck {
  const check = checkBuy(game.state.land, parcels, start, p, game.money);
  if (!check.ok) return check;
  if (!game.spend(check.price)) return { ok: false, reason: 'money', price: check.price };
  for (const [x, y] of tiles(p)) if (!isOwned(game.state.land, x, y)) game.setLandOwned(x, y, true);
  game.activity.emit('landBought', { parcel: p.id, price: check.price });
  return check;
}

/** The parcel grid of the farm map. */
export const FARM_PARCELS: readonly Parcel[] = createParcels(MAP_WIDTH, MAP_HEIGHT, START_LAND);

export function parcelAt(parcels: readonly Parcel[], x: number, y: number): Parcel | undefined {
  return parcels.find((p) => x >= p.x && y >= p.y && x < p.x + p.w && y < p.y + p.h);
}
