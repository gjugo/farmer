import Phaser from 'phaser';
import { getBuildable } from '../data/buildables';
import type { FarmContext, ObjectView, PanelSpec, ToolMode } from '../game/context';
import { getBehavior, runStartHooks, runTileTapHandlers } from '../game/hooks';
import { demolishRefund, footprintOf, type PlaceResult } from '../logic/game';
import { isOwned } from '../logic/land';
import type { PlacedObject } from '../logic/types';
import {
  depthKey,
  footprintBox,
  footprintCorners,
  gridToWorld,
  ISO_H,
  ISO_W,
  mapBox,
  screenToWorld,
  sortFootprints,
  tileToWorld,
  worldToScreen,
  worldToTile,
  type Box,
  type Footprint,
  type Point,
} from './iso';
import { DEPTH } from './depth';
import { fenceLine, vectors } from './textures';

const DRAG_THRESHOLD = 8;
const MAX_ZOOM = 3;
const KEY_PAN_SPEED = 700; // screen px per second
/** Room above the map's top corner for buildings standing at the back. */
const MAP_TOP_ROOM = ISO_H * 3;
/** Build-menu categories that lie flat on the ground (always drawn under tall things). */
const FLAT_CATEGORIES = new Set(['decor', 'crops']);


const PLACE_ERRORS: Record<Exclude<PlaceResult, { ok: true }>['reason'], string> = {
  money: 'Not enough money',
  locked: "That land isn't yours yet",
  level: 'Not unlocked yet — reach a higher farm level',
  occupied: 'Something is already there',
  'out-of-bounds': "Can't build outside the farm",
  'unknown-type': 'Unknown building',
};

interface TouchState {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  dragging: boolean;
}

/** The farm world: ground, fences, placed objects, camera and pointer tools. */
export class FarmScene extends Phaser.Scene {
  private readonly ctx: FarmContext;
  private ground: Phaser.GameObjects.Image[] = [];
  /** One Graphics per straight run of the farm's boundary fence, each depth-sorted like a building. */
  private fences: { fp: Footprint; g: Phaser.GameObjects.Graphics }[] = [];
  private depthsDirty = true;
  /** Buying a parcel announces each tile; the fence is redrawn once per frame at most. */
  private fenceDirty = false;
  private views = new Map<string, ObjectView & { obj: PlacedObject }>();
  private ghost!: Phaser.GameObjects.Container;
  private ghostImage!: Phaser.GameObjects.Image;
  private ghostFrame!: Phaser.GameObjects.Graphics;
  private hover!: Phaser.GameObjects.Graphics;
  private touches = new Map<number, TouchState>();
  private pinch: { dist: number; zoom: number } | null = null;
  private minZoom = 0.25;
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', Phaser.Input.Keyboard.Key>;
  private unsubscribe: (() => void)[] = [];
  private started = false;

  constructor(ctx: FarmContext) {
    super('Farm');
    this.ctx = ctx;
  }

  private get farm() {
    return this.ctx.game;
  }

  /** World box around the map's diamond, with room above it for tall things at the back. */
  private get mapBounds(): Box {
    const { width, height } = this.farm.state.land;
    const box = mapBox(width, height);
    return { ...box, top: box.top - MAP_TOP_ROOM, height: box.height + MAP_TOP_ROOM };
  }

  create(): void {
    this.ctx.scene = this;
    this.cameras.main.setBackgroundColor('#2f4a2a');

    this.hover = this.add.graphics().setDepth(DEPTH.hover);
    this.ghostImage = this.add.image(0, 0, 'path').setOrigin(0, 1).setAlpha(0.75);
    this.ghostFrame = this.add.graphics();
    this.ghost = this.add.container(0, 0, [this.ghostImage, this.ghostFrame]).setDepth(DEPTH.ghost).setVisible(false);

    this.buildWorld();
    this.setupCamera();
    this.setupInput();

    const { events } = this.farm;
    this.unsubscribe.push(
      events.on('objectAdded', (o) => this.createView(o)),
      events.on('objectRemoved', (o) => this.destroyView(o.id)),
      events.on('objectChanged', (o) => {
        const view = this.views.get(o.id);
        if (view) getBehavior(o.type)?.refresh?.(this.ctx, o, view);
      }),
      events.on('land', ({ x, y }) => {
        this.paintTile(x, y);
        this.fenceDirty = true;
      }),
      events.on('reset', () => {
        this.buildWorld();
        this.focusOwnedLand();
      }),
      this.ctx.tools.events.on('change', (mode) => this.onToolChange(mode)),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubscribe.forEach((u) => u()));
    if (!this.started) {
      this.started = true;
      runStartHooks(this.ctx);
    }
  }

