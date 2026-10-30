import { ITEM_LIST } from '../data/items';
import { MAX_LEVEL } from '../data/progression';
import type { FarmContext } from '../game/context';
import { refreshOrders } from '../logic/orders';
import { h } from './dom';

export const SPEEDS = [1, 10, 60] as const;

export function isDebugMode(search = window.location.search): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}

/** QA panel, shown only with `?debug=1`. */
export function mountDebugPanel(root: HTMLElement, ctx: FarmContext): void {
  const { game } = ctx;
  const select = h(
    'select',
    { 'data-testid': 'debug-item', 'aria-label': 'Item' },
    ITEM_LIST.map((item) => h('option', { value: item.id }, `${item.icon} ${item.name}`)),
  );
  const speedButtons = SPEEDS.map((speed) =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-secondary',
        'data-testid': `debug-speed-${speed}`,
        'aria-pressed': String(game.speed === speed),
        onclick: () => game.setSpeed(speed),
      },
      `×${speed}`,
    ),
  );
  const levelSelect = h(
    'select',
    { 'data-testid': 'debug-level', 'aria-label': 'Level' },
    Array.from({ length: MAX_LEVEL }, (_, i) => h('option', { value: String(i + 1) }, `Level ${i + 1}`)),
  );
  const syncLevel = () => (levelSelect.value = String(game.level));
  syncLevel();
  game.events.on('xp', syncLevel);
  game.events.on('reset', syncLevel);

  const syncSpeed = () => speedButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(game.speed === SPEEDS[i])));
  game.events.on('speed', syncSpeed);
  game.events.on('reset', syncSpeed);

  const body = h(
    'div',
    { class: 'debug-body' },
    h(
      'button',
      { type: 'button', class: 'btn', 'data-testid': 'debug-money', onclick: () => game.earn(1000) },
      '+$1000',
    ),
    h(
      'div',
      { class: 'debug-row' },
      select,
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          'data-testid': 'debug-add-item',
          onclick: () => {
            game.addItem(select.value, 10);
            ctx.ui.toast(`+10 ${ITEM_LIST.find((i) => i.id === select.value)?.name ?? select.value}`, 'success');
          },
        },
        '+10',
      ),
    ),
    h('div', { class: 'debug-row', role: 'group', 'aria-label': 'Clock speed' }, h('span', {}, 'Speed'), speedButtons),
    h(
      'div',
      { class: 'debug-row' },
      h('button', { type: 'button', class: 'btn', 'data-testid': 'debug-xp', onclick: () => game.progression.addXp(100) }, '+100 XP'),
      levelSelect,
      h(
        'button',
        { type: 'button', class: 'btn', 'data-testid': 'debug-set-level', onclick: () => game.progression.setLevel(Number(levelSelect.value)) },
        'Set',
      ),
    ),
    h(
      'button',
      { type: 'button', class: 'btn', 'data-testid': 'debug-complete-goals', onclick: () => game.progression.completeAll() },
      'Complete goals',
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'data-testid': 'debug-refresh-orders',
        onclick: () => {
          refreshOrders(game.state);
          ctx.ui.toast('Orders refreshed', 'success');
        },
      },
      'Refresh orders',
    ),
  );
  const panel = h(
    'details',
    { class: 'debug-panel', open: window.innerWidth > 640, 'data-testid': 'debug-panel' },
    h('summary', {}, '🐞 Debug'),
    body,
  );
  root.append(panel);
}
