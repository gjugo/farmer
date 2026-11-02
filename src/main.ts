import './ui/styles.css';
import './features';
import type { AudioDebugInfo } from './features/audio';
import Phaser from 'phaser';
import { ToolState, type FarmContext } from './game/context';
import { readDebugInfo } from './game/hooks';
import { Game, type FarmSnapshot } from './logic/game';
import { marketPrices } from './logic/market';
import { catchUp, catchUpGame, shouldShowSummary, type CatchUpResult } from './logic/offline';
import type { PerkId } from './data/perks';
import { ordersOf, type OrdersState } from './logic/orders';
import type { TakenPerk } from './logic/perks';
import { loadSave, saveToStorage, serialize, type SaveStorage } from './logic/save';
import { listSlots, readSlot, STORAGE_FULL, summarize, type SlotSummary } from './logic/slots';
import { createNewGame } from './logic/state';
import { traderInfo } from './logic/trader';
import type { StorageInfo } from './logic/storage';
import { BootScene } from './scenes/BootScene';
import { FarmScene } from './scenes/FarmScene';
import { isDebugMode, mountDebugPanel } from './ui/debug';
import { Hud } from './ui/hud';
import { Menu, type MenuMode } from './ui/menu';
import { showWelcomeBack } from './ui/welcome';

const AUTOSAVE_MS = 10_000;

