import { Emitter } from '../logic/events';

/**
 * UI moments that are not game state changes, for features that react to them (e.g. audio).
 * Game state changes go through `game.events` and `game.activity` instead.
 */
export interface UiSignals {
  /** An action was refused: an error toast, or a tap on a disabled button. */
  refused: { message: string };
  /** The welcome-back summary opened after an offline catch-up. */
  welcomeBack: { awayMs: number };
  /** The player moved or zoomed the camera (drag, keys, wheel or pinch). */
  camera: Record<string, never>;
  /** What the HUD shows changed: a window or sheet, the construction menu, the speed or the player's pause. */
  hud: HudView;
}

/** What the HUD shows, as `hud` signals and `window.farm.hud` report it. */
export interface HudView {
  /** The open window (`development`, `farm`, `trade`, `almanac`), or null. */
  window: string | null;
  /** The window's tab on show, or null. */
  tab: string | null;
  /** The sheet on show (a window's tab sheet, `action` for an object's panel), or null. */
  sheet: string | null;
  build: { open: boolean; category: string };
  speed: number;
  paused: boolean;
}

export const uiSignals = new Emitter<UiSignals>();
