import { TOOL_JOBS, TOOL_SPEED, TOOL_USES, TOOLS_ITEM } from '../data/tools';
import type { JobKind } from '../data/workers';
import { dayOf } from './clock';
import type { Game } from './game';
import * as inventory from './inventory';
import type { GameState } from './types';
import { jobsByFarmer, workersOf } from './workers';

/**
 * Farmers' tools. Each farmer has a tool slot (`WorkersState.tools`, saved with the workers): the jobs left in their
 * tools, or null without any. Everything happens when a job starts (`assignJob`, which the work scheduler and
 * hand-ordered work both go through), so ×1, ×60 and offline catch-up give the same wear:
 *
 * - a farmer setting off on a tool job (`TOOL_JOBS`) with an empty slot takes tools from the store if there are any;
 * - with tools, the job's work takes 1/`TOOL_SPEED` of the time, and uses up one of their `TOOL_USES` jobs;
 * - tools with no jobs left break when that job ends (`breakWornTools`), and the next job takes new ones.
 *
 * Whatever a job drives on its own clock (a resource cycle, a site's `doneAt`) reads the same `toolFactor`, so the
 * yield or the building is there when the farmer's work ends. Without tools in store nothing changes and nothing is
 * refused.
 */

/** Do tools speed up (and wear on) this kind of job? */
export function usesTools(kind: JobKind): boolean {
  return TOOL_JOBS.includes(kind);
}

/** Tools in the store. */
export function toolsInStore(state: Pick<GameState, 'inventory'>): number {
  return inventory.count(state.inventory, TOOLS_ITEM);
}

/** Jobs left in farmer `farmer`'s tools, or null without any (0: worn out, they break when the job ends). */
export function toolOf(state: GameState, farmer: number): number | null {
  return workersOf(state).tools[farmer] ?? null;
}

/**
 * How much faster farmer `farmer` works a job of `kind` started now: `TOOL_SPEED` when they have tools or will take some
 * from the store on the way out, else 1. Work times are divided by it (see `toolWorkMs`); it multiplies with perks.
 */
export function toolFactor(state: GameState, farmer: number, kind: JobKind): number {
  if (!usesTools(kind)) return 1;
  const left = toolOf(state, farmer);
  return (left !== null && left > 0) || toolsInStore(state) > 0 ? TOOL_SPEED : 1;
}

/** Game ms of `ms` of work at `factor` (1: exactly `ms`). */
export function toolWorkMs(ms: number, factor: number): number {
  return factor === 1 ? ms : Math.round(ms / factor);
}

/**
 * Farmer `farmer` starts a job of `kind`: takes tools from the store when their slot is empty, and uses one of their
 * jobs. Returns the factor their work is sped up by (the same `toolFactor` gave just before).
 */
export function useTool(game: Game, farmer: number, kind: JobKind): number {
  if (!usesTools(kind)) return 1;
  const slots = workersOf(game.state).tools;
  if (farmer < 0 || farmer >= slots.length) return 1;
  let left = slots[farmer];
  if (left === 0) breakTool(game, farmer);
  if (left === null || left <= 0) {
    if (!game.removeItem(TOOLS_ITEM, 1)) {
      slots[farmer] = null;
      return 1;
    }
    left = TOOL_USES;
    game.activity.emit('toolTaken', { farmer });
  }
  slots[farmer] = left - 1;
  return TOOL_SPEED;
}

function breakTool(game: Game, farmer: number): void {
  workersOf(game.state).tools[farmer] = null;
  game.activity.emit('toolBroke', { farmer, inStore: toolsInStore(game.state) });
}

/** Worn-out tools of farmers whose job has ended break: their slot empties. Run before work is handed out. */
export function breakWornTools(game: Game): void {
  const { state } = game;
  const w = workersOf(state);
  if (!w.tools.includes(0)) return;
  const busy = jobsByFarmer(state.clock, w);
  w.tools.forEach((left, i) => {
    if (left === 0 && !busy[i]) breakTool(game, i);
  });
}

/** Tools in store, farmers with tools, and how many farmers there are. */
export function toolsSummary(state: GameState): { inStore: number; equipped: number; farmers: number } {
  const w = workersOf(state);
  return { inStore: toolsInStore(state), equipped: w.tools.filter((t) => t !== null).length, farmers: w.farmers };
}

/**
 * Tools for the blacksmith's "Keep making": in store, and on the way (`forging`: queued or waiting to be collected at
 * the blacksmith), against one per farmer. It stops queueing once `have` reaches `need`, so it never burns all the
 * iron buildings need.
 */
export function toolsWanted(state: GameState, forging: number): { have: number; need: number; enough: boolean } {
  const have = toolsInStore(state) + forging;
  const need = workersOf(state).farmers;
  return { have, need, enough: have >= need };
}

/**
 * Calls `warn` when tools break and none are left in store, at most once a game day. Returns the unsubscribe function.
 */
export function onToolsWornOut(game: Game, warn: () => void): () => void {
  let warnedDay = -1;
  return game.activity.on('toolBroke', ({ inStore }) => {
    const day = dayOf(game.state.clock);
    if (inStore > 0 || day === warnedDay) return;
    warnedDay = day;
    warn();
  });
}
