import type { GameState } from './types';

function assertAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`Invalid amount: ${amount}`);
}

export function canAfford(state: GameState, amount: number): boolean {
  assertAmount(amount);
  return state.money >= amount;
}

/** Takes money. Refuses (returns false, nothing changes) when the player is short. */
export function spend(state: GameState, amount: number): boolean {
  if (!canAfford(state, amount)) return false;
  state.money -= amount;
  return true;
}

export function earn(state: GameState, amount: number): void {
  assertAmount(amount);
  state.money += amount;
}
