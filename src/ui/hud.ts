import { getBuildable, listBuildMenu } from '../data/buildables';
import { getItem, ITEM_LIST } from '../data/items';
import { formatMaterials, formatMissing, isMaterial } from '../data/materials';
import { SEASON_DAYS, SEASON_INFO } from '../data/seasons';
import type { ConfirmOptions, FarmContext, PanelBuilder, PanelSpec, SheetSpec, ToolMode, UiApi } from '../game/context';
import { listHudButtons, listSettingsSections } from '../game/hooks';
import { uiSignals } from '../game/signals';
import { timeOfDay } from '../logic/clock';
import { DEMOLISH_REFUND } from '../logic/constants';
import type { GameEvents } from '../logic/game';
import { dayOfSeason, seasonOf } from '../logic/seasons';
import { buildableUnlockLevel } from '../logic/unlocks';
import type { FarmScene } from '../scenes/FarmScene';
import { h, formatMoney } from './dom';
import { itemIcon, packIcon, withIcons } from './icons';

const REFRESH_MS = 250;

/** The HTML overlay: top bar, side sheet (menus and action panels), tool banner, toasts and dialogs. */
export class Hud implements UiApi {
  private readonly ctx: FarmContext;
  private moneyEl!: HTMLElement;
  private moneyValueEl!: HTMLElement;
  private dayEl!: HTMLElement;
  private dayBarEl!: HTMLElement;
  private dayStatEl!: HTMLElement;
  private seasonIconEl!: HTMLElement;
  private seasonEl!: HTMLElement;
  private levelEl!: HTMLElement;
  private xpEl!: HTMLElement;
  private xpBarEl!: HTMLElement;
  private sheetEl!: HTMLElement;
  private sheetTitleEl!: HTMLElement;
  private sheetBodyEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private toastsEl!: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private badges: { el: HTMLElement; read: () => number | null }[] = [];
  private liveButtons: { btn: HTMLButtonElement; read: () => { icon: string; label: string } }[] = [];
  private sheet: SheetSpec | null = null;
  private sheetSignature = '';

