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
}

/**
 * Content of the generic action panel. Panels are built by a function that is
 * called again whenever the game changes (and a few times per second while open),
 * so just describe the current state.
 */
export interface PanelSpec {
  title: string;
  /** Optional emoji / short text shown before the title. */
  icon?: string;
  lines?: string[];
  progress?: { value: number; label?: string };
  actions?: PanelAction[];
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
  closePanel(): void;
  /** Modal confirm dialog. Resolves true when confirmed. */
  confirm(title: string, message: string, options?: ConfirmOptions): Promise<boolean>;
}

export type ToolMode = { kind: 'normal' } | { kind: 'build'; type: string } | { kind: 'demolish' };

/** Which tool the player is using. Shared by the HUD (banner, buttons) and the Farm scene (input). */
export class ToolState {
  readonly events = new Emitter<{ change: ToolMode }>();
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
   * Positioned at the top-left corner of the box around the footprint's isometric diamond, in world
   * pixels. Place children with `footprintLocal` from `src/scenes/iso.ts`.
   */
  container: Phaser.GameObjects.Container;
  /** The base image (the buildable's texture), standing with its bottom edge on the diamond's front corner. */
  sprite: Phaser.GameObjects.Image;
  /** Size of the box around the footprint's diamond, in world pixels. */
  width: number;
  height: number;
}

export type { PlacedObject };
