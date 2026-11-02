import { getBuildable } from '../data/buildables';
import { FARMHOUSE } from '../data/farmhouse';
import { CART_CAPACITY, CART_LOAD_MS, CART_UNLOAD_MS, OX_BARN, OX_MS_PER_TILE, OX_PRICE } from '../data/haul';
import { isProcessorType } from '../data/processing';
import { isResourceType, RESOURCES } from '../data/resourceBuildings';
import { isStorageType, STORAGE, type StoragePool } from '../data/storage';
import type { Game } from './game';
import * as inventory from './inventory';
import * as processing from './processing';
import type { ResourceState } from './resources';
import { findWay, wayLength, type Area, type Point } from './roads';
import { isPlainObject } from './slices';
import { poolOf } from './storage';
import type { GameState, Inventory, PlacedObject } from './types';
import { activeJobs, jobsByFarmer, workerAt, workersOf, type Job } from './workers';

/**
 * Oxcart hauling. An ox barn with an ox and a carter (the farmer assigned to it) sends its cart out along the paths:
 * from the barn to the fullest yard (a resource building's output, or a processing building's finished goods), where
 * it loads up to `CART_CAPACITY` units, on to the nearest store with room for them (a granary, storehouse or the
 * farmhouse), where it unloads, and back to the barn. The carter walks from the village centre to the barn first and home
 * again after. Numbers live in `src/data/haul.ts`.
 *
 * A trip is one farmer job (kind `haul`) made of legs with their own timing. The goods are always counted where they
 * physically are: in the yard until the cart has loaded them, on the cart (`HaulTrip.load`) until it has unloaded
 * them, and then in the stores. Whatever didn't fit stays on the cart and is parked in the barn (`BarnState.cargo`)
 * until a later trip takes it to a store with room. Nothing is ever lost.
 *
 * Loading, unloading and parking happen at fixed game times, so the work scheduler (`src/logic/work.ts`) visits
 * them as events: ×1, ×60 and offline catch-up give the same farm.
 */

// A type alias (not an interface) so it fits `PlacedObject<Record<string, unknown>>`.
export type BarnState = {
  /** The barn has an ox (bought once, for good). */
  ox: boolean;
  /** Goods on the parked cart: what a trip could not unload for want of room. */
  cargo: Inventory;
};

export type LegKind = 'drive' | 'load' | 'unload';

export interface HaulLeg {
  kind: LegKind;
  /** Game ms the leg takes. */
  ms: number;
  /** Driving: the way along the paths (grid points). Loading and unloading: the one point where the cart stands. */
  way: Point[];
}

/** One oxcart trip, kept on the carter's job. */
export interface HaulTrip {
  barn: string;
  /** The pickup (yard) the cart loads at; null on a trip that only delivers the parked cargo. */
  from: string | null;
  /** The store it unloads at: a granary, storehouse or the farmhouse. */
  to: string;
  /** Game time the cart leaves the barn (once the carter has walked there). */
  start: number;
  legs: HaulLeg[];
  /** Units it set out to load: other carts leave them for this one. */
  planned: number;
  /** Goods on the cart now. */
  load: Inventory;
  /** Which of the trip's events have happened. */
  loaded: boolean;
  unloaded: boolean;
  parked: boolean;
}

export function isBarn(obj: PlacedObject | undefined): boolean {
  return obj?.type === OX_BARN;
}

/**
 * Repairs a barn's state from a save (or an older shape). It repairs the object in place, so a
 * reference someone already holds (buyOx's, across the 'money' redraw of the open panel) stays the barn's.
 */
export function sanitizeBarn(obj: PlacedObject): BarnState {
  if (!isPlainObject(obj.state)) obj.state = {};
  const s = obj.state as Record<string, unknown>;
  const cargo: Inventory = {};
  if (isPlainObject(s.cargo)) for (const [id, n] of Object.entries(s.cargo)) if (Number.isInteger(n) && (n as number) > 0) cargo[id] = n as number;
  s.ox = s.ox === true;
  s.cargo = cargo;
  return s as BarnState;
}

export function barnState(obj: PlacedObject): BarnState {
  const s = obj.state as Partial<BarnState>;
  return typeof s.ox === 'boolean' && isPlainObject(s.cargo) ? (s as BarnState) : sanitizeBarn(obj);
}

