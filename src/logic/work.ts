import { ANIMALS } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { CROP_LIST, FIELD, getCrop, type CropDef } from '../data/crops';
import { findRecipe, isProcessorType } from '../data/processing';
import { isResourceType } from '../data/resourceBuildings';
import { PLOUGH_COST } from '../data/seasons';
import { COLLECT_WORK_MS, FEED_WORK_MS, FERTILISE_WORK_MS, HARVEST_WORK_MS, LOAD_WORK_MS, PLANT_WORK_MS, PLOUGH_WORK_MS, type JobKind } from '../data/workers';
import * as animals from './animals';
import { MANURE_BELOW } from '../data/soil';
import { nextFamiliesEvent, stepFamilies } from './families';
import { nextHazardEvent, stepHazards } from './hazards';
import { nextGardensEvent, stepGardens } from './gardens';
import { canPloughNow, checkFertilise, cropStage, fertilise, fertilityOf, fieldCrop, harvest, harvestYield, isPloughed, plant, plough, seasonCheck, type FieldState } from './crops';
import type { Game } from './game';
import { perkFactor } from './perks';
import * as processing from './processing';
import * as resources from './resources';
import { findRoute, type Route } from './roads';
import { nextSeasonAt } from './seasons';
import type { GameState, PlacedObject } from './types';
import { activeJobs, assignJob, cropPlanOf, jobPhase, jobsByFarmer, keepMakingOf, PLAN_BEST, PLAN_FALLOW, walkMs, workersOf } from './workers';

/**
 * The work scheduler: farmers assigned to a workplace do its next job by themselves, and free
 * farmers (no workplace, or nothing to do there) build construction sites, oldest first.
 *
 * It runs on game time, not frames: `runWork` steps the clock from one event (a job, crop, animal,
 * batch or resource cycle ending, a new season or day, a family moving in, a house garden's yield) to the next and hands out work at each, so a frame at ×60, a
 * hundred frames at ×1 and a week of offline catch-up all give the same farm. Between events
 * nothing a farmer could do changes, except what the player does, which the next call picks up.
 */

/**
 * A job a workplace has for its farmer: `run` does the work (paid now, as hand-ordered jobs are). It is told how long
 * the farmer's walk there takes, so a resource cycle can start when they arrive.
 */
export interface Task {
  kind: JobKind;
  workMs: number;
  run: (walkMs: number) => boolean;
}

/** Why a workplace has no job right now. */
export type WaitReason =
  | 'site' // still a construction site
  | 'growing' // a crop is growing
  | 'no-plan' // the crop plan is "Fallow"
  | 'season' // nothing on the plan can be sown now
  | 'money' // ploughing or seed costs more than the farm has
  | 'empty' // a pen without animals
  | 'fed' // every animal is eating
  | 'feed' // hungry animals, but no feed in stock
  | 'no-recipe' // no "Keep making" recipe
  | 'queue-full'
  | 'inputs' // the recipe's inputs are not in stock
  | 'full' // something is ready, but the granary has no room for it
  | 'cycle' // a resource cycle is still under way (its farmer was moved mid-cycle)
  | 'storehouse-full' // materials wait in the building, but the storehouse has no room for them
  | 'no-trees' // a woodcutter's lodge without a grown tree in range
  | 'exhausted'; // a quarry or mine whose deposit is used up

export type WorkplaceNext = { task: Task } | { wait: WaitReason; cost?: number };

const task = (kind: JobKind, workMs: number, run: (walkMs: number) => boolean): WorkplaceNext => ({ task: { kind, workMs, run } });

/**
 * The longest-growing unlocked crop that can be sown now and be ripe before its seasons end; null when none can.
 * It rotates: a crop other than `lastCrop` (the field's last harvest) comes first whenever one can be sown.
 */
export function bestCropNow(game: Game, lastCrop: string | null = null): CropDef | null {
  const ok = CROP_LIST.filter((c) => game.isUnlocked(c.unlockLevel) && seasonCheck(game.state.clock, c) === 'ok');
  return ok.sort((a, b) => Number(a.id === lastCrop) - Number(b.id === lastCrop) || b.growMs - a.growMs)[0] ?? null;
}

