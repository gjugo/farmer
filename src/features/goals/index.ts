import type { FarmContext, SheetSpec } from '../../game/context';
import { registerHudButton } from '../../game/hooks';
import { formatMoney, h } from '../../ui/dom';

/**
 * Goals: three active targets at a time, claimed for money and XP.
 * Rules and progress live in `src/logic/progression.ts`, the list in `src/data/progression.ts`.
 */

function goalsSheet(ctx: FarmContext): SheetSpec {
  const { game } = ctx;
  const progression = game.progression;
  return {
    id: 'goals',
    title: () => '🎯 Goals',
    signature: () => JSON.stringify(progression.goals().map((g) => [g.def.id, g.progress])),
    render: (body) => {
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
              { class: `goal${complete ? ' complete' : ''}`, 'data-testid': `goal-${def.id}` },
              h('span', { class: 'goal-icon', 'aria-hidden': 'true' }, def.icon),
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
                  h('div', { class: 'progress-fill', style: `transform: scaleX(${progress / target})` }),
                  h('span', { class: 'progress-label', 'data-testid': `goal-progress-${def.id}` }, `${progress}/${target}`),
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
    },
  };
}

registerHudButton({
  id: 'goals',
  label: 'Goals',
  icon: '🎯',
  onClick: (ctx) => ctx.ui.toggleSheet(goalsSheet(ctx)),
  badge: (ctx) => ctx.game.progression.claimable(),
});
