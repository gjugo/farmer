/** Item id from the catalogue in `src/data/items.ts`. */
export type ItemId = string;

/** itemId → count. Counts are never negative; zero entries are removed. */
export type Inventory = Record<ItemId, number>;

/** An object placed on the map (a path, a field, a barn, ...). */
export interface PlacedObject<S extends object = Record<string, unknown>> {
  id: string;
  /** Buildable id from `src/data/buildables.ts`. */
  type: string;
  /** Top-left tile of the footprint. */
  x: number;
  y: number;
  /** Per-type state owned by the feature that registered the buildable. Must be JSON-serialisable. */
  state: S;
  /** Set while it is a construction site: unusable until a farmer has built it. Missing when built. */
  site?: ConstructionSite;
}

/** A building placed but not built yet. A free farmer walks there and builds it for `workMs`. */
export interface ConstructionSite {
  /** Game ms of building work it needs. */
  workMs: number;
  /** Money paid for it, all refunded when it is demolished unfinished. */
  paid: number;
}

export interface LandState {
  width: number;
  height: number;
  /** Row-major, `1` = owned by the player, `0` = locked. */
  owned: number[];
}

export interface ClockState {
  /** Game milliseconds elapsed since the farm was founded. */
  elapsed: number;
  /** Multiplier applied to real time. Not persisted: every session starts at ×1. */
  speed: number;
}

export interface GameState {
  money: number;
  inventory: Inventory;
  land: LandState;
  objects: PlacedObject[];
  /** Counter for unique object ids. */
  nextObjectId: number;
  clock: ClockState;
  /**
   * Feature-owned global state, keyed by feature name (e.g. `market`).
   * Register defaults with `registerStateSlice` so old saves get filled in.
   */
  ext: Record<string, unknown>;
}
