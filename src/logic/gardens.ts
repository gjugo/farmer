import { getBuildable } from '../data/buildables';
import { COTTAGE } from '../data/families';
import { FARMHOUSE } from '../data/farmhouse';
import { GARDENS, isGardenType, type GardenDef, type GardenType } from '../data/gardens';
import type { Season } from '../data/seasons';
import { DAY_MS } from './constants';
import type { Game } from './game';
import type { Rect } from './land';
import { registerPlacementRule } from './placement';
import { nextSeasonIn, seasonAt } from './seasons';
import type { GameState, PlacedObject } from './types';

/**
 * House gardens (content in `src/data/gardens.ts`): a vegetable patch, hen run or orchard beside a home, worked by the
 * family in its spare time. No farmer and no path: a garden yields once a game day (a day after it was built, then
 * every day), into the granary as far as there is room; the rest waits in the garden and goes in as soon as room
 * appears. A garden belongs to the home it touches along an edge, one garden per home; whose home is demolished
 * stops (and takes up another free home beside it, should one be built).
 *
 * It runs inside the work scheduler (`src/logic/work.ts`): yields are scheduler events, so ×1, ×60 and offline
 * catch-up give the same farm.
 */

// A type alias (not an interface) so it fits `PlacedObject<Record<string, unknown>>`.
export type GardenState = {
  /** The home (farmhouse or cottage) the garden belongs to; null until assigned, or once that home is gone. */
  home: string | null;
  /** Game time of the next yield; null while the garden has no (finished) home. */
  nextAt: number | null;
  /** Yield that did not fit in the granary. */
  waiting: number;
};

export function gardenDef(obj: PlacedObject): GardenDef {
  return GARDENS[obj.type as GardenType];
}

/** Repairs state from a save (or an older shape). */
export function sanitize(obj: PlacedObject): PlacedObject<GardenState> {
  const s = obj.state as Record<string, unknown>;
  const fixed: GardenState = {
    home: typeof s.home === 'string' ? s.home : null,
    nextAt: typeof s.nextAt === 'number' && Number.isFinite(s.nextAt) ? s.nextAt : null,
    waiting: Number.isInteger(s.waiting) && (s.waiting as number) > 0 ? (s.waiting as number) : 0,
  };
  if (s.home !== fixed.home || s.nextAt !== fixed.nextAt || s.waiting !== fixed.waiting) obj.state = fixed;
  return obj as unknown as PlacedObject<GardenState>;
}

export function isHome(obj: PlacedObject): boolean {
  return obj.type === FARMHOUSE || obj.type === COTTAGE;
}

function rectOf(obj: PlacedObject): Rect {
  return { x: obj.x, y: obj.y, ...(getBuildable(obj.type)?.footprint ?? { w: 1, h: 1 }) };
}

/** Do two rectangles share a stretch of edge (not just a corner)? */
export function touches(a: Rect, b: Rect): boolean {
  const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
  const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
  const besideX = a.x + a.w === b.x || b.x + b.w === a.x;
  const besideY = a.y + a.h === b.y || b.y + b.h === a.y;
  return (besideX && overlapY) || (besideY && overlapX);
}

/** Homes (finished or still being built) that `area` touches along an edge, in build order. */
export function homesBeside(state: GameState, area: Rect): PlacedObject[] {
  return state.objects.filter((o) => isHome(o) && touches(area, rectOf(o)));
}

export function gardensOf(state: GameState): PlacedObject<GardenState>[] {
  return state.objects.filter((o) => isGardenType(o.type)).map(sanitize);
}

/**
 * Which home each garden belongs to (garden id → home id, or null). A garden keeps the home it has while that still
 * stands beside it; a garden without one (just built, or its home demolished) takes the first home beside it that no
 * other garden has. Pure: `assignHomes` stores the result.
 */
export function gardenHomes(state: GameState): Map<string, string | null> {
  const gardens = gardensOf(state);
  const out = new Map<string, string | null>();
  const taken = new Set<string>();
  for (const g of gardens) {
    const home = g.state.home ? state.objects.find((o) => o.id === g.state.home) : undefined;
    if (home && isHome(home) && touches(rectOf(g), rectOf(home)) && !taken.has(home.id)) {
      out.set(g.id, home.id);
      taken.add(home.id);
    }
  }
  for (const g of gardens) {
    if (out.has(g.id)) continue;
    const home = homesBeside(state, rectOf(g)).find((h) => !taken.has(h.id));
    out.set(g.id, home?.id ?? null);
    if (home) taken.add(home.id);
  }
  return out;
}

