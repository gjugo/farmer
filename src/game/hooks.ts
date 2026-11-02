import type { FarmContext, ObjectView, PanelSpec, PlacedObject, SheetSpec } from './context';

/**
 * Per-buildable-type behaviour. Register one from a feature module with
 * `registerBehavior('coop', {...})`; the Farm scene calls it — no scene edits needed.
 * All hooks are optional. Object state lives in `obj.state`; after mutating it,
 * call `ctx.game.touch(obj)` so it is saved and the panel refreshes.
 */
export interface ObjectBehavior<S extends object = Record<string, unknown>> {
  /** Called when the object's view is created (placed or loaded). Add extra display objects to `view.container`. */
  create?(ctx: FarmContext, obj: PlacedObject<S>, view: ObjectView): void;
  /** Called every frame with the game-time delta (already multiplied by the clock speed). */
  update?(ctx: FarmContext, obj: PlacedObject<S>, view: ObjectView, gameDeltaMs: number): void;
  /** Called when `game.touch(obj)` announces a state change. Refresh the view here. */
  refresh?(ctx: FarmContext, obj: PlacedObject<S>, view: ObjectView): void;
  /** Called before the view is destroyed (demolished or new game). */
  destroy?(ctx: FarmContext, obj: PlacedObject<S>, view: ObjectView): void;
  /**
   * Content of the action panel opened by clicking the object in normal mode.
   * Called again whenever the game changes while the panel is open.
   */
  panel?(ctx: FarmContext, obj: PlacedObject<S>): PanelSpec;
  /** Custom click handling. Return true to suppress the default action panel. */
  onClick?(ctx: FarmContext, obj: PlacedObject<S>): boolean | void;
}

const behaviors = new Map<string, ObjectBehavior>();

export function registerBehavior<S extends object>(type: string, behavior: ObjectBehavior<S>): void {
  if (behaviors.has(type)) throw new Error(`Behavior for "${type}" is already registered`);
  behaviors.set(type, behavior as unknown as ObjectBehavior);
}

export function getBehavior(type: string): ObjectBehavior | undefined {
  return behaviors.get(type);
}

/**
 * The HUD's windows, opened from the tool bar (Farm, Trade, Almanac) or the level (Development). Features add tabs to
 * them; the HUD lays them out (`src/ui/hud.ts`).
 */
export type HudWindowId = 'development' | 'farm' | 'trade' | 'almanac';

/** A banner's colour: news, something to see to soon, or trouble now. */
export type BannerSeverity = 'info' | 'warn' | 'alert';

/** Where a feature's HUD element goes. */
export type HudSpot =
  /** A tab in a window (`tab-<id>`), showing the feature's sheet. Tabs are ordered by `order` (default 0). */
  | { kind: 'tab'; window: HudWindowId; order?: number; sheet(ctx: FarmContext): SheetSpec }
  /**
   * A chip in the farm overview, top left (`stat-<id>`): an icon and a number. Hover or tap explains it (`label`) with
   * `detail`'s lines; a click opens the tab `opens`.
   */
  | { kind: 'chip'; order?: number; opens?: string; detail?(ctx: FarmContext): string[] }
  /** A notice under the level (`banner-<id>`), coloured by `severity`; a tap opens the tab `opens`. */
  | { kind: 'banner'; order?: number; opens?: string; severity(ctx: FarmContext): BannerSeverity };

/**
 * Something a feature shows in the HUD: a window tab, a farm overview chip or a banner (`spot`). Ids are unique per
 * kind of spot, so a feature can have a tab and a banner with the same id.
 */
export interface HudButton {
  id: string;
  /** The tab's name, the chip's explanation (e.g. "Free farmers"), or the banner's text. */
  label: string;
  icon?: string;
  spot: HudSpot;
  /** Small count (e.g. orders ready to fulfil); re-read on every HUD refresh. Hidden when null or 0. A tab's badge also shows on its window's button. */
  badge?(ctx: FarmContext): number | null;
  /** Live icon and label: a chip's number, a banner's text; re-read on every HUD refresh. */
  live?(ctx: FarmContext): { icon: string; label: string };
  /** Shown only while this returns true (e.g. the trader's tab and banner); re-read on every HUD refresh. Always shown when missing. */
  visible?(ctx: FarmContext): boolean;
}

const hudButtons: HudButton[] = [];

export function registerHudButton(button: HudButton): void {
  if (hudButtons.some((b) => b.id === button.id && b.spot.kind === button.spot.kind)) {
    throw new Error(`HUD ${button.spot.kind} "${button.id}" is already registered`);
  }
  hudButtons.push(button);
}

