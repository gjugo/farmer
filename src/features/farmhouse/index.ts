import type Phaser from 'phaser';
import { FARMHOUSE, MAX_FARMHOUSE_LEVEL } from '../../data/farmhouse';
import type { FarmContext, ObjectView, PanelSpec, PlacedObject } from '../../game/context';
import { onGameStart, registerBehavior, registerDebugInfo } from '../../game/hooks';
import { withFarmer } from '../../game/workers';
import {
  FARMHOUSE_MOVED_MESSAGE,
  farmhouseChecklist,
  farmhouseInfo,
  farmhouseLevelDef,
  nextFarmhouseLevel,
  takeFarmhouseMovedNotice,
  upgradeFarmhouse,
} from '../../logic/farmhouse';
import { familiesCount, familiesOf } from '../../logic/families';
import type { Game } from '../../logic/game';
import { familiesIn, farmhouseLevel } from '../../logic/homes';
import { buildTime } from '../../logic/perks';
import { seasonOf } from '../../logic/seasons';
import { missingText } from '../../logic/upgrades';
import { freeFarmers, workersOf } from '../../logic/workers';
import { ART_RES, ART_SCALE, farmhouseArt, SHADOW } from '../../scenes/art';
import { packAsset, textureKey } from '../../scenes/sprites';
import { homeGardenLine } from '../gardens';

/**
 * The farmhouse on the map and in its panel: the sprite of its level (the farmhouse, the manor house, the manor hall,
 * all 3×3), a "Lv 2" badge above it, chimney smoke on winter days while its families have firewood, and the panel with
 * the upgrade checklist and button. Rules live in `src/logic/farmhouse.ts` (shared with the cottage in
 * `src/logic/upgrades.ts`), numbers in `src/data/farmhouse.ts`; idle farmers on its bench are `src/features/workers`,
 * its stock piles `src/features/storage/piles.ts`. `window.farm.farmhouse` is `farmhouseInfo`.
 */

/** The chimney tops in each level's 2x sprite (the Ludo.ai farmhouses, `tools/ludo/source/farmhouse_{1,2,3}_raw.png`). */
const CHIMNEY_AT: readonly (readonly { x: number; y: number }[])[] = [
  [{ x: 353, y: 23 }],
  [
    { x: 343, y: 33 },
    { x: 385, y: 19 },
    { x: 530, y: 98 },
  ],
  [
    { x: 367, y: 123 },
    { x: 390, y: 97 },
    { x: 510, y: 205 },
  ],
];
const PUFFS = 3;

interface HouseView {
  level: number;
  /** Puffs per chimney. */
  puffs: Phaser.GameObjects.Image[][];
  badge: Phaser.GameObjects.Container | null;
}

const views = new Map<string, HouseView>();

/** Families living in the farmhouse (none while it is a site). */
function occupants(game: Game, obj: PlacedObject): number {
  return obj.site ? 0 : familiesIn(game.state, familiesCount(game.state), obj.id);
}

/** Smoke on winter days while the homes have firewood. */
function smoking(game: Game): boolean {
  const day = familiesOf(game.state).lastDay;
  return seasonOf(game.state.clock) === 'winter' && !!day && day.firewood !== null && day.firewood > 0;
}

