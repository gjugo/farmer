import type { Inventory, ItemId } from './types';

function assertQty(qty: number): void {
  if (!Number.isInteger(qty) || qty < 0) throw new RangeError(`Invalid quantity: ${qty}`);
}

export function count(inv: Inventory, itemId: ItemId): number {
  return inv[itemId] ?? 0;
}

export function add(inv: Inventory, itemId: ItemId, qty = 1): void {
  assertQty(qty);
  if (qty === 0) return;
  inv[itemId] = count(inv, itemId) + qty;
}

/** Removes items. Refuses (returns false, nothing changes) when there are not enough. */
export function remove(inv: Inventory, itemId: ItemId, qty = 1): boolean {
  assertQty(qty);
  const have = count(inv, itemId);
  if (have < qty) return false;
  if (have === qty) delete inv[itemId];
  else inv[itemId] = have - qty;
  return true;
}
