import { getItem } from '../data/items';
import { findRecipe, QUEUE_LIMIT, type RecipeDef } from '../data/processing';
import { startTimer, timerDone, timerProgress, type Timer } from './clock';
import type { Game } from './game';
import * as inventory from './inventory';
import { isPlainObject } from './slices';
import type { ClockState, Inventory, ItemId, PlacedObject } from './types';

/** One queued batch. Only the head of the queue has a timer: jobs are worked one at a time. */
export interface Job {
  recipe: string;
  timer: Timer | null;
}

// A type alias (not an interface) so it fits `PlacedObject<Record<string, unknown>>`.
export type ProcessorState = {
  queue: Job[];
  /** Finished output waiting to be collected. */
  ready: Inventory;
};

export type StartResult = { ok: true } | { ok: false; reason: 'unknown-recipe' | 'queue-full' | 'inputs' };

/** Problems with a recipe definition; empty when it is valid. */
export function validateRecipe(recipe: RecipeDef): string[] {
  const errors: string[] = [];
  const inputs = Object.entries(recipe.inputs);
  if (inputs.length === 0) errors.push(`${recipe.id}: no inputs`);
  for (const [item, qty] of inputs) {
    if (!getItem(item)) errors.push(`${recipe.id}: unknown input "${item}"`);
    if (!Number.isInteger(qty) || (qty ?? 0) <= 0) errors.push(`${recipe.id}: bad quantity for "${item}"`);
  }
  if (!getItem(recipe.output.item)) errors.push(`${recipe.id}: unknown output "${recipe.output.item}"`);
  if (!Number.isInteger(recipe.output.qty) || recipe.output.qty <= 0) errors.push(`${recipe.id}: bad output quantity`);
  if (!(recipe.durationMs > 0)) errors.push(`${recipe.id}: duration must be positive`);
  return errors;
}

export function inputsOf(recipe: RecipeDef): [ItemId, number][] {
  return Object.entries(recipe.inputs) as [ItemId, number][];
}

export function hasInputs(inv: Inventory, recipe: RecipeDef): boolean {
  return inputsOf(recipe).every(([item, qty]) => inventory.count(inv, item) >= qty);
}

/**
 * Repairs state from a save (or an older shape): drops jobs of unknown recipes,
 * malformed timers and bad counts, and makes sure the head job is running.
 */
export function sanitize(obj: PlacedObject<ProcessorState>, clock: ClockState): void {
  const s = obj.state as unknown as Record<string, unknown>;
  const rawQueue = Array.isArray(s.queue) ? s.queue : [];
  const queue: Job[] = [];
  for (const j of rawQueue) {
    if (!isPlainObject(j) || typeof j.recipe !== 'string' || !findRecipe(obj.type, j.recipe)) continue;
    const t = j.timer;
    const timer =
      isPlainObject(t) && Number.isFinite(t.start) && Number.isFinite(t.duration)
        ? { start: t.start as number, duration: t.duration as number }
        : null;
    queue.push({ recipe: j.recipe, timer });
  }
  queue.splice(QUEUE_LIMIT);
  for (let i = 1; i < queue.length; i++) queue[i].timer = null;
  const ready: Inventory = {};
  if (isPlainObject(s.ready)) {
    for (const [id, n] of Object.entries(s.ready)) if (Number.isInteger(n) && (n as number) > 0) ready[id] = n as number;
  }
  obj.state = { queue, ready };
  if (queue[0] && !queue[0].timer) queue[0].timer = startTimer(clock, recipeOf(obj, queue[0]).durationMs);
}

function recipeOf(obj: PlacedObject<ProcessorState>, job: Job): RecipeDef {
  const recipe = findRecipe(obj.type, job.recipe);
  if (!recipe) throw new Error(`Unknown recipe "${job.recipe}" for ${obj.type}`);
  return recipe;
}

export function checkStart(game: Game, obj: PlacedObject<ProcessorState>, recipeId: string): StartResult {
  const recipe = findRecipe(obj.type, recipeId);
  if (!recipe) return { ok: false, reason: 'unknown-recipe' };
  if (obj.state.queue.length >= QUEUE_LIMIT) return { ok: false, reason: 'queue-full' };
  if (!hasInputs(game.state.inventory, recipe)) return { ok: false, reason: 'inputs' };
  return { ok: true };
}

/** Takes the inputs from the inventory at once and queues the job. Nothing changes when it fails. */
export function startJob(game: Game, obj: PlacedObject<ProcessorState>, recipeId: string): StartResult {
  settle(game.state.clock, obj);
  const check = checkStart(game, obj, recipeId);
  if (!check.ok) return check;
  const recipe = recipeOf(obj, { recipe: recipeId, timer: null });
  for (const [item, qty] of inputsOf(recipe)) game.removeItem(item, qty);
  const first = obj.state.queue.length === 0;
  obj.state.queue.push({ recipe: recipeId, timer: first ? startTimer(game.state.clock, recipe.durationMs) : null });
  game.touch(obj);
  return { ok: true };
}

/**
 * Moves finished jobs' output to `ready` and starts the next job where the previous
 * one ended, so a big clock jump finishes several jobs exactly. Returns how many finished.
 */
export function settle(clock: ClockState, obj: PlacedObject<ProcessorState>): number {
  const { queue, ready } = obj.state;
  let finished = 0;
  while (queue[0]?.timer && timerDone(clock, queue[0].timer)) {
    const done = queue.shift()!;
    const recipe = recipeOf(obj, done);
    inventory.add(ready, recipe.output.item, recipe.output.qty);
    finished++;
    const next = queue[0];
    if (next) next.timer = { start: done.timer!.start + done.timer!.duration, duration: recipeOf(obj, next).durationMs };
  }
  return finished;
}

/** 0..1 progress of the running job, or null when idle. */
export function currentProgress(clock: ClockState, obj: PlacedObject<ProcessorState>): number | null {
  const head = obj.state.queue[0];
  return head?.timer ? timerProgress(clock, head.timer) : null;
}

export function isWorking(obj: PlacedObject<ProcessorState>): boolean {
  return obj.state.queue.length > 0;
}

export function readyCount(obj: PlacedObject<ProcessorState>): number {
  return Object.values(obj.state.ready).reduce((a, b) => a + b, 0);
}

/** Moves all finished output into the inventory. Returns what was collected. */
export function collect(game: Game, obj: PlacedObject<ProcessorState>): Inventory {
  settle(game.state.clock, obj);
  const got = obj.state.ready;
  if (Object.keys(got).length === 0) return {};
  obj.state.ready = {};
  for (const [item, qty] of Object.entries(got)) game.addItem(item, qty);
  game.touch(obj);
  return got;
}