/** What the field's crop plan sows now, or null when it sows nothing now. */
export function plannedCrop(game: Game, fieldId: string): CropDef | null {
  const plan = cropPlanOf(game.state, fieldId);
  if (plan === PLAN_FALLOW) return null;
  if (plan === PLAN_BEST) {
    const last = (game.getObject(fieldId)?.state as FieldState | undefined)?.lastCrop;
    return bestCropNow(game, typeof last === 'string' ? last : null);
  }
  const crop = getCrop(plan);
  return crop && game.isUnlocked(crop.unlockLevel) && seasonCheck(game.state.clock, crop) === 'ok' ? crop : null;
}

function fieldNext(game: Game, obj: PlacedObject<FieldState>): WorkplaceNext {
  const clock = game.state.clock;
  const stage = cropStage(clock, obj.state);
  if (stage === 'ripe') {
    const crop = fieldCrop(obj.state)!;
    if (game.spaceFor(crop.harvestItem) < harvestYield(game.state, obj)) return { wait: 'full' };
    return task('harvest', HARVEST_WORK_MS, () => harvest(game, obj).ok);
  }
  if (stage !== 'empty') return { wait: 'growing' };
  if (cropPlanOf(game.state, obj.id) === PLAN_FALLOW) return { wait: 'no-plan' };
  // A worn field gets manure first, when there is enough in stock (whatever the season: it waits in the soil).
  if (fertilityOf(clock, obj) < MANURE_BELOW && checkFertilise(game, obj).ok) {
    return task('fertilise', FERTILISE_WORK_MS, () => fertilise(game, obj).ok);
  }
  const crop = plannedCrop(game, obj.id);
  if (!crop) return { wait: 'season' };
  if (!isPloughed(clock, obj.state)) {
    if (!canPloughNow(clock)) return { wait: 'season' };
    if (!game.canAfford(PLOUGH_COST)) return { wait: 'money', cost: PLOUGH_COST };
    return task('plough', PLOUGH_WORK_MS, () => plough(game, obj).ok);
  }
  if (!game.canAfford(crop.plantCost)) return { wait: 'money', cost: crop.plantCost };
  return task('plant', PLANT_WORK_MS, () => plant(game, obj, crop.id).ok);
}

function penNext(game: Game, obj: PlacedObject<animals.PenState>): WorkplaceNext {
  const clock = game.state.clock;
  const list = animals.animalsOf(obj);
  const ready = list.filter((a) => animals.animalStatus(clock, a) === 'ready');
  if (ready.some((a) => game.spaceFor(ANIMALS[a.kind].product) > 0)) {
    return task('collect', COLLECT_WORK_MS, () => Object.keys(animals.collect(game, obj)).length > 0);
  }
  // Products left waiting for room: feed the hungry ones meanwhile, else say the granary is full.
  const wait = (reason: WaitReason): WorkplaceNext => ({ wait: ready.length > 0 ? 'full' : reason });
  if (list.length === 0) return { wait: 'empty' };
  const hungry = list.filter((a) => animals.animalStatus(clock, a) === 'hungry');
  if (hungry.length === 0) return wait('fed');
  if (!hungry.some((a) => ANIMALS[a.kind].feedPerCycle <= game.count('feed'))) return wait('feed');
  return task('feed', FEED_WORK_MS, () => animals.feedAll(game, obj) > 0);
}

function processorNext(game: Game, obj: PlacedObject<processing.ProcessorState>): WorkplaceNext {
  const ready = Object.entries(obj.state.ready).filter(([, n]) => n > 0);
  if (ready.some(([item]) => game.spaceFor(item) > 0)) {
    return task('collect', COLLECT_WORK_MS, () => Object.keys(processing.collect(game, obj)).length > 0);
  }
  // Goods left waiting for room: keep the queue going meanwhile, else say the granary is full.
  const wait = (reason: WaitReason): WorkplaceNext => ({ wait: ready.length > 0 ? 'full' : reason });
  const recipe = keepMakingOf(game.state, obj.id);
  if (!recipe || !findRecipe(obj.type, recipe)) return wait('no-recipe');
  const check = processing.checkStart(game, obj, recipe);
  if (!check.ok) return wait(check.reason === 'queue-full' ? 'queue-full' : 'inputs');
  return task('load', LOAD_WORK_MS, () => processing.startJob(game, obj, recipe).ok);
}

