import type Phaser from 'phaser';
import { getItem, ITEM_LIST } from '../../data/items';
import { formatMaterials, needsMaterialsMessage } from '../../data/materials';
import { FARMHOUSE_STORE, MAX_STORAGE_LEVEL, STORAGE, type StorageType } from '../../data/storage';
import type { FarmContext, ObjectView, PanelAction, PanelSpec, PlacedObject } from '../../game/context';
import { onGameStart, registerBehavior, registerDebugInfo } from '../../game/hooks';
import { withFarmer } from '../../game/workers';
import {
  capacity,
  capacityOfObject,
  storageRoom,
  checkUpgrade,
  levelOf,
  nextLevel,
  poolNoun,
  poolOf,
  storageInfo,
  storageNoticeMessage,
  takeStorageNotice,
  upgrade,
  used,
  type StorageState,
} from '../../logic/storage';
import { buildTime, materialsCost } from '../../logic/perks';
import { ART_RES, ART_SCALE, SHADOW, storageArt } from '../../scenes/art';
import { packAsset, textureKey } from '../../scenes/sprites';
import { formatMoney } from '../../ui/dom';
import './piles';

/**
 * Granaries and storehouses: their sprite and level badge on the map, and the panel that shows the pool's
 * stock and upgrades the building. The rules (capacity, upgrades, the space check every intake goes through)
 * live in `src/logic/storage.ts`, the content in `src/data/storage.ts`.
 */

interface Badge {
  box: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  level: number;
}

const badges = new Map<string, Badge>();

/** Shows the building's level: its sprite for that level and a small "Lv 2" badge on the roof. */
function sync(ctx: FarmContext, obj: PlacedObject<StorageState>, view: ObjectView): void {
  const level = levelOf(obj);
  const badge = badges.get(obj.id);
  if (!badge || badge.level === level) return;
  badge.level = level;
  const art = storageArt(obj.type as StorageType, level);
  view.sprite.setTexture(textureKey(ctx.scene, art));
  view.shadow?.setTexture(textureKey(ctx.scene, `${art}${SHADOW}`));
  badge.label.setText(`Lv ${level}`);
  badge.box.setName(`storage-level-${level}`);
}

function create(ctx: FarmContext, obj: PlacedObject<StorageState>, view: ObjectView): void {
  const scene = ctx.scene;
  // The badge sits over the sprite's top edge, a little left of the roof's peak.
  const [, ay] = packAsset(storageArt(obj.type as StorageType, 1))?.res[ART_RES].anchor ?? [0, 0];
  const x = view.top.x - 34;
  const y = view.top.y - ay * ART_SCALE + 26;
  const label = scene.add
    .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#fff8e6', resolution: 2 })
    .setOrigin(0.5);
  const bg = scene.add.graphics();
  bg.fillStyle(0x3a2618, 0.85).fillRoundedRect(-22, -11, 44, 22, 10);
  bg.lineStyle(2, 0xf2c14e).strokeRoundedRect(-22, -11, 44, 22, 10);
  const box = scene.add.container(x, y, [bg, label]);
  view.container.add(box);
  badges.set(obj.id, { box, label, level: 0 });
  sync(ctx, obj, view);
}

/** "🌾 Wheat ×20 · 🥚 Egg ×4", what the pool holds in catalogue order. */
function stockLine(ctx: FarmContext, type: StorageType): string {
  const pool = STORAGE[type].pool;
  const inv = ctx.game.state.inventory;
  const known = new Set(ITEM_LIST.map((i) => i.id));
  const ids = [...ITEM_LIST.map((i) => i.id), ...Object.keys(inv).filter((id) => !known.has(id))];
  const parts = ids.filter((id) => poolOf(id) === pool && (inv[id] ?? 0) > 0).map((id) => {
    const item = getItem(id);
    return `${item?.icon ?? ''} ${item?.name ?? id} ×${inv[id]}`.trim();
  });
  return parts.length ? `Stored: ${parts.join(' · ')}` : 'Stored: nothing yet';
}

