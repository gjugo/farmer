import { getItem, ITEM_LIST } from '../../data/items';
import { isStoredMaterial, MATERIAL_IDS, type MaterialId } from '../../data/materials';
import type { FarmContext, SheetSpec } from '../../game/context';
import { registerHudButton } from '../../game/hooks';
import { buy, buyPrice, buyUnlockLevel, dailyPrice, msUntilNextDay, priceTrend, sell, sellAll } from '../../logic/market';
import { fullMessage, storageInfo } from '../../logic/storage';
import { formatMoney, h } from '../../ui/dom';
import { itemIcon, withIcons } from '../../ui/icons';

/**
 * The Market: sell anything in the inventory at today's price, and buy building
 * materials. Prices change every in-game day (see `src/logic/market.ts`).
 */

/** Quick amounts for buying materials; the stepper does any other amount. */
const BUY_AMOUNTS = [1, 5, 10] as const;
const STEPPER_MAX = 99;

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

/** Buys `qty` of a material and says how it went. */
function buyMaterial(ctx: FarmContext, id: MaterialId, qty: number): void {
  const item = getItem(id)!;
  const what = `${qty} ${item.icon} ${item.name}`;
  const r = buy(ctx.game, id, qty);
  if (r.ok && r.qty < qty) ctx.ui.toast(`Bought only ${r.qty} ${item.icon} ${item.name} for ${formatMoney(r.spent)}: the storehouse had room for no more`, 'info');
  else if (r.ok) ctx.ui.toast(`Bought ${what} for ${formatMoney(r.spent)}`, 'success');
  else if (r.reason === 'full') ctx.ui.toast(fullMessage('materials'), 'error');
  else if (r.reason === 'money') ctx.ui.toast(`Not enough money: ${what} costs ${formatMoney(qty * (buyPrice(ctx.game.day, id) ?? 0))}`, 'error');
  else if (r.reason === 'level') ctx.ui.toast(`${item.name} is sold from level ${buyUnlockLevel(id)}`, 'error');
}

/** The Buy section: one row per material with quick amounts and a quantity stepper. */
/** Free room for materials. */
function roomLeft(ctx: FarmContext): number {
  const { used, capacity } = storageInfo(ctx.game.state).materials;
  return Math.max(0, capacity - used);
}

function buySection(ctx: FarmContext, stepper: Map<MaterialId, number>): HTMLElement[] {
  const { game } = ctx;
  const day = game.day;
  return [
    h('h3', { class: 'group-title' }, 'Buy building materials'),
    h(
      'ul',
      { class: 'market-list', 'data-testid': 'market-buy-list' },
      MATERIAL_IDS.map((id) => {
        const item = getItem(id)!;
        const price = buyPrice(day, id)!;
        const unlockLevel = buyUnlockLevel(id);
        const locked = !game.isUnlocked(unlockLevel);
        const dir = priceTrend(day, id);
        const qty = () => stepper.get(id) ?? 1;
        const button = (n: number, label: string, testId: string) =>
          h(
            'button',
            { type: 'button', class: 'btn btn-secondary', disabled: locked, 'data-testid': testId, 'aria-label': `Buy ${n} ${item.name}`, onclick: () => buyMaterial(ctx, id, n) },
            label,
          );
        // The stepper updates in place: re-rendering the sheet would drop focus from its input.
        const less = h('button', { type: 'button', class: 'btn btn-secondary', 'aria-label': 'One less', 'data-testid': `buy-less-${id}`, onclick: () => setQty(qty() - 1) }, '−');
        const more = h('button', { type: 'button', class: 'btn btn-secondary', 'aria-label': 'One more', 'data-testid': `buy-more-${id}`, onclick: () => setQty(qty() + 1) }, '+');
        const input = h('input', {
          type: 'number',
          min: 1,
          max: STEPPER_MAX,
          inputmode: 'numeric',
          'aria-label': `${item.name} to buy`,
          'data-testid': `buy-qty-${id}`,
          onchange: () => setQty(Number(input.value)),
        });
        const go = h('button', { type: 'button', class: 'btn', 'data-testid': `buy-qty-go-${id}`, onclick: () => buyMaterial(ctx, id, qty()) });
        const setQty = (n: number) => {
          const q = Math.max(1, Math.min(STEPPER_MAX, Math.floor(n) || 1));
          stepper.set(id, q);
          input.value = String(q);
          less.disabled = q <= 1;
          more.disabled = q >= STEPPER_MAX;
          go.textContent = `Buy ${q} (${formatMoney(q * price)})`;
          go.setAttribute('aria-label', `Buy ${q} ${item.name}`);
        };
        setQty(qty());
        return h(
          'li',
          { class: `market-item buy-item${locked ? ' locked' : ''}`, 'data-testid': `market-buy-${id}` },
          itemIcon(id),
          h(
            'span',
            { class: 'market-name' },
            h('span', { class: 'item-name' }, item.name),
            h('span', { class: 'item-count', 'data-testid': `market-have-${id}` }, `×${game.count(id)}`),
          ),
          h(
            'span',
            { class: `market-price trend-${dir}`, 'data-testid': `market-buy-price-${id}`, 'data-price': price, title: 'Price of one, today' },
            `${formatMoney(price)} `,
            h('span', { class: 'trend', 'aria-label': `${TREND[dir].label} the usual price` }, TREND[dir].arrow),
          ),
          locked
            ? h('span', { class: 'market-actions lock-note' }, `🔒 Sold from level ${unlockLevel}`)
            : [
                h('span', { class: 'market-actions' }, BUY_AMOUNTS.map((n) => button(n, `Buy ${n}`, `buy-${n}-${id}`))),
                h('span', { class: 'market-stepper', role: 'group', 'aria-label': `How many ${item.name} to buy` }, less, input, more, go),
              ],
        );
      }),
    ),
    h(
      'p',
      { class: 'muted market-note', 'data-testid': 'market-room' },
      withIcons(`Storehouse room: ${roomLeft(ctx)} more. Buildings need wood, stone and iron. Selling them back pays less than they cost.`),
    ),
  ];
}

function marketSheet(ctx: FarmContext): SheetSpec {
  const { game } = ctx;
  const stepper = new Map<MaterialId, number>();
  return {
    id: 'market',
    title: () => '🏪 Market',
    signature: () => `${game.day}|${game.level}|${JSON.stringify(game.state.inventory)}|${roomLeft(ctx)}`,
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
      body.append(h('h3', { class: 'group-title' }, 'Sell'));
      if (!ids.length) {
        body.append(h('p', { class: 'empty', 'data-testid': 'market-empty' }, 'Nothing to sell yet. Harvest crops and collect animal goods, then come back.'));
        body.append(...buySection(ctx, stepper));
        return;
      }
      // "Sell everything" keeps building materials (see `sellAll`).
      const total = ids.filter((id) => !isStoredMaterial(id)).reduce((sum, id) => sum + game.count(id) * (dailyPrice(day, id) ?? 0), 0);
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
              itemIcon(id),
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
        ...buySection(ctx, stepper),
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
