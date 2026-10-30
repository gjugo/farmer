import { getItem, ITEM_LIST } from '../../data/items';
import type { FarmContext, SheetSpec } from '../../game/context';
import { registerHudButton } from '../../game/hooks';
import { dailyPrice, msUntilNextDay, priceTrend, sell, sellAll } from '../../logic/market';
import { formatMoney, h } from '../../ui/dom';

/**
 * The Market: sell anything in the inventory at today's price. Prices change
 * every in-game day (see `src/logic/market.ts`).
 */

const TREND = { 1: { arrow: '▲', label: 'above' }, 0: { arrow: '=', label: 'at' }, [-1]: { arrow: '▼', label: 'below' } } as const;

/** Real time left at the current clock speed, e.g. "2m 05s". */
function formatCountdown(ctx: FarmContext): string {
  const realMs = msUntilNextDay(ctx.game.state.clock) / ctx.game.speed;
  const s = Math.ceil(realMs / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** Inventory ids in catalogue order, then anything unknown. */
function stockedItems(ctx: FarmContext): string[] {
  const { game } = ctx;
  const known = new Set(ITEM_LIST.map((i) => i.id));
  return [...ITEM_LIST.map((i) => i.id), ...Object.keys(game.state.inventory).filter((id) => !known.has(id))].filter(
    (id) => game.count(id) > 0,
  );
}

function sold(ctx: FarmContext, what: string, earned: number): void {
  if (earned > 0) ctx.ui.toast(`Sold ${what} for ${formatMoney(earned)}`, 'success');
}

function marketSheet(ctx: FarmContext): SheetSpec {
  const { game } = ctx;
  return {
    id: 'market',
    title: () => '🏪 Market',
    signature: () => `${game.day}|${JSON.stringify(game.state.inventory)}`,
    render: (body) => {
      const day = game.day;
      body.append(
        h(
          'p',
          { class: 'market-day', 'data-testid': 'market-day' },
          h('strong', {}, `Day ${day} prices`),
          ' · change in ',
          h('span', { class: 'market-countdown', 'data-testid': 'market-countdown' }, formatCountdown(ctx)),
        ),
      );
      const ids = stockedItems(ctx);
      if (!ids.length) {
        body.append(h('p', { class: 'empty', 'data-testid': 'market-empty' }, 'Nothing to sell yet. Harvest crops and collect animal goods, then come back.'));
        return;
      }
      const total = ids.reduce((sum, id) => sum + game.count(id) * (dailyPrice(day, id) ?? 0), 0);
      body.append(
        h(
          'ul',
          { class: 'market-list', 'data-testid': 'market-list' },
          ids.map((id) => {
            const item = getItem(id);
            const price = dailyPrice(day, id);
            const count = game.count(id);
            const dir = priceTrend(day, id);
            const trend = TREND[dir];
            const name = item?.name ?? id;
            return h(
              'li',
              { class: 'market-item', 'data-testid': `market-${id}` },
              h('span', { class: 'item-icon', 'aria-hidden': 'true' }, item?.icon ?? '📦'),
              h('span', { class: 'market-name' }, h('span', { class: 'item-name' }, name), h('span', { class: 'item-count', 'data-testid': `market-count-${id}` }, `×${count}`)),
              price === null
                ? h('span', { class: 'market-price muted' }, 'Not for sale')
                : h(
                    'span',
                    {
                      class: `market-price trend-${dir}`,
                      'data-testid': `market-price-${id}`,
                      'data-price': price,
                      title: `Base price ${formatMoney(item!.price)} — today is ${trend.label} base`,
                    },
                    `${formatMoney(price)} `,
                    h('span', { class: 'trend', 'aria-label': `${trend.label} base price ${formatMoney(item!.price)}` }, trend.arrow),
                  ),
              h(
                'span',
                { class: 'market-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn-secondary',
                    disabled: price === null,
                    'data-testid': `sell-1-${id}`,
                    'aria-label': `Sell 1 ${name}`,
                    onclick: () => sold(ctx, `1 ${name}`, sell(game, id, 1)),
                  },
                  'Sell 1',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn',
                    disabled: price === null,
                    'data-testid': `sell-all-${id}`,
                    'aria-label': `Sell all ${name}`,
                    onclick: () => sold(ctx, `${game.count(id)} ${name}`, sell(game, id)),
                  },
                  'Sell all',
                ),
              ),
            );
          }),
        ),
        h(
          'div',
          { class: 'actions market-footer' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              disabled: total <= 0,
              'data-testid': 'sell-everything',
              onclick: () => sold(ctx, 'everything', sellAll(game)),
            },
            `Sell everything (${formatMoney(total)})`,
          ),
        ),
      );
    },
    tick: (body) => {
      const el = body.querySelector<HTMLElement>('.market-countdown');
      const text = formatCountdown(ctx);
      if (el && el.textContent !== text) el.textContent = text;
    },
  };
}

registerHudButton({
  id: 'market',
  label: 'Market',
  icon: '🏪',
  onClick: (ctx) => ctx.ui.toggleSheet(marketSheet(ctx)),
});
