import Phaser from 'phaser';
import { listTextures } from './textures';

/** Bakes every registered runtime texture, then starts the farm. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const g = this.make.graphics({}, false);
    for (const [key, def] of listTextures()) {
      g.clear();
      def.draw(g);
      g.generateTexture(key, def.width, def.height);
      // Crisp placeholder art when zoomed in.
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    g.destroy();
    this.scene.start('Farm');
  }
}
