import { BUILD_CATEGORIES, listBuildCategory, type BuildableDef, type BuildCategory } from '../data/buildables';
import { formatMaterials, formatMissing } from '../data/materials';
import type { FarmContext } from '../game/context';
import { listBuildMenuToggles } from '../game/hooks';
import { buildableUnlockLevel } from '../logic/unlocks';
import { artSeason, textureKey } from '../scenes/sprites';
import { formatMoney, h } from './dom';
import { withIcons } from './icons';
import type { Tip, TipContent } from './tip';

/** What the menu asks of the HUD: start a tool from a card or the 🧹 icon. */
export interface BuildMenuHost {
  build(type: string): void;
  demolish(): void;
}

/** Pictures of the cards by texture, as data URLs (made once per texture and season). */
const pictures = new Map<string, string>();

/** The building's own sprite, as the farm draws it in the current season; null before the farm scene has loaded it. */
function picture(ctx: FarmContext, def: BuildableDef): string | null {
  const scene = ctx.scene;
  if (!scene?.textures) return null;
  const key = textureKey(scene, def.texture);
  if (key === 'missing') return null;
  let url = pictures.get(key);
  if (url === undefined) {
    try {
      url = scene.textures.getBase64(key, scene.textures.get(key).firstFrame);
    } catch {
      url = '';
    }
    pictures.set(key, url);
  }
  return url || null;
}

/**
 * The construction menu, like Manor Lords': a row of category icons over the tool bar (and 🧹 Demolish), a parchment
 * panel above it with one tall picture card per building of the category, and a row of checkboxes above that (the 🌱
 * Soil overlay). A card starts build mode; locked cards are greyed with their level. Categories come from each
 * buildable's `category`, so a new building needs no change here. The menu remembers the last category.
 */
export class BuildMenu {
  readonly el: HTMLElement;
  private readonly toggles: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly title: HTMLElement;
  private readonly catButtons = new Map<BuildCategory, HTMLButtonElement>();
  readonly demolishBtn: HTMLButtonElement;
  private _category: BuildCategory = BUILD_CATEGORIES[0].id;
  private sig = '';

