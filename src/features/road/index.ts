import Phaser from 'phaser';
import { onGameStart, registerDebugInfo } from '../../game/hooks';
import { merchantsAt, roadInfo, roadOf } from '../../logic/mainroad';
import type { Inventory } from '../../logic/types';
import { addCart, destroyCart, drawCart, type CartSprites } from '../haul';

/**
 * The main road (`src/logic/mainroad.ts`) on the map: its tiles are drawn with the ground (`FarmScene`), its grass
 * fringes by `src/features/fringes`. This draws the merchants' oxcarts travelling it from edge to edge now and then:
 * scenery only, timed from the game clock (nothing saved), never more than two at once. `window.farm.road` for QA.
 */

/** What a merchant's cart carries, by its slot: sacks of goods, logs or stone. */
const LOADS: Inventory[] = [{ wheat: 12 }, { wood: 12 }, { stone: 6 }, { wheat: 4 }];

onGameStart((ctx) => {
  const { game, scene } = ctx;
  registerDebugInfo('road', () => roadInfo(game.state, game.now));
  const carts = new Map<number, CartSprites>();
  const onUpdate = () => {
    const seen = new Set<number>();
    for (const m of merchantsAt(roadOf(game.state), game.now)) {
      seen.add(m.id);
      let c = carts.get(m.id);
      if (!c) carts.set(m.id, (c = addCart(scene)));
      drawCart(scene, c, { leg: 'drive', at: { x: m.x, y: m.y }, dir: { x: m.dx, y: m.dy }, t: m.progress }, LOADS[m.id % LOADS.length]);
    }
    for (const [id, c] of carts) {
      if (seen.has(id)) continue;
      destroyCart(c);
      carts.delete(id);
    }
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    carts.forEach(destroyCart);
    carts.clear();
  });
});
