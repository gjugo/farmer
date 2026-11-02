import Phaser from 'phaser';
import { getBuildable } from '../data/buildables';
import { splitIcons } from '../data/items';
import { formatMaterials, needsMaterialsMessage } from '../data/materials';
import { buildWorkMs } from '../data/workers';
import type { FarmContext, ObjectView, PanelSpec, ToolMode } from '../game/context';
import { getBehavior, runBuildPreview, runStartHooks, runTileTapHandlers, type BuildPreview } from '../game/hooks';
import { farmerName, NO_ROAD_MESSAGE, reachable, workplacePanel } from '../game/workers';
import { formatDuration } from '../logic/crops';
import { footprintOf, refundOf, type DemolishCheck, type PlaceResult } from '../logic/game';
import { demolishBlockedMessage } from '../logic/storage';
import { siteProgress } from '../logic/work';
import { isOwned } from '../logic/land';
import { depositAt, mapOf, treeAt } from '../logic/maplayer';
import { farmhouseOf } from '../logic/roads';
import { soilAt } from '../logic/soil';
import type { PlacedObject } from '../logic/types';
import { ART_RES, ART_SCALE, CURSOR, grassArt, groundTint, sceneryArt, seasonalArt, unownedArt } from './art';
import { GROUND_ATLAS } from './BootScene';
import { DEPTH, setStandingDepths } from './depth';
import {
  depthKey,
  footprintBox,
  footprintLocal,
  gridToWorld,
  ISO_H,
  mapBox,
  openingView,
  screenToWorld,
  sortFootprints,
  tileToWorld,
  worldToScreen,
  worldToTile,
  type Box,
  type Footprint,
  type Point,
} from './iso';
import { addArt, addShadow, artSeason, fitScale, packAsset, textureKey } from './sprites';

const DRAG_THRESHOLD = 8;
/** At zoom 2 the 2x art is drawn pixel for pixel. */
const MAX_ZOOM = 2;
const KEY_PAN_SPEED = 700; // screen px per second
/** Room above the map's top corner for buildings standing at the back. */
const MAP_TOP_ROOM = ISO_H * 3;
/** Build-menu categories whose base art lies flat on the ground (under every shadow and standing thing). */
const FLAT_CATEGORIES = new Set(['decor', 'crops']);
/** Scenery keeps this many tiles clear of owned land, where the fence-side "for sale" signs stand. */
const SCENERY_CLEARANCE = 4;
/** Construction sites are drawn faded to this, with a progress bar this wide (world pixels). */
const SITE_ALPHA = 0.45;
const SITE_BAR_W = 64;
/** Size of floating text, in world pixels. */
const FLOAT_FONT = Math.round(ISO_H * 0.45);


const PLACE_ERRORS: Record<Exclude<PlaceResult, { ok: true }>['reason'], string> = {
  money: 'Not enough money',
  materials: 'Not enough building materials',
  locked: "That land isn't yours yet",
  level: 'Not unlocked yet — reach a higher farm level',
  occupied: 'Something is already there',
  'out-of-bounds': "Can't build outside the farm",
  'unknown-type': 'Unknown building',
  tree: 'A tree stands there: a woodcutter can fell it',
  deposit: 'Rock is in the way: only a quarry or mine stands on it',
  'needs-outcrop': 'A quarry must stand on a stone outcrop',
  'needs-vein': 'A mine must stand on an iron vein',
};

/**
 * What demolishing gives back, e.g. "$132 and 3 🪵 Wood + 1 🔩 Iron", plus what the storehouses have no room for.
 */
