import { SEASON_INFO } from '../data/seasons';
import type { FarmContext } from '../game/context';
import { listSettingsSections } from '../game/hooks';
import type { SaveStorage } from '../logic/save';
import {
  deleteSlot,
  exportFileName,
  importSlot,
  listSlots,
  parseSaveFile,
  readSlotText,
  SaveFileError,
  writeSlot,
  type SlotId,
  type SlotSummary,
} from '../logic/slots';
import type { GameState } from '../logic/types';
import { formatMoney, h } from './dom';

export type MenuMode = 'home' | 'paused';
type Screen = 'main' | 'save' | 'load' | 'settings';

/** What the menu asks of the game (wired in `main.ts`). Confirmations are the menu's job; these just act. */
export interface MenuHost {
  ctx: FarmContext;
  storage: SaveStorage;
  /** Whether there is a farm to continue or lose (an autosave on the home screen, always while paused). */
  hasFarm(): boolean;
  /** Summary of the farm on screen, for the Continue button. */
  currentSummary(): SlotSummary;
  onContinue(): void;
  onResume(): void;
  onNewGame(): void;
  onLoad(id: SlotId): void;
  onQuit(): void;
  /** The current farm as a save file, for Save game and Export. */
  currentState(): GameState;
  currentSaveText(): string;
}

const SLOT_NAME = (id: SlotId) => (id === 'auto' ? 'Autosave' : `Slot ${id}`);

/** "Day 5 · 🌻 Summer · Lv 3 · $1,234" */
export function summaryText(s: SlotSummary): string {
  if (s.empty) return 'Empty';
  const season = SEASON_INFO[s.season];
  return `Day ${s.day} · ${season.icon} ${season.name} · Lv ${s.level} · ${formatMoney(s.money)}`;
}

