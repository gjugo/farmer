import { describe, expect, it } from 'vitest';
import { START_LAND } from '../logic/constants';
import { STARTING_FARMHOUSE } from '../logic/roads';
import {
  depthKey,
  footprintBox,
  footprintCorners,
  footprintLocal,
  gridToWorld,
  isBehind,
  ISO_H,
  ISO_W,
  mapBox,
  MIN_TILE_PX,
  OPENING_MARGIN,
  openingView,
  screenToWorld,
  sortFootprints,
  tileToWorld,
  worldToGrid,
  worldToScreen,
  worldToTile,
  type CameraView,
  type Footprint,
} from './iso';

const W = 32;
const H = 24;

describe('projection', () => {
  it('draws each tile as an ISO_W × ISO_H diamond', () => {
    const c = footprintCorners({ x: 3, y: 5, w: 1, h: 1 });
    expect(c.right.x - c.left.x).toBe(ISO_W);
    expect(c.bottom.y - c.top.y).toBe(ISO_H);
    expect(c.top.x).toBe(c.bottom.x);
    expect(c.left.y).toBe(c.right.y);
  });

  it('round-trips grid → world → grid', () => {
    for (const [gx, gy] of [
      [0, 0],
      [31.25, 0.5],
      [7.9, 23.1],
      [-1, 40],
    ]) {
      const w = gridToWorld(gx, gy);
      const g = worldToGrid(w.x, w.y);
      expect(g.x).toBeCloseTo(gx, 9);
      expect(g.y).toBeCloseTo(gy, 9);
    }
  });

  it('finds every tile from its own centre', () => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = tileToWorld(x, y);
        expect(worldToTile(c.x, c.y)).toEqual({ x, y });
      }
    }
  });

  it('picks the tile drawn there just inside each edge and corner of a diamond', () => {
    const inset = 0.6; // world px
    for (const [x, y] of [
      [0, 0],
      [5, 9],
      [31, 23],
    ]) {
      const { top, right, bottom, left } = footprintCorners({ x, y, w: 1, h: 1 });
      const c = tileToWorld(x, y);
      const towardCentre = (p: { x: number; y: number }) => {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        return { x: p.x + ((c.x - p.x) / d) * inset, y: p.y + ((c.y - p.y) / d) * inset };
      };
      const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => towardCentre({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      for (const p of [top, right, bottom, left].map(towardCentre)) expect(worldToTile(p.x, p.y)).toEqual({ x, y });
      for (const p of [mid(top, right), mid(right, bottom), mid(bottom, left), mid(left, top)]) {
        expect(worldToTile(p.x, p.y)).toEqual({ x, y });
      }
    }
  });

  it('picks the neighbour just outside each edge', () => {
    const { top, right, bottom, left } = footprintCorners({ x: 5, y: 9, w: 1, h: 1 });
    const out = (a: { x: number; y: number }, b: { x: number; y: number }, dx: number, dy: number) =>
      worldToTile((a.x + b.x) / 2 + dx, (a.y + b.y) / 2 + dy);
    expect(out(top, right, 0.5, -0.5)).toEqual({ x: 5, y: 8 });
    expect(out(right, bottom, 0.5, 0.5)).toEqual({ x: 6, y: 9 });
    expect(out(bottom, left, -0.5, 0.5)).toEqual({ x: 5, y: 10 });
    expect(out(left, top, -0.5, -0.5)).toEqual({ x: 4, y: 9 });
  });

  it('gives a point on a shared edge to exactly one tile', () => {
    const { right, bottom } = footprintCorners({ x: 5, y: 9, w: 1, h: 1 });
    expect(worldToTile((right.x + bottom.x) / 2, (right.y + bottom.y) / 2)).toEqual({ x: 6, y: 9 });
  });

  it('boxes footprints and the map around their diamonds', () => {
    expect(footprintBox({ x: 0, y: 0, w: 3, h: 2 })).toEqual({ left: -2 * (ISO_W / 2), top: 0, width: 5 * (ISO_W / 2), height: 5 * (ISO_H / 2) });
    const m = mapBox(W, H);
    expect(m.width).toBe((W + H) * (ISO_W / 2));
    expect(m.height).toBe((W + H) * (ISO_H / 2));
    expect(m.left).toBe(gridToWorld(0, H).x);
  });

  it('maps footprint-local points relative to the footprint box', () => {
    const fp = { x: 4, y: 7, w: 3, h: 2 };
    const box = footprintBox(fp);
    const local = footprintLocal(fp.w, fp.h, 1.5, 0.5);
    const world = gridToWorld(fp.x + 1.5, fp.y + 0.5);
    expect(box.left + local.x).toBeCloseTo(world.x);
    expect(box.top + local.y).toBeCloseTo(world.y);
  });
});

