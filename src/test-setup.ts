import { setHazardsEnabled } from './logic/hazards';
// In tests a new game is laid out as the classic start (farmhouse, starting fields, road) unless a test turns it off.
import './logic/test-utils';

// Hazards roll on a random seed per farm: tests that are not about them run without them (`src/logic/hazards.test.ts`
// and the balance test turn them back on).
setHazardsEnabled(false);
