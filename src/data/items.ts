export type ItemCategory = 'crop' | 'animal-product' | 'feed' | 'processed' | 'material';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  /** Base sell price in dollars. */
  price: number;
  /** Emoji standing for the item in text; the HTML overlay and the farm show the art pack's icon for it (see `splitIcons`). */
  icon: string;
}

/**
 * Every item of this milestone. Features refer to items by these ids;
 * add new items here rather than inventing ids elsewhere.
 */
export const ITEMS = {
  wheat: { id: 'wheat', name: 'Wheat', category: 'crop', price: 4, icon: '🌾' },
  carrot: { id: 'carrot', name: 'Carrot', category: 'crop', price: 6, icon: '🥕' },
  corn: { id: 'corn', name: 'Corn', category: 'crop', price: 8, icon: '🌽' },
  potato: { id: 'potato', name: 'Potato', category: 'crop', price: 5, icon: '🥔' },
  barley: { id: 'barley', name: 'Barley', category: 'crop', price: 5, icon: '🌿' },
  flax: { id: 'flax', name: 'Flax', category: 'crop', price: 10, icon: '🪻' },
  cabbage: { id: 'cabbage', name: 'Cabbage', category: 'crop', price: 14, icon: '🥬' },
  pumpkin: { id: 'pumpkin', name: 'Pumpkin', category: 'crop', price: 32, icon: '🎃' },
  // Picked in the orchards beside the homes (see `src/data/gardens.ts`).
  apple: { id: 'apple', name: 'Apple', category: 'crop', price: 7, icon: '🍎' },
  egg: { id: 'egg', name: 'Egg', category: 'animal-product', price: 10, icon: '🥚' },
  milk: { id: 'milk', name: 'Milk', category: 'animal-product', price: 18, icon: '🥛' },
  wool: { id: 'wool', name: 'Wool', category: 'animal-product', price: 25, icon: '🧶' },
  feed: { id: 'feed', name: 'Feed', category: 'feed', price: 3, icon: '🌰' },
  cheese: { id: 'cheese', name: 'Cheese', category: 'processed', price: 50, icon: '🧀' },
  butter: { id: 'butter', name: 'Butter', category: 'processed', price: 30, icon: '🧈' },
  bread: { id: 'bread', name: 'Bread', category: 'processed', price: 40, icon: '🍞' },
  cloth: { id: 'cloth', name: 'Cloth', category: 'processed', price: 75, icon: '🧵' },
  malt: { id: 'malt', name: 'Malt', category: 'processed', price: 12, icon: '🫘' },
  ale: { id: 'ale', name: 'Ale', category: 'processed', price: 90, icon: '🍺' },
  linen: { id: 'linen', name: 'Linen', category: 'processed', price: 60, icon: '🧻' },
  clothes: { id: 'clothes', name: 'Clothes', category: 'processed', price: 150, icon: '👕' },
  // Building materials: bought at the Market (see `buyPrice` in `src/logic/market.ts`), spent on buildings.
  wood: { id: 'wood', name: 'Wood', category: 'material', price: 4, icon: '🪵' },
  stone: { id: 'stone', name: 'Stone', category: 'material', price: 5, icon: '🪨' },
  iron: { id: 'iron', name: 'Iron', category: 'material', price: 15, icon: '🔩' },
  // Made by pens (see `MANURE_PER_COLLECT`), spread on fields. Kept in the storehouse so it never crowds out food.
  manure: { id: 'manure', name: 'Manure', category: 'material', price: 1, icon: '💩' },
  // Forged at the blacksmith, taken by farmers (see `src/logic/tools.ts`). Kept in the storehouse; the Market buys
  // them but never sells them.
  tools: { id: 'tools', name: 'Tools', category: 'material', price: 40, icon: '🛠️' },
} as const satisfies Record<string, ItemDef>;

export type KnownItemId = keyof typeof ITEMS;

export const ITEM_LIST: readonly ItemDef[] = Object.values(ITEMS);

export function getItem(id: string): ItemDef | undefined {
  return (ITEMS as Record<string, ItemDef>)[id];
}

/** Emoji that the art pack has an icon for, by icon name: every item, plus coins for money. */
export const ICON_EMOJI: Readonly<Record<string, string>> = {
  ...Object.fromEntries(ITEM_LIST.map((item) => [item.icon, item.id])),
  '💰': 'coins',
};

// Not after a zero-width joiner: the 🌾 in 👨‍🌾 (farmer) is part of another emoji.
const ICON_PATTERN = new RegExp(`(?<!\u200D)(${Object.keys(ICON_EMOJI).join('|')})`, 'u');

export type TextPart = string | { icon: string; emoji: string };

/** Splits text into plain runs and the emoji that have a pack icon, e.g. "+3 🥚 Egg" → ["+3 ", {icon: 'egg'}, " Egg"]. */
export function splitIcons(text: string): TextPart[] {
  return text
    .split(ICON_PATTERN)
    .filter((part) => part !== '')
    .map((part) => (Object.hasOwn(ICON_EMOJI, part) ? { icon: ICON_EMOJI[part], emoji: part } : part));
}
