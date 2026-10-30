/**
 * The isometric projection: the one place that turns grid tiles into world pixels and back.
 * Plain TypeScript (no Phaser) so it can be unit-tested.
 *
 * The logic map is a grid of square tiles. Grid point (gx, gy) (tile corners are integers,
 * tile (x, y) covers [x, x+1) × [y, y+1)) is drawn at
 *
 *   world.x = (gx - gy) * ISO_W / 2
 *   world.y = (gx + gy) * ISO_H / 2
 *
 * so every tile becomes a diamond ISO_W wide and ISO_H tall. Grid (0, 0) is the top corner of
 * the map; +x runs down-right and +y runs down-left on screen.
 */

/** Width of one tile's diamond in world pixels. The art pack decides the ratio (2:1 here). */
export const ISO_W = 64;
/** Height of one tile's diamond in world pixels. */
export const ISO_H = 32;

const HW = ISO_W / 2;
const HH = ISO_H / 2;

export interface Point {
  x: number;
  y: number;
}

/** A rectangle of tiles: top-left tile (x, y) and size w × h in tiles. */
export interface Footprint {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An axis-aligned box in world pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** World pixel of a grid point (tile corners are integer grid points). */
export function gridToWorld(gx: number, gy: number): Point {
  return { x: (gx - gy) * HW, y: (gx + gy) * HH };
}

/** Grid point (fractional) under a world pixel; the exact inverse of `gridToWorld`. */
export function worldToGrid(wx: number, wy: number): Point {
  return { x: wy / ISO_H + wx / ISO_W, y: wy / ISO_H - wx / ISO_W };
}

/** World pixel of the centre of tile (x, y). */
export function tileToWorld(x: number, y: number): Point {
  return gridToWorld(x + 0.5, y + 0.5);
}

/**
 * The tile whose diamond contains the world pixel. Diamonds are the image of the grid squares,
 * so flooring the inverse is an exact hit test (a point on a shared edge goes to the tile below/right).
 */
export function worldToTile(wx: number, wy: number): Point {
  const g = worldToGrid(wx, wy);
  // The epsilon absorbs float noise from the camera transform for points exactly on an edge.
  return { x: Math.floor(g.x + 1e-9), y: Math.floor(g.y + 1e-9) };
}

/** The four corners of a footprint's diamond in world pixels. */
export function footprintCorners(fp: Footprint): { top: Point; right: Point; bottom: Point; left: Point } {
  return {
    top: gridToWorld(fp.x, fp.y),
    right: gridToWorld(fp.x + fp.w, fp.y),
    bottom: gridToWorld(fp.x + fp.w, fp.y + fp.h),
    left: gridToWorld(fp.x, fp.y + fp.h),
  };
}

/** The world box around a footprint's diamond (ground only, not what stands on it). */
export function footprintBox(fp: Footprint): Box {
  const c = footprintCorners(fp);
  return { left: c.left.x, top: c.top.y, width: c.right.x - c.left.x, height: c.bottom.y - c.top.y };
}

/**
 * Position of grid point (gx, gy), relative to the footprint's own top-left tile, inside the box of a
 * w × h footprint (what a texture or a container at `footprintBox` uses).
 */
export function footprintLocal(_w: number, h: number, gx: number, gy: number): Point {
  return { x: (gx - gy + h) * HW, y: (gx + gy) * HH };
}

/** The corners of a w × h footprint's diamond inside its own box (for drawing textures). */
export function localCorners(w: number, h: number): { top: Point; right: Point; bottom: Point; left: Point } {
  return {
    top: footprintLocal(w, h, 0, 0),
    right: footprintLocal(w, h, w, 0),
    bottom: footprintLocal(w, h, w, h),
    left: footprintLocal(w, h, 0, h),
  };
}

/** What the camera transform needs: scroll, zoom and viewport size (zoom is around the viewport centre). */
export interface CameraView {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
}

/** World pixel under a viewport pixel (same transform as Phaser's `camera.getWorldPoint` without rotation). */
export function screenToWorld(cam: CameraView, sx: number, sy: number): Point {
  const ox = cam.width / 2;
  const oy = cam.height / 2;
  return { x: cam.scrollX + ox + (sx - ox) / cam.zoom, y: cam.scrollY + oy + (sy - oy) / cam.zoom };
}

/** Viewport pixel of a world pixel; the inverse of `screenToWorld`. */
export function worldToScreen(cam: CameraView, wx: number, wy: number): Point {
  const ox = cam.width / 2;
  const oy = cam.height / 2;
  return { x: (wx - cam.scrollX - ox) * cam.zoom + ox, y: (wy - cam.scrollY - oy) * cam.zoom + oy };
}

/** The world box around a whole width × height map. */
export function mapBox(width: number, height: number): Box {
  return footprintBox({ x: 0, y: 0, w: width, h: height });
}

/**
 * Depth key of a footprint: its front-most (bottom) corner, i.e. how far down the screen it reaches.
 * Good for flat things; tall things need `sortFootprints`, because a long footprint can reach further
 * down than a neighbour that still stands in front of it.
 */
export function depthKey(fp: Footprint): number {
  return fp.x + fp.w + fp.y + fp.h;
}

const EPS = 1e-6;

/** True when A must be drawn before B: they overlap on screen and A is behind B on one grid axis. */
export function isBehind(a: Footprint, b: Footprint): boolean {
  // Horizontal screen extent in grid units is [x - (y + h), (x + w) - y].
  const overlap = Math.min(a.x + a.w - a.y, b.x + b.w - b.y) - Math.max(a.x - a.y - a.h, b.x - b.y - b.h);
  if (overlap <= EPS) return false;
  return a.x + a.w <= b.x + EPS || a.y + a.h <= b.y + EPS;
}

/**
 * Drawing order for tall things standing on non-overlapping footprints (zero-width footprints are fine,
 * e.g. fence lines). Returns the indices back to front: whenever two footprints overlap on screen, the
 * one behind comes first. Ties keep a stable order by the footprint's centre.
 */
export function sortFootprints(fps: readonly Footprint[]): number[] {
  const n = fps.length;
  const after: number[][] = fps.map(() => []);
  const blockers = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && isBehind(fps[i], fps[j]) && !isBehind(fps[j], fps[i])) {
        after[i].push(j);
        blockers[j]++;
      }
    }
  }
  const centre = (i: number) => fps[i].x + fps[i].w / 2 + fps[i].y + fps[i].h / 2;
  const done = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  while (order.length < n) {
    // Take the free footprint nearest the back; if a cycle ever leaves none free, break it the same way.
    let pick = -1;
    let pickFree = false;
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      const free = blockers[i] === 0;
      if (pick < 0 || (free && !pickFree) || (free === pickFree && centre(i) < centre(pick))) {
        pick = i;
        pickFree = free;
      }
    }
    done[pick] = true;
    order.push(pick);
    for (const j of after[pick]) blockers[j]--;
  }
  return order;
}
