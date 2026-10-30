import type Phaser from 'phaser';
import { PENS, type PenType } from '../../data/animals';
import {
  diamondPoints,
  FENCE_H,
  fenceLine,
  footprintTexture,
  isoBox,
  poly,
  registerTexture,
  seeded,
  texPoint,
} from '../../scenes/textures';

type G = Phaser.GameObjects.Graphics;

/**
 * Pens are drawn in two layers so animals walk between them: the base (ground, back fences and
 * anything at the back) and `<type>-front` (the two front fences), drawn over the animals.
 */
export const PEN_TOP: Record<PenType, number> = { coop: 56, pasture: FENCE_H + 4 };

/** Where animals may walk, in grid units inside the pen; `minSum` keeps them in front of the hen house / trough. */
export const WALK_AREA: Record<PenType, { min: number; max: number; minSum: number }> = {
  coop: { min: 0.4, max: PENS.coop.footprint.w - 0.4, minSum: 2.7 },
  pasture: { min: 0.4, max: PENS.pasture.footprint.w - 0.4, minSum: 2 },
};

/** Back fences: along the top-left (x = 0) and top-right (y = 0) edges. */
function backFence(g: G, w: number, h: number, top: number): void {
  const p = (gx: number, gy: number) => texPoint(w, h, top, gx, gy);
  fenceLine(g, p(0.08, h - 0.08), p(0.08, 0.08), h);
  fenceLine(g, p(0.08, 0.08), p(w - 0.08, 0.08), w);
}

/** Front fences: along the bottom-left (y = h) and bottom-right (x = w) edges. */
function frontFence(g: G, w: number, h: number, top: number): void {
  const p = (gx: number, gy: number) => texPoint(w, h, top, gx, gy);
  fenceLine(g, p(0.08, h - 0.08), p(w - 0.08, h - 0.08), w);
  fenceLine(g, p(w - 0.08, h - 0.08), p(w - 0.08, 0.08), h);
}

function speckle(g: G, seed: number, w: number, h: number, top: number, colors: number[], n: number): void {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const p = texPoint(w, h, top, 0.1 + rnd() * (w - 0.2), 0.1 + rnd() * (h - 0.2));
    g.fillStyle(colors[Math.floor(rnd() * colors.length)]);
    g.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 2 + Math.floor(rnd() * 2));
  }
}

function registerPen(type: PenType, drawBase: (g: G, w: number, h: number, top: number) => void): void {
  const { w, h } = PENS[type].footprint;
  const top = PEN_TOP[type];
  const size = footprintTexture(w, h, top);
  registerTexture(type, { ...size, draw: (g) => drawBase(g, w, h, top) });
  registerTexture(`${type}-front`, { ...size, draw: (g) => frontFence(g, w, h, top) });
}

registerPen('coop', (g, w, h, top) => {
  // Packed-earth yard.
  poly(g, 0xcfae78, diamondPoints(w, h, top));
  speckle(g, 21, w, h, top, [0xb8935c, 0xe2c792, 0xa98552], 90);
  backFence(g, w, h, top);
  // Hen house in the back corner: a box with a red roof and a door facing the yard.
  const roof = isoBox(g, w, h, top, { gx0: 0.15, gy0: 0.15, gx1: 1.25, gy1: 1.25 }, 26, {
    left: 0xc0503a,
    right: 0x9c4a33,
    top: 0xc0503a,
  });
  const peak = { x: (roof.left.x + roof.right.x) / 2, y: (roof.top.y + roof.bottom.y) / 2 - 16 };
  poly(g, 0x7a3b2a, [roof.top, roof.right, peak]);
  poly(g, 0x7a3b2a, [roof.left, roof.top, peak]);
  poly(g, 0xa8422f, [roof.left, roof.bottom, peak]);
  poly(g, 0x8a3626, [roof.bottom, roof.right, peak]);
  const door = texPoint(w, h, top, 0.7, 1.25);
  g.fillStyle(0x3a2318).fillRect(door.x - 4, door.y - 13, 8, 12);
  g.fillStyle(0xd9b56a).fillRect(door.x - 5, door.y - 1, 10, 3); // ramp
});

