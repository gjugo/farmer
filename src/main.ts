import './ui/styles.css';
import './features';
import Phaser from 'phaser';
import { ToolState, type FarmContext } from './game/context';
import { Game } from './logic/game';
import { catchUp, catchUpGame, shouldShowSummary, type CatchUpResult } from './logic/offline';
import { ordersOf, type OrdersState } from './logic/orders';
import { loadSave, saveToStorage, type SaveStorage } from './logic/save';
import { createNewGame } from './logic/state';
import type { GameState } from './logic/types';
import { BootScene } from './scenes/BootScene';
import { FarmScene } from './scenes/FarmScene';
import { isDebugMode, mountDebugPanel } from './ui/debug';
import { Hud } from './ui/hud';
import { showWelcomeBack } from './ui/welcome';

const AUTOSAVE_MS = 10_000;

declare global {
  interface Window {
    /**
     * Read-only snapshot of the game state (for debugging and Playwright checks), plus the
     * real time of the last save (`Date.now()`, null before the first one) and the last offline catch-up.
     */
    readonly farm: Readonly<
      GameState & { day: number; orders: OrdersState; lastSavedAt: number | null; lastCatchUp: CatchUpResult | null }
    >;
  }
}

function browserStorage(): SaveStorage {
  try {
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  }
}

const storage = browserStorage();
const loaded = loadSave(storage);
// Catch up on the time the game was closed before anyone sees the farm. Older saves have no time: no catch-up.
let lastCatchUp: CatchUpResult | null = loaded.savedAt === null ? null : catchUp(loaded.state, Date.now() - loaded.savedAt);
const game = new Game(loaded.state);
let lastSavedAt = loaded.savedAt;

// While the tab is hidden the scene is paused, so the farm is only up to date as of `hiddenAt`.
// Saves made then must say so, or the time between would be lost on the next load.
let hiddenAt: number | null = null;
let elapsedAtHide = 0;
const save = () => {
  const at = hiddenAt ?? Date.now();
  if (saveToStorage(storage, game.state, at)) lastSavedAt = at;
};

const ctx = { game, tools: new ToolState() } as FarmContext;
const uiRoot = document.getElementById('ui')!;
ctx.ui = new Hud(uiRoot, ctx, () => {
  game.reset(createNewGame());
  save();
});

/** Catches up on real time away (at ×1) and shows the summary when it was long enough. */
function welcomeBack(awayMs: number): void {
  lastCatchUp = catchUpGame(game, awayMs);
  if (shouldShowSummary(lastCatchUp)) showWelcomeBack(uiRoot, lastCatchUp);
}

if (isDebugMode()) mountDebugPanel(uiRoot, ctx, welcomeBack);
if (lastCatchUp) {
  save();
  if (shouldShowSummary(lastCatchUp)) showWelcomeBack(uiRoot, lastCatchUp);
}

Object.defineProperty(window, 'farm', {
  get: () => {
    ordersOf(game.state);
    const snapshot = game.snapshot();
    return Object.freeze({
      ...snapshot,
      orders: snapshot.ext.orders as OrdersState,
      lastSavedAt,
      lastCatchUp: lastCatchUp && Object.freeze(structuredClone(lastCatchUp)),
    });
  },
  configurable: true,
});

window.setInterval(save, AUTOSAVE_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (hiddenAt === null) {
      hiddenAt = Date.now();
      elapsedAtHide = game.now;
    }
    save();
  } else if (hiddenAt !== null) {
    // Leave out any game time that still ran after hiding, so nothing is counted twice.
    const away = Date.now() - hiddenAt - (game.now - elapsedAtHide);
    hiddenAt = null;
    welcomeBack(away);
  }
});
window.addEventListener('pagehide', save);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#2f4a2a',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  input: { activePointers: 3 },
  scene: [new BootScene(), new FarmScene(ctx)],
});
