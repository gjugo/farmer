/**
 * Loads every feature module: `src/features/<name>/index.ts`.
 * Features register their buildables, textures, behaviours, HUD buttons and
 * state slices as a side effect of being imported, so adding a feature never
 * requires editing a shared file.
 */
import.meta.glob('./*/index.ts', { eager: true });
