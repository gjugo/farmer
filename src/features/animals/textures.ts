import { type PenType } from '../../data/animals';
import { registerTexture } from '../../scenes/textures';

/**
 * Where animals may walk, in grid units inside the pen. Chickens stay in the coop's run (the yard in front of
 * the hen house, which fills the back corner); cows and sheep stay inside the pasture fence, which runs through
 * the centres of its border tiles.
 */
export const WALK_AREA: Record<PenType, { x0: number; x1: number; y0: number; y1: number }> = {
  coop: { x0: 1.35, x1: 2.6, y0: 1.35, y1: 2.6 },
  pasture: { x0: 0.85, x1: 3.15, y0: 0.85, y1: 3.15 },
};

/** Speech bubble behind the hunger / product icons (the pack has none). */
registerTexture('animal-bubble', {
  width: 40,
  height: 44,
  pivot: { x: 0.475, y: 1 },
  draw: (g) => {
    g.fillStyle(0x2b2118, 0.35).fillRoundedRect(2, 4, 38, 34, 12);
    g.fillStyle(0xffffff).fillRoundedRect(0, 0, 38, 34, 12);
    g.fillTriangle(12, 32, 24, 32, 19, 43);
  },
});
