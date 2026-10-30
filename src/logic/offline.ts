import { ANIMALS } from '../data/animals';
import { FIELD, getCrop } from '../data/crops';
import { MAX_OFFLINE_MS, SUMMARY_MIN_AWAY_MS } from '../data/offline';
import { isProcessorType } from '../data/processing';
import { animalsOf, isPenType, type PenState } from './animals';
import { dayOf, type Timer } from './clock';
import type { Game } from './game';
import * as inventory from './inventory';
import { sanitize, settle, type ProcessorState } from './processing';
import type { GameState, Inventory, PlacedObject } from './types';

/** What happened while the player was away. Built from the timers that ended, never by diffing the whole state. */
export interface CatchUpResult {
  /** Real milliseconds away. Negative when the device clock went backwards. */
  awayMs: number;
  /** Game milliseconds applied, always at ×1: between 0 and `MAX_OFFLINE_MS`. */
  appliedMs: number;
  /** True when the absence was longer than `MAX_OFFLINE_MS` and the rest was dropped. */
  capped: boolean;
  /** Crop id → fields that became ripe. */
  cropsReady: Record<string, number>;
  /** Item id → goods made: animal products waiting in their pens and processing output waiting in buildings. */
  produced: Inventory;
  /** Processing jobs that finished. */
  jobsFinished: number;
  dayBefore: number;
  dayAfter: number;
  /** Ids of objects whose state changed, so their views can refresh. */
  changed: string[];
}

/** Game time at which a timer ends. */
function endOf(timer: Timer): number {
  return timer.start + timer.duration;
}

/**
 * Moves the farm forward by the real time the player was away, at ×1 whatever the
 * debug speed is. Every timer lives on the game clock as an end time, so jumping the
 * clock finishes crops and animal cycles exactly, and processing queues are settled
 * job by job (each next job starts when the previous one ended). Features that use
 * the clock properly follow without special cases; this only gathers the summary.
 */
export function catchUp(state: GameState, awayMs: number): CatchUpResult {
  const clock = state.clock;
  const appliedMs = Number.isFinite(awayMs) && awayMs > 0 ? Math.min(awayMs, MAX_OFFLINE_MS) : 0;
  const from = clock.elapsed;
  const result: CatchUpResult = {
    awayMs,
    appliedMs,
    capped: awayMs > MAX_OFFLINE_MS,
    cropsReady: {},
    produced: {},
    jobsFinished: 0,
    dayBefore: dayOf(clock),
    dayAfter: dayOf(clock),
    changed: [],
  };
  if (appliedMs === 0) return result;

  const processors = state.objects.filter((o) => isProcessorType(o.type)) as unknown as PlacedObject<ProcessorState>[];
  // Bring buildings up to date before the jump, so only jobs that end while away are counted.
  for (const obj of processors) {
    sanitize(obj, clock);
    settle(clock, obj);
  }

  clock.elapsed = from + appliedMs;
  const to = clock.elapsed;
  const endedAway = (timer: Timer | null) => !!timer && endOf(timer) > from && endOf(timer) <= to;
  const changed = new Set<string>();

  for (const obj of state.objects) {
    if (obj.type === FIELD) {
      const crop = typeof obj.state.crop === 'string' ? getCrop(obj.state.crop) : undefined;
      if (crop && endedAway(obj.state.timer as Timer | null)) {
        result.cropsReady[crop.id] = (result.cropsReady[crop.id] ?? 0) + 1;
        changed.add(obj.id);
      }
    } else if (isPenType(obj.type)) {
      for (const animal of animalsOf(obj as unknown as PlacedObject<PenState>)) {
        if (!endedAway(animal.timer)) continue;
        inventory.add(result.produced, ANIMALS[animal.kind].product, 1);
        changed.add(obj.id);
      }
    }
  }

  for (const obj of processors) {
    const before = { ...obj.state.ready };
    const finished = settle(clock, obj);
    if (finished === 0) continue;
    result.jobsFinished += finished;
    for (const [item, qty] of Object.entries(obj.state.ready)) inventory.add(result.produced, item, qty - (before[item] ?? 0));
    changed.add(obj.id);
  }

  result.dayAfter = dayOf(clock);
  result.changed = [...changed];
  return result;
}

/** Runs `catchUp` on a live game and tells the HUD, the scene and features about it. */
export function catchUpGame(game: Game, awayMs: number): CatchUpResult {
  const result = catchUp(game.state, awayMs);
  // A zero tick moves nothing but announces a new day.
  game.tick(0);
  for (const id of result.changed) {
    const obj = game.getObject(id);
    if (obj) game.touch(obj);
  }
  return result;
}

/** Whether the welcome-back summary should be shown for this catch-up. */
export function shouldShowSummary(result: CatchUpResult): boolean {
  return result.awayMs > SUMMARY_MIN_AWAY_MS;
}

/** "3 d 4 h", "2 h 5 min", "12 min", "40 s" for a real-time duration. */
export function formatAway(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const hr = Math.floor((s % 86_400) / 3600);
  const min = Math.floor((s % 3600) / 60);
  if (d > 0) return hr > 0 ? `${d} d ${hr} h` : `${d} d`;
  if (hr > 0) return min > 0 ? `${hr} h ${min} min` : `${hr} h`;
  if (min > 0) return `${min} min`;
  return `${s} s`;
}
