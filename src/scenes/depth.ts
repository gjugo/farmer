import { isBehind, type Footprint } from './iso';

/**
 * Depth layers. Flat things sit on the ground, shadows lie on top of them, and standing things (buildings,
 * crops, pens, scenery) are sorted back to front by footprint into [tall, tall + 1).
 */
export const DEPTH = {
  ground: 0,
  flat: 1,
  /** Grass fringes over the edges of paths and fields (src/features/fringes): above them, under shadows and walkers. */
  fringe: 3,
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

/** The standing things' footprints with the depth each was given, as last sorted by the Farm scene. */
let standing: { fp: Footprint; depth: number }[] = [];

export function setStandingDepths(list: { fp: Footprint; depth: number }[]): void {
  standing = list;
}

/**
 * Depth for something small walking about at grid point (gx, gy), e.g. a farmer: just in front of every
 * standing thing behind it or under its feet, so it passes behind a barn and in front of the one it works at.
 */
export function walkerDepth(gx: number, gy: number): number {
  const me = { x: gx - 0.15, y: gy - 0.15, w: 0.3, h: 0.3 };
  const step = 1 / (standing.length + 1);
  let depth = DEPTH.tall - step;
  for (const { fp, depth: d } of standing) {
    const under = gx >= fp.x && gy >= fp.y && gx <= fp.x + fp.w && gy <= fp.y + fp.h;
    if (d > depth && (under || isBehind(fp, me))) depth = d;
  }
  return depth + step / 2;
}
