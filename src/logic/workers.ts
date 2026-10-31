import { PENS } from '../data/animals';
import { FIELD } from '../data/crops';
import { WALK_MS_PER_TILE } from '../data/farmhouse';
import { PROCESSORS } from '../data/processing';
import { RESOURCES } from '../data/resourceBuildings';
import { MAX_FARMERS, STARTING_FARMERS, type JobKind } from '../data/workers';
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
  /** Id of the object worked on, when known (assigned work and building). */
  target?: string;
  /** Building only: game time the site is finished (the end of the work, before the walk back). Cleared once done. */
  doneAt?: number;
}

export type JobPhase = 'out' | 'work' | 'back';

/** What an assigned field sows: a crop id, the best crop in season, or nothing. */
export type CropPlan = string;
export const PLAN_BEST: CropPlan = 'best';
export const PLAN_NONE: CropPlan = 'none';

export interface WorkersState {
  /** Farmers employed, including the starting one. */
  farmers: number;
  /** Jobs in progress; finished ones are dropped lazily. Never longer than `farmers`. */
  jobs: Job[];
  /** Each farmer's workplace (object id), by farmer number; null when they have none. One farmer per workplace. */
  workplaces: (string | null)[];
  /** Field id → crop plan. A field without one sows nothing. */
  plans: Record<string, CropPlan>;
  /** Processing building id → the recipe its farmer keeps making. */
  recipes: Record<string, string>;
}

registerStateSlice<WorkersState>('workers', () => ({ farmers: STARTING_FARMERS, jobs: [], workplaces: [], plans: {}, recipes: {} }), shiftJobs);

/** Moves the saved jobs' work spots and routes by (dx, dy), for save migrations that move the farm. */
export function shiftJobs(saved: unknown, dx: number, dy: number): unknown {
  if (!isPlainObject(saved) || !Array.isArray(saved.jobs)) return saved;
  const move = <T>(t: T): T =>
    isPlainObject(t) && typeof t.x === 'number' && typeof t.y === 'number' ? { ...t, x: t.x + dx, y: t.y + dy } : t;
  const jobs = saved.jobs.map((j: unknown) => {
    const moved = move(j);
    return isPlainObject(moved) && Array.isArray(moved.route) ? { ...moved, route: moved.route.map(move) } : moved;
  });
  return { ...saved, jobs };
}

/** Fields, coops, pastures, processing and resource buildings: a farmer can be assigned to them. */
export function isWorkplaceType(type: string): boolean {
  return type === FIELD || Object.hasOwn(PENS, type) || Object.hasOwn(PROCESSORS, type) || Object.hasOwn(RESOURCES, type);
}

/**
 * The workers slice, repaired if a save holds something malformed. Assignments, plans and recipes
 * of objects that are gone (demolished) are dropped here.
 */
export function workersOf(state: GameState): WorkersState {
  const w = getSlice<WorkersState>(state, 'workers');
  if (!Number.isInteger(w.farmers) || w.farmers < STARTING_FARMERS) w.farmers = STARTING_FARMERS;
  if (w.farmers > MAX_FARMERS) w.farmers = MAX_FARMERS;
  if (!Array.isArray(w.jobs)) w.jobs = [];
  else w.jobs = w.jobs.filter((j) => isPlainObject(j) && isPlainObject(j.timer) && typeof j.timer.start === 'number' && typeof j.timer.duration === 'number');
  const types = new Map(state.objects.map((o) => [o.id, o.type]));
  const raw = Array.isArray(w.workplaces) ? w.workplaces : [];
  const seen = new Set<string>();
  w.workplaces = Array.from({ length: w.farmers }, (_, i) => {
    const id = raw[i];
    if (typeof id !== 'string' || seen.has(id) || !isWorkplaceType(types.get(id) ?? '')) return null;
    seen.add(id);
    return id;
  });
  w.plans = keepStrings(w.plans, (id) => types.get(id) === FIELD);
  w.recipes = keepStrings(w.recipes, (id) => Object.hasOwn(PROCESSORS, types.get(id) ?? ''));
  return w;
}

