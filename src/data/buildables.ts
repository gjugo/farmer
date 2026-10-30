export interface BuildableDef {
  id: string;
  name: string;
  cost: number;
  /** Size in tiles. */
  footprint: { w: number; h: number };
  /** Texture key, generated in `src/scenes/textures.ts` (or by the feature via `registerTexture`). */
  texture: string;
  /** Groups the build menu, e.g. `decor`, `crops`, `animals`, `processing`. */
  category?: string;
  /** Short line shown in the build menu. */
  description?: string;
  /**
   * Initial per-type state for a newly placed object. Also used as defaults when
   * loading a save, so fields added later get filled in. Must be JSON-serialisable.
   */
  initialState?: () => Record<string, unknown>;
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

// Core buildables -------------------------------------------------------------

registerBuildable({
  id: 'path',
  name: 'Path',
  cost: 5,
  footprint: { w: 1, h: 1 },
  texture: 'path',
  category: 'decor',
  description: 'A tidy dirt path.',
});