  override update(_time: number, delta: number): void {
    const dt = this.farm.tick(delta);
    this.panWithKeys(delta);
    this.clampCamera();
    if (this.fenceDirty) {
      this.fenceDirty = false;
      this.drawFence();
    }
    if (this.depthsDirty) this.sortDepths();
    for (const obj of this.farm.state.objects) {
      const behavior = getBehavior(obj.type);
      const view = this.views.get(obj.id);
      if (behavior?.update && view) behavior.update(this.ctx, obj, view, dt);
    }
  }

  // World -----------------------------------------------------------------------

  private buildWorld(): void {
    for (const id of [...this.views.keys()]) this.destroyView(id);
    for (const img of this.ground) img.destroy();
    this.ground = [];
    const { width, height } = this.farm.state.land;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = tileToWorld(x, y);
        this.ground.push(this.add.image(c.x, c.y, 'grass-0').setDepth(DEPTH.ground));
        this.paintTile(x, y);
      }
    }
    this.drawFence();
    for (const obj of this.farm.state.objects) this.createView(obj);
  }

  private paintTile(x: number, y: number): void {
    const { land } = this.farm.state;
    const img = this.ground[y * land.width + x];
    if (!img) return;
    const variant = (x * 7 + y * 13 + ((x * y) % 5)) % 3;
    img.setTexture(`${isOwned(land, x, y) ? 'grass' : 'locked'}-${variant}`);
  }

  /** Fence along every edge between owned and locked land (or the map border), one Graphics per straight run. */
  private drawFence(): void {
    const { land } = this.farm.state;
    for (const f of this.fences) f.g.destroy();
    this.fences = [];
    const owned = (x: number, y: number) => isOwned(land, x, y);
    const runs: Footprint[] = [];
    // Lines y = k (between rows k-1 and k), then lines x = k (between columns k-1 and k).
    for (let k = 0; k <= land.height; k++) {
      for (let x = 0; x < land.width; ) {
        if (owned(x, k - 1) === owned(x, k)) {
          x++;
          continue;
        }
        const start = x;
        while (x < land.width && owned(x, k - 1) !== owned(x, k)) x++;
        runs.push({ x: start, y: k, w: x - start, h: 0 });
      }
    }
    for (let k = 0; k <= land.width; k++) {
      for (let y = 0; y < land.height; ) {
        if (owned(k - 1, y) === owned(k, y)) {
          y++;
          continue;
        }
        const start = y;
        while (y < land.height && owned(k - 1, y) !== owned(k, y)) y++;
        runs.push({ x: k, y: start, w: 0, h: y - start });
      }
    }
    for (const fp of runs) {
      const g = this.add.graphics();
      const a = gridToWorld(fp.x, fp.y);
      const b = gridToWorld(fp.x + fp.w, fp.y + fp.h);
      fenceLine(g, a, b, fp.w + fp.h);
      this.fences.push({ fp, g });
    }
    this.depthsDirty = true;
  }

  /**
   * Flat things sort by their front corner under every tall thing. Tall things (buildings, pens and
   * fence runs) get a back-to-front order from their footprints, so whatever stands in front covers
   * what is behind it. Runs only when something was added, removed or the land changed.
   */
  private sortDepths(): void {
    this.depthsDirty = false;
    const tall: { fp: Footprint; target: Phaser.GameObjects.Components.Depth }[] = this.fences.map((f) => ({
      fp: f.fp,
      target: f.g,
    }));
    for (const view of this.views.values()) {
      const fp = { x: view.obj.x, y: view.obj.y, ...footprintOf(view.obj) };
      if (FLAT_CATEGORIES.has(getBuildable(view.obj.type)?.category ?? '')) {
        view.container.setDepth(DEPTH.flat + depthKey(fp) * 1e-4);
      } else {
        tall.push({ fp, target: view.container });
      }
    }
    const order = sortFootprints(tall.map((t) => t.fp));
    order.forEach((idx, rank) => tall[idx].target.setDepth(DEPTH.tall + rank / (order.length + 1)));
  }

  private createView(obj: PlacedObject): void {
    if (this.views.has(obj.id)) return;
    const def = getBuildable(obj.type);
    const box = footprintBox({ x: obj.x, y: obj.y, ...footprintOf(obj) });
    const texture = def && this.textures.exists(def.texture) ? def.texture : 'missing';
    const sprite = this.add.image(0, 0, texture);
    this.fitToFootprint(sprite, box);
    const container = this.add.container(box.left, box.top, [sprite]);
    const view: ObjectView = { container, sprite, width: box.width, height: box.height };
    this.views.set(obj.id, { ...view, obj });
    this.depthsDirty = true;
    getBehavior(obj.type)?.create?.(this.ctx, obj, view);
  }

  private destroyView(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    getBehavior(view.obj.type)?.destroy?.(this.ctx, view.obj, view);
    view.container.destroy();
    this.views.delete(id);
  }

  /**
   * Stands a texture on a footprint: its bottom edge on the box's bottom (the diamond's front corner),
   * scaled only when the texture was drawn for a different footprint (e.g. the `missing` fallback).
   */
  private fitToFootprint(img: Phaser.GameObjects.Image, box: Box): void {
    img.setOrigin(0, 1).setPosition(0, box.height);
    img.setScale(img.frame.width === box.width ? 1 : box.width / img.frame.width);
  }

  /** Floating text rising from a tile. */
  floatText(tileX: number, tileY: number, text: string, color = '#ffffff'): void {
    const at = tileToWorld(tileX, tileY);
    const t = this.add
      .text(at.x, at.y - ISO_H / 2, text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color,
        stroke: '#2b2118',
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.floatText);
    this.tweens.add({
      targets: t,
      y: t.y - 28,
      alpha: 0,
      duration: 1100,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  // Camera ----------------------------------------------------------------------

  private setupCamera(): void {
    this.onResize(this.scale.gameSize);
    this.focusOwnedLand();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this));
  }

  private onResize(size: Phaser.Structs.Size): void {
    const cam = this.cameras.main;
    cam.setSize(size.width, size.height);
    // Zooming out stops when the whole map is visible.
    const map = this.mapBounds;
    this.minZoom = Math.min(MAX_ZOOM, Math.max(0.1, Math.min(size.width / map.width, size.height / map.height)));
    cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.minZoom, MAX_ZOOM));
    this.clampCamera();
  }

  /**
   * Keeps the view on the map. When the map is smaller than the view on an axis
   * it is centred (Phaser's own bounds would pin it to the left/top edge).
   */
  private clampCamera(): void {
    const cam = this.cameras.main;
    const map = this.mapBounds;
    const clampAxis = (scroll: number, view: number, min: number, size: number) => {
      const half = view / (2 * cam.zoom);
      const centre = scroll + view / 2;
      const c = 2 * half >= size ? min + size / 2 : Phaser.Math.Clamp(centre, min + half, min + size - half);
      return c - view / 2;
    };
    cam.setScroll(clampAxis(cam.scrollX, cam.width, map.left, map.width), clampAxis(cam.scrollY, cam.height, map.top, map.height));
  }

  /** Centres and zooms the camera on the owned land's diamonds. */
  private focusOwnedLand(): void {
    const { land } = this.farm.state;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (p: Point) => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    };
    for (let y = 0; y < land.height; y++) {
      for (let x = 0; x < land.width; x++) {
        if (!isOwned(land, x, y)) continue;
        const c = footprintCorners({ x, y, w: 1, h: 1 });
        [c.top, c.right, c.bottom, c.left].forEach(add);
      }
    }
    if (minX > maxX) {
      const map = mapBox(land.width, land.height);
      add({ x: map.left, y: map.top });
      add({ x: map.left + map.width, y: map.top + map.height });
    }
    const cam = this.cameras.main;
    const margin = ISO_W;
    const zoom = Math.min(cam.width / (maxX - minX + margin * 2), cam.height / (maxY - minY + margin * 2));
    cam.setZoom(Phaser.Math.Clamp(zoom, this.minZoom, MAX_ZOOM));
    cam.centerOn((minX + maxX) / 2, (minY + maxY) / 2);
    this.clampCamera();
  }

  /** Screen (page) pixel of a tile's centre at the current camera; for QA scripts that click tiles. */
  tileToScreen(x: number, y: number): Point {
    const c = tileToWorld(x, y);
    const s = worldToScreen(this.cameras.main, c.x, c.y);
    const rect = this.game.canvas.getBoundingClientRect();
    return { x: rect.left + s.x * (rect.width / this.scale.width), y: rect.top + s.y * (rect.height / this.scale.height) };
  }

  /** Zooms keeping the world point under (sx, sy) fixed on screen. */
  private zoomAt(sx: number, sy: number, zoom: number): void {
    const cam = this.cameras.main;
    const z = Phaser.Math.Clamp(zoom, this.minZoom, MAX_ZOOM);
    const ox = cam.width / 2;
    const oy = cam.height / 2;
    const wx = cam.scrollX + ox + (sx - ox) / cam.zoom;
    const wy = cam.scrollY + oy + (sy - oy) / cam.zoom;
    cam.setZoom(z);
    cam.setScroll(wx - ox - (sx - ox) / z, wy - oy - (sy - oy) / z);
    this.clampCamera();
  }

  private panBy(dxScreen: number, dyScreen: number): void {
    const cam = this.cameras.main;
    cam.setScroll(cam.scrollX - dxScreen / cam.zoom, cam.scrollY - dyScreen / cam.zoom);
    this.clampCamera();
  }

  private panWithKeys(delta: number): void {
    const k = this.keys;
    const step = (KEY_PAN_SPEED * Math.min(delta, 100)) / 1000;
    const dx = (k.LEFT.isDown || k.A.isDown ? 1 : 0) - (k.RIGHT.isDown || k.D.isDown ? 1 : 0);
    const dy = (k.UP.isDown || k.W.isDown ? 1 : 0) - (k.DOWN.isDown || k.S.isDown ? 1 : 0);
    if (dx || dy) this.panBy(dx * step, dy * step);
  }

  // Input -----------------------------------------------------------------------

  private setupInput(): void {
    this.input.addPointer(1); // two touch points for pinch
    this.input.mouse?.disableContextMenu();
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', true, true) as typeof this.keys;
    kb.on('keydown-ESC', () => this.ctx.tools.cancel());

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.GAME_OUT, () => {
      this.ghost.setVisible(false);
      this.hover.clear();
    });
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
        this.zoomAt(p.x, p.y, this.cameras.main.zoom * Math.exp(-dy * 0.0015));
      },
    );
  }

  private activeTouches(): Phaser.Input.Pointer[] {
    return [this.input.pointer1, this.input.pointer2].filter((p) => p?.isDown);
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (p.rightButtonDown()) {
      this.ctx.tools.cancel();
      return;
    }
    this.touches.set(p.id, { startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, dragging: false });
    const touches = this.activeTouches();
    if (touches.length === 2) {
      // A second finger turns the gesture into a pinch; neither finger will tap.
      for (const t of this.touches.values()) t.dragging = true;
      this.pinch = { dist: this.touchDistance(touches), zoom: this.cameras.main.zoom };
    }
  }

  private touchDistance([a, b]: Phaser.Input.Pointer[]): number {
    return Math.max(1, Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y));
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    const touches = this.activeTouches();
    if (this.pinch && touches.length === 2) {
      const [a, b] = touches;
      this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (this.pinch.zoom * this.touchDistance(touches)) / this.pinch.dist);
      return;
    }
    const t = this.touches.get(p.id);
    if (t && p.isDown) {
      if (!t.dragging && Phaser.Math.Distance.Between(t.startX, t.startY, p.x, p.y) > DRAG_THRESHOLD) t.dragging = true;
      if (t.dragging) this.panBy(p.x - t.lastX, p.y - t.lastY);
      t.lastX = p.x;
      t.lastY = p.y;
    }
    this.updateCursor(p);
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    const t = this.touches.get(p.id);
    this.touches.delete(p.id);
    if (this.activeTouches().length < 2) this.pinch = null;
    if (!t || t.dragging) return;
    const { tx, ty } = this.tapTarget(p);
    this.handleTap(tx, ty);
    this.updateCursor(p);
  }

  private pointerTile(p: Phaser.Input.Pointer): { tx: number; ty: number } {
    const world = screenToWorld(this.cameras.main, p.x, p.y);
    const t = worldToTile(world.x, world.y);
    return { tx: t.x, ty: t.y };
  }

  /**
   * The tile a tap means. In normal mode, an interactive display object carrying a `tapTile`
   * ({ x, y }) wins over the ground under it, e.g. a "for sale" sign standing up over other tiles.
   */
  private tapTarget(p: Phaser.Input.Pointer): { tx: number; ty: number } {
    if (this.ctx.tools.mode.kind === 'normal') {
      for (const obj of this.input.hitTestPointer(p)) {
        const tile = obj.getData('tapTile') as Point | undefined;
        if (tile) return { tx: tile.x, ty: tile.y };
      }
    }
    return this.pointerTile(p);
  }

  /** Top-left tile for a footprint centred under the pointer. */
  private anchorFor(type: string, tx: number, ty: number): { x: number; y: number } {
    const fp = getBuildable(type)?.footprint ?? { w: 1, h: 1 };
    return { x: tx - Math.floor((fp.w - 1) / 2), y: ty - Math.floor((fp.h - 1) / 2) };
  }

  private handleTap(tx: number, ty: number): void {
    const { game, ui, tools } = this.ctx;
    const mode = tools.mode;
    if (mode.kind === 'build') {
      const { x, y } = this.anchorFor(mode.type, tx, ty);
      const result = game.place(mode.type, x, y);
      if (result.ok) {
        const cost = getBuildable(mode.type)?.cost ?? 0;
        if (cost > 0) this.floatText(x, y, `-$${cost}`, '#ffd6a0');
      } else {
        ui.toast(PLACE_ERRORS[result.reason], 'error');
      }
      return;
    }
    const obj = game.objectAt(tx, ty);
    if (mode.kind === 'demolish') {
      if (!obj) {
        ui.toast('Nothing to demolish here', 'error');
        return;
      }
      const refund = game.demolish(obj.id) ?? 0;
      this.floatText(obj.x, obj.y, `+$${refund}`, '#c8ff9e');
      return;
    }
    if (!obj) {
      if (!runTileTapHandlers(this.ctx, tx, ty)) ui.closePanel();
      return;
    }
    this.openObjectPanel(obj);
  }

  private openObjectPanel(obj: PlacedObject): void {
    const behavior = getBehavior(obj.type);
    if (behavior?.onClick?.(this.ctx, obj) === true) return;
    const { game, ui } = this.ctx;
    const def = getBuildable(obj.type);
    ui.openPanel(() => {
      if (!game.getObject(obj.id)) return null; // demolished meanwhile
      const spec: PanelSpec = behavior?.panel?.(this.ctx, obj) ?? {
        title: def?.name ?? obj.type,
        lines: def?.description ? [def.description] : [],
      };
      const refund = demolishRefund(def);
      return {
        ...spec,
        actions: [
          ...(spec.actions ?? []),
          {
            label: `Demolish (+$${refund})`,
            variant: 'danger',
            onClick: () => {
              game.demolish(obj.id);
              this.floatText(obj.x, obj.y, `+$${refund}`, '#c8ff9e');
            },
          },
        ],
      };
    });
  }

  // Tool feedback -------------------------------------------------------------------

  private onToolChange(mode: ToolMode): void {
    this.hover.clear();
    this.ghost.setVisible(false);
    if (mode.kind === 'build') {
      const def = getBuildable(mode.type);
      if (!def) return;
      this.ghostImage.setTexture(this.textures.exists(def.texture) ? def.texture : 'missing');
      this.fitToFootprint(this.ghostImage, footprintBox({ x: 0, y: 0, ...def.footprint }));
    }
    const p = this.input.activePointer;
    if (p && !p.wasTouch && this.input.isOver) this.updateCursor(p);
  }

  private updateCursor(p: Phaser.Input.Pointer): void {
    const mode = this.ctx.tools.mode;
    const { tx, ty } = this.pointerTile(p);
    this.hover.clear();
    if (mode.kind === 'build') {
      // On touch screens there is no hover; the ghost shows where the last tap landed.
      const def = getBuildable(mode.type);
      if (!def) return;
      const { x, y } = this.anchorFor(mode.type, tx, ty);
      const ok = this.ctx.game.checkPlacement(mode.type, x, y).ok && this.ctx.game.canAfford(def.cost);
      const fp = { x, y, ...def.footprint };
      const box = footprintBox(fp);
      const color = ok ? 0x3ddc5a : 0xff4040;
      // The frame is drawn in the ghost's own space, whose origin is the footprint's box corner.
      const local = this.diamond(fp).map((q) => ({ x: q.x - box.left, y: q.y - box.top }));
      this.ghostFrame.clear().fillStyle(color, 0.35).fillPoints(vectors(local), true).lineStyle(2, color, 1).strokePoints(vectors(local), true);
      this.ghost.setPosition(box.left, box.top).setVisible(true);
      this.ghost.setData('valid', ok);
      this.ghost.setData('tile', { x, y });
    } else if (mode.kind === 'demolish') {
      const obj = this.ctx.game.objectAt(tx, ty);
      if (!obj) return;
      const points = this.diamond({ x: obj.x, y: obj.y, ...footprintOf(obj) });
      this.hover.fillStyle(0xff4040, 0.3).fillPoints(vectors(points), true).lineStyle(2, 0xff4040, 1).strokePoints(vectors(points), true);
    } else {
      // Normal mode: outline the tile under a mouse pointer.
      if (p.wasTouch) return;
      this.hover.lineStyle(1.5, 0xffffff, 0.55).strokePoints(vectors(this.diamond({ x: tx, y: ty, w: 1, h: 1 })), true);
    }
  }

  /** A footprint's diamond in world pixels, as a closed polygon. */
  private diamond(fp: Footprint): Point[] {
    const c = footprintCorners(fp);
    return [c.top, c.right, c.bottom, c.left];
  }
}
