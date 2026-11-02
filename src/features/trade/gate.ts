import { TRADING_POST } from '../../data/trade';
import type { FarmContext } from '../../game/context';
import { LINK_TEXT, linkLine, tradeLink } from '../../logic/tradepost';
import { h } from '../../ui/dom';
import { withIcons } from '../../ui/icons';

/**
 * What the ⚖️ Trade window's tabs (Market, Orders, Trader) show about the trading post: the link line on top while
 * trade is open, or, until a post is linked to the main road, a closed message with a button to its build card.
 */

/** Part of a trade sheet's signature: it re-renders when the link changes. */
export function linkSignature(ctx: FarmContext): string {
  const link = tradeLink(ctx.game.state);
  return `${link.connected}|${link.reason}`;
}

/** "🛣️ Linked to the main road ✅/❌" (`data-testid="trade-link"`, `data-ok`). */
export function linkLineEl(ctx: FarmContext): HTMLElement {
  const link = tradeLink(ctx.game.state);
  return h('p', { class: `trade-link${link.connected ? ' ok' : ''}`, 'data-testid': 'trade-link', 'data-ok': String(link.connected) }, ...withIcons(linkLine(link)));
}

/** The closed message and its build button, or null while trade is open. */
export function tradeClosedEl(ctx: FarmContext): HTMLElement | null {
  const link = tradeLink(ctx.game.state);
  if (link.connected) return null;
  const why = link.reason && link.reason !== 'no-post' ? h('p', { class: 'muted', 'data-testid': 'trade-closed-reason' }, ...withIcons(`${LINK_TEXT[link.reason]}.`)) : null;
  return h(
    'div',
    { class: 'trade-closed', 'data-testid': 'trade-closed' },
    h('p', { class: 'trade-closed-text' }, ...withIcons(`${LINK_TEXT['no-post']}.`)),
    linkLineEl(ctx),
    why,
    h(
      'button',
      { type: 'button', class: 'btn', 'data-testid': 'trade-build-post', onclick: () => ctx.ui.openBuildCard(TRADING_POST) },
      ...withIcons(link.post ? '🏪 Trading post: build card' : '🏪 Build a trading post'),
    ),
  );
}

/**
 * Starts a trade sheet's body: the closed message (true: render nothing else), or the link line above the sheet's
 * own content (false).
 */
export function renderGate(ctx: FarmContext, body: HTMLElement): boolean {
  const closed = tradeClosedEl(ctx);
  body.append(closed ?? linkLineEl(ctx));
  return !!closed;
}
