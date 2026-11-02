import { registerBuildable } from './buildables';
import type { KnownItemId } from './items';

/**
 * The starting camp: the settlers arrive with supplies of food and materials, shown as a tent with piles around it
 * beside the farmhouse. The supplies are ordinary stock; the camp only keeps track of how much of them is left and
 * makes room for it, and it is packed away once they are used up. Rules live in `src/logic/camp.ts`; the look and
 * panel in `src/features/camp`.
 */

export const CAMP = 'camp';

/**
 * What a new farm starts with. 40 wood and 20 stone pay for a granary (5 wood), a cottage (8 wood), a storehouse
 * (8 wood, 8 stone) and a coop or a well besides; 30 food in two kinds feeds the first family for 15 days, or the
 * first three families (the farmhouse's and two cottages') for about 5.
 */
export const CAMP_SUPPLIES: Readonly<Partial<Record<KnownItemId, number>>> = { wood: 40, stone: 20, bread: 15, carrot: 15 };

/** The camp's footprint: the tent on the back tiles, the piles scattered over the rest. */
export const CAMP_FOOTPRINT = { w: 3, h: 3 } as const;

/** Game ms the tent takes to fade out when the camp is packed away. Only the look. */
export const CAMP_FADE_MS = 1200;

registerBuildable({
  id: CAMP,
  name: 'Camp',
  cost: 0,
  footprint: CAMP_FOOTPRINT,
  texture: 'camp',
  icon: '⛺',
  unlockLevel: 1,
  // Never in the build menu, never demolished: it goes by itself once its supplies are used up.
  fixed: true,
  description: 'The settlers’ tent and the supplies they brought. Packed away once the supplies are used up.',
  initialState: () => ({ left: { ...CAMP_SUPPLIES } }),
});