function demolishText(check: Extract<DemolishCheck, { ok: true }>): string {
  const materials = formatMaterials(check.materials);
  const lost = formatMaterials(check.lost);
  return `$${check.money}${materials ? ` and ${materials}` : ''}${lost ? `. ${lost} won't fit in the storehouse and would be lost` : ''}`;
}

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
  /** The whole ground is one Blitter (in a container that scales it): a bob per tile, created back to front. */
  private groundLayer: Phaser.GameObjects.Container | null = null;
  private groundBobs: Phaser.GameObjects.Bob[] = [];
  /** Bushes and ponds on locked land, each depth-sorted like a building. */
  private scenery: { fp: Footprint; img: Phaser.GameObjects.Image }[] = [];
  private sceneryShadows!: Phaser.GameObjects.Container;
  private depthsDirty = true;
  /** Buying a parcel announces each tile; the scenery is redone once per frame at most. */
  private sceneryDirty = false;
  private views = new Map<string, ObjectView & { obj: PlacedObject }>();
  /** Progress bars over construction sites, by object id. */
  private siteBars = new Map<string, { bar: Phaser.GameObjects.Container; fill: Phaser.GameObjects.Rectangle }>();
  private ghost!: Phaser.GameObjects.Image;
  /** Why the build ghost is red, under it. */
  private ghostReason!: Phaser.GameObjects.Text;
  /** Standing things drawn by features (e.g. trees and deposits, `src/features/nature`), sorted with the rest. */
  private extraStanding = new Map<string, { fp: Footprint; target: Phaser.GameObjects.Components.Depth }[]>();
  /** Tile cursors (pack overlays) for the hover, build preview and demolish target. */
  private cursors: Phaser.GameObjects.Image[] = [];
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

    this.ghost = addArt(this, 0, 0, 'path').setAlpha(0.75).setDepth(DEPTH.ghost).setVisible(false);
    this.ghostReason = this.add
      .text(0, 0, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: `${FLOAT_FONT}px`,
        fontStyle: 'bold',
        color: '#ffd0c8',
        stroke: '#2b2118',
        strokeThickness: Math.round(FLOAT_FONT / 5),
        resolution: 2,
        align: 'center',
        wordWrap: { width: ISO_H * 7 },
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.ghost + 1)
      .setVisible(false)
      .setName('ghost-reason');
    this.sceneryShadows = this.add.container(0, 0).setDepth(DEPTH.shadow);

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
        this.sceneryDirty = true;
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
    if (!this.farm.paused) this.panWithKeys(delta);
    this.clampCamera();
    if (this.sceneryDirty) {
      this.sceneryDirty = false;
      this.placeScenery();
    }
    if (this.depthsDirty) this.sortDepths();
    for (const obj of this.farm.state.objects) {
      const behavior = getBehavior(obj.type);
      const view = this.views.get(obj.id);
      if (!view) continue;
      this.drawSite(view);
      if (behavior?.update) behavior.update(this.ctx, obj, view, dt);
    }
  }

  /** A construction site is its building faded, with a bar showing how far the building work is. */
  private drawSite(view: ObjectView & { obj: PlacedObject }): void {
    const { obj } = view;
    const alpha = obj.site ? SITE_ALPHA : 1;
    if (view.container.alpha !== alpha) {
      view.container.setAlpha(alpha);
      view.ground.setAlpha(alpha);
      view.shadows.setAlpha(alpha);
    }
    let decor = this.siteBars.get(obj.id);
    if (!obj.site) {
      if (decor) {
        decor.bar.destroy();
        this.siteBars.delete(obj.id);
      }
      return;
    }
    if (!decor) {
      const back = this.add.rectangle(0, 0, SITE_BAR_W + 4, 10, 0x2b2118);
      const fill = this.add.rectangle(-SITE_BAR_W / 2, 0, 0, 6, 0xf2b84b).setOrigin(0, 0.5);
      const label = this.add.text(0, -16, '🚧', { fontSize: '22px', resolution: 2 }).setOrigin(0.5, 0.5);
      const fp = footprintOf(obj);
      const at = gridToWorld(obj.x + fp.w / 2, obj.y + fp.h / 2);
      decor = { bar: this.add.container(at.x, at.y - ISO_H / 2, [back, fill, label]).setDepth(DEPTH.hover - 1), fill };
      this.siteBars.set(obj.id, decor);
    }
    decor.fill.width = SITE_BAR_W * (siteProgress(this.farm.state, obj.id)?.progress ?? 0);
  }

  // World -----------------------------------------------------------------------

  private buildWorld(): void {
    for (const id of [...this.views.keys()]) this.destroyView(id);
    this.groundLayer?.destroy();
    const { width, height } = this.farm.state.land;
    // Bobs draw in creation order, so go back to front: overgrown tiles reach up over the tile behind them.
    // A Blitter ignores its own scale when drawing, so a scaled container brings the 2x tiles to world size.
    const blitter = this.add.blitter(0, 0, GROUND_ATLAS);
    this.groundLayer = this.add.container(0, 0, [blitter]).setScale(ART_SCALE).setDepth(DEPTH.ground);
    this.groundBobs = new Array(width * height);
    for (let sum = 0; sum <= width + height - 2; sum++) {
      for (let x = Math.max(0, sum - height + 1); x <= Math.min(sum, width - 1); x++) {
        this.groundBobs[(sum - x) * width + x] = blitter.create(0, 0, seasonalArt('grass_0', artSeason()));
      }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) this.paintTile(x, y);
    this.placeScenery();
    for (const obj of this.farm.state.objects) this.createView(obj);
  }

  private paintTile(x: number, y: number): void {
    const { land } = this.farm.state;
    const bob = this.groundBobs[y * land.width + x];
    if (!bob) return;
    const art = seasonalArt(isOwned(land, x, y) ? grassArt(x, y) : unownedArt(x, y), artSeason());
    const [ax, ay] = packAsset(art)?.res[ART_RES].anchor ?? [0, 0];
    // Bobs are placed by their top-left pixel, in the Blitter's unscaled (2x) space.
    const top = gridToWorld(x, y);
    bob.reset(top.x / ART_SCALE - ax, top.y / ART_SCALE - ay, art);
    // Rich soil shows as lusher grass, owned or not.
    bob.setTint(groundTint(soilAt(x, y), artSeason()));
  }

  /**
   * A few bushes and ponds on locked land, scattered from a fixed seed (not saved), away from the farm's edge and
   * the map's trees and deposits. They go when their land is bought. (Trees and rocks are real and saved: see
   * `src/features/nature`.)
   */
  private placeScenery(): void {
    const { land } = this.farm.state;
    for (const s of this.scenery) s.img.destroy();
    this.sceneryShadows.removeAll(true);
    this.scenery = [];
    const nearOwned = (x: number, y: number) => {
      for (let dy = -SCENERY_CLEARANCE; dy <= SCENERY_CLEARANCE; dy++) {
        for (let dx = -SCENERY_CLEARANCE; dx <= SCENERY_CLEARANCE; dx++) if (isOwned(land, x + dx, y + dy)) return true;
      }
      return false;
    };
    const layer = mapOf(this.farm.state);
    for (let y = 0; y < land.height; y++) {
      for (let x = 0; x < land.width; x++) {
        const art = sceneryArt(x, y);
        if (!art || isOwned(land, x, y) || nearOwned(x, y) || treeAt(layer, x, y) || depositAt(layer, x, y)) continue;
        const at = gridToWorld(x, y);
        this.scenery.push({ fp: { x, y, w: 1, h: 1 }, img: addArt(this, at.x, at.y, art) });
        const shadow = addShadow(this, at.x, at.y, art);
        if (shadow) this.sceneryShadows.add(shadow);
      }
    }
    this.depthsDirty = true;
  }

  /**
   * Flat things sort by their front corner under every shadow and standing thing. Standing things (buildings,
   * crops, pens and scenery) get a back-to-front order from their footprints, so whatever stands in front
   * covers what is behind it. Runs only when something was added, removed or the land changed.
   */
  private sortDepths(): void {
    this.depthsDirty = false;
    const tall: { fp: Footprint; target: Phaser.GameObjects.Components.Depth }[] = this.scenery.map((s) => ({
      fp: s.fp,
      target: s.img,
    }));
    for (const list of this.extraStanding.values()) tall.push(...list);
    for (const view of this.views.values()) {
      // A path has nothing standing; leaving it out keeps the sort small on big farms.
      if (view.container.length > 0) tall.push({ fp: { x: view.obj.x, y: view.obj.y, ...footprintOf(view.obj) }, target: view.container });
    }
    const order = sortFootprints(tall.map((t) => t.fp));
    order.forEach((idx, rank) => tall[idx].target.setDepth(DEPTH.tall + rank / (order.length + 1)));
    setStandingDepths(order.map((idx, rank) => ({ fp: tall[idx].fp, depth: DEPTH.tall + rank / (order.length + 1) })));
  }

  private createView(obj: PlacedObject): void {
    if (this.views.has(obj.id)) return;
    const def = getBuildable(obj.type);
    const fp = { x: obj.x, y: obj.y, ...footprintOf(obj) };
    const box = footprintBox(fp);
    const key = def?.texture ?? 'missing';
    const top = footprintLocal(fp.w, fp.h, 0, 0);
    const scale = fitScale(this, key, fp);
    const sprite = this.add.image(top.x, top.y, textureKey(this, key)).setScale(scale);
    const shadow = textureKey(this, key) === 'missing' ? null : addShadow(this, top.x, top.y, key)?.setScale(scale) ?? null;
    const container = this.add.container(box.left, box.top);
    const ground = this.add.container(box.left, box.top).setDepth(DEPTH.flat + depthKey(fp) * 1e-4);
    const shadows = this.add.container(box.left, box.top, shadow ? [shadow] : []).setDepth(DEPTH.shadow);
    (FLAT_CATEGORIES.has(def?.category ?? '') ? ground : container).add(sprite);
    const view: ObjectView = { container, ground, shadows, sprite, shadow, top, width: box.width, height: box.height };
    this.views.set(obj.id, { ...view, obj });
    this.depthsDirty = true;
    getBehavior(obj.type)?.create?.(this.ctx, obj, view);
  }

  private destroyView(id: string): void {
    this.siteBars.get(id)?.bar.destroy();
    this.siteBars.delete(id);
    const view = this.views.get(id);
    if (!view) return;
    getBehavior(view.obj.type)?.destroy?.(this.ctx, view.obj, view);
    view.container.destroy();
    view.ground.destroy();
    view.shadows.destroy();
    this.views.delete(id);
  }

  /** Floating text rising from a tile; item emoji in it show as the pack's icons. */
  floatText(tileX: number, tileY: number, text: string, color = '#ffffff'): void {
    const at = tileToWorld(tileX, tileY);
    const style = {
      fontFamily: 'system-ui, sans-serif',
      fontSize: `${FLOAT_FONT}px`,
      fontStyle: 'bold',
      color,
      stroke: '#2b2118',
      strokeThickness: Math.round(FLOAT_FONT / 4),
      resolution: 2,
    };
    const parts: Phaser.GameObjects.GameObject[] = [];
    let x = 0;
    for (const part of splitIcons(text)) {
      if (typeof part === 'string') {
        const t = this.add.text(x, 0, part, style).setOrigin(0, 1);
        x += t.width;
        parts.push(t);
      } else if (this.textures.exists(part.icon)) {
        const icon = this.add.image(x, 0, part.icon).setOrigin(0, 1);
        icon.setScale((FLOAT_FONT * 1.3) / icon.height);
        x += icon.displayWidth;
        parts.push(icon);
      }
    }
    const t = this.add
      .container(at.x - x / 2, at.y - ISO_H / 2, parts)
      .setDepth(DEPTH.floatText);
    this.tweens.add({
      targets: t,
      y: t.y - ISO_H * 0.9,
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

  /**
   * The opening view: the owned land with a little land around it, zoomed out as far as tiles stay easy to tap
   * (on a phone that is closer, centred on the farmhouse).
   */
  private focusOwnedLand(): void {
    const { land } = this.farm.state;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < land.height; y++) {
      for (let x = 0; x < land.width; x++) {
        if (!isOwned(land, x, y)) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const area = minX > maxX ? { x: 0, y: 0, w: land.width, h: land.height } : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    const house = farmhouseOf(this.farm.state);
    const focus = house ? { x: house.x + 1, y: house.y + 1 } : { x: area.x + area.w / 2, y: area.y + area.h / 2 };
    const cam = this.cameras.main;
    const view = openingView(area, cam.width, cam.height, focus);
    cam.setZoom(Phaser.Math.Clamp(view.zoom, this.minZoom, MAX_ZOOM));
    cam.centerOn(view.centre.x, view.centre.y);
    this.clampCamera();
  }

  /**
   * The display objects of a placed object, for a feature that draws on objects it has no behaviour for (e.g.
   * stock piles at the farmhouse). A new view replaces it when the object is redrawn (new game, demolish).
   */
  viewOf(id: string): ObjectView | undefined {
    return this.views.get(id);
  }

  /**
   * Standing things a feature draws outside any object view (e.g. trees), depth-sorted with buildings and scenery
   * by their footprints. Replaces what `owner` set before; an empty list removes them.
   */
  setStanding(owner: string, items: { fp: Footprint; target: Phaser.GameObjects.Components.Depth }[]): void {
    if (items.length) this.extraStanding.set(owner, items);
    else this.extraStanding.delete(owner);
    this.depthsDirty = true;
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
      this.hideGhost();
      this.showCursors(null, CURSOR.normal);
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
    // A display object with its own tap action (e.g. the trader's wagon) handles the tap itself.
    if (this.ctx.tools.mode.kind === 'normal') {
      const onTap = this.input.hitTestPointer(p).map((obj) => obj.getData('onTap') as (() => void) | undefined).find(Boolean);
      if (onTap) return onTap();
    }
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
      // Say why the spot itself is wrong before asking for a farmer and a path.
      const check = game.checkPlacement(mode.type, x, y);
      if (!check.ok) {
        ui.toast(PLACE_ERRORS[check.reason], 'error');
        return;
      }
      // A farmer must be able to walk there to build it.
      if (buildWorkMs(mode.type) > 0 && !reachable(this.ctx, { type: mode.type, x, y })) {
        ui.toast(NO_ROAD_MESSAGE, 'error');
        return;
      }
      // Buildings become construction sites that free farmers build; paths are laid at once.
      const result = game.place(mode.type, x, y, { site: true });
      if (!result.ok) {
        ui.toast(this.placeError(mode.type, result.reason), 'error');
        return;
      }
      const cost = getBuildable(mode.type)?.cost ?? 0;
      if (cost > 0) this.floatText(x, y, `-$${cost}`, '#ffd6a0');
      return;
    }
    const obj = game.objectAt(tx, ty);
    if (mode.kind === 'demolish') {
      if (!obj) {
        ui.toast('Nothing to demolish here', 'error');
        return;
      }
      if (getBuildable(obj.type)?.fixed) {
        ui.toast(`The ${getBuildable(obj.type)!.name.toLowerCase()} stays`, 'error');
        return;
      }
      void this.demolish(obj, false);
      return;
    }
    if (!obj) {
      if (!runTileTapHandlers(this.ctx, tx, ty)) ui.closePanel();
      return;
    }
    this.openObjectPanel(obj);
  }

  /** Toast text for a refused placement of `type`; missing materials are named. */
  private placeError(type: string, reason: Exclude<PlaceResult, { ok: true }>['reason']): string {
    if (reason !== 'materials') return PLACE_ERRORS[reason];
    return needsMaterialsMessage(this.ctx.game.missingMaterials(getBuildable(type)?.materials));
  }

  private openObjectPanel(obj: PlacedObject): void {
    const behavior = getBehavior(obj.type);
    // A construction site can't be used: no click actions, and its panel shows the building work only.
    if (!obj.site && behavior?.onClick?.(this.ctx, obj) === true) return;
    const { game, ui } = this.ctx;
    const def = getBuildable(obj.type);
    ui.openPanel(() => {
      if (!game.getObject(obj.id)) return null; // demolished meanwhile
      const spec: PanelSpec = obj.site
        ? this.sitePanel(obj)
        : (behavior?.panel?.(this.ctx, obj) ?? { title: def?.name ?? obj.type, lines: def?.description ? [def.description] : [] });
      const work = workplacePanel(this.ctx, obj);
      const refund = refundOf(obj);
      if (def?.fixed) return spec;
      return {
        ...spec,
        lines: [...(spec.lines ?? []), ...(work?.lines ?? [])],
        choices: [...(spec.choices ?? []), ...(work?.choices ?? [])],
        actions: [
          ...(spec.actions ?? []),
          ...(work?.actions ?? []),
          {
            label: obj.site ? `Cancel building (+$${refund})` : `Demolish (+$${refund})`,
            variant: 'danger',
            onClick: () => void this.demolish(obj, true),
          },
        ],
      };
    });
  }

  /**
   * Demolishes `obj` after saying what comes back. From the panel it always asks first; in demolish mode only
   * when refunded materials would be lost for want of room. A granary or storehouse whose stock wouldn't fit
   * without it is refused with a toast.
   */
  private async demolish(obj: PlacedObject, ask: boolean): Promise<void> {
    const { game, ui } = this.ctx;
    const def = getBuildable(obj.type);
    const name = def?.name ?? obj.type;
    const check = game.checkDemolish(obj.id);
    if (!check.ok) {
      if (check.reason === 'storage') ui.toast(demolishBlockedMessage(obj, check.excess), 'error');
      return;
    }
    const losing = Object.keys(check.lost).length > 0;
    if (ask || losing) {
      const ok = await ui.confirm(`Demolish the ${name.toLowerCase()}?`, `You get back ${demolishText(check)}.`, { confirmLabel: 'Demolish' });
      if (!ok) return;
    }
    const got = game.checkDemolish(obj.id);
    if (!got.ok || game.demolish(obj.id) === null) {
      if (!got.ok && got.reason === 'storage') ui.toast(demolishBlockedMessage(obj, got.excess), 'error');
      return;
    }
    this.floatText(obj.x, obj.y, `+$${got.money}`, '#c8ff9e');
    if (!ask && Object.keys(got.materials).length) ui.toast(`${name} demolished: got back ${demolishText(got)}`, 'success');
  }

  /** A construction site's panel: who builds it and how far they are, or why nobody does yet. */
  private sitePanel(obj: PlacedObject): PanelSpec {
    const def = getBuildable(obj.type);
    const site = obj.site!;
    const building = siteProgress(this.farm.state, obj.id);
    const lines = [`Construction site: a free farmer builds it in ${formatDuration(site.workMs)}. It can't be used until it is finished.`];
    if (!reachable(this.ctx, obj)) lines.push(`⚠️ ${NO_ROAD_MESSAGE}`);
    else if (building) lines.push(`🔨 ${farmerName(building.farmer)} is building it.`);
    else lines.push('Waiting for a free farmer (sites are built oldest first).');
    return {
      title: `${def?.name ?? obj.type} (building)`,
      icon: '🚧',
      lines,
      progress: { value: building?.progress ?? 0, label: building ? 'Building' : 'Not started' },
    };
  }

  // Tool feedback -------------------------------------------------------------------

  private hideGhost(): void {
    this.ghost.setVisible(false);
    this.ghostReason.setVisible(false);
    this.preview(null);
  }

  /** Tells features where the ghost is (only when that changed). */
  private lastPreview = '';
  private preview(p: BuildPreview): void {
    const key = p ? `${p.type},${p.x},${p.y},${p.ok}` : '';
    if (key === this.lastPreview) return;
    this.lastPreview = key;
    runBuildPreview(this.ctx, p);
    this.ctx.tools.events.emit('preview', p);
  }

  private onToolChange(mode: ToolMode): void {
    this.showCursors(null, CURSOR.normal);
    this.hideGhost();
    if (mode.kind === 'build') {
      const def = getBuildable(mode.type);
      if (!def) return;
      this.ghost.setTexture(textureKey(this, def.texture)).setScale(fitScale(this, def.texture, def.footprint));
    }
    const p = this.input.activePointer;
    if (p && !p.wasTouch && this.input.isOver) this.updateCursor(p);
  }

  private updateCursor(p: Phaser.Input.Pointer): void {
    const mode = this.ctx.tools.mode;
    const { tx, ty } = this.pointerTile(p);
    if (mode.kind === 'build') {
      // On touch screens there is no hover; the ghost shows where the last tap landed.
      const def = getBuildable(mode.type);
      if (!def) return;
      const { x, y } = this.anchorFor(mode.type, tx, ty);
      const check = this.ctx.game.checkPlacement(mode.type, x, y);
      const ok =
        check.ok &&
        this.ctx.game.canPayFor(mode.type) &&
        (buildWorkMs(mode.type) === 0 || reachable(this.ctx, { type: mode.type, x, y }));
      const top = gridToWorld(x, y);
      this.showCursors({ x, y, ...def.footprint }, ok ? CURSOR.ok : CURSOR.bad);
      this.ghost.setPosition(top.x, top.y).setVisible(true);
      this.ghost.setData('valid', ok);
      this.ghost.setData('tile', { x, y });
      // Say why the spot itself is wrong (trees, rock, someone else's land), under the footprint.
      const bottom = gridToWorld(x + def.footprint.w, y + def.footprint.h);
      this.ghostReason.setText(check.ok ? '' : PLACE_ERRORS[check.reason]).setPosition(bottom.x, bottom.y + 4).setVisible(!check.ok);
      this.ghost.setData('reason', check.ok ? null : check.reason);
      this.preview({ type: mode.type, x, y, ok });
    } else if (mode.kind === 'demolish') {
      this.preview(null);
      const obj = this.ctx.game.objectAt(tx, ty);
      this.showCursors(obj ? { x: obj.x, y: obj.y, ...footprintOf(obj) } : null, CURSOR.bad);
    } else {
      // Normal mode: mark the tile under a mouse pointer.
      this.showCursors(p.wasTouch ? null : { x: tx, y: ty, w: 1, h: 1 }, CURSOR.normal);
    }
  }

  /** Lays one cursor overlay on each tile of the footprint (none for null). */
  private showCursors(fp: Footprint | null, art: string): void {
    const n = fp ? fp.w * fp.h : 0;
    while (this.cursors.length < n) this.cursors.push(addArt(this, 0, 0, art));
    // The plain hover lies on the ground; build and demolish cursors show over whatever stands there.
    const depth = art === CURSOR.normal ? DEPTH.shadow - 0.5 : DEPTH.hover;
    this.cursors.forEach((img, i) => {
      img.setVisible(i < n);
      if (!fp || i >= n) return;
      const at = gridToWorld(fp.x + (i % fp.w), fp.y + Math.floor(i / fp.w));
      img.setTexture(textureKey(this, art)).setPosition(at.x, at.y).setDepth(depth);
    });
  }
}
