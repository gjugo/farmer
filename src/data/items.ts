export type ItemCategory = 'crop' | 'animal-product' | 'feed' | 'processed';

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
  egg: { id: 'egg', name: 'Egg', category: 'animal-product', price: 10, icon: '🥚' },
  milk: { id: 'milk', name: 'Milk', category: 'animal-product', price: 18, icon: '🥛' },
  wool: { id: 'wool', name: 'Wool', category: 'animal-product', price: 25, icon: '🧶' },
  feed: { id: 'feed', name: 'Feed', category: 'feed', price: 3, icon: '🌰' },
  cheese: { id: 'cheese', name: 'Cheese', category: 'processed', price: 50, icon: '🧀' },
  butter: { id: 'butter', name: 'Butter', category: 'processed', price: 30, icon: '🧈' },
  bread: { id: 'bread', name: 'Bread', category: 'processed', price: 40, icon: '🍞' },
  cloth: { id: 'cloth', name: 'Cloth', category: 'processed', price: 75, icon: '🧵' },
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

const ICON_PATTERN = new RegExp(`(${Object.keys(ICON_EMOJI).join('|')})`, 'u');

export type TextPart = string | { icon: string; emoji: string };

/** Splits text into plain runs and the emoji that have a pack icon, e.g. "+3 🥚 Egg" → ["+3 ", {icon: 'egg'}, " Egg"]. */
export function splitIcons(text: string): TextPart[] {
  return text
    .split(ICON_PATTERN)
    .filter((part) => part !== '')
    .map((part) => (Object.hasOwn(ICON_EMOJI, part) ? { icon: ICON_EMOJI[part], emoji: part } : part));
}
