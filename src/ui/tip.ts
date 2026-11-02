import { h } from './dom';
import { withIcons } from './icons';

/** What a tip says: a bold first line and a few more. */
export interface TipContent {
  title: string;
  lines?: string[];
}

interface Anchor {
  el: HTMLElement;
  read: () => TipContent;
}

/**
 * The HUD's tooltip, like Manor Lords' hover boxes: a mouse shows it on hover; on a touch screen the first tap on an
 * element shows it (pinned) and a second tap does the element's action. One tip at a time; Esc or a tap elsewhere
 * closes a pinned one. Shown under elements in the top half of the screen and over those in the bottom half.
 */
export class Tip {
  readonly el: HTMLElement;
  private shown: (Anchor & { pinned: boolean }) | null = null;
  private sig = '';
  /** The pointer of the last press, so a click knows whether it came from a finger. */
  private lastPointer = 'mouse';

  constructor() {
    this.el = h('div', { class: 'hud-tip', role: 'tooltip', id: 'hud-tip', 'data-testid': 'hud-tip', hidden: true });
    window.addEventListener(
      'pointerdown',
      (e) => {
        this.lastPointer = e.pointerType;
        if (this.shown?.pinned && !this.shown.el.contains(e.target as Node) && !this.el.contains(e.target as Node)) this.hide();
      },
      true,
    );
    // A key press (Enter on a focused button) acts at once, whatever pointer came before.
    window.addEventListener('keydown', () => (this.lastPointer = 'key'), true);
  }

  /**
   * Gives `el` a tip. With `action`, a click does it, except that with `explainFirst` a tap on a touch screen first
   * shows the tip (a second tap does it); without, a click or tap pins the tip.
   */
  attach(el: HTMLElement, read: () => TipContent, action?: () => void, explainFirst = true): void {
    const anchor = { el, read };
    el.setAttribute('aria-describedby', 'hud-tip');
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && !this.shown?.pinned) this.show(anchor, false);
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.shown?.el === el && !this.shown.pinned) this.hide();
    });
    el.addEventListener('focus', () => {
      if (!this.shown?.pinned && el.matches(':focus-visible')) this.show(anchor, false);
    });
    el.addEventListener('blur', () => {
      if (this.shown?.el === el && !this.shown.pinned) this.hide();
    });
    el.addEventListener('click', () => {
      const touch = this.lastPointer === 'touch' || this.lastPointer === 'pen';
      if (action && !(explainFirst && touch && this.shown?.el !== el)) {
        this.hide();
        action();
      } else if (this.shown?.el === el && this.shown.pinned) this.hide();
      else this.show(anchor, true);
    });
  }

  get pinned(): boolean {
    return !!this.shown?.pinned;
  }

  hide(): void {
    this.shown = null;
    this.el.hidden = true;
  }

  /** Re-reads the tip on show; cheap, called on every HUD refresh. */
  refresh(): void {
    if (!this.shown) return;
    if (!this.shown.el.isConnected || this.shown.el.offsetParent === null) return this.hide();
    this.render();
  }

  private show(anchor: Anchor, pinned: boolean): void {
    this.shown = { ...anchor, pinned };
    this.sig = '';
    this.render();
    this.el.hidden = false;
    this.place();
  }

  private render(): void {
    const { title, lines = [] } = this.shown!.read();
    const sig = JSON.stringify([title, lines]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.el.replaceChildren(h('div', { class: 'hud-tip-title' }, withIcons(title)));
    if (lines.length) this.el.append(h('ul', { class: 'hud-tip-lines' }, lines.map((l) => h('li', {}, withIcons(l)))));
    this.place();
  }

  private place(): void {
    if (!this.shown) return;
    const a = this.shown.el.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    const left = Math.max(8, Math.min(a.left + a.width / 2 - w / 2, window.innerWidth - 8 - w));
    const below = a.top + a.height / 2 < window.innerHeight / 2;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${below ? a.bottom + 8 : Math.max(8, a.top - 8 - hgt)}px`;
  }
}