function doUpgrade(ctx: FarmContext, obj: PlacedObject<StorageState>): void {
  const def = STORAGE[obj.type as StorageType];
  withFarmer(ctx, 'build', obj, buildTime(ctx.game.state, obj.type), () => {
    const r = upgrade(ctx.game, obj);
    if (!r.ok) {
      ctx.ui.toast(upgradeRefusal(ctx, obj) ?? 'Cannot upgrade', 'error');
      return false;
    }
    ctx.ui.toast(`${def.name} upgraded to level ${r.level}: holds ${capacityOfObject(obj, ctx.game.state)} ${def.pool}`, 'success');
    return true;
  });
}

/** Why the upgrade can't be done now, or null when it can. */
function upgradeRefusal(ctx: FarmContext, obj: PlacedObject<StorageState>): string | null {
  const check = checkUpgrade(ctx.game, obj);
  if (check.ok) return null;
  const next = nextLevel(obj);
  switch (check.reason) {
    case 'max':
      return `Top level (${MAX_STORAGE_LEVEL})`;
    case 'money':
      return `Needs ${formatMoney(next!.upgrade.cost)}`;
    case 'materials': {
      // More than the storehouses can hold at once: buying won't do, they need more room first.
      const cost = materialsCost(ctx.game.state, next!.upgrade.materials);
      const total = Object.values(cost).reduce((sum, n) => sum + (n ?? 0), 0);
      const room = capacity(ctx.game.state, 'materials');
      if (total > room) return `Needs ${total} materials at once, more than the ${room} your storehouses hold: build or upgrade a storehouse`;
      return needsMaterialsMessage(ctx.game.missingMaterials(cost));
    }
    default:
      return 'Cannot upgrade';
  }
}

function panel(ctx: FarmContext, obj: PlacedObject<StorageState>): PanelSpec {
  const { game } = ctx;
  const type = obj.type as StorageType;
  const def = STORAGE[type];
  const level = levelOf(obj);
  const pool = def.pool;
  const cap = capacity(game.state, pool);
  const have = used(game.state, pool);
  const others = cap - FARMHOUSE_STORE[pool] - capacityOfObject(obj, game.state);
  const parts = [`this ${def.name.toLowerCase()} ${capacityOfObject(obj, game.state)}`, ...(others > 0 ? [`other ${def.name.toLowerCase()}s ${others}`] : []), `farmhouse ${FARMHOUSE_STORE[pool]}`];
  const lines = [
    `Level ${level} of ${MAX_STORAGE_LEVEL}`,
    `${pool === 'goods' ? 'Goods' : 'Materials'}: ${have} / ${cap} (${parts.join(' + ')})`,
    stockLine(ctx, type),
  ];
  if (have > cap) lines.push(`Over capacity: nothing new comes in until you sell or use ${have - cap} ${poolNoun(pool, have - cap)}.`);
  else if (have >= cap) lines.push(`Full: nothing more comes in until you build, upgrade or sell.`);

  const actions: PanelAction[] = [];
  const next = nextLevel(obj);
  if (next) {
    const materials = formatMaterials(materialsCost(game.state, next.upgrade.materials));
    const why = upgradeRefusal(ctx, obj);
    if (why) lines.push(`Upgrade: ${why}`);
    actions.push({
      label: `⬆️ Upgrade to level ${next.level} · ${formatMoney(next.upgrade.cost)}${materials ? ` + ${materials}` : ''} → holds ${storageRoom(game.state, next.capacity)}`,
      disabled: why !== null,
      onClick: () => doUpgrade(ctx, obj),
    });
  } else {
    lines.push('Top level.');
  }
  return {
    title: `${def.name} · Level ${level}`,
    icon: def.icon,
    lines,
    progress: { value: cap > 0 ? have / cap : 1, label: `${have} / ${cap} ${pool}` },
    actions,
  };
}

for (const type of Object.keys(STORAGE) as StorageType[]) {
  registerBehavior<StorageState>(type, {
    create,
    refresh: sync,
    destroy(_ctx, obj) {
      badges.delete(obj.id); // the badge goes with the view's container
    },
    panel,
  });
}

onGameStart((ctx) => {
  registerDebugInfo('storage', () => storageInfo(ctx.game.state));
  // Farms from before storage are told once what changed (see the version 7 save migration).
  if (takeStorageNotice(ctx.game.state)) ctx.ui.toast(storageNoticeMessage(ctx.game.state), 'info');
});
