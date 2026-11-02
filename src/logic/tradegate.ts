import type { GameState } from './types';

/**
 * Whether the farm can trade now (the Market, Orders and the travelling trader). The trading post registers the rule
 * (`src/logic/tradepost.ts`); trade logic asks here, so it needn't know about posts, paths and the road.
 */
export type TradeGate = (state: GameState) => boolean;

let gate: TradeGate | null = null;
let enabled = true;

export function registerTradeGate(rule: TradeGate): void {
  gate = rule;
}

/** Tests that are not about the trading post trade without one (`src/test-setup.ts`). */
export function setTradeGateEnabled(on: boolean): void {
  enabled = on;
}

/** Can the farm trade now? */
export function tradeOpen(state: GameState): boolean {
  return !enabled || !gate || gate(state);
}