/** Homes that have a garden (by id). */
export function homesWithGarden(state: GameState): Set<string> {
  return new Set([...gardenHomes(state).values()].filter((h): h is string => h !== null));
}

/** Homes still without a garden: where the next one can go. */
export function freeHomes(state: GameState): PlacedObject[] {
  const taken = homesWithGarden(state);
  return state.objects.filter((o) => isHome(o) && !taken.has(o.id));
}

/** The garden of a home, or undefined. */
export function gardenOf(state: GameState, homeId: string): PlacedObject<GardenState> | undefined {
  for (const [garden, home] of gardenHomes(state)) {
    if (home === homeId) return sanitize(state.objects.find((o) => o.id === garden)!);
  }
  return undefined;
}

/** The finished home a garden works for, or null (none beside it, or still being built). */
export function workingHome(state: GameState, garden: PlacedObject): PlacedObject | null {
  const id = gardenHomes(state).get(garden.id);
  const home = id ? state.objects.find((o) => o.id === id) : undefined;
  return home && !home.site ? home : null;
}

/** Finished homes with a finished garden: the approval part counts these. */
export function gardenedHomes(state: GameState): number {
  let n = 0;
  for (const g of gardensOf(state)) if (!g.site && workingHome(state, g)) n++;
  return n;
}

/** What a garden makes on a day ending at game time `at`, by the season of that day. */
export function yieldAt(def: GardenDef, at: number): number {
  return def.perDay[seasonAt(at - 1)] ?? 0;
}

/** The seasons a garden yields in. */
export function yieldSeasons(def: GardenDef): Season[] {
  return (Object.keys(def.perDay) as Season[]).filter((s) => (def.perDay[s] ?? 0) > 0);
}

/** Game time of the next yield that brings something (null while it has no home): skips the idle season. */
export function nextYieldAt(obj: PlacedObject<GardenState>): number | null {
  const at = obj.state.nextAt;
  if (at === null) return null;
  const def = gardenDef(obj);
  if (yieldAt(def, at) > 0) return at;
  const start = nextSeasonIn(at, yieldSeasons(def));
  if (!Number.isFinite(start)) return null;
  // The first day boundary of the garden's own rhythm that ends a day in a yielding season.
  return at + Math.ceil((start + 1 - at) / DAY_MS) * DAY_MS;
}

// Placement --------------------------------------------------------------------------

registerPlacementRule((state, fp, x, y, type) => {
  if (!type || !isGardenType(type)) return null;
  const beside = homesBeside(state, { x, y, ...fp });
  if (beside.length === 0) return 'needs-home';
  const taken = homesWithGarden(state);
  return beside.some((h) => !taken.has(h.id)) ? null : 'home-has-garden';
});

// Game rules -------------------------------------------------------------------------

/**
 * The gardens' part of a scheduler step: homes are (re)assigned, every garden whose day is over yields (into the
 * granary as far as it has room, the rest waits) and what waits goes in when there is room. Called by `runWork` at
 * every event, so between events it only moves waiting yield into room the player made.
 */
export function stepGardens(game: Game): void {
  const { state } = game;
  const now = state.clock.elapsed;
  const homes = gardenHomes(state);
  for (const g of gardensOf(state)) {
    const s = g.state;
    let changed = false;
    const home = homes.get(g.id) ?? null;
    if (s.home !== home) {
      s.home = home;
      changed = true;
    }
    const homeObj = home ? state.objects.find((o) => o.id === home) : undefined;
    const working = !g.site && !!homeObj && !homeObj.site;
    if (!working) {
      if (s.nextAt !== null) {
        s.nextAt = null;
        changed = true;
      }
    } else {
      if (s.nextAt === null) {
        s.nextAt = now + DAY_MS;
        changed = true;
      }
      const def = gardenDef(g);
      while (s.nextAt <= now) {
        const n = yieldAt(def, s.nextAt);
        s.nextAt += DAY_MS;
        changed = true;
        if (n === 0) continue;
        s.waiting += n;
        game.activity.emit('gathered', { item: def.item, qty: n });
      }
    }
    if (s.waiting > 0) {
      const put = game.addItem(gardenDef(g).item, s.waiting);
      if (put > 0) {
        s.waiting -= put;
        changed = true;
      }
    }
    if (changed) game.touch(g);
  }
}

/** The next game time after now at which a garden yields; Infinity when none will. */
export function nextGardensEvent(state: GameState): number {
  const now = state.clock.elapsed;
  let next = Infinity;
  for (const g of gardensOf(state)) {
    const at = g.state.nextAt;
    if (at !== null && at > now && at < next) next = at;
  }
  return next;
}
