import type { JobKind } from './workers';

/**
 * Tools: forged at the blacksmith (`src/data/processing.ts`), kept in the storehouse and taken by farmers. A farmer with
 * tools does the work of a job faster; each job wears them, and worn-out tools break. Never a requirement: without tools
 * farmers work at their normal speed. Rules live in `src/logic/tools.ts`.
 */

export const TOOLS_ITEM = 'tools';

/** Jobs one set of tools lasts. */
export const TOOL_USES = 30;

/** With tools, a job's work takes 1/`TOOL_SPEED` of the time: 25% faster. */
export const TOOL_SPEED = 1.25;

/**
 * The jobs tools speed up (and wear on): the work itself. Walking (Good boots), hauling (the ox) and processing batches
 * (Quick hands) are not done by hand tools.
 */
export const TOOL_JOBS: readonly JobKind[] = ['build', 'plough', 'plant', 'harvest', 'fertilise', 'feed', 'collect', 'load', 'chop', 'quarry', 'mine'];
