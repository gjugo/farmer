import { getBuildable, type BuildableDef } from '../data/buildables';
import { advance, dayOf } from './clock';
import { DEMOLISH_REFUND } from './constants';
import * as economy from './economy';
import { Emitter } from './events';
import * as inventory from './inventory';
import { setOwned } from './land';
import { canPlace, objectAt, type Footprint, type PlacementResult } from './placement';
import { createNewGame } from './state';
import type { GameState, ItemId, PlacedObject } from './types';

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
  /** The whole state was replaced (new game). Re-read everything. */
  reset: GameState;
}

export type PlaceResult =
  | { ok: true; object: PlacedObject }
  | { ok: false; reason: 'unknown-type' | 'money' | Exclude<PlacementResult, { ok: true }>['reason'] };

export function footprintOf(obj: PlacedObject): Footprint {
  return getBuildable(obj.type)?.footprint ?? { w: 1, h: 1 };
}

export function demolishRefund(def: BuildableDef | undefined): number {
  return def ? Math.floor(def.cost * DEMOLISH_REFUND) : 0;
}

/**
 * The single owner of the game state. Every change goes through here so the
 * HUD, the scene and features can react through `events`.
 */
export class Game {
  readonly events = new Emitter<GameEvents>();
  private _state: GameState;
  private lastDay: number;

  constructor(state: GameState = createNewGame()) {
    this._state = state;
    this.lastDay = dayOf(state.clock);
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

  earn(amount: number): void {
    economy.earn(this._state, amount);
    if (amount > 0) this.events.emit('money', { money: this._state.money, delta: amount });
  }

  // Inventory -----------------------------------------------------------------

  count(itemId: ItemId): number {
    return inventory.count(this._state.inventory, itemId);
  }

  addItem(itemId: ItemId, qty = 1): void {
    inventory.add(this._state.inventory, itemId, qty);
    if (qty > 0) this.events.emit('inventory', { itemId, count: this.count(itemId), delta: qty });
  }

  removeItem(itemId: ItemId, qty = 1): boolean {
    if (!inventory.remove(this._state.inventory, itemId, qty)) return false;
    if (qty > 0) this.events.emit('inventory', { itemId, count: this.count(itemId), delta: -qty });
    return true;
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

  /** Can `type` be placed with its top-left at (x, y)? Ignores money. */
  checkPlacement(type: string, x: number, y: number): PlacementResult | { ok: false; reason: 'unknown-type' } {
    const def = getBuildable(type);
    if (!def) return { ok: false, reason: 'unknown-type' };
    return canPlace(this._state, def.footprint, x, y, footprintOf);
  }

  /** Validates, charges the cost and places the object. Nothing changes when it fails. */
  place(type: string, x: number, y: number): PlaceResult {
    const def = getBuildable(type);
    if (!def) return { ok: false, reason: 'unknown-type' };
    const check = canPlace(this._state, def.footprint, x, y, footprintOf);
    if (!check.ok) return check;
    if (!this.spend(def.cost)) return { ok: false, reason: 'money' };
    const object: PlacedObject = {
      id: `o${this._state.nextObjectId++}`,
      type,
      x,
      y,
      state: def.initialState?.() ?? {},
    };
    this._state.objects.push(object);
    this.events.emit('objectAdded', object);
    return { ok: true, object };
  }

  /** Removes an object and refunds part of its cost. Returns the refund, or null if not found. */
  demolish(id: string): number | null {
    const i = this._state.objects.findIndex((o) => o.id === id);
    if (i < 0) return null;
    const [object] = this._state.objects.splice(i, 1);
    const refund = demolishRefund(getBuildable(object.type));
    this.events.emit('objectRemoved', object);
    this.earn(refund);
    return refund;
  }

  /** Announce that `obj.state` was mutated, so views and panels refresh. */
  touch(obj: PlacedObject): void {
    this.events.emit('objectChanged', obj);
  }

  // Clock ---------------------------------------------------------------------

  /** Advances the clock by a real-time delta; returns the game-time delta. */
  tick(realDeltaMs: number): number {
    const dt = advance(this._state.clock, realDeltaMs);
    const day = this.day;
    if (day !== this.lastDay) {
      this.lastDay = day;
      this.events.emit('day', day);
    }
    return dt;
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
  snapshot(): Readonly<GameState & { day: number }> {
    return deepFreeze({ ...structuredClone(this._state), day: this.day });
  }
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}
