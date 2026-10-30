import type Phaser from 'phaser';
import { footprintLocal, ISO_H, ISO_W, localCorners, type Point } from './iso';

export interface TextureDef {
  width: number;
  height: number;
  /** Draw with the Graphics API between (0,0) and (width,height). */
  draw(g: Phaser.GameObjects.Graphics): void;
}

const textures = new Map<string, TextureDef>();

/**
 * Registers a runtime-drawn texture. The Boot scene bakes every registered
 * texture, so features call this from their own module.
 */
export function registerTexture(key: string, def: TextureDef): void {
  if (textures.has(key)) throw new Error(`Texture "${key}" is already registered`);
  textures.set(key, def);
}

export function listTextures(): [string, TextureDef][] {
  return [...textures];
}

/** Deterministic pseudo-random numbers so textures look the same every load. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Isometric drawing helpers ------------------------------------------------------

type G = Phaser.GameObjects.Graphics;

/** Graphics' point APIs only read x and y; this saves allocating Vector2s. */
export function vectors(points: Point[]): Phaser.Math.Vector2[] {
  return points as unknown as Phaser.Math.Vector2[];
}

/** Fills a polygon. */
export function poly(g: G, color: number, points: Point[], alpha = 1): void {
  g.fillStyle(color, alpha).fillPoints(vectors(points), true);
}

