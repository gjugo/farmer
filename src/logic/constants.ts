/** Map size in tiles. */
export const MAP_WIDTH = 32;
export const MAP_HEIGHT = 24;

/** Starting owned area (in tiles), centred on the map. */
export const START_LAND = {
  w: 10,
  h: 8,
  x: Math.floor((MAP_WIDTH - 10) / 2),
  y: Math.floor((MAP_HEIGHT - 8) / 2),
} as const;

export const STARTING_MONEY = 500;

/** One in-game day lasts 8 real minutes at ×1 speed. */
export const DAY_MS = 8 * 60 * 1000;

/** Share of the build cost returned when demolishing. */
export const DEMOLISH_REFUND = 0.5;
