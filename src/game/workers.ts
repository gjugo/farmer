import { ANIMALS } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { CROP_LIST, FIELD } from '../data/crops';
import { getItem } from '../data/items';
import { isProcessorType, PROCESSORS, recipeUnlockLevel, type RecipeDef } from '../data/processing';
import { isResourceType, RESOURCES } from '../data/resourceBuildings';
import { seasonNames } from '../data/seasons';
import { JOBS, type JobKind } from '../data/workers';
import { animalsOf, isPenType, type PenState } from '../logic/animals';
import { canPloughNow, formatDuration } from '../logic/crops';
import { cartPose, isBarn, type HaulTrip } from '../logic/haul';
import type { Game } from '../logic/game';
import { inputsOf } from '../logic/processing';
import { defOf } from '../logic/resources';
import { findRoute } from '../logic/roads';
import { fullMessage } from '../logic/storage';
import type { PlacedObject } from '../logic/types';
import { workplaceNext, type WorkplaceNext } from '../logic/work';
import {
  assignFarmer,
  assignJob,
  cropPlanOf,
  freeFarmers,
  isWorkplaceType,
  jobPhase,
  jobsByFarmer,
  keepMakingOf,
  nextFreeIn,
  PLAN_BEST,
  PLAN_FALLOW,
  setCropPlan,
  setKeepMaking,
  unassignFarmer,
  workerAt,
  workersOf,
  type Job,
  type JobPhase,
} from '../logic/workers';
import { carryLoad, type Load } from '../scenes/art';
import { formatMoney } from '../ui/dom';
import type { FarmContext, PanelAction, PanelChoice, PanelSpec } from './context';

/** Why farm work was refused, e.g. "All farmers are busy (next free in 0:03). Build a cottage for another family." */
export function busyMessage(ctx: FarmContext): string {
  return `All farmers are busy (next free in ${formatDuration(nextFreeIn(ctx.game.state))}). Build a cottage for another family.`;
}

/** Where the work happens: a buildable type with its footprint's top-left tile. */
export interface WorkSite {
  type: string;
  x: number;
  y: number;
}

export const NO_ROAD_MESSAGE = 'No path leads there. Lay a path from the farmhouse door so a farmer can walk to it.';

/** The work site's tiles. */
export function siteArea(site: WorkSite) {
  return { x: site.x, y: site.y, ...(getBuildable(site.type)?.footprint ?? { w: 1, h: 1 }) };
}

/** Can a farmer walk from the farmhouse to `site` along paths? */
export function reachable(ctx: FarmContext, site: WorkSite): boolean {
  return findRoute(ctx.game.state, siteArea(site)) !== null;
}

/**
 * Runs farm work that needs a farmer: refuses with a toast when every farmer is busy or no
 * path leads from the farmhouse to `site`, otherwise runs `action` and, when it succeeded,
 * sends a farmer along the path to `site` to work for `durationMs` of game time (and back).
 * Returns whether the action ran and succeeded.
 */
export function withFarmer(ctx: FarmContext, kind: JobKind, site: WorkSite, durationMs: number, action: () => boolean): boolean {
  if (durationMs <= 0) return action();
  if (freeFarmers(ctx.game.state) <= 0) {
    ctx.ui.toast(busyMessage(ctx), 'error');
    return false;
  }
  const area = siteArea(site);
  const route = findRoute(ctx.game.state, area);
  if (!route) {
    ctx.ui.toast(NO_ROAD_MESSAGE, 'error');
    return false;
  }
  if (!action()) return false;
  assignJob(ctx.game, kind, area.x + area.w / 2, area.y + area.h / 2, durationMs, route);
  return true;
}

// Workplaces: the farmer panel block, activity lines ---------------------------------

/** "🟫 Field 2": the object's name, numbered among objects of its type in build order. */
export function placeName(game: Game, obj: PlacedObject): string {
  const def = getBuildable(obj.type);
  const same = game.objectsOfType(obj.type);
  const n = same.length > 1 ? ` ${same.indexOf(obj) + 1}` : '';
  return `${def?.icon ? `${def.icon} ` : ''}${def?.name ?? obj.type}${n}`;
}

export const farmerName = (farmer: number) => `Farmer ${farmer + 1}`;