  constructor(
    private readonly ctx: FarmContext,
    private readonly tip: Tip,
    private readonly host: BuildMenuHost,
  ) {
    this.toggles = h('div', { class: 'build-toggles', 'data-testid': 'build-toggles' });
    this.title = h('h2', { class: 'build-title', id: 'build-title', 'data-testid': 'build-title' });
    this.cards = h('div', { class: 'build-cards', role: 'list', 'data-testid': 'build-cards' });
    const cats = h('nav', { class: 'build-cats', 'aria-label': 'Building categories' });
    for (const c of BUILD_CATEGORIES) {
      const btn = h(
        'button',
        { type: 'button', class: 'build-cat', 'data-testid': `build-cat-${c.id}`, 'aria-label': c.name, 'aria-pressed': 'false' },
        h('span', { 'aria-hidden': 'true' }, c.icon),
      );
      this.tip.attach(btn, () => ({ title: `${c.icon} ${c.name}` }), () => this.select(c.id), false);
      this.catButtons.set(c.id, btn);
      cats.append(btn);
    }
    this.demolishBtn = h(
      'button',
      { type: 'button', class: 'build-cat build-demolish', 'data-testid': 'btn-demolish', 'aria-label': 'Demolish (X)' },
      h('span', { 'aria-hidden': 'true' }, '🧹'),
    );
    this.tip.attach(
      this.demolishBtn,
      () => ({ title: '🧹 Demolish (X)', lines: ['Tap an object to remove it: half its money and materials come back'] }),
      () => this.host.demolish(),
      false,
    );
    cats.append(this.demolishBtn);
    this.el = h(
      'section',
      { class: 'build-menu', role: 'dialog', 'aria-labelledby': 'build-title', 'data-testid': 'build-menu', hidden: true },
      this.toggles,
      h('div', { class: 'build-panel' }, this.title, this.cards),
      cats,
    );
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  get category(): BuildCategory {
    return this._category;
  }

  show(): void {
    this.el.hidden = false;
    document.body.toggleAttribute('data-build-open', true);
    this.sig = '';
    this.refresh();
  }

  hide(): void {
    this.el.hidden = true;
    document.body.toggleAttribute('data-build-open', false);
  }

  select(category: BuildCategory): void {
    this._category = category;
    this.sig = '';
    this.refresh();
    this.cards.scrollLeft = 0;
  }

  /** Re-renders when anything a card shows changed. Cheap; called on every HUD refresh. */
  refresh(): void {
    if (!this.open) return;
    const { game } = this.ctx;
    const defs = listBuildCategory(this._category);
    const sig = `${this._category}|${game.level}|${artSeason()}|${!!this.ctx.scene}|${listBuildMenuToggles()
      .map((t) => t.isOn(this.ctx))
      .join(',')}|${defs.map((b) => `${b.id}:${this.built(b)}:${game.canAfford(b.cost)}:${JSON.stringify(game.missingMaterials(game.materialsFor(b.id)))}`).join('|')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    for (const [id, btn] of this.catButtons) {
      btn.setAttribute('aria-pressed', String(id === this._category));
      btn.classList.toggle('active', id === this._category);
    }
    const cat = BUILD_CATEGORIES.find((c) => c.id === this._category)!;
    this.title.textContent = `${cat.icon} ${cat.name}`;
    this.toggles.replaceChildren(
      ...listBuildMenuToggles().map((t) => {
        const box = h('input', {
          type: 'checkbox',
          'data-testid': `build-toggle-${t.id}`,
          checked: t.isOn(this.ctx),
          onchange: () => {
            t.toggle(this.ctx);
            this.refresh();
          },
        });
        return h('label', { class: 'build-toggle' }, box, h('span', {}, `${t.icon ? `${t.icon} ` : ''}${t.label}`));
      }),
    );
    const scroll = this.cards.scrollLeft;
    this.cards.replaceChildren(...defs.flatMap((b, i) => (i ? [h('span', { class: 'build-orn', 'aria-hidden': 'true' }, '⚜'), this.card(b)] : [this.card(b)])));
    this.cards.scrollLeft = scroll;
  }

  /** A one-per-farm buildable (the farmhouse) the farm already has, finished or being built. */
  private built(b: BuildableDef): boolean {
    return !!b.unique && this.ctx.game.objectsOfType(b.id).length > 0;
  }

  /** What a card says on hover, or in its line on a touch screen. */
  private describe(b: BuildableDef): TipContent & { lines: string[]; needs: string | null; locked: number | null; built: boolean } {
    const { game } = this.ctx;
    const built = this.built(b);
    if (built) {
      const lines = ['Built', ...(b.description ? [b.description] : [])];
      return { title: `${b.icon ?? ''} ${b.name}`.trim(), lines, needs: null, locked: null, built };
    }
    const unlockLevel = buildableUnlockLevel(b.id);
    const locked = game.isUnlocked(unlockLevel) ? null : unlockLevel;
    const missing = game.missingMaterials(game.materialsFor(b.id));
    const shortMoney = !game.canAfford(b.cost);
    const materials = formatMaterials(game.materialsFor(b.id));
    // What stands between the player and building it, e.g. "Needs $40 more and 4 more 🪵 Wood".
    const short = [shortMoney ? `${formatMoney(b.cost - game.money)} more` : '', formatMissing(missing)].filter(Boolean).join(' and ');
    const needs = locked ? null : short ? `Needs ${short}${missing.length ? ' — buy at the 🏪 Market' : ''}` : null;
    const lines = [`${formatMoney(b.cost)}${materials ? ` + ${materials}` : ''} · ${b.footprint.w}×${b.footprint.h}`];
    if (locked) lines.push(`🔒 Unlocks at level ${locked}`);
    else if (needs) lines.push(needs);
    if (b.description) lines.push(b.description);
    return { title: `${b.icon ?? ''} ${b.name}`.trim(), lines, needs, locked, built };
  }

  private card(b: BuildableDef): HTMLElement {
    const d = this.describe(b);
    const url = picture(this.ctx, b);
    const unavailable = d.built || d.locked !== null || d.needs !== null;
    const card = h(
      'button',
      {
        type: 'button',
        role: 'listitem',
        class: `build-card${d.locked !== null ? ' locked' : ''}${d.needs ? ' short' : ''}${d.built ? ' built' : ''}`,
        'data-testid': `build-${b.id}`,
        'data-locked': d.locked !== null ? String(d.locked) : undefined,
        'data-built': d.built ? 'true' : undefined,
        'aria-disabled': unavailable ? 'true' : undefined,
        'aria-label': `${b.name}, ${d.lines[0]}${d.locked !== null ? `, unlocks at level ${d.locked}` : d.needs ? `, ${d.needs}` : ''}`,
      },
      h(
        'span',
        { class: 'build-pic' },
        url ? h('img', { src: url, alt: '', draggable: 'false' }) : h('span', { class: 'build-pic-icon', 'aria-hidden': 'true' }, b.icon ?? '🔨'),
        d.locked !== null ? h('span', { class: 'build-lock' }, `🔒 Lv ${d.locked}`) : null,
      ),
      h('span', { class: 'build-strip', 'aria-hidden': 'true' }, withIcons(b.icon ?? '🔨')),
      h(
        'span',
        { class: 'build-line' },
        h('span', { class: 'build-name' }, b.name),
        h('span', { class: 'build-cost', 'data-testid': `build-cost-${b.id}` }, withIcons(d.lines[0].split(' · ')[0])),
        d.needs ? h('span', { class: 'needs-note', 'data-testid': `build-needs-${b.id}` }, withIcons(d.needs)) : null,
      ),
    );
    this.tip.attach(
      card,
      () => this.describe(b),
      () => {
        if (card.getAttribute('aria-disabled') !== 'true') this.host.build(b.id);
      },
      false,
    );
    return card;
  }
}
