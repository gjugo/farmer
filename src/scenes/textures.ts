import type Phaser from 'phaser';

export const TILE = 32;

export interface TextureDef {
  width: number;
  height: number;
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

/** Deterministic pseudo-random numbers so textures look the same every load. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Core textures ---------------------------------------------------------------

function grass(seed: number, base: number, light: number, dark: number) {
  return (g: Phaser.GameObjects.Graphics) => {
    const rnd = seeded(seed);
    g.fillStyle(base).fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(rnd() * (TILE - 3));
      const y = Math.floor(rnd() * (TILE - 4));
      g.fillStyle(rnd() < 0.5 ? light : dark);
      g.fillRect(x, y + 1, 1, 3).fillRect(x + 2, y, 1, 4);
    }
  };
}

for (let i = 0; i < 3; i++) {
  registerTexture(`grass-${i}`, { width: TILE, height: TILE, draw: grass(11 + i * 7, 0x7ccf5a, 0x9be070, 0x5fae45) });
  registerTexture(`locked-${i}`, {
    width: TILE,
    height: TILE,
    draw: (g) => {
      grass(31 + i * 5, 0x55744a, 0x627f55, 0x46623d)(g);
      // Faint hatching marks the land as not yours (yet).
      g.lineStyle(1, 0x3a5233, 0.45);
      for (let d = -TILE; d < TILE; d += 8) g.lineBetween(d, TILE, d + TILE, 0);
    },
  });
}

registerTexture('path', {
  width: TILE,
  height: TILE,
  draw: (g) => {
    const rnd = seeded(5);
    g.fillStyle(0xd8b67a).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0xc9a465).fillRect(0, 0, TILE, 2).fillRect(0, TILE - 2, TILE, 2);
    for (let i = 0; i < 10; i++) {
      g.fillStyle(rnd() < 0.5 ? 0xb8925a : 0xe8cc96);
      g.fillCircle(3 + rnd() * (TILE - 6), 4 + rnd() * (TILE - 8), 1 + rnd() * 1.5);
    }
  },
});

/** Fallback for objects whose buildable is no longer registered. */
registerTexture('missing', {
  width: TILE,
  height: TILE,
  draw: (g) => {
    g.fillStyle(0xd04f8a).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x30202a).fillRect(0, 0, TILE / 2, TILE / 2).fillRect(TILE / 2, TILE / 2, TILE / 2, TILE / 2);
  },
});
