/**
 * Depth layers. Flat things sit on the ground; tall things (buildings, pens, fences) are sorted
 * back to front by footprint into [TALL_DEPTH, TALL_DEPTH + 1).
 */
export const DEPTH = {
  ground: 0,
  flat: 1,
  /** Things on locked land behind the farm, e.g. "for sale" signs there. */
  behindFarm: 5,
  tall: 10,
  /** Things on locked land in front of the farm. */
  frontOfFarm: 50,
  hover: 900,
  ghost: 1000,
  floatText: 2000,
} as const;
