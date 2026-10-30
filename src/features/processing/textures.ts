import type Phaser from 'phaser';
import { PROCESSORS, type ProcessorType } from '../../data/processing';
import { footprintLocal } from '../../scenes/iso';
import { footprintTexture, isoBox, poly, registerTexture, seeded, texPoint } from '../../scenes/textures';

/** Wall height and roof rise of every processing building, in pixels. */
const WALL = 30;
const ROOF = 22;
const CHIMNEY = 16;
/** Room each texture leaves above its footprint's diamond (also where the ready bubble floats). */
export const PROC_TOP = WALL + ROOF + 6;
/** The building stands slightly inside its footprint. */
const INSET = 0.12;

/** Where the working animation sits, in pixels relative to the view (the footprint's box). */
export const ANIM_ANCHOR = Object.fromEntries(
  (Object.keys(PROCESSORS) as ProcessorType[]).map((type) => {
    const { w, h } = PROCESSORS[type].footprint;
    if (PROCESSORS[type].anim === 'smoke') {
      // Top of the chimney on the back slope of the roof.
      const p = footprintLocal(w, h, w * 0.7, h * 0.3);
      return [type, { x: p.x, y: p.y - WALL - ROOF * 0.6 - CHIMNEY }];
    }
    // The wheel turns on the front-left wall.
    const p = footprintLocal(w, h, w * 0.3, h - INSET);
    return [type, { x: p.x, y: p.y - WALL * 0.6 }];
  }),
) as Record<ProcessorType, { x: number; y: number }>;

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

const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** A simple isometric house: wall box, gable roof along x, door and windows on the front walls. */
function house(g: Phaser.GameObjects.Graphics, type: ProcessorType): void {
  const { w, h } = PROCESSORS[type].footprint;
  const look = LOOKS[type];
  const top = PROC_TOP;
  const rnd = seeded(w * 31 + h * 7 + type.length);
  const p = (gx: number, gy: number) => texPoint(w, h, top, gx, gy);

  // Shadow, then walls.
  poly(g, 0x000000, [p(0, 0), p(w, 0), p(w, h), p(0, h)], 0.15);
  const roof = isoBox(g, w, h, top, { gx0: INSET, gy0: INSET, gx1: w - INSET, gy1: h - INSET }, WALL, {
    left: look.wall,
    right: look.wallDark,
    top: look.wallDark,
  });
  for (let i = 0; i < 12; i++) {
    const q = p(INSET + rnd() * (w - 2 * INSET), h - INSET);
    g.fillStyle(look.wallDark).fillRect(q.x, q.y - 4 - rnd() * (WALL - 8), 3, 1);
  }

  // Gable roof: the ridge runs along x, halfway across y.
  const lift = (q: { x: number; y: number }) => ({ x: q.x, y: q.y - ROOF });
  const ridgeBack = lift(mid(roof.top, roof.left));
  const ridgeFront = lift(mid(roof.right, roof.bottom));
  poly(g, look.wall, [roof.top, roof.left, ridgeBack]);
  poly(g, look.roofDark, [roof.top, roof.right, ridgeFront, ridgeBack]);
  poly(g, look.wallDark, [roof.right, roof.bottom, ridgeFront]);
  poly(g, look.roof, [roof.left, roof.bottom, ridgeFront, ridgeBack]);
  g.lineStyle(2, look.roofDark).lineBetween(ridgeBack.x, ridgeBack.y, ridgeFront.x, ridgeFront.y);

  // Door and windows on the front-left wall, a window on the front-right one.
  const door = p(w * 0.55, h - INSET);
  g.fillStyle(look.door).fillRect(door.x - 6, door.y - 19, 12, 17);
  g.fillStyle(0x000000, 0.25).fillRect(door.x - 6, door.y - 19, 12, 2);
  g.fillStyle(0xf4d27a).fillCircle(door.x + 3, door.y - 9, 1);
  const windows = [p(w * 0.2, h - INSET), p(w - INSET, h * 0.5)];
  if (w >= 3) windows.push(p(w * 0.85, h - INSET));
  for (const q of windows) {
    g.fillStyle(0x6a4a2a).fillRect(q.x - 6, q.y - 22, 12, 10);
    g.fillStyle(0xa8d8f0).fillRect(q.x - 5, q.y - 21, 10, 8);
    g.fillStyle(0x6a4a2a).fillRect(q.x - 1, q.y - 21, 2, 8);
  }

  // Chimney for buildings that smoke (ANIM_ANCHOR is its top, in view pixels).
  if (PROCESSORS[type].anim === 'smoke') {
    const a = ANIM_ANCHOR[type];
    const y = a.y + top;
    g.fillStyle(0x7a6a62).fillRect(a.x - 5, y + 2, 10, CHIMNEY + 4);
    g.fillStyle(0x5a4c46).fillRect(a.x - 6, y, 12, 4);
  }
  // Hub for buildings with a wheel.
  if (PROCESSORS[type].anim === 'wheel') {
    const a = ANIM_ANCHOR[type];
    g.fillStyle(0x5a3a1e).fillRect(a.x - 2, a.y + top, 4, WALL * 0.6 - 2);
  }
}

for (const type of Object.keys(PROCESSORS) as ProcessorType[]) {
  const { w, h } = PROCESSORS[type].footprint;
  registerTexture(type, { ...footprintTexture(w, h, PROC_TOP), draw: (g) => house(g, type) });
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
