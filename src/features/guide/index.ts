import { FIELD } from '../../data/crops';
import { GUIDE_STEPS, type GuideMapTarget, type GuideStepDef } from '../../data/guide';
import type { FarmContext } from '../../game/context';
import { registerDebugInfo, registerSettingsSection } from '../../game/hooks';
import { uiSignals, type HudView } from '../../game/signals';
import { cropStage, type FieldState } from '../../logic/crops';
import type { ActivityEvents } from '../../logic/activity';
import {
  currentStep,
  endGuide,
  guideInfo,
  guideOf,
  isGuideActive,
  nextStep,
  notifyGuide,
  skipGuide,
  startGuide,
  type GuideSignal,
} from '../../logic/guide';
import type { PlacedObject } from '../../logic/types';
import { doorOf, farmhouseOf } from '../../logic/roads';
import { workerAt } from '../../logic/workers';
import type { FarmScene } from '../../scenes/FarmScene';
import { h } from '../../ui/dom';
import { withIcons } from '../../ui/icons';

/** How often the map marker looks for its field again (it can ripen without an event). */
const MARKER_MS = 500;

/** Activities that can finish a step (`src/logic/guide.ts`). */
const ACTIVITIES = ['placed', 'planted', 'harvested', 'sold', 'bought'] as const satisfies readonly (keyof ActivityEvents)[];

/** The guide on screen: the card, the ring and the map marker. Null until `mountGuide`. */
let mounted: { ctx: FarmContext; render: () => void } | null = null;

/** Is the element on screen (not hidden, not detached)? */
function shown(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0;
}

/** The first ring target of the step that is on screen (see `GuideRingTarget`). */
function findTarget(root: HTMLElement, step: GuideStepDef): HTMLElement | null {
  for (const t of step.ring) {
    let found: Element | undefined;
    if (t.startsWith('action:')) {
      const lines = root.querySelector('[data-testid="panel-lines"]')?.textContent ?? '';
      if (step.ringUnless && lines.includes(step.ringUnless)) continue;
      const text = t.slice('action:'.length);
      found = [...root.querySelectorAll('[data-testid^="panel-action-"]')].find((b) => shown(b) && (b.textContent ?? '').includes(text));
    } else if (t.endsWith('*')) {
      found = [...root.querySelectorAll(`[data-testid^="${t.slice(0, -1)}"]`)].find(shown);
    } else {
      const el = root.querySelector(`[data-testid="${t}"]`);
      found = el && shown(el) ? el : undefined;
    }
    if (found) return found as HTMLElement;
  }
  return null;
}

/** The tile (centre, in tile coordinates) a step's map marker stands on, or null. */
function markerTile(ctx: FarmContext, target: GuideMapTarget): { x: number; y: number } | null {
  const { game } = ctx;
  if (target === 'door') {
    const house = farmhouseOf(game.state);
    return house ? doorOf(house) : null;
  }
  const fields = game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
  const free = (f: PlacedObject) => workerAt(game.state, f.id) === null;
  const field =
    target === 'field-free'
      ? fields.find(free)
      : target === 'field-empty'
        ? fields.find((f) => free(f) && !f.site && f.state.crop === null)
        : fields.find((f) => cropStage(game.state.clock, f.state) === 'ripe');
  // A field's middle: the corner its four tiles share.
  return field ? { x: field.x + 0.5, y: field.y + 0.5 } : null;
}

/**
 * Mounts the guide's card, ring and map marker in the HUD root and drives the guide from the game's activity and
 * events, the HUD's `hud` signal and the camera. Call once, after the HUD.
 */
