import type Phaser from 'phaser';
import { PENS } from '../../data/animals';
import { registerTexture, seeded, TILE } from '../../scenes/textures';

const WOOD = 0x8a5a2e;
const WOOD_LIGHT = 0xb07b45;

/** A post-and-rail fence around the edge of a w×h rectangle. */
function fence(g: Phaser.GameObjects.Graphics, w: number, h: number, inset: number): void {
  const a = inset;
  const bx = w - inset;
  const by = h - inset;
  g.fillStyle(WOOD);
  for (const off of [-2, 2]) {
    g.fillRect(a, a + off, bx - a, 2).fillRect(a, by + off - 1, bx - a, 2);
    g.fillRect(a + off, a, 2, by - a).fillRect(bx + off - 1, a, 2, by - a);
  }
  const posts: [number, number][] = [];
  for (let x = a; x <= bx; x += 16) posts.push([x, a], [x, by]);
  for (let y = a + 16; y < by; y += 16) posts.push([a, y], [bx, y]);
  for (const [x, y] of posts) {
    g.fillStyle(WOOD).fillRect(x - 2, y - 4, 5, 8);
    g.fillStyle(WOOD_LIGHT).fillRect(x - 1, y - 3, 3, 2);
  }
}

function speckle(g: Phaser.GameObjects.Graphics, seed: number, w: number, h: number, colors: number[], n: number): void {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle(colors[Math.floor(rnd() * colors.length)]);
    g.fillRect(Math.floor(rnd() * (w - 2)), Math.floor(rnd() * (h - 3)), 1, 2 + Math.floor(rnd() * 2));
  }
}

const COOP_W = PENS.coop.footprint.w * TILE;
const COOP_H = PENS.coop.footprint.h * TILE;

registerTexture('coop', {
  width: COOP_W,
  height: COOP_H,
  draw: (g) => {
    // Packed-earth yard.
    g.fillStyle(0xcfae78).fillRect(0, 0, COOP_W, COOP_H);
    speckle(g, 21, COOP_W, COOP_H, [0xb8935c, 0xe2c792, 0xa98552], 70);
    // Hen house along the top.
    const hx = 18;
    const hw = COOP_W - 36;
    g.fillStyle(0x7a3b2a).fillTriangle(hx - 6, 18, hx + hw / 2, 2, hx + hw + 6, 18);
    g.fillStyle(0x9c4a33).fillTriangle(hx - 2, 17, hx + hw / 2, 5, hx + hw + 2, 17);
    g.fillStyle(0xc0503a).fillRect(hx, 17, hw, 22);
    g.fillStyle(0xa8422f);
    for (let y = 21; y < 39; y += 5) g.fillRect(hx, y, hw, 1);
    g.fillStyle(0x3a2318).fillRoundedRect(hx + hw / 2 - 6, 25, 12, 14, { tl: 6, tr: 6, bl: 0, br: 0 });
    g.fillStyle(0xd9b56a).fillRect(hx + hw / 2 - 9, 38, 18, 3); // ramp
    g.fillStyle(0xf3e3b0).fillRect(hx + 6, 22, 8, 6).fillRect(hx + hw - 14, 22, 8, 6);
    // Feed trough.
    g.fillStyle(WOOD).fillRect(COOP_W - 26, COOP_H - 16, 16, 6);
    g.fillStyle(0xe8c25a).fillRect(COOP_W - 25, COOP_H - 16, 14, 2);
    fence(g, COOP_W, COOP_H, 3);
  },
});

const PASTURE_W = PENS.pasture.footprint.w * TILE;
const PASTURE_H = PENS.pasture.footprint.h * TILE;

registerTexture('pasture', {
  width: PASTURE_W,
  height: PASTURE_H,
  draw: (g) => {
    g.fillStyle(0x6fbf4d).fillRect(0, 0, PASTURE_W, PASTURE_H);
    speckle(g, 37, PASTURE_W, PASTURE_H, [0x86d460, 0x5aa83f, 0x93dc6c], 160);
    // A few flowers.
    const rnd = seeded(41);
    for (let i = 0; i < 8; i++) {
      g.fillStyle(rnd() < 0.5 ? 0xfff3a0 : 0xffffff).fillCircle(10 + rnd() * (PASTURE_W - 20), 10 + rnd() * (PASTURE_H - 20), 1.5);
    }
    // Water trough.
    g.fillStyle(WOOD).fillRect(PASTURE_W - 34, 10, 24, 9);
    g.fillStyle(0x5ab4e6).fillRect(PASTURE_W - 32, 12, 20, 4);
    fence(g, PASTURE_W, PASTURE_H, 3);
  },
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
