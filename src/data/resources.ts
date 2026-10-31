import { getItem, ITEM_LIST, type ItemCategory } from './items';
import { isMaterial } from './materials';
import type { StoragePool } from './storage';

/**
 * Resource categories, as the HUD's resource bar and the stock piles at the granaries and storehouses show
 * them. An item falls into a category by its `ItemDef.category`, so a new item needs no change here.
 */

export type ResourceCategory = 'crops' | 'animal' | 'feed' | 'goods' | 'materials';

export interface ResourceCategoryDef {
  id: ResourceCategory;
  name: string;
  /** Pack icon of the category's chip (an item icon, see `ICON_ART`). */
  icon: string;
  /** Item categories that belong here. */
  itemCategories: readonly ItemCategory[];
  /** The storage pool its items are kept in. */
  pool: StoragePool;
}

/** Bar order: left to right. */
export const RESOURCE_CATEGORIES: readonly ResourceCategoryDef[] = [
  { id: 'crops', name: 'Crops', icon: 'wheat', itemCategories: ['crop'], pool: 'goods' },
  { id: 'animal', name: 'Animal products', icon: 'egg', itemCategories: ['animal-product'], pool: 'goods' },
  { id: 'feed', name: 'Feed', icon: 'feed', itemCategories: ['feed'], pool: 'goods' },
  { id: 'goods', name: 'Goods', icon: 'cheese', itemCategories: ['processed'], pool: 'goods' },
  { id: 'materials', name: 'Materials', icon: 'wood', itemCategories: ['material'], pool: 'materials' },
];

export function getResourceCategory(id: ResourceCategory): ResourceCategoryDef {
  return RESOURCE_CATEGORIES.find((c) => c.id === id)!;
}

/**
 * The category an item is counted in. Unknown ids (e.g. from an old save) count as materials when they are a
 * material and as goods otherwise, like the storage pools.
 */
export function categoryOf(itemId: string): ResourceCategory {
  const item = getItem(itemId);
  const found = item && RESOURCE_CATEGORIES.find((c) => c.itemCategories.includes(item.category));
  if (found) return found.id;
  return isMaterial(itemId) ? 'materials' : 'goods';
}

/** The catalogue's items of a category, in catalogue order. */
export function itemsOf(category: ResourceCategory): string[] {
  return ITEM_LIST.filter((i) => categoryOf(i.id) === category).map((i) => i.id);
}

/** Each category's total in an inventory (every category present, 0 when empty). */
export function categoryTotals(inventory: Readonly<Record<string, number>>): Record<ResourceCategory, number> {
  const totals = Object.fromEntries(RESOURCE_CATEGORIES.map((c) => [c.id, 0])) as Record<ResourceCategory, number>;
  for (const [id, n] of Object.entries(inventory)) totals[categoryOf(id)] += n;
  return totals;
}

// Stock piles in the world --------------------------------------------------------------

/**
 * The piles a storage building shows in its yard: a granary one per goods category, a storehouse one per
 * material. Listed back to front, the order they are drawn in.
 */
export const GRANARY_PILES = ['crops', 'animal', 'feed', 'goods'] as const;
export const STOREHOUSE_PILES = ['wood', 'stone', 'iron'] as const;

export type PileKind = (typeof GRANARY_PILES)[number] | (typeof STOREHOUSE_PILES)[number];

/** The pile an item lies on: its category at a granary, the item itself at a storehouse (a new material on the stone pile). */
export function pileOf(itemId: string): PileKind {
  const category = categoryOf(itemId);
  if (category !== 'materials') return category;
  return (STOREHOUSE_PILES as readonly string[]).includes(itemId) ? (itemId as PileKind) : 'stone';
}

/** Fill stages of a pile: 0 none, then ¼, ½, ¾ and full. */
export const PILE_STAGES = 4;
export type PileStage = 0 | 1 | 2 | 3 | 4;