function resourceNext(game: Game, obj: PlacedObject<resources.ResourceState>): WorkplaceNext {
  const def = resources.defOf(obj);
  if (obj.state.cycle) return { wait: 'cycle' };
  if (obj.state.waiting > 0) {
    if (game.spaceFor(def.output) === 0) return { wait: 'storehouse-full' };
    return task('collect', COLLECT_WORK_MS, () => resources.collect(game, obj) > 0);
  }
  if (def.deposit && !resources.depositOf(game, obj)) return { wait: 'exhausted' };
  if (!resources.hasTree(game, obj)) return { wait: 'no-trees' };
  return task(def.job, resources.cycleMsAt(def, game.now), (walk) => resources.startCycle(game, obj, walk));
}

/** The job a workplace has now, or why it has none. Processing output should be settled first (`runWork` does). */
export function workplaceNext(game: Game, obj: PlacedObject): WorkplaceNext {
  if (obj.site) return { wait: 'site' };
  if (obj.type === FIELD) return fieldNext(game, obj as unknown as PlacedObject<FieldState>);
  if (animals.isPenType(obj.type)) return penNext(game, obj as unknown as PlacedObject<animals.PenState>);
  if (isProcessorType(obj.type)) return processorNext(game, obj as unknown as PlacedObject<processing.ProcessorState>);
  if (isResourceType(obj.type)) return resourceNext(game, obj as unknown as PlacedObject<resources.ResourceState>);
  return { wait: 'no-recipe' };
}

/** The object's tiles. */
function areaOf(obj: PlacedObject) {
  return { x: obj.x, y: obj.y, ...(getBuildable(obj.type)?.footprint ?? { w: 1, h: 1 }) };
}

/** The farmer building the site, and how far the building work is (0..1); null while nobody builds it. */
export function siteProgress(state: GameState, objectId: string): { farmer: number; progress: number } | null {
  const w = workersOf(state);
  const jobs = jobsByFarmer(state.clock, w);
  const farmer = jobs.findIndex((j) => j?.target === objectId && j.doneAt !== undefined);
  if (farmer < 0) return null;
  const { phase, t } = jobPhase(state.clock, jobs[farmer]!);
  return { farmer, progress: phase === 'out' ? 0 : phase === 'work' ? t : 1 };
}

/** Construction sites in the order farmers build them: oldest first. */
export function sitesOf(state: GameState): PlacedObject[] {
  return state.objects.filter((o) => o.site);
}

function finishSite(game: Game, obj: PlacedObject): void {
  delete obj.site;
  game.touch(obj);
  game.activity.emit('built', { type: obj.type });
}

/** Called when processing batches finished in a building the scheduler looked at. */
export type SettledHook = (obj: PlacedObject<processing.ProcessorState>, finished: number) => void;

/** Assigned processing buildings: settle their queues so finished goods show as ready. */
function settleAssigned(game: Game, onSettled: SettledHook): void {
  for (const id of workersOf(game.state).workplaces) {
    const obj = id ? game.getObject(id) : undefined;
    if (!obj || obj.site || !isProcessorType(obj.type)) continue;
    const p = obj as unknown as PlacedObject<processing.ProcessorState>;
    const n = processing.settle(game.state, p);
    if (n > 0) onSettled(p, n);
  }
}

/** Resource buildings: end the cycles that are over, putting their yield in the storehouses (or waiting in the building). */
function settleResources(game: Game): void {
  for (const obj of game.state.objects) {
    if (isResourceType(obj.type) && obj.state.cycle) resources.settle(game, obj as unknown as PlacedObject<resources.ResourceState>);
  }
}

