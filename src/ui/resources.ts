import { getItem, ITEM_LIST } from '../data/items';
import { categoryOf, categoryTotals, itemsOf, RESOURCE_CATEGORIES, type ResourceCategory, type ResourceCategoryDef } from '../data/resources';
import type { StoragePool } from '../data/storage';
import type { Game } from '../logic/game';
import { poolStatus, storageInfo } from '../logic/storage';
import { h } from './dom';
import { itemIcon, packIcon } from './icons';

/** How long a chip shows its +N / −N after a change. */
const FLASH_MS = 1400;

const POOL_TITLE: Record<StoragePool, string> = { goods: 'Granary room (goods)', materials: 'Storehouse room (materials)' };

interface Chip {
  def: ResourceCategoryDef;
  btn: HTMLButtonElement;
  count: HTMLElement;
  delta: HTMLElement;
  last: number;
  /** Change still showing (summed while changes keep coming). */
  shown: number;
  timer: number | undefined;
}

/**
 * The resource bar under the top bar, like Manor Lords: one chip per category (crops, animal products, feed,
 * goods, materials) with its total, a +N / −N flash when it changes, and the room used in the granaries and
 * storehouses. Hover (mouse) or tap a chip for each item's count; Esc or a tap outside closes it.
 */
export class ResourceBar {
  readonly el: HTMLElement;
  private readonly chips = new Map<ResourceCategory, Chip>();
  private readonly pools = new Map<StoragePool, HTMLElement>();
  private readonly popover: HTMLElement;
  private open: { category: ResourceCategory; pinned: boolean } | null = null;
  private popoverSig = '';