/** Why a workplace's farmer is waiting, e.g. "No feed in stock". */
export function waitText(game: Game, next: Exclude<WorkplaceNext, { task: unknown }>): string {
  switch (next.wait) {
    case 'site':
      return 'Still being built';
    case 'growing':
      return 'The crop is growing';
    case 'no-plan':
      return 'Crop plan is "Fallow": the soil rests';
    case 'season':
      return canPloughNow(game.state.clock) ? 'Nothing on the crop plan can be sown now' : 'The ground is frozen until spring';
    case 'money':
      return `Waiting for money: needs ${formatMoney(next.cost ?? 0)}`;
    case 'empty':
      return 'No animals yet';
    case 'fed':
      return 'The animals are eating';
    case 'feed':
      return 'No feed in stock: buy or mill some';
    case 'no-recipe':
      return 'Pick a recipe to keep making';
    case 'queue-full':
      return 'The queue is full';
    case 'inputs':
      return 'Waiting for ingredients';
    case 'full':
      return fullMessage('goods');
    case 'cycle':
      return 'Finishing the cycle under way';
    case 'storehouse-full':
      return fullMessage('materials');
    case 'no-trees':
      return 'No grown trees in range: waiting for stumps to grow back';
    case 'exhausted':
      return 'Deposit used up';
    case 'no-ox':
      return 'No ox';
    case 'nothing-to-haul':
      return 'Nothing to haul';
    case 'stores-full':
      return 'Stores full';
    case 'no-path': {
      const to = next.to ? game.getObject(next.to) : undefined;
      return `No path to ${to ? placeName(game, to) : 'the stores'}`;
    }
  }
}

/** What a carter does on the cart's legs: "Driving to 🪓 Woodcutter's Lodge", "Unloading at 🏚 Storehouse". */
function cartNote(game: Game, trip: HaulTrip): string {
  const name = (id: string | null) => {
    const obj = id ? game.getObject(id) : undefined;
    return obj ? placeName(game, obj) : 'the barn';
  };
  const pose = cartPose(trip, game.getObject(trip.barn), game.now);
  if (pose?.leg === 'load') return `Loading the cart at ${name(trip.from)}`;
  if (pose?.leg === 'unload') return `Unloading the cart at ${name(trip.to)}`;
  if (trip.unloaded || trip.parked) return 'Driving the cart back to the barn';
  return `Driving the cart to ${name(trip.loaded ? trip.to : trip.from)}`;
}

const PHASE_NOTE: Record<JobPhase, string> = { out: ' (on the way)', work: '', back: ' (heading home)' };

/** What farmer `i` is doing now, e.g. "🧺 Harvesting at 🟫 Field 2 (on the way)" or "Free · resting at the farmhouse". */
export function farmerActivity(game: Game, farmer: number): string {
  const { state } = game;
  const w = workersOf(state);
  const job = jobsByFarmer(state.clock, w)[farmer];
  if (job) {
    const at = job.target ? game.getObject(job.target) : undefined;
    const phase = jobPhase(state.clock, job).phase;
    if (job.haul && phase === 'work') return `${JOBS.haul.icon} ${cartNote(game, job.haul)}`;
    return `${JOBS[job.kind].icon} ${JOBS[job.kind].label}${at ? ` at ${placeName(game, at)}` : ''}${PHASE_NOTE[phase]}`;
  }
  const id = w.workplaces[farmer];
  const workplace = id ? game.getObject(id) : undefined;
  if (!workplace) return 'Free · resting at the farmhouse';
  if (findRoute(state, siteArea(workplace)) === null) return 'Free · no path leads to the workplace';
  const next = workplaceNext(game, workplace);
  return `Free · ${'task' in next ? 'work is waiting' : waitText(game, next).toLowerCase()}`;
}

/**
 * The item a job's `'item'` trip carries (see `CARRY` in `src/scenes/art.ts`), from its workplace and never the stock,
 * which changed when the job started: a pen's product (milk when cows live there), a resource building's output, or a
 * construction site's main material (wood when it costs any, else stone). Null for anything else (a sack).
 */
export function carriedItem(game: Game, job: Job): string | null {
  // Hand-ordered jobs have no target: they work on the object under their work spot.
  const obj = job.target ? game.getObject(job.target) : game.objectAt(Math.floor(job.x), Math.floor(job.y));
  if (!obj) return job.kind === 'build' ? 'stone' : null;
  if (job.kind === 'build') return (getBuildable(obj.type)?.materials?.wood ?? 0) > 0 ? 'wood' : 'stone';
  if (isPenType(obj.type)) {
    const kinds = animalsOf(obj as unknown as PlacedObject<PenState>).map((a) => a.kind);
    const kind = kinds.includes('cow') ? 'cow' : kinds[0];
    return kind ? ANIMALS[kind].product : null;
  }
  if (isResourceType(obj.type)) return defOf(obj).output;
  return null;
}

