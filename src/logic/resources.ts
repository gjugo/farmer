import { RESOURCES, SLOW_SEASONS, type ResourceDef, type ResourceType } from '../data/resourceBuildings';
import { dayOf, timerDone, timerProgress, type Timer } from './clock';
import type { Game } from './game';
import { findRoute } from './roads';
import { isPlainObject } from './slices';
import { seasonAt } from './seasons';
import type { ClockState, PlacedObject } from './types';
import { workerAt } from './workers';

/**
 * Woodcutter's lodge, quarry and mine. The building holds the cycle its farmer is working: the work scheduler
 * (`src/logic/work.ts`) starts it when the farmer sets off, timed to end with their work, and `settle` puts the
 * yield in the storehouses when it ends. What doesn't fit waits in the building, and the farmer does other work
 * until there is room and they carry it in. Nothing is ever lost.
 */

// A type alias (not an interface) so it fits `PlacedObject<Record<string, unknown>>`.
export type ResourceState = {
  /** The cycle being worked: from the end of the farmer's walk there to the end of their work. Null between cycles. */
  cycle: Timer | null;
  /** Output that did not fit in the storehouses. A new cycle starts only once it has been carried in. */
  waiting: number;
  /** The day `today` counts. */
  day: number;
  /** Made on `day` (stored or waiting). */
  today: number;
};

export function defOf(obj: PlacedObject): ResourceDef {
  return RESOURCES[obj.type as ResourceType];
}

/** Repairs state from a save (or an older shape). */
export function sanitize(obj: PlacedObject<ResourceState>): void {
  const s = obj.state as unknown as Record<string, unknown>;
  const t = s.cycle;
  const cycle = isPlainObject(t) && Number.isFinite(t.start) && Number.isFinite(t.duration) ? { start: t.start as number, duration: t.duration as number } : null;
  const count = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : 0);
  obj.state = { cycle, waiting: count(s.waiting), day: count(s.day), today: count(s.today) };
}

/** Game ms a cycle started at game time `at` takes: longer in the cold seasons. */
export function cycleMsAt(def: ResourceDef, at: number): number {
  return Math.round(def.cycleMs * (SLOW_SEASONS[seasonAt(at)] ?? 1));
}

/** The building has a cycle under way (its farmer is walking there or working). */
export function isWorking(obj: PlacedObject<ResourceState>): boolean {
  return !!obj.state.cycle;
}

/** 0..1 progress of the cycle (0 while the farmer is still walking there), or null between cycles. */
export function cycleProgress(clock: ClockState, obj: PlacedObject<ResourceState>): number | null {
  const { cycle } = obj.state;
  return cycle ? timerProgress(clock, cycle) : null;
}

/** Made today, stored or waiting. */
export function todayYield(clock: ClockState, obj: PlacedObject<ResourceState>): number {
  return obj.state.day === dayOf(clock) ? obj.state.today : 0;
}

/**
 * Starts a cycle that begins once the farmer has walked there (`walkMs`) and lasts the work. Refused (false) while
 * a cycle runs, output waits or the building is still a site.
 */
export function startCycle(game: Game, obj: PlacedObject<ResourceState>, walkMs: number): boolean {
  if (obj.site || obj.state.cycle || obj.state.waiting > 0) return false;
  const start = game.now + Math.max(0, walkMs);
  obj.state.cycle = { start, duration: cycleMsAt(defOf(obj), start) };
  game.touch(obj);
  return true;
}

/**
 * Ends a finished cycle: the yield goes into the storehouses as far as they have room, the rest waits in the
 * building. Returns how much was made (0 when no cycle ended).
 */
export function settle(game: Game, obj: PlacedObject<ResourceState>): number {
  const { cycle } = obj.state;
  if (!cycle || !timerDone(game.state.clock, cycle)) return 0;
  const def = defOf(obj);
  obj.state.cycle = null;
  const stored = game.addItem(def.output, def.yield);
  obj.state.waiting += def.yield - stored;
  const day = dayOf({ elapsed: cycle.start + cycle.duration, speed: 1 });
  if (obj.state.day !== day) {
    obj.state.day = day;
    obj.state.today = 0;
  }
  obj.state.today += def.yield;
  game.touch(obj);
  game.activity.emit('produced', { item: def.output, qty: def.yield });
  return def.yield;
}

/** Carries waiting output into the storehouses, as much as fits. Returns how much went in. */
export function collect(game: Game, obj: PlacedObject<ResourceState>): number {
  if (obj.state.waiting <= 0) return 0;
  const n = game.addItem(defOf(obj).output, obj.state.waiting);
  if (n === 0) return 0;
  obj.state.waiting -= n;
  game.touch(obj);
  return n;
}

/** Why the building makes nothing now: no farmer, no path from the farmhouse, or its output waits for room. */
export type IdleReason = 'site' | 'no-farmer' | 'no-path' | 'storehouse-full';

/** Why nothing is being made, or null while it works (or is about to). */
export function idleReason(game: Game, obj: PlacedObject<ResourceState>): IdleReason | null {
  if (obj.site) return 'site';
  if (obj.state.cycle) return null;
  if (obj.state.waiting > 0 && game.spaceFor(defOf(obj).output) === 0) return 'storehouse-full';
  if (workerAt(game.state, obj.id) === null) return 'no-farmer';
  const fp = defOf(obj).footprint;
  if (!findRoute(game.state, { x: obj.x, y: obj.y, w: fp.w, h: fp.h })) return 'no-path';
  return null;
}
