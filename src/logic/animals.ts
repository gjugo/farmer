import { ANIMALS, FEED_PACK, FEED_SEASONS, isAnimalKind, PENS, type AnimalKind, type PenType } from '../data/animals';
import { MANURE_PER_COLLECT } from '../data/soil';
import { startTimer, timerDone, timerProgress, type Timer } from './clock';
import { DAY_MS } from './constants';
import type { Game } from './game';
import { perkFactor } from './perks';
import { seasonAt, SEASON_MS } from './seasons';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import type { ClockState, GameState, PlacedObject } from './types';

/**
 * One animal. Its production cycle is a game-clock timer, so hunger and progress
 * survive save/load: no timer = hungry, running = producing, done = product ready.
 */
export interface Animal {
  kind: AnimalKind;
  timer: Timer | null;
  /**
   * Game time it last became hungry (bought, or its product collected); null while it eats or its product waits.
   * An animal hungry since before a winter day began, with no feed for it when the day ends, starves.
   */
  hungrySince: number | null;
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
  for (const a of valid) {
    if (!isTimer(a.timer)) a.timer = null;
    if (a.timer || typeof a.hungrySince !== 'number' || !Number.isFinite(a.hungrySince)) a.hungrySince = null;
  }
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

export type BuyAnimalResult = { ok: true } | { ok: false; reason: 'wrong-pen' | 'level' | 'full' | 'money' };

export function capacityOf(obj: PlacedObject<PenState>): number {
  return isPenType(obj.type) ? PENS[obj.type].capacity : 0;
}

export function canHouse(obj: PlacedObject<PenState>, kind: AnimalKind): boolean {
  return isPenType(obj.type) && PENS[obj.type].animals.includes(kind);
}

/** Checks without changing anything; `buyAnimal` gives the same answer. */
export function checkBuyAnimal(game: Game, obj: PlacedObject<PenState>, kind: AnimalKind): BuyAnimalResult {
  if (!canHouse(obj, kind)) return { ok: false, reason: 'wrong-pen' };
  if (!game.isUnlocked(ANIMALS[kind].unlockLevel)) return { ok: false, reason: 'level' };
  if (animalsOf(obj).length >= capacityOf(obj)) return { ok: false, reason: 'full' };
  if (!game.canAfford(ANIMALS[kind].price)) return { ok: false, reason: 'money' };
  return { ok: true };
}

/** Charges the price and adds a hungry animal. Nothing changes when it fails. */
export function buyAnimal(game: Game, obj: PlacedObject<PenState>, kind: AnimalKind): BuyAnimalResult {
  const check = checkBuyAnimal(game, obj, kind);
  if (!check.ok) return check;
  if (!game.spend(ANIMALS[kind].price)) return { ok: false, reason: 'money' };
  obj.state.animals.push({ kind, timer: null, hungrySince: game.now });
  game.touch(obj);
  game.activity.emit('animalBought', { kind });
  return { ok: true };
}

/** Do animals graze at game time `t` (a cycle started then costs no feed)? Outside `FEED_SEASONS`, i.e. not in winter. */
export function grazingAt(t: number): boolean {
  return !FEED_SEASONS.includes(seasonAt(t));
}

/** Total feed needed to feed every hungry animal in the pen now: none while they graze. */
export function feedNeeded(game: Game, obj: PlacedObject<PenState>): number {
  if (grazingAt(game.now)) return 0;
  return animalsOf(obj)
    .filter((a) => animalStatus(game.state.clock, a) === 'hungry')
    .reduce((sum, a) => sum + ANIMALS[a.kind].feedPerCycle, 0);
}

/** Game ms of one production cycle of `kind`, with the Husbandry perk. */
export function cycleMsOf(state: GameState, kind: AnimalKind): number {
  return Math.round(ANIMALS[kind].cycleMs * perkFactor(state, 'husbandry'));
}

/**
 * Starts the production cycle of every hungry animal it can, in order. Outside winter they graze: no feed is taken.
 * In winter each takes its `feedPerCycle`; an animal that needs more feed than is left is skipped (a cheaper one later
 * may still be fed). Returns how many animals were fed (or sent out to graze).
 */
export function feedAll(game: Game, obj: PlacedObject<PenState>): number {
  const grazing = grazingAt(game.now);
  let fed = 0;
  for (const a of animalsOf(obj)) {
    if (animalStatus(game.state.clock, a) !== 'hungry') continue;
    const def = ANIMALS[a.kind];
    if (!grazing && !game.removeItem('feed', def.feedPerCycle)) continue;
    a.timer = startTimer(game.state.clock, cycleMsOf(game.state, a.kind));
    a.hungrySince = null;
    fed++;
  }
  if (fed > 0) {
    game.touch(obj);
    game.activity.emit('fed', { count: fed, grazing });
  }
  return fed;
}

export type BuyFeedResult = { ok: true } | { ok: false; reason: 'money' | 'full' };

/** Buys a pack of feed. Refused (nothing changes) when the player is short or the granaries can't take the whole pack. */
export function buyFeed(game: Game): BuyFeedResult {
  if (game.spaceFor('feed') < FEED_PACK.qty) return { ok: false, reason: 'full' };
  if (!game.spend(FEED_PACK.price)) return { ok: false, reason: 'money' };
  game.addItem('feed', FEED_PACK.qty);
  return { ok: true };
}

/**
 * Moves finished products into the inventory, as many as the granaries have room for; those animals become
 * hungry again. The rest stay ready in the pen (see `readyCount`). Each animal collected from also leaves
 * `MANURE_PER_COLLECT` manure, kept in the storehouse while it has room (the rest is lost, the product never
 * waits for it). Returns itemId → amount of products collected.
 */
export function collect(game: Game, obj: PlacedObject<PenState>): Record<string, number> {
  const got: Record<string, number> = {};
  for (const a of animalsOf(obj)) {
    if (animalStatus(game.state.clock, a) !== 'ready') continue;
    const product = ANIMALS[a.kind].product;
    if (game.addItem(product, 1) === 0) continue;
    got[product] = (got[product] ?? 0) + 1;
    a.timer = null;
    a.hungrySince = game.now;
  }
  const animals = Object.values(got).reduce((n, qty) => n + qty, 0);
  if (animals > 0) game.addItem('manure', animals * MANURE_PER_COLLECT);
  if (Object.keys(got).length > 0) game.touch(obj);
  for (const [item, qty] of Object.entries(got)) game.activity.emit('collected', { item, qty });
  return got;
}

export function readyCount(clock: ClockState, obj: PlacedObject<PenState>): number {
  return animalsOf(obj).filter((a) => animalStatus(clock, a) === 'ready').length;
}

// Winter feeding and starving ----------------------------------------------------------

/** Finished pens, in build order. */
export function pensOf(state: GameState): PlacedObject<PenState>[] {
  return state.objects.filter((o) => isPenType(o.type) && !o.site) as PlacedObject<PenState>[];
}

/** Cycles an animal of `kind` starts in one winter (perks included): a winter's length over its cycle, rounded up. */
export function winterCycles(state: GameState, kind: AnimalKind): number {
  return Math.ceil(SEASON_MS / cycleMsOf(state, kind));
}

/** Feed the farm's animals eat in one winter: each one's `feedPerCycle` × the cycles it runs in a winter. */
export function winterFeedNeed(state: GameState): number {
  let need = 0;
  for (const pen of pensOf(state)) for (const a of animalsOf(pen)) need += ANIMALS[a.kind].feedPerCycle * winterCycles(state, a.kind);
  return need;
}

/** Animals hungry now in a feeding season with not enough feed in stock for them: they starve if it stays so. */
export function starvingAnimals(game: Game): { pen: string; kind: AnimalKind }[] {
  if (grazingAt(game.now)) return [];
  const feed = game.count('feed');
  const out: { pen: string; kind: AnimalKind }[] = [];
  for (const pen of pensOf(game.state)) {
    for (const a of animalsOf(pen)) {
      if (animalStatus(game.state.clock, a) === 'hungry' && ANIMALS[a.kind].feedPerCycle > feed) out.push({ pen: pen.id, kind: a.kind });
    }
  }
  return out;
}

export const LIVESTOCK = 'livestock';

/** The farm's starving bookkeeping: the last day boundary checked (-1 before the first scheduler step). */
export interface LivestockState {
  checkedDay: number;
}

registerStateSlice<LivestockState>(LIVESTOCK, () => ({ checkedDay: -1 }));

export function livestockOf(state: GameState): LivestockState {
  const raw = getSlice<unknown>(state, LIVESTOCK);
  const s = isPlainObject(raw) ? raw : (state.ext[LIVESTOCK] = {});
  if (!Number.isInteger(s.checkedDay) || (s.checkedDay as number) < -1) s.checkedDay = -1;
  return s as unknown as LivestockState;
}

/** The animal that starves in a pen at the end of a winter day begun at `dayStart`, if one does: index in the pen. */
function victimIndex(game: Game, pen: PlacedObject<PenState>, dayStart: number): number {
  const feed = game.count('feed');
  const list = animalsOf(pen);
  let pick = -1;
  list.forEach((a, i) => {
    if (animalStatus(game.state.clock, a) !== 'hungry' || a.hungrySince === null || a.hungrySince > dayStart) return;
    if (ANIMALS[a.kind].feedPerCycle <= feed) return;
    // The one hungry longest; on a tie the last bought.
    if (pick < 0 || a.hungrySince <= list[pick].hungrySince!) pick = i;
  });
  return pick;
}

/**
 * The starving part of a scheduler step: at each day boundary, if the day that just ended was a winter (feeding) day,
 * every pen loses at most one animal that was hungry the whole day and still has no feed for it. Runs inside `runWork`
 * at every event (a new day is always one), so ×1, ×60 and offline catch-up agree; between day boundaries it does
 * nothing. Returns what starved.
 */
export function stepStarvation(game: Game): { pen: string; kind: AnimalKind }[] {
  const now = game.now;
  const s = livestockOf(game.state);
  const today = Math.floor(now / DAY_MS);
  // A hungry animal from a save that never noted when: hungry from now.
  for (const pen of pensOf(game.state)) {
    for (const a of animalsOf(pen)) if (a.hungrySince === null && animalStatus(game.state.clock, a) === 'hungry') a.hungrySince = now;
  }
  if (s.checkedDay < 0 || s.checkedDay >= today) {
    s.checkedDay = Math.max(s.checkedDay, today);
    return [];
  }
  s.checkedDay = today;
  const dayStart = (today - 1) * DAY_MS;
  if (grazingAt(dayStart)) return [];
  const starved: { pen: string; kind: AnimalKind }[] = [];
  for (const pen of pensOf(game.state)) {
    const i = victimIndex(game, pen, dayStart);
    if (i < 0) continue;
    const [dead] = pen.state.animals.splice(i, 1);
    game.touch(pen);
    starved.push({ pen: pen.id, kind: dead.kind });
    game.activity.emit('starved', { kind: dead.kind, pen: pen.id, penType: pen.type });
  }
  return starved;
}
