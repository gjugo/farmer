/** Map size in tiles. */
export const MAP_WIDTH = 64;
export const MAP_HEIGHT = 48;

const START_W = 16;
const START_H = 12;

/** Starting owned area (in tiles), centred on the map. */
export const START_LAND = {
  w: START_W,
  h: START_H,
  x: Math.floor((MAP_WIDTH - START_W) / 2),
  y: Math.floor((MAP_HEIGHT - START_H) / 2),
} as const;

/**
 * Top-left tile of the new farm's layout (starting fields, then the farmhouse to their right), inset into the
 * starting land so it sits near its middle with room to build all around.
 */
export const START_LAYOUT = { x: START_LAND.x + 4, y: START_LAND.y + 4 } as const;

export const STARTING_MONEY = 500;

/** One in-game day lasts 8 real minutes at ×1 speed. */
export const DAY_MS = 8 * 60 * 1000;

/** Share of the build cost returned when demolishing. */
export const DEMOLISH_REFUND = 0.5;
