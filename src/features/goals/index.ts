import { getPerk } from '../../data/perks';
import type { FarmContext, SheetSpec } from '../../game/context';
import { registerHudButton } from '../../game/hooks';
import { formatMoney, h } from '../../ui/dom';
import { withIcons } from '../../ui/icons';

/**
 * Goals: three active targets at a time, claimed for money and XP.
 * Rules and progress live in `src/logic/progression.ts`, the list in `src/data/progression.ts`.
 */

/** The perks taken, each with what it does, and a button for the choices still open. Shown at the bottom of the Goals sheet. */
function perksSection(ctx: FarmContext): HTMLElement[] {
  const { perks } = ctx.game;
  const pending = perks.pending.length;
  const taken = perks.taken.flatMap((t) => {
    const def = getPerk(t.id);
    return def ? [{ def, level: t.level }] : [];
  });
  if (!taken.length && !pending) return [];
  return [
    h(
      'section',
      { class: 'perks-section', 'data-testid': 'perks-section' },
      h('h3', { class: 'group-title' }, '⭐ Perks'),
      taken.length
        ? h(
            'ul',
            { class: 'perk-list', 'data-testid': 'perk-list' },
            [...taken]
              .sort((a, b) => a.level - b.level)
              .map(({ def, level }) =>
                h(
                  'li',
                  { 'data-testid': `perk-${def.id}` },
                  h('span', { class: 'perk-icon', 'aria-hidden': 'true' }, withIcons(def.icon)),
                  h('span', { class: 'perk-text' }, h('span', { class: 'perk-name' }, def.name), h('span', { class: 'perk-desc' }, def.description)),
                  h('span', { class: 'perk-level' }, `Lv ${level}`),
                ),
              ),
          )
        : h('p', { class: 'empty' }, 'No perks yet: each level-up from level 2 lets you pick one.'),
      pending
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn',
              'data-testid': 'perks-choose',
              onclick: () => ctx.ui.openPerkChoice(),
            },
            pending === 1 ? '⭐ Choose a perk' : `⭐ Choose a perk (${pending} waiting)`,
          )
        : null,
    ),
  ];
}

function goalsSheet(ctx: FarmContext): SheetSpec {
  const { game } = ctx;
  const progression = game.progression;
  return {
    id: 'goals',
    title: () => '🎯 Goals',
    signature: () => JSON.stringify([progression.goals().map((g) => [g.def.id, g.progress]), game.perks.taken, game.perks.pending]),
    render: (body) => {
      renderGoals(body);
      body.append(...perksSection(ctx));
    },
  };

  function renderGoals(body: HTMLElement): void {
    const goals = progression.goals();
    if (!goals.length) {
      body.append(
        h(
          'p',
          { class: 'empty', 'data-testid': 'goals-done' },
          progression.allDone ? 'All goals done — well farmed! Keep growing your farm.' : 'No goals right now.',
        ),
      );
      return;
    }
    body.append(
      h(
        'ul',
        { class: 'goal-list', 'data-testid': 'goal-list' },
        goals.map(({ def, progress, target, complete }) =>
          h(
            'li',
            {
              class: `goal${complete ? ' complete' : ''}`,
              'data-testid': `goal-${def.id}`,
            },
            h('span', { class: 'goal-icon', 'aria-hidden': 'true' }, withIcons(def.icon)),
            h(
              'div',
              { class: 'goal-main' },
              h('span', { class: 'goal-title' }, def.title),
              h(
                'div',
                {
                  class: 'progress goal-progress',
                  role: 'progressbar',
                  'aria-valuemin': 0,
                  'aria-valuemax': target,
                  'aria-valuenow': progress,
                  'aria-label': def.title,
                },
                h('div', {
                  class: 'progress-fill',
                  style: `transform: scaleX(${progress / target})`,
                }),
                h(
                  'span',
                  {
                    class: 'progress-label',
                    'data-testid': `goal-progress-${def.id}`,
                  },
                  `${progress}/${target}`,
                ),
              ),
              h('span', { class: 'goal-reward' }, `Reward: ${formatMoney(def.reward.money)} · ${def.reward.xp} XP`),
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'btn goal-claim',
                disabled: !complete,
                'data-testid': `claim-${def.id}`,
                onclick: () => {
                  const claimed = progression.claim(def.id);
                  if (claimed) ctx.ui.toast(`Goal done! +${formatMoney(claimed.reward.money)} · +${claimed.reward.xp} XP`, 'success');
                },
              },
              'Claim',
            ),
          ),
        ),
      ),
    );
  }
}

registerHudButton({
  id: 'goals',
  label: 'Goals',
  icon: '🎯',
  onClick: (ctx) => ctx.ui.toggleSheet(goalsSheet(ctx)),
  badge: (ctx) => ctx.game.progression.claimable(),
});
