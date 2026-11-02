import { registerBuildable, type BuildCategory } from './buildables';
import type { KnownItemId } from './items';
import type { MaterialCost } from './materials';

export type ProcessorType = 'feed-mill' | 'feed-barn' | 'dairy' | 'bakery' | 'loom' | 'malthouse' | 'brewery' | 'tailor' | 'blacksmith';

export interface RecipeDef {
  /** Unique across all buildings. */
  id: string;
  /** itemId → quantity consumed when the job is queued. */
  inputs: Partial<Record<KnownItemId, number>>;
  output: { item: KnownItemId; qty: number };
  /** Game milliseconds to make one batch. */
  durationMs: number;
  /** Farm level that unlocks this recipe when it is later than its building's (an input that unlocks later). */
  unlockLevel?: number;
}

export interface ProcessorDef {
  id: ProcessorType;
  name: string;
  icon: string;
  cost: number;
  materials: MaterialCost;
  /** Size in tiles. */
  footprint: { w: number; h: number };
  description: string;
  /** How the building shows that it is working: smoke from its chimney, the mill's sails turning, or nothing (no chimney). */
  anim: 'smoke' | 'sails' | 'none';
  /** Its tab in the construction menu (default Crafts). */
  category?: BuildCategory;
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
    cost: 110,
    materials: { wood: 10, stone: 4 },
    footprint: { w: 2, h: 2 },
    description: 'Grinds wheat, corn and barley into animal feed.',
    unlockLevel: 4,
    anim: 'sails',
    recipes: [
      { id: 'feed-from-wheat', inputs: { wheat: 2 }, output: { item: 'feed', qty: 3 }, durationMs: 120_000 },
      { id: 'feed-from-corn', inputs: { corn: 1 }, output: { item: 'feed', qty: 2 }, durationMs: 120_000 },
      { id: 'feed-from-barley', inputs: { barley: 2 }, output: { item: 'feed', qty: 4 }, durationMs: 120_000 },
    ],
  },
  // The animals' own building, like Manor Lords' livestock farm: grain into winter feed at 1:2. In Farming, by the pens.
  'feed-barn': {
    id: 'feed-barn',
    name: 'Feed Barn',
    icon: '🐮',
    cost: 90,
    materials: { wood: 8, stone: 2 },
    footprint: { w: 2, h: 2 },
    description: 'Turns wheat, corn or barley into feed, 1 grain to 2 feed. Animals graze most of the year and eat feed only in winter.',
    unlockLevel: 2,
    anim: 'none',
    category: 'farming',
    recipes: [
      { id: 'feed-barn-wheat', inputs: { wheat: 3 }, output: { item: 'feed', qty: 6 }, durationMs: 120_000 },
      // Corn and barley come at level 4.
      { id: 'feed-barn-corn', inputs: { corn: 3 }, output: { item: 'feed', qty: 6 }, durationMs: 120_000, unlockLevel: 4 },
      { id: 'feed-barn-barley', inputs: { barley: 3 }, output: { item: 'feed', qty: 6 }, durationMs: 120_000, unlockLevel: 4 },
    ],
  },
  dairy: {
    id: 'dairy',
    name: 'Dairy',
    icon: '🧀',
    cost: 265,
    materials: { wood: 6, stone: 8, iron: 2 },
    footprint: { w: 3, h: 2 },
    description: 'Turns milk into cheese and butter.',
    unlockLevel: 3,
    anim: 'smoke',
    recipes: [
      { id: 'cheese', inputs: { milk: 2 }, output: { item: 'cheese', qty: 1 }, durationMs: 480_000 },
      { id: 'butter', inputs: { milk: 1 }, output: { item: 'butter', qty: 1 }, durationMs: 240_000 },
    ],
  },
  bakery: {
    id: 'bakery',
    name: 'Bakery',
    icon: '🍞',
    cost: 245,
    materials: { wood: 6, stone: 10 },
    footprint: { w: 3, h: 2 },
    description: 'Bakes bread from wheat and eggs.',
    unlockLevel: 2,
    anim: 'smoke',
    recipes: [{ id: 'bread', inputs: { wheat: 3, egg: 1 }, output: { item: 'bread', qty: 1 }, durationMs: 300_000 }],
  },
  loom: {
    id: 'loom',
    name: 'Loom',
    icon: '🧵',
    cost: 325,
    materials: { wood: 10, iron: 3 },
    footprint: { w: 2, h: 2 },
    description: 'Weaves wool into cloth and flax into linen.',
    unlockLevel: 5,
    anim: 'smoke',
    recipes: [
      { id: 'cloth', inputs: { wool: 2 }, output: { item: 'cloth', qty: 1 }, durationMs: 600_000 },
      // Flax comes at level 6.
      { id: 'linen', inputs: { flax: 3 }, output: { item: 'linen', qty: 1 }, durationMs: 480_000, unlockLevel: 6 },
    ],
  },
  // The longer chains: barley → malt → ale, and cloth or linen → clothes.
  malthouse: {
    id: 'malthouse',
    name: 'Malthouse',
    icon: '🫘',
    cost: 300,
    materials: { wood: 10, stone: 6 },
    footprint: { w: 2, h: 2 },
    description: 'Sprouts and dries barley into malt for the brewery.',
    unlockLevel: 6,
    anim: 'smoke',
    recipes: [{ id: 'malt', inputs: { barley: 3 }, output: { item: 'malt', qty: 2 }, durationMs: 300_000 }],
  },
  brewery: {
    id: 'brewery',
    name: 'Brewery',
    icon: '🍺',
    cost: 450,
    materials: { wood: 12, stone: 10, iron: 4 },
    footprint: { w: 3, h: 2 },
    description: 'Brews malt into ale: families drink it, and it sells well.',
    unlockLevel: 7,
    anim: 'smoke',
    recipes: [{ id: 'ale', inputs: { malt: 2 }, output: { item: 'ale', qty: 1 }, durationMs: 600_000 }],
  },
  tailor: {
    id: 'tailor',
    name: 'Tailor',
    icon: '👕',
    cost: 400,
    materials: { wood: 10, stone: 4, iron: 4 },
    footprint: { w: 2, h: 2 },
    description: 'Sews cloth or linen into clothes, which families like better than cloth.',
    unlockLevel: 8,
    anim: 'smoke',
    recipes: [
      { id: 'clothes-from-cloth', inputs: { cloth: 2 }, output: { item: 'clothes', qty: 1 }, durationMs: 600_000 },
      { id: 'clothes-from-linen', inputs: { linen: 2 }, output: { item: 'clothes', qty: 1 }, durationMs: 600_000 },
    ],
  },
  // Iron's steady use besides buildings: tools make farmers work faster and wear out (see `src/logic/tools.ts`). Its
  // own cost takes no iron, so building it never competes with the first tools.
  blacksmith: {
    id: 'blacksmith',
    name: 'Blacksmith',
    icon: '🔨',
    cost: 280,
    materials: { wood: 10, stone: 10 },
    footprint: { w: 2, h: 2 },
    description: 'Forges iron and wood into tools: farmers with tools work 25% faster.',
    unlockLevel: 5,
    anim: 'smoke',
    recipes: [{ id: 'tools', inputs: { iron: 1, wood: 1 }, output: { item: 'tools', qty: 1 }, durationMs: 360_000 }],
  },
};

export function isProcessorType(v: unknown): v is ProcessorType {
  return typeof v === 'string' && Object.hasOwn(PROCESSORS, v);
}

/** The level a recipe can be made from: its own `unlockLevel`, or its building's. */
export function recipeUnlockLevel(processor: ProcessorDef, recipe: RecipeDef): number {
  return Math.max(processor.unlockLevel, recipe.unlockLevel ?? 1);
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
    materials: p.materials,
    footprint: p.footprint,
    texture: p.id,
    category: p.category ?? 'crafts',
    description: p.description,
    icon: p.icon,
    unlockLevel: p.unlockLevel,
    initialState: () => ({ queue: [], ready: {} }),
  });
}
