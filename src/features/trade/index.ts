import Phaser from 'phaser';
import { TRADING_POST } from '../../data/trade';
import { onBuildPreview, onGameStart, registerBehavior, registerDebugInfo } from '../../game/hooks';
import { LINK_TEXT, linkLine, takeTradeNotice, tradeInfo, tradeLink, wouldLink } from '../../logic/tradepost';
import { DEPTH } from '../../scenes/depth';
import { gridToWorld, ISO_H } from '../../scenes/iso';

/**
 * The 🏪 trading post on the map: its panel and build ghost say whether it is linked to the main road, a toast when the
 * link is made or broken, and the one-time notice for older farms. The rules are `src/logic/tradepost.ts`; the Trade
 * window's tabs show the closed message (`./gate.ts`). `window.farm.trade` for QA.
 */

registerBehavior(TRADING_POST, {
  panel: (ctx, obj) => {
    const link = tradeLink(ctx.game.state);
    const mine = link.post?.id === obj.id;
    // One linked post is enough: any other is just a stall.
    const ok = link.connected;
    return {
      title: 'Trading Post',
      icon: '🏪',
      lines: [
        ok && mine
          ? 'Merchants trade here: the ⚖️ Market, Orders and the travelling trader are open.'
          : ok
            ? 'Another trading post is linked: one is enough.'
            : `Trade is closed: ${LINK_TEXT[link.reason ?? 'no-path']}.`,
        'Lay 🛤️ paths so the farmhouse reaches this post and the 🛣️ main road near the map’s edge.',
      ],
      checklist: [{ id: 'trade-link', ok, text: linkLine(link) }],
    };
  },
});

onGameStart((ctx) => {
  const { game, scene } = ctx;
  registerDebugInfo('trade', () => tradeInfo(game.state));

  // Older farms are told once that trade needs a post now (the version 16 save migration).
  const notice = () => {
    if (takeTradeNotice(game.state)) {
      ctx.ui.toast('🏪 Trade now needs a trading post linked to the 🛣️ main road: build one (🔨 → 📦 Storage) and lay a path from the farmhouse to it and on to the road.', 'info');
    }
  };
  notice();

  // A toast when the link is made or broken (not when a farm loads).
  let was = tradeLink(game.state).connected;
  const check = () => {
    const now = tradeLink(game.state).connected;
    if (now === was) return;
    was = now;
    if (now) ctx.ui.toast('🛣️ The trading post is linked to the main road: the ⚖️ Market, Orders and traders are open.', 'success');
    else ctx.ui.toast('🛣️ The trading post lost its link to the main road: trade is closed until a path joins them again.', 'error');
  };
  for (const e of ['objectAdded', 'objectRemoved', 'objectChanged'] as const) game.events.on(e, check);
  game.events.on('reset', () => {
    was = tradeLink(game.state).connected;
    notice();
  });

  // The build ghost of a trading post says whether it would be linked where it stands.
  const label = scene.add
    .text(0, 0, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: `${Math.round(ISO_H * 0.45)}px`,
      fontStyle: 'bold',
      color: '#fff4d6',
      stroke: '#2b2118',
      strokeThickness: Math.round(ISO_H * 0.08),
      resolution: 2,
    })
    .setOrigin(0.5, 1)
    .setDepth(DEPTH.ghost + 1)
    .setVisible(false)
    .setName('ghost-trade-link');
  let ghost: { x: number; y: number; linked: boolean } | null = null;
  onBuildPreview((_ctx, p) => {
    if (!p || p.type !== TRADING_POST) {
      label.setVisible(false);
      ghost = null;
      return;
    }
    const linked = wouldLink(game.state, p.x, p.y);
    ghost = { x: p.x, y: p.y, linked };
    const top = gridToWorld(p.x + 1, p.y);
    label.setText(linkLine({ post: null, connected: linked, reason: null })).setPosition(top.x, top.y - ISO_H * 2.2).setVisible(true);
  });
  registerDebugInfo('tradeGhost', () => ghost);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => label.destroy());
});
