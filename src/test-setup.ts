import { setHazardsEnabled } from './logic/hazards';

// Hazards roll on a random seed per farm: tests that are not about them run without them (`src/logic/hazards.test.ts`
// and the balance test turn them back on).
setHazardsEnabled(false);