/** Moves points by (dx, dy). */
export function shift(points: Point[], dx: number, dy: number): Point[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * The diamond of a w × h footprint inside its box, moved down by `top` (the room a texture leaves
 * above the ground for whatever stands on it). `grow` pushes the corners out by that many pixels so
 * neighbouring ground tiles overlap instead of showing seams.
 */
export function diamondPoints(w: number, h: number, top = 0, grow = 0): Point[] {
  const c = localCorners(w, h);
  const gx = grow;
  const gy = grow * (ISO_H / ISO_W);
  return [
    { x: c.top.x + grow, y: c.top.y + top - gy },
    { x: c.right.x + gx + grow, y: c.right.y + top },
    { x: c.bottom.x + grow, y: c.bottom.y + top + gy },
    { x: c.left.x - gx + grow, y: c.left.y + top },
  ];
}

/**
 * Texture size for something on a w × h footprint that rises `top` pixels above its diamond.
 * Drawn with its diamond at the bottom, so the sprite lines up when anchored at the box's bottom.
 */
export function footprintTexture(w: number, h: number, top = 0): { width: number; height: number } {
  return { width: ((w + h) * ISO_W) / 2, height: ((w + h) * ISO_H) / 2 + top };
}

export interface BoxLook {
  /** Wall facing down-left (lit). */
  left: number;
  /** Wall facing down-right (shaded). */
  right: number;
  /** Flat top. */
  top: number;
}

/**
 * An isometric box standing on the grid rectangle [gx0, gx1] × [gy0, gy1] of a w × h footprint,
 * `height` pixels tall. `top` is the texture's room above the footprint (as in `diamondPoints`).
 * Returns the corners of its top face.
 */
export function isoBox(
  g: G,
  w: number,
  h: number,
  top: number,
  rect: { gx0: number; gy0: number; gx1: number; gy1: number },
  height: number,
  look: BoxLook,
): { top: Point; right: Point; bottom: Point; left: Point } {
  const at = (gx: number, gy: number) => texPoint(w, h, top, gx, gy);
  const right = at(rect.gx1, rect.gy0);
  const bottom = at(rect.gx1, rect.gy1);
  const left = at(rect.gx0, rect.gy1);
  const back = at(rect.gx0, rect.gy0);
  const up = (p: Point) => ({ x: p.x, y: p.y - height });
  poly(g, look.left, [left, bottom, up(bottom), up(left)]);
  poly(g, look.right, [bottom, right, up(right), up(bottom)]);
  poly(g, look.top, [up(back), up(right), up(bottom), up(left)]);
  return { top: up(back), right: up(right), bottom: up(bottom), left: up(left) };
}

/** A grid point of a w × h footprint inside its texture (with `top` room above the diamond). */
export function texPoint(w: number, h: number, top: number, gx: number, gy: number): Point {
  const p = footprintLocal(w, h, gx, gy);
  return { x: p.x, y: p.y + top };
}

// Core textures ---------------------------------------------------------------

/** Ground tiles are one diamond, grown by a pixel so neighbours overlap without seams. */
const GROUND_GROW = 1;
const GROUND = { width: ISO_W + GROUND_GROW * 2, height: ISO_H + GROUND_GROW };

function grass(seed: number, base: number, light: number, dark: number) {
  return (g: G) => {
    const rnd = seeded(seed);
    poly(g, base, diamondPoints(1, 1, GROUND_GROW / 2, GROUND_GROW));
    for (let i = 0; i < 12; i++) {
      // Random tufts inside the diamond (sampled in grid space).
      const p = texPoint(1, 1, GROUND_GROW / 2, 0.15 + rnd() * 0.7, 0.15 + rnd() * 0.7);
      g.fillStyle(rnd() < 0.5 ? light : dark);
      g.fillRect(p.x + GROUND_GROW, p.y - 2, 1, 3).fillRect(p.x + GROUND_GROW + 2, p.y - 3, 1, 4);
    }
  };
}

for (let i = 0; i < 3; i++) {
  registerTexture(`grass-${i}`, { ...GROUND, draw: grass(11 + i * 7, 0x7ccf5a, 0x9be070, 0x5fae45) });
  registerTexture(`locked-${i}`, {
    ...GROUND,
    draw: (g) => {
      grass(31 + i * 5, 0x55744a, 0x627f55, 0x46623d)(g);
      // Faint hatching along one grid axis marks the land as not yours (yet).
      g.lineStyle(1, 0x3a5233, 0.5);
      for (const t of [0.25, 0.5, 0.75]) {
        const a = texPoint(1, 1, GROUND_GROW / 2, t, 0.05);
        const b = texPoint(1, 1, GROUND_GROW / 2, t, 0.95);
        g.lineBetween(a.x + GROUND_GROW, a.y, b.x + GROUND_GROW, b.y);
      }
    },
  });
}

registerTexture('path', {
  ...footprintTexture(1, 1),
  draw: (g) => {
    const rnd = seeded(5);
    poly(g, 0xc9a465, diamondPoints(1, 1));
    poly(g, 0xd8b67a, diamondPoints(1, 1).map((p) => ({ x: ISO_W / 2 + (p.x - ISO_W / 2) * 0.88, y: ISO_H / 2 + (p.y - ISO_H / 2) * 0.88 })));
    for (let i = 0; i < 10; i++) {
      const p = texPoint(1, 1, 0, 0.15 + rnd() * 0.7, 0.15 + rnd() * 0.7);
      g.fillStyle(rnd() < 0.5 ? 0xb8925a : 0xe8cc96);
      g.fillEllipse(p.x, p.y, 2 + rnd() * 3, 1.5 + rnd() * 1.5);
    }
  },
});

/** Fallback for objects whose buildable is no longer registered. */
registerTexture('missing', {
  ...footprintTexture(1, 1),
  draw: (g) => {
    poly(g, 0xd04f8a, diamondPoints(1, 1));
    poly(g, 0x30202a, [texPoint(1, 1, 0, 0, 0), texPoint(1, 1, 0, 0.5, 0), texPoint(1, 1, 0, 0.5, 0.5), texPoint(1, 1, 0, 0, 0.5)]);
    poly(g, 0x30202a, [texPoint(1, 1, 0, 0.5, 0.5), texPoint(1, 1, 0, 1, 0.5), texPoint(1, 1, 0, 1, 1), texPoint(1, 1, 0, 0.5, 1)]);
  },
});

const FENCE_WOOD = 0x8a5a2e;
const FENCE_WOOD_LIGHT = 0xb07b45;
/** Height of fence posts above the ground, in pixels. */
export const FENCE_H = Math.round(ISO_H * 0.5);

/**
 * A post-and-rail fence standing on the ground line from `a` to `b`, with `segments` gaps
 * between posts (one per tile looks right). Used for pens and the farm boundary.
 */
export function fenceLine(g: G, a: Point, b: Point, segments: number): void {
  const railAt = (lift: number) => {
    g.lineStyle(2, FENCE_WOOD).lineBetween(a.x, a.y - lift, b.x, b.y - lift);
  };
  railAt(FENCE_H * 0.4);
  railAt(FENCE_H * 0.8);
  for (let i = 0; i <= segments; i++) {
    const x = a.x + ((b.x - a.x) * i) / segments;
    const y = a.y + ((b.y - a.y) * i) / segments;
    g.fillStyle(FENCE_WOOD).fillRect(x - 2, y - FENCE_H, 4, FENCE_H + 1);
    g.fillStyle(FENCE_WOOD_LIGHT).fillRect(x - 1, y - FENCE_H, 2, 2);
  }
}
