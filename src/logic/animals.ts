import { ANIMALS, FEED_PACK, isAnimalKind, PENS, type AnimalKind, type PenType } from '../data/animals';
import { startTimer, timerDone, timerProgress, type Timer } from './clock';
import type { Game } from './game';
import type { ClockState, PlacedObject } from './types';

/**
 * One animal. Its production cycle is a game-clock timer, so hunger and progress
 * survive save/load: no timer = hungry, running = producing, done = product ready.
 */
export interface Animal {
  kind: AnimalKind;
  timer: Timer | null;
}

/** Per-object state of a coop or pasture. (A type alias, so it fits `PlacedObject`'s record state.) */
export type PenState = {
  animals: Animal[];
};

export type AnimalStatus = 'hungry' | 'producing' | 'ready';

export function createPenState(): PenState {
  return { animals: [] };
}

export function isPenType(type: string): type is PenType {
  return Object.hasOwn(PENS, type);
}

/** The pen's animals, dropping anything malformed (e.g. from an edited save). */
export function animalsOf(obj: PlacedObject<PenState>): Animal[] {
  const list = Array.isArray(obj.state.animals) ? obj.state.animals : [];
  const valid = list.filter((a) => a && isAnimalKind(a.kind));
  for (const a of valid) if (!isTimer(a.timer)) a.timer = null;
  if (valid.length !== list.length || !Array.isArray(obj.state.animals)) obj.state.animals = valid;
  return valid;
}

function isTimer(t: unknown): t is Timer {
  return !!t && typeof (t as Timer).start === 'number' && typeof (t as Timer).duration === 'number';
}

export function animalStatus(clock: ClockState, animal: Animal): AnimalStatus {
  if (!animal.timer) return 'hungry';
  return timerDone(clock, animal.timer) ? 'ready' : 'producing';
}

export function animalProgress(clock: ClockState, animal: Animal): number {
  return animal.timer ? timerProgress(clock, animal.timer) : 0;
}

export type BuyAnimalResult = { ok: true } | { ok: false; reason: 'wrong-pen' | 'full' | 'money' };

export function capacityOf(obj: PlacedObject<PenState>): number {
  return isPenType(obj.type) ? PENS[obj.type].capacity : 0;
}

export function canHouse(obj: PlacedObject<PenState>, kind: AnimalKind): boolean {
  return isPenType(obj.type) && PENS[obj.type].animals.includes(kind);
}

/** Checks without changing anything; `buyAnimal` gives the same answer. */
export function checkBuyAnimal(game: Game, obj: PlacedObject<PenState>, kind: AnimalKind): BuyAnimalResult {
  if (!canHouse(obj, kind)) return { ok: false, reason: 'wrong-pen' };
  if (animalsOf(obj).length >= capacityOf(obj)) return { ok: false, reason: 'full' };
  if (!game.canAfford(ANIMALS[kind].price)) return { ok: false, reason: 'money' };
  return { ok: true };
}

/** Charges the price and adds a hungry animal. Nothing changes when it fails. */
export function buyAnimal(game: Game, obj: PlacedObject<PenState>, kind: AnimalKind): BuyAnimalResult {
  const check = checkBuyAnimal(game, obj, kind);
  if (!check.ok) return check;
  if (!game.spend(ANIMALS[kind].price)) return { ok: false, reason: 'money' };
  obj.state.animals.push({ kind, timer: null });
  game.touch(obj);
  return { ok: true };
}

/** Total feed needed to feed every hungry animal in the pen. */
export function feedNeeded(game: Game, obj: PlacedObject<PenState>): number {
  return animalsOf(obj)
    .filter((a) => animalStatus(game.state.clock, a) === 'hungry')
    .reduce((sum, a) => sum + ANIMALS[a.kind].feedPerCycle, 0);
}

/**
 * Feeds every hungry animal it can, in order, starting its production cycle.
 * An animal that needs more feed than is left is skipped (a cheaper one later
 * may still be fed). Returns how many animals were fed.
 */
export function feedAll(game: Game, obj: PlacedObject<PenState>): number {
  let fed = 0;
  for (const a of animalsOf(obj)) {
    if (animalStatus(game.state.clock, a) !== 'hungry') continue;
    const def = ANIMALS[a.kind];
    if (!game.removeItem('feed', def.feedPerCycle)) continue;
    a.timer = startTimer(game.state.clock, def.cycleMs);
    fed++;
  }
  if (fed > 0) game.touch(obj);
  return fed;
}

/** Buys a pack of feed. Returns false (nothing changes) when the player is short. */
export function buyFeed(game: Game): boolean {
  if (!game.spend(FEED_PACK.price)) return false;
  game.addItem('feed', FEED_PACK.qty);
  return true;
}

/**
 * Moves every finished product into the inventory; those animals become hungry
 * again. Returns itemId → amount collected (empty when nothing was ready).
 */
export function collect(game: Game, obj: PlacedObject<PenState>): Record<string, number> {
  const got: Record<string, number> = {};
  for (const a of animalsOf(obj)) {
    if (animalStatus(game.state.clock, a) !== 'ready') continue;
    const product = ANIMALS[a.kind].product;
    game.addItem(product, 1);
    got[product] = (got[product] ?? 0) + 1;
    a.timer = null;
  }
  if (Object.keys(got).length > 0) game.touch(obj);
  return got;
}

export function readyCount(clock: ClockState, obj: PlacedObject<PenState>): number {
  return animalsOf(obj).filter((a) => animalStatus(clock, a) === 'ready').length;
}
