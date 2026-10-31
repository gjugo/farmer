import { ITEMS } from './items';

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
