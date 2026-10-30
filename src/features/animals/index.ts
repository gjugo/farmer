import Phaser from 'phaser';
import { ANIMALS, FEED_PACK, PENS, type AnimalKind, type PenType } from '../../data/animals';
import { getItem } from '../../data/items';
import type { FarmContext, ObjectView, PanelAction, PanelSpec, PlacedObject } from '../../game/context';
import { registerBehavior } from '../../game/hooks';
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
import { footprintLocal } from '../../scenes/iso';
import { WALK_AREA } from './textures';

/** Walking speed in pixels per real second. */
const SPEED: Record<AnimalKind, number> = { chicken: 30, cow: 13, sheep: 17 };

const BUBBLE_TINT: Record<Exclude<AnimalStatus, 'producing'>, number> = { hungry: 0xffd4c4, ready: 0xd6ffc4 };

interface Critter {
  kind: AnimalKind;
  body: Phaser.GameObjects.Image;
  bubble: Phaser.GameObjects.Container;
  bubbleBg: Phaser.GameObjects.Image;
  bubbleIcon: Phaser.GameObjects.Text;
  status: AnimalStatus | null;
  target: { x: number; y: number };
  /** Real ms to stand still before walking again. */
  rest: number;
}

const critters = new Map<string, Critter[]>();
/** The front fences of each pen, kept above the animals. */
const fronts = new Map<string, Phaser.GameObjects.Image>();

/** A random point inside the pen's walk area, picked in tile space and returned in the view's pixels. */
function randomSpot(type: PenType): { x: number; y: number } {
  const a = WALK_AREA[type];
  const { w, h } = PENS[type].footprint;
  let gx: number;
  let gy: number;
  do {
    gx = Phaser.Math.FloatBetween(a.min, a.max);
    gy = Phaser.Math.FloatBetween(a.min, a.max);
  } while (gx + gy < a.minSum);
  return footprintLocal(w, h, gx, gy);
}

function addCritter(ctx: FarmContext, obj: PlacedObject<PenState>, view: ObjectView, kind: AnimalKind): Critter {
  const scene = ctx.scene;
  const spot = randomSpot(obj.type as PenType);
  const body = scene.add.image(spot.x, spot.y, `animal-${kind}`).setOrigin(0.5, 1);
  body.setFlipX(Math.random() < 0.5);
  const bubbleBg = scene.add.image(0, 0, 'animal-bubble').setOrigin(0.5, 1);
  const bubbleIcon = scene.add
    .text(0, -9, '', { fontFamily: 'system-ui, sans-serif', fontSize: '11px', resolution: 2 })
    .setOrigin(0.5, 0.5);
  const bubble = scene.add.container(spot.x, spot.y, [bubbleBg, bubbleIcon]).setVisible(false);
  view.container.add([body, bubble]);
  return { kind, body, bubble, bubbleBg, bubbleIcon, status: null, target: randomSpot(obj.type as PenType), rest: Math.random() * 2000 };
}

function destroyCritter(c: Critter): void {
  c.body.destroy();
  c.bubble.destroy();
}

/** Matches the sprites to `obj.state.animals` and updates every bubble. */
function sync(ctx: FarmContext, obj: PlacedObject<PenState>, view: ObjectView): void {
  if (!fronts.has(obj.id)) {
    const front = ctx.scene.add.image(0, view.height, `${obj.type}-front`).setOrigin(0, 1);
    view.container.add(front);
    fronts.set(obj.id, front);
  }
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
    const icon = status === 'hungry' ? (getItem('feed')?.icon ?? '!') : (getItem(ANIMALS[c.kind].product)?.icon ?? '?');
    c.bubbleIcon.setText(icon);
    c.bubbleBg.setTint(BUBBLE_TINT[status]);
    c.bubble.setVisible(true);
  });
}

function wander(obj: PlacedObject<PenState>, view: ObjectView, realDt: number): void {
  const list = critters.get(obj.id);
  if (!list) return;
  const type = obj.type as PenType;
  for (const c of list) {
    if (c.rest > 0) {
      c.rest -= realDt;
    } else {
      const dx = c.target.x - c.body.x;
      const dy = c.target.y - c.body.y;
      const dist = Math.hypot(dx, dy);
      const step = (SPEED[c.kind] * realDt) / 1000;
      if (dist <= step) {
        c.body.setPosition(c.target.x, c.target.y);
        c.target = randomSpot(type);
        c.rest = 600 + Math.random() * 2600;
      } else {
        c.body.setPosition(c.body.x + (dx / dist) * step, c.body.y + (dy / dist) * step);
        if (Math.abs(dx) > 0.5) c.body.setFlipX(dx < 0);
      }
    }
    c.bubble.setPosition(c.body.x, c.body.y - c.body.height + 1);
    if (c.status === 'ready') c.bubble.y += Math.sin((view.container.scene.time.now + c.body.x * 40) / 220) * 1.5;
  }
  // Nearer animals overlap farther ones, the front fences overlap them all; bubbles always on top.
  view.container.sort('y');
  view.container.sendToBack(view.sprite);
  const front = fronts.get(obj.id);
  if (front) view.container.bringToTop(front);
  for (const c of list) if (c.bubble.visible) view.container.bringToTop(c.bubble);
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
        const fed = feedAll(game, obj);
        if (fed > 0) ctx.ui.toast(`Fed ${fed} ${fed === 1 ? 'animal' : 'animals'}`, 'success');
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
      fronts.delete(obj.id); // destroyed with the view's container
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
