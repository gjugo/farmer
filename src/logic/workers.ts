import { WALK_MS_PER_TILE } from '../data/farmhouse';
import { BASE_HIRE_COST, HIRE_COST_GROWTH, MAX_FARMERS, STARTING_FARMERS, type JobKind } from '../data/workers';
import { startTimer, timerDone, type Timer } from './clock';
import type { Game } from './game';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import type { Route, Tile } from './roads';
import type { ClockState, GameState } from './types';

/**
 * One job in progress: which farmer does what, where, until when. The farmer walks from the
 * farmhouse along `route`, works, and walks back; the timer covers all three.
 */
export interface Job {
  kind: JobKind;
  /** Grid point (in tiles, may be fractional) where the farmer works, for the view. */
  x: number;
  y: number;
  timer: Timer;
  /** Which farmer (0-based) does it. Missing in saves from before routes. */
  farmer?: number;
  /** Path tiles from the farmhouse door to the site. Missing or empty: no walk. */
  route?: Tile[];
  /** Game ms of the walk each way. */
  walkMs?: number;
}

export type JobPhase = 'out' | 'work' | 'back';

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

/** Game ms to walk a route: from the bench to the door (one tile), along the path, then to the work spot. */
export function walkMs(route: Route): number {
  if (route.tiles.length === 0) return 0;
  const points = [...route.tiles.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 })), route.work];
  let tiles = 1;
  for (let i = 1; i < points.length; i++) tiles += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return Math.round(tiles * WALK_MS_PER_TILE);
}

/** Which part of the job is under way, and how far into that part (0..1). */
export function jobPhase(clock: ClockState, job: Job): { phase: JobPhase; t: number } {
  const walk = Math.min(job.walkMs ?? 0, job.timer.duration / 2);
  const at = Math.min(Math.max(clock.elapsed - job.timer.start, 0), job.timer.duration);
  if (at < walk) return { phase: 'out', t: at / walk };
  const work = job.timer.duration - 2 * walk;
  if (at < walk + work || walk === 0) return { phase: 'work', t: work > 0 ? (at - walk) / work : 1 };
  return { phase: 'back', t: (at - walk - work) / walk };
}

/** Jobs still running. */
export function activeJobs(clock: ClockState, w: WorkersState): Job[] {
  return w.jobs.filter((j) => !timerDone(clock, j.timer));
}

/**
 * Each farmer's running job (undefined while free), by farmer number. Jobs saved before farmers had
 * numbers go to the free ones in order.
 */
export function jobsByFarmer(clock: ClockState, w: WorkersState): (Job | undefined)[] {
  const out = new Array<Job | undefined>(w.farmers).fill(undefined);
  const jobs = activeJobs(clock, w);
  const loose: Job[] = [];
  for (const j of jobs) {
    if (Number.isInteger(j.farmer) && j.farmer! >= 0 && j.farmer! < w.farmers && !out[j.farmer!]) out[j.farmer!] = j;
    else loose.push(j);
  }
  for (const j of loose) {
    const i = out.findIndex((x) => !x);
    if (i >= 0) out[i] = j;
  }
  return out;
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
 * Puts a free farmer on a job: `durationMs` of game time at work, plus the walk there and back
 * along `route` (none without one; it then works at (x, y)). Returns false (nothing changes)
 * when every farmer is busy. A job of 0 ms needs no farmer and always succeeds.
 */
export function assignJob(game: Game, kind: JobKind, x: number, y: number, durationMs: number, route?: Route): boolean {
  if (durationMs <= 0) return true;
  const { state } = game;
  if (freeFarmers(state) <= 0) return false;
  const w = workersOf(state);
  w.jobs = activeJobs(state.clock, w);
  const farmer = jobsByFarmer(state.clock, w).findIndex((j) => !j);
  const walk = route ? walkMs(route) : 0;
  const at = route?.tiles.length ? route.work : { x, y };
  w.jobs.push({ kind, x: at.x, y: at.y, timer: startTimer(state.clock, durationMs + 2 * walk), farmer, route: route?.tiles ?? [], walkMs: walk });
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
