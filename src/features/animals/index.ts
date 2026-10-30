import Phaser from 'phaser';
import { ANIMALS, FEED_PACK, PENS, type AnimalKind, type PenType } from '../../data/animals';
import { getItem } from '../../data/items';
import { FEED_WORK_MS } from '../../data/workers';
import type { FarmContext, ObjectView, PanelAction, PanelSpec, PlacedObject } from '../../game/context';
import { registerBehavior } from '../../game/hooks';
import { withFarmer } from '../../game/workers';
import {
  animalProgress,
  animalsOf,
  animalStatus,
  buyAnimal,
  buyFeed,
  checkBuyAnimal,
  collect,
  feedAll,
  feedNeeded,
  readyCount,
  type AnimalStatus,
  type PenState,
} from '../../logic/animals';
import { ART_SCALE, facing, penFence, type Facing } from '../../scenes/art';
import { footprintLocal } from '../../scenes/iso';
import { addArt, addArtSprite, addShadow, packAsset, textureKey } from '../../scenes/sprites';
import { WALK_AREA } from './textures';

/** Walking speed in tiles per real second. */
const SPEED: Record<AnimalKind, number> = { chicken: 0.55, cow: 0.28, sheep: 0.35 };

const BUBBLE_TINT: Record<Exclude<AnimalStatus, 'producing'>, number> = { hungry: 0xffd4c4, ready: 0xd6ffc4 };
/** Item icons in bubbles are this many world pixels tall. */
const BUBBLE_ICON = 24;

interface Critter {
  kind: AnimalKind;
  body: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image | null;
  bubble: Phaser.GameObjects.Container;
  bubbleBg: Phaser.GameObjects.Image;
  bubbleIcon: Phaser.GameObjects.Image;
  status: AnimalStatus | null;
  /** Where it stands, in grid units inside the pen. */
  at: { x: number; y: number };
  target: { x: number; y: number };
  facing: Facing;
  /** Real ms to stand still before walking again. */
  rest: number;
}

const critters = new Map<string, Critter[]>();
/** Draw order inside a pen's container: back fences, then animals by how far forward they stand, then front fences. */
const sortKey = new WeakMap<Phaser.GameObjects.GameObject, number>();
const penReady = new Set<string>();

/** A random point inside the pen's walk area, in grid units. */
function randomSpot(type: PenType): { x: number; y: number } {
  const a = WALK_AREA[type];
  return { x: Phaser.Math.FloatBetween(a.x0, a.x1), y: Phaser.Math.FloatBetween(a.y0, a.y1) };
}

/** The pasture is grass with a fence of pack pieces around it; the coop is one pack sprite with its own run. */
function setUpPen(ctx: FarmContext, obj: PlacedObject<PenState>, view: ObjectView): void {
  if (penReady.has(obj.id)) return;
  penReady.add(obj.id);
  sortKey.set(view.sprite, -1e9);
  if (obj.type !== 'pasture') return;
  const { w, h } = PENS.pasture.footprint;
  view.sprite.setTexture(textureKey(ctx.scene, 'pasture-grass'));
  view.ground.add(view.sprite);
  for (const part of penFence(w, h)) {
    const p = footprintLocal(w, h, part.x, part.y);
    const piece = addArt(ctx.scene, p.x, p.y, part.art);
    sortKey.set(piece, (part.front ? 1000 : -1000) + part.x + part.y);
    view.container.add(piece);
    const shadow = addShadow(ctx.scene, p.x, p.y, part.art);
    if (shadow) view.shadows.add(shadow);
  }
}

function addCritter(ctx: FarmContext, obj: PlacedObject<PenState>, view: ObjectView, kind: AnimalKind): Critter {
  const scene = ctx.scene;
  const at = randomSpot(obj.type as PenType);
  const body = addArtSprite(scene, 0, 0, kind);
  const shadow = addShadow(scene, 0, 0, kind);
  const bubbleBg = scene.add.image(0, 0, 'animal-bubble');
  const bubbleIcon = scene.add.image(0, -27, 'missing');
  const bubble = scene.add.container(0, 0, [bubbleBg, bubbleIcon]).setVisible(false);
  sortKey.set(bubble, 1e9);
  view.container.add([body, bubble]);
  if (shadow) view.shadows.add(shadow);
  const dirs: Facing[] = ['se', 'sw', 'ne', 'nw'];
  const c: Critter = {
    kind,
    body,
    shadow,
    bubble,
    bubbleBg,
    bubbleIcon,
    status: null,
    at,
    target: randomSpot(obj.type as PenType),
    facing: dirs[Math.floor(Math.random() * dirs.length)],
    rest: Math.random() * 2000,
  };
  place(obj, c);
  return c;
}

