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
