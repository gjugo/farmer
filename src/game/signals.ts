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
}

export const uiSignals = new Emitter<UiSignals>();