function destroyCritter(c: Critter): void {
  c.body.destroy();
  c.shadow?.destroy();
  c.bubble.destroy();
}

/** Matches the sprites to `obj.state.animals` and updates every bubble. */
function sync(ctx: FarmContext, obj: PlacedObject<PenState>, view: ObjectView): void {
  setUpPen(ctx, obj, view);
  const animals = animalsOf(obj);
  let list = critters.get(obj.id) ?? [];
  // Rebuild from the first sprite whose kind no longer matches (cheap: pens hold ≤ 6).
  const keep = list.findIndex((c, i) => animals[i]?.kind !== c.kind);
  if (keep >= 0) {
    list.slice(keep).forEach(destroyCritter);
    list = list.slice(0, keep);
  }
  for (let i = list.length; i < animals.length; i++) list.push(addCritter(ctx, obj, view, animals[i].kind));
  critters.set(obj.id, list);
  updateBubbles(ctx, obj);
}

function updateBubbles(ctx: FarmContext, obj: PlacedObject<PenState>): void {
  const list = critters.get(obj.id);
  if (!list) return;
  const animals = obj.state.animals;
  list.forEach((c, i) => {
    const animal = animals[i];
    if (!animal) return;
    const status = animalStatus(ctx.game.state.clock, animal);
    if (status === c.status) return;
    c.status = status;
    if (status === 'producing') {
      c.bubble.setVisible(false);
      return;
    }
    const icon = status === 'hungry' ? 'feed' : ANIMALS[c.kind].product;
    c.bubbleIcon.setTexture(textureKey(ctx.scene, icon));
    c.bubbleIcon.setScale(BUBBLE_ICON / c.bubbleIcon.height);
    c.bubbleBg.setTint(BUBBLE_TINT[status]);
    c.bubble.setVisible(true);
  });
}

/** Moves the sprites to the critter's spot and picks its animation: walking, eating while it makes something, or idle. */
function place(obj: PlacedObject<PenState>, c: Critter): void {
  const { w, h } = PENS[obj.type as PenType].footprint;
  const p = footprintLocal(w, h, c.at.x, c.at.y);
  const walking = c.rest <= 0;
  const action = walking ? 'walk' : c.status === 'producing' ? 'eat' : 'idle';
  c.body.setPosition(p.x, p.y).play(`${c.kind}_${action}_${c.facing}`, true);
  sortKey.set(c.body, c.at.x + c.at.y);
  if (c.shadow) c.shadow.setPosition(p.x, p.y).setFrame(c.body.frame.name);
  // The bubble floats over the animal's head: its sprite rises this far above its anchor.
  const rise = (packAsset(c.kind)?.res['2x'].anchor[1] ?? 60) * ART_SCALE;
  c.bubble.setPosition(p.x, p.y - rise + 6);
}

function wander(obj: PlacedObject<PenState>, view: ObjectView, realDt: number): void {
  const list = critters.get(obj.id);
  if (!list) return;
  const type = obj.type as PenType;
  for (const c of list) {
    if (c.rest > 0) {
      c.rest -= realDt;
    } else {
      const dx = c.target.x - c.at.x;
      const dy = c.target.y - c.at.y;
      const dist = Math.hypot(dx, dy);
      const step = (SPEED[c.kind] * realDt) / 1000;
      if (dist <= step) {
        c.at = c.target;
        c.target = randomSpot(type);
        c.rest = 600 + Math.random() * 2600;
      } else {
        c.at = { x: c.at.x + (dx / dist) * step, y: c.at.y + (dy / dist) * step };
        c.facing = facing(dx, dy);
      }
    }
    place(obj, c);
    if (c.status === 'ready') c.bubble.y += Math.sin((view.container.scene.time.now + c.at.x * 900) / 220) * 1.5;
  }
  // Back fences, then animals front to back by how far forward they stand, front fences, bubbles on top.
  view.container.sort('y', (a: Phaser.GameObjects.GameObject, b: Phaser.GameObjects.GameObject) => (sortKey.get(a) ?? 0) - (sortKey.get(b) ?? 0));
}

function itemLabel(itemId: string): string {
  const item = getItem(itemId);
  return item ? `${item.icon} ${item.name}` : itemId;
}

function collectAndFloat(ctx: FarmContext, obj: PlacedObject<PenState>): void {
  const got = collect(ctx.game, obj);
  Object.entries(got).forEach(([itemId, n], i) => {
    const fp = PENS[obj.type as PenType].footprint;
    ctx.ui.floatText(obj.x + (fp.w - 1) / 2, obj.y - i * 0.6, `+${n} ${itemLabel(itemId)}`);
  });
}

