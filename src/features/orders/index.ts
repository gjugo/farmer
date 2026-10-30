import Phaser from 'phaser';
import { getItem } from '../../data/items';
import type { FarmContext, SheetSpec } from '../../game/context';
import { onGameStart, registerHudButton } from '../../game/hooks';
import { timerRemaining } from '../../logic/clock';
import {
  discardOrder,
  fulfilOrder,
  fulfillableCount,
  hasGoods,
  marketValue,
  noteKnown,
  ordersOf,
  updateOrders,
  type Order,
  type OrderSlot,
} from '../../logic/orders';
import { formatMoney, h } from '../../ui/dom';

/**
 * The Orders board: 3 customer orders for bundles of known goods, paying more than
 * the market. Logic (generation, rewards, timers) lives in `src/logic/orders.ts`.
 */

/** Real time left at the current clock speed, e.g. "1m 05s". */
function formatRealTime(ctx: FarmContext, gameMs: number): string {
  const s = Math.ceil(gameMs / ctx.game.speed / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function countdownText(ctx: FarmContext, slot: OrderSlot): string {
  return slot.refill ? formatRealTime(ctx, timerRemaining(ctx.game.state.clock, slot.refill)) : '';
}

function orderCard(ctx: FarmContext, order: Order, index: number): HTMLElement {
  const { game } = ctx;
  const ready = hasGoods(game.state.inventory, order);
  const market = marketValue(game.day, order.items);
  return h(
    'li',
    { class: `order-card${ready ? ' ready' : ''}`, 'data-testid': `order-${index}`, 'data-state': 'open', 'data-reward': order.reward },
    h('div', { class: 'order-head' }, h('strong', { class: 'order-customer', 'data-testid': `order-customer-${index}` }, order.customer)),
    h(
      'ul',
      { class: 'order-items' },
      order.items.map((it) => {
        const item = getItem(it.itemId);
        const have = game.count(it.itemId);
        return h(
          'li',
          { class: `order-item${have >= it.qty ? ' have' : ''}`, 'data-testid': `order-${index}-item-${it.itemId}`, 'data-qty': it.qty },
          h('span', { class: 'item-icon', 'aria-hidden': 'true' }, item?.icon ?? '📦'),
          h('span', { class: 'item-name' }, `${it.qty} × ${item?.name ?? it.itemId}`),
          h('span', { class: 'order-have', 'aria-label': `you have ${have}` }, `${Math.min(have, it.qty)}/${it.qty}`),
        );
      }),
    ),
    h(
      'p',
      { class: 'order-pay' },
      h('span', { class: 'order-reward', 'data-testid': `order-reward-${index}` }, `Reward ${formatMoney(order.reward)}`),
      h(
        'span',
        { class: 'order-market', 'data-testid': `order-market-${index}`, 'data-market': market },
        `Market today ${formatMoney(market)} · `,
        h('span', { class: 'order-bonus' }, `+${formatMoney(order.reward - market)}`),
      ),
    ),
    h(
      'div',
      { class: 'order-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-secondary',
          'data-testid': `order-discard-${index}`,
          'aria-label': `Discard ${order.customer}'s order`,
          onclick: async () => {
            const ok = await ctx.ui.confirm('Discard this order?', `${order.customer} will find someone else. A new order arrives in about 5 game-minutes.`, {
              confirmLabel: 'Discard',
            });
            const current = ordersOf(game.state).slots[index]?.order;
            if (ok && current?.id === order.id && discardOrder(game.state, index)) ctx.ui.toast('Order discarded');
          },
        },
        'Discard',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          disabled: !ready,
          'data-testid': `order-fulfil-${index}`,
          'aria-label': `Fulfil ${order.customer}'s order for ${formatMoney(order.reward)}`,
          onclick: () => {
            const reward = fulfilOrder(game, index);
            if (reward !== null) ctx.ui.toast(`${order.customer} paid ${formatMoney(reward)}`, 'success');
          },
        },
        `Fulfil · ${formatMoney(order.reward)}`,
      ),
    ),
  );
}

function waitingCard(ctx: FarmContext, slot: OrderSlot, index: number): HTMLElement {
  const label = slot.reason === 'fulfilled' ? 'Order delivered!' : 'Waiting for a customer';
  return h(
    'li',
    { class: 'order-card waiting', 'data-testid': `order-${index}`, 'data-state': slot.reason ?? 'waiting' },
    h('p', { class: 'muted' }, h('strong', {}, label), ' New order in ', h('span', { class: 'order-countdown', 'data-testid': `order-countdown-${index}`, 'data-slot': index }, countdownText(ctx, slot))),
  );
}

function ordersSheet(ctx: FarmContext): SheetSpec {
  const { game } = ctx;
  return {
    id: 'orders',
    title: () => '📋 Orders',
    signature: () => {
      updateOrders(game.state);
      const slots = ordersOf(game.state).slots.map((s) => (s.order ? `${s.order.id}:${hasGoods(game.state.inventory, s.order)}` : `-${s.reason ?? ''}`));
      return `${game.day}|${JSON.stringify(game.state.inventory)}|${slots.join(',')}`;
    },
    render: (body) => {
      body.append(h('p', { class: 'muted orders-intro' }, 'Customers pay more than the market for the whole bundle.'));
      body.append(
        h(
          'ul',
          { class: 'orders-list', 'data-testid': 'orders-list' },
          ordersOf(game.state).slots.map((slot, i) => (slot.order ? orderCard(ctx, slot.order, i) : waitingCard(ctx, slot, i))),
        ),
      );
    },
    tick: (body) => {
      const slots = ordersOf(game.state).slots;
      for (const el of body.querySelectorAll<HTMLElement>('.order-countdown')) {
        const slot = slots[Number(el.dataset.slot)];
        const text = slot ? countdownText(ctx, slot) : '';
        if (el.textContent !== text) el.textContent = text;
      }
    },
  };
}

registerHudButton({
  id: 'orders',
  label: 'Orders',
  icon: '📋',
  onClick: (ctx) => ctx.ui.toggleSheet(ordersSheet(ctx)),
  badge: (ctx) => fulfillableCount(ctx.game.state),
});

onGameStart((ctx) => {
  const { game } = ctx;
  updateOrders(game.state);
  const unsubscribe = game.events.on('inventory', ({ itemId, delta }) => {
    if (delta > 0) noteKnown(ordersOf(game.state), itemId);
  });
  const onUpdate = () => updateOrders(game.state);
  const scene = ctx.scene;
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    unsubscribe();
  });
});
