import type Phaser from 'phaser';
import { registerTexture } from '../../scenes/textures';

/** Sparkles over ripe crops (the pack has none). */
registerTexture('crop-sparkle', {
  width: 28,
  height: 28,
  draw: (g) => {
    g.fillStyle(0xfff6b0);
    g.fillTriangle(14, 0, 18, 14, 10, 14).fillTriangle(14, 28, 18, 14, 10, 14);
    g.fillTriangle(0, 14, 14, 10, 14, 18).fillTriangle(28, 14, 14, 10, 14, 18);
    g.fillStyle(0xffffff).fillCircle(14, 14, 4);
  },
});

/** Cracked, dry earth over a 2×2 field in a drought (when no well reaches it), anchored on the field's top corner. */
registerTexture('field-cracks', {
  width: 256,
  height: 128,
  pivot: { x: 0.5, y: 0 },
  draw: (g) => {
    const at = (gx: number, gy: number) => ({ x: (gx - gy + 2) * 64, y: (gx + gy) * 32 });
    const diamond = [at(0, 0), at(2, 0), at(2, 2), at(0, 2)];
    g.fillStyle(0xd9b36c, 0.42).fillPoints(diamond as unknown as Phaser.Math.Vector2[], true);
    // A few branching cracks, in grid units, so they lie flat on the field.
    const cracks: [number, number][][] = [
      [[0.2, 0.5], [0.6, 0.55], [0.8, 0.9], [1.25, 0.95]],
      [[0.6, 0.55], [0.7, 0.2]],
      [[1.1, 0.3], [1.3, 0.6], [1.75, 0.55]],
      [[0.3, 1.3], [0.7, 1.4], [0.95, 1.8]],
      [[0.7, 1.4], [1.2, 1.3], [1.5, 1.6], [1.8, 1.5]],
      [[1.25, 0.95], [1.4, 1.3]],
    ];
    g.lineStyle(2.5, 0x6b4a22, 0.75);
    for (const c of cracks) g.strokePoints(c.map(([x, y]) => at(x, y)) as unknown as Phaser.Math.Vector2[], false);
  },
});