const STATUS_TEXT: Record<AnimalStatus, (kind: AnimalKind) => string> = {
  hungry: () => 'hungry, needs feed',
  producing: (kind) => `eating, making ${getItem(ANIMALS[kind].product)?.name.toLowerCase() ?? 'something'}`,
  ready: (kind) => `${itemLabel(ANIMALS[kind].product)} ready!`,
};

function penPanel(ctx: FarmContext, obj: PlacedObject<PenState>): PanelSpec {
  const { game } = ctx;
  const pen = PENS[obj.type as PenType];
  const clock = game.state.clock;
  const animals = animalsOf(obj);
  const feed = game.count('feed');
  const need = feedNeeded(game, obj);
  const hungry = animals.filter((a) => animalStatus(clock, a) === 'hungry');
  const canFeedAny = hungry.some((a) => ANIMALS[a.kind].feedPerCycle <= feed);
  const ready = readyCount(clock, obj);
  const producing = animals.filter((a) => animalStatus(clock, a) === 'producing');

  const lines = [
    `Animals: ${animals.length} / ${pen.capacity}`,
    ...animals.map((a) => `${ANIMALS[a.kind].icon} ${ANIMALS[a.kind].name} — ${STATUS_TEXT[animalStatus(clock, a)](a.kind)}`),
    `${itemLabel('feed')} in stock: ${feed}`,
  ];
  if (animals.length === 0) lines.splice(1, 0, `Empty. Buy ${pen.animals.map((k) => ANIMALS[k].name.toLowerCase()).join(' or ')} below.`);

  const actions: PanelAction[] = [];
  if (ready > 0) actions.push({ label: `Collect (${ready})`, onClick: () => collectAndFloat(ctx, obj) });
  if (hungry.length > 0) {
    actions.push({
      label: `Feed all (${need} feed)`,
      disabled: !canFeedAny,
      onClick: () => {
        withFarmer(ctx, 'feed', obj, FEED_WORK_MS, () => {
          const fed = feedAll(game, obj);
          if (fed > 0) ctx.ui.toast(`Fed ${fed} ${fed === 1 ? 'animal' : 'animals'}`, 'success');
          return fed > 0;
        });
      },
    });
  }
  if (feed === 0 || feed < need) {
    actions.push({
      label: `Buy ${FEED_PACK.qty} feed for $${FEED_PACK.price}`,
      variant: 'secondary',
      disabled: !game.canAfford(FEED_PACK.price),
      onClick: () => {
        if (!buyFeed(game)) ctx.ui.toast('Not enough money', 'error');
      },
    });
  }
  for (const kind of pen.animals) {
    const def = ANIMALS[kind];
    if (!game.isUnlocked(def.unlockLevel)) {
      actions.push({ label: `🔒 ${def.name} · Unlocks at level ${def.unlockLevel}`, variant: 'secondary', disabled: true, onClick: () => {} });
      continue;
    }
    actions.push({
      label: `Buy ${def.name.toLowerCase()} $${def.price}`,
      variant: 'secondary',
      disabled: !checkBuyAnimal(game, obj, kind).ok,
      onClick: () => {
        const r = buyAnimal(game, obj, kind);
        if (!r.ok) ctx.ui.toast(r.reason === 'full' ? `The ${pen.name.toLowerCase()} is full` : 'Not enough money', 'error');
      },
    });
  }

  return {
    title: pen.name,
    icon: pen.icon,
    lines,
    progress:
      producing.length > 0
        ? { value: Math.max(...producing.map((a) => animalProgress(clock, a))), label: 'Next product' }
        : undefined,
    actions,
  };
}

for (const type of Object.keys(PENS) as PenType[]) {
  registerBehavior<PenState>(type, {
    create: sync,
    refresh: sync,
    update(ctx, obj, view) {
      updateBubbles(ctx, obj);
      // Walking is cosmetic, so it uses real time: debug speed should not make animals sprint.
      wander(obj, view, Math.min(ctx.scene.game.loop.delta, 100));
    },
    destroy(_ctx, obj) {
      critters.get(obj.id)?.forEach(destroyCritter);
      critters.delete(obj.id);
      penReady.delete(obj.id); // fence pieces go with the view's containers
    },
    // Clicking a pen with products waiting collects them; otherwise the panel opens.
    onClick(ctx, obj) {
      if (readyCount(ctx.game.state.clock, obj) === 0) return false;
      collectAndFloat(ctx, obj);
      return true;
    },
    panel: penPanel,
  });
}
