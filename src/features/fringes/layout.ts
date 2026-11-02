import { FIELD } from '../../data/crops';
import { neighbourMask, type FringeKind } from '../../scenes/art';

/** The buildables that get grass fringes along their edges, and which strips. */
export const FRINGED: Readonly<Record<string, FringeKind>> = { path: 'path', [FIELD]: 'field', road: 'road' };
/** The type the main road's tiles are given in the layout (they are no object of the farm's). */
export const ROAD_TYPE = 'road';

/** A placed object's footprint, as the layout needs it. */
export interface FringeObject {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A path or field tile with fringes: `edges` is a neighbour mask (`NE`, `SE`, `SW`, `NW` bits) of the fringed edges. */
export interface FringeTile {
  x: number;
  y: number;
  kind: FringeKind;
  edges: number;
}

/**
 * Where the grass fringes go: along every edge of a path or field tile whose neighbour is open grass on the map,
 * i.e. a tile no object stands on. So none between two paths, between a path and a field, along buildings, pens and
 * pastures (their pads and paddocks are objects) or inside a field; a field's fringes run round its outer edge only.
 * Back to front, the order to draw them in.
 */
export function fringeTiles(objects: readonly FringeObject[], inMap: (x: number, y: number) => boolean): FringeTile[] {
  const at = (x: number, y: number) => `${x},${y}`;
  const covered = new Set<string>();
  for (const o of objects) for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) covered.add(at(x, y));
  const grass = (x: number, y: number) => inMap(x, y) && !covered.has(at(x, y));
  const out: FringeTile[] = [];
  for (const o of objects) {
    const kind = FRINGED[o.type];
    if (!kind) continue;
    for (let y = o.y; y < o.y + o.h; y++) {
      for (let x = o.x; x < o.x + o.w; x++) {
        const edges = neighbourMask(grass, x, y);
        if (edges) out.push({ x, y, kind, edges });
      }
    }
  }
  return out.sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
}
