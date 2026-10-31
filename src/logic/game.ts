import { getBuildable, type BuildableDef } from '../data/buildables';
import { materialEntries, type MaterialCost, type MaterialId } from '../data/materials';
import { buildWorkMs } from '../data/workers';
import type { ActivityEvents } from './activity';
import { dayOf, gameDelta } from './clock';
import { DEMOLISH_REFUND } from './constants';
import * as economy from './economy';
import { Emitter } from './events';
import * as inventory from './inventory';
import { setOwned } from './land';
import { clearUnder, mapOf, type MapLayer } from './maplayer';
import { canPlace, objectAt, type Footprint, type PlacementResult } from './placement';
import { Progression, type GoalView } from './progression';
import { createNewGame } from './state';
import { capacity, excessWithout, spaceFor, used } from './storage';
import type { GameState, ItemId, PlacedObject } from './types';
import { buildableUnlockLevel, isUnlocked, type Unlock } from './unlocks';
import { runWork } from './work';

export interface GameEvents {
  /** Money changed by `delta` (negative when spent). */
  money: { money: number; delta: number };
  inventory: { itemId: ItemId; count: number; delta: number };
  objectAdded: PlacedObject;
  objectRemoved: PlacedObject;
  /** An object's per-type state changed (call `game.touch(obj)` after mutating it). */
  objectChanged: PlacedObject;
  land: { x: number; y: number; owned: boolean };
  day: number;
  speed: number;
  /** XP was gained (or set by the debug panel). */
  xp: { xp: number; level: number; delta: number };
  /** A new level was reached; its bonus has been paid. */
  levelUp: { level: number; bonus: number; unlocks: Unlock[] };
  /** Active goals or their progress changed. */
  goals: GoalView[];
  /** Trees or deposits on the map changed (felled, used, cleared). Regrowth needs no event: it follows the clock. */
  map: MapLayer;
  /** The whole state was replaced (new game). Re-read everything. */
  reset: GameState;
}

export type PlaceResult =
  | { ok: true; object: PlacedObject }
  | { ok: false; reason: 'unknown-type' | 'money' | 'materials' | 'level' | Exclude<PlacementResult, { ok: true }>['reason'] };

/** Materials still missing to pay `cost`, e.g. `[['wood', 4]]`; empty when there is enough of each. */
export type MissingMaterials = [MaterialId, number][];

/** What demolishing an object would do: refused, or the money and materials back (and what doesn't fit). */
export type DemolishCheck =
  | { ok: true; money: number; materials: MaterialCost; lost: MaterialCost }
  | { ok: false; reason: 'missing' | 'fixed' }
  /** A storage building whose stock wouldn't fit without it: `excess` items too many. */
  | { ok: false; reason: 'storage'; excess: number };

export function footprintOf(obj: PlacedObject): Footprint {
  return getBuildable(obj.type)?.footprint ?? { w: 1, h: 1 };
}

export function demolishRefund(def: BuildableDef | undefined): number {
  return def ? Math.floor(def.cost * DEMOLISH_REFUND) : 0;
}

/** Materials given back on demolishing: the same share as the money, rounded down. */
export function demolishMaterialsRefund(def: BuildableDef | undefined): MaterialCost {
  const out: MaterialCost = {};
  for (const [id, qty] of materialEntries(def?.materials)) {
    const back = Math.floor(qty * DEMOLISH_REFUND);
    if (back > 0) out[id] = back;
  }
  return out;
}

/** What demolishing the object gives back: everything paid for an unfinished site, else part of the cost. */
export function refundOf(obj: PlacedObject): number {
  return obj.site ? obj.site.paid : demolishRefund(getBuildable(obj.type));
}

/** Materials demolishing the object gives back: all of them for an unfinished site, else part. */
export function materialsRefundOf(obj: PlacedObject): MaterialCost {
  const def = getBuildable(obj.type);
  return obj.site ? { ...def?.materials } : demolishMaterialsRefund(def);
}

export interface PlaceOptions {
  /**
   * Place it as a construction site (as the player does): unusable until a free farmer has built it.
   * Buildables that take no building work (paths) are finished at once anyway.
   */
  site?: boolean;
}

/**
 * The single owner of the game state. Every change goes through here so the
 * HUD, the scene and features can react through `events`.
 */
export class Game {
  readonly events = new Emitter<GameEvents>();
  /** What the player did (harvests, sales, ...), reported by feature logic. Drives goals and XP. */
  readonly activity = new Emitter<ActivityEvents>();
  readonly progression: Progression;
  private _state: GameState;
  private lastDay: number;

  constructor(state: GameState = createNewGame()) {
    this._state = state;
    this.lastDay = dayOf(state.clock);
    this.progression = new Progression(this);
  }

  /** The live state. Read freely; mutate only through Game methods (or `touch` after editing `obj.state`). */
  get state(): GameState {
    return this._state;
  }

