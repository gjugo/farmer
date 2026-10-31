import { getItem, ITEMS } from './items';

/** Building materials, in the order costs are listed. Each is an item (category `material`) in `ITEMS`. */
export const MATERIAL_IDS = ['wood', 'stone', 'iron'] as const;

export type MaterialId = (typeof MATERIAL_IDS)[number];

/** Materials a buildable takes, on top of its money cost. */
export type MaterialCost = Partial<Record<MaterialId, number>>;

/** Farm level from which the Market sells each material. Iron comes with the dairy, the first building that needs it. */
export const MATERIAL_UNLOCK: Readonly<Record<MaterialId, number>> = { wood: 1, stone: 1, iron: 3 };

export function isMaterial(id: string): id is MaterialId {
  return (MATERIAL_IDS as readonly string[]).includes(id);
}

/**
 * Kept in the storehouses with the building materials, and out of "sell everything": the building materials plus
 * the other items of category `material` (manure, which the Market does not sell).
 */
export function isStoredMaterial(id: string): boolean {
  return isMaterial(id) || getItem(id)?.category === 'material';
}

/** "8 🪵 Wood + 4 🪨 Stone", or '' for no materials. */
export function formatMaterials(cost: MaterialCost | undefined): string {
  return materialEntries(cost)
    .map(([id, qty]) => `${qty} ${ITEMS[id].icon} ${ITEMS[id].name}`)
    .join(' + ');
}

/** The cost's materials with a positive amount, in `MATERIAL_IDS` order. */
export function materialEntries(cost: MaterialCost | undefined): [MaterialId, number][] {
  return MATERIAL_IDS.flatMap((id) => {
    const qty = cost?.[id] ?? 0;
    return qty > 0 ? [[id, qty] as [MaterialId, number]] : [];
  });
}

/** "4 more 🪵 Wood and 2 more 🔩 Iron", for materials missing to pay a cost. */
export function formatMissing(missing: readonly (readonly [MaterialId, number])[]): string {
  const parts = missing.map(([id, qty]) => `${qty} more ${ITEMS[id].icon} ${ITEMS[id].name}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? '');
}

/** Why a building can't be paid for, e.g. "Needs 4 more 🪵 Wood: buy it at the 🏪 Market". */
export function needsMaterialsMessage(missing: readonly (readonly [MaterialId, number])[]): string {
  return `Needs ${formatMissing(missing)}: buy ${missing.length > 1 ? 'them' : 'it'} at the 🏪 Market`;
}