function savedText(savedAt: number | null): string {
  if (savedAt === null) return 'Saved at an unknown time';
  const d = new Date(savedAt);
  return `Saved ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * The home screen and the pause menu: one full-screen dialog over the dimmed farm, with Save game, Load game
 * (autosave + 3 slots, export, import, delete) and Settings screens.
 */
export class Menu {
  private mode: MenuMode | null = null;
  private screen: Screen = 'main';
  private readonly backdrop: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private importTo: SlotId | null = null;

  constructor(
    root: HTMLElement,
    private readonly host: MenuHost,
  ) {
    this.fileInput = h('input', {
      type: 'file',
      accept: '.json,application/json',
      hidden: true,
      'data-testid': 'import-file',
      onchange: () => void this.onFile(),
    });
    this.panel = h('div', { class: 'menu', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'menu-title', 'data-testid': 'menu' });
    this.backdrop = h('div', { class: 'menu-backdrop', hidden: true }, this.panel, this.fileInput);
    this.backdrop.addEventListener('keydown', (e) => this.trapTab(e));
    root.append(this.backdrop);
  }

  get current(): MenuMode | null {
    return this.mode;
  }

  open(mode: MenuMode): void {
    this.mode = mode;
    this.screen = 'main';
    document.body.dataset.menu = mode;
    this.backdrop.hidden = false;
    this.render();
  }

  close(): void {
    this.mode = null;
    delete document.body.dataset.menu;
    this.backdrop.hidden = true;
    this.panel.replaceChildren();
  }

  /** Esc: back from a sub-screen, or resume from the pause menu. True when it did something. */
  escape(): boolean {
    if (!this.mode) return false;
    if (this.screen !== 'main') {
      this.show('main', `menu-${this.screen}`);
      return true;
    }
    if (this.mode === 'paused') {
      this.host.onResume();
      return true;
    }
    return false;
  }

  // Screens ----------------------------------------------------------------------

  private show(screen: Screen, focus?: string): void {
    this.screen = screen;
    this.render(focus);
  }

  private render(focus?: string): void {
    if (!this.mode) return;
    this.panel.dataset.menu = this.mode;
    this.panel.dataset.screen = this.screen;
    const body =
      this.screen === 'main' ? this.mainScreen() : this.screen === 'save' ? this.saveScreen() : this.screen === 'load' ? this.loadScreen() : this.settingsScreen();
    this.panel.replaceChildren(...body);
    const target = (focus && this.panel.querySelector<HTMLElement>(`[data-testid="${focus}"]:not(:disabled)`)) || this.panel.querySelector<HTMLElement>('button:not(:disabled)');
    target?.focus();
  }

  private button(testid: string, label: string, onClick: () => void, variant = 'primary', extra: Record<string, string> = {}): HTMLButtonElement {
    return h('button', { type: 'button', class: `btn btn-${variant} menu-btn`, 'data-testid': testid, onclick: onClick, ...extra }, label);
  }

  private mainScreen(): Node[] {
    const { host } = this;
    const home = this.mode === 'home';
    const title = home
      ? h('h1', { id: 'menu-title', class: 'menu-title' }, h('span', { 'aria-hidden': 'true' }, '🌾 '), 'Farmer')
      : h('h1', { id: 'menu-title', class: 'menu-title menu-title-small' }, 'Paused');
    const buttons: HTMLElement[] = [];
    if (home) {
      if (host.hasFarm()) {
        const summary = summaryText(host.currentSummary());
        buttons.push(
          h(
            'button',
            { type: 'button', class: 'btn btn-primary menu-btn menu-continue', 'data-testid': 'menu-continue', onclick: () => host.onContinue() },
            h('span', {}, 'Continue'),
            h('span', { class: 'menu-btn-note', 'data-testid': 'menu-continue-summary' }, summary),
          ),
        );
      }
      buttons.push(
        this.button('menu-new-game', 'New game', () => void this.newGame(), host.hasFarm() ? 'secondary' : 'primary'),
        this.button('menu-load', 'Load game', () => this.show('load'), 'secondary'),
        this.button('menu-settings', 'Settings', () => this.show('settings'), 'secondary'),
      );
    } else {
      buttons.push(
        this.button('menu-resume', 'Resume', () => host.onResume()),
        this.button('menu-save', 'Save game', () => this.show('save'), 'secondary'),
        this.button('menu-load', 'Load game', () => this.show('load'), 'secondary'),
        this.button('menu-new-game', 'New game', () => void this.newGame(), 'secondary'),
        this.button('menu-settings', 'Settings', () => this.show('settings'), 'secondary'),
        this.button('menu-quit', 'Quit to title', () => host.onQuit(), 'secondary'),
      );
    }
    return [title, home ? h('p', { class: 'menu-tagline' }, 'Grow crops, raise animals, build your farm.') : null, h('nav', { class: 'menu-buttons', 'aria-label': home ? 'Home' : 'Pause menu' }, buttons)].filter(
      (n): n is HTMLElement => n !== null,
    );
  }

  private subScreen(title: string, ...content: (Node | null)[]): Node[] {
    const back = this.button('menu-back', '← Back', () => this.show('main', `menu-${this.screen}`), 'secondary', { 'aria-label': 'Back' });
    return [h('div', { class: 'menu-head' }, back, h('h2', { id: 'menu-title', class: 'menu-subtitle' }, title)), ...content.filter((n): n is Node => n !== null)];
  }

  private slotRow(s: SlotSummary, actions: HTMLElement[]): HTMLElement {
    return h(
      'li',
      { class: `slot-row${s.empty ? ' slot-empty' : ''}`, 'data-testid': `slot-${s.id}`, 'data-empty': String(s.empty) },
      h(
        'div',
        { class: 'slot-info' },
        h('strong', { class: 'slot-name' }, SLOT_NAME(s.id)),
        h('span', { class: 'slot-summary', 'data-testid': `slot-summary-${s.id}` }, summaryText(s)),
        s.empty ? null : h('span', { class: 'slot-time', 'data-testid': `slot-time-${s.id}` }, savedText(s.savedAt)),
      ),
      h('div', { class: 'slot-actions' }, actions),
    );
  }

  private saveScreen(): Node[] {
    const slots = listSlots(this.host.storage).filter((s) => s.id !== 'auto');
    const list = h(
      'ul',
      { class: 'slot-list', 'data-testid': 'save-slots' },
      slots.map((s) => this.slotRow(s, [this.button(`slot-save-${s.id}`, 'Save here', () => void this.saveTo(s), 'primary')])),
    );
    return this.subScreen(
      'Save game',
      list,
      h('p', { class: 'muted' }, 'Your farm is also saved automatically in this browser.'),
      h('div', { class: 'actions' }, this.button('export-current', 'Export current farm', () => this.download(this.host.currentSaveText()), 'secondary')),
    );
  }

  private loadScreen(): Node[] {
    const slots = listSlots(this.host.storage);
    const list = h(
      'ul',
      { class: 'slot-list', 'data-testid': 'load-slots' },
      slots.map((s) => {
        const actions = [
          this.button(`slot-load-${s.id}`, 'Load', () => void this.load(s), 'primary', s.empty ? { disabled: 'true' } : {}),
          this.button(`slot-export-${s.id}`, 'Export', () => this.exportSlot(s.id), 'secondary', s.empty ? { disabled: 'true' } : {}),
        ];
        if (s.id !== 'auto') {
          actions.push(
            this.button(`slot-import-${s.id}`, 'Import', () => this.pickFile(s.id), 'secondary'),
            this.button(`slot-delete-${s.id}`, 'Delete', () => void this.remove(s), 'danger', s.empty ? { disabled: 'true' } : {}),
          );
        }
        return this.slotRow(s, actions);
      }),
    );
    return this.subScreen('Load game', list, h('p', { class: 'muted' }, 'Import reads a save file you exported into a slot.'));
  }

  private settingsScreen(): Node[] {
    const body = h('div', { class: 'menu-settings', 'data-testid': 'menu-settings-body' });
    for (const section of listSettingsSections()) section.render(this.host.ctx, body);
    return this.subScreen('Settings', body);
  }

  // Actions ----------------------------------------------------------------------

  private get ui() {
    return this.host.ctx.ui;
  }

  private async newGame(): Promise<void> {
    if (this.host.hasFarm()) {
      const ok = await this.ui.confirm('Start a new game?', 'Your current farm, money and items will be lost. Save it to a slot first if you want to keep it.', {
        confirmLabel: 'New game',
      });
      if (!ok) return this.render('menu-new-game');
    }
    this.host.onNewGame();
  }

  private async saveTo(s: SlotSummary): Promise<void> {
    if (!s.empty) {
      const ok = await this.ui.confirm(`Overwrite ${SLOT_NAME(s.id)}?`, `${summaryText(s)} will be replaced by your current farm.`, { confirmLabel: 'Overwrite' });
      if (!ok) return this.render(`slot-save-${s.id}`);
    }
    const result = writeSlot(this.host.storage, s.id, this.host.currentState());
    if (result.ok) this.ui.toast(`Saved to ${SLOT_NAME(s.id)}`, 'success');
    else this.ui.toast(result.error, 'error');
    this.render(`slot-save-${s.id}`);
  }

  private async load(s: SlotSummary): Promise<void> {
    if (s.empty) return;
    if (this.host.hasFarm()) {
      const ok = await this.ui.confirm(`Load ${SLOT_NAME(s.id)}?`, 'Your current farm will be replaced. Save it to a slot first if you want to keep it.', {
        confirmLabel: 'Load',
      });
      if (!ok) return this.render(`slot-load-${s.id}`);
    }
    this.host.onLoad(s.id);
  }

  private async remove(s: SlotSummary): Promise<void> {
    if (s.empty || s.id === 'auto') return;
    const ok = await this.ui.confirm(`Delete ${SLOT_NAME(s.id)}?`, `${summaryText(s)} will be gone for good.`, { confirmLabel: 'Delete' });
    if (ok) {
      deleteSlot(this.host.storage, s.id);
      this.ui.toast(`${SLOT_NAME(s.id)} deleted`, 'success');
    }
    this.render(`slot-delete-${s.id}`);
  }

  private exportSlot(id: SlotId): void {
    const text = readSlotText(this.host.storage, id);
    if (text) this.download(text);
    else this.ui.toast('That save could not be read.', 'error');
  }

  private download(text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: exportFileName(), hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private pickFile(id: SlotId): void {
    this.importTo = id;
    this.fileInput.value = '';
    this.fileInput.click();
  }

  private async onFile(): Promise<void> {
    const id = this.importTo;
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (id === null || !file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      return this.ui.toast('This file could not be read.', 'error');
    }
    const before = listSlots(this.host.storage).find((s) => s.id === id);
    if (before && !before.empty) {
      // Refuse a bad file before asking about the slot it would replace.
      try {
        parseSaveFile(text);
      } catch (e) {
        return this.ui.toast(e instanceof SaveFileError ? e.message : 'This file could not be read.', 'error');
      }
      const ok = await this.ui.confirm(`Overwrite ${SLOT_NAME(id)}?`, `${summaryText(before)} will be replaced by the imported farm.`, { confirmLabel: 'Overwrite' });
      if (!ok) return this.render(`slot-import-${id}`);
    }
    const result = importSlot(this.host.storage, id, text);
    if (result.ok) this.ui.toast(`Imported into ${SLOT_NAME(id)}`, 'success');
    else this.ui.toast(result.error, 'error');
    if (this.mode && this.screen === 'load') this.render(`slot-load-${id}`);
  }

  /** Keeps Tab inside the menu while it is the top dialog. */
  private trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const items = [...this.panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([type="file"]), select, a[href], [tabindex]:not([tabindex="-1"])')].filter(
      (el) => el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
