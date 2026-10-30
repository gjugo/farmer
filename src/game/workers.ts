import { getBuildable } from '../data/buildables';
import type { JobKind } from '../data/workers';
import { formatDuration } from '../logic/crops';
import { findRoute } from '../logic/roads';
import { assignJob, freeFarmers, nextFreeIn } from '../logic/workers';
import type { FarmContext } from './context';

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
function siteArea(site: WorkSite) {
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
