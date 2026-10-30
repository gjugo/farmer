import type { FarmContext, ObjectView, PanelSpec, PlacedObject } from './context';

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

/** A button in the HUD top bar (e.g. Market). */
export interface HudButton {
  id: string;
  label: string;
  icon?: string;
  onClick(ctx: FarmContext): void;
}

const hudButtons: HudButton[] = [];

export function registerHudButton(button: HudButton): void {
  if (hudButtons.some((b) => b.id === button.id)) throw new Error(`HUD button "${button.id}" is already registered`);
  hudButtons.push(button);
}

export function listHudButtons(): readonly HudButton[] {
  return hudButtons;
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
