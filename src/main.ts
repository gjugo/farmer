import './ui/styles.css';
import './features';
import Phaser from 'phaser';
import { ToolState, type FarmContext } from './game/context';
import { Game } from './logic/game';
import { ordersOf, type OrdersState } from './logic/orders';
import { loadFromStorage, saveToStorage, type SaveStorage } from './logic/save';
import { createNewGame } from './logic/state';
import type { GameState } from './logic/types';
import { BootScene } from './scenes/BootScene';
import { FarmScene } from './scenes/FarmScene';
import { isDebugMode, mountDebugPanel } from './ui/debug';
import { Hud } from './ui/hud';

const AUTOSAVE_MS = 10_000;

declare global {
  interface Window {
    /** Read-only snapshot of the game state (for debugging and Playwright checks). */
    readonly farm: Readonly<GameState & { day: number; orders: OrdersState }>;
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
const game = new Game(loadFromStorage(storage));
const save = () => saveToStorage(storage, game.state);

const ctx = { game, tools: new ToolState() } as FarmContext;
const uiRoot = document.getElementById('ui')!;
ctx.ui = new Hud(uiRoot, ctx, () => {
  game.reset(createNewGame());
  save();
});
if (isDebugMode()) mountDebugPanel(uiRoot, ctx);

Object.defineProperty(window, 'farm', {
  get: () => {
    ordersOf(game.state);
    const snapshot = game.snapshot();
    return Object.freeze({ ...snapshot, orders: snapshot.ext.orders as OrdersState });
  },
  configurable: true,
});

window.setInterval(save, AUTOSAVE_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
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