  constructor(private readonly game: Game) {
    this.popover = h('div', { class: 'res-pop', role: 'tooltip', id: 'res-pop', 'data-testid': 'resources-popover', hidden: true });
    const groups: HTMLElement[] = [];
    let group: HTMLElement | null = null;
    let groupPool: StoragePool | null = null;
    const closeGroup = () => {
      if (group && groupPool) group.append(this.poolChip(groupPool));
    };
    for (const def of RESOURCE_CATEGORIES) {
      if (def.pool !== groupPool) {
        closeGroup();
        group = h('div', { class: 'res-group', 'data-pool': def.pool });
        groupPool = def.pool;
        groups.push(group);
      }
      group!.append(this.chip(def));
    }
    closeGroup();
    this.el = h('div', { class: 'resource-bar', role: 'group', 'aria-label': 'Resources', 'data-testid': 'hud-resources' }, groups, this.popover);

    // Esc closes the popover before anything else (the side sheet listens for Esc too).
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.open) {
          e.stopPropagation();
          this.close();
        }
      },
      true,
    );
    // A tap or click outside the bar closes it.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (this.open && !this.el.contains(e.target as Node)) this.close();
      },
      true,
    );
    this.update();
  }

  private chip(def: ResourceCategoryDef): HTMLButtonElement {
    const count = h('span', { class: 'res-count' });
    const delta = h('span', { class: 'res-delta', 'aria-hidden': 'true' });
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'res-chip',
        'data-testid': `resource-${def.id}`,
        'data-category': def.id,
        'aria-haspopup': 'true',
        'aria-expanded': 'false',
        onclick: () => this.toggle(def.id),
        onpointerenter: (e) => {
          if ((e as PointerEvent).pointerType === 'mouse' && !this.open?.pinned) this.show(def.id, false);
        },
        onpointerleave: (e) => {
          if ((e as PointerEvent).pointerType === 'mouse' && this.open && !this.open.pinned) this.close();
        },
      },
      packIcon(def.icon, 'res-icon'),
      h('span', { class: 'res-name' }, def.name),
      count,
      delta,
    );
    this.chips.set(def.id, { def, btn, count, delta, last: NaN, shown: 0, timer: undefined });
    return btn;
  }

  private poolChip(pool: StoragePool): HTMLElement {
    const el = h('span', { class: 'res-pool', 'data-testid': `resources-pool-${pool}`, title: POOL_TITLE[pool] });
    this.pools.set(pool, el);
    return el;
  }

  /** Re-reads the inventory; cheap, called on every HUD refresh and inventory change. */
  update(): void {
    const totals = categoryTotals(this.game.state.inventory);
    for (const chip of this.chips.values()) {
      const n = totals[chip.def.id];
      if (n === chip.last) continue;
      if (!Number.isNaN(chip.last)) this.flash(chip, n - chip.last);
      chip.last = n;
      chip.count.textContent = String(n);
      chip.btn.dataset.count = String(n);
      const label = `${chip.def.name}: ${n}`;
      chip.btn.setAttribute('aria-label', label);
      chip.btn.title = label;
    }
    const info = storageInfo(this.game.state);
    for (const [pool, el] of this.pools) {
      const { used, capacity } = info[pool];
      const text = `${used}/${capacity}`;
      if (el.textContent !== text) el.textContent = text;
      el.dataset.used = String(used);
      el.dataset.capacity = String(capacity);
      const cls = `res-pool storage-${poolStatus(info[pool])}`;
      if (el.className !== cls) el.className = cls;
    }
    if (this.open) this.renderPopover();
  }

  /** After a new game: show the new counts without flashing the difference. */
  reset(): void {
    for (const chip of this.chips.values()) {
      this.endFlash(chip);
      chip.last = NaN;
    }
    this.close();
    this.update();
  }

  private flash(chip: Chip, delta: number): void {
    if (!delta) return;
    chip.shown += delta;
    if (!chip.shown) {
      this.endFlash(chip);
      return;
    }
    chip.delta.textContent = `${chip.shown > 0 ? '+' : '−'}${Math.abs(chip.shown)}`;
    chip.delta.className = `res-delta ${chip.shown > 0 ? 'gain' : 'loss'}`;
    chip.btn.dataset.delta = String(chip.shown);
    chip.btn.classList.remove('flash-gain', 'flash-loss');
    void chip.btn.offsetWidth; // restart the animation
    chip.btn.classList.add(chip.shown > 0 ? 'flash-gain' : 'flash-loss');
    window.clearTimeout(chip.timer);
    chip.timer = window.setTimeout(() => this.endFlash(chip), FLASH_MS);
  }

  private endFlash(chip: Chip): void {
    window.clearTimeout(chip.timer);
    chip.shown = 0;
    chip.delta.textContent = '';
    chip.delta.className = 'res-delta';
    delete chip.btn.dataset.delta;
    chip.btn.classList.remove('flash-gain', 'flash-loss');
  }

  // Popover ---------------------------------------------------------------------

  private toggle(category: ResourceCategory): void {
    if (this.open?.category === category && this.open.pinned) this.close();
    else this.show(category, true);
  }

  private show(category: ResourceCategory, pinned: boolean): void {
    this.open = { category, pinned };
    for (const [id, chip] of this.chips) {
      chip.btn.setAttribute('aria-expanded', String(id === category));
      if (id === category) chip.btn.setAttribute('aria-describedby', 'res-pop');
      else chip.btn.removeAttribute('aria-describedby');
    }
    this.popoverSig = '';
    this.renderPopover();
    this.popover.hidden = false;
    this.place(this.chips.get(category)!.btn);
  }

  close(): void {
    if (!this.open) return;
    this.open = null;
    this.popover.hidden = true;
    for (const chip of this.chips.values()) {
      chip.btn.setAttribute('aria-expanded', 'false');
      chip.btn.removeAttribute('aria-describedby');
    }
  }

  /** Under the chip, kept inside the screen. */
  private place(anchor: HTMLElement): void {
    const bar = this.el.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const width = this.popover.offsetWidth;
    const left = Math.max(8 - bar.left, Math.min(a.left - bar.left, window.innerWidth - 8 - width - bar.left));
    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${a.bottom - bar.top + 6}px`;
  }

  private renderPopover(): void {
    if (!this.open) return;
    const { category } = this.open;
    const inv = this.game.state.inventory;
    const known = new Set(ITEM_LIST.map((i) => i.id));
    // Catalogue items first, then anything else the save holds in this category.
    const ids = [...itemsOf(category), ...Object.keys(inv).filter((id) => !known.has(id) && categoryOf(id) === category)];
    const sig = `${category}|${ids.map((id) => `${id}:${inv[id] ?? 0}`).join(',')}`;
    if (sig === this.popoverSig) return;
    this.popoverSig = sig;
    const def = this.chips.get(category)!.def;
    this.popover.dataset.category = category;
    this.popover.replaceChildren(
      h('div', { class: 'res-pop-title' }, def.name),
      h(
        'ul',
        { class: 'res-pop-list' },
        ids.map((id) =>
          h(
            'li',
            { class: `res-pop-item${(inv[id] ?? 0) === 0 ? ' empty' : ''}`, 'data-testid': `resources-item-${id}`, 'data-count': inv[id] ?? 0 },
            itemIcon(id),
            h('span', { class: 'item-name' }, getItem(id)?.name ?? id),
            h('span', { class: 'item-count' }, String(inv[id] ?? 0)),
          ),
        ),
      ),
    );
  }
}
