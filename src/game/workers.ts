import { getBuildable } from '../data/buildables';
import { CROP_LIST, FIELD } from '../data/crops';
import { getItem } from '../data/items';
import { isProcessorType, PROCESSORS } from '../data/processing';
import { isResourceType, RESOURCES } from '../data/resourceBuildings';
import { seasonNames } from '../data/seasons';
import { JOBS, type JobKind } from '../data/workers';
import { canPloughNow, formatDuration } from '../logic/crops';
import type { Game } from '../logic/game';
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
  type JobPhase,
} from '../logic/workers';
import { formatMoney } from '../ui/dom';
import type { FarmContext, PanelAction, PanelChoice, PanelSpec } from './context';

/** Why farm work was refused, e.g. "All farmers are busy (next free in 0:03). Hire more with 👨‍🌾 Farmers." */
export function busyMessage(ctx: FarmContext): string {
  return `All farmers are busy (next free in ${formatDuration(nextFreeIn(ctx.game.state))}). Hire more with 👨‍🌾 Farmers.`;
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
  }
}

const PHASE_NOTE: Record<JobPhase, string> = { out: ' (on the way)', work: '', back: ' (heading home)' };

/** What farmer `i` is doing now, e.g. "🧺 Harvesting at 🟫 Field 2 (on the way)" or "Free · resting at the farmhouse". */
export function farmerActivity(game: Game, farmer: number): string {
  const { state } = game;
  const w = workersOf(state);
  const job = jobsByFarmer(state.clock, w)[farmer];
  if (job) {
    const at = job.target ? game.getObject(job.target) : undefined;
    return `${JOBS[job.kind].icon} ${JOBS[job.kind].label}${at ? ` at ${placeName(game, at)}` : ''}${PHASE_NOTE[jobPhase(state.clock, job).phase]}`;
  }
  const id = w.workplaces[farmer];
  const workplace = id ? game.getObject(id) : undefined;
  if (!workplace) return 'Free · resting at the farmhouse';
  if (findRoute(state, siteArea(workplace)) === null) return 'Free · no path leads to the workplace';
  const next = workplaceNext(game, workplace);
  return `Free · ${'task' in next ? 'work is waiting' : waitText(game, next).toLowerCase()}`;
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

/** "Keep making" choices: nothing, or one of the building's recipes. */
function recipeChoice(ctx: FarmContext, obj: PlacedObject): PanelChoice {
  const { game } = ctx;
  const recipes = isProcessorType(obj.type) ? PROCESSORS[obj.type].recipes : [];
  return {
    id: 'keep-making',
    label: '⚙️ Keep making',
    value: keepMakingOf(game.state, obj.id) ?? '',
    options: [
      { value: '', label: 'Nothing' },
      ...recipes.map((r) => ({ value: r.id, label: `${r.output.qty} ${getItem(r.output.item)?.name ?? r.output.item}` })),
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
        : '👨‍🌾 No farmer works here: tap to have any free farmer do the work.',
    );
    actions.push({
      label: isResourceType(obj.type) ? `👨‍🌾 Assign a farmer to ${RESOURCES[obj.type].verb}` : '👨‍🌾 Assign a farmer',
      variant: 'secondary',
      onClick: () => {
        const r = assignFarmer(game, obj.id);
        if (r.ok) ctx.ui.toast(`${farmerName(r.farmer)} now works at ${placeName(game, obj)}`, 'success');
        else ctx.ui.toast('Every farmer has a workplace. Hire one, or move one in 👨‍🌾 Farmers.', 'error');
      },
    });
  } else {
    lines.push(`👨‍🌾 ${farmerName(farmer)} works here · ${farmerActivity(game, farmer)}`);
    actions.push({ label: `Unassign ${farmerName(farmer)}`, variant: 'secondary', onClick: () => unassignFarmer(game, farmer) });
  }
  const choices = obj.type === FIELD ? [planChoice(ctx, obj)] : isProcessorType(obj.type) ? [recipeChoice(ctx, obj)] : [];
  return { lines, choices, actions };
}
