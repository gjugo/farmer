import { ITEM_LIST } from '../data/items';
import { MAX_LEVEL } from '../data/progression';
import type { FarmContext } from '../game/context';
import { DAY_MS } from '../logic/constants';
import type { HazardKind } from '../data/hazards';
import { addFamily } from '../logic/families';
import { triggerHazard } from '../logic/hazards';
import { mapOf, regrowAll } from '../logic/maplayer';
import { catchUpGame } from '../logic/offline';
import { clearDrops } from '../logic/market';
import { refreshOrders } from '../logic/orders';
import { traderNow } from '../logic/trader';
import { nextSeasonAt } from '../logic/seasons';
import { fullMessage, poolOf } from '../logic/storage';
import { h } from './dom';

export const SPEEDS = [1, 10, 60, 300] as const;

export function isDebugMode(search = window.location.search): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}

const AWAY_UNITS = { min: 60_000, h: 3_600_000 } as const;

/** QA panel, shown only with `?debug=1`. `simulateAway` runs the real welcome-back catch-up for a real-time duration. */
export function mountDebugPanel(root: HTMLElement, ctx: FarmContext, simulateAway: (ms: number) => void): void {
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

  const awayInput = h('input', { type: 'number', min: 0, step: 'any', value: 2, 'data-testid': 'debug-away-amount', 'aria-label': 'Time away' });
  const awayUnit = h(
    'select',
    { 'data-testid': 'debug-away-unit', 'aria-label': 'Unit' },
    h('option', { value: 'min' }, 'min'),
    h('option', { value: 'h', selected: true }, 'h'),
  );
  const awayRow = h(
    'div',
    { class: 'debug-row', role: 'group', 'aria-label': 'Simulate time away' },
    awayInput,
    awayUnit,
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'data-testid': 'debug-away',
        onclick: () => {
          const amount = Number(awayInput.value);
          if (!(amount > 0)) return ctx.ui.toast('Enter a time away', 'error');
          simulateAway(amount * AWAY_UNITS[awayUnit.value as keyof typeof AWAY_UNITS]);
        },
      },
      'Simulate time away',
    ),
  );

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
            // Like any other intake, only what fits goes in.
            const n = game.addItem(select.value, 10);
            const name = ITEM_LIST.find((i) => i.id === select.value)?.name ?? select.value;
            if (n === 0) ctx.ui.toast(fullMessage(poolOf(select.value)), 'error');
            else ctx.ui.toast(`+${n} ${name}${n < 10 ? ' (all that fit)' : ''}`, 'success');
          },
        },
        '+10',
      ),
    ),
    h('div', { class: 'debug-row', role: 'group', 'aria-label': 'Clock speed' }, h('span', {}, 'Speed'), speedButtons),
    awayRow,
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'data-testid': 'debug-next-season',
        // Jumps the clock like time away (crops, animals and jobs move on), without the welcome-back summary.
        onclick: () => catchUpGame(game, nextSeasonAt(game.now) - game.now, { away: false }),
      },
      'Next season',
    ),
    h(
      'div',
      { class: 'debug-row' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          'data-testid': 'debug-add-family',
          // Fills an empty home at once, skipping the wait and the approval check.
          onclick: () => {
            if (!addFamily(game)) ctx.ui.toast('No room in a home: build or upgrade a cottage first', 'error');
          },
        },
        '+1 family',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          'data-testid': 'debug-next-day',
          // Like "Next season": the families settle the new day (meal, firewood, clothes, approval) on the way.
          onclick: () => catchUpGame(game, (Math.floor(game.now / DAY_MS) + 1) * DAY_MS - game.now, { away: false }),
        },
        'Next day',
      ),
    ),
    // Hazards on demand (skipping the rolls, level and season); defences still work, a fox never takes the last chicken.
    h(
      'div',
      { class: 'debug-row debug-hazards', role: 'group', 'aria-label': 'Hazards' },
      (
        [
          ['drought', 'debug-drought', 'Drought now'],
          ['crows', 'debug-crows', 'Crows now'],
          ['fox', 'debug-fox', 'Fox now'],
          ['harsh-winter', 'debug-harsh-winter', 'Harsh winter next'],
        ] as [HazardKind, string, string][]
      ).map(([kind, testid, label]) =>
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            'data-testid': testid,
            onclick: () => {
              const r = triggerHazard(game, kind);
              if (!r.ok) ctx.ui.toast(r.reason, 'error');
            },
          },
          label,
        ),
      ),
    ),
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
        'data-testid': 'debug-reset-perks',
        // Forgets every perk taken; every level reached gets its choice back (the ⭐ banner reopens them).
        onclick: () => {
          game.perks.reset();
          ctx.ui.toast(`Perks reset: ${game.perks.pending.length} to choose`, 'success');
        },
      },
      'Reset perks',
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
    h(
      'div',
      { class: 'debug-row' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          'data-testid': 'debug-trader-now',
          // Whatever the schedule and level: he parks in the village and stays until the day ends.
          onclick: () => {
            traderNow(game);
            ctx.ui.toast('🛒 A travelling trader has parked in the village', 'success');
          },
        },
        'Trader now',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          'data-testid': 'debug-clear-drops',
          onclick: () => {
            clearDrops(game.state);
            ctx.ui.toast('Market prices back to normal', 'success');
          },
        },
        'Clear market drops',
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'data-testid': 'debug-regrow-trees',
        onclick: () => {
          const n = regrowAll(mapOf(game.state), game.now);
          game.mapChanged();
          ctx.ui.toast(n > 0 ? `${n} trees grew back` : 'No stumps to grow back', 'success');
        },
      },
      'Regrow all trees',
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