  get money(): number {
    return this._state.money;
  }

  get day(): number {
    return dayOf(this._state.clock);
  }

  /** Game milliseconds since the farm was founded. Use this (never Date.now) for timers. */
  get now(): number {
    return this._state.clock.elapsed;
  }

  // Economy -------------------------------------------------------------------

  canAfford(amount: number): boolean {
    return economy.canAfford(this._state, amount);
  }

  spend(amount: number): boolean {
    if (!economy.spend(this._state, amount)) return false;
    if (amount > 0) this.events.emit('money', { money: this._state.money, delta: -amount });
    return true;
  }

  /** Adds money that is not income (refunds, rewards, bonuses): it gives no XP. */
  earn(amount: number): void {
    economy.earn(this._state, amount);
    if (amount > 0) this.events.emit('money', { money: this._state.money, delta: amount });
  }

  /** The shared income path: sales and other earnings pay through here and give 1 XP per $1. */
  earnIncome(amount: number): void {
    this.earn(amount);
    if (amount > 0) this.activity.emit('income', { amount });
  }

  // Progression -----------------------------------------------------------------

  get level(): number {
    return this.progression.level;
  }

  /** Has the farm reached `unlockLevel` (missing means level 1)? */
  isUnlocked(unlockLevel: number | undefined): boolean {
    return isUnlocked(this.level, unlockLevel);
  }

  // Inventory -----------------------------------------------------------------

  count(itemId: ItemId): number {
    return inventory.count(this._state.inventory, itemId);
  }

  /** How many more of `itemId` the farm has room for (see `src/logic/storage.ts`). */
  spaceFor(itemId: ItemId): number {
    return spaceFor(this._state, itemId);
  }

  /**
   * Puts items into the inventory, as many as there is room for: every way items come in goes through here.
   * Returns how many went in (`qty` when all fit); the caller keeps the rest where it was.
   */
  addItem(itemId: ItemId, qty = 1): number {
    if (!Number.isInteger(qty) || qty < 0) throw new RangeError(`Invalid quantity: ${qty}`);
    const n = Math.min(qty, this.spaceFor(itemId));
    if (n <= 0) return 0;
    inventory.add(this._state.inventory, itemId, n);
    this.events.emit('inventory', { itemId, count: this.count(itemId), delta: n });
    return n;
  }

  removeItem(itemId: ItemId, qty = 1): boolean {
    if (!inventory.remove(this._state.inventory, itemId, qty)) return false;
    if (qty > 0) this.events.emit('inventory', { itemId, count: this.count(itemId), delta: -qty });
    return true;
  }

  /** What is missing of `cost` in the inventory (empty when there is enough of everything). */
  missingMaterials(cost: MaterialCost | undefined): MissingMaterials {
    return materialEntries(cost).flatMap(([id, qty]) => {
      const short = qty - this.count(id);
      return short > 0 ? [[id, short] as [MaterialId, number]] : [];
    });
  }

  /** Can the farm pay for building `type` (money and materials)? */
  canPayFor(type: string): boolean {
    const def = getBuildable(type);
    return !!def && this.canAfford(def.cost) && this.missingMaterials(def.materials).length === 0;
  }

  // Land ----------------------------------------------------------------------

  setLandOwned(x: number, y: number, owned: boolean): void {
    setOwned(this._state.land, x, y, owned);
    this.events.emit('land', { x, y, owned });
  }

  // Objects -------------------------------------------------------------------

  getObject(id: string): PlacedObject | undefined {
    return this._state.objects.find((o) => o.id === id);
  }

  objectAt(x: number, y: number): PlacedObject | undefined {
    return objectAt(this._state, x, y, footprintOf);
  }

  objectsOfType(type: string): PlacedObject[] {
    return this._state.objects.filter((o) => o.type === type);
  }

  /** Can `type` be placed with its top-left at (x, y)? Ignores money and materials. */
  checkPlacement(type: string, x: number, y: number): PlacementResult | { ok: false; reason: 'unknown-type' | 'level' } {
    const def = getBuildable(type);
    if (!def) return { ok: false, reason: 'unknown-type' };
    if (!this.isUnlocked(buildableUnlockLevel(type))) return { ok: false, reason: 'level' };
    return canPlace(this._state, def.footprint, x, y, footprintOf, type);
  }