/** Registered HUD elements of one kind of spot, in `order`. */
export function listHudButtons<K extends HudSpot['kind']>(kind: K): readonly (HudButton & { spot: Extract<HudSpot, { kind: K }> })[] {
  return hudButtons
    .filter((b): b is HudButton & { spot: Extract<HudSpot, { kind: K }> } => b.spot.kind === kind)
    .sort((a, b) => (a.spot.order ?? 0) - (b.spot.order ?? 0));
}

/**
 * A keyboard shortcut (e.g. M toggles sound). The HUD runs it only while no dialog or menu is open and no text field
 * has the focus. `key` is matched against `KeyboardEvent.key`, ignoring case.
 */
export interface Hotkey {
  key: string;
  /** What it does, for the help text. */
  label: string;
  run(ctx: FarmContext): void;
}

const hotkeys: Hotkey[] = [];

export function registerHotkey(hotkey: Hotkey): void {
  if (hotkeys.some((k) => k.key.toLowerCase() === hotkey.key.toLowerCase())) throw new Error(`Hotkey "${hotkey.key}" is already registered`);
  hotkeys.push(hotkey);
}

export function listHotkeys(): readonly Hotkey[] {
  return hotkeys;
}

/** A checkbox above the construction menu's cards, like Manor Lords' "Snap to Roads" (e.g. the soil overlay). */
export interface BuildMenuToggle {
  id: string;
  label: string;
  icon?: string;
  isOn(ctx: FarmContext): boolean;
  toggle(ctx: FarmContext): void;
}

const buildMenuToggles: BuildMenuToggle[] = [];

export function registerBuildMenuToggle(toggle: BuildMenuToggle): void {
  if (buildMenuToggles.some((t) => t.id === toggle.id)) throw new Error(`Build menu toggle "${toggle.id}" is already registered`);
  buildMenuToggles.push(toggle);
}

export function listBuildMenuToggles(): readonly BuildMenuToggle[] {
  return buildMenuToggles;
}

/** Runs once after the game has started; for features that need global listeners. */
export type StartHook = (ctx: FarmContext) => void;

const startHooks: StartHook[] = [];

export function onGameStart(hook: StartHook): void {
  startHooks.push(hook);
}

export function runStartHooks(ctx: FarmContext): void {
  for (const hook of startHooks) hook(ctx);
}

/**
 * Handles a tap on a tile without an object, in normal mode (e.g. a marker a feature draws
 * on the ground). Return true when handled; otherwise the open panel is closed.
 */
export type TileTapHandler = (ctx: FarmContext, x: number, y: number) => boolean | void;

const tileTapHandlers: TileTapHandler[] = [];

export function registerTileTapHandler(handler: TileTapHandler): void {
  tileTapHandlers.push(handler);
}

export function runTileTapHandlers(ctx: FarmContext, x: number, y: number): boolean {
  return tileTapHandlers.some((handler) => handler(ctx, x, y) === true);
}

/** Where the build ghost stands (top-left tile) and whether it can go there; null when it is hidden. */
export type BuildPreview = { type: string; x: number; y: number; ok: boolean } | null;
export type BuildPreviewHook = (ctx: FarmContext, preview: BuildPreview) => void;

const buildPreviewHooks: BuildPreviewHook[] = [];

/** Called whenever the build ghost moves or hides, e.g. to show a woodcutter's lodge's reach. */
export function onBuildPreview(hook: BuildPreviewHook): void {
  buildPreviewHooks.push(hook);
}

export function runBuildPreview(ctx: FarmContext, preview: BuildPreview): void {
  for (const hook of buildPreviewHooks) hook(ctx, preview);
}

/** A block in the Settings sheet (e.g. sound). Rendered each time the sheet opens. */
export interface SettingsSection {
  id: string;
  render(ctx: FarmContext, body: HTMLElement): void;
}

const settingsSections: SettingsSection[] = [];

export function registerSettingsSection(section: SettingsSection): void {
  if (settingsSections.some((s) => s.id === section.id)) throw new Error(`Settings section "${section.id}" is already registered`);
  settingsSections.push(section);
}

export function listSettingsSections(): readonly SettingsSection[] {
  return settingsSections;
}

/** Extra read-only debug info exposed on `window.farm` under `key` (e.g. `window.farm.audio`). */
const debugInfo = new Map<string, () => unknown>();

export function registerDebugInfo(key: string, read: () => unknown): void {
  if (debugInfo.has(key)) throw new Error(`Debug info "${key}" is already registered`);
  debugInfo.set(key, read);
}

export function readDebugInfo(): Record<string, unknown> {
  return Object.fromEntries([...debugInfo].map(([key, read]) => [key, read()]));
}
