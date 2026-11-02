import type Phaser from 'phaser';
import { Emitter } from '../logic/events';
import type { Game } from '../logic/game';
import type { PlacedObject } from '../logic/types';

/** One button in an action panel. */
export interface PanelAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Visual emphasis: `primary` (default), `secondary` or `danger`. */
  variant?: 'primary' | 'secondary' | 'danger';
  /** Its `data-testid`, when it needs a stable one (otherwise `panel-action-<index>`). */
  testId?: string;
}

/** A requirement in a panel's checklist, shown ✅ or ❌ (`data-testid="panel-check-<id>"`, `data-ok`). */
export interface PanelCheck {
  id: string;
  ok: boolean;
  text: string;
}

/** A drop-down in an action panel, e.g. a field's crop plan. */
export interface PanelChoice {
  /** Used in the `data-testid` (`panel-choice-<id>`). */
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
}

/**
 * Content of the generic action panel. Panels are built by a function that is
 * called again whenever the game changes (and a few times per second while open),
 * so just describe the current state.
 */
/** A labelled bar in an action panel, e.g. a field's fertility. */
export interface PanelMeter {
  /** Used in the `data-testid` (`panel-meter-<id>`). */
  id: string;
  label: string;
  /** 0..1 */
  value: number;
  /** Shown on the bar, e.g. "62%". */
  text: string;
  /** Fill colour (CSS), default green. */
  color?: string;
}

export interface PanelSpec {
  title: string;
  /** Optional emoji / short text shown before the title. */
  icon?: string;
  /** Status lines; a `{ text, testId }` line gets `data-testid="<testId>"` for QA. */
  lines?: (string | PanelLine)[];
  /** Requirements shown ✅ / ❌ under the lines, e.g. a cottage upgrade's. */
  checklist?: PanelCheck[];
  progress?: { value: number; label?: string };
  /** Labelled bars shown under the lines, e.g. a field's fertility. */
  meters?: PanelMeter[];
  /** Small print under the meters, e.g. a hint. */
  hint?: string;
  /** Drop-downs shown above the actions. */
  choices?: PanelChoice[];
  actions?: PanelAction[];
}

export interface PanelLine {
  text: string;
  testId?: string;
}

export type PanelBuilder = () => PanelSpec | null;

/**
 * A custom side sheet with its own markup (e.g. the Market). `render` rebuilds the body
 * whenever `signature()` changes; `tick` updates it in place a few times per second.
 */
export interface SheetSpec {
  id: string;
  title(): string;
  signature(): string;
  render(body: HTMLElement): void;
  tick?(body: HTMLElement): void;
}

export interface ConfirmOptions {
  confirmLabel?: string;
  /** Visual emphasis of the confirm button (default `danger`). */
  variant?: 'primary' | 'danger';
  /** Disables the confirm button, e.g. when the player cannot afford it. */
  disabled?: boolean;
  /** Small note under the message, e.g. why the button is disabled. */
  hint?: string;
}

export interface UiApi {
  /** Short message in the toast stack. */
  toast(message: string, kind?: 'info' | 'success' | 'error'): void;
  /** Floating text rising from a tile, e.g. "+3 🥚". */
  floatText(tileX: number, tileY: number, text: string, color?: string): void;
  /** Opens the generic action panel. Returning null from the builder closes it. */
  openPanel(build: PanelBuilder): void;
  /** Opens a custom sheet, or closes it when a sheet with the same id is already open. */
  toggleSheet(sheet: SheetSpec): void;
  /** Opens the window that holds the tab `id` (a `registerHudButton` tab, e.g. `trader`) on that tab. */
  openTab(id: string): void;
  closePanel(): void;
  /** Modal confirm dialog. Resolves true when confirmed. */
  confirm(title: string, message: string, options?: ConfirmOptions): Promise<boolean>;
  /** Opens the construction menu on the category of buildable `type`, with its card in view and focused. */
  openBuildCard(type: string): void;
  /** Opens the oldest open perk choice (⭐ Perks → Choose a perk does the same); nothing when none is open. */
  openPerkChoice(): void;
}

export type ToolMode = { kind: 'normal' } | { kind: 'build'; type: string } | { kind: 'demolish' };

/** Where the build ghost stands: the buildable and its top-left tile; null when it is hidden. */
export type BuildPreview = { type: string; x: number; y: number } | null;

/** Which tool the player is using. Shared by the HUD (banner, buttons) and the Farm scene (input). */
export class ToolState {
  /** `preview` follows the build ghost as the Farm scene moves it, e.g. for the soil tint under a field. */
  readonly events = new Emitter<{ change: ToolMode; preview: BuildPreview }>();
  private _mode: ToolMode = { kind: 'normal' };

  get mode(): ToolMode {
    return this._mode;
  }

  set(mode: ToolMode): void {
    this._mode = mode;
    this.events.emit('change', mode);
  }

  cancel(): void {
    if (this._mode.kind !== 'normal') this.set({ kind: 'normal' });
  }
}

/** Everything a feature can reach. Passed to every hook. */
export interface FarmContext {
  game: Game;
  ui: UiApi;
  tools: ToolState;
  /** The Farm scene, for adding display objects. Only valid after the scene has started. */
  scene: Phaser.Scene;
}

/** The display objects of one placed object, kept by the Farm scene. */
export interface ObjectView {
  /**
   * What stands on the footprint, depth-sorted against every other standing thing. Positioned at the
   * top-left corner of the box around the footprint's isometric diamond, in world pixels; place children
   * with `footprintLocal` from `src/scenes/iso.ts`.
   */
  container: Phaser.GameObjects.Container;
  /** Same origin as `container`, but flat on the ground (under every shadow), e.g. a field's soil. */
  ground: Phaser.GameObjects.Container;
  /** Same origin as `container`, on the shadow layer (above the ground, below everything standing). */
  shadows: Phaser.GameObjects.Container;
  /**
   * The base image (the buildable's art), anchored on the footprint's top corner (`top`). In `ground` for
   * flat buildables (paths, fields), otherwise in `container`.
   */
  sprite: Phaser.GameObjects.Image;
  /** The base image's shadow in `shadows`, if its art has one. */
  shadow: Phaser.GameObjects.Image | null;
  /** The footprint's top corner inside the containers. */
  top: { x: number; y: number };
  /** Size of the box around the footprint's diamond, in world pixels. */
  width: number;
  height: number;
}

export type { PlacedObject };
