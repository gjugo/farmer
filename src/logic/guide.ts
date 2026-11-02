import { CROP_LIST, FIELD } from '../data/crops';
import { COTTAGE } from '../data/families';
import { GUIDE_STEPS, type GuideStepDef, type GuideStepId } from '../data/guide';
import { campInfo } from './camp';
import type { ActivityEvents } from './activity';
import type { PlacedObject } from './types';
import type { Game } from './game';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import { STARTING_FIELDS, type FieldState } from './crops';
import { tradeLink } from './tradepost';
import { workerAt } from './workers';

/**
 * The first-session guide (rules; the card and ring are `src/features/guide`). It walks a new farm through
 * `GUIDE_STEPS` one at a time. A step finishes on its event (an activity, a HUD change, the camera moving) or with
 * Next; a step whose event already happened, or whose condition already holds, is skipped when it comes up, so the
 * steps can be done in any order. Only New game starts it: a farm without the slice (old saves) has it off.
 */
export const GUIDE = 'guide';

export interface GuideState {
  /** The guide was started on this farm (New game → Show me around, or Settings → Restart). */
  started: boolean;
  /** Index into `GUIDE_STEPS` of the step on show. */
  step: number;
  /** Finish was pressed on the last step. */
  finished: boolean;
  /** The guide was skipped (welcome dialog) or ended (✕ End guide) before it was finished. */
  skipped: boolean;
  /** Steps whose event came before the step did: they are skipped when they come up. */
  done: GuideStepId[];
}

const off = (): GuideState => ({ started: false, step: 0, finished: false, skipped: false, done: [] });

registerStateSlice<GuideState>(GUIDE, off);

const IDS = new Set<string>(GUIDE_STEPS.map((s) => s.id));

/** The farm's guide, made valid in place (saved data is untrusted). */
export function guideOf(state: Game['state']): GuideState {
  const g = getSlice<GuideState>(state, GUIDE);
  if (!isPlainObject(g)) return (state.ext[GUIDE] = off());
  g.started = g.started === true;
  g.finished = g.finished === true;
  g.skipped = g.skipped === true;
  g.step = Number.isInteger(g.step) ? Math.max(0, Math.min(GUIDE_STEPS.length - 1, g.step)) : 0;
  g.done = Array.isArray(g.done) ? g.done.filter((id): id is GuideStepId => IDS.has(id)) : [];
  return g;
}

export function isGuideActive(g: GuideState): boolean {
  return g.started && !g.finished && !g.skipped;
}

/** Something that may finish a step. `state` only asks the steps' conditions again (an object changed). */
export type GuideSignal =
  | { kind: 'camera' }
  | { kind: 'speed' }
  | { kind: 'window'; id: string }
  | { kind: 'state' }
  | { [K in keyof ActivityEvents]: { kind: 'activity'; name: K; payload: ActivityEvents[K] } }[keyof ActivityEvents];

interface StepRule {
  /** The step's event: true when the signal finishes it. */
  on?(signal: GuideSignal): boolean;
  /** True when the farm already shows the step done; then it is skipped. */
  met?(game: Game): boolean;
}

const placed = (type: string) => (s: GuideSignal) => s.kind === 'activity' && s.name === 'placed' && s.payload.type === type;
const has = (type: string) => (game: Game) => game.objectsOfType(type).length > 0;
const fields = (game: Game) => game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
const CROP_ITEMS = new Set<string>(CROP_LIST.map((c) => c.harvestItem));

