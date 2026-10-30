import type Phaser from 'phaser';
import { ART_SCALE, artFor, COMPOSED, SHADOW, type PackAsset, type PackManifest } from './art';
import { ISO_W } from './iso';

/**
 * Drawing pack sprites: every pack texture's frames carry the manifest anchor as their pivot (set by the Boot
 * scene), so an image placed at a point stands on it the way the pack intends. Sprites are 2x art drawn at
 * ART_SCALE.
 */

const pack = new Map<string, PackAsset>();

export function setPack(manifest: PackManifest): void {
  pack.clear();
  for (const asset of manifest.assets) pack.set(asset.name, asset);
}

export function packAsset(name: string): PackAsset | undefined {
  return pack.get(name);
}

/** The footprint (in tiles) a texture was drawn for. */
export function artFootprint(key: string): { w: number; h: number } {
  const name = artFor(key);
  const composed = COMPOSED[name];
  if (composed) return { w: composed.w, h: composed.h };
  const fp = pack.get(name)?.footprint;
  return fp && fp[0] > 0 && fp[1] > 0 ? { w: fp[0], h: fp[1] } : { w: 1, h: 1 };
}

/** The Phaser texture behind a game texture key, or `missing` when it was never loaded. */
export function textureKey(scene: Phaser.Scene, key: string): string {
  const name = artFor(key);
  return scene.textures.exists(name) ? name : 'missing';
}

/** A pack sprite standing at (x, y) (its anchor there), at world scale. */
export function addArt(scene: Phaser.Scene, x: number, y: number, key: string): Phaser.GameObjects.Image {
  return scene.add.image(x, y, textureKey(scene, key)).setScale(ART_SCALE);
}

/** An animated pack sprite (animals, mill sails) at (x, y). */
export function addArtSprite(scene: Phaser.Scene, x: number, y: number, key: string): Phaser.GameObjects.Sprite {
  return scene.add.sprite(x, y, textureKey(scene, key)).setScale(ART_SCALE);
}

/** The shadow layer of a pack sprite at (x, y), or null when it has none. */
export function addShadow(scene: Phaser.Scene, x: number, y: number, key: string): Phaser.GameObjects.Image | null {
  const name = `${artFor(key)}${SHADOW}`;
  return scene.textures.exists(name) ? scene.add.image(x, y, name).setScale(ART_SCALE) : null;
}

/**
 * Scale for drawing `key` on a w × h footprint. Pack sprites match the game's footprints, so this is
 * ART_SCALE; the `missing` fallback (one tile) and any sprite drawn for another footprint are stretched
 * across the footprint's width instead.
 */
export function fitScale(scene: Phaser.Scene, key: string, fp: { w: number; h: number }): number {
  if (textureKey(scene, key) === 'missing') return ((fp.w + fp.h) * ISO_W) / 2 / scene.textures.getFrame('missing').width;
  const art = artFootprint(key);
  return art.w === fp.w && art.h === fp.h ? ART_SCALE : (ART_SCALE * (fp.w + fp.h)) / (art.w + art.h);
}