  constructor(
    private readonly root: HTMLElement,
    ctx: FarmContext,
    private readonly onNewGame: () => void,
  ) {
    this.ctx = ctx;
    this.build();
    const { events } = ctx.game;
    events.on('money', ({ delta }) => {
      this.updateStats();
      this.floatMoney(delta);
      this.refresh();
    });
    events.on('levelUp', (e) => this.showLevelUp(e));
    for (const e of ['inventory', 'objectAdded', 'objectRemoved', 'objectChanged', 'land', 'day', 'speed', 'xp', 'goals'] as const) {
      events.on(e, () => this.refresh());
    }
    events.on('reset', () => {
      this.ctx.tools.cancel();
      this.closePanel();
      this.updateStats();
    });
    ctx.tools.events.on('change', (mode) => this.onToolChange(mode));
    window.setInterval(() => this.refresh(), REFRESH_MS);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.querySelector('.dialog-backdrop')) this.closePanel();
    });
    this.updateStats();
  }

  // Layout ----------------------------------------------------------------------

  private build(): void {
    this.moneyValueEl = h('span', { class: 'stat-value', 'data-testid': 'hud-money' });
    this.moneyEl = h('div', { class: 'stat stat-money', title: 'Money' }, packIcon('coins', 'stat-icon'), this.moneyValueEl);
    this.dayEl = h('span', { class: 'stat-value', 'data-testid': 'hud-day' });
    this.dayBarEl = h('span', { class: 'day-bar-fill' });
    this.seasonIconEl = h('span', { 'aria-hidden': 'true' });
    this.seasonEl = h('span', { class: 'season-text', 'data-testid': 'hud-season' });
    this.dayStatEl = h(
      'div',
      { class: 'stat stat-day', title: 'Day' },
      this.seasonIconEl,
      h(
        'span',
        { class: 'day-text' },
        h('span', { class: 'level-line' }, this.dayEl, this.seasonEl),
        h('span', { class: 'day-bar', 'aria-hidden': 'true' }, this.dayBarEl),
      ),
    );
    const day = this.dayStatEl;

    this.levelEl = h('span', { class: 'stat-value', 'data-testid': 'hud-level' });
    this.xpEl = h('span', { class: 'xp-text', 'data-testid': 'hud-xp' });
    this.xpBarEl = h('span', { class: 'day-bar-fill xp-bar-fill', 'data-testid': 'hud-xp-bar' });
    const level = h(
      'div',
      { class: 'stat stat-level', title: 'Farm level' },
      h('span', { 'aria-hidden': 'true' }, '⭐'),
      h(
        'span',
        { class: 'day-text' },
        h('span', { class: 'level-line' }, this.levelEl, this.xpEl),
        h('span', { class: 'day-bar', 'aria-hidden': 'true' }, this.xpBarEl),
      ),
    );

    const tools = h('nav', { class: 'hud-buttons', 'aria-label': 'Farm tools' });
    const addButton = (id: string, icon: string, label: string, onClick: () => void) => {
      const btn = h(
        'button',
        { class: 'hud-btn', type: 'button', 'data-testid': `btn-${id}`, 'aria-label': label, title: label, onclick: onClick },
        h('span', { class: 'hud-btn-icon', 'aria-hidden': 'true' }, icon),
        h('span', { class: 'hud-btn-label' }, label),
      );
      this.buttons.set(id, btn);
      tools.append(btn);
    };
    addButton('build', '🔨', 'Build', () => this.toggleSheet(this.buildSheet()));
    addButton('demolish', '🧹', 'Demolish', () => {
      const tools = this.ctx.tools;
      if (tools.mode.kind === 'demolish') tools.cancel();
      else {
        this.closePanel();
        tools.set({ kind: 'demolish' });
      }
    });
    addButton('inventory', '🎒', 'Inventory', () => this.toggleSheet(this.inventorySheet()));
    for (const b of listHudButtons()) {
      addButton(b.id, b.icon ?? '•', b.label, () => b.onClick(this.ctx));
      if (b.badge) {
        const el = h('span', { class: 'hud-badge', 'data-testid': `badge-${b.id}`, hidden: true });
        this.buttons.get(b.id)!.append(el);
        this.badges.push({ el, read: () => b.badge!(this.ctx) });
      }
      if (b.live) this.liveButtons.push({ btn: this.buttons.get(b.id)!, read: () => b.live!(this.ctx) });
    }
    addButton('settings', '⚙️', 'Settings', () => this.toggleSheet(this.settingsSheet()));

    const topbar = h('header', { class: 'topbar' }, h('div', { class: 'stats' }, this.moneyEl, day, level), tools);

    this.sheetTitleEl = h('h2', { class: 'sheet-title', id: 'sheet-title', 'data-testid': 'panel-title' });
    this.sheetBodyEl = h('div', { class: 'sheet-body' });
    this.sheetEl = h(
      'section',
      { class: 'sheet', role: 'dialog', 'aria-labelledby': 'sheet-title', 'data-testid': 'panel', hidden: true },
      h(
        'div',
        { class: 'sheet-head' },
        this.sheetTitleEl,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', 'data-testid': 'panel-close', onclick: () => this.closePanel() }, '✕'),
      ),
      this.sheetBodyEl,
    );

    this.bannerEl = h('div', { class: 'tool-banner', 'data-testid': 'tool-banner', hidden: true });
    this.toastsEl = h('div', { class: 'toasts', 'aria-live': 'polite', 'data-testid': 'toasts' });

    this.root.append(topbar, this.sheetEl, this.bannerEl, this.toastsEl);
  }

  private updateStats(): void {
    this.moneyValueEl.textContent = formatMoney(this.ctx.game.money);
    const { game } = this.ctx;
    const dayText = `Day ${game.day}`;
    if (this.dayEl.textContent !== dayText) this.dayEl.textContent = dayText;
    const season = SEASON_INFO[seasonOf(game.state.clock)];
    if (this.seasonEl.textContent !== season.name) {
      this.seasonEl.textContent = season.name;
      this.seasonIconEl.textContent = season.icon;
    }
    const seasonTitle = `Day ${game.day} · ${season.name}, day ${dayOfSeason(game.state.clock)} of ${SEASON_DAYS}`;
    if (this.dayStatEl.title !== seasonTitle) this.dayStatEl.title = seasonTitle;
    this.dayBarEl.style.width = `${(timeOfDay(game.state.clock) * 100).toFixed(1)}%`;

    const { level, xpIntoLevel, xpForNext } = game.progression.info;
    this.levelEl.textContent = `Lv ${level}`;
    this.xpEl.textContent = xpForNext === null ? 'MAX' : `${Math.floor(xpIntoLevel)}/${xpForNext}`;
    this.xpBarEl.style.width = `${xpForNext === null ? 100 : Math.min(100, (xpIntoLevel / xpForNext) * 100).toFixed(1)}%`;
    for (const { el, read } of this.badges) {
      const n = read();
      const text = n ? String(n) : '';
      if (el.textContent !== text) el.textContent = text;
      el.hidden = !n;
    }
    for (const { btn, read } of this.liveButtons) {
      const { icon, label } = read();
      const iconEl = btn.querySelector('.hud-btn-icon')!;
      if (iconEl.textContent !== icon) iconEl.textContent = icon;
      if (btn.title !== label) {
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.querySelector('.hud-btn-label')!.textContent = label;
      }
    }
  }

  /** Re-renders whatever depends on game state. Cheap; called on events and on a timer. */
  refresh(): void {
    this.updateStats();
    if (!this.sheet) return;
    const sig = this.sheet.signature();
    // Rebuilding the body would close a drop-down the player has open: wait until it loses focus.
    const picking = document.activeElement instanceof HTMLSelectElement && this.sheetBodyEl.contains(document.activeElement);
    if (sig !== this.sheetSignature && !picking) {
      this.sheetSignature = sig;
      this.sheetTitleEl.replaceChildren(...withIcons(this.sheet.title()));
      this.sheetBodyEl.replaceChildren();
      this.sheet.render(this.sheetBodyEl);
    }
    this.sheet?.tick?.(this.sheetBodyEl);
  }

  // Sheets ----------------------------------------------------------------------

  private showSheet(sheet: SheetSpec): void {
    this.sheet = sheet;
    this.sheetSignature = '';
    this.sheetEl.hidden = false;
    this.sheetEl.dataset.sheet = sheet.id;
    for (const [id, btn] of this.buttons) btn.classList.toggle('active', id === sheet.id);
    this.refresh();
  }

  toggleSheet(sheet: SheetSpec): void {
    if (this.sheet?.id === sheet.id) this.closePanel();
    else this.showSheet(sheet);
  }

  closePanel(): void {
    if (!this.sheet) return;
    this.sheet = null;
    this.sheetEl.hidden = true;
    this.sheetBodyEl.replaceChildren();
    for (const [id, btn] of this.buttons) if (id !== 'demolish') btn.classList.remove('active');
  }

  openPanel(build: PanelBuilder): void {
    let spec: PanelSpec | null = build();
    if (!spec) return;
    const progressOf = (s: PanelSpec) => Math.max(0, Math.min(1, s.progress?.value ?? 0));
    this.showSheet({
      id: 'action',
      title: () => (spec ? `${spec.icon ? `${spec.icon} ` : ''}${spec.title}` : ''),
      signature: () => {
        spec = build();
        if (!spec) {
          queueMicrotask(() => this.closePanel());
          return 'closed';
        }
        // Progress is updated in place by tick(); everything else rebuilds the body.
        return JSON.stringify({ ...spec, progress: spec.progress ? spec.progress.label ?? true : null });
      },
      render: (body) => {
        if (!spec) return;
        const current = spec;
        if (current.lines?.length) {
          body.append(h('ul', { class: 'status-lines', 'data-testid': 'panel-lines' }, current.lines.map((l) => h('li', {}, withIcons(l)))));
        }
        if (current.progress) {
          body.append(
            h(
              'div',
              { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'data-testid': 'panel-progress' },
              h('div', { class: 'progress-fill' }),
              current.progress.label ? h('span', { class: 'progress-label' }, current.progress.label) : null,
            ),
          );
        }
        for (const [i, c] of (current.choices ?? []).entries()) {
          const select = h(
            'select',
            {
              id: `panel-choice-${c.id}`,
              'data-testid': `panel-choice-${c.id}`,
              onchange: () => {
                spec?.choices?.[i]?.onChange(select.value);
                select.blur();
                this.refresh();
              },
            },
            c.options.map((o) => h('option', { value: o.value, selected: o.value === c.value, disabled: !!o.disabled }, o.label)),
          );
          body.append(h('label', { class: 'panel-choice', for: `panel-choice-${c.id}` }, h('span', {}, ...withIcons(c.label)), select));
        }
        if (current.actions?.length) {
          body.append(
            h(
              'div',
              { class: 'actions' },
              current.actions.map((a, i) =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: `btn btn-${a.variant ?? 'primary'}`,
                    disabled: !!a.disabled,
                    'data-testid': `panel-action-${i}`,
                    // Look the action up again at click time so the handler is never stale.
                    onclick: () => {
                      const action = spec?.actions?.[i];
                      if (action && !action.disabled) action.onClick();
                      this.refresh();
                    },
                  },
                  withIcons(a.label),
                ),
              ),
            ),
          );
        }
      },
      tick: (body) => {
        const bar = body.querySelector<HTMLElement>('.progress');
        if (!bar || !spec) return;
        const pct = Math.round(progressOf(spec) * 100);
        bar.setAttribute('aria-valuenow', String(pct));
        bar.querySelector<HTMLElement>('.progress-fill')!.style.transform = `scaleX(${pct / 100})`;
      },
    });
  }

  private buildSheet(): SheetSpec {
    const { game, tools } = this.ctx;
    return {
      id: 'build',
      title: () => '🔨 Build',
      signature: () =>
        `${game.level}|${listBuildMenu()
          .map((b) => `${b.id}:${game.canAfford(b.cost)}:${JSON.stringify(game.missingMaterials(b.materials))}`)
          .join('|')}`,
      render: (body) => {
        const groups = new Map<string, ReturnType<typeof listBuildMenu>>();
        for (const b of listBuildMenu()) {
          const key = b.category ?? 'other';
          groups.set(key, [...(groups.get(key) ?? []), b]);
        }
        for (const [category, defs] of groups) {
          body.append(
            h('h3', { class: 'group-title' }, category),
            h(
              'div',
              { class: 'build-list' },
              defs.map((b) => {
                const unlockLevel = buildableUnlockLevel(b.id);
                const locked = !game.isUnlocked(unlockLevel);
                const shortMoney = !game.canAfford(b.cost);
                const missing = game.missingMaterials(b.materials);
                // What stands between the player and building it, e.g. "Needs $40 more and 4 more 🪵 Wood".
                const needs = [shortMoney ? `${formatMoney(b.cost - game.money)} more` : '', formatMissing(missing)].filter(Boolean).join(' and ');
                const materials = formatMaterials(b.materials);
                return h(
                  'button',
                  {
                    type: 'button',
                    class: `build-item${locked ? ' locked' : ''}`,
                    disabled: locked || shortMoney || missing.length > 0,
                    'data-testid': `build-${b.id}`,
                    'data-locked': locked ? String(unlockLevel) : undefined,
                    onclick: () => {
                      this.closePanel();
                      tools.set({ kind: 'build', type: b.id });
                    },
                  },
                  h('span', { class: 'build-name' }, `${locked ? '🔒 ' : ''}${b.name}`),
                  h('span', { class: 'build-meta' }, `${b.footprint.w}×${b.footprint.h}`),
                  h('span', { class: 'build-cost', 'data-testid': `build-cost-${b.id}` }, formatMoney(b.cost)),
                  materials ? h('span', { class: 'build-materials', 'data-testid': `build-materials-${b.id}` }, withIcons(materials)) : null,
                  locked
                    ? h('span', { class: 'build-desc lock-note' }, `Unlocks at level ${unlockLevel}`)
                    : needs
                      ? h('span', { class: 'build-desc needs-note', 'data-testid': `build-needs-${b.id}` }, withIcons(`Needs ${needs}${missing.length ? ' — buy at the 🏪 Market' : ''}`))
                      : b.description
                        ? h('span', { class: 'build-desc' }, b.description)
                        : null,
                );
              }),
            ),
          );
        }
      },
    };
  }

  private inventorySheet(): SheetSpec {
    const { game } = this.ctx;
    return {
      id: 'inventory',
      title: () => '🎒 Inventory',
      signature: () => JSON.stringify(game.state.inventory),
      render: (body) => {
        const known = new Set(ITEM_LIST.map((i) => i.id));
        const ids = [...ITEM_LIST.map((i) => i.id), ...Object.keys(game.state.inventory).filter((id) => !known.has(id))];
        const rows = ids.filter((id) => game.count(id) > 0);
        if (!rows.length) {
          body.append(h('p', { class: 'empty' }, 'Your barn is empty. Grow crops and raise animals to fill it.'));
          return;
        }
        const list = (testId: string, group: string[]) =>
          h(
            'ul',
            { class: 'inventory-list', 'data-testid': testId },
            group.map((id) => {
              const item = getItem(id);
              return h(
                'li',
                { class: 'inventory-item', 'data-testid': `inv-${id}` },
                itemIcon(id),
                h('span', { class: 'item-name' }, item?.name ?? id),
                h('span', { class: 'item-count' }, `×${game.count(id)}`),
              );
            }),
          );
        const goods = rows.filter((id) => !isMaterial(id));
        const materials = rows.filter(isMaterial);
        if (goods.length) body.append(list('inventory-list', goods));
        if (materials.length) {
          body.append(h('h3', { class: 'group-title' }, 'Building materials'), list('inventory-materials', materials));
        }
      },
    };
  }

  private settingsSheet(): SheetSpec {
    return {
      id: 'settings',
      title: () => '⚙️ Settings',
      signature: () => 'settings',
      render: (body) => {
        for (const section of listSettingsSections()) section.render(this.ctx, body);
        body.append(
          h('p', { class: 'muted' }, 'Your farm is saved automatically in this browser.'),
          h(
            'div',
            { class: 'actions' },
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-danger',
                'data-testid': 'btn-new-game',
                onclick: async () => {
                  const ok = await this.confirm('Start a new game?', 'Your current farm, money and items will be lost.', { confirmLabel: 'New game' });
                  if (ok) {
                    this.onNewGame();
                    this.toast('A fresh start! Welcome to your new farm.', 'success');
                  }
                },
              },
              'New game',
            ),
          ),
        );
      },
    };
  }

  // Tools -----------------------------------------------------------------------

  private onToolChange(mode: ToolMode): void {
    this.buttons.get('demolish')?.classList.toggle('active', mode.kind === 'demolish');
    this.buttons.get('build')?.classList.toggle('active', mode.kind === 'build' || this.sheet?.id === 'build');
    document.body.dataset.tool = mode.kind;
    if (mode.kind === 'normal') {
      this.bannerEl.hidden = true;
      return;
    }
    let text: string;
    if (mode.kind === 'build') {
      const def = getBuildable(mode.type);
      const materials = formatMaterials(def?.materials);
      text = `Placing ${def?.name ?? mode.type} (${formatMoney(def?.cost ?? 0)}${materials ? ` + ${materials}` : ''}) — tap a tile`;
    } else {
      text = `Demolish — tap an object to remove it (${Math.round(DEMOLISH_REFUND * 100)}% of money and materials back)`;
    }
    this.bannerEl.replaceChildren(
      h('span', {}, withIcons(text)),
      h('button', { type: 'button', class: 'btn btn-secondary', 'data-testid': 'btn-cancel-tool', onclick: () => this.ctx.tools.cancel() }, 'Cancel'),
    );
    this.bannerEl.hidden = false;
  }

  // Feedback --------------------------------------------------------------------

  toast(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
    if (kind === 'error') uiSignals.emit('refused', { message });
    const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status', 'data-testid': 'toast' }, withIcons(message));
    this.toastsEl.append(el);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstElementChild?.remove();
    window.setTimeout(() => el.classList.add('leaving'), 2200);
    window.setTimeout(() => el.remove(), 2600);
  }

  floatText(tileX: number, tileY: number, text: string, color?: string): void {
    (this.ctx.scene as FarmScene | undefined)?.floatText?.(tileX, tileY, text, color);
  }

  private floatMoney(delta: number): void {
    if (!delta) return;
    const el = h('span', { class: `money-float ${delta > 0 ? 'gain' : 'loss'}`, 'aria-hidden': 'true' }, `${delta > 0 ? '+' : '-'}${formatMoney(Math.abs(delta))}`);
    this.moneyEl.append(el);
    window.setTimeout(() => el.remove(), 1200);
  }

  /** "Level N!" popup listing what just unlocked. Several level-ups stack; the newest is on top. */
  private showLevelUp({ level, bonus, unlocks }: GameEvents['levelUp']): void {
    const close = () => {
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Escape' || e.key === 'Enter') && this.root.lastElementChild === backdrop) {
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    };
    const ok = h('button', { type: 'button', class: 'btn', 'data-testid': 'levelup-ok', onclick: close }, 'Great!');
    const backdrop = h(
      'div',
      { class: 'dialog-backdrop' },
      h(
        'div',
        { class: 'dialog levelup', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': `levelup-${level}`, 'data-testid': 'levelup-dialog' },
        h('div', { class: 'levelup-star', 'aria-hidden': 'true' }, '⭐'),
        h('h2', { id: `levelup-${level}` }, `Level ${level}!`),
        h('p', { 'data-testid': 'levelup-bonus' }, `Your farm grew. Bonus: ${formatMoney(bonus)}`),
        unlocks.length
          ? [
              h('h3', { class: 'group-title' }, 'Unlocked'),
              h(
                'ul',
                { class: 'unlock-list', 'data-testid': 'levelup-unlocks' },
                unlocks.map((u) => h('li', {}, h('span', { 'aria-hidden': 'true' }, withIcons(u.icon)), ` ${u.name}`)),
              ),
            ]
          : null,
        h('div', { class: 'actions' }, ok),
      ),
    );
    window.addEventListener('keydown', onKey, true);
    this.root.append(backdrop);
    ok.focus();
  }

  /** Modal confirm dialog. Resolves true when confirmed. */
  confirm(title: string, message: string, { confirmLabel = 'OK', variant = 'danger', disabled, hint }: ConfirmOptions = {}): Promise<boolean> {
    return new Promise((resolve) => {
      const close = (result: boolean) => {
        window.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(result);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(false);
        }
      };
      const confirmBtn = h(
        'button',
        { type: 'button', class: `btn btn-${variant}`, 'data-testid': 'confirm-ok', disabled: !!disabled, onclick: () => close(true) },
        confirmLabel,
      );
      const cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary', 'data-testid': 'confirm-cancel', onclick: () => close(false) }, 'Cancel');
      const backdrop = h(
        'div',
        { class: 'dialog-backdrop' },
        h(
          'div',
          { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title', 'data-testid': 'confirm-dialog' },
          h('h2', { id: 'dialog-title' }, title),
          h('p', { 'data-testid': 'confirm-message' }, withIcons(message)),
          hint ? h('p', { class: 'dialog-hint', 'data-testid': 'confirm-hint' }, hint) : null,
          h('div', { class: 'actions' }, cancelBtn, confirmBtn),
        ),
      );
      window.addEventListener('keydown', onKey, true);
      this.root.append(backdrop);
      (disabled ? cancelBtn : confirmBtn).focus();
    });
  }
}
