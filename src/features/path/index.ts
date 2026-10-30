import type { FarmContext, ObjectView } from '../../game/context';
import { registerBehavior } from '../../game/hooks';
import { neighbourMask, pathPiece } from '../../scenes/art';
import { textureKey } from '../../scenes/sprites';

/**
 * Reference feature: the Path buildable (registered in `src/data/buildables.ts`) with an action panel.
 * Copy this folder to start a new feature. Paths autotile: each one shows the pack piece that joins the
 * paths next to it, and its neighbours update when one is built or demolished.
 */

const paths = new Map<string, ObjectView>();
const at = (x: number, y: number) => `${x},${y}`;

function paint(ctx: FarmContext, x: number, y: number): void {
  const view = paths.get(at(x, y));
  if (!view) return;
  const piece = pathPiece(neighbourMask((nx, ny) => paths.has(at(nx, ny)), x, y));
  view.sprite.setTexture(textureKey(ctx.scene, piece));
}

function paintAround(ctx: FarmContext, obj: { x: number; y: number }): void {
  for (const [dx, dy] of [
    [0, 0],
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]) {
    paint(ctx, obj.x + dx, obj.y + dy);
  }
}

registerBehavior('path', {
  create(ctx, obj, view) {
    paths.set(at(obj.x, obj.y), view);
    paintAround(ctx, obj);
  },
  destroy(ctx, obj) {
    paths.delete(at(obj.x, obj.y));
    paintAround(ctx, obj);
  },
  panel: (ctx, obj) => ({
    title: 'Path',
    icon: '🟫',
    lines: ['A tidy dirt path. Purely decorative — for now.', `Tile ${obj.x}, ${obj.y} · Day ${ctx.game.day}`],
  }),
});
