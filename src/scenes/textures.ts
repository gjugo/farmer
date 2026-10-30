import type Phaser from 'phaser';

/**
 * Runtime-drawn textures, only for what the art pack has no sprite for (speech bubbles, sparkles, smoke and
 * the `missing` fallback). Everything else comes from `public/assets/farm/` (see `art.ts`).
 */
export interface TextureDef {
  width: number;
  height: number;
  /** Optional anchor, as a fraction of the size (like a pack sprite's origin). */
  pivot?: { x: number; y: number };
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

/** Size of the `missing` diamond: one tile at the pack's 2x resolution, anchored on its top corner like a tile. */
const MISSING = { width: 256, height: 128 };

/** Fallback for objects whose buildable or art is no longer there: a magenta and black checked diamond. */
registerTexture('missing', {
  ...MISSING,
  pivot: { x: 0.5, y: 0 },
  draw: (g) => {
    const at = (gx: number, gy: number) => ({ x: ((gx - gy + 1) * MISSING.width) / 2, y: ((gx + gy) * MISSING.height) / 2 });
    const quad = (color: number, x0: number, y0: number, x1: number, y1: number) => {
      const points = [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
      g.fillStyle(color).fillPoints(points as unknown as Phaser.Math.Vector2[], true);
    };
    quad(0xd04f8a, 0, 0, 1, 1);
    quad(0x30202a, 0, 0, 0.5, 0.5);
    quad(0x30202a, 0.5, 0.5, 1, 1);
  },
});
