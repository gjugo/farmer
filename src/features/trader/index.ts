import Phaser from 'phaser';
import { ANIMALS } from '../../data/animals';
import { getItem } from '../../data/items';
import type { FarmContext, SheetSpec } from '../../game/context';
import { onGameStart, registerHudButton } from '../../game/hooks';
import { fullMessage, poolOf } from '../../logic/storage';
import { LINK_TEXT, tradeLink } from '../../logic/tradepost';
import { linkSignature, renderGate } from '../trade/gate';
import {
  buyFromTrader,
  dayStart,
  roomFor,
  sellToTrader,
  traderHere,
  traderOf,
  traderPassing,
  traderTimes,
  TRADER_LEVEL,
  updateTrader,
  wagonTile,
  type TradeResult,
  type TraderOffer,
} from '../../logic/trader';
import { walkerDepth } from '../../scenes/depth';
import { gridToWorld } from '../../scenes/iso';
import { addArt, artSeason, textureKey } from '../../scenes/sprites';
import { formatMoney, h } from '../../ui/dom';
import { itemIcon } from '../../ui/icons';

/**
 * The travelling trader: his wagon in the village (by the camp, later the farmhouse), a HUD banner and a ⚖️ Trade tab the day before and while he is
 * here, and his panel.
 * Logic (schedule, offers, trading) lives in `src/logic/trader.ts`.
 */

