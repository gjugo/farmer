import { DAY_MS } from './constants';
import type { ClockState } from './types';

/** Real frame deltas above this are clamped, so a stalled tab does not fast-forward the farm. */
export const MAX_FRAME_MS = 250;

export function createClock(): ClockState {
  return { elapsed: 0, speed: 1 };
}

/** Advances game time by a real-time delta. Returns the game-time delta that was applied. */
export function advance(clock: ClockState, realDeltaMs: number): number {
  if (!(realDeltaMs > 0)) return 0;
  const gameDelta = Math.min(realDeltaMs, MAX_FRAME_MS) * clock.speed;
  clock.elapsed += gameDelta;
  return gameDelta;
}

/** 1-based day number. */
export function dayOf(clock: ClockState): number {
  return Math.floor(clock.elapsed / DAY_MS) + 1;
}

/** 0..1 progress through the current day. */
export function timeOfDay(clock: ClockState): number {
  return (clock.elapsed % DAY_MS) / DAY_MS;
}

/**
 * A timer measured in game time. Store it in an object's state; it keeps working
 * across saves and speeds up with the clock.
 */
export interface Timer {
  start: number;
  duration: number;
}

export function startTimer(clock: ClockState, durationMs: number): Timer {
  return { start: clock.elapsed, duration: Math.max(0, durationMs) };
}

export function timerProgress(clock: ClockState, timer: Timer): number {
  if (timer.duration <= 0) return 1;
  return Math.min(1, Math.max(0, (clock.elapsed - timer.start) / timer.duration));
}

export function timerRemaining(clock: ClockState, timer: Timer): number {
  return Math.max(0, timer.start + timer.duration - clock.elapsed);
}

export function timerDone(clock: ClockState, timer: Timer): boolean {
  return timerRemaining(clock, timer) === 0;
}