export function mountGuide(root: HTMLElement, ctx: FarmContext): void {
  const { game } = ctx;
  const count = h('span', { class: 'guide-count', 'data-testid': 'guide-count' });
  const title = h('span', { class: 'guide-title' });
  const text = h('p', { class: 'guide-text', 'data-testid': 'guide-text' });
  const next = h('button', { type: 'button', class: 'btn guide-next', 'data-testid': 'guide-next', onclick: () => act(() => nextStep(game)) }, 'Next ›');
  const end = h(
    'button',
    { type: 'button', class: 'btn btn-secondary guide-end', 'data-testid': 'guide-end', onclick: () => act(() => endGuide(game)) },
    '✕ End guide',
  );
  // On a phone the card is a strip: the head opens and closes the text.
  const head = h(
    'button',
    {
      type: 'button',
      class: 'guide-head',
      'data-testid': 'guide-toggle',
      'aria-expanded': 'false',
      onclick: () => {
        const open = !card.classList.contains('expanded');
        card.classList.toggle('expanded', open);
        head.setAttribute('aria-expanded', String(open));
      },
    },
    h('span', { class: 'guide-icon', 'aria-hidden': 'true' }, '🧭'),
    h('span', { class: 'guide-heading' }, count, title),
    h('span', { class: 'guide-chevron', 'aria-hidden': 'true' }, '▾'),
  );
  const card = h(
    'aside',
    { class: 'guide-card', role: 'region', 'aria-label': 'Guide', 'aria-live': 'polite', 'data-testid': 'guide-card', hidden: true },
    head,
    text,
    h('div', { class: 'guide-actions' }, end, next),
  );
  const ring = h('div', { class: 'guide-ring', 'data-testid': 'guide-ring', 'aria-hidden': 'true', hidden: true });
  const marker = h('div', { class: 'guide-marker', 'data-testid': 'guide-marker', 'aria-hidden': 'true', hidden: true });
  // The marker lies on the map, under the whole HUD; the card and ring sit over the HUD, under the menu and dialogs.
  root.prepend(marker);
  root.append(card, ring);

  let hud: HudView | null = null;
  let shownStep = '';
  let markerAt: { x: number; y: number } | null = null;
  let frame = 0;
  /** The element the ring went round last frame. */
  let ringed: HTMLElement | null = null;

  const render = () => {
    const step = currentStep(game);
    card.hidden = !step;
    document.body.toggleAttribute('data-guide', !!step);
    if (!step) {
      shownStep = '';
      ring.hidden = true;
      marker.hidden = true;
      markerAt = null;
      cancelAnimationFrame(frame);
      frame = 0;
      return;
    }
    const { index, total } = guideInfo(game);
    if (shownStep !== step.id) {
      shownStep = step.id;
      card.dataset.step = step.id;
      count.textContent = `Step ${index} of ${total}`;
      title.replaceChildren(...withIcons(step.title));
      text.replaceChildren(...withIcons(step.text));
      next.textContent = index === total ? 'Finish' : 'Next ›';
      // A new step on a phone shows its text once; a tap folds it away.
      card.classList.add('expanded');
      head.setAttribute('aria-expanded', 'true');
    }
    card.toggleAttribute('data-sheet', !!hud?.sheet);
    card.toggleAttribute('data-build', !!hud?.build.open);
    findMarker();
    if (!frame) frame = requestAnimationFrame(follow);
  };

  const findMarker = () => {
    const target = currentStep(game)?.map;
    markerAt = target ? markerTile(ctx, target) : null;
  };

  /** Every frame while the guide is on: the ring follows its target and the marker its field. */
  const follow = () => {
    frame = 0;
    const step = currentStep(game);
    if (!step) return;
    const normal = ctx.tools.mode.kind === 'normal';
    const target = normal ? findTarget(root, step) : null;
    if (target && target !== ringed) {
      // A panel action below the fold: bring it into view once.
      if (target.closest('.sheet-body')) target.scrollIntoView({ block: 'nearest' });
    }
    ringed = target;
    if (target) {
      const r = target.getBoundingClientRect();
      ring.style.transform = `translate(${Math.round(r.left - 5)}px, ${Math.round(r.top - 5)}px)`;
      ring.style.width = `${Math.round(r.width + 10)}px`;
      ring.style.height = `${Math.round(r.height + 10)}px`;
      ring.dataset.target = target.dataset.testid ?? '';
    } else delete ring.dataset.target;
    ring.hidden = !target;
    const scene = ctx.scene as FarmScene | undefined;
    // The door stays marked while paths are laid; fields only while nothing covers the map.
    const free = step.map === 'door' ? !hud?.build.open : normal && !hud?.sheet && !hud?.build.open;
    const at = markerAt && free ? scene?.tileToScreen?.(markerAt.x, markerAt.y) : null;
    if (at) marker.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
    marker.hidden = !at;
    frame = requestAnimationFrame(follow);
  };

  function act(change: () => void): void {
    change();
    render();
  }

  const notify = (signal: GuideSignal) => {
    if (notifyGuide(game, signal)) render();
  };

  uiSignals.on('camera', () => notify({ kind: 'camera' }));
  uiSignals.on('hud', (view) => {
    const before = hud;
    hud = view;
    if (before) {
      if (view.window && view.window !== before.window) notify({ kind: 'window', id: view.window });
      if (view.speed !== before.speed || view.paused !== before.paused) notify({ kind: 'speed' });
    }
    render();
  });
  for (const name of ACTIVITIES) game.activity.on(name, (payload) => notify({ kind: 'activity', name, payload } as GuideSignal));
  for (const e of ['objectAdded', 'objectRemoved', 'objectChanged', 'inventory'] as const) game.events.on(e, () => notify({ kind: 'state' }));
  // A new or loaded farm: its own guide (off unless it was on when saved).
  game.events.on('reset', render);
  window.setInterval(() => {
    if (currentStep(game)) findMarker();
  }, MARKER_MS);

  registerDebugInfo('guide', () => Object.freeze(guideInfo(game)));
  mounted = { ctx, render };
  render();
}

