import type { MaterialCost } from './materials';

/** The construction menu's categories (left to right), like Manor Lords'. The path has none: it has its own 🛤️ tool. */
export const BUILD_CATEGORIES = [
  { id: 'resources', name: 'Resources', icon: '🪓' },
  { id: 'storage', name: 'Storage', icon: '📦' },
  { id: 'homes', name: 'Homes', icon: '🏠' },
  { id: 'farming', name: 'Farming', icon: '🌾' },
  { id: 'crafts', name: 'Crafts', icon: '⚒️' },
] as const;

export type BuildCategory = (typeof BUILD_CATEGORIES)[number]['id'];

export interface BuildableDef {
  id: string;
  name: string;
  /** Money cost in dollars. */
  cost: number;
  /** Materials it takes on top of `cost`, bought at the Market. Paths and fields have none. */
  materials?: MaterialCost;
  /** Size in tiles. */
  footprint: { w: number; h: number };
  /** Texture key: an art pack sprite, or a game key mapped to one in `TEXTURE_ART` (`src/scenes/art.ts`). */
  texture: string;
  /** Its tab in the construction menu (`BUILD_CATEGORIES`); only the path, built with its own tool, has none. */
  category?: BuildCategory;
  /** Short line shown in the build menu. */
  description?: string;
  /** Emoji shown in the level-up popup. */
  icon?: string;
  /** Farm level that unlocks building it (default 1). Already-built ones keep working. */
  unlockLevel?: number;
  /** Set up by the game itself (the camp): not in the build menu and never demolished. */
  fixed?: boolean;
  /** One per farm (the farmhouse): a second one can't be placed, and its card says "Built". */
  unique?: boolean;
  /** Never demolished once finished (the farmhouse); its construction site can still be cancelled. */
  permanent?: boolean;
  /** Game ms of building work, instead of the footprint's (see `buildWorkMs` in `src/data/workers.ts`). */
  buildWorkMs?: number;
  /**
   * Initial per-type state for a newly placed object, told where it stands and the game time. Also used as defaults
   * when loading a save, so fields added later get filled in. Must be JSON-serialisable.
   */
  initialState?: (at?: { x: number; y: number; now: number }) => Record<string, unknown>;
}

const registry = new Map<string, BuildableDef>();

/**
 * Adds a buildable to the build menu. Features call this from their own module
 * (see `src/features/`), so they never need to edit this file.
 */
export function registerBuildable(def: BuildableDef): void {
  if (registry.has(def.id)) throw new Error(`Buildable "${def.id}" is already registered`);
  registry.set(def.id, def);
}

export function getBuildable(id: string): BuildableDef | undefined {
  return registry.get(id);
}

/** All buildables in registration order. */
export function listBuildables(): BuildableDef[] {
  return [...registry.values()];
}

/** Can `obj` be demolished (or its site cancelled)? Not the fixed ones, nor a finished permanent one. */
export function demolishable(obj: { type: string; site?: unknown }): boolean {
  const def = getBuildable(obj.type);
  return !def?.fixed && !(def?.permanent && !obj.site);
}

/** What the player can build: every buildable but the fixed ones. */
export function listBuildMenu(): BuildableDef[] {
  return listBuildables().filter((b) => !b.fixed);
}

/** A construction menu category's buildables, in unlock order (registration order within a level). */
export function listBuildCategory(category: BuildCategory): BuildableDef[] {
  return listBuildMenu()
    .filter((b) => b.category === category)
    .sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1));
}

// Core buildables -------------------------------------------------------------

registerBuildable({
  id: 'path',
  name: 'Path',
  // Free, like Manor Lords' roads: laying the way to a site is never what holds a farm back.
  cost: 0,
  footprint: { w: 1, h: 1 },
  texture: 'path',
  description: 'A dirt path, free to lay. Farmers walk along paths to get to their work.',
  unlockLevel: 1,
});