/** What the farmer on `job` carries right now: a load while walking out or back, else null. */
export function farmerLoad(game: Game, job: Job): Load | null {
  const { phase } = jobPhase(game.state.clock, job);
  return phase === 'work' ? null : carryLoad(job.kind, phase, carriedItem(game, job));
}

/** Crop plan choices: "Best in season", "Fallow" and every crop (locked ones disabled). */
function planChoice(ctx: FarmContext, obj: PlacedObject): PanelChoice {
  const { game } = ctx;
  return {
    id: 'crop-plan',
    label: '🌱 Crop plan',
    value: cropPlanOf(game.state, obj.id),
    options: [
      { value: PLAN_BEST, label: 'Best in season' },
      { value: PLAN_FALLOW, label: 'Fallow (rest the soil)' },
      ...CROP_LIST.map((c) => ({
        value: c.id,
        label: game.isUnlocked(c.unlockLevel) ? `${c.icon} ${c.name} (${seasonNames(c.seasons)})` : `🔒 ${c.name} · level ${c.unlockLevel}`,
        disabled: !game.isUnlocked(c.unlockLevel),
      })),
    ],
    onChange: (plan) => setCropPlan(game, obj.id, plan),
  };
}

/** "Keep making" choices: nothing, or one of the building's unlocked recipes. */
function recipeChoice(ctx: FarmContext, obj: PlacedObject): PanelChoice {
  const { game } = ctx;
  const def = isProcessorType(obj.type) ? PROCESSORS[obj.type] : null;
  const recipes = def ? def.recipes.filter((r) => game.isUnlocked(recipeUnlockLevel(def, r)) || keepMakingOf(game.state, obj.id) === r.id) : [];
  const name = (id: string) => getItem(id)?.name ?? id;
  // "1 Clothes from 2 Cloth" when two recipes would read the same.
  const label = (r: RecipeDef) => {
    const out = `${r.output.qty} ${name(r.output.item)}`;
    const same = recipes.filter((o) => o.output.item === r.output.item && o.output.qty === r.output.qty).length > 1;
    return same ? `${out} from ${inputsOf(r).map(([id, n]) => `${n} ${name(id)}`).join(' + ')}` : out;
  };
  return {
    id: 'keep-making',
    label: '⚙️ Keep making',
    value: keepMakingOf(game.state, obj.id) ?? '',
    options: [
      { value: '', label: 'Nothing' },
      ...recipes.map((r) => ({ value: r.id, label: label(r) })),
    ],
    onChange: (recipe) => setKeepMaking(game, obj.id, recipe || null),
  };
}

/**
 * The farmer block of a workplace's panel: who works there and what they do (or why they wait),
 * the crop plan or "Keep making" recipe, and Assign / Unassign. Null for anything else.
 */
export function workplacePanel(ctx: FarmContext, obj: PlacedObject): Pick<PanelSpec, 'lines' | 'choices' | 'actions'> | null {
  const { game } = ctx;
  if (!isWorkplaceType(obj.type) || obj.site) return null;
  const farmer = workerAt(game.state, obj.id);
  const lines: string[] = [];
  const actions: PanelAction[] = [];
  if (farmer === null) {
    lines.push(
      isResourceType(obj.type)
        ? `👨‍🌾 Assign a farmer to ${RESOURCES[obj.type].verb}: nothing is made without one.`
        : isBarn(obj)
          ? '👨‍🌾 No carter: assign a farmer to drive the oxcart.'
          : '👨‍🌾 No farmer works here: tap to have any free farmer do the work.',
    );
    actions.push({
      label: isResourceType(obj.type) ? `👨‍🌾 Assign a farmer to ${RESOURCES[obj.type].verb}` : isBarn(obj) ? '👨‍🌾 Assign a carter' : '👨‍🌾 Assign a farmer',
      variant: 'secondary',
      onClick: () => {
        const r = assignFarmer(game, obj.id);
        if (r.ok) ctx.ui.toast(`${farmerName(r.farmer)} now works at ${placeName(game, obj)}`, 'success');
        else ctx.ui.toast('Every farmer has a workplace. Build a cottage for another family, or move one in 👨‍🌾 Farmers.', 'error');
      },
    });
  } else {
    lines.push(`👨‍🌾 ${farmerName(farmer)} works here · ${farmerActivity(game, farmer)}`);
    actions.push({ label: `Unassign ${farmerName(farmer)}`, variant: 'secondary', onClick: () => unassignFarmer(game, farmer) });
  }
  const choices = obj.type === FIELD ? [planChoice(ctx, obj)] : isProcessorType(obj.type) ? [recipeChoice(ctx, obj)] : [];
  return { lines, choices, actions };
}
