import Phaser from 'phaser';
import { FIELD } from '../../data/crops';
import { DEFENCE_FOR, DEFENCES, HAZARD_INFO, type DefenceType, type HazardKind } from '../../data/hazards';
import type { FarmContext, PlacedObject, SheetSpec } from '../../game/context';
import { onBuildPreview, onGameStart, registerBehavior, registerDebugInfo, registerHudButton } from '../../game/hooks';
import { formatDuration } from '../../logic/crops';
import type { Game } from '../../logic/game';
import { DAY_MS } from '../../logic/constants';
import { areaOf, coverage, guardedBy, harshWinterWood, hazardsOf, isProtected, reaches, type HazardEvent, type HazardNote } from '../../logic/hazards';
import { CROW_ART } from '../../scenes/art';
import { DEPTH, walkerDepth } from '../../scenes/depth';
import { gridToWorld, ISO_H } from '../../scenes/iso';
import { addArt, textureKey } from '../../scenes/sprites';
import { h } from '../../ui/dom';
import { withIcons } from '../../ui/icons';

/**
 * Hazards on screen (rules in `src/logic/hazards.ts`, numbers in `src/data/hazards.ts`): a toast for every warning,
 * loss and defence; the 📖 Almanac in the HUD with what is on, what is coming, what guards against each and the recent
 * losses; crows on the field they eat; the reach of a well, scarecrow or kennel on the build ghost; and
 * `window.farm.hazards` for QA. Fields and coops say in their panels what protects them (`protectionLine`); a parched
 * field's look is in `src/features/fields`, the harsh winter's heavier snow in `src/features/seasons`.
 */

const TOAST_KIND: Record<HazardNote['outcome'], 'info' | 'success' | 'error'> = {
  warning: 'error',
  started: 'info',
  loss: 'error',
  defended: 'success',
  ended: 'info',
};

/** "Protected by a well" / "Unprotected: …" for a field or coop panel; null for anything else. */
export function protectionLine(game: Game, obj: PlacedObject): string | null {
  const kinds: HazardKind[] = obj.type === FIELD ? ['drought', 'crows'] : obj.type === 'coop' ? ['fox'] : [];
  if (kinds.length === 0 || obj.site) return null;
  const by: string[] = [];
  const missing: string[] = [];
  for (const kind of kinds) {
    const def = DEFENCES[DEFENCE_FOR[kind]!];
    if (isProtected(game.state, obj, kind)) by.push(`${def.icon} ${def.name.toLowerCase()}`);
    else missing.push(`${def.icon} ${def.name.toLowerCase()} within ${def.range} tiles (${HAZARD_INFO[kind].name.toLowerCase()})`);
  }
  if (missing.length === 0) return `🛡️ Protected by a ${by.join(' and a ')}.`;
  const locked = kinds.some((k) => !game.isUnlocked(DEFENCES[DEFENCE_FOR[k]!].unlockLevel));
  return `⚠️ Unprotected${by.length ? ` (protected by a ${by.join(' and a ')})` : ''}: build a ${missing.join(' and a ')}${locked ? ' once unlocked' : ''}.`;
}

// The Almanac ------------------------------------------------------------------------

/** "in 3:20" / "now" for a game time. */
function when(game: Game, t: number): string {
  return t <= game.now ? 'now' : `in ${formatDuration(t - game.now)}`;
}

function eventLine(game: Game, e: HazardEvent, on: boolean): string {
  const info = HAZARD_INFO[e.kind];
  const defence = DEFENCE_FOR[e.kind] ? DEFENCES[DEFENCE_FOR[e.kind]!] : null;
  const head = on
    ? e.kind === 'crows'
      ? `${info.icon} Crows are eating on a field (${when(game, e.end).replace('in ', '')} left)`
      : `${info.icon} ${info.name} (ends ${when(game, e.end)})`
    : e.kind === 'crows'
      ? `${info.icon} Crows are circling: they may land ${when(game, e.start)}`
      : e.kind === 'fox'
        ? `${info.icon} A fox is about: it may come ${when(game, e.start)}`
        : `${info.icon} ${info.name} ${when(game, e.start)}`;
  const guard =
    e.kind === 'harsh-winter' ? `Stock ${harshWinterWood(game.state)} 🪵 wood (you have ${game.count('wood')}).` : `Guard: a ${defence!.icon} ${defence!.name.toLowerCase()}.`;
  return `${head}. ${guard}`;
}