registerPen('pasture', (g, w, h, top) => {
  poly(g, 0x6fbf4d, diamondPoints(w, h, top));
  speckle(g, 37, w, h, top, [0x86d460, 0x5aa83f, 0x93dc6c], 200);
  // A few flowers.
  const rnd = seeded(41);
  for (let i = 0; i < 10; i++) {
    const p = texPoint(w, h, top, 0.3 + rnd() * (w - 0.6), 0.3 + rnd() * (h - 0.6));
    g.fillStyle(rnd() < 0.5 ? 0xfff3a0 : 0xffffff).fillCircle(p.x, p.y, 1.5);
  }
  backFence(g, w, h, top);
  // Water trough in the back corner.
  isoBox(g, w, h, top, { gx0: 0.35, gy0: 0.25, gx1: 1.3, gy1: 0.6 }, 6, { left: 0x8a5a2e, right: 0x6c4422, top: 0x5ab4e6 });
});

registerTexture('animal-chicken', {
  width: 14,
  height: 14,
  draw: (g) => {
    g.fillStyle(0xe8962e).fillRect(5, 11, 1, 3).fillRect(8, 11, 1, 3);
    g.fillStyle(0xf7f4ec).fillEllipse(6, 8, 10, 7);
    g.fillStyle(0xe6e0d0).fillEllipse(4, 8, 5, 4); // wing
    g.fillStyle(0xf7f4ec).fillCircle(10, 4, 3);
    g.fillStyle(0xd83a2e).fillRect(9, 0, 3, 2);
    g.fillStyle(0xf0a028).fillTriangle(12, 4, 14, 5, 12, 6);
    g.fillStyle(0x222222).fillRect(10, 3, 1, 1);
  },
});

registerTexture('animal-cow', {
  width: 26,
  height: 20,
  draw: (g) => {
    g.fillStyle(0x4a3a30).fillRect(4, 14, 2, 6).fillRect(8, 14, 2, 6).fillRect(15, 14, 2, 6).fillRect(19, 14, 2, 6);
    g.fillStyle(0xf8f6f0).fillRoundedRect(2, 6, 20, 10, 4);
    g.fillStyle(0x2c2622).fillEllipse(8, 9, 6, 4).fillEllipse(15, 13, 5, 3).fillCircle(5, 13, 1.5);
    g.fillStyle(0xf2b8c0).fillEllipse(12, 16, 4, 2); // udder
    g.fillStyle(0xf8f6f0).fillRoundedRect(19, 2, 7, 8, 2);
    g.fillStyle(0xf2b8c0).fillRect(21, 8, 5, 3);
    g.fillStyle(0x2c2622).fillRect(23, 4, 1, 1);
    g.fillStyle(0xe4dcc4).fillRect(19, 0, 2, 3).fillRect(24, 0, 2, 3); // horns
    g.fillStyle(0x2c2622).fillRect(1, 7, 2, 5); // tail
  },
});

registerTexture('animal-sheep', {
  width: 22,
  height: 18,
  draw: (g) => {
    g.fillStyle(0x2f2a28).fillRect(5, 12, 2, 6).fillRect(14, 12, 2, 6);
    g.fillStyle(0xf4f1ea);
    for (const [x, y] of [[5, 7], [9, 5], [13, 6], [16, 9], [11, 10], [6, 11], [3, 9]] as const) g.fillCircle(x, y, 4);
    g.fillStyle(0xe2ddd2).fillCircle(9, 9, 3);
    g.fillStyle(0x2f2a28).fillEllipse(18, 6, 6, 7);
    g.fillStyle(0x2f2a28).fillRect(15, 3, 2, 2);
    g.fillStyle(0xffffff).fillRect(19, 5, 1, 1);
  },
});

/** Speech bubble behind the hunger / product icons. */
registerTexture('animal-bubble', {
  width: 20,
  height: 22,
  draw: (g) => {
    g.fillStyle(0x2b2118, 0.35).fillRoundedRect(1, 2, 19, 17, 6);
    g.fillStyle(0xffffff).fillRoundedRect(0, 0, 19, 17, 6);
    g.fillTriangle(6, 16, 12, 16, 9, 21);
  },
});
