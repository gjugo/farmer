import { registerBehavior } from '../../game/hooks';

/**
 * Reference feature: the Path buildable (registered in `src/data/buildables.ts`)
 * with an action panel. Copy this folder to start a new feature.
 */
registerBehavior('path', {
  panel: (ctx, obj) => ({
    title: 'Path',
    icon: '🟫',
    lines: ['A tidy dirt path. Purely decorative — for now.', `Tile ${obj.x}, ${obj.y} · Day ${ctx.game.day}`],
  }),
});
