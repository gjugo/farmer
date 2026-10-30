import type Phaser from 'phaser';
import { PROCESSORS, type ProcessorType } from '../../data/processing';
import { registerTexture, seeded, TILE } from '../../scenes/textures';

/** Where the working animation sits, in pixels inside the footprint. */
export const ANIM_ANCHOR: Record<ProcessorType, { x: number; y: number }> = {
  'feed-mill': { x: 46, y: 22 },
  dairy: { x: 74, y: 6 },
  bakery: { x: 20, y: 6 },
  loom: { x: 46, y: 30 },
};

interface Look {
  wall: number;
  wallDark: number;
  roof: number;
  roofDark: number;
  door: number;
}

const LOOKS: Record<ProcessorType, Look> = {
  'feed-mill': { wall: 0xc9b89a, wallDark: 0xa8977a, roof: 0x8a5a2e, roofDark: 0x6c4422, door: 0x5a3a1e },
  dairy: { wall: 0xf2efe6, wallDark: 0xd2cdbf, roof: 0x4f7fb8, roofDark: 0x3c6496, door: 0x6e8fb3 },
  bakery: { wall: 0xc8664a, wallDark: 0xa44f38, roof: 0x6b4a3a, roofDark: 0x4f362a, door: 0x7a4b2a },
  loom: { wall: 0xd9b98a, wallDark: 0xb8986a, roof: 0x9b4f8e, roofDark: 0x7b3b70, door: 0x6a4a2a },
};

/** A simple house: wall block, sloped roof, door and windows. */
function house(g: Phaser.GameObjects.Graphics, type: ProcessorType): void {
  const { w, h } = PROCESSORS[type].footprint;
  const W = w * TILE;
  const H = h * TILE;
  const look = LOOKS[type];
  const rnd = seeded(w * 31 + h * 7 + type.length);
  const roofH = Math.round(H * 0.42);
  const wallTop = roofH - 4;

  // Shadow and walls.
  g.fillStyle(0x000000, 0.18).fillRect(4, H - 5, W - 6, 4);
  g.fillStyle(look.wall).fillRect(3, wallTop, W - 6, H - wallTop - 4);
  g.fillStyle(look.wallDark).fillRect(3, H - 8, W - 6, 4);
  for (let i = 0; i < 14; i++) g.fillRect(4 + rnd() * (W - 12), wallTop + 4 + rnd() * (H - wallTop - 14), 3, 1);

  // Roof.
  g.fillStyle(look.roofDark).fillTriangle(0, roofH, W / 2, 2, W, roofH);
  g.fillStyle(look.roof).fillTriangle(4, roofH - 2, W / 2, 6, W - 4, roofH - 2);
  g.fillStyle(look.roofDark).fillRect(0, roofH - 2, W, 3);

  // Door and windows.
  const doorW = 12;
  g.fillStyle(look.door).fillRect(W / 2 - doorW / 2, H - 22, doorW, 18);
  g.fillStyle(0x000000, 0.25).fillRect(W / 2 - doorW / 2, H - 22, doorW, 2);
  g.fillStyle(0xf4d27a).fillCircle(W / 2 + 3, H - 12, 1);
  for (const wx of [10, W - 22]) {
    g.fillStyle(0x6a4a2a).fillRect(wx - 1, H - 25, 14, 11);
    g.fillStyle(0xa8d8f0).fillRect(wx, H - 24, 12, 9);
    g.fillStyle(0x6a4a2a).fillRect(wx + 5, H - 24, 2, 9);
  }

  // Chimney for buildings that smoke.
  if (PROCESSORS[type].anim === 'smoke') {
    const a = ANIM_ANCHOR[type];
    g.fillStyle(0x7a6a62).fillRect(a.x - 5, a.y + 4, 10, roofH - a.y - 6);
    g.fillStyle(0x5a4c46).fillRect(a.x - 6, a.y + 2, 12, 4);
  }
  // Hub for buildings with a wheel.
  if (PROCESSORS[type].anim === 'wheel') {
    const a = ANIM_ANCHOR[type];
    g.fillStyle(0x5a3a1e).fillRect(a.x - 2, a.y, 4, H - a.y - 10);
  }
}

for (const type of Object.keys(PROCESSORS) as ProcessorType[]) {
  const { w, h } = PROCESSORS[type].footprint;
  registerTexture(type, { width: w * TILE, height: h * TILE, draw: (g) => house(g, type) });
}

/** Four-spoke wheel (mill sails / spinning wheel), rotated around its centre while working. */
registerTexture('proc-wheel', {
  width: 28,
  height: 28,
  draw: (g) => {
    g.lineStyle(2, 0x5a3a1e).strokeCircle(14, 14, 12);
    g.fillStyle(0xe8d6b0);
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      g.fillRect(14 + dx * 7 - 2.5, 14 + dy * 7 - 2.5, 5, 5);
      g.lineStyle(2, 0x5a3a1e).lineBetween(14, 14, 14 + dx * 12, 14 + dy * 12);
    }
    g.fillStyle(0x3a2412).fillCircle(14, 14, 3);
  },
});

registerTexture('proc-smoke', {
  width: 12,
  height: 12,
  draw: (g) => {
    g.fillStyle(0xe6e6e6).fillCircle(6, 6, 6);
    g.fillStyle(0xffffff).fillCircle(4, 4, 3);
  },
});

/** Speech bubble behind the ready-output icon. */
registerTexture('proc-bubble', {
  width: 34,
  height: 26,
  draw: (g) => {
    g.fillStyle(0x2b2118, 0.35).fillRoundedRect(1, 2, 32, 20, 8);
    g.fillStyle(0xd6ffc4).fillRoundedRect(0, 0, 32, 20, 8);
    g.fillTriangle(12, 19, 20, 19, 16, 25);
    g.lineStyle(1, 0x4a7a3a).strokeRoundedRect(0.5, 0.5, 31, 19, 8);
  },
});
