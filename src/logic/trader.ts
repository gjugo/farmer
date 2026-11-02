import { ANIMALS, FEED_PACK, PENS, type AnimalKind } from '../data/animals';
import { CROP_LIST } from '../data/crops';
import { PATH } from '../data/farmhouse';
import { getItem, type KnownItemId } from '../data/items';
import { MATERIAL_IDS, MATERIAL_UNLOCK } from '../data/materials';
import { PROCESSORS } from '../data/processing';
import { SEASON_DAYS } from '../data/seasons';
import { animalsOf, capacityOf, canHouse, type PenState } from './animals';
import { dayOf } from './clock';
import { DAY_MS } from './constants';
import { footprintOf, type Game } from './game';
import { buyPrice, hash, PRICE_MAX_FACTOR } from './market';
import { isOrderable, nextRandom } from './orders';
import { canPlace, objectAt } from './placement';
import { doorOf, farmhouseOf } from './roads';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import type { GameState, ItemId, PlacedObject } from './types';

/**
 * Travelling traders: from `TRADER_LEVEL`, about twice a season a trader's wagon parks by the farmhouse for one game
 * day. He buys a few goods the farm can make for well above the Market's price (no saturation) and sells building
 * materials, an animal and bulk feed, each in limited stock. He is announced the day before. The schedule follows
 * from the farm's saved seed and the day alone, so reloads never reroll it; a trader due while the player is away
 * comes and goes without trading. State lives in `ext.trader`.
 */

export const TRADER_LEVEL = 3;
/** One visit in each block of this many days: two a season. */
export const VISIT_BLOCK_DAYS = Math.max(1, Math.floor(SEASON_DAYS / 2));
/** What he pays for wanted goods: base price × a factor in this range. */
export const WANT_MIN_FACTOR = 1.4;
export const WANT_MAX_FACTOR = 1.8;
/** He buys about this much (at base price) of each good, as a number of units in [WANT_MIN_QTY, WANT_MAX_QTY]. */
export const WANT_VALUE = 240;
export const WANT_MIN_QTY = 2;
export const WANT_MAX_QTY = 40;
/** Animals sell at this share of their price. */
export const ANIMAL_DISCOUNT = 0.75;

export interface TraderWant {
  item: ItemId;
  price: number;
  left: number;
}

/** Something he sells: an item (materials, feed) or an animal. */
export type TraderOffer = { item: ItemId; price: number; left: number } | { animal: AnimalKind; price: number; left: number };

export interface TraderVisit {
  /** The game day he stays for. */
  day: number;
  /** He came while the player was away: no wagon, no trading. */
  missed: boolean;
  /** Where the wagon stands (null when no tile was free). */
  tile: { x: number; y: number } | null;
  wants: TraderWant[];
  sells: TraderOffer[];
  /** Units traded either way, for the goal and the summary. */
  traded: number;
}

export interface TraderState {
  /** The farm's seed for the schedule and the offers. */
  seed: number;
  /** Last game day the schedule was brought up to (0: never). */
  day: number;
  /** The day the last announcement was for, so it is made once. */
  announced: number;
  visit: TraderVisit | null;
}

export const TRADER_SLICE = 'trader';

registerStateSlice<TraderState>(TRADER_SLICE, () => ({ seed: Math.floor(Math.random() * 0x100000000), day: 0, announced: 0, visit: null }));