/** The string entries of `v` whose key passes `keep`, in place when nothing has to go. */
function keepStrings(v: unknown, keep: (id: string) => boolean): Record<string, string> {
  if (!isPlainObject(v)) return {};
  const entries = Object.entries(v);
  const ok = entries.filter((e): e is [string, string] => typeof e[1] === 'string' && keep(e[0]));
  return ok.length === entries.length ? (v as Record<string, string>) : Object.fromEntries(ok);
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

/** The farmer a hand-ordered job goes to: a free one without a workplace if there is one, else any free one; -1 when all are busy. */
export function pickFreeFarmer(state: GameState): number {
  const w = workersOf(state);
  const jobs = jobsByFarmer(state.clock, w);
  const free = jobs.flatMap((j, i) => (j ? [] : [i]));
  return free.find((i) => !w.workplaces[i]) ?? free[0] ?? -1;
}

export interface JobOptions {
  /** Which farmer does it (must be free); default: `pickFreeFarmer`. */
  farmer?: number;
  /** Id of the object worked on. */
  target?: string;
  /** Building: the site is finished when the work ends (see `Job.doneAt`). */
  builds?: boolean;
}

/**
 * Puts a free farmer on a job: `durationMs` of game time at work, plus the walk there and back
 * along `route` (none without one; it then works at (x, y)). Returns false (nothing changes)
 * when every farmer is busy. A job of 0 ms needs no farmer and always succeeds.
 */
export function assignJob(game: Game, kind: JobKind, x: number, y: number, durationMs: number, route?: Route, options: JobOptions = {}): boolean {
  if (durationMs <= 0) return true;
  const { state } = game;
  const w = workersOf(state);
  const farmer = options.farmer ?? pickFreeFarmer(state);
  if (farmer < 0 || farmer >= w.farmers || jobsByFarmer(state.clock, w)[farmer]) return false;
  w.jobs = activeJobs(state.clock, w);
  const walk = route ? walkMs(route) : 0;
  const at = route?.tiles.length ? route.work : { x, y };
  const job: Job = { kind, x: at.x, y: at.y, timer: startTimer(state.clock, durationMs + 2 * walk), farmer, route: route?.tiles ?? [], walkMs: walk };
  if (options.target) job.target = options.target;
  if (options.builds) job.doneAt = state.clock.elapsed + walk + durationMs;
  w.jobs.push(job);
  game.activity.emit('workStarted', { kind });
  return true;
}

// Workplaces ------------------------------------------------------------------------

/** The farmer (number) assigned to the object, or null. */
export function workerAt(state: GameState, objectId: string): number | null {
  const i = workersOf(state).workplaces.indexOf(objectId);
  return i >= 0 ? i : null;
}

export type AssignResult = { ok: true; farmer: number } | { ok: false; reason: 'not-workplace' | 'site' | 'taken' | 'no-farmer' };

/**
 * Makes `farmer` (default: the first farmer without a workplace) work at the object. A farmer who
 * worked somewhere else moves. A field gets the "Best in season" crop plan if it has none.
 */
export function assignFarmer(game: Game, objectId: string, farmer?: number): AssignResult {
  const obj = game.getObject(objectId);
  if (!obj || !isWorkplaceType(obj.type)) return { ok: false, reason: 'not-workplace' };
  if (obj.site) return { ok: false, reason: 'site' };
  const w = workersOf(game.state);
  const current = w.workplaces.indexOf(objectId);
  if (farmer === undefined) {
    if (current >= 0) return { ok: false, reason: 'taken' };
    farmer = w.workplaces.findIndex((id) => !id);
  }
  if (!Number.isInteger(farmer) || farmer < 0 || farmer >= w.farmers) return { ok: false, reason: 'no-farmer' };
  const before = w.workplaces[farmer];
  if (current >= 0) w.workplaces[current] = null;
  w.workplaces[farmer] = objectId;
  if (obj.type === FIELD && !(objectId in w.plans)) w.plans[objectId] = PLAN_BEST;
  const old = before && before !== objectId ? game.getObject(before) : undefined;
  if (old) game.touch(old);
  game.touch(obj);
  return { ok: true, farmer };
}

/** Takes `farmer` off their workplace; they are free for any work. */
export function unassignFarmer(game: Game, farmer: number): void {
  const w = workersOf(game.state);
  const id = w.workplaces[farmer];
  if (!id) return;
  w.workplaces[farmer] = null;
  const obj = game.getObject(id);
  if (obj) game.touch(obj);
}

/** The field's crop plan (`PLAN_NONE` when it has none). */
export function cropPlanOf(state: GameState, fieldId: string): CropPlan {
  return workersOf(state).plans[fieldId] ?? PLAN_NONE;
}

export function setCropPlan(game: Game, fieldId: string, plan: CropPlan): void {
  workersOf(game.state).plans[fieldId] = plan;
  const obj = game.getObject(fieldId);
  if (obj) game.touch(obj);
}

/** The recipe a processing building keeps making, or null. */
export function keepMakingOf(state: GameState, buildingId: string): string | null {
  return workersOf(state).recipes[buildingId] ?? null;
}

export function setKeepMaking(game: Game, buildingId: string, recipe: string | null): void {
  const w = workersOf(game.state);
  if (recipe) w.recipes[buildingId] = recipe;
  else delete w.recipes[buildingId];
  const obj = game.getObject(buildingId);
  if (obj) game.touch(obj);
}

/**
 * Adds one farmer, free and without a workplace (a family moved in, see `src/logic/families.ts`). Returns false at
 * `MAX_FARMERS`.
 */
export function addFarmer(game: Game): boolean {
  const w = workersOf(game.state);
  if (w.farmers >= MAX_FARMERS) return false;
  w.farmers++;
  w.workplaces.push(null);
  return true;
}

/**
 * The last farmer leaves (their family moved away): any job they were on is dropped (a site they were building waits
 * for another farmer) and their workplace is freed. Returns that workplace, or null when the farm is down to its
 * starting farmers and nobody leaves.
 */
export function removeFarmer(game: Game): { workplace: string | null } | null {
  const { state } = game;
  const w = workersOf(state);
  if (w.farmers <= STARTING_FARMERS) return null;
  const i = w.farmers - 1;
  const workplace = w.workplaces[i] ?? null;
  w.farmers--;
  w.workplaces.length = w.farmers;
  w.jobs = jobsByFarmer(state.clock, { ...w, farmers: i + 1 })
    .flatMap((j, k) => (j && k !== i ? [{ ...j, farmer: k }] : []));
  const obj = workplace ? game.getObject(workplace) : undefined;
  if (obj) game.touch(obj);
  return { workplace };
}