/** What is on, what is coming, every threat with its defence and the recent losses. */
export function almanacBlock(game: Game): HTMLElement {
  const s = hazardsOf(game.state);
  const current = [...s.current].sort((a, b) => a.end - b.end);
  const upcoming = [...s.upcoming].sort((a, b) => a.start - b.start);
  const losses = s.log.filter((n) => n.outcome === 'loss' || n.outcome === 'defended').slice(0, 8);
  const list = (testid: string, label: string, lines: string[], empty: string) =>
    h(
      'section',
      { class: 'almanac-section', 'data-testid': testid },
      h('h3', { class: 'group-title' }, label),
      lines.length ? h('ul', { class: 'almanac-list' }, lines.map((l) => h('li', {}, withIcons(l)))) : h('p', { class: 'muted' }, empty),
    );
  return h(
    'div',
    { class: 'almanac', 'data-testid': 'almanac' },
    list('almanac-current', 'Now', current.map((e) => eventLine(game, e, true)), 'All quiet on the farm.'),
    list('almanac-upcoming', 'Coming', upcoming.map((e) => eventLine(game, e, false)), 'Nothing announced.'),
    h(
      'section',
      { class: 'almanac-section', 'data-testid': 'almanac-threats' },
      h('h3', { class: 'group-title' }, 'Threats and defences'),
      h(
        'ul',
        { class: 'almanac-threats' },
        (Object.keys(HAZARD_INFO) as HazardKind[]).map((k) => {
          const info = HAZARD_INFO[k];
          return h('li', {}, h('strong', {}, `${info.icon} ${info.name}`), h('span', {}, withIcons(info.effect)), h('span', { class: 'almanac-guard' }, withIcons(`🛡️ ${info.defence}`)));
        }),
      ),
    ),
    list(
      'almanac-losses',
      'Recent',
      losses.map((n) => `Day ${Math.floor(n.at / DAY_MS) + 1}: ${n.text}`),
      'Nothing lost yet.',
    ),
  );
}

function signature(game: Game): string {
  const s = hazardsOf(game.state);
  // The countdowns tick in the lines: coarse, every 10 s of game time.
  return `${s.current.length}|${s.upcoming.length}|${s.log.length}|${s.log[0]?.at ?? 0}|${Math.floor(game.now / 10_000)}|${game.count('wood')}`;
}

function almanacSheet(ctx: FarmContext): SheetSpec {
  const { game } = ctx;
  return {
    id: 'almanac',
    title: () => '📖 Almanac',
    signature: () => signature(game),
    render: (body) => body.append(almanacBlock(game)),
  };
}

registerHudButton({
  id: 'almanac',
  label: 'Almanac',
  icon: '📖',
  onClick: (ctx) => ctx.ui.toggleSheet(almanacSheet(ctx)),
  badge: (ctx) => {
    const s = hazardsOf(ctx.game.state);
    return s.current.length + s.upcoming.filter((e) => e.announcedAt !== undefined).length;
  },
});

// Defences ---------------------------------------------------------------------------

for (const def of Object.values(DEFENCES)) {
  registerBehavior<Record<string, unknown>>(def.id, {
    panel: (ctx, obj) => {
      const { game } = ctx;
      const guarded = guardedBy(game.state, def.id, areaOf(obj));
      const what = def.against === 'fox' ? 'coop' : 'field';
      return {
        title: def.name,
        icon: def.icon,
        lines: obj.site
          ? ['Being built: a free farmer builds it.']
          : [def.description, `Guards ${guarded.length} ${what}${guarded.length === 1 ? '' : 's'} against ${HAZARD_INFO[def.against].name.toLowerCase()}.`],
      };
    },
  });
}

// On the map -------------------------------------------------------------------------

/** Crows on a field: where each one pecks, in grid units inside the 2×2 field. */
const CROW_SPOTS = [
  [0.55, 0.6],
  [1.35, 0.5],
  [0.9, 1.3],
  [1.5, 1.45],
] as const;

