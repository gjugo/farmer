import { CROP_LIST } from '../data/crops';
import { getBuildable } from '../data/buildables';
import { formatMaterials } from '../data/materials';
import { SEASON_DAYS, SEASON_INFO } from '../data/seasons';
import type { ConfirmOptions, FarmContext, PanelBuilder, PanelSpec, SheetSpec, ToolMode, UiApi } from '../game/context';
import { listHotkeys, listHudButtons, registerDebugInfo, type HudButton, type HudSpot, type HudWindowId } from '../game/hooks';
import { uiSignals, type HudView } from '../game/signals';
import { timeOfDay } from '../logic/clock';
import { DEMOLISH_REFUND } from '../logic/constants';
import { seasonCheck } from '../logic/crops';
import type { GameEvents } from '../logic/game';
import { dayOfSeason, seasonOf } from '../logic/seasons';
import { unlocksAt } from '../logic/unlocks';
import type { FarmScene } from '../scenes/FarmScene';
import { BuildMenu } from './buildmenu';
import { h, formatMoney } from './dom';
import { packIcon, withIcons } from './icons';
import { ResourceBar } from './resources';
import { Tip } from './tip';

const REFRESH_MS = 250;

/** The player's clock speeds (⏸ apart), like Manor Lords': ×1, ×4 and ×12. Not saved: a load starts at ×1. */
export const HUD_SPEEDS = [1, 4, 12] as const;

/** Toasts kept in 🕮 Recent events. */
const EVENTS_KEPT = 30;

/** The HUD's windows: the tool bar opens Farm, Trade and the Almanac, the level opens Development. */
const WINDOWS: Record<HudWindowId, { title: string; icon: string; key?: string }> = {
  development: { title: 'Development', icon: '⭐' },
  farm: { title: 'Farm', icon: '👪', key: 'F' },
  trade: { title: 'Trade', icon: '⚖️', key: 'T' },
  almanac: { title: 'Almanac', icon: '📖', key: 'H' },
};

type Spot<K extends HudSpot['kind']> = HudButton & { spot: Extract<HudSpot, { kind: K }> };

interface Tab {
  def: Spot<'tab'>;
  btn: HTMLButtonElement;
  badge: HTMLElement;
  shown: boolean;
  count: number;
}

interface Chip {
  def: Spot<'chip'>;
  btn: HTMLButtonElement;
  icon: HTMLElement;
  value: HTMLElement;
}

interface Banner {
  def: Spot<'banner'>;
  btn: HTMLButtonElement;
  icon: HTMLElement;
  text: HTMLElement;
}

