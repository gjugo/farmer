/**
 * Depth layers. Flat things sit on the ground, shadows lie on top of them, and standing things (buildings,
 * crops, pens, scenery) are sorted back to front by footprint into [tall, tall + 1).
 */
export const DEPTH = {
  ground: 0,
  flat: 1,
  /** Every shadow: above the ground and flat things, below everything standing. */
  shadow: 4,
  /** Things on locked land behind the farm, e.g. "for sale" signs there. */
  behindFarm: 5,
  tall: 10,
  /** Things on locked land in front of the farm. */
  frontOfFarm: 50,
  hover: 900,
  ghost: 1000,
  floatText: 2000,
} as const;
