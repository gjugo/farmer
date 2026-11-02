import { getItem, ITEM_LIST } from '../../data/items';
import { MATERIAL_IDS, type MaterialId } from '../../data/materials';
import type { FarmContext, SheetSpec } from '../../game/context';
import { registerHudButton } from '../../game/hooks';
import {
  allowance,
  buy,
  buyPrice,
  buyUnlockLevel,
  currentPrice,
  marketOf,
  msUntilNextDay,
  priceDrop,
  priceTrend,
  quoteSale,
  quoteSellAll,
  sell,
  sellAll,
} from '../../logic/market';
import { perkFactor } from '../../logic/perks';
import { fullMessage, storageInfo } from '../../logic/storage';
import { formatMoney, h } from '../../ui/dom';
import { itemIcon, withIcons } from '../../ui/icons';

/**
 * The Market: sell anything in the inventory at today's price, and buy building
 * materials. Prices change every in-game day, and fall while an item is flooded:
 * sold past its daily allowance (see `src/logic/market.ts`).
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

/** "−12%" for a drop of 0.12. */
function dropText(drop: number): string {
  return `−${Math.max(1, Math.round(drop * 100))}%`;
}

/**
 * Sell all of an item. When the sale floods the Market (goes past the day's allowance) it first says what the whole
 * lot fetches at the falling prices and where the price ends up, and asks.
 */
async function sellAllOf(ctx: FarmContext, id: string, name: string): Promise<void> {
  const { game } = ctx;
  const qty = game.count(id);
  const quote = quoteSale(game.state, id, qty);
  if (!quote || qty <= 0) return;
  if (quote.floods) {
    const ok = await ctx.ui.confirm(
      `Sell ${qty} ${name} for ${formatMoney(quote.total)}?`,
      `The Market takes about ${allowance(id)} ${name} a day. Past that the price falls with every one sold${quote.priceAfter < quote.priceNow ? `: from ${formatMoney(quote.priceNow)} to ${formatMoney(quote.priceAfter)}` : `, and it is already down to ${formatMoney(quote.priceNow)}`} (${dropText(quote.dropAfter / 10_000)}). It recovers a quarter of the drop each day.`,
      { confirmLabel: `Sell for ${formatMoney(quote.total)}`, variant: 'primary' },
    );
    if (!ok) return;
  }
  sold(ctx, `${game.count(id)} ${name}`, sell(game, id, qty));
}

/** Sell everything, asking first (with the total at the falling prices) when any item would flood. */
async function sellEverything(ctx: FarmContext): Promise<void> {
  const { game } = ctx;
  const quote = quoteSellAll(game.state);
  if (quote.floods.length) {
    const names = quote.floods.map((id) => getItem(id)?.name ?? id).join(', ');
    const ok = await ctx.ui.confirm(
      `Sell everything for ${formatMoney(quote.total)}?`,
      `That floods the Market with ${names}: their prices fall with every one sold past the day's allowance. ${formatMoney(quote.total)} is the total at the falling prices.`,
      { confirmLabel: `Sell for ${formatMoney(quote.total)}`, variant: 'primary' },
    );
    if (!ok) return;
  }
  sold(ctx, 'everything', sellAll(game));
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
    signature: () =>
      `${game.day}|${game.level}|${perkFactor(game.state, 'haggler')}|${JSON.stringify(game.state.inventory)}|${roomLeft(ctx)}|${JSON.stringify(marketOf(game.state).drops)}`,
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
      const total = quoteSellAll(game.state).total;
      body.append(
        h(
          'ul',
          { class: 'market-list', 'data-testid': 'market-list' },
          ids.map((id) => {
            const item = getItem(id);
            const price = currentPrice(game.state, id);
            const drop = priceDrop(game.state, id);
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
                      'data-drop': drop,
                      title: `Base price ${formatMoney(item!.price)} — today is ${trend.label} base${drop > 0 ? `; flooded, ${dropText(drop)}` : ''}`,
                    },
                    `${formatMoney(price)} `,
                    h('span', { class: 'trend', 'aria-label': `${trend.label} base price ${formatMoney(item!.price)}` }, trend.arrow),
                    drop > 0
                      ? h('span', { class: 'flooded', 'data-testid': `market-flooded-${id}`, title: 'Sold past what the Market takes in a day: the price falls, and recovers a quarter of the drop each day' }, `Flooded ${dropText(drop)}`)
                      : null,
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
                    onclick: () => void sellAllOf(ctx, id, name),
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
              onclick: () => void sellEverything(ctx),
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
  spot: { kind: 'tab', window: 'trade', order: 10, sheet: marketSheet },
});