  /**
   * Validates, charges the money and materials and places the object (finished, unless `options.site`).
   * Nothing changes when it fails.
   */
  place(type: string, x: number, y: number, options: PlaceOptions = {}): PlaceResult {
    const def = getBuildable(type);
    if (!def) return { ok: false, reason: 'unknown-type' };
    const check = this.checkPlacement(type, x, y);
    if (!check.ok) return check;
    if (!this.canAfford(def.cost)) return { ok: false, reason: 'money' };
    if (this.missingMaterials(def.materials).length) return { ok: false, reason: 'materials' };
    this.spend(def.cost);
    for (const [id, qty] of materialEntries(def.materials)) this.removeItem(id, qty);
    const object: PlacedObject = {
      id: `o${this._state.nextObjectId++}`,
      type,
      x,
      y,
      state: def.initialState?.() ?? {},
    };
    const workMs = options.site ? buildWorkMs(type) : 0;
    if (workMs > 0) object.site = { workMs, paid: def.cost };
    this._state.objects.push(object);
    // Building over stumps (or a used-up deposit) clears them for good.
    if (clearUnder(mapOf(this._state), { x, y, ...def.footprint }, this.now, type)) this.mapChanged();
    this.events.emit('objectAdded', object);
    this.activity.emit('placed', { type });
    return { ok: true, object };
  }

  /**
   * What demolishing `id` would give back, without changing anything (`refundOf`, `materialsRefundOf`: all of it for
   * an unfinished site). Refunded materials only come back as far as the storehouses have room once the object is
   * gone; `lost` is the rest. A granary or storehouse can't go while its pool's stock wouldn't fit without it.
   */
  checkDemolish(id: string): DemolishCheck {
    const object = this.getObject(id);
    if (!object) return { ok: false, reason: 'missing' };
    const def = getBuildable(object.type);
    if (def?.fixed) return { ok: false, reason: 'fixed' };
    const excess = excessWithout(this._state, object);
    if (excess > 0) return { ok: false, reason: 'storage', excess };
    let room = Math.max(0, capacity(this._state, 'materials', id) - used(this._state, 'materials'));
    const materials: MaterialCost = {};
    const lost: MaterialCost = {};
    for (const [item, qty] of materialEntries(materialsRefundOf(object))) {
      const back = Math.min(qty, room);
      room -= back;
      if (back > 0) materials[item] = back;
      if (qty > back) lost[item] = qty - back;
    }
    return { ok: true, money: refundOf(object), materials, lost };
  }

  /**
   * Removes an object and refunds part of its money and materials (see `checkDemolish`).
   * Returns the money refund, or null when refused (not found, fixed like the farmhouse, or a storage building
   * whose stock wouldn't fit without it): then nothing changes.
   */
  demolish(id: string): number | null {
    const check = this.checkDemolish(id);
    if (!check.ok) return null;
    const i = this._state.objects.findIndex((o) => o.id === id);
    const [object] = this._state.objects.splice(i, 1);
    this.events.emit('objectRemoved', object);
    this.earn(check.money);
    for (const [item, qty] of materialEntries(check.materials)) this.addItem(item, qty);
    return check.money;
  }

  /** Announce that the map layer (`mapOf(state)`) was mutated, so its view and panels refresh. */
  mapChanged(): void {
    this.events.emit('map', mapOf(this._state));
  }

  /** Announce that `obj.state` was mutated, so views and panels refresh. */
  touch(obj: PlacedObject): void {
    this.events.emit('objectChanged', obj);
  }

  // Clock ---------------------------------------------------------------------

  /** Advances the clock by a real-time delta (farmers work on the way, see `advance`); returns the game-time delta. */
  tick(realDeltaMs: number): number {
    const dt = gameDelta(this._state.clock, realDeltaMs);
    this.advance(dt);
    const day = this.day;
    if (day !== this.lastDay) {
      this.lastDay = day;
      this.events.emit('day', day);
    }
    return dt;
  }

  /** Moves game time forward by `gameMs`, with farmers doing their work at the right moments on the way (`runWork`). */
  advance(gameMs: number): void {
    if (gameMs > 0) runWork(this, this._state.clock.elapsed + gameMs);
  }

  get speed(): number {
    return this._state.clock.speed;
  }

  setSpeed(speed: number): void {
    if (!(speed > 0)) throw new RangeError(`Invalid speed: ${speed}`);
    this._state.clock.speed = speed;
    this.events.emit('speed', speed);
  }

  // Whole state ---------------------------------------------------------------

  /** Replaces the state (new game or load) and notifies everyone. */
  reset(state: GameState = createNewGame()): void {
    this._state = state;
    this.lastDay = dayOf(state.clock);
    this.events.emit('reset', state);
  }

  /** Deep-copied, frozen snapshot for debugging and tests (`window.farm`). */
  snapshot(): Readonly<FarmSnapshot> {
    const { level, xp, xpToNext } = this.progression.info;
    const goals = this.progression.goals().map((g) => ({ id: g.def.id, title: g.def.title, progress: g.progress, target: g.target, complete: g.complete }));
    return deepFreeze({ ...structuredClone(this._state), day: this.day, level, xp, xpToNext, goals });
  }
}

export type FarmSnapshot = GameState & {
  day: number;
  level: number;
  /** Total XP. */
  xp: number;
  /** XP still missing for the next level; null at the top level. */
  xpToNext: number | null;
  goals: { id: string; title: string; progress: number; target: number; complete: boolean }[];
};

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}