export type BuyOxResult = { ok: true } | { ok: false; reason: 'not-barn' | 'site' | 'has-ox' | 'money' };

/** Buys the barn's ox for `OX_PRICE` (nothing with `free`, the debug button). Nothing changes when it fails. */
export function buyOx(game: Game, obj: PlacedObject, free = false): BuyOxResult {
  if (!isBarn(obj)) return { ok: false, reason: 'not-barn' };
  if (obj.site) return { ok: false, reason: 'site' };
  if (barnState(obj).ox) return { ok: false, reason: 'has-ox' };
  if (!free && !game.canAfford(OX_PRICE)) return { ok: false, reason: 'money' };
  if (!free) game.spend(OX_PRICE);
  // Looked up again: spending emits 'money', and its listeners may have touched the barn.
  barnState(obj).ox = true;
  game.touch(obj);
  return { ok: true };
}

// Where goods are --------------------------------------------------------------------

function areaOf(obj: PlacedObject): Area {
  return { x: obj.x, y: obj.y, ...(getBuildable(obj.type)?.footprint ?? { w: 1, h: 1 }) };
}

/** Sum of an inventory's counts. */
export function units(inv: Inventory): number {
  let n = 0;
  for (const q of Object.values(inv)) n += q;
  return n;
}

/** A built resource or processing building: somewhere a cart picks goods up. */
export function isPickup(obj: PlacedObject): boolean {
  return !obj.site && (isResourceType(obj.type) || isProcessorType(obj.type));
}

/** What waits at a pickup: a resource building's yard, a processing building's finished goods. */
export function goodsAt(obj: PlacedObject): Inventory {
  if (isResourceType(obj.type)) {
    const { waiting } = obj.state as ResourceState;
    return waiting > 0 ? { [RESOURCES[obj.type].output]: waiting } : {};
  }
  if (isProcessorType(obj.type)) return { ...((obj.state as processing.ProcessorState).ready ?? {}) };
  return {};
}

/** The haul trips under way (`all`: also those of jobs just over, not yet dropped, whose last events may be due). */
export function tripsOf(state: GameState, all = false): { job: Job; trip: HaulTrip }[] {
  const w = workersOf(state);
  return (all ? w.jobs : activeJobs(state.clock, w)).flatMap((job) => (job.haul ? [{ job, trip: job.haul }] : []));
}

/** Units at `pickupId` other carts set out to load and haven't yet. */
function claimed(state: GameState, pickupId: string): number {
  let n = 0;
  for (const { trip } of tripsOf(state)) if (trip.from === pickupId && !trip.loaded) n += trip.planned;
  return n;
}

/** Where a pool's goods can be stored: its finished storage buildings and the farmhouse. */
function storesOf(state: GameState, pool: StoragePool): PlacedObject[] {
  return state.objects.filter((o) => !o.site && (o.type === FARMHOUSE || (isStorageType(o.type) && STORAGE[o.type].pool === pool)));
}

/** The store of `pool` nearest to `from` along the paths, and the way there; or the first store when none is reachable. */
function nearestStore(state: GameState, from: Area, pool: StoragePool): { store: PlacedObject; way: Point[] } | { unreachable: string | null } {
  let best: { store: PlacedObject; way: Point[]; length: number } | null = null;
  const stores = storesOf(state, pool);
  for (const store of stores) {
    const way = findWay(state, from, areaOf(store));
    if (!way) continue;
    const length = wayLength(way);
    if (!best || length < best.length) best = { store, way, length };
  }
  return best ?? { unreachable: stores[0]?.id ?? null };
}

// Planning a trip --------------------------------------------------------------------

/** Why a barn's cart doesn't set out. `no-path` names the place no path leads to (`to`). */
export type HaulWait = 'no-ox' | 'nothing-to-haul' | 'stores-full' | 'no-path';

export type HaulPlan = { trip: Omit<HaulTrip, 'start'>; ms: number } | { wait: HaulWait; to?: string };

const driveMs = (way: Point[]) => Math.round(wayLength(way) * OX_MS_PER_TILE);
const drive = (way: Point[]): HaulLeg => ({ kind: 'drive', ms: driveMs(way), way });
const stop = (kind: 'load' | 'unload', at: Point): HaulLeg => ({ kind, ms: kind === 'load' ? CART_LOAD_MS : CART_UNLOAD_MS, way: [at] });
const reversed = (way: Point[]) => [...way].reverse();
const total = (legs: HaulLeg[]) => legs.reduce((n, l) => n + l.ms, 0);

