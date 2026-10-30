import { getBuildable } from '../data/buildables';
import type { JobKind } from '../data/workers';
import { formatDuration } from '../logic/crops';
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

/**
 * Runs farm work that needs a farmer: refuses with a toast when every farmer is busy,
 * otherwise runs `action` and, when it succeeded, keeps a farmer busy at the centre of
 * `site` for `durationMs` of game time. Returns whether the action ran and succeeded.
 */
export function withFarmer(ctx: FarmContext, kind: JobKind, site: WorkSite, durationMs: number, action: () => boolean): boolean {
  if (durationMs > 0 && freeFarmers(ctx.game.state) <= 0) {
    ctx.ui.toast(busyMessage(ctx), 'error');
    return false;
  }
  if (!action()) return false;
  const fp = getBuildable(site.type)?.footprint ?? { w: 1, h: 1 };
  assignJob(ctx.game, kind, site.x + fp.w / 2, site.y + fp.h / 2, durationMs);
  return true;
}
