import { getItem, splitIcons } from '../data/items';
import { ICON_ART, iconUrl } from '../scenes/art';
import { h } from './dom';

const PACK_ICONS = new Set<string>(ICON_ART);

/** The art pack's icon as an image (decorative: the text next to it names the thing). */
export function packIcon(name: string, cls = 'item-img'): HTMLImageElement {
  return h('img', { class: cls, src: iconUrl(name), alt: '', 'aria-hidden': 'true', draggable: 'false', 'data-icon': name });
}

/** An item's icon: the pack image, or the item's emoji (or a box) for anything the pack has no icon for. */
export function itemIcon(id: string): HTMLElement {
  if (PACK_ICONS.has(id)) return h('span', { class: 'item-icon', 'aria-hidden': 'true' }, packIcon(id));
  return h('span', { class: 'item-icon', 'aria-hidden': 'true' }, getItem(id)?.icon ?? '📦');
}

/** Text with every item emoji (and 💰) shown as the pack's icon, for labels built as strings. */
export function withIcons(text: string): (Node | string)[] {
  return splitIcons(text).map((part) => (typeof part === 'string' ? part : packIcon(part.icon, 'inline-icon')));
}
