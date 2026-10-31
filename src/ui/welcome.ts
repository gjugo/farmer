import { getBuildable } from '../data/buildables';
import { getCrop } from '../data/crops';
import { getItem } from '../data/items';
import { MAX_OFFLINE_MS } from '../data/offline';
import { formatAway, type CatchUpResult } from '../logic/offline';
import { uiSignals } from '../game/signals';
import { h } from './dom';
import { withIcons } from './icons';

/** "🌾 Wheat ×12, 🥕 Carrot ×4" */
function goods(inv: Record<string, number>): string {
  return Object.entries(inv)
    .map(([id, qty]) => {
      const item = getItem(id);
      return `${item?.icon ?? ''} ${item?.name ?? id} ×${qty}`.trim();
    })
    .join(', ');
}

/** What the farmers did while away: harvested, sown (times a crop was sown), collected, made, produced, built. */
function workLines(result: CatchUpResult): string[] {
  const { work } = result;
  if (!work) return [];
  const lines: string[] = [];
  if (Object.keys(work.harvested).length) lines.push(`👨‍🌾 Harvested ${goods(work.harvested)}`);
  const sown = Object.entries(work.sown).map(([id, n]) => {
    const crop = getCrop(id);
    return `${crop?.icon ?? ''} ${crop?.name ?? id} ×${n}`.trim();
  });
  if (sown.length) lines.push(`👨‍🌾 Sowed ${sown.join(', ')}`);
  if (Object.keys(work.collected).length) lines.push(`👨‍🌾 Collected ${goods(work.collected)}`);
  if (Object.keys(work.made).length) lines.push(`👨‍🌾 Made ${goods(work.made)}`);
  if (work.materials && Object.keys(work.materials).length) lines.push(`👨‍🌾 Produced ${goods(work.materials)}`);
  const built = Object.entries(work.built).map(([type, n]) => `${getBuildable(type)?.name ?? type}${n > 1 ? ` ×${n}` : ''}`);
  if (built.length) lines.push(`🔨 Built ${built.join(', ')}`);
  return lines;
}

/** Lines of the welcome-back summary, built from the catch-up result alone. */
export function summaryLines(result: CatchUpResult): string[] {
  const lines: string[] = workLines(result);
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
  const { arrived = 0, left = 0 } = result.families ?? {};
  if (arrived > 0) lines.push(`🏡 ${arrived === 1 ? 'A new family' : `${arrived} new families`} moved in`);
  if (left > 0) lines.push(`🧳 ${left === 1 ? 'A family' : `${left} families`} left the farm`);
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