/** A toast as 🕮 Recent events lists it. */
interface LoggedEvent {
  day: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

/** Count badge on a button; hidden at 0. */
function setBadge(el: HTMLElement, n: number): void {
  const text = n ? String(n) : '';
  if (el.textContent !== text) el.textContent = text;
  el.hidden = !n;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/**
 * The HTML overlay, laid out like Manor Lords' HUD: the farm overview (A) top left, the level with notices and recent
 * events (B) top centre, the resource bar (D) and money (E) top right, the season and speed (F) bottom right, and the
 * tool bar (G) bottom centre with the construction menu above it. Windows (Development, Farm, Trade, Almanac) and the
 * action panel of a clicked object share one sheet: right-hand on a desktop, a bottom sheet on a phone. Features add
 * their tabs, overview chips and banners with `registerHudButton`; this file names none of them.
 */
export class Hud implements UiApi {
  private readonly ctx: FarmContext;
  readonly tip = new Tip();
  private moneyEl!: HTMLElement;
  private moneyValueEl!: HTMLElement;
  private dayEl!: HTMLElement;
  private dayBarEl!: HTMLElement;
  private seasonEl!: HTMLButtonElement;
  private seasonIconEl!: HTMLElement;
  private seasonNameEl!: HTMLElement;
  private levelBtn!: HTMLButtonElement;
  private levelEl!: HTMLElement;
  private xpEl!: HTMLElement;
  private xpBarEl!: HTMLElement;
  private eventsBtn!: HTMLButtonElement;
  private eventsPop!: HTMLElement;
  private eventsSig = '';
  private readonly log: LoggedEvent[] = [];
  private speedButtons = new Map<string, HTMLButtonElement>();
  /** Open perk dialogs by level: each re-renders its cards when the perks change, and closes when its choice is made. */
  private perkDialogs = new Map<number, { refresh: () => void; close: () => void }>();
  private resources!: ResourceBar;
  private buildMenu!: BuildMenu;
  private sheetEl!: HTMLElement;
  private sheetTitleEl!: HTMLElement;
  private sheetTabsEl!: HTMLElement;
  private sheetBodyEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private toastsEl!: HTMLElement;
  /** Tool bar buttons by id (`paths`, `build`, `farm`, `trade`, `almanac`, `menu`), and the window buttons' badges. */
  private tools = new Map<string, HTMLButtonElement>();
  private windowBadges = new Map<HudWindowId, HTMLElement>();
  private tabs: Tab[] = [];
  private chips: Chip[] = [];
  private banners: Banner[] = [];
  private sheet: SheetSpec | null = null;
  private sheetSignature = '';
  /** The window on show (null for the action panel or another sheet) and the tab each window showed last. */
  private win: { id: HudWindowId; tab: string } | null = null;
  private tabsShown = '';
  private lastTab = new Map<HudWindowId, string>();
  /** The tool was picked in the construction menu: stepping back (Esc, Cancel) returns to it. */
  private toolFromMenu = false;
  /** The last view announced with the `hud` signal. */
  private viewSig = '';

  constructor(
    private readonly root: HTMLElement,
    ctx: FarmContext,
    /** Opens the pause menu (⚙️ Menu). */
    private readonly onMenu: () => void,
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
    events.on('perks', () => {
      for (const d of [...this.perkDialogs.values()]) d.refresh();
      this.refresh();
    });
    for (const e of ['inventory', 'objectAdded', 'objectRemoved', 'objectChanged', 'day', 'speed', 'xp', 'goals'] as const) {
      events.on(e, () => this.refresh());
    }
    events.on('reset', () => {
      for (const d of [...this.perkDialogs.values()]) d.close();
      this.closeAll();
      // A new or loaded farm starts running, at ×1 (the load resets the speed).
      ctx.game.playerPaused = false;
      this.resources.reset();
      this.updateStats();
    });
    ctx.tools.events.on('change', (mode) => this.onToolChange(mode));
    window.setInterval(() => this.refresh(), REFRESH_MS);
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.eventsPop.hidden && !this.eventsPop.contains(e.target as Node) && !this.eventsBtn.contains(e.target as Node)) this.eventsPop.hidden = true;
      },
      true,
    );
    registerDebugInfo('hud', () =>
      Object.freeze({
        ...this.view(),
        build: Object.freeze({ open: this.buildMenu.open, category: this.buildMenu.category }),
        banners: Object.freeze(this.banners.filter((b) => !b.btn.hidden).map((b) => b.def.id)),
      }),
    );
    this.updateStats();
  }

  // Layout ----------------------------------------------------------------------

  private build(): void {
    const { tip } = this;

    // A: the farm overview.
    const overview = h('div', { class: 'hud-a', role: 'group', 'aria-label': 'Farm overview', 'data-testid': 'hud-overview' });
    for (const def of listHudButtons('chip')) {
      const icon = h('span', { class: 'chip-icon', 'aria-hidden': 'true' }, withIcons(def.icon ?? '•'));
      const value = h('span', { class: 'chip-value' });
      const btn = h('button', { type: 'button', class: 'stat-chip', 'data-testid': `stat-${def.id}` }, icon, value);
      const opens = def.spot.opens;
      tip.attach(
        btn,
        () => ({ title: `${def.icon ? `${def.icon} ` : ''}${def.label}`, lines: def.spot.detail?.(this.ctx) }),
        opens ? () => this.openTab(opens) : undefined,
      );
      this.chips.push({ def, btn, icon, value });
      overview.append(btn);
    }

    // B: the level, recent events and the notices under them.
    this.levelEl = h('span', { class: 'level-value', 'data-testid': 'hud-level' });
    this.xpEl = h('span', { class: 'xp-text', 'data-testid': 'hud-xp' });
    this.xpBarEl = h('span', { class: 'day-bar-fill xp-bar-fill', 'data-testid': 'hud-xp-bar' });
    const devBadge = h('span', { class: 'hud-badge', 'data-testid': 'badge-development', hidden: true });
    this.windowBadges.set('development', devBadge);
    this.levelBtn = h(
      'button',
      { type: 'button', class: 'hud-level', 'data-testid': 'btn-level', 'aria-label': 'Farm level: Development' },
      h('span', { class: 'level-star', 'aria-hidden': 'true' }, '⭐'),
      h('span', { class: 'day-text' }, h('span', { class: 'level-line' }, this.levelEl, this.xpEl), h('span', { class: 'day-bar', 'aria-hidden': 'true' }, this.xpBarEl)),
      devBadge,
    );
    tip.attach(this.levelBtn, () => this.levelTip(), () => this.toggleWindow('development'));
    this.eventsPop = h('div', { class: 'events-pop', role: 'region', 'aria-label': 'Recent events', 'data-testid': 'events-pop', hidden: true });
    this.eventsBtn = h(
      'button',
      { type: 'button', class: 'events-btn', 'data-testid': 'events-log', 'aria-label': 'Recent events', title: 'Recent events', onclick: () => this.toggleEvents() },
      '🕮',
    );
    const bannerRow = h('div', { class: 'hud-banners', 'aria-live': 'polite', 'data-testid': 'hud-banners' });
    for (const def of listHudButtons('banner')) {
      const icon = h('span', { class: 'banner-icon', 'aria-hidden': 'true' });
      const text = h('span', { class: 'banner-text' }, def.label);
      const opens = def.spot.opens;
      const btn = h(
        'button',
        { type: 'button', class: 'hud-banner', 'data-testid': `banner-${def.id}`, hidden: true, onclick: () => opens && this.openTab(opens) },
        icon,
        text,
      );
      this.banners.push({ def, btn, icon, text });
      bannerRow.append(btn);
    }
    const centre = h('div', { class: 'hud-b' }, h('div', { class: 'hud-b-row' }, this.levelBtn, this.eventsBtn), bannerRow, this.eventsPop);

    // D and E: the resource bar and the money.
    this.resources = new ResourceBar(this.ctx.game);
    this.moneyValueEl = h('span', { class: 'stat-value', 'data-testid': 'hud-money' });
    this.moneyEl = h('div', { class: 'stat stat-money', title: 'Money' }, packIcon('coins', 'stat-icon'), this.moneyValueEl);
    const right = h('div', { class: 'hud-de' }, this.resources.el, this.moneyEl);

    const top = h('header', { class: 'hud-top topbar' }, overview, centre, right);

    // F: the season and day, and the speed.
    this.seasonIconEl = h('span', { class: 'season-icon', 'aria-hidden': 'true' });
    this.seasonNameEl = h('span', { class: 'season-text', 'data-testid': 'hud-season' });
    this.dayEl = h('span', { class: 'stat-value', 'data-testid': 'hud-day' });
    this.dayBarEl = h('span', { class: 'day-bar-fill' });
    this.seasonEl = h(
      'button',
      { type: 'button', class: 'hud-season', 'data-testid': 'btn-season' },
      this.seasonIconEl,
      h('span', { class: 'day-text' }, h('span', { class: 'level-line' }, this.dayEl, this.seasonNameEl), h('span', { class: 'day-bar', 'aria-hidden': 'true' }, this.dayBarEl)),
    );
    tip.attach(this.seasonEl, () => this.seasonTip());
    const speed = h('div', { class: 'hud-speed', role: 'group', 'aria-label': 'Game speed' });
    const speedBtn = (id: string, icon: string, label: string, run: () => void) => {
      const btn = h('button', { type: 'button', class: 'speed-btn', 'data-testid': `speed-${id}`, 'aria-label': label, title: label, 'aria-pressed': 'false', onclick: run }, icon);
      this.speedButtons.set(id, btn);
      speed.append(btn);
    };
    speedBtn('pause', '⏸', 'Pause (Space)', () => this.togglePause());
    HUD_SPEEDS.forEach((s, i) => speedBtn(String(s), ['▶', '⏩', '⏭'][i]!, `Speed ×${s} (${i + 1})`, () => this.setSpeed(s)));
    const clock = h('div', { class: 'hud-f' }, this.seasonEl, speed);

    // G: the tool bar.
    const bar = h('nav', { class: 'hud-g', 'aria-label': 'Farm tools' });
    const tool = (id: string, icon: string, label: string, key: string, run: () => void, explain?: string) => {
      const btn = h('button', { type: 'button', class: 'tool-btn', 'data-testid': `btn-${id}`, 'aria-label': `${label} (${key})` }, h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, icon));
      tip.attach(btn, () => ({ title: `${icon} ${label} (${key})`, lines: explain ? [explain] : [] }), run, false);
      this.tools.set(id, btn);
      bar.append(btn);
      return btn;
    };
    tool('paths', '🛤️', 'Paths', 'P', () => this.togglePaths(), 'Lay dirt paths: farmers walk them from the farmhouse to their work');
    tool('build', '🔨', 'Build', 'B', () => this.toggleBuildMenu(), 'The construction menu');
    for (const w of ['farm', 'trade', 'almanac'] as const) {
      const def = WINDOWS[w];
      const tabs = listHudButtons('tab').filter((t) => t.spot.window === w);
      const btn = tool(w, def.icon, def.title, def.key!, () => this.toggleWindow(w), tabs.map((t) => `${t.icon ?? ''} ${t.label}`.trim()).join(' · '));
      const badge = h('span', { class: 'hud-badge', 'data-testid': `badge-${w}`, hidden: true });
      btn.append(badge);
      this.windowBadges.set(w, badge);
    }
    tool('menu', '⚙️', 'Menu', 'Esc', () => this.onMenu(), 'Save, load, settings and sound');

    // The tabs, made once: a window shows the ones that are visible.
    for (const def of listHudButtons('tab')) {
      const badge = h('span', { class: 'hud-badge', 'data-testid': `badge-${def.id}`, hidden: true });
      const btn = h(
        'button',
        { type: 'button', role: 'tab', class: 'sheet-tab', 'data-testid': `tab-${def.id}`, 'aria-selected': 'false', onclick: () => this.openWindow(def.spot.window, def.id) },
        h('span', { 'aria-hidden': 'true' }, withIcons(def.icon ?? '')),
        h('span', { class: 'sheet-tab-label' }, def.label),
        badge,
      );
      this.tabs.push({ def, btn, badge, shown: true, count: 0 });
    }

    this.buildMenu = new BuildMenu(this.ctx, tip, {
      build: (type) => this.startTool({ kind: 'build', type }, true),
      demolish: () => this.toggleDemolish(),
    });

    this.sheetTitleEl = h('h2', { class: 'sheet-title', id: 'sheet-title', 'data-testid': 'panel-title' });
    this.sheetTabsEl = h('nav', { class: 'sheet-tabs', role: 'tablist', 'aria-label': 'Tabs', 'data-testid': 'panel-tabs', hidden: true });
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
      this.sheetTabsEl,
      this.sheetBodyEl,
    );

    this.bannerEl = h('div', { class: 'tool-banner', 'data-testid': 'tool-banner', hidden: true });
    this.toastsEl = h('div', { class: 'toasts', 'aria-live': 'polite', 'data-testid': 'toasts' });

    this.root.append(top, clock, this.buildMenu.el, bar, this.sheetEl, this.bannerEl, this.toastsEl, tip.el);
  }

  private levelTip(): { title: string; lines: string[] } {
    const { level, xpIntoLevel, xpForNext } = this.ctx.game.progression.info;
    const lines: string[] = [];
    if (xpForNext === null) lines.push('The top level: everything is unlocked');
    else {
      lines.push(`${Math.max(0, Math.ceil(xpForNext - xpIntoLevel))} XP to level ${level + 1}`);
      const next = unlocksAt(level + 1);
      if (next.length) lines.push(`Unlocks ${next.map((u) => `${u.icon} ${u.name}`).join(', ')}`);
    }
    lines.push('Earn XP by farming and from 🎯 Goals. Click for 🎯 Goals and ⭐ Perks');
    return { title: `⭐ Level ${level}`, lines };
  }

  private seasonTip(): { title: string; lines: string[] } {
    const { game } = this.ctx;
    const season = SEASON_INFO[seasonOf(game.state.clock)];
    const sowable = CROP_LIST.filter((c) => game.isUnlocked(c.unlockLevel) && seasonCheck(game.state.clock, c) === 'ok');
    return {
      title: `${season.icon} ${season.name}, day ${dayOfSeason(game.state.clock)} of ${SEASON_DAYS}`,
      lines: [sowable.length ? `Sow now: ${sowable.map((c) => `${c.icon} ${c.name}`).join(', ')}` : 'Nothing can be sown now', `Day ${game.day} of your farm`],
    };
  }

  private updateStats(): void {
    const { game } = this.ctx;
    this.moneyValueEl.textContent = formatMoney(game.money);
    setText(this.dayEl, `Day ${game.day}`);
    const season = SEASON_INFO[seasonOf(game.state.clock)];
    setText(this.seasonNameEl, season.name);
    setText(this.seasonIconEl, season.icon);
    const label = `${season.name}, day ${dayOfSeason(game.state.clock)} of ${SEASON_DAYS} · Day ${game.day}`;
    if (this.seasonEl.getAttribute('aria-label') !== label) this.seasonEl.setAttribute('aria-label', label);
    this.dayBarEl.style.width = `${(timeOfDay(game.state.clock) * 100).toFixed(1)}%`;

    const { level, xpIntoLevel, xpForNext } = game.progression.info;
    setText(this.levelEl, `Lv ${level}`);
    setText(this.xpEl, xpForNext === null ? 'MAX' : `${Math.floor(xpIntoLevel)}/${xpForNext}`);
    this.xpBarEl.style.width = `${xpForNext === null ? 100 : Math.min(100, (xpIntoLevel / xpForNext) * 100).toFixed(1)}%`;
    this.resources.update();

    for (const [id, btn] of this.speedButtons) {
      const on = id === 'pause' ? game.playerPaused : !game.playerPaused && game.speed === Number(id);
      if (btn.getAttribute('aria-pressed') !== String(on)) btn.setAttribute('aria-pressed', String(on));
    }
    document.body.toggleAttribute('data-player-paused', game.playerPaused);

    for (const c of this.chips) {
      const { icon, label: value } = c.def.live?.(this.ctx) ?? { icon: c.def.icon ?? '•', label: '' };
      if (c.icon.dataset.icon !== icon) {
        c.icon.dataset.icon = icon;
        c.icon.replaceChildren(...withIcons(icon));
      }
      setText(c.value, value);
      c.btn.dataset.value = value;
      const aria = `${c.def.label}: ${value}`;
      if (c.btn.getAttribute('aria-label') !== aria) c.btn.setAttribute('aria-label', aria);
      c.btn.hidden = c.def.visible ? !c.def.visible(this.ctx) : false;
    }
    for (const b of this.banners) {
      const shown = b.def.visible ? b.def.visible(this.ctx) : true;
      if (b.btn.hidden !== !shown) b.btn.hidden = !shown;
      if (!shown) continue;
      const { icon, label } = b.def.live?.(this.ctx) ?? { icon: b.def.icon ?? '', label: b.def.label };
      setText(b.icon, icon);
      setText(b.text, label);
      const cls = `hud-banner banner-${b.def.spot.severity(this.ctx)}`;
      if (b.btn.className !== cls) b.btn.className = cls;
    }

    const sums = new Map<HudWindowId, number>();
    for (const t of this.tabs) {
      t.shown = t.def.visible ? t.def.visible(this.ctx) : true;
      t.count = t.shown ? (t.def.badge?.(this.ctx) ?? 0) : 0;
      setBadge(t.badge, t.count);
      const w = t.def.spot.window;
      sums.set(w, (sums.get(w) ?? 0) + t.count);
    }
    for (const [w, el] of this.windowBadges) setBadge(el, sums.get(w) ?? 0);
  }

  /** What the HUD shows now. */
  private view(): HudView {
    return {
      window: this.win?.id ?? null,
      tab: this.win?.tab ?? null,
      sheet: this.sheet?.id ?? null,
      build: { open: this.buildMenu.open, category: this.buildMenu.category },
      speed: this.ctx.game.speed,
      paused: this.ctx.game.playerPaused,
    };
  }

  /** Sends the `hud` signal when what the HUD shows has changed since the last one. */
  private announce(): void {
    const view = this.view();
    const sig = JSON.stringify(view);
    if (sig === this.viewSig) return;
    this.viewSig = sig;
    uiSignals.emit('hud', view);
  }

  /** Re-renders whatever depends on game state. Cheap; called on events and on a timer. */
  refresh(): void {
    this.announce();
    this.updateStats();
    this.buildMenu.refresh();
    this.tip.refresh();
    if (!this.eventsPop.hidden) this.renderEvents();
    if (!this.sheet) return;
    if (this.win) {
      // The tab went away (the trader left): show the window's first tab.
      const tab = this.tabs.find((t) => t.def.id === this.win!.tab);
      if (!tab?.shown) return this.openWindow(this.win.id);
      this.renderTabs();
    }
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

  // Windows and sheets ------------------------------------------------------------

  private showSheet(sheet: SheetSpec, win: { id: HudWindowId; tab: string } | null = null): void {
    this.buildMenu.hide();
    this.eventsPop.hidden = true;
    this.sheet = sheet;
    this.win = win;
    this.sheetSignature = '';
    this.tabsShown = '';
    this.sheetEl.hidden = false;
    this.sheetEl.dataset.sheet = sheet.id;
    if (win) this.sheetEl.dataset.window = win.id;
    else delete this.sheetEl.dataset.window;
    this.renderTabs();
    this.updateActive();
    this.refresh();
  }

  /** The window's tab row; hidden for the action panel and for a window with a single tab. */
  private renderTabs(): void {
    const win = this.win;
    const tabs = win ? this.tabs.filter((t) => t.def.spot.window === win.id && t.shown) : [];
    const sig = `${win?.id}|${win?.tab}|${tabs.map((t) => t.def.id).join(',')}`;
    if (sig === this.tabsShown) return;
    this.tabsShown = sig;
    for (const t of tabs) {
      const on = t.def.id === win!.tab;
      t.btn.setAttribute('aria-selected', String(on));
      t.btn.classList.toggle('active', on);
    }
    this.sheetTabsEl.replaceChildren(...tabs.map((t) => t.btn));
    this.sheetTabsEl.hidden = tabs.length < 2;
  }

  /** Opens a window on `tab`, or else on the tab it showed last (or its first). Leaves any tool. */
  private openWindow(id: HudWindowId, tab?: string): void {
    const tabs = this.tabs.filter((t) => t.def.spot.window === id && t.shown);
    const pick = tabs.find((t) => t.def.id === tab) ?? tabs.find((t) => t.def.id === this.lastTab.get(id)) ?? tabs[0];
    if (!pick) return;
    this.lastTab.set(id, pick.def.id);
    this.toolFromMenu = false;
    this.ctx.tools.cancel();
    if (this.win?.id === id && this.win.tab === pick.def.id) return;
    this.showSheet(pick.def.spot.sheet(this.ctx), { id, tab: pick.def.id });
  }

  private toggleWindow(id: HudWindowId): void {
    if (this.win?.id === id) this.closePanel();
    else this.openWindow(id);
  }

  openTab(id: string): void {
    const tab = this.tabs.find((t) => t.def.id === id);
    if (tab) this.openWindow(tab.def.spot.window, id);
  }

  toggleSheet(sheet: SheetSpec): void {
    if (this.sheet?.id === sheet.id) this.closePanel();
    else this.showSheet(sheet);
  }


  closePanel(): void {
    if (!this.sheet) return;
    this.sheet = null;
    this.win = null;
    this.sheetEl.hidden = true;
    this.sheetBodyEl.replaceChildren();
    this.updateActive();
  }

  /** Closes every window, menu and tip and leaves any tool (the pause menu opens, a new farm loads). */
  closeAll(): void {
    this.toolFromMenu = false;
    this.ctx.tools.cancel();
    this.closePanel();
    this.buildMenu.hide();
    this.eventsPop.hidden = true;
    this.tip.hide();
    this.updateActive();
  }

  /** Which tool bar buttons light up: the open window, the construction menu or the tool in use. */
  private updateActive(): void {
    const mode = this.ctx.tools.mode;
    const paths = mode.kind === 'build' && mode.type === 'path';
    const set = (id: string, on: boolean) => this.tools.get(id)?.classList.toggle('active', on);
    set('paths', paths);
    set('build', this.buildMenu.open || (mode.kind === 'build' && !paths) || mode.kind === 'demolish');
    for (const w of ['farm', 'trade', 'almanac'] as const) set(w, this.win?.id === w);
    this.levelBtn.classList.toggle('active', this.win?.id === 'development');
    this.buildMenu.demolishBtn.classList.toggle('active', mode.kind === 'demolish');
    this.buildMenu.demolishBtn.setAttribute('aria-pressed', String(mode.kind === 'demolish'));
    this.announce();
  }

  // Recent events --------------------------------------------------------------------

  private toggleEvents(): void {
    this.eventsPop.hidden = !this.eventsPop.hidden;
    this.eventsBtn.setAttribute('aria-expanded', String(!this.eventsPop.hidden));
    if (!this.eventsPop.hidden) {
      this.eventsSig = '';
      this.renderEvents();
    }
  }

  private renderEvents(): void {
    const sig = `${this.log.length}|${this.log[0]?.message}|${this.log[0]?.day}`;
    if (sig === this.eventsSig) return;
    this.eventsSig = sig;
    this.eventsPop.replaceChildren(
      h('div', { class: 'events-title' }, '🕮 Recent events'),
      this.log.length
        ? h(
            'ol',
            { class: 'events-list', 'data-testid': 'events-list' },
            this.log.map((e) => h('li', { class: `event event-${e.kind}` }, h('span', { class: 'event-day' }, `Day ${e.day}`), h('span', {}, withIcons(e.message)))),
          )
        : h('p', { class: 'muted' }, 'Nothing has happened yet.'),
    );
  }

  // Speed ------------------------------------------------------------------------------

  private togglePause(): void {
    this.ctx.game.playerPaused = !this.ctx.game.playerPaused;
    this.refresh();
  }

  private setSpeed(speed: number): void {
    this.ctx.game.playerPaused = false;
    this.ctx.game.setSpeed(speed);
    this.refresh();
  }

  // Keys -------------------------------------------------------------------------------

  /** Hotkeys do nothing while the menu or a dialog is open, or while typing. */
  private keysBlocked(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey || document.body.dataset.menu || this.root.querySelector('.dialog-backdrop')) return true;
    const t = e.target;
    return t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.defaultPrevented || this.keysBlocked(e)) return;
    const key = e.key.toLowerCase();
    const run: Record<string, () => void> = {
      ' ': () => this.togglePause(),
      p: () => this.togglePaths(),
      b: () => this.toggleBuildMenu(),
      x: () => this.toggleDemolish(),
      f: () => this.toggleWindow('farm'),
      t: () => this.toggleWindow('trade'),
      h: () => this.toggleWindow('almanac'),
    };
    HUD_SPEEDS.forEach((s, i) => (run[String(i + 1)] = () => this.setSpeed(s)));
    const action = run[key] ?? listHotkeys().find((k) => k.key.toLowerCase() === key)?.run.bind(null, this.ctx);
    if (!action) return;
    if (e.repeat) return e.preventDefault();
    e.preventDefault();
    // Space would also press the focused button when the key comes up.
    if (key === ' ' && document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    action();
  }

  /**
   * Esc, one level at a time: a pinned tip or the recent events, then a tool (back to the construction menu when it
   * came from there), then the construction menu, then a window or panel. True when it closed something; when it
   * didn't, the pause menu opens (`main.ts`).
   */
  escape(): boolean {
    if (this.tip.pinned) {
      this.tip.hide();
      return true;
    }
    if (!this.eventsPop.hidden) {
      this.eventsPop.hidden = true;
      return true;
    }
    if (this.ctx.tools.mode.kind !== 'normal') {
      this.backFromTool();
      return true;
    }
    if (this.buildMenu.open) {
      this.buildMenu.hide();
      this.updateActive();
      return true;
    }
    if (this.sheet) {
      this.closePanel();
      return true;
    }
    return false;
  }

  // Tools -----------------------------------------------------------------------

  private startTool(mode: ToolMode, fromMenu: boolean): void {
    this.closePanel();
    this.buildMenu.hide();
    this.toolFromMenu = fromMenu;
    this.ctx.tools.set(mode);
  }

  /** Leaves the tool: back to the construction menu when it was picked there. */
  private backFromTool(): void {
    const back = this.toolFromMenu;
    this.toolFromMenu = false;
    this.ctx.tools.cancel();
    if (back) this.showBuildMenu();
  }

  private showBuildMenu(): void {
    this.closePanel();
    this.eventsPop.hidden = true;
    this.buildMenu.show();
    this.updateActive();
  }

  private toggleBuildMenu(): void {
    if (this.buildMenu.open) {
      this.buildMenu.hide();
      this.updateActive();
      return;
    }
    this.toolFromMenu = false;
    this.ctx.tools.cancel();
    this.showBuildMenu();
  }

  private togglePaths(): void {
    const mode = this.ctx.tools.mode;
    if (mode.kind === 'build' && mode.type === 'path') this.backFromTool();
    else this.startTool({ kind: 'build', type: 'path' }, false);
  }

  private toggleDemolish(): void {
    if (this.ctx.tools.mode.kind === 'demolish') this.backFromTool();
    else this.startTool({ kind: 'demolish' }, this.buildMenu.open || this.toolFromMenu);
  }

  private onToolChange(mode: ToolMode): void {
    if (mode.kind === 'normal') this.toolFromMenu = false;
    this.updateActive();
    this.resources.highlight(mode.kind === 'build' ? 'materials' : null);
    document.body.dataset.tool = mode.kind;
    if (mode.kind === 'normal') {
      this.bannerEl.hidden = true;
      return;
    }
    let text: string;
    if (mode.kind === 'build') {
      const def = getBuildable(mode.type);
      const materials = formatMaterials(this.ctx.game.materialsFor(mode.type));
      text = `Placing ${def?.name ?? mode.type} (${formatMoney(def?.cost ?? 0)}${materials ? ` + ${materials}` : ''}) — tap a tile`;
    } else {
      text = `Demolish — tap an object to remove it (${Math.round(DEMOLISH_REFUND * 100)}% of money and materials back)`;
    }
    this.bannerEl.replaceChildren(
      h('span', {}, withIcons(text)),
      h('button', { type: 'button', class: 'btn btn-secondary', 'data-testid': 'btn-cancel-tool', onclick: () => this.backFromTool() }, this.toolFromMenu ? '← Back' : 'Cancel'),
    );
    this.bannerEl.hidden = false;
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
        if (current.checklist?.length) {
          body.append(
            h(
              'ul',
              { class: 'checklist', 'data-testid': 'panel-checklist' },
              current.checklist.map((c) =>
                h('li', { class: c.ok ? 'check-ok' : 'check-no', 'data-testid': `panel-check-${c.id}`, 'data-ok': String(c.ok) }, withIcons(`${c.ok ? '✅' : '❌'} ${c.text}`)),
              ),
            ),
          );
        }
        if (current.meters?.length) {
          body.append(
            h(
              'div',
              { class: 'meters' },
              current.meters.map((m) =>
                h(
                  'div',
                  { class: 'meter', 'data-testid': `panel-meter-${m.id}` },
                  h('span', { class: 'meter-label' }, withIcons(m.label)),
                  h(
                    'div',
                    {
                      class: 'meter-bar',
                      role: 'meter',
                      'aria-label': m.label,
                      'aria-valuemin': 0,
                      'aria-valuemax': 100,
                      'aria-valuenow': Math.round(m.value * 100),
                    },
                    h('div', { class: 'meter-fill', style: `transform: scaleX(${Math.max(0, Math.min(1, m.value))});${m.color ? ` background: ${m.color};` : ''}` }),
                    h('span', { class: 'meter-text' }, m.text),
                  ),
                ),
              ),
            ),
          );
        }
        if (current.hint) body.append(h('p', { class: 'panel-hint', 'data-testid': 'panel-hint' }, withIcons(current.hint)));
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
                    'data-testid': a.testId ?? `panel-action-${i}`,
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

  // Feedback --------------------------------------------------------------------

  toast(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
    if (kind === 'error') uiSignals.emit('refused', { message });
    this.log.unshift({ day: this.ctx.game.day, message, kind });
    this.log.length = Math.min(this.log.length, EVENTS_KEPT);
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

  /** "Level N!" popup listing what just unlocked, with the level's perk choice when it has one. */
  private showLevelUp({ level, bonus, unlocks }: GameEvents['levelUp']): void {
    this.showPerkDialog(level, [
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
    ]);
  }

  openPerkChoice(): void {
    const level = this.ctx.game.perks.pending[0];
    if (level === undefined) return;
    const open = this.root.querySelector<HTMLElement>(`[data-perk-level="${level}"]`);
    if (open) {
      // Already open (maybe under a newer one): bring it to the top.
      this.root.append(open);
      open.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      return;
    }
    this.showPerkDialog(level, [
      h('div', { class: 'levelup-star', 'aria-hidden': 'true' }, '⭐'),
      h('h2', { id: `levelup-${level}` }, `Level ${level} perk`),
      h('p', {}, 'Pick one: a perk lasts for good.'),
    ]);
  }

  /**
   * A level-up or perk dialog. While the level's perk choice is open it shows the three cards and "Decide later" (also
   * Esc); otherwise just "Great!". Several stack with the oldest on top, so choices come in level order.
   */
  private showPerkDialog(level: number, head: (Node | Node[] | null)[]): void {
    const { perks } = this.ctx.game;
    const choosing = perks.pending.includes(level);
    const close = () => {
      window.removeEventListener('keydown', onKey, true);
      if (this.perkDialogs.get(level)?.close === close) this.perkDialogs.delete(level);
      backdrop.remove();
      // The next dialog (now on top) takes the focus.
      const top = this.root.lastElementChild;
      if (top?.classList.contains('dialog-backdrop')) top.querySelector<HTMLElement>('[data-autofocus], .btn')?.focus();
    };
    const isTop = () => this.root.lastElementChild === backdrop;
    const cards = h('div', { class: 'perk-cards', role: 'group', 'aria-label': 'Perks to choose from', 'data-testid': 'perk-cards' });
    let shown = '';
    const renderCards = () => {
      const offer = perks.offer(level);
      // Unchanged cards stay as they are, so the one with the focus keeps it.
      const ids = offer.map((p) => p.id).join();
      if (ids === shown && cards.childElementCount) return;
      shown = ids;
      const focused = cards.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.testid : undefined;
      cards.replaceChildren(
        ...offer.map((perk, i) =>
          h(
            'button',
            {
              type: 'button',
              class: 'perk-card',
              'data-testid': `perk-card-${perk.id}`,
              'data-autofocus': i === 0 ? '' : undefined,
              onclick: () => {
                const r = perks.choose(level, perk.id);
                if (r.ok) {
                  close();
                  this.toast(`${r.perk.icon} ${r.perk.name}: ${r.perk.description}`, 'success');
                } else {
                  shown = '';
                  renderCards();
                }
              },
            },
            h('span', { class: 'perk-icon', 'aria-hidden': 'true' }, withIcons(perk.icon)),
            h('span', { class: 'perk-text' }, h('span', { class: 'perk-name' }, perk.name), h('span', { class: 'perk-desc' }, perk.description)),
          ),
        ),
      );
      if (!offer.length) cards.append(h('p', { class: 'empty' }, 'No perk left to offer.'));
      if (focused) (cards.querySelector<HTMLElement>(`[data-testid="${focused}"]`) ?? cards.querySelector<HTMLElement>('.perk-card'))?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === 'Escape' || (e.key === 'Enter' && !choosing)) {
        // Esc on a choice is "Decide later": it stays open behind the ⭐ banner.
        e.stopPropagation();
        e.preventDefault();
        close();
      } else if (choosing && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const all = [...cards.querySelectorAll<HTMLElement>('.perk-card')];
        const i = all.indexOf(document.activeElement as HTMLElement);
        const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
        all[(i + step + all.length) % all.length]?.focus();
        e.preventDefault();
      }
    };
    if (choosing) renderCards();
    const ok = choosing
      ? h('button', { type: 'button', class: 'btn btn-secondary', 'data-testid': 'perk-later', onclick: close }, 'Decide later')
      : h('button', { type: 'button', class: 'btn', 'data-testid': 'levelup-ok', 'data-autofocus': '', onclick: close }, 'Great!');
    const backdrop = h(
      'div',
      { class: 'dialog-backdrop', 'data-perk-level': choosing ? level : undefined },
      h(
        'div',
        { class: 'dialog levelup', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': `levelup-${level}`, 'data-testid': 'levelup-dialog' },
        ...head,
        choosing ? [h('h3', { class: 'group-title' }, 'Choose a perk'), cards] : null,
        h('div', { class: 'actions' }, ok),
      ),
    );
    if (choosing) {
      this.perkDialogs.get(level)?.close();
      this.perkDialogs.set(level, {
        close,
        // Chosen elsewhere (or reset): the dialog has done its job. Still open: other choices may have changed the cards.
        refresh: () => (perks.pending.includes(level) ? renderCards() : close()),
      });
    }
    window.addEventListener('keydown', onKey, true);
    // Oldest on top: a newer level's dialog goes under the open level-up dialogs.
    const under = this.root.querySelector(':scope > .dialog-backdrop[data-levelup]');
    backdrop.dataset.levelup = String(level);
    if (under) under.before(backdrop);
    else this.root.append(backdrop);
    if (isTop()) backdrop.querySelector<HTMLElement>('[data-autofocus]')?.focus();
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