function isTile(v: unknown): v is { x: number; y: number } {
  return isPlainObject(v) && Number.isInteger(v.x) && Number.isInteger(v.y);
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function validVisit(v: unknown): TraderVisit | null {
  if (!isPlainObject(v) || !Number.isInteger(v.day) || !Array.isArray(v.wants) || !Array.isArray(v.sells)) return null;
  const wants = v.wants.filter((w): w is TraderWant => isPlainObject(w) && typeof w.item === 'string' && !!getItem(w.item) && isCount(w.price) && isCount(w.left));
  const sells = v.sells.filter(
    (o): o is TraderOffer =>
      isPlainObject(o) &&
      isCount(o.price) &&
      isCount(o.left) &&
      ((typeof o.item === 'string' && !!getItem(o.item)) || (typeof o.animal === 'string' && Object.hasOwn(ANIMALS, o.animal))),
  );
  return { day: v.day as number, missed: v.missed === true, tile: isTile(v.tile) ? { x: v.tile.x, y: v.tile.y } : null, wants, sells, traded: isCount(v.traded) ? v.traded : 0 };
}

/** The trader slice, repaired if a save held anything malformed. */
export function traderOf(state: GameState): TraderState {
  const s = getSlice<TraderState>(state, TRADER_SLICE);
  if (!Number.isFinite(s.seed)) s.seed = 1;
  s.seed = s.seed >>> 0;
  if (!Number.isInteger(s.day) || s.day < 0) s.day = 0;
  if (!Number.isInteger(s.announced)) s.announced = 0;
  s.visit = validVisit(s.visit);
  return s;
}

// Schedule -------------------------------------------------------------------------

/** Whether the schedule has a trader on `day` (before the level check): one day in each block of `VISIT_BLOCK_DAYS`. */
export function isTraderDay(seed: number, day: number): boolean {
  if (day < 1) return false;
  const block = Math.floor((day - 1) / VISIT_BLOCK_DAYS);
  return (day - 1) % VISIT_BLOCK_DAYS === hash(`${seed >>> 0}:trader:${block}`) % VISIT_BLOCK_DAYS;
}

/** The first trader day on or after `day`. */
export function nextTraderDay(seed: number, day: number): number {
  let d = Math.max(1, day);
  while (!isTraderDay(seed, d)) d++;
  return d;
}

/** Game time a day starts and ends. */
export const dayStart = (day: number): number => (day - 1) * DAY_MS;
export const dayEnd = (day: number): number => day * DAY_MS;

// Offers ---------------------------------------------------------------------------

/** Goods the farm can make at `level`: crops it can sow, products of animals it can keep, processed goods (not feed). */
export function makeableGoods(level: number): ItemId[] {
  const out = new Set<KnownItemId>();
  for (const c of CROP_LIST) if (c.unlockLevel <= level) out.add(c.harvestItem);
  for (const a of Object.values(ANIMALS)) if (a.unlockLevel <= level && PENS[a.pen].unlockLevel <= level) out.add(a.product);
  for (const p of Object.values(PROCESSORS)) if (p.unlockLevel <= level) for (const r of p.recipes) out.add(r.output.item);
  return [...out].filter((id) => isOrderable(getItem(id)));
}

/** The most the Market ever pays for one unit of the item (any day, before saturation). */
function marketMax(itemId: ItemId): number {
  return Math.floor((getItem(itemId)?.price ?? 0) * PRICE_MAX_FACTOR);
}

/**
 * His price for a building material on `day`: below the Market's buy price that day, but never below the most the
 * Market pays for it, so buying from him and selling to the Market never makes money.
 */
export function materialPrice(day: number, itemId: ItemId): number {
  const buy = buyPrice(day, itemId)!;
  return Math.min(buy - 1, Math.max(marketMax(itemId), Math.round(buy * 0.85)));
}

/** His price for feed: cheaper than the Market's feed packs, never below what the Market pays for feed. */
export function feedPrice(): number {
  return Math.max(marketMax('feed') + 1, Math.round((FEED_PACK.price / FEED_PACK.qty) * 0.8));
}

type Rng = { rng: number };

function randInt(r: Rng, min: number, max: number): number {
  return min + Math.floor(nextRandom(r) * (max - min + 1));
}

function shuffle<T>(r: Rng, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randInt(r, 0, i);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** What he wants and sells on `day` at farm level `level`: drawn from the farm's seed and the day, so it never rerolls. */
export function generateOffers(seed: number, day: number, level: number): Pick<TraderVisit, 'wants' | 'sells'> {
  const r: Rng = { rng: hash(`${seed >>> 0}:offers:${day}`) };
  const goods = shuffle(r, makeableGoods(level));
  const wants = goods.slice(0, Math.min(goods.length, randInt(r, 2, 3))).map((item) => {
    const base = getItem(item)!.price;
    const factor = WANT_MIN_FACTOR + (WANT_MAX_FACTOR - WANT_MIN_FACTOR) * nextRandom(r);
    const price = Math.min(Math.floor(base * WANT_MAX_FACTOR), Math.max(Math.ceil(base * WANT_MIN_FACTOR), Math.round(base * factor)));
    const left = Math.max(WANT_MIN_QTY, Math.min(WANT_MAX_QTY, Math.round(WANT_VALUE / base)));
    return { item, price, left };
  });

  const materials = MATERIAL_IDS.filter((id) => MATERIAL_UNLOCK[id] <= level);
  const animals = (Object.keys(ANIMALS) as AnimalKind[]).filter((k) => ANIMALS[k].unlockLevel <= level && PENS[ANIMALS[k].pen].unlockLevel <= level);
  const kinds: (() => TraderOffer)[] = [];
  if (materials.length) {
    kinds.push(() => {
      const item = materials[randInt(r, 0, materials.length - 1)];
      return { item, price: materialPrice(day, item), left: randInt(r, 15, 30) };
    });
  }
  if (animals.length) {
    kinds.push(() => {
      const animal = animals[randInt(r, 0, animals.length - 1)];
      return { animal, price: Math.round(ANIMALS[animal].price * ANIMAL_DISCOUNT), left: randInt(r, 1, 2) };
    });
  }
  kinds.push(() => ({ item: 'feed', price: feedPrice(), left: randInt(r, 20, 40) }));
  const sells = shuffle(r, kinds)
    .slice(0, Math.min(kinds.length, randInt(r, 2, 3)))
    .map((make) => make());
  return { wants, sells };
}

// Parking --------------------------------------------------------------------------

const STEPS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const;

/** Is (x, y) a map tile with nothing on it (no object, tree, rock or pond)? */
function freeTile(state: GameState, x: number, y: number): boolean {
  return canPlace(state, { w: 1, h: 1 }, x, y, footprintOf).ok;
}

/**
 * Where the wagon parks: a free tile next to the farmhouse door, or else the path tile nearest the door with
 * nothing else on it. Null when the farm has no farmhouse or no such tile.
 */
export function parkingSpot(state: GameState): { x: number; y: number } | null {
  const house = farmhouseOf(state);
  if (!house) return null;
  const door = doorOf(house);
  for (const [dx, dy] of STEPS) if (freeTile(state, door.x + dx, door.y + dy)) return { x: door.x + dx, y: door.y + dy };
  // Nearest path tile, walking the paths out from the door.
  const isPath = (x: number, y: number) => objectAt(state, x, y, footprintOf)?.type === PATH;
  const seen = new Set<string>();
  const queue = isPath(door.x, door.y) ? [door] : [];
  for (const t of queue) {
    const k = `${t.x},${t.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (t !== door) return { x: t.x, y: t.y };
    for (const [dx, dy] of STEPS) if (isPath(t.x + dx, t.y + dy)) queue.push({ x: t.x + dx, y: t.y + dy });
  }
  return queue.length ? { ...door } : null;
}

/** Can the wagon still stand on its tile (nothing built there since, other than a path)? */
function stillParked(state: GameState, tile: { x: number; y: number }): boolean {
  const obj = objectAt(state, tile.x, tile.y, footprintOf);
  return obj ? obj.type === PATH : freeTile(state, tile.x, tile.y);
}

// Visits ---------------------------------------------------------------------------

/** The trader standing at the farm now (here today and not missed), or null. */
export function traderHere(state: GameState): TraderVisit | null {
  const v = traderOf(state).visit;
  return v && !v.missed && v.day === dayOf(state.clock) ? v : null;
}

/** The wagon's tile now, moving it if something was built on its spot. */
export function wagonTile(state: GameState): { x: number; y: number } | null {
  const v = traderHere(state);
  if (!v) return null;
  if (!v.tile || !stillParked(state, v.tile)) v.tile = parkingSpot(state);
  return v.tile;
}

/** What `updateTrader` saw happen. */
export interface TraderUpdate {
  /** A trader arrives tomorrow (announced now, once). */
  announced: number | null;
  /** He arrived (today's visit). */
  arrived: TraderVisit | null;
  /** He left (end of his day). */
  left: TraderVisit | null;
  /** Traders that came and went while the player was away. */
  missed: number;
}

function startVisit(game: Game, day: number, missed: boolean): TraderVisit {
  const s = traderOf(game.state);
  const visit: TraderVisit = { day, missed, tile: missed ? null : parkingSpot(game.state), ...generateOffers(s.seed, day, game.level), traded: 0 };
  s.visit = visit;
  return visit;
}

/**
 * Brings the trader up to today. Call often (every frame is fine). With `away` (offline catch-up), every arrival
 * since the last call happened while the player was away: those traders came and went (today's one stays, but without
 * trading). The schedule depends on the seed and the day alone, so ×60 and catch-up see the same traders.
 */
export function updateTrader(game: Game, { away = false }: { away?: boolean } = {}): TraderUpdate {
  const s = traderOf(game.state);
  const today = game.day;
  const out: TraderUpdate = { announced: null, arrived: null, left: null, missed: 0 };
  if (s.day === 0) s.day = today - 1;
  if (s.visit && s.visit.day < today) {
    if (!s.visit.missed) out.left = s.visit;
    s.visit = null;
  }
  const open = game.level >= TRADER_LEVEL;
  for (let d = s.day + 1; d <= today; d++) {
    if (!open || !isTraderDay(s.seed, d)) continue;
    if (d < today) {
      if (away) out.missed++;
      continue;
    }
    const visit = startVisit(game, d, away);
    if (away) out.missed++;
    else out.arrived = visit;
  }
  if (s.day < today) s.day = today;
  if (open && !away && isTraderDay(s.seed, today + 1) && s.announced < today + 1) {
    s.announced = today + 1;
    out.announced = today + 1;
  }
  return out;
}

/** Debug: a trader arrives now and stays for the rest of today, whatever the schedule and level. */
export function traderNow(game: Game): TraderVisit {
  const s = traderOf(game.state);
  s.day = Math.max(s.day, game.day);
  return startVisit(game, game.day, false);
}

/** When the next trader comes (or the one here came) and leaves, in game ms; nulls when none is due (below level 3). */
export function traderTimes(game: Game): { arrivesAt: number | null; leavesAt: number | null } {
  const here = traderHere(game.state);
  if (here) return { arrivesAt: dayStart(here.day), leavesAt: dayEnd(here.day) };
  if (game.level < TRADER_LEVEL) return { arrivesAt: null, leavesAt: null };
  const next = nextTraderDay(traderOf(game.state).seed, game.day + 1);
  return { arrivesAt: dayStart(next), leavesAt: dayEnd(next) };
}

/** `window.farm.trader`. */
export function traderInfo(game: Game) {
  const here = traderHere(game.state);
  return {
    here: !!here,
    ...traderTimes(game),
    wants: here ? here.wants.map((w) => ({ ...w })) : [],
    sells: here ? here.sells.map((o) => ({ ...o })) : [],
  };
}

// Trading --------------------------------------------------------------------------

export type TradeResult =
  | { ok: true; qty: number; money: number }
  | { ok: false; reason: 'gone' | 'none' | 'sold-out' | 'money' | 'full' | 'no-pen' };

function traded(game: Game, visit: TraderVisit, what: string, qty: number, money: number, kind: 'buy' | 'sell'): void {
  visit.traded += qty;
  game.activity.emit('traded', { kind, what, qty, money });
}

/**
 * Sells up to `qty` of a wanted good to the trader at his price (no saturation), as far as he still wants it and the
 * farm has it. It is income: it gives XP.
 */
export function sellToTrader(game: Game, index: number, qty: number): TradeResult {
  const visit = traderHere(game.state);
  if (!visit) return { ok: false, reason: 'gone' };
  const want = visit.wants[index];
  if (!want) return { ok: false, reason: 'none' };
  if (want.left <= 0) return { ok: false, reason: 'sold-out' };
  const n = Math.min(Math.floor(qty), want.left, game.count(want.item));
  if (!(n > 0) || !game.removeItem(want.item, n)) return { ok: false, reason: 'none' };
  want.left -= n;
  const money = n * want.price;
  game.earnIncome(money);
  traded(game, visit, want.item, n, money, 'sell');
  return { ok: true, qty: n, money };
}

/** Pens with room for `kind`, finished ones only. */
function pensFor(game: Game, kind: AnimalKind): PlacedObject<PenState>[] {
  return (game.state.objects as PlacedObject<PenState>[]).filter((o) => !o.site && canHouse(o, kind) && animalsOf(o).length < capacityOf(o));
}

/** How many of an offer the farm could take now (room in storage or pens, and stock), ignoring money. */
export function roomFor(game: Game, offer: TraderOffer): number {
  if ('animal' in offer) return Math.min(offer.left, pensFor(game, offer.animal).reduce((n, p) => n + capacityOf(p) - animalsOf(p).length, 0));
  return Math.min(offer.left, game.spaceFor(offer.item));
}

/**
 * Buys up to `qty` of an offer: as many as he has, as fit (storage room, or pens with room for an animal) and as
 * the money pays for. Refused (nothing changes) when none fit or the money isn't there for even one.
 */
export function buyFromTrader(game: Game, index: number, qty: number): TradeResult {
  const visit = traderHere(game.state);
  if (!visit) return { ok: false, reason: 'gone' };
  const offer = visit.sells[index];
  if (!offer) return { ok: false, reason: 'none' };
  if (offer.left <= 0) return { ok: false, reason: 'sold-out' };
  const asked = Math.floor(qty);
  if (!(asked > 0)) return { ok: false, reason: 'none' };
  const room = roomFor(game, offer);
  if (room <= 0) return { ok: false, reason: 'animal' in offer ? 'no-pen' : 'full' };
  const n = Math.min(asked, room, Math.floor(game.money / Math.max(1, offer.price)));
  if (n <= 0 || !game.spend(n * offer.price)) return { ok: false, reason: 'money' };
  offer.left -= n;
  if ('animal' in offer) {
    for (let i = 0; i < n; i++) {
      const pen = pensFor(game, offer.animal)[0];
      pen.state.animals.push({ kind: offer.animal, timer: null });
      game.touch(pen);
      game.activity.emit('animalBought', { kind: offer.animal });
    }
  } else {
    game.addItem(offer.item, n);
  }
  traded(game, visit, 'animal' in offer ? offer.animal : offer.item, n, n * offer.price, 'buy');
  return { ok: true, qty: n, money: n * offer.price };
}