/**
 * The cart's next trip from this barn, or why there is none: it delivers the parked cargo first; otherwise it goes
 * to the fullest pickup a path leads to whose goods have room in the stores.
 */
export function planHaul(game: Game, barn: PlacedObject): HaulPlan {
  const { state } = game;
  const s = barnState(barn);
  if (!s.ox) return { wait: 'no-ox' };
  const home = areaOf(barn);
  const cargo = Object.keys(s.cargo);
  if (cargo.length > 0) {
    if (!cargo.some((id) => game.spaceFor(id) > 0)) return { wait: 'stores-full' };
    const found = nearestStore(state, home, poolOf(cargo[0]));
    if (!('store' in found)) return { wait: 'no-path', to: found.unreachable ?? undefined };
    const legs = [drive(found.way), stop('unload', found.way[found.way.length - 1]), drive(reversed(found.way))];
    const trip = { barn: barn.id, from: null, to: found.store.id, legs, planned: 0, load: {}, loaded: true, unloaded: false, parked: false };
    return { trip, ms: total(legs) };
  }
  const pickups = state.objects
    .filter(isPickup)
    .map((obj) => ({ obj, n: units(goodsAt(obj)) - claimed(state, obj.id) }))
    .filter((p) => p.n > 0)
    .sort((a, b) => b.n - a.n);
  if (pickups.length === 0) return { wait: 'nothing-to-haul' };
  const roomy = pickups.filter((p) => Object.keys(goodsAt(p.obj)).some((id) => game.spaceFor(id) > 0));
  if (roomy.length === 0) return { wait: 'stores-full' };
  let unreachable: string | null = null;
  for (const { obj, n } of roomy) {
    const there = findWay(state, home, areaOf(obj));
    if (!there) {
      unreachable ??= obj.id;
      continue;
    }
    const found = nearestStore(state, areaOf(obj), poolOf(Object.keys(goodsAt(obj))[0]));
    if (!('store' in found)) {
      unreachable ??= found.unreachable;
      continue;
    }
    const back = findWay(state, areaOf(found.store), home);
    if (!back) {
      unreachable ??= barn.id;
      continue;
    }
    const legs = [
      drive(there),
      stop('load', there[there.length - 1]),
      drive(found.way),
      stop('unload', found.way[found.way.length - 1]),
      drive(back),
    ];
    const trip = { barn: barn.id, from: obj.id, to: found.store.id, legs, planned: Math.min(CART_CAPACITY, n), load: {}, loaded: false, unloaded: false, parked: false };
    return { trip, ms: total(legs) };
  }
  return { wait: 'no-path', to: unreachable ?? undefined };
}

/** Why a barn's cart stands still: no ox, no carter, or why it can't set out (see `planHaul`). */
export type BarnWait = { wait: HaulWait | 'no-carter'; to?: string };

/** Why the barn's cart stands in the barn now; null while a trip is under way or about to start. */
export function barnWait(game: Game, barn: PlacedObject): BarnWait | null {
  if (!barnState(barn).ox) return { wait: 'no-ox' };
  if (workerAt(game.state, barn.id) === null) return { wait: 'no-carter' };
  if (tripsOf(game.state).some(({ trip }) => trip.barn === barn.id && !trip.parked)) return null;
  const plan = planHaul(game, barn);
  return 'wait' in plan ? plan : null;
}

/**
 * Starts a planned trip whose cart leaves the barn at game time `start` (once the carter has walked there). A trip
 * that delivers the parked cargo takes it onto the cart now.
 */
export function startTrip(game: Game, plan: Omit<HaulTrip, 'start'>, start: number): HaulTrip {
  const trip: HaulTrip = { ...plan, start, load: { ...plan.load } };
  const barn = game.getObject(trip.barn);
  if (barn && trip.from === null) {
    const s = barnState(barn);
    trip.load = s.cargo;
    s.cargo = {};
    game.touch(barn);
  }
  return trip;
}

// Running trips ----------------------------------------------------------------------

/** Game time at which each leg ends, in order. */
export function legEnds(trip: HaulTrip): number[] {
  let t = trip.start;
  return trip.legs.map((l) => (t += l.ms));
}

