import { BASE_HIRE_COST, HIRE_COST_GROWTH, MAX_FARMERS, STARTING_FARMERS, type JobKind } from '../data/workers';
import { startTimer, timerDone, type Timer } from './clock';
import type { Game } from './game';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import type { ClockState, GameState } from './types';

/** One job in progress: which farmer does what, where, until when. */
export interface Job {
  kind: JobKind;
  /** Grid point (in tiles, may be fractional) where the farmer works, for the view. */
  x: number;
  y: number;
  timer: Timer;
}

export interface WorkersState {
  /** Farmers employed, including the starting one. */
  farmers: number;
  /** Jobs in progress; finished ones are dropped lazily. Never longer than `farmers`. */
  jobs: Job[];
}

registerStateSlice<WorkersState>('workers', () => ({ farmers: STARTING_FARMERS, jobs: [] }));

/** The workers slice, repaired if a save holds something malformed. */
export function workersOf(state: GameState): WorkersState {
  const w = getSlice<WorkersState>(state, 'workers');
  if (!Number.isInteger(w.farmers) || w.farmers < STARTING_FARMERS) w.farmers = STARTING_FARMERS;
  if (w.farmers > MAX_FARMERS) w.farmers = MAX_FARMERS;
  if (!Array.isArray(w.jobs)) w.jobs = [];
  else w.jobs = w.jobs.filter((j) => isPlainObject(j) && isPlainObject(j.timer) && typeof j.timer.start === 'number' && typeof j.timer.duration === 'number');
  return w;
}

/** Jobs still running. */
export function activeJobs(clock: ClockState, w: WorkersState): Job[] {
  return w.jobs.filter((j) => !timerDone(clock, j.timer));
}

export function busyFarmers(state: GameState): number {
  return Math.min(workersOf(state).farmers, activeJobs(state.clock, workersOf(state)).length);
}

export function freeFarmers(state: GameState): number {
  return workersOf(state).farmers - busyFarmers(state);
}

/** Game ms until the next farmer is free (0 when one is free now). */
export function nextFreeIn(state: GameState): number {
  if (freeFarmers(state) > 0) return 0;
  const { clock } = state;
  return Math.min(...activeJobs(clock, workersOf(state)).map((j) => j.timer.start + j.timer.duration - clock.elapsed));
}

/**
 * Puts a free farmer on a job for `durationMs` of game time. Returns false (nothing
 * changes) when every farmer is busy. A job of 0 ms needs no farmer and always succeeds.
 */
export function assignJob(game: Game, kind: JobKind, x: number, y: number, durationMs: number): boolean {
  if (durationMs <= 0) return true;
  const { state } = game;
  if (freeFarmers(state) <= 0) return false;
  const w = workersOf(state);
  w.jobs = activeJobs(state.clock, w);
  w.jobs.push({ kind, x, y, timer: startTimer(state.clock, durationMs) });
  game.activity.emit('workStarted', { kind });
  return true;
}

/** Price of the next farmer, or null at `MAX_FARMERS`. */
export function hireCost(state: GameState): number | null {
  const { farmers } = workersOf(state);
  if (farmers >= MAX_FARMERS) return null;
  return Math.round((BASE_HIRE_COST * HIRE_COST_GROWTH ** (farmers - STARTING_FARMERS)) / 10) * 10;
}

export type HireResult = { ok: true; farmers: number } | { ok: false; reason: 'max' | 'money' };

/** Pays for and adds one farmer. Nothing changes when it fails. */
export function hireFarmer(game: Game): HireResult {
  const cost = hireCost(game.state);
  if (cost === null) return { ok: false, reason: 'max' };
  if (!game.spend(cost)) return { ok: false, reason: 'money' };
  const w = workersOf(game.state);
  w.farmers++;
  game.activity.emit('hired', { farmers: w.farmers });
  return { ok: true, farmers: w.farmers };
}