/** Puts up the sprite, chimneys and badge (none at level 1) of the farmhouse's level. */
function syncHouse(ctx: FarmContext, obj: PlacedObject, view: ObjectView): void {
  const level = farmhouseLevel(obj);
  const hv = views.get(obj.id);
  if (!hv || hv.level === level) return;
  hv.level = level;
  const art = farmhouseArt(level);
  view.sprite.setTexture(textureKey(ctx.scene, art));
  view.shadow?.setTexture(textureKey(ctx.scene, `${art}${SHADOW}`));
  for (const p of hv.puffs.flat()) p.destroy();
  hv.badge?.destroy();
  hv.badge = null;
  const [ax, ay] = packAsset(art)?.res[ART_RES].anchor ?? [0, 0];
  hv.puffs = (CHIMNEY_AT[level - 1] ?? CHIMNEY_AT[0]).map((c) => {
    const at = { x: view.top.x + (c.x - ax) * ART_SCALE, y: view.top.y + (c.y - ay) * ART_SCALE };
    const puffs = Array.from({ length: PUFFS }, () => ctx.scene.add.image(at.x, at.y, 'proc-smoke').setVisible(false).setData('at', at));
    view.container.add(puffs);
    return puffs;
  });
  if (level > 1) {
    // Like the cottage's: over the roof.
    const label = ctx.scene.add
      .text(0, 0, `Lv ${level}`, { fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#fff8e6', resolution: 2 })
      .setOrigin(0.5);
    const bg = ctx.scene.add.graphics();
    bg.fillStyle(0x3a2618, 0.85).fillRoundedRect(-22, -11, 44, 22, 10);
    bg.lineStyle(2, 0xf2c14e).strokeRoundedRect(-22, -11, 44, 22, 10);
    hv.badge = ctx.scene.add.container(view.top.x, view.top.y - ay * ART_SCALE - 8, [bg, label]).setName(`farmhouse-level-${level}`);
    view.container.add(hv.badge);
  }
}

function doUpgrade(ctx: FarmContext, obj: PlacedObject): void {
  withFarmer(ctx, 'build', obj, buildTime(ctx.game.state, obj.type), () => {
    const r = upgradeFarmhouse(ctx.game, obj);
    if (!r.ok) {
      ctx.ui.toast(r.reason === 'needs' ? `Cannot upgrade: ${missingText(farmhouseChecklist(ctx.game, obj))}` : 'Cannot upgrade', 'error');
      return false;
    }
    const at = farmhouseLevelDef(r.level);
    ctx.ui.toast(
      `${r.level === MAX_FARMHOUSE_LEVEL ? '🏰' : '🏡'} The farmhouse is now the ${at.name.toLowerCase()}: room for ${at.room} families, stores ${at.store.goods} goods and ${at.store.materials} materials, +${at.approval}% approval`,
      'success',
    );
    return true;
  });
}

function panel(ctx: FarmContext, obj: PlacedObject): PanelSpec {
  const { game } = ctx;
  const level = farmhouseLevel(obj);
  const at = farmhouseLevelDef(level);
  const title = level > 1 ? `${at.name} · Level ${level}` : at.name;
  if (obj.site) return { title, icon: '🏠', lines: ['Being built: a free farmer builds it, then it becomes the village centre and a family can move in.'] };
  const { farmers } = workersOf(game.state);
  const free = freeFarmers(game.state);
  const n = occupants(game, obj);
  const lines = [
    `Level ${level} of ${MAX_FARMHOUSE_LEVEL}. The heart of the farm: home of ${n === 0 ? 'no family yet' : n === 1 ? 'a family' : `${n} families`} (room for ${at.room}), and your ${farmers === 1 ? 'farmer rests' : `${farmers} farmers rest`} on the bench out front (${free} now).`,
    'Farmers walk out of the door along paths. Lay a path from the door to every field, pen and building you want worked.',
    `+${at.approval}% approval: it oversees the farm. It stores ${at.store.goods} goods and ${at.store.materials} materials.`,
    'Give farmers a workplace in 👪 Farm → 👨‍🌾 Farmers or from the workplace itself.',
  ];
  const spec: PanelSpec = { title, icon: '🏠', lines, hint: homeGardenLine(game, obj) };
  const next = nextFarmhouseLevel(obj);
  if (!next) {
    lines.push('Top level: the manor hall.');
    return spec;
  }
  const nextAt = farmhouseLevelDef(next.level);
  const c = farmhouseChecklist(game, obj);
  lines.push(
    `⬆️ The ${nextAt.name.toLowerCase()} (level ${next.level}) houses ${nextAt.room} families, stores ${nextAt.store.goods} + ${nextAt.store.materials} and gives +${nextAt.approval}% approval. It needs:`,
  );
  spec.checklist = c.lines.map((l) => ({ id: `farmhouse-${l.id}`, ok: l.ok, text: l.text }));
  spec.actions = [{ label: `⬆️ Upgrade to the ${nextAt.name.toLowerCase()}`, disabled: !c.ok, testId: 'farmhouse-upgrade', onClick: () => doUpgrade(ctx, obj) }];
  return spec;
}

registerBehavior<Record<string, unknown>>(FARMHOUSE, {
  create: (ctx, obj, view) => {
    views.set(obj.id, { level: 0, puffs: [], badge: null });
    syncHouse(ctx, obj, view);
  },
  refresh: syncHouse,
  update: (ctx, obj) => {
    const hv = views.get(obj.id);
    if (!hv) return;
    const on = smoking(ctx.game) && occupants(ctx.game, obj) > 0;
    // Cosmetic only, so it runs on real time.
    const t = ctx.scene.time.now;
    hv.puffs.forEach((puffs, chimney) =>
      puffs.forEach((p, i) => {
        p.setVisible(on);
        if (!on) return;
        const a = p.getData('at') as { x: number; y: number };
        const phase = (t / 2000 + i / PUFFS + chimney * 0.37) % 1;
        p.setPosition(a.x + Math.sin(phase * 5 + i) * 5 + phase * 10, a.y - phase * 40);
        p.setAlpha(0.7 * (1 - phase));
        p.setScale(0.45 + phase * 0.7);
      }),
    );
  },
  destroy: (_ctx, obj) => void views.delete(obj.id),
  panel,
});

/** The running game, for the debug info (set at game start). */
let current: Game | null = null;

/** `window.farm.farmhouse`: `{ id, site, level, name, room, store, approval, upgrade }` (the checklist), or null without one. */
registerDebugInfo('farmhouse', () => (current ? farmhouseInfo(current) : null));

onGameStart((ctx) => {
  current = ctx.game;
  if (takeFarmhouseMovedNotice(ctx.game.state)) ctx.ui.toast(FARMHOUSE_MOVED_MESSAGE, 'info');
});