describe('camera transform', () => {
  for (const zoom of [0.5, 1, 3]) {
    const cam: CameraView = { scrollX: -700, scrollY: 40, zoom, width: 390, height: 844 };

    it(`round-trips screen ↔ world at zoom ${zoom}`, () => {
      const w = screenToWorld(cam, 123, 456);
      const s = worldToScreen(cam, w.x, w.y);
      expect(s.x).toBeCloseTo(123, 9);
      expect(s.y).toBeCloseTo(456, 9);
    });

    it(`picks the tile just inside a diamond edge at zoom ${zoom}`, () => {
      // Half a screen pixel inside the bottom-right edge of tile (12, 10).
      const { right, bottom } = footprintCorners({ x: 12, y: 10, w: 1, h: 1 });
      const edge = worldToScreen(cam, (right.x + bottom.x) / 2, (right.y + bottom.y) / 2);
      const inside = screenToWorld(cam, edge.x - 0.5, edge.y - 0.5);
      const outside = screenToWorld(cam, edge.x + 0.5, edge.y + 0.5);
      expect(worldToTile(inside.x, inside.y)).toEqual({ x: 12, y: 10 });
      expect(worldToTile(outside.x, outside.y)).toEqual({ x: 13, y: 10 });
    });
  }
});

describe('depth', () => {
  it('keys flat footprints by their front corner', () => {
    expect(depthKey({ x: 2, y: 3, w: 2, h: 2 })).toBeGreaterThan(depthKey({ x: 1, y: 1, w: 2, h: 2 }));
  });

  it('puts the footprint in front later even when the one behind reaches further down', () => {
    // A long 1×4 building and a 1×1 one to its right: the small one is in front along x.
    const long: Footprint = { x: 0, y: 0, w: 1, h: 4 };
    const small: Footprint = { x: 1, y: 0, w: 1, h: 1 };
    expect(depthKey(long)).toBeGreaterThan(depthKey(small)); // the naive key gets this wrong
    expect(isBehind(long, small)).toBe(true);
    expect(sortFootprints([small, long])).toEqual([1, 0]);
  });

  it('does not order footprints that never overlap on screen', () => {
    expect(isBehind({ x: 0, y: 2, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false);
    expect(isBehind({ x: 2, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 2, h: 2 })).toBe(false);
  });

  it('orders fence lines against the buildings on either side', () => {
    const fence: Footprint = { x: 6, y: 5, w: 0, h: 3 }; // the line x = 6 from y 5 to 8
    const inside: Footprint = { x: 4, y: 5, w: 2, h: 2 };
    const outside: Footprint = { x: 6, y: 6, w: 1, h: 1 };
    const order = sortFootprints([outside, fence, inside]);
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(1));
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(0));
  });

  it('sorts a packed farm so nothing behind is drawn after something in front of it', () => {
    const fps: Footprint[] = [];
    const sizes = [
      [2, 2],
      [3, 2],
      [3, 3],
      [4, 4],
      [1, 1],
    ];
    // Fill a 20×16 area row by row with mixed sizes (shelf packing, no overlaps).
    let i = 0;
    for (let y = 0; y < 16; ) {
      let rowH = 1;
      for (let x = 0; x < 20; ) {
        const [w, h] = sizes[i++ % sizes.length];
        if (x + w > 20 || y + h > 16) break;
        fps.push({ x, y, w, h });
        x += w;
        rowH = Math.max(rowH, h);
      }
      y += rowH;
    }
    const order = sortFootprints(fps);
    const rank = new Map(order.map((idx, r) => [idx, r]));
    for (let a = 0; a < fps.length; a++) {
      for (let b = 0; b < fps.length; b++) {
        if (a !== b && isBehind(fps[a], fps[b])) expect(rank.get(a)!).toBeLessThan(rank.get(b)!);
      }
    }
  });
});

describe('opening view', () => {
  const house = { x: STARTING_FARMHOUSE.x + 1, y: STARTING_FARMHOUSE.y + 1 };
  const visible = (view: { zoom: number; centre: { x: number; y: number } }, w: number, h: number, gx: number, gy: number) => {
    const cam: CameraView = { scrollX: view.centre.x - w / 2, scrollY: view.centre.y - h / 2, zoom: view.zoom, width: w, height: h };
    const s = worldToScreen(cam, gridToWorld(gx, gy).x, gridToWorld(gx, gy).y);
    return s.x >= -1e-6 && s.y >= -1e-6 && s.x <= w + 1e-6 && s.y <= h + 1e-6;
  };

  it('shows the whole starting farm and two tiles around it on a 1280×800 window', () => {
    const view = openingView(START_LAND, 1280, 800, house);
    const { x, y, w, h } = START_LAND;
    const m = OPENING_MARGIN;
    for (const [gx, gy] of [
      [x - m, y - m],
      [x + w + m, y - m],
      [x + w + m, y + h + m],
      [x - m, y + h + m],
    ]) {
      expect(visible(view, 1280, 800, gx, gy)).toBe(true);
    }
    // Before the map grew the 10×8 farm opened at about 0.91; now it is 0.6–0.7 of that.
    expect(view.zoom / 0.91).toBeGreaterThan(0.58);
    expect(view.zoom / 0.91).toBeLessThan(0.7);
    expect(view.zoom * ISO_W).toBeGreaterThanOrEqual(MIN_TILE_PX);
  });

  it('keeps tiles tappable on a phone and centres on the farmhouse', () => {
    const view = openingView(START_LAND, 390, 844, house);
    expect(view.zoom * ISO_W).toBe(MIN_TILE_PX);
    expect(view.centre).toEqual(gridToWorld(house.x, house.y));
  });
});
