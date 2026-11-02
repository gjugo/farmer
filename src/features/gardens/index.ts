import Phaser from 'phaser';
import { getBuildable } from '../../data/buildables';
import { FARMHOUSE } from '../../data/farmhouse';
import { GARDEN_TYPES, type GardenDef } from '../../data/gardens';
import { getItem } from '../../data/items';
import { SEASON_INFO, SEASONS, type Season } from '../../data/seasons';
import type { FarmContext, ObjectView, PanelSpec, PlacedObject } from '../../game/context';
import { onBuildPreview, onGameStart, registerBehavior, registerDebugInfo } from '../../game/hooks';
import { formatDuration } from '../../logic/crops';
import { DAY_MS } from '../../logic/constants';
import type { Game } from '../../logic/game';
import { freeHomes, gardenDef, gardenHomes, gardenOf, gardensOf, nextYieldAt, sanitize, workingHome, type GardenState } from '../../logic/gardens';
import { seasonAt, seasonOf } from '../../logic/seasons';
import { fullMessage } from '../../logic/storage';
import { ART_SCALE, facing, ORCHARD_TREE, type Facing } from '../../scenes/art';
import { DEPTH } from '../../scenes/depth';
import { footprintLocal, gridToWorld } from '../../scenes/iso';
import { addArt, addArtSprite, addShadow } from '../../scenes/sprites';

/**
 * House gardens on the map and in their panel (rules in `src/logic/gardens.ts`, content in `src/data/gardens.ts`):
 * two hens wander the hen run, the orchard's two trees are the map's apple tree in its seasons, and the build ghost
 * outlines the homes that still have room for a garden. Also the garden line in the cottage and farmhouse panels
 * (`homeGardenLine`) and `window.farm.gardens` for QA.
 */

function itemLabel(itemId: string): string {
  const item = getItem(itemId);
  return item ? `${item.icon} ${item.name}` : itemId;
}

const seasonName = (s: Season) => SEASON_INFO[s].name.toLowerCase();

