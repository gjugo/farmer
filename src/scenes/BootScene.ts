import Phaser from 'phaser';
import { SEASONS } from '../data/seasons';
import { ART_BASE, ART_RES, COMPOSED, GRASS, seasonalArt, seasonalComposed, SHADOW, UNOWNED, usedArt, type PackManifest } from './art';
import { listTextures } from './textures';
import { packAsset, setPack } from './sprites';

const MANIFEST = 'farm-manifest';
/** Texture holding every ground tile, so the whole ground is one Blitter (see FarmScene). */
export const GROUND_ATLAS = 'ground-atlas';
/** Ground tiles in the atlas: each season's version, a column per season. */
export const GROUND_TILES = SEASONS.map((season) => [...GRASS, ...UNOWNED].map((name) => seasonalArt(name, season)));

/** Loads the art pack with a progress bar, prepares its textures, bakes the few runtime ones, then starts the farm. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.showProgress();
    this.load.setPath(ART_BASE);
    this.load.json(MANIFEST, 'manifest.json');
    // Queue the sprites as soon as the manifest is in: it says which file, sheet size and shadow each one has.
    this.load.once(`filecomplete-json-${MANIFEST}`, (_key: string, _type: string, manifest: PackManifest) => {
      setPack(manifest);
      for (const name of usedArt()) {
        const asset = packAsset(name);
        if (!asset) continue; // the test suite checks that every used name is in the manifest
        const res = asset.res[ART_RES];
        const files = [[name, res.file], ...(res.shadow ? [[`${name}${SHADOW}`, res.shadow]] : [])];
        for (const [key, file] of files) {
          if (asset.type === 'spritesheet') this.load.spritesheet(key, file, { frameWidth: res.frameWidth!, frameHeight: res.frameHeight! });
          else this.load.image(key, file);
        }
      }
    });
  }

  create(): void {
    this.applyAnchors();
    this.createAnimations();
    this.bakeRuntimeTextures();
    for (const [key, composed] of Object.entries({ ...COMPOSED, ...seasonalComposed() })) this.compose(key, composed.h, composed.tiles);
    this.buildGroundAtlas();
    this.scene.start('Farm');
  }

  private showProgress(): void {
    const { width, height } = this.scale;
    const w = Math.min(320, width * 0.7);
    const x = (width - w) / 2;
    const y = height / 2;
    this.add.rectangle(width / 2, y, w + 6, 18, 0x2b2118).setStrokeStyle(2, 0xf3e2b8);
    const bar = this.add.rectangle(x, y, 1, 12, 0x9be070).setOrigin(0, 0.5);
    const label = this.add
      .text(width / 2, y - 22, 'Loading the farm…', { fontFamily: 'system-ui, sans-serif', fontSize: '16px', color: '#f3e2b8' })
      .setOrigin(0.5, 1);
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => {
      bar.width = Math.max(1, w * p);
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      label.setText(`Could not load ${file.key}`);
    });
  }

  /** Every frame of a pack texture (and its shadow) pivots on the manifest anchor. */
  private applyAnchors(): void {
    for (const name of usedArt()) {
      const asset = packAsset(name);
      if (!asset) continue;
      const [ox, oy] = asset.res[ART_RES].origin;
      for (const key of [name, `${name}${SHADOW}`]) {
        if (!this.textures.exists(key)) continue;
        const tex = this.textures.get(key);
        for (const frameName of tex.getFrameNames(true)) {
          const frame = tex.get(frameName);
          frame.customPivot = true;
          frame.pivotX = ox;
          frame.pivotY = oy;
        }
      }
    }
  }

  private createAnimations(): void {
    for (const name of usedArt()) {
      const asset = packAsset(name);
      if (asset?.type !== 'spritesheet' || !this.textures.exists(name)) continue;
      for (const an of asset.animations ?? []) {
        const frames = { start: an.start, end: an.end };
        this.anims.create({ key: an.key, frames: this.anims.generateFrameNumbers(name, frames), frameRate: an.fps, repeat: -1 });
        const shadow = `${name}${SHADOW}`;
        if (this.textures.exists(shadow)) {
          this.anims.create({ key: `${an.key}${SHADOW}`, frames: this.anims.generateFrameNumbers(shadow, frames), frameRate: an.fps, repeat: -1 });
        }
      }
    }
  }

  /** The few textures the pack has no art for (bubbles, sparkles, smoke, the `missing` fallback). */
  private bakeRuntimeTextures(): void {
    const g = this.make.graphics({}, false);
    for (const [key, def] of listTextures()) {
      g.clear();
      def.draw(g);
      g.generateTexture(key, def.width, def.height);
      if (def.pivot) {
        const frame = this.textures.getFrame(key);
        frame.customPivot = true;
        frame.pivotX = def.pivot.x;
        frame.pivotY = def.pivot.y;
      }
    }
    g.destroy();
  }

  /** Where a tile's anchor lands, in 2x pixels, relative to the top corner of a footprint `h` tiles deep. */
  private tileTop(x: number, y: number, h: number): { x: number; y: number } {
    const tile = packAsset(GRASS[0])!.res[ART_RES];
    const tw = tile.w! / 2;
    const th = tile.h! / 2;
    return { x: (x - y + h) * tw, y: (x + y) * th };
  }

  /** Lays pack tiles out on a footprint `h` tiles deep in one texture, pivoting on the footprint's top corner. */
  private compose(key: string, h: number, tiles: { x: number; y: number; art: string }[]): void {
    const sorted = [...tiles].sort((a, b) => a.x + a.y - (b.x + b.y));
    const placed = sorted.flatMap(({ x, y, art }) => {
      const asset = packAsset(art);
      if (!asset || !this.textures.exists(art)) return [];
      const res = asset.res[ART_RES];
      const at = this.tileTop(x, y, h);
      return [{ art, left: at.x - res.anchor[0], top: at.y - res.anchor[1], w: res.w!, h: res.h! }];
    });
    if (!placed.length) return;
    const minX = Math.floor(Math.min(...placed.map((p) => p.left)));
    const minY = Math.floor(Math.min(...placed.map((p) => p.top)));
    const maxX = Math.ceil(Math.max(...placed.map((p) => p.left + p.w)));
    const maxY = Math.ceil(Math.max(...placed.map((p) => p.top + p.h)));
    const canvas = this.textures.createCanvas(key, maxX - minX, maxY - minY)!;
    for (const p of placed) canvas.drawFrame(p.art, undefined, p.left - minX, p.top - minY, false);
    canvas.refresh();
    const top = this.tileTop(0, 0, h);
    const frame = canvas.get();
    frame.customPivot = true;
    frame.pivotX = (top.x - minX) / canvas.width;
    frame.pivotY = (top.y - minY) / canvas.height;
  }

  /** Copies the ground tiles into one texture with a frame each, for the ground Blitter (a column per season keeps it small). */
  private buildGroundAtlas(): void {
    const columns = GROUND_TILES.map((tiles) => tiles.filter((name) => this.textures.exists(name)));
    const frame = (name: string) => this.textures.getFrame(name);
    const width = Math.max(...columns.flat().map((name) => frame(name).width));
    const height = Math.max(...columns.map((tiles) => tiles.reduce((sum, name) => sum + frame(name).height + 2, 0)));
    const atlas = this.textures.createCanvas(GROUND_ATLAS, (width + 2) * columns.length, height)!;
    columns.forEach((tiles, col) => {
      let y = 0;
      for (const name of tiles) {
        const f = frame(name);
        atlas.drawFrame(name, undefined, col * (width + 2), y, false);
        atlas.add(name, 0, col * (width + 2), y, f.width, f.height);
        y += f.height + 2;
      }
    });
    atlas.refresh();
  }
}