function endOf(trip: HaulTrip, kind: LegKind): number | null {
  const ends = legEnds(trip);
  const i = trip.legs.findIndex((l) => l.kind === kind);
  return i >= 0 ? ends[i] : null;
}

/** The next load, unload or park after `now`, or Infinity. */
export function nextHaulEvent(state: GameState, now: number): number {
  let next = Infinity;
  for (const { trip } of tripsOf(state, true)) {
    const ends = legEnds(trip);
    const times = [trip.loaded ? null : endOf(trip, 'load'), trip.unloaded ? null : endOf(trip, 'unload'), trip.parked ? null : ends[ends.length - 1]];
    for (const t of times) if (t !== null && t > now && t < next) next = t;
  }
  return next;
}

/** The cart loads at its pickup: as much as there is, up to its capacity. */
function load(game: Game, trip: HaulTrip): void {
  trip.loaded = true;
  const obj = trip.from ? game.getObject(trip.from) : undefined;
  if (!obj || obj.site) return;
  let room = CART_CAPACITY - units(trip.load);
  if (isResourceType(obj.type)) {
    const s = obj.state as ResourceState;
    const n = Math.min(room, s.waiting);
    if (n > 0) {
      s.waiting -= n;
      inventory.add(trip.load, RESOURCES[obj.type].output, n);
    }
  } else if (isProcessorType(obj.type)) {
    const p = obj as unknown as PlacedObject<processing.ProcessorState>;
    processing.settle(game.state, p);
    for (const [id, qty] of Object.entries(p.state.ready)) {
      const n = Math.min(room, qty);
      if (n <= 0) continue;
      room -= n;
      p.state.ready[id] = qty - n;
      if (p.state.ready[id] === 0) delete p.state.ready[id];
      inventory.add(trip.load, id, n);
    }
  }
  game.touch(obj);
}

/** The cart unloads at its store: as much as the stores have room for. The rest stays on the cart. */
function unload(game: Game, trip: HaulTrip): void {
  trip.unloaded = true;
  for (const [id, qty] of Object.entries(trip.load)) {
    const n = game.addItem(id, qty);
    if (n === 0) continue;
    inventory.remove(trip.load, id, n);
    game.activity.emit('hauled', { item: id, qty: n });
  }
}

/** The cart is back in the barn: what it still carries stays there as the barn's cargo. */
function park(game: Game, trip: HaulTrip): void {
  trip.parked = true;
  returnLoad(game, trip);
}

/**
 * Puts what a cart carries into its barn (a trip that ends, or a carter who left the farm). With the barn gone, it
 * goes into the stores even beyond their room, as goods from old saves may: nothing is ever lost.
 */
export function returnLoad(game: Game, trip: HaulTrip): void {
  if (units(trip.load) === 0) return;
  const barn = game.getObject(trip.barn);
  if (barn && isBarn(barn)) {
    const s = barnState(barn);
    for (const [id, n] of Object.entries(trip.load)) inventory.add(s.cargo, id, n);
    game.touch(barn);
  } else {
    for (const [id, n] of Object.entries(trip.load)) {
      inventory.add(game.state.inventory, id, n);
      game.events.emit('inventory', { itemId: id, count: game.count(id), delta: n });
    }
  }
  trip.load = {};
}

/** A barn being demolished: the goods parked on its cart go into the stores, beyond their room if need be. */
export function releaseCargo(game: Game, obj: PlacedObject): void {
  if (!isBarn(obj)) return;
  const s = barnState(obj);
  if (units(s.cargo) === 0) return;
  for (const [id, n] of Object.entries(s.cargo)) {
    inventory.add(game.state.inventory, id, n);
    game.events.emit('inventory', { itemId: id, count: game.count(id), delta: n });
  }
  s.cargo = {};
}

/** Loads, unloads and parks every cart whose moment for it has come. */
export function settleHauls(game: Game): void {
  const now = game.state.clock.elapsed;
  for (const { trip } of tripsOf(game.state, true)) {
    const at = (kind: LegKind) => endOf(trip, kind);
    if (!trip.loaded && (at('load') ?? Infinity) <= now) load(game, trip);
    if (!trip.unloaded && (at('unload') ?? Infinity) <= now) unload(game, trip);
    const ends = legEnds(trip);
    if (!trip.parked && ends[ends.length - 1] <= now) park(game, trip);
  }
}

