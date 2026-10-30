import type Phaser from 'phaser';
import { CROP_LIST } from '../../data/crops';
import type { CropStage } from '../../logic/crops';
import { diamondPoints, footprintTexture, poly, registerTexture, seeded, texPoint } from '../../scenes/textures';

/** Fields are 2×2 tiles; crop overlays cover the same diamond. */
const N = 2;
/** Crop overlays are taller than the field so plants in the back rows can stick out above it. */
export const OVERLAY_TOP = 22;
/** Plant rows and columns, in grid units inside the field. */
const ROWS = [0.3, 0.75, 1.25, 1.7];
const COLS = [0.3, 0.75, 1.25, 1.7];

type G = Phaser.GameObjects.Graphics;

registerTexture('field', {
  ...footprintTexture(N, N),
  draw: (g) => {
    const rnd = seeded(23);
    poly(g, 0x5e3d22, diamondPoints(N, N));
    poly(g, 0x7a5232, diamondPoints(N, N).map((p, i) => ({ x: p.x + [0, -3, 0, 3][i], y: p.y + [2, 0, -2, 0][i] })));
    // Furrows along the field: a dark trench with a lit ridge behind it.
    for (const gy of ROWS) {
      const a = texPoint(N, N, 0, 0.12, gy);
      const b = texPoint(N, N, 0, N - 0.12, gy);
      g.lineStyle(2, 0x93653e).lineBetween(a.x, a.y - 2, b.x, b.y - 2);
      g.lineStyle(2, 0x5a3a20).lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let i = 0; i < 24; i++) {
      const p = texPoint(N, N, 0, 0.15 + rnd() * (N - 0.3), 0.15 + rnd() * (N - 0.3));
      g.fillStyle(rnd() < 0.5 ? 0x8c6038 : 0x664326).fillRect(p.x, p.y, 2, 2);
    }
  },
});

registerTexture('crop-sparkle', {
  width: 14,
  height: 14,
  draw: (g) => {
    g.fillStyle(0xfff6b0);
    g.fillTriangle(7, 0, 9, 7, 5, 7).fillTriangle(7, 14, 9, 7, 5, 7);
    g.fillTriangle(0, 7, 7, 5, 7, 9).fillTriangle(14, 7, 7, 5, 7, 9);
    g.fillStyle(0xffffff).fillCircle(7, 7, 2);
  },
});

/** Draws one plant with its base at (x, y). */
type PlantDrawer = (g: G, x: number, y: number) => void;

const seed: PlantDrawer = (g, x, y) => {
  g.fillStyle(0x3f2814).fillEllipse(x, y, 5, 3);
  g.fillStyle(0xd9c38c).fillCircle(x - 1, y - 1, 1);
};

const sprout: PlantDrawer = (g, x, y) => {
  g.fillStyle(0x3f2814).fillEllipse(x, y + 1, 6, 3);
  g.fillStyle(0x4f9a35).fillRect(x - 0.5, y - 5, 1.5, 6);
  g.fillStyle(0x7ccf4a).fillEllipse(x - 3, y - 5, 5, 3).fillEllipse(x + 3, y - 6, 5, 3);
};

const PLANTS: Record<string, { growing: PlantDrawer; ripe: PlantDrawer }> = {
  wheat: {
    growing: (g, x, y) => {
      g.fillStyle(0x6db544);
      for (const dx of [-3, 0, 3]) g.fillTriangle(x + dx - 1, y, x + dx + 1, y, x + dx * 1.6, y - 12);
    },
    ripe: (g, x, y) => {
      for (const dx of [-3, 0, 3]) {
        g.fillStyle(0xc9a23a).fillTriangle(x + dx - 1, y, x + dx + 1, y, x + dx * 1.6, y - 11);
        g.fillStyle(0xf2cf55).fillEllipse(x + dx * 1.6, y - 13, 4, 8);
        g.fillStyle(0xfff0a0).fillRect(x + dx * 1.6 - 0.5, y - 16, 1, 3);
      }
    },
  },
  carrot: {
    growing: (g, x, y) => {
      g.fillStyle(0x3f9e3a);
      for (const dx of [-4, 0, 4]) g.fillEllipse(x + dx, y - 6, 4, 10);
    },
    ripe: (g, x, y) => {
      g.fillStyle(0x2f8c33);
      for (const dx of [-5, 0, 5]) g.fillEllipse(x + dx, y - 9, 5, 12);
      g.fillStyle(0xf07a1e).fillTriangle(x - 4, y - 3, x + 4, y - 3, x, y + 4);
      g.fillStyle(0xffa04a).fillRect(x - 3, y - 3, 6, 2);
    },
  },
  corn: {
    growing: (g, x, y) => {
      g.fillStyle(0x4f9e33).fillRect(x - 1, y - 14, 2, 14);
      g.fillStyle(0x6cc046).fillEllipse(x - 4, y - 7, 8, 3).fillEllipse(x + 4, y - 10, 8, 3);
    },
    ripe: (g, x, y) => {
      g.fillStyle(0x4a8f2e).fillRect(x - 1, y - 18, 2, 18);
      g.fillStyle(0x66b343).fillEllipse(x - 5, y - 8, 9, 3).fillEllipse(x + 5, y - 12, 9, 3);
      g.fillStyle(0xf5d23c).fillEllipse(x + 3, y - 15, 5, 10);
      g.fillStyle(0x8cc04a).fillTriangle(x + 1, y - 10, x + 6, y - 10, x + 3, y - 18);
    },
  },
};

/** Texture key of a crop overlay; null for an empty field. */
export function cropTexture(cropId: string, stage: CropStage): string | null {
  if (stage === 'empty') return null;
  if (stage === 'seeded' || stage === 'sprout') return `crop-${stage}`;
  return PLANTS[cropId] ? `crop-${cropId}-${stage}` : null;
}

function overlay(draw: PlantDrawer) {
  return (g: G) => {
    // Back to front, so nearer plants overlap the ones behind them.
    const spots = ROWS.flatMap((gy) => COLS.map((gx) => ({ gx, gy }))).sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
    for (const { gx, gy } of spots) {
      const p = texPoint(N, N, OVERLAY_TOP, gx, gy);
      draw(g, p.x, p.y);
    }
  };
}

const OVERLAY = footprintTexture(N, N, OVERLAY_TOP);

registerTexture('crop-seeded', { ...OVERLAY, draw: overlay(seed) });
registerTexture('crop-sprout', { ...OVERLAY, draw: overlay(sprout) });
for (const crop of CROP_LIST) {
  const plants = PLANTS[crop.id];
  if (!plants) continue;
  registerTexture(`crop-${crop.id}-growing`, { ...OVERLAY, draw: overlay(plants.growing) });
  registerTexture(`crop-${crop.id}-ripe`, { ...OVERLAY, draw: overlay(plants.ripe) });
}
