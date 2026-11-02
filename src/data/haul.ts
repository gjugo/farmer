import { registerBuildable } from './buildables';

/**
 * Oxcart hauling: a resource building's yield lands in its own yard, and an ox barn's cart drives it along the paths
 * to the stores, so the farmer working there keeps producing. Rules live in `src/logic/haul.ts`; the barn's look,
 * panel and the carts on the map in `src/features/haul`.
 */

export const OX_BARN = 'oxbarn';

/** What an ox costs, bought in the barn's panel. */
export const OX_PRICE = 300;

/** Most units a cart carries in one trip. */
export const CART_CAPACITY = 20;

/** Game ms the ox takes to pull the cart one tile (a farmer walks one in `WALK_MS_PER_TILE`, 400). */
export const OX_MS_PER_TILE = 600;

/** Game ms of loading the cart at a yard, and of unloading it at a store. */
export const CART_LOAD_MS = 10_000;
export const CART_UNLOAD_MS = 10_000;

/** A resource building's yard holds this many cycles' yield. */
export const YARD_CYCLES = 3;

registerBuildable({
  id: OX_BARN,
  name: 'Ox Barn',
  cost: 250,
  materials: { wood: 30, stone: 15 },
  footprint: { w: 3, h: 2 },
  texture: OX_BARN,
  category: 'storage',
  description: 'Buy an ox and give it a carter: the oxcart hauls goods from the yards to the stores along the paths.',
  icon: '🐂',
  unlockLevel: 3,
  initialState: () => ({ ox: false, cargo: {} }),
});