onGameStart((ctx) => {
  const { game } = ctx;
  const scene = ctx.scene;
  let crows: { target: string; birds: Phaser.GameObjects.Image[] }[] = [];

  const clearCrows = () => {
    for (const c of crows) c.birds.forEach((b) => b.destroy());
    crows = [];
  };

  /** One flock per field the crows are eating on; they hop and peck on real time (cosmetic). */
  const updateCrows = () => {
    const eating = hazardsOf(game.state).current.filter((e) => e.kind === 'crows' && e.target);
    const want = eating.map((e) => e.target!).join('|');
    if (want !== crows.map((c) => c.target).join('|')) {
      clearCrows();
      for (const e of eating) {
        const field = game.getObject(e.target!);
        if (!field) continue;
        const birds = CROW_SPOTS.map(([gx, gy]) => {
          const at = gridToWorld(field.x + gx, field.y + gy);
          return addArt(scene, at.x, at.y, CROW_ART[0]).setDepth(walkerDepth(field.x + gx, field.y + gy)).setName('crow');
        });
        crows.push({ target: e.target!, birds });
      }
    }
    const t = scene.time.now;
    for (const c of crows) {
      const field = game.getObject(c.target);
      if (!field) continue;
      c.birds.forEach((b, i) => {
        const [gx, gy] = CROW_SPOTS[i];
        const phase = (t / 900 + i * 0.37) % 1;
        b.setTexture(textureKey(scene, CROW_ART[phase < 0.45 ? 1 : 0]));
        const hop = phase > 0.8 ? Math.sin(((phase - 0.8) / 0.2) * Math.PI) * 6 : 0;
        const at = gridToWorld(field.x + gx, field.y + gy);
        b.setPosition(at.x, at.y - hop);
        b.setFlipX(i % 2 === 1);
      });
    }
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, updateCrows);
  game.events.on('reset', clearCrows);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, updateCrows);
    clearCrows();
  });

  game.activity.on('hazard', (n) => ctx.ui.toast(n.text, TOAST_KIND[n.outcome]));

  // The build ghost of a defence: the tiles it reaches, and how many fields or coops stand in them.
  const reach = scene.add.graphics().setDepth(DEPTH.shadow - 0.25).setName('ghost-coverage');
  const label = scene.add
    .text(0, 0, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: `${Math.round(ISO_H * 0.5)}px`,
      fontStyle: 'bold',
      color: '#eaffd6',
      stroke: '#2b2118',
      strokeThickness: Math.round(ISO_H * 0.08),
      resolution: 2,
    })
    .setOrigin(0.5, 1)
    .setDepth(DEPTH.ghost + 1)
    .setVisible(false)
    .setName('ghost-coverage-label');
  const diamond = (x: number, y: number) => [gridToWorld(x, y), gridToWorld(x + 1, y), gridToWorld(x + 1, y + 1), gridToWorld(x, y + 1)].map((p) => new Phaser.Math.Vector2(p.x, p.y));
  onBuildPreview((_ctx, p) => {
    reach.clear();
    label.setVisible(false);
    const def = p ? DEFENCES[p.type as DefenceType] : undefined;
    if (!p || !def) return;
    const area = { x: p.x, y: p.y, ...def.footprint };
    const covered = new Set(guardedBy(game.state, def.id, area).map((o) => o.id));
    const r = def.range;
    for (let y = area.y - r; y < area.y + area.h + r; y++) {
      for (let x = area.x - r; x < area.x + area.w + r; x++) {
        if (!reaches(area, r, { x, y, w: 1, h: 1 })) continue;
        const on = game.objectAt(x, y);
        const hit = !!on && covered.has(on.id);
        reach.fillStyle(hit ? 0x7ec8ff : 0xdff3ff, hit ? 0.5 : 0.22);
        reach.fillPoints(diamond(x, y), true);
      }
    }
    const what = def.against === 'fox' ? 'coop' : 'field';
    const n = covered.size;
    const top = gridToWorld(area.x, area.y);
    label
      .setText(`${def.icon} Guards ${n} ${what}${n === 1 ? '' : 's'}`)
      .setColor(n > 0 ? '#eaffd6' : '#ffd0c8')
      .setPosition(top.x, top.y - ISO_H * 2.2)
      .setVisible(true);
  });

  /** `window.farm.hazards`, for QA. */
  registerDebugInfo('hazards', () => {
    const s = hazardsOf(game.state);
    return Object.freeze({
      ...structuredClone({ seed: s.seed, current: s.current, upcoming: s.upcoming, log: s.log }),
      coverage: (x: number, y: number) => coverage(game.state, x, y),
      /** Crow sprites on the map now. */
      crows: crows.reduce((n, c) => n + c.birds.length, 0),
      /** Fields and coops each defence type guards. */
      guarded: Object.fromEntries(
        (Object.keys(DEFENCES) as DefenceType[]).map((t) => [
          t,
          [...new Set(game.objectsOfType(t).filter((d) => !d.site).flatMap((d) => guardedBy(game.state, t, areaOf(d)).map((o) => o.id)))],
        ]),
      ),
    });
  });
});
