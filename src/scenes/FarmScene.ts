import Phaser from 'phaser';
import { getBuildable } from '../data/buildables';
import type { FarmContext, ObjectView, PanelSpec, ToolMode } from '../game/context';
import { getBehavior, runStartHooks, runTileTapHandlers } from '../game/hooks';
import { demolishRefund, footprintOf, type PlaceResult } from '../logic/game';
import { isOwned } from '../logic/land';
import type { PlacedObject } from '../logic/types';
import { TILE } from './textures';

const DRAG_THRESHOLD = 8;
const MAX_ZOOM = 3;
const KEY_PAN_SPEED = 700; // screen px per second
const FENCE = 0x8a5a2e;
const FENCE_LIGHT = 0xb07b45;

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
  private fence!: Phaser.GameObjects.Graphics;
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

  private get mapW(): number {
    return this.farm.state.land.width * TILE;
  }

  private get mapH(): number {
    return this.farm.state.land.height * TILE;
  }

  create(): void {
    this.ctx.scene = this;
    this.cameras.main.setBackgroundColor('#2f4a2a');

    this.fence = this.add.graphics().setDepth(2);
    this.hover = this.add.graphics().setDepth(900);
    this.ghostImage = this.add.image(0, 0, 'path').setOrigin(0).setAlpha(0.75);
    this.ghostFrame = this.add.graphics();
    this.ghost = this.add.container(0, 0, [this.ghostImage, this.ghostFrame]).setDepth(1000).setVisible(false);

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
        this.drawFence();
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
        this.ground.push(this.add.image(x * TILE, y * TILE, 'grass-0').setOrigin(0).setDepth(0));
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

  /** Fence along every edge between owned and locked land (or the map border). */
  private drawFence(): void {
    const { land } = this.farm.state;
    const g = this.fence.clear();
    const posts = new Set<string>();
    const rail = (x1: number, y1: number, x2: number, y2: number) => {
      const horizontal = y1 === y2;
      g.fillStyle(FENCE);
      if (horizontal) g.fillRect(x1, y1 - 3, x2 - x1, 2).fillRect(x1, y1 + 1, x2 - x1, 2);
      else g.fillRect(x1 - 3, y1, 2, y2 - y1).fillRect(x1 + 1, y1, 2, y2 - y1);
      posts.add(`${x1},${y1}`).add(`${x2},${y2}`);
    };
    for (let y = 0; y < land.height; y++) {
      for (let x = 0; x < land.width; x++) {
        if (!isOwned(land, x, y)) continue;
        const px = x * TILE;
        const py = y * TILE;
        if (!isOwned(land, x, y - 1)) rail(px, py, px + TILE, py);
        if (!isOwned(land, x, y + 1)) rail(px, py + TILE, px + TILE, py + TILE);
        if (!isOwned(land, x - 1, y)) rail(px, py, px, py + TILE);
        if (!isOwned(land, x + 1, y)) rail(px + TILE, py, px + TILE, py + TILE);
      }
    }
    for (const p of posts) {
      const [x, y] = p.split(',').map(Number);
      g.fillStyle(FENCE).fillRect(x - 3, y - 5, 6, 9);
      g.fillStyle(FENCE_LIGHT).fillRect(x - 2, y - 4, 4, 2);
    }
  }

  private createView(obj: PlacedObject): void {
    if (this.views.has(obj.id)) return;
    const def = getBuildable(obj.type);
    const fp = footprintOf(obj);
    const width = fp.w * TILE;
    const height = fp.h * TILE;
    const texture = def && this.textures.exists(def.texture) ? def.texture : 'missing';
    const sprite = this.add.image(0, 0, texture).setOrigin(0).setDisplaySize(width, height);
    const container = this.add.container(obj.x * TILE, obj.y * TILE, [sprite]);
    // Flat things (paths, fields) sit under tall things; tall things sort by their bottom edge.
    container.setDepth(10 + (obj.y + fp.h) * 0.01 + (def?.category === 'decor' ? 0 : 1));
    const view: ObjectView = { container, sprite, width, height };
    this.views.set(obj.id, { ...view, obj });
    getBehavior(obj.type)?.create?.(this.ctx, obj, view);
  }

  private destroyView(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    getBehavior(view.obj.type)?.destroy?.(this.ctx, view.obj, view);
    view.container.destroy();
    this.views.delete(id);
  }

  /** Floating text rising from a tile. */
  floatText(tileX: number, tileY: number, text: string, color = '#ffffff'): void {
    const t = this.add
      .text((tileX + 0.5) * TILE, tileY * TILE, text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color,
        stroke: '#2b2118',
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(2000);
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
    this.minZoom = Math.min(MAX_ZOOM, Math.max(0.2, Math.min(size.width / this.mapW, size.height / this.mapH)));
    cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.minZoom, MAX_ZOOM));
    this.clampCamera();
  }

  /**
   * Keeps the view on the map. When the map is smaller than the view on an axis
   * it is centred (Phaser's own bounds would pin it to the left/top edge).
   */
  private clampCamera(): void {
    const cam = this.cameras.main;
    const clampAxis = (scroll: number, view: number, size: number) => {
      const half = view / (2 * cam.zoom);
      const centre = scroll + view / 2;
      const c = 2 * half >= size ? size / 2 : Phaser.Math.Clamp(centre, half, size - half);
      return c - view / 2;
    };
    cam.setScroll(clampAxis(cam.scrollX, cam.width, this.mapW), clampAxis(cam.scrollY, cam.height, this.mapH));
  }

  /** Centres and zooms the camera on the owned land. */
  private focusOwnedLand(): void {
    const { land } = this.farm.state;
    let minX = land.width;
    let minY = land.height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < land.height; y++) {
      for (let x = 0; x < land.width; x++) {
        if (!isOwned(land, x, y)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + 1);
        maxY = Math.max(maxY, y + 1);
      }
    }
    if (maxX <= minX) [minX, minY, maxX, maxY] = [0, 0, land.width, land.height];
    const cam = this.cameras.main;
    const margin = 2;
    const zoom = Math.min(cam.width / ((maxX - minX + margin * 2) * TILE), cam.height / ((maxY - minY + margin * 2) * TILE));
    cam.setZoom(Phaser.Math.Clamp(zoom, this.minZoom, MAX_ZOOM));
    cam.centerOn(((minX + maxX) / 2) * TILE, ((minY + maxY) / 2) * TILE);
    this.clampCamera();
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
    const { tx, ty } = this.pointerTile(p);
    this.handleTap(tx, ty);
    this.updateCursor(p);
  }

  private pointerTile(p: Phaser.Input.Pointer): { tx: number; ty: number } {
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    return { tx: Math.floor(world.x / TILE), ty: Math.floor(world.y / TILE) };
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
      this.ghostImage.setDisplaySize(def.footprint.w * TILE, def.footprint.h * TILE);
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
      const w = def.footprint.w * TILE;
      const h = def.footprint.h * TILE;
      const color = ok ? 0x3ddc5a : 0xff4040;
      this.ghostFrame.clear().fillStyle(color, 0.35).fillRect(0, 0, w, h).lineStyle(2, color, 1).strokeRect(1, 1, w - 2, h - 2);
      this.ghost.setPosition(x * TILE, y * TILE).setVisible(true);
      this.ghost.setData('valid', ok);
    } else if (mode.kind === 'demolish') {
      const obj = this.ctx.game.objectAt(tx, ty);
      if (!obj) return;
      const fp = footprintOf(obj);
      this.hover
        .fillStyle(0xff4040, 0.3)
        .fillRect(obj.x * TILE, obj.y * TILE, fp.w * TILE, fp.h * TILE)
        .lineStyle(2, 0xff4040, 1)
        .strokeRect(obj.x * TILE + 1, obj.y * TILE + 1, fp.w * TILE - 2, fp.h * TILE - 2);
    }
  }
}
