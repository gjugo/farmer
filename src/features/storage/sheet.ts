import { getItem, ITEM_LIST } from '../../data/items';
import { isStoredMaterial } from '../../data/materials';
import { STORAGE_POOLS, type StoragePool } from '../../data/storage';
import type { FarmContext, SheetSpec } from '../../game/context';
import { poolStatus, storageInfo, type PoolInfo } from '../../logic/storage';
import { h } from '../../ui/dom';
import { itemIcon, withIcons } from '../../ui/icons';

/** The 👪 Farm window's Storage tab: both pools as bars, then everything the farm holds. */

const POOL_LABEL: Record<StoragePool, { title: string; icon: string; building: string }> = {
  goods: { title: 'Goods', icon: '🌾', building: 'granary' },
  materials: { title: 'Materials', icon: '🪵', building: 'storehouse' },
};

/** A pool's used/capacity bar; it warns from 90% and says plainly when the pool is full. */
function storageBar(pool: StoragePool, info: PoolInfo): HTMLElement {
  const status = poolStatus(info);
  const label = POOL_LABEL[pool];
  const pct = info.capacity > 0 ? Math.min(100, Math.round((info.used / info.capacity) * 100)) : 100;
  const note =
    info.used > info.capacity
      ? `Over capacity: nothing new comes in until you sell or use ${info.used - info.capacity}. Build or upgrade a ${label.building}.`
      : status === 'full'
        ? `Full: nothing more comes in. Build or upgrade a ${label.building}, or sell something.`
        : status === 'warn'
          ? `Almost full: build or upgrade a ${label.building} soon.`
          : null;
  return h(
    'div',
    { class: `storage-pool storage-${status}`, 'data-testid': `storage-${pool}`, 'data-used': info.used, 'data-capacity': info.capacity },
    h('div', { class: 'storage-head' }, withIcons(`${label.icon} ${label.title}`), h('span', { class: 'storage-count' }, `${info.used} / ${info.capacity}`)),
    h(
      'div',
      { class: 'storage-bar', role: 'progressbar', 'aria-label': `${label.title} stored`, 'aria-valuemin': 0, 'aria-valuemax': info.capacity, 'aria-valuenow': info.used },
      h('div', { class: 'storage-fill', style: `width: ${pct}%` }),
    ),
    note ? h('p', { class: 'storage-note', 'data-testid': `storage-note-${pool}` }, note) : null,
  );
}

export function storageSheet(ctx: FarmContext): SheetSpec {
  const { game } = ctx;
  return {
    id: 'storage',
    title: () => '📦 Storage',
    signature: () => JSON.stringify([game.state.inventory, storageInfo(game.state)]),
    render: (body) => {
      const info = storageInfo(game.state);
      body.append(h('div', { class: 'storage-bars' }, STORAGE_POOLS.map((pool) => storageBar(pool, info[pool]))));
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
      const goods = rows.filter((id) => !isStoredMaterial(id));
      const materials = rows.filter(isStoredMaterial);
      if (goods.length) body.append(list('inventory-list', goods));
      if (materials.length) {
        body.append(h('h3', { class: 'group-title' }, 'Building materials'), list('inventory-materials', materials));
      }
    },
  };
}