/** Real time until game time `at`, at the current clock speed, e.g. "2m 05s". */
function realTimeUntil(ctx: FarmContext, at: number): string {
  const s = Math.max(0, Math.ceil((at - ctx.game.now) / ctx.game.speed / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function countdown(ctx: FarmContext): string {
  const { arrivesAt, leavesAt } = traderTimes(ctx.game);
  if (traderHere(ctx.game.state)) return leavesAt === null ? '' : realTimeUntil(ctx, leavesAt);
  return arrivesAt === null ? '' : realTimeUntil(ctx, arrivesAt);
}

/** Tomorrow's trader has been announced (and none is here today). */
function comingTomorrow(ctx: FarmContext): boolean {
  const { game } = ctx;
  return !traderHere(game.state) && game.level >= TRADER_LEVEL && traderTimes(game).arrivesAt === dayStart(game.day + 1);
}

function offerName(offer: TraderOffer): { icon: HTMLElement | string; name: string; id: string } {
  if ('animal' in offer) {
    const a = ANIMALS[offer.animal];
    return { icon: h('span', { class: 'item-icon', 'aria-hidden': 'true' }, a.icon), name: a.name, id: offer.animal };
  }
  return { icon: itemIcon(offer.item), name: getItem(offer.item)?.name ?? offer.item, id: offer.item };
}

const REFUSED: Record<Exclude<TradeResult, { ok: true }>['reason'], string> = {
  closed: 'Trade is closed: link a 🏪 trading post to the main road',
  gone: 'The trader has moved on',
  none: 'Nothing to trade',
  'sold-out': 'He has no more of that',
  money: 'Not enough money',
  full: 'No room',
  'no-pen': 'No pen with room for it',
};

function sellTo(ctx: FarmContext, index: number, qty: number): void {
  const want = traderHere(ctx.game.state)?.wants[index];
  const name = want ? (getItem(want.item)?.name ?? want.item) : '';
  const r = sellToTrader(ctx.game, index, qty);
  if (r.ok) ctx.ui.toast(`Sold ${r.qty} ${name} to the trader for ${formatMoney(r.money)}`, 'success');
  else ctx.ui.toast(REFUSED[r.reason], 'error');
}

function buyFrom(ctx: FarmContext, index: number, qty: number): void {
  const offer = traderHere(ctx.game.state)?.sells[index];
  if (!offer) return;
  const { name } = offerName(offer);
  const r = buyFromTrader(ctx.game, index, qty);
  if (r.ok && r.qty < qty) ctx.ui.toast(`Bought only ${r.qty} ${name} for ${formatMoney(r.money)}: ${'animal' in offer ? 'the pens had room' : 'there was room or money'} for no more`, 'info');
  else if (r.ok) ctx.ui.toast(`Bought ${r.qty} ${name} for ${formatMoney(r.money)}`, 'success');
  else if (r.reason === 'full' && !('animal' in offer)) ctx.ui.toast(fullMessage(poolOf(offer.item)), 'error');
  else ctx.ui.toast(REFUSED[r.reason], 'error');
}

function button(label: string, testId: string, aria: string, onclick: () => void, disabled = false, secondary = true): HTMLElement {
  return h('button', { type: 'button', class: secondary ? 'btn btn-secondary' : 'btn', disabled, 'data-testid': testId, 'aria-label': aria, onclick }, label);
}

function traderSheet(ctx: FarmContext): SheetSpec {
  const { game } = ctx;
  return {
    id: 'trader',
    title: () => '🛒 Travelling trader',
    signature: () => {
      const v = traderHere(game.state);
      return `${game.day}|${game.level}|${game.money}|${JSON.stringify(game.state.inventory)}|${v ? JSON.stringify([v.wants, v.sells]) : '-'}|${comingTomorrow(ctx)}|${linkSignature(ctx)}`;
    },
    render: (body) => {
      // He only stops by a trading post linked to the main road; without one he drives through.
      if (renderGate(ctx, body)) {
        if (traderHere(game.state)) {
          body.append(h('p', { class: 'trader-intro', 'data-testid': 'trader-passing' }, 'A travelling trader is driving along the main road today, but without a linked trading post he passes by without stopping.'));
        }
        return;
      }
      const visit = traderHere(game.state);
      if (!visit) {
        const text =
          game.level < TRADER_LEVEL
            ? `Travelling traders call at farms from level ${TRADER_LEVEL}.`
            : comingTomorrow(ctx)
              ? 'A travelling trader arrives tomorrow. He stays one day: come and see what he buys and sells.'
              : 'No trader today. One calls about twice a season and is announced the day before.';
        body.append(h('p', { class: 'trader-intro', 'data-testid': 'trader-away' }, text, ' ', h('span', { class: 'trader-countdown market-countdown' }, game.level >= TRADER_LEVEL ? `Next in ${countdown(ctx)}` : '')));
        return;
      }
      body.append(
        h(
          'p',
          { class: 'trader-intro', 'data-testid': 'trader-here' },
          'He pays well for what he wants and sells what he carries, while stocks last. Leaves in ',
          h('span', { class: 'trader-countdown market-countdown' }, countdown(ctx)),
          '.',
        ),
        h('h3', { class: 'group-title' }, 'He buys'),
        h(
          'ul',
          { class: 'market-list', 'data-testid': 'trader-wants' },
          visit.wants.map((want, i) => {
            const item = getItem(want.item)!;
            const have = game.count(want.item);
            const n = Math.min(have, want.left);
            return h(
              'li',
              { class: 'market-item', 'data-testid': `trader-want-${want.item}` },
              itemIcon(want.item),
              h(
                'span',
                { class: 'market-name' },
                h('span', { class: 'item-name' }, item.name),
                h('span', { class: 'item-count' }, `×${have}`),
                h('span', { class: 'trader-left', 'data-testid': `trader-want-left-${want.item}` }, want.left > 0 ? `wants ${want.left}` : 'had enough'),
              ),
              h(
                'span',
                { class: 'market-price trend-1', 'data-testid': `trader-want-price-${want.item}`, 'data-price': want.price, title: `Base price ${formatMoney(item.price)}` },
                `${formatMoney(want.price)} `,
                h('span', { class: 'trend' }, `+${Math.round((want.price / item.price - 1) * 100)}%`),
              ),
              h(
                'span',
                { class: 'market-actions' },
                button('Sell 1', `trader-sell-1-${want.item}`, `Sell 1 ${item.name} to the trader`, () => sellTo(ctx, i, 1), n < 1),
                button(n > 0 ? `Sell ${n} · ${formatMoney(n * want.price)}` : 'Sell', `trader-sell-all-${want.item}`, `Sell ${n} ${item.name} to the trader`, () => sellTo(ctx, i, n), n < 1, false),
              ),
            );
          }),
        ),
        h('h3', { class: 'group-title' }, 'He sells'),
        h(
          'ul',
          { class: 'market-list', 'data-testid': 'trader-sells' },
          visit.sells.map((offer, i) => {
            const { icon, name, id } = offerName(offer);
            const room = roomFor(game, offer);
            const afford = Math.floor(game.money / Math.max(1, offer.price));
            const max = Math.min(room, afford);
            const note = offer.left <= 0 ? 'sold out' : `${offer.left} left`;
            const reason = offer.left <= 0 ? '' : room <= 0 ? ('animal' in offer ? 'No pen with room' : 'No room') : afford <= 0 ? 'Not enough money' : '';
            return h(
              'li',
              { class: 'market-item', 'data-testid': `trader-offer-${id}` },
              icon,
              h('span', { class: 'market-name' }, h('span', { class: 'item-name' }, name), h('span', { class: 'trader-left', 'data-testid': `trader-offer-left-${id}` }, note)),
              h('span', { class: 'market-price', 'data-testid': `trader-offer-price-${id}`, 'data-price': offer.price }, formatMoney(offer.price)),
              h(
                'span',
                { class: 'market-actions' },
                reason ? h('span', { class: 'lock-note muted' }, reason) : null,
                button('Buy 1', `trader-buy-1-${id}`, `Buy 1 ${name} from the trader`, () => buyFrom(ctx, i, 1), max < 1),
                max > 1 ? button(`Buy ${max} · ${formatMoney(max * offer.price)}`, `trader-buy-max-${id}`, `Buy ${max} ${name} from the trader`, () => buyFrom(ctx, i, max), false, false) : null,
              ),
            );
          }),
        ),
      );
    },
    tick: (body) => {
      const el = body.querySelector<HTMLElement>('.trader-countdown');
      if (!el) return;
      const text = traderHere(game.state) ? countdown(ctx) : game.level >= TRADER_LEVEL ? `Next in ${countdown(ctx)}` : '';
      if (el.textContent !== text) el.textContent = text;
    },
  };
}

/** He is here, or comes tomorrow (announced): his tab and banner show. */
const traderShown = (ctx: FarmContext) => !!traderHere(ctx.game.state) || comingTomorrow(ctx);

registerHudButton({
  id: 'trader',
  label: 'Trader',
  icon: '🛒',
  spot: { kind: 'tab', window: 'trade', order: 30, sheet: traderSheet },
  visible: traderShown,
});

registerHudButton({
  id: 'trader',
  label: 'Trader',
  icon: '🛒',
  spot: { kind: 'banner', order: 20, opens: 'trader', severity: (ctx) => (traderHere(ctx.game.state) ? 'warn' : 'info') },
  visible: traderShown,
  live: (ctx) =>
    traderPassing(ctx.game.state)
      ? { icon: '🛒', label: `Trader passing by · ${LINK_TEXT[tradeLink(ctx.game.state).reason ?? 'no-post'].replace(/^Build/, 'build').replace(/^No/, 'no')}` }
      : traderHere(ctx.game.state)
        ? { icon: '🛒', label: `Trader here · leaves in ${countdown(ctx)}` }
        : { icon: '🛒', label: 'Trader tomorrow' },
});

onGameStart((ctx) => {
  const { game, scene } = ctx;
  let wagon: Phaser.GameObjects.Image | null = null;
  let drawn = '';

  const draw = () => {
    const tile = wagonTile(game.state);
    const key = tile ? `${tile.x},${tile.y}|${textureKey(scene, 'trader-wagon')}|${artSeason()}` : '';
    if (key !== drawn) {
      drawn = key;
      wagon?.destroy();
      wagon = null;
      if (tile) {
        const top = gridToWorld(tile.x, tile.y);
        wagon = addArt(scene, top.x, top.y, 'trader-wagon').setInteractive({ pixelPerfect: true, alphaTolerance: 32 });
        wagon.setData('onTap', () => ctx.ui.openTab('trader'));
        wagon.setData('testid', 'trader-wagon');
      }
    }
    if (wagon && tile) wagon.setDepth(walkerDepth(tile.x + 0.5, tile.y + 0.5));
  };

  const onUpdate = () => {
    const r = updateTrader(game);
    if (r.announced !== null) ctx.ui.toast('🛒 A travelling trader arrives tomorrow. He stays one day.', 'info');
    if (r.arrived && wagonTile(game.state)) ctx.ui.toast('🛒 A travelling trader has parked by the trading post. Tap his wagon to trade.', 'success');
    else if (r.arrived) ctx.ui.toast('🛒 A travelling trader is passing along the main road, but without a trading post linked to it he doesn’t stop.', 'info');
    if (r.left) ctx.ui.toast('🛒 The travelling trader has moved on.', 'info');
    draw();
  };
  const onReset = () => {
    traderOf(game.state);
    drawn = '\u0000';
  };
  const unsubscribe = game.events.on('reset', onReset);
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    unsubscribe();
    wagon?.destroy();
  });
});
