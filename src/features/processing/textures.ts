import type { ProcessorType } from '../../data/processing';
import { registerTexture } from '../../scenes/textures';

/**
 * Where smoke rises while a building works, in pixels of its 2x pack sprite: the bakery's oven chimney, the
 * dairy's chimney and the weaving hut's stovepipe (the Ludo.ai hut, `tools/ludo/source/weaving_hut_raw.png`), and the
 * chimneys of the malthouse (beside its kiln vent), brewery and tailor. The feed mill turns its sails instead.
 */
export const SMOKE_AT: Partial<Record<ProcessorType, { x: number; y: number }>> = {
  bakery: { x: 412, y: 73 },
  dairy: { x: 343, y: 51 },
  loom: { x: 128, y: 8 },
  malthouse: { x: 308, y: 18 },
  brewery: { x: 423, y: 72 },
  tailor: { x: 320, y: 20 },
};

/** Smoke puff (the pack has none). */
registerTexture('proc-smoke', {
  width: 24,
  height: 24,
  draw: (g) => {
    g.fillStyle(0xe6e6e6).fillCircle(12, 12, 12);
    g.fillStyle(0xffffff).fillCircle(8, 8, 6);
  },
});

export const BUBBLE = { width: 104, height: 52 } as const;

/** Speech bubble behind the ready-output icons; anchored on its tip. */
registerTexture('proc-bubble', {
  width: BUBBLE.width,
  height: BUBBLE.height,
  pivot: { x: (BUBBLE.width - 4) / 2 / BUBBLE.width, y: 1 },
  draw: (g) => {
    const w = BUBBLE.width - 4;
    const h = BUBBLE.height - 12;
    g.fillStyle(0x2b2118, 0.35).fillRoundedRect(2, 4, w, h, 14);
    g.fillStyle(0xd6ffc4).fillRoundedRect(0, 0, w, h, 14);
    g.fillTriangle(w / 2 - 8, h - 1, w / 2 + 8, h - 1, w / 2, BUBBLE.height - 1);
    g.lineStyle(2, 0x4a7a3a).strokeRoundedRect(1, 1, w - 2, h - 2, 14);
  },
});
