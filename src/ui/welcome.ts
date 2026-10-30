import { getCrop } from '../data/crops';
import { getItem } from '../data/items';
import { MAX_OFFLINE_MS } from '../data/offline';
import { formatAway, type CatchUpResult } from '../logic/offline';
import { uiSignals } from '../game/signals';
import { h } from './dom';
import { withIcons } from './icons';

/** Lines of the welcome-back summary, built from the catch-up result alone. */
export function summaryLines(result: CatchUpResult): string[] {
  const lines: string[] = [];
  for (const [id, fields] of Object.entries(result.cropsReady)) {
    const crop = getCrop(id);
    lines.push(`${crop?.icon ?? ''} ${crop?.name ?? id} ready to harvest${fields > 1 ? ` in ${fields} fields` : ''}`.trim());
  }
  for (const [id, qty] of Object.entries(result.produced)) {
    const item = getItem(id);
    lines.push(`${item?.icon ?? ''} ${item?.name ?? id} ×${qty} ready to collect`.trim());
  }
  if (result.jobsFinished > 0) {
    lines.push(`⚙️ ${result.jobsFinished} processing job${result.jobsFinished > 1 ? 's' : ''} finished`);
  }
  if (result.dayAfter !== result.dayBefore) lines.push(`📅 New market day: day ${result.dayAfter} prices`);
  return lines;
}

/** Shows the welcome-back panel, replacing one that is already open. */
export function showWelcomeBack(root: HTMLElement, result: CatchUpResult): void {
  root.querySelector('[data-testid="welcome-back"]')?.closest('.dialog-backdrop')?.remove();
  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    backdrop.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const lines = summaryLines(result);
  const button = h('button', { type: 'button', class: 'btn', 'data-testid': 'welcome-close', onclick: close }, 'Back to the farm');
  const backdrop = h(
    'div',
    { class: 'dialog-backdrop' },
    h(
      'div',
      { class: 'dialog welcome', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'welcome-title', 'data-testid': 'welcome-back' },
      h('h2', { id: 'welcome-title' }, 'Welcome back!'),
      h('p', { 'data-testid': 'welcome-away' }, `You were away for ${formatAway(result.awayMs)}.`),
      result.capped
        ? h(
            'p',
            { class: 'dialog-hint', 'data-testid': 'welcome-capped' },
            `The farm only keeps working for ${formatAway(MAX_OFFLINE_MS)} while you are away.`,
          )
        : null,
      lines.length > 0
        ? h('ul', { class: 'welcome-list', 'data-testid': 'welcome-list' }, lines.map((line) => h('li', {}, withIcons(line))))
        : h('p', { 'data-testid': 'welcome-empty' }, 'Nothing finished while you were away.'),
      h('div', { class: 'actions' }, button),
    ),
  );
  window.addEventListener('keydown', onKey, true);
  root.append(backdrop);
  button.focus();
  uiSignals.emit('welcomeBack', { awayMs: result.awayMs });
}
