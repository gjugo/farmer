import { setHazardsEnabled } from './logic/hazards';
import { setTradeGateEnabled } from './logic/tradegate';

// Hazards roll on a random seed per farm: tests that are not about them run without them (`src/logic/hazards.test.ts`
// and the balance test turn them back on).
setHazardsEnabled(false);

// Trade needs a trading post linked to the main road: tests that are not about it trade without one
// (`src/logic/tradepost.test.ts` turns the rule back on).
setTradeGateEnabled(false);
