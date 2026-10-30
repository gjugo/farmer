import { registerBuildable } from './buildables';
import type { KnownItemId } from './items';

export type ProcessorType = 'feed-mill' | 'dairy' | 'bakery' | 'loom';

export interface RecipeDef {
  /** Unique across all buildings. */
  id: string;
  /** itemId → quantity consumed when the job is queued. */
  inputs: Partial<Record<KnownItemId, number>>;
  output: { item: KnownItemId; qty: number };
  /** Game milliseconds to make one batch. */
  durationMs: number;
}

export interface ProcessorDef {
  id: ProcessorType;
  name: string;
  icon: string;
  cost: number;
  /** Size in tiles. */
  footprint: { w: number; h: number };
  description: string;
  /** How the building shows that it is working. */
  anim: 'smoke' | 'wheel';
  /** Farm level that unlocks building it (and so its recipes). */
  unlockLevel: number;
  recipes: readonly RecipeDef[];
}

/** Jobs a building can hold at once (the running one included). */
export const QUEUE_LIMIT = 3;

export const PROCESSORS: Record<ProcessorType, ProcessorDef> = {
  'feed-mill': {
    id: 'feed-mill',
    name: 'Feed Mill',
    icon: '🌰',
    cost: 200,
    footprint: { w: 2, h: 2 },
    description: 'Grinds wheat and corn into animal feed.',
    unlockLevel: 4,
    anim: 'wheel',
    recipes: [
      { id: 'feed-from-wheat', inputs: { wheat: 2 }, output: { item: 'feed', qty: 3 }, durationMs: 20_000 },
      { id: 'feed-from-corn', inputs: { corn: 1 }, output: { item: 'feed', qty: 2 }, durationMs: 20_000 },
    ],
  },
  dairy: {
    id: 'dairy',
    name: 'Dairy',
    icon: '🧀',
    cost: 400,
    footprint: { w: 3, h: 2 },
    description: 'Turns milk into cheese and butter.',
    unlockLevel: 3,
    anim: 'smoke',
    recipes: [
      { id: 'cheese', inputs: { milk: 2 }, output: { item: 'cheese', qty: 1 }, durationMs: 90_000 },
      { id: 'butter', inputs: { milk: 1 }, output: { item: 'butter', qty: 1 }, durationMs: 45_000 },
    ],
  },
  bakery: {
    id: 'bakery',
    name: 'Bakery',
    icon: '🍞',
    cost: 350,
    footprint: { w: 3, h: 2 },
    description: 'Bakes bread from wheat and eggs.',
    unlockLevel: 2,
    anim: 'smoke',
    recipes: [{ id: 'bread', inputs: { wheat: 3, egg: 1 }, output: { item: 'bread', qty: 1 }, durationMs: 60_000 }],
  },
  loom: {
    id: 'loom',
    name: 'Loom',
    icon: '🧵',
    cost: 450,
    footprint: { w: 2, h: 2 },
    description: 'Weaves wool into cloth.',
    unlockLevel: 5,
    anim: 'wheel',
    recipes: [{ id: 'cloth', inputs: { wool: 2 }, output: { item: 'cloth', qty: 1 }, durationMs: 120_000 }],
  },
};

export function isProcessorType(v: unknown): v is ProcessorType {
  return typeof v === 'string' && Object.hasOwn(PROCESSORS, v);
}

export function findRecipe(type: string, recipeId: string): RecipeDef | undefined {
  return isProcessorType(type) ? PROCESSORS[type].recipes.find((r) => r.id === recipeId) : undefined;
}

// Processing buildings are buildables; their textures and behaviour live in `src/features/processing`.
for (const p of Object.values(PROCESSORS)) {
  registerBuildable({
    id: p.id,
    name: p.name,
    cost: p.cost,
    footprint: p.footprint,
    texture: p.id,
    category: 'processing',
    description: p.description,
    icon: p.icon,
    unlockLevel: p.unlockLevel,
    initialState: () => ({ queue: [], ready: {} }),
  });
}