/** Finishes sites whose building work is over, then gives every free farmer the next job there is. */
function step(game: Game, routes: Map<string, Route | null>, onSettled: SettledHook): void {
  const { state } = game;
  const now = state.clock.elapsed;
  const w = workersOf(state);
  for (const job of w.jobs) {
    if (job.doneAt === undefined || job.doneAt > now) continue;
    delete job.doneAt;
    const obj = job.target ? game.getObject(job.target) : undefined;
    if (obj?.site) finishSite(game, obj);
  }
  // A site demolished while being built: its builder is home at once.
  w.jobs = activeJobs(state.clock, w).filter((j) => j.doneAt === undefined || !!game.getObject(j.target ?? '')?.site);
  settleAssigned(game, onSettled);
  settleResources(game);
  // Hazards first (a harsh winter or drought starting today counts for today), then new days (meals, firewood,
  // clothes, approval, departures) and arrivals, before work is handed out.
  stepHazards(game);
  stepFamilies(game);
  // House gardens yield after the meal, and carry in what waits as room appears.
  stepGardens(game);

  const routeTo = (obj: PlacedObject): Route | null => {
    if (!routes.has(obj.id)) routes.set(obj.id, findRoute(state, areaOf(obj)));
    return routes.get(obj.id)!;
  };
  const start = (farmer: number, kind: JobKind, obj: PlacedObject, workMs: number, route: Route, builds = false) => {
    const a = areaOf(obj);
    assignJob(game, kind, a.x + a.w / 2, a.y + a.h / 2, workMs, route, { farmer, target: obj.id, builds });
  };

  const busy = jobsByFarmer(state.clock, w);
  const building = new Set(w.jobs.filter((j) => j.doneAt !== undefined).map((j) => j.target));
  for (let i = 0; i < w.farmers; i++) {
    if (busy[i]) continue;
    const id = w.workplaces[i];
    const workplace = id ? game.getObject(id) : undefined;
    if (workplace && !workplace.site) {
      const next = workplaceNext(game, workplace);
      const route = 'task' in next ? routeTo(workplace) : null;
      if ('task' in next && route && next.task.run(walkMs(route, perkFactor(state, 'good-boots')))) {
        start(i, next.task.kind, workplace, next.task.workMs, route);
        continue;
      }
    }
    // Free: build the oldest site a path leads to that nobody is building.
    const site = sitesOf(state).find((o) => !building.has(o.id) && routeTo(o));
    if (site) {
      start(i, 'build', site, site.site!.workMs, routeTo(site)!, true);
      building.add(site.id);
    }
  }
}

/**
 * The next game time after now at which a farmer may find new work: a job, crop, animal cycle, batch or resource cycle
 * ends, a tree a waiting lodge could fell grows back, a season or a day begins (the families settle their needs), a
 * family is due to move in, or a hazard is due (crows land, a fox comes, a drought starts or ends).
 */
export function nextWorkEvent(game: Game): number {
  const { state } = game;
  const now = state.clock.elapsed;
  const w = workersOf(state);
  let next = Infinity;
  const at = (t: number) => {
    if (t > now && t < next) next = t;
  };
  for (const j of w.jobs) {
    at(j.timer.start + j.timer.duration);
    if (j.doneAt !== undefined) at(j.doneAt);
  }
  let fields = false;
  for (const id of w.workplaces) {
    const obj = id ? game.getObject(id) : undefined;
    if (!obj || obj.site) continue;
    if (obj.type === FIELD) {
      fields = true;
      const timer = (obj.state as FieldState).timer;
      if (timer) at(timer.start + timer.duration);
    } else if (animals.isPenType(obj.type)) {
      for (const a of animals.animalsOf(obj as unknown as PlacedObject<animals.PenState>)) if (a.timer) at(a.timer.start + a.timer.duration);
    } else if (isProcessorType(obj.type)) {
      const head = (obj.state as processing.ProcessorState).queue[0];
      if (head?.timer) at(head.timer.start + head.timer.duration);
    } else if (isResourceType(obj.type) && !resources.hasTree(game, obj)) {
      // A lodge waiting for a tree wakes when the next one in range grows back.
      const t = resources.nextTreeAt(game, obj);
      if (t !== null) at(t);
    }
  }
  // Any resource cycle, assigned or not: one keeps going when its farmer is moved mid-cycle.
  for (const obj of state.objects) {
    const cycle = isResourceType(obj.type) ? (obj.state as resources.ResourceState).cycle : null;
    if (cycle) at(cycle.start + cycle.duration);
  }
  if (fields) at(nextSeasonAt(now));
  at(nextFamiliesEvent(state));
  at(nextHazardEvent(state));
  at(nextGardensEvent(state));
  return next;
}

export interface RunWorkOptions {
  /** Processing batches finished in an assigned building (live: announce them; offline catch-up: count them). */
  onSettled?: SettledHook;
}

/**
 * Moves the clock forward to game time `to`, handing out farm work at every event on the way.
 * The clock ends at `to` (never earlier than it was).
 */
export function runWork(game: Game, to: number, options: RunWorkOptions = {}): void {
  const clock = game.state.clock;
  const onSettled: SettledHook =
    options.onSettled ??
    ((obj, count) => {
      game.touch(obj);
      game.activity.emit('jobsFinished', { count });
    });
  const routes = new Map<string, Route | null>();
  for (;;) {
    step(game, routes, onSettled);
    const next = nextWorkEvent(game);
    if (next > to) break;
    clock.elapsed = next;
  }
  if (to > clock.elapsed) clock.elapsed = to;
}
