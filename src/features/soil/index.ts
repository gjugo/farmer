import type Phaser from 'phaser';
import { FIELD } from '../../data/crops';
import { getBuildable } from '../../data/buildables';
import { SOIL_INFO, SOIL_QUALITY } from '../../data/soil';
import type { BuildPreview, FarmContext } from '../../game/context';
import { onGameStart, registerBuildMenuToggle, registerDebugInfo } from '../../game/hooks';
import { isOwned } from '../../logic/land';
import { soilAt, soilBand } from '../../logic/soil';
import { DEPTH } from '../../scenes/depth';
import { gridToWorld } from '../../scenes/iso';

/**
 * Soil: the quality overlay over owned land (the Build menu's Soil toggle), the soil tint under a field's build ghost,
 * and `window.farm.soil` for QA. The rules live in `src/logic/soil.ts`; rich ground's lusher grass is drawn by the Farm
 * scene (`soilTint` in `src/scenes/ground.ts`), the field panel's soil block in `./panel.ts`.
 */

/** The overlay lies on the ground and over fields, under shadows and everything standing. */
const OVERLAY_DEPTH = DEPTH.shadow - 0.6;
const OVERLAY_ALPHA = 0.38;
/** The ghost's tiles are tinted over the ghost itself, so the colours show through its art. */
const GHOST_ALPHA = 0.45;

let overlayOn = false;
let overlay: Phaser.GameObjects.Graphics | null = null;
let ghostTiles: Phaser.GameObjects.Graphics | null = null;

function fillTile(g: Phaser.GameObjects.Graphics, x: number, y: number, alpha: number): void {
  g.fillStyle(SOIL_INFO[soilBand(soilAt(x, y))].color, alpha);
  const corners = [gridToWorld(x, y), gridToWorld(x + 1, y), gridToWorld(x + 1, y + 1), gridToWorld(x, y + 1)];
  g.beginPath();
  g.moveTo(corners[0].x, corners[0].y);
  for (const c of corners.slice(1)) g.lineTo(c.x, c.y);
  g.closePath();
  g.fillPath();
}

function drawOverlay(ctx: FarmContext): void {
  if (!overlay) return;
  overlay.clear();
  overlay.setVisible(overlayOn);
  if (!overlayOn) return;
  const { land } = ctx.game.state;
  for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) if (isOwned(land, x, y)) fillTile(overlay, x, y, OVERLAY_ALPHA);
}

function drawGhost(preview: BuildPreview): void {
  if (!ghostTiles) return;
  ghostTiles.clear();
  if (!preview || preview.type !== FIELD) return;
  const { w, h } = getBuildable(FIELD)!.footprint;
  for (let y = preview.y; y < preview.y + h; y++) for (let x = preview.x; x < preview.x + w; x++) fillTile(ghostTiles, x, y, GHOST_ALPHA);
}

registerBuildMenuToggle({
  id: 'soil',
  label: 'Soil',
  icon: '🌱',
  isOn: () => overlayOn,
  toggle: (ctx) => {
    overlayOn = !overlayOn;
    drawOverlay(ctx);
  },
});

onGameStart((ctx) => {
  overlay = ctx.scene.add.graphics().setDepth(OVERLAY_DEPTH);
  ghostTiles = ctx.scene.add.graphics().setDepth(DEPTH.ghost + 1);
  drawOverlay(ctx);
  const { events } = ctx.game;
  // Bought land joins the overlay; a parcel announces each tile, so redraw once per frame at most.
  let pending = false;
  const redraw = () => {
    if (pending) return;
    pending = true;
    ctx.scene.time.delayedCall(0, () => {
      pending = false;
      drawOverlay(ctx);
    });
  };
  events.on('land', redraw);
  events.on('reset', redraw);
  ctx.tools.events.on('preview', drawGhost);
});

registerDebugInfo('soil', () =>
  Object.freeze({
    /** Soil quality (percentage points) of a tile: 95 rich, 70 normal, 45 poor. */
    at: (x: number, y: number) => soilAt(x, y),
    band: (x: number, y: number) => soilBand(soilAt(x, y)),
    quality: SOIL_QUALITY,
    overlay: overlayOn,
  }),
);