/** "spring, summer and autumn" */
function listOf(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** "1 🥕 Carrot a day in spring, summer and autumn; nothing in winter." */
export function yieldText(def: GardenDef): string {
  const on = SEASONS.filter((s) => (def.perDay[s] ?? 0) > 0);
  const off = SEASONS.filter((s) => !on.includes(s));
  const amounts = new Set(on.map((s) => def.perDay[s]));
  const label = itemLabel(def.item);
  const when =
    amounts.size === 1
      ? `${[...amounts][0]} ${label} a day ${off.length === 0 ? 'all year' : `in ${listOf(on.map(seasonName))}`}`
      : on.map((s) => `${def.perDay[s]} ${label} a day in ${seasonName(s)}`).join(', ');
  return off.length && on.length < SEASONS.length ? `${when}; nothing in ${listOf(off.map(seasonName))}.` : `${when}.`;
}

/** What a home's panel says about its garden. */
export function homeGardenLine(game: Game, home: PlacedObject): string {
  const g = gardenOf(game.state, home.id);
  if (!g) return '🌱 No garden yet: build a vegetable patch, hen run or orchard against this home.';
  const def = gardenDef(g);
  const now = (def.perDay[seasonOf(game.state.clock)] ?? 0) > 0;
  return `${def.icon} Garden: ${def.name}, ${now ? `${def.perDay[seasonOf(game.state.clock)]} ${itemLabel(def.item)} a day this season` : 'resting this season'}.`;
}

// Hens --------------------------------------------------------------------------------

/** Where the hens may stand in the run (grid units on the 2×2 footprint): the open ground in front of the hut. */
const HEN_AREA = { x0: 0.7, x1: 1.65, y0: 0.6, y1: 1.65 };
const HENS = 2;
const HEN_SPEED = 0.45;

interface Hen {
  body: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image | null;
  at: { x: number; y: number };
  target: { x: number; y: number };
  facing: Facing;
  rest: number;
}

const hens = new Map<string, Hen[]>();

function henSpot(): { x: number; y: number } {
  return { x: Phaser.Math.FloatBetween(HEN_AREA.x0, HEN_AREA.x1), y: Phaser.Math.FloatBetween(HEN_AREA.y0, HEN_AREA.y1) };
}

function placeHen(h: Hen): void {
  const p = footprintLocal(2, 2, h.at.x, h.at.y);
  h.body.setPosition(p.x, p.y).play(`chicken_${h.rest > 0 ? 'idle' : 'walk'}_${h.facing}`, true);
  h.shadow?.setPosition(p.x, p.y).setFrame(h.body.frame.name);
}

function addHens(ctx: FarmContext, obj: PlacedObject, view: ObjectView): void {
  const list: Hen[] = [];
  for (let i = 0; i < HENS; i++) {
    const body = addArtSprite(ctx.scene, 0, 0, 'chicken').setName('garden-hen');
    const shadow = addShadow(ctx.scene, 0, 0, 'chicken');
    if (shadow) view.shadows.add(shadow);
    view.container.add(body);
    const h: Hen = { body, shadow, at: henSpot(), target: henSpot(), facing: (['se', 'sw'] as Facing[])[i % 2], rest: Math.random() * 2000 };
    placeHen(h);
    list.push(h);
  }
  hens.set(obj.id, list);
}

/** Cosmetic only, so it runs on real time. */
function wander(obj: PlacedObject, view: ObjectView, realDt: number): void {
  const list = hens.get(obj.id);
  if (!list) return;
  for (const h of list) {
    if (h.rest > 0) h.rest -= realDt;
    else {
      const dx = h.target.x - h.at.x;
      const dy = h.target.y - h.at.y;
      const dist = Math.hypot(dx, dy);
      const step = (HEN_SPEED * realDt) / 1000;
      if (dist <= step) {
        h.at = h.target;
        h.target = henSpot();
        h.rest = 800 + Math.random() * 3000;
      } else {
        h.at = { x: h.at.x + (dx / dist) * step, y: h.at.y + (dy / dist) * step };
        h.facing = facing(dx, dy);
      }
    }
    placeHen(h);
  }
  // The run's sprite at the back, then the hens front to back.
  view.container.sort('y', (a: Phaser.GameObjects.GameObject, b: Phaser.GameObjects.GameObject) =>
    a === view.sprite ? -1 : b === view.sprite ? 1 : (a as Phaser.GameObjects.Sprite).y - (b as Phaser.GameObjects.Sprite).y,
  );
}

// Orchard -----------------------------------------------------------------------------

/** The orchard's two trees (grid points on the 2×2 pad): one each side, clear of the basket and the ladder. */
const TREES = [
  { x: 0.75, y: 1.3 },
  { x: 1.3, y: 0.75 },
];
const TREE_SCALE = 0.85;

function addTrees(ctx: FarmContext, view: ObjectView): void {
  for (const t of TREES) {
    const p = footprintLocal(2, 2, t.x, t.y);
    const tree = addArt(ctx.scene, p.x, p.y, ORCHARD_TREE).setName('orchard-tree');
    tree.setScale(ART_SCALE * TREE_SCALE);
    view.container.add(tree);
  }
}

// Panel -------------------------------------------------------------------------------

function homeName(game: Game, obj: PlacedObject): string {
  const home = workingHome(game.state, obj);
  if (!home) return '';
  if (home.type === FARMHOUSE) return 'the farmhouse';
  const n = game.state.objects.filter((o) => o.type === home.type && !o.site).findIndex((o) => o.id === home.id) + 1;
  return `cottage ${n}`;
}

function panel(ctx: FarmContext, obj: PlacedObject<GardenState>): PanelSpec {
  const { game } = ctx;
  sanitize(obj);
  const def = gardenDef(obj);
  const season = seasonOf(game.state.clock);
  const today = def.perDay[season] ?? 0;
  const label = itemLabel(def.item);
  const lines = [`Makes ${yieldText(def)}`];
  lines.push(today > 0 ? `${SEASON_INFO[season].icon} This season: ${today} ${label} a day.` : `${SEASON_INFO[season].icon} Resting this season: nothing to pick in ${seasonName(season)}.`);
  const home = workingHome(game.state, obj);
  const homeId = gardenHomes(game.state).get(obj.id);
  if (home) lines.push(`Tended by the family of ${homeName(game, obj)} in its spare time: no farmer or path needed.`);
  else if (homeId) lines.push('Its home is still being built: the garden starts once a family can live there.');
  else lines.push('No home beside it: it makes nothing until a cottage stands against it.');
  lines.push(
    obj.state.waiting > 0
      ? `Waiting for room in the granary: ${obj.state.waiting} ${label}. ${fullMessage('goods')}`
      : 'Nothing waiting: every yield went into the granary.',
  );
  const next = nextYieldAt(obj);
  if (next !== null) {
    const n = def.perDay[seasonAt(next - 1)] ?? 0;
    lines.push(next === obj.state.nextAt ? `Next yield: ${n} ${label} in ${formatDuration(next - game.now)}.` : `Next yield: ${n} ${label} in ${seasonName(seasonAt(next - 1))}.`);
  }
  const at = obj.state.nextAt;
  return {
    title: def.name,
    icon: def.icon,
    lines,
    progress: at !== null && next === at ? { value: Math.max(0, Math.min(1, 1 - (at - game.now) / DAY_MS)), label: `${today} ${label} today` } : undefined,
  };
}

for (const type of GARDEN_TYPES) {
  registerBehavior<GardenState>(type, {
    create(ctx, obj, view) {
      sanitize(obj);
      if (type === 'hen-run') addHens(ctx, obj, view);
      if (type === 'orchard') addTrees(ctx, view);
    },
    update(_ctx, obj, view) {
      if (type === 'hen-run') wander(obj, view, view.container.scene.game.loop.delta);
    },
    destroy(_ctx, obj) {
      hens.delete(obj.id); // the display objects go with the view's container
    },
    panel,
  });
}

// Build ghost and QA --------------------------------------------------------------------

let current: Game | null = null;

onGameStart((ctx) => {
  current = ctx.game;
  const scene = ctx.scene;
  const outline = scene.add.graphics().setDepth(DEPTH.shadow - 0.25).setName('ghost-homes');
  const diamond = (x: number, y: number, w: number, h: number) =>
    [gridToWorld(x, y), gridToWorld(x + w, y), gridToWorld(x + w, y + h), gridToWorld(x, y + h)].map((p) => new Phaser.Math.Vector2(p.x, p.y));
  // A garden goes against a home with no garden yet: outline those, like a quarry's outcrops.
  onBuildPreview((_ctx, p) => {
    outline.clear();
    if (!p || !(GARDEN_TYPES as string[]).includes(p.type)) return;
    outline.lineStyle(4, 0xffe27a, 0.9);
    for (const home of freeHomes(ctx.game.state)) {
      const fp = getBuildable(home.type)?.footprint ?? { w: 1, h: 1 };
      outline.strokePoints(diamond(home.x, home.y, fp.w, fp.h), true);
    }
  });
});

/** `window.farm.gardens`, for QA. */
registerDebugInfo('gardens', () => {
  const game = current;
  if (!game) return null;
  return gardensOf(game.state).map((g) => ({ id: g.id, kind: g.type, home: g.state.home, waiting: g.state.waiting, nextAt: g.state.nextAt }));
});