/**
 * After New game: "Welcome to your farm", with Show me around and Skip the guide. The clock waits while it is open.
 */
export function offerGuide(): void {
  if (!mounted) return;
  const { ctx, render } = mounted;
  const { game } = ctx;
  const root = document.getElementById('ui') ?? document.body;
  root.querySelector('[data-testid="guide-welcome"]')?.closest('.dialog-backdrop')?.remove();
  game.paused = true;
  const close = (start: boolean) => {
    window.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    if (start) startGuide(game);
    else skipGuide(game);
    if (!document.body.dataset.menu) game.paused = false;
    render();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    close(false);
  };
  const startBtn = h('button', { type: 'button', class: 'btn', 'data-testid': 'guide-start', onclick: () => close(true) }, 'Show me around');
  const backdrop = h(
    'div',
    { class: 'dialog-backdrop' },
    h(
      'div',
      { class: 'dialog guide-welcome', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'guide-welcome-title', 'data-testid': 'guide-welcome' },
      h('div', { class: 'levelup-star', 'aria-hidden': 'true' }, '🧭'),
      h('h2', { id: 'guide-welcome-title' }, 'Welcome to your farm'),
      h(
        'p',
        {},
        ...withIcons('You start with $500, one farmer, a farmhouse and two ploughed fields. A short guide can show you around: it points the way, and the game keeps running.'),
      ),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-secondary', 'data-testid': 'guide-skip', onclick: () => close(false) }, 'Skip the guide'),
        startBtn,
      ),
    ),
  );
  window.addEventListener('keydown', onKey, true);
  root.append(backdrop);
  startBtn.focus();
}

registerSettingsSection({
  id: 'guide',
  render(ctx, body) {
    const status = h('p', { class: 'muted', 'data-testid': 'settings-guide-status' });
    const update = () => {
      const g = guideOf(ctx.game.state);
      const info = guideInfo(ctx.game);
      status.textContent = isGuideActive(g)
        ? `On step ${info.index} of ${info.total}.`
        : g.finished
          ? 'Finished on this farm.'
          : 'Off on this farm.';
    };
    update();
    body.append(
      h(
        'section',
        { class: 'guide-settings', 'data-testid': 'guide-settings' },
        h('h3', { class: 'group-title' }, '🧭 Guide'),
        status,
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-secondary',
            'data-testid': 'settings-guide-restart',
            onclick: () => {
              startGuide(ctx.game);
              mounted?.render();
              update();
              ctx.ui.toast(`🧭 The guide starts again: step 1 of ${GUIDE_STEPS.length}`, 'success');
            },
          },
          'Restart the guide',
        ),
      ),
    );
  },
});