const RULES: Record<GuideStepId, StepRule> = {
  look: { on: (s) => s.kind === 'camera' },
  assign: { met: (game) => fields(game).some((f) => workerAt(game.state, f.id) !== null) },
  // Sown by hand: a field without a farmer has a crop (a farmer's own sowing doesn't count).
  sow: { met: (game) => fields(game).some((f) => f.state.crop !== null && workerAt(game.state, f.id) === null) },
  speed: { on: (s) => s.kind === 'speed' },
  develop: { on: (s) => s.kind === 'window' && s.id === 'development' },
  field: { on: placed(FIELD), met: (game) => fields(game).length > STARTING_FIELDS.length },
  harvest: {
    on: (s) => s.kind === 'activity' && s.name === 'harvested',
    // Crops beyond the camp's starting carrots: those came with the settlers, not from a field.
    met: (game) => Object.entries(game.state.inventory).some(([id, n]) => CROP_ITEMS.has(id) && n > (campInfo(game.state)?.left[id] ?? 0)),
  },
  // Built and linked to the main road (checked again whenever an object changes).
  post: { met: (game) => tradeLink(game.state).connected },
  sell: { on: (s) => s.kind === 'activity' && s.name === 'sold' },
  materials: {
    on: (s) => (s.kind === 'activity' && s.name === 'bought' && s.payload.item === 'wood') || placed('woodcutter')(s),
    met: has('woodcutter'),
  },
  granary: { on: placed('granary'), met: has('granary') },
  cottage: { on: placed(COTTAGE), met: has(COTTAGE) },
  // The last card waits for Finish.
  done: {},
};

/** The step on show, or null when the guide is off. */
export function currentStep(game: Game): GuideStepDef | null {
  const g = guideOf(game.state);
  return isGuideActive(g) ? GUIDE_STEPS[g.step]! : null;
}

/** Moves past every step that is already done or already holds (never past the last, which waits for Finish). */
function settle(game: Game, g: GuideState): void {
  while (g.step < GUIDE_STEPS.length - 1) {
    const def = GUIDE_STEPS[g.step]!;
    if (!g.done.includes(def.id) && !RULES[def.id].met?.(game)) return;
    g.step++;
  }
}

/** Starts the guide at step 1 (New game → Show me around, Settings → Restart the guide). */
export function startGuide(game: Game): void {
  const g = guideOf(game.state);
  Object.assign(g, off(), { started: true });
  settle(game, g);
}

/** The welcome dialog's Skip: the guide stays off on this farm. */
export function skipGuide(game: Game): void {
  Object.assign(guideOf(game.state), off(), { skipped: true });
}

/** ✕ End guide: off for good on this farm (Settings can restart it). */
export function endGuide(game: Game): void {
  const g = guideOf(game.state);
  if (isGuideActive(g)) g.skipped = true;
}

/** Next ›: on to the next step that isn't done yet, or (on the last) Finish. */
export function nextStep(game: Game): void {
  const g = guideOf(game.state);
  if (!isGuideActive(g)) return;
  if (g.step >= GUIDE_STEPS.length - 1) {
    g.finished = true;
    return;
  }
  g.step++;
  settle(game, g);
}

/**
 * Reports something that happened. Finishes the step on show when it is the step's event, and remembers it for a
 * later step it would finish. Returns true when the step on show changed.
 */
export function notifyGuide(game: Game, signal: GuideSignal): boolean {
  const g = guideOf(game.state);
  if (!isGuideActive(g)) return false;
  const before = g.step;
  for (let i = before; i < GUIDE_STEPS.length; i++) {
    const id = GUIDE_STEPS[i]!.id;
    if (!RULES[id].on?.(signal) || g.done.includes(id)) continue;
    if (i === before) g.step = Math.min(before + 1, GUIDE_STEPS.length - 1);
    else g.done.push(id);
  }
  settle(game, g);
  return g.step !== before;
}

/** The guide as `window.farm.guide` shows it: `step` is the step's id and `index` its number on the card (1-based). */
export function guideInfo(game: Game): { active: boolean; step: GuideStepId | null; index: number; total: number; finished: boolean; skipped: boolean } {
  const g = guideOf(game.state);
  const active = isGuideActive(g);
  return {
    active,
    step: active ? GUIDE_STEPS[g.step]!.id : null,
    index: active ? g.step + 1 : 0,
    total: GUIDE_STEPS.length,
    finished: g.finished,
    skipped: g.skipped,
  };
}