// Where carts are --------------------------------------------------------------------

/** Where a cart parks in its barn, in tiles from the barn's top-left corner. */
export const PARK_AT: Point = { x: 2.35, y: 1.55 };

/** What a cart does: parked in the barn, its carter walking to or from it, driving, loading or unloading. */
export type CartLeg = 'parked' | LegKind;

export interface CartPose {
  leg: CartLeg;
  at: Point;
  /** The way it heads (grid units). */
  dir: Point;
  /** 0..1 through the leg. */
  t: number;
}

/** The point a share `t` (0..1) of the way along a polyline, and the direction it heads there. */
export function along(line: Point[], t: number): { at: Point; dir: Point } {
  const lengths = line.slice(1).map((p, i) => Math.hypot(p.x - line[i].x, p.y - line[i].y));
  let left = t * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dir = { x: b.x - a.x, y: b.y - a.y };
    if (left <= lengths[i] || i === lengths.length - 1) {
      const k = lengths[i] > 0 ? Math.min(1, left / lengths[i]) : 1;
      return { at: { x: a.x + dir.x * k, y: a.y + dir.y * k }, dir };
    }
    left -= lengths[i];
  }
  return { at: line[line.length - 1] ?? { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
}

/** Where a barn's cart stands when parked. */
export function parkedPose(barn: PlacedObject): CartPose {
  return { leg: 'parked', at: { x: barn.x + PARK_AT.x, y: barn.y + PARK_AT.y }, dir: { x: 0, y: 1 }, t: 0 };
}

/** Where the cart of a trip is at game time `now`. */
export function cartPose(trip: HaulTrip, barn: PlacedObject | undefined, now: number): CartPose | null {
  const ends = legEnds(trip);
  const i = ends.findIndex((end) => now < end);
  if (now < trip.start || i < 0) return barn ? parkedPose(barn) : null;
  const leg = trip.legs[i];
  const begin = ends[i] - leg.ms;
  const t = leg.ms > 0 ? (now - begin) / leg.ms : 1;
  if (leg.kind === 'drive') return { leg: 'drive', ...along(leg.way, t), t };
  // Standing to load or unload: facing the way it came.
  const prev = trip.legs[i - 1]?.way ?? leg.way;
  const dir = along(prev, 1).dir;
  return { leg: leg.kind, at: leg.way[0], dir, t };
}

export interface CartInfo {
  barn: string;
  /** The carter (farmer number) on the trip, or the barn's assigned farmer while parked; null when none. */
  farmer: number | null;
  /** `walk` while the carter walks to the barn or home (the cart is parked meanwhile). */
  leg: CartLeg | 'walk';
  at: Point;
  load: Inventory;
  from: string | null;
  to: string | null;
}

/** Every barn's cart: what it does, where, and with what on it (`window.farm.carts`). */
export function cartsOf(state: GameState): CartInfo[] {
  const now = state.clock.elapsed;
  const w = workersOf(state);
  const jobs = jobsByFarmer(state.clock, w);
  return state.objects.filter((o) => isBarn(o) && !o.site && barnState(o).ox).map((barn) => {
    const farmer = jobs.findIndex((j) => j?.haul?.barn === barn.id);
    const trip = farmer >= 0 ? jobs[farmer]!.haul! : null;
    const pose = trip ? cartPose(trip, barn, now) : null;
    if (!trip || !pose) {
      const assigned = w.workplaces.indexOf(barn.id);
      return { barn: barn.id, farmer: assigned >= 0 ? assigned : null, leg: 'parked', at: parkedPose(barn).at, load: { ...barnState(barn).cargo }, from: null, to: null };
    }
    const leg = pose.leg === 'parked' ? 'walk' : pose.leg;
    return { barn: barn.id, farmer, leg, at: pose.at, load: { ...trip.load }, from: trip.from, to: trip.to };
  });
}

/** Goods on carts and parked in barns, by item (for checks that nothing is lost). */
export function goodsOnCarts(state: GameState): Inventory {
  const out: Inventory = {};
  for (const { trip } of tripsOf(state)) for (const [id, n] of Object.entries(trip.load)) inventory.add(out, id, n);
  for (const o of state.objects) if (isBarn(o)) for (const [id, n] of Object.entries(barnState(o).cargo)) inventory.add(out, id, n);
  return out;
}