declare global {
  interface Window {
    /**
     * Read-only snapshot of the game state (for debugging and Playwright checks) with level, XP and goals, plus the
     * real time of the last save (`Date.now()`, null before the first one), the last offline catch-up, and the
     * sound settings with the last sounds played (`audio`).
     */
    readonly farm: Readonly<
      FarmSnapshot & {
        orders: OrdersState;
        lastSavedAt: number | null;
        lastCatchUp: CatchUpResult | null;
        audio: AudioDebugInfo;
        /** Goods and building materials stored against the room in granaries, storehouses and the farmhouse. */
        storage: StorageInfo;
        /** Which menu is open: the home screen, the pause menu, or none (playing). The clock stands still in a menu. */
        menu: MenuMode | null;
        /** The autosave and the three manual save slots, as the Load screen lists them. */
        slots: readonly SlotSummary[];
        /** Perks taken (level, id), levels whose choice is still open (oldest first), and the cards a level's choice shows. */
        perks: { taken: readonly TakenPerk[]; pending: readonly number[]; offer(level: number): PerkId[] };
        /**
         * The travelling trader: whether he is here, when he arrives and leaves (game ms: the one here, else the next
         * one due; nulls below level 3), and while here what he wants and sells with the stock left.
         */
        trader: ReturnType<typeof traderInfo>;
        /** Item id → the Market's price for one unit now and how far it is down from the day's price (0..0.5). */
        market: Record<string, { price: number; drop: number }>;
        /** `tileToScreen(x, y)`: page pixel of a tile's centre at the current camera, for clicking known tiles. */
        iso: { tileToScreen(x: number, y: number): { x: number; y: number } | null };
      }
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
const params = new URLSearchParams(window.location.search);
/** `?menu=0` skips the home screen: straight into the autosaved farm, caught up on the time away. */
const skipMenu = params.get('menu') === '0';
const loaded = loadSave(storage);
const game = new Game(loaded.state);
let lastCatchUp: CatchUpResult | null = null;
let lastSavedAt = loaded.savedAt;
/** Whether there is a farm to continue (or lose): a readable autosave on load, always once a game is under way. */
let hasFarm = readSlot(storage, 'auto') !== null;
/** When the farm behind the home screen was last saved: Continue catches up on the time since. */
let homeSavedAt = loaded.savedAt;

// While the tab is hidden the scene is paused, so the farm is only up to date as of `hiddenAt`.
// Saves made then must say so, or the time between would be lost on the next load.
let hiddenAt: number | null = null;
let elapsedAtHide = 0;
let saveFailing = false;
const save = () => {
  // The farm behind the home screen is the stored autosave itself, not yet caught up: writing it now with a new
  // time would lose the time away.
  if (menu.current === 'home') return;
  const at = hiddenAt ?? Date.now();
  if (saveToStorage(storage, game.state, at)) {
    lastSavedAt = at;
    saveFailing = false;
  } else if (!saveFailing) {
    // Said once, not every 10 s; the game keeps running.
    saveFailing = true;
    ctx.ui.toast(STORAGE_FULL, 'error');
  }
};

const ctx = { game, tools: new ToolState() } as FarmContext;
const iso = Object.freeze({
  tileToScreen: (x: number, y: number) => (ctx.scene as FarmScene | undefined)?.tileToScreen(x, y) ?? null,
});
const uiRoot = document.getElementById('ui')!;
const hud = new Hud(uiRoot, ctx, () => openMenu('paused'));
ctx.ui = hud;

/** Catches up on real time away (at ×1) and shows the summary when it was long enough. */
function welcomeBack(awayMs: number): void {
  lastCatchUp = catchUpGame(game, awayMs);
  if (shouldShowSummary(lastCatchUp)) showWelcomeBack(uiRoot, lastCatchUp);
}

function openMenu(mode: MenuMode): void {
  hud.closeAll();
  game.paused = true;
  menu.open(mode);
}

/** Closes the menu and lets the clock run again (unless the player paused it with ⏸, which stays). */
function play(): void {
  menu.close();
  game.paused = false;
}

const menu: Menu = new Menu(uiRoot, {
  ctx,
  storage,
  hasFarm: () => hasFarm,
  currentSummary: () => summarize('auto', { state: game.state, savedAt: homeSavedAt }),
  currentState: () => game.state,
  currentSaveText: () => serialize(game.state, Date.now()),
  onContinue: () => {
    play();
    // Older saves have no time: no catch-up.
    if (homeSavedAt !== null) welcomeBack(Date.now() - homeSavedAt);
    save();
  },
  onResume: play,
  onNewGame: () => {
    game.reset(createNewGame());
    lastCatchUp = null;
    hasFarm = true;
    play();
    save();
    hud.toast('A fresh start! Welcome to your new farm.', 'success');
  },
  onLoad: (id) => {
    const slot = readSlot(storage, id);
    if (!slot) return hud.toast('That save could not be read.', 'error');
    game.reset(slot.state);
    lastCatchUp = null;
    hasFarm = true;
    play();
    // A manual slot is a snapshot and comes back exactly as saved; only the autosave catches up on time away.
    if (id === 'auto' && slot.savedAt !== null) welcomeBack(Date.now() - slot.savedAt);
    // The loaded farm is the autosave from now on.
    save();
    hud.toast(`Loaded ${id === 'auto' ? 'the autosave' : `slot ${id}`}`, 'success');
  },
  onQuit: () => {
    save();
    homeSavedAt = Date.now();
    hasFarm = true;
    openMenu('home');
  },
});

if (isDebugMode()) mountDebugPanel(uiRoot, ctx, welcomeBack);
if (skipMenu) {
  // Catch up on the time the game was closed before anyone sees the farm (farmers work through it too).
  // Older saves have no time: no catch-up.
  lastCatchUp = loaded.savedAt === null ? null : catchUp(game, Date.now() - loaded.savedAt);
  if (lastCatchUp) {
    save();
    if (shouldShowSummary(lastCatchUp)) showWelcomeBack(uiRoot, lastCatchUp);
  }
} else {
  openMenu('home');
}

// Esc closes the topmost thing: back out of the menu; else the HUD steps back one level (a tip, a tool, the
// construction menu, a window); else the pause menu opens. Dialogs (and the resource popover) stop it earlier.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (menu.current) {
    if (menu.escape()) e.preventDefault();
    return;
  }
  if (uiRoot.querySelector('.dialog-backdrop')) return;
  e.preventDefault();
  if (!hud.escape()) openMenu('paused');
});

Object.defineProperty(window, 'farm', {
  get: () => {
    ordersOf(game.state);
    const snapshot = game.snapshot();
    return Object.freeze({
      ...readDebugInfo(),
      ...snapshot,
      orders: snapshot.ext.orders as OrdersState,
      lastSavedAt,
      lastCatchUp: lastCatchUp && Object.freeze(structuredClone(lastCatchUp)),
      menu: menu.current,
      perks: Object.freeze({
        taken: Object.freeze(game.perks.taken.map((t) => Object.freeze({ ...t }))),
        pending: Object.freeze([...game.perks.pending]),
        offer: (level: number) => game.perks.offer(level).map((p) => p.id),
      }),
      slots: Object.freeze(listSlots(storage).map((s) => Object.freeze(s))),
      trader: traderInfo(game),
      market: marketPrices(game.state),
      iso,
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
    // The clock stands still in the menu: no catch-up (Continue catches up on the home screen's farm).
    if (!menu.current) welcomeBack(away);
  }
});
window.addEventListener('pagehide', save);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#2f4a2a',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  input: { activePointers: 3 },
  // Sound is ours (src/features/audio): Phaser's own AudioContext would start before any gesture.
  audio: { noAudio: true },
  scene: [new BootScene(), new FarmScene(ctx)],
});
