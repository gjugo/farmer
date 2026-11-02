import type Phaser from 'phaser';
import {
  ARRIVE_APPROVAL,
  CLOTH_PER_FAMILY,
  CLOTHES_PER_FAMILY,
  COTTAGE,
  FAMILIES_PER_ALE,
  FIREWOOD_PER_HOME,
  FOODS,
  LEAVE_APPROVAL,
  MAX_COTTAGE_LEVEL,
  MEAL_PER_FAMILY,
} from '../../data/families';
import { getItem } from '../../data/items';
import { MAX_FARMERS } from '../../data/workers';
import type { FarmContext, ObjectView, PanelSpec, PlacedObject, SheetSpec } from '../../game/context';
import { onGameStart, registerBehavior, registerDebugInfo, registerHudButton } from '../../game/hooks';
import { formatDuration } from '../../logic/crops';
import { cottageChecklist, nextCottageLevel, upgradeCottage } from '../../logic/cottages';
import { aleWanted, clothesNeeded, familiesCount, familiesOf } from '../../logic/families';
import { cottageLevel, cottageRoom, familiesIn, homeList, homeRoom } from '../../logic/homes';
import { buildTime } from '../../logic/perks';
import { suppliesOf } from '../../logic/supplies';
import type { GameState } from '../../logic/types';
import type { Game } from '../../logic/game';
import { seasonOf } from '../../logic/seasons';
import { withFarmer } from '../../game/workers';
import { ART_RES, ART_SCALE, cottageArt, SHADOW } from '../../scenes/art';
import { packAsset, textureKey } from '../../scenes/sprites';
import { h } from '../../ui/dom';
import { withIcons } from '../../ui/icons';
import { homeGardenLine } from '../gardens';

/**
 * Families on the map and in the HUD: the approval chip (😊 62%) opens the Families sheet with homes, families,
 * approval and its breakdown; arrivals and departures are toasted; cottages puff chimney smoke on winter days while
 * their family has firewood. Rules live in `src/logic/families.ts`, numbers in `src/data/families.ts`. The Farmers
 * sheet shows the same block (`familiesBlock`).
 */

/** A face for the approval: happy, content, unsure, unhappy. */
export function approvalFace(approval: number): string {
  if (approval >= 75) return '😄';
  if (approval >= ARRIVE_APPROVAL) return '😊';
  if (approval >= LEAVE_APPROVAL) return '😐';
  return '😟';
}

const pointsText = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

/** "🌾 Wheat ×2, 🥕 Carrot ×2" */
function foods(ate: Record<string, number>): string {
  return Object.entries(ate)
    .map(([id, n]) => `${getItem(id)?.icon ?? ''} ${getItem(id)?.name ?? id} ×${n}`.trim())
    .join(', ');
}

/** What the sheet says about the next family: when they come, or what stops them. */
function arrivalHint(game: Game): string {
  const { state } = game;
  const homes = homeRoom(state);
  const families = familiesCount(state);
  const s = familiesOf(state);
  if (families >= MAX_FARMERS) return `Your farm has the most families it can (${MAX_FARMERS}).`;
  if (families > homes) return `${families - homes} of your farmers have no home of their own: build a 🛖 cottage, or upgrade one, before another family can come.`;
  if (families === homes) return 'Build a 🛖 cottage, or upgrade one, to house another family.';
  if (s.approval < ARRIVE_APPROVAL) return `A home is free: a family moves in once approval reaches ${ARRIVE_APPROVAL}%.`;
  const at = s.nextArrivalAt;
  return at !== null && at > game.now ? `A home is free: a new family arrives in about ${formatDuration(at - game.now)}.` : 'A home is free: a new family is on the way.';
}

/** Homes, families, approval with its breakdown, yesterday's needs and the next arrival: for the Families and Farmers sheets. */
export function familiesBlock(game: Game): HTMLElement {
  const { state } = game;
  const s = familiesOf(state);
  const homes = homeRoom(state);
  const families = familiesCount(state);
  const day = s.lastDay;
  const lastLines: string[] = [];
  if (day) {
    lastLines.push(day.eaten > 0 ? `🍽️ Ate ${foods(day.ate)} (${day.eaten} of ${day.meal})` : `🍽️ Nothing to eat (they needed ${day.meal})`);
    if (day.firewood !== null) lastLines.push(`🪵 Firewood: ${day.firewood} of ${day.firewoodNeeded} homes warm`);
    if (day.ale != null) lastLines.push(`🍺 Ale: ${day.ale} of ${day.families} families had some (${day.aleDrunk ?? 0} drunk)`);
    if (day.clothed !== null) {
      const dressed = Math.min(day.dressed ?? 0, day.clothed);
      lastLines.push(`🧵 Clothed: ${day.clothed} of ${day.families}${dressed > 0 ? ` (👕 ${dressed} in clothes, 🧵 ${day.clothed - dressed} in cloth)` : ''}`);
    }
  }
  const clothes = clothesNeeded(game)
    ? ` At the start of winter each family takes ${CLOTHES_PER_FAMILY} 👕 clothes if there are any (happier), otherwise ${CLOTH_PER_FAMILY} 🧵 cloth, and stays clothed all year.`
    : ' Once the loom is unlocked they also want 🧵 cloth each winter.';
  const ale = aleWanted(game) ? ` Each day they drink 1 🍺 ale per ${FAMILIES_PER_ALE} families while there is any.` : '';
  return h(
    'div',
    { class: 'families', 'data-testid': 'families' },
    h(
      'p',
      { class: 'families-stats' },
      h('span', { 'data-testid': 'families-homes' }, `🏡 room for ${homes} ${homes === 1 ? 'family' : 'families'}`),
      h('span', { 'data-testid': 'families-count' }, `👪 ${families} ${families === 1 ? 'family' : 'families'}`),
      h('span', { class: `families-approval approval-${s.approval >= ARRIVE_APPROVAL ? 'good' : s.approval >= LEAVE_APPROVAL ? 'meh' : 'bad'}`, 'data-testid': 'families-approval' }, `${approvalFace(s.approval)} ${s.approval}%`),
    ),
    h('p', { class: 'families-hint', 'data-testid': 'families-hint' }, arrivalHint(game)),
    s.approval < LEAVE_APPROVAL && families > 1
      ? h('p', { class: 'families-warn', 'data-testid': 'families-warn' }, `Approval is below ${LEAVE_APPROVAL}%: if it stays there all day, a family leaves the farm.`)
      : null,
    h(
      'ul',
      { class: 'families-breakdown', 'data-testid': 'families-breakdown', 'aria-label': 'Approval breakdown' },
      s.breakdown.map((p) =>
        h('li', { class: p.points < 0 ? 'minus' : p.points > 0 ? 'plus' : '' }, h('span', {}, p.label), h('strong', {}, p.id === 'base' ? `${p.points}%` : pointsText(p.points))),
      ),
    ),
    lastLines.length ? h('ul', { class: 'families-day', 'data-testid': 'families-day', 'aria-label': 'Yesterday' }, lastLines.map((l) => h('li', {}, withIcons(l)))) : null,
    h(
      'p',
      { class: 'muted families-needs' },
      withIcons(
        `Each family eats ${MEAL_PER_FAMILY} food a day from the granary (${FOODS.map((id) => getItem(id)?.icon ?? id).join(' ')}): the more kinds they get, the happier they are. On winter days each family burns ${FIREWOOD_PER_HOME} 🪵 wood at its own hearth, from the storehouse.${clothes}${ale}`,
      ),
    ),
  );
}

/** Changes whenever the block would read differently (the arrival countdown ticks in the hint, so it is coarse). */
export function familiesSignature(game: Game): string {
  const s = familiesOf(game.state);
  const left = s.nextArrivalAt !== null ? Math.ceil((s.nextArrivalAt - game.now) / 10_000) : -1;
  return `${homeRoom(game.state)}|${familiesCount(game.state)}|${s.approval}|${s.settledDay}|${left}|${clothesNeeded(game)}|${aleWanted(game)}`;
}

function familiesSheet(ctx: FarmContext): SheetSpec {
  const { game } = ctx;
  return {
    id: 'families',
    title: () => '👪 Families',
    signature: () => familiesSignature(game),
    render: (body) => {
      body.append(
        h(
          'p',
          { class: 'muted' },
          'Every farmer is a family living in a home: the farmhouse or a cottage. Happy families bring more families; unhappy ones leave.',
        ),
        familiesBlock(game),
      );
    },
  };
}

registerHudButton({
  id: 'families',
  label: 'Families',
  icon: '👪',
  spot: { kind: 'tab', window: 'farm', order: 10, sheet: familiesSheet },
});

/** Cottages still being built: "(+N)" on the home room chip. */
function homesBuilding(state: GameState): number {
  return state.objects.filter((o) => o.type === COTTAGE && o.site).length;
}

registerHudButton({
  id: 'homes',
  label: 'Free home room',
  icon: '🏠',
  spot: {
    kind: 'chip',
    order: 30,
    opens: 'families',
    detail: (ctx) => {
      const { state } = ctx.game;
      const homes = homeRoom(state);
      const building = homesBuilding(state);
      return [
        `Room for ${homes} ${homes === 1 ? 'family' : 'families'} (the farmhouse and every cottage; a level 2 cottage houses 2), ${familiesCount(state)} living here`,
        building ? `${building} ${building === 1 ? 'cottage' : 'cottages'} being built` : 'Build a 🛖 cottage, or upgrade one, for one more family',
        arrivalHint(ctx.game),
      ];
    },
  },
  live: (ctx) => {
    const { state } = ctx.game;
    const building = homesBuilding(state);
    return { icon: '🏠', label: `${Math.max(0, homeRoom(state) - familiesCount(state))}${building ? ` (+${building})` : ''}` };
  },
});

registerHudButton({
  id: 'approval',
  label: 'Approval',
  icon: '😊',
  spot: {
    kind: 'chip',
    order: 40,
    opens: 'families',
    detail: (ctx) => [
      ...familiesOf(ctx.game.state).breakdown.map((p) => `${p.label}: ${p.id === 'base' ? `${p.points}%` : pointsText(p.points)}`),
      `New families come from ${ARRIVE_APPROVAL}%; below ${LEAVE_APPROVAL}% one leaves.`,
    ],
  },
  live: (ctx) => {
    const { approval } = familiesOf(ctx.game.state);
    return { icon: approvalFace(approval), label: `${approval}%` };
  },
});

registerHudButton({
  id: 'supplies',
  label: 'Supplies: days of food left (in winter, of food or firewood, whichever runs out first)',
  icon: '🧺',
  spot: {
    kind: 'chip',
    order: 60,
    opens: 'storage',
    detail: (ctx) => {
      const s = suppliesOf(ctx.game.state);
      const days = (n: number | null) => (n === null ? 'nobody eats' : `${n} ${n === 1 ? 'day' : 'days'}`);
      return [
        `🍽️ Food: ${s.food.stock}, ${s.food.perDay} a day → ${days(s.food.days)}`,
        s.firewood ? `🪵 Firewood: ${s.firewood.stock}, ${s.firewood.perDay} a day → ${days(s.firewood.days)}` : '🪵 Firewood is burnt in winter only',
      ];
    },
  },
  live: (ctx) => {
    const s = suppliesOf(ctx.game.state);
    return { icon: s.limit === 'firewood' ? '🪵' : '🧺', label: s.days === null ? '–' : String(s.days) };
  },
});

/** The running game, for the debug info (set at game start). */
let current: Game | null = null;

/** `window.farm.families`, for QA. */
registerDebugInfo('families', () => {
  const game = current;
  if (!game) return null;
  const s = familiesOf(game.state);
  const d = s.lastDay;
  return Object.assign(structuredClone({
    homes: homeRoom(game.state),
    families: familiesCount(game.state),
    approval: s.approval,
    breakdown: s.breakdown,
    lastDay: d
      ? {
          ate: d.ate,
          variety: d.variety,
          firewood: d.firewood,
          // Families clothed this year: in the tailor's clothes and in cloth.
          clothed: d.clothed === null ? null : { families: d.clothed, clothes: Math.min(d.dressed ?? 0, d.clothed), cloth: d.clothed - Math.min(d.dressed ?? 0, d.clothed) },
          ale: d.ale == null ? null : { families: d.ale, drunk: d.aleDrunk ?? 0 },
        }
      : null,
    nextArrivalAt: s.nextArrivalAt,
    homeList: homeList(game.state, familiesCount(game.state)),
  }), {
    /** The upgrade checklist of cottage `id` (`{ level, fuel, food, cost, ok }`, each line `{ ok, text }`), or null. */
    upgrade: (id: string) => {
      const obj = game.getObject(id);
      if (!obj || obj.type !== COTTAGE) return null;
      const c = cottageChecklist(game, obj);
      return structuredClone({ level: c.level, fuel: c.fuel, food: c.food, cost: c.cost, ok: c.ok, next: c.next, blocked: c.blocked });
    },
  });
});

onGameStart((ctx) => {
  current = ctx.game;
  const { activity } = ctx.game;
  activity.on('familyArrived', ({ families }) => ctx.ui.toast(`👪 A new family moved in! Farmer ${families} is ready for work.`, 'success'));
  activity.on('familyLeft', ({ workplace }) =>
    ctx.ui.toast(`🧳 A family left the farm: approval stayed below ${LEAVE_APPROVAL}%.${workplace ? ' Their workplace is free.' : ''}`, 'error'),
  );
});

// Cottages ---------------------------------------------------------------------------

/**
 * The chimney tops in each level's 2x sprite (the Ludo.ai cottages, `tools/ludo/source/cottage_raw.png` and
 * `cottage_2_raw.png`). Each family has its own hearth: chimney i smokes while family i + 1 lives there.
 */
const CHIMNEY_AT: readonly (readonly { x: number; y: number }[])[] = [
  [{ x: 172, y: 18 }],
  [
    { x: 167, y: 38 },
    { x: 323, y: 12 },
  ],
];
const PUFFS = 3;

interface CottageView {
  level: number;
  /** Puffs per chimney. */
  puffs: Phaser.GameObjects.Image[][];
  badge: Phaser.GameObjects.Container | null;
}

const cottageViews = new Map<string, CottageView>();

/** Families living in this cottage: homes fill up in build order after the farmhouse, each up to its room. */
function occupants(game: Game, obj: PlacedObject): number {
  return obj.site ? 0 : familiesIn(game.state, familiesCount(game.state), obj.id);
}

/** Smoke on winter days while the homes have firewood. */
function smoking(game: Game): boolean {
  const day = familiesOf(game.state).lastDay;
  return seasonOf(game.state.clock) === 'winter' && !!day && day.firewood !== null && day.firewood > 0;
}

/** Puts up the sprite, chimneys and "Lv 2" badge (none at level 1) of the cottage's level. */
function syncCottage(ctx: FarmContext, obj: PlacedObject, view: ObjectView): void {
  const level = cottageLevel(obj);
  const cv = cottageViews.get(obj.id);
  if (!cv || cv.level === level) return;
  cv.level = level;
  const art = cottageArt(level);
  view.sprite.setTexture(textureKey(ctx.scene, art));
  view.shadow?.setTexture(textureKey(ctx.scene, `${art}${SHADOW}`));
  for (const p of cv.puffs.flat()) p.destroy();
  cv.badge?.destroy();
  cv.badge = null;
  const [ax, ay] = packAsset(art)?.res[ART_RES].anchor ?? [0, 0];
  cv.puffs = (CHIMNEY_AT[level - 1] ?? CHIMNEY_AT[0]).map((c) => {
    const at = { x: view.top.x + (c.x - ax) * ART_SCALE, y: view.top.y + (c.y - ay) * ART_SCALE };
    const puffs = Array.from({ length: PUFFS }, () => ctx.scene.add.image(at.x, at.y, 'proc-smoke').setVisible(false).setData('at', at));
    view.container.add(puffs);
    return puffs;
  });
  if (level > 1) {
    // Like the granary's, but centred over the roof between the chimneys, so it hides neither.
    const label = ctx.scene.add
      .text(0, 0, `Lv ${level}`, { fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#fff8e6', resolution: 2 })
      .setOrigin(0.5);
    const bg = ctx.scene.add.graphics();
    bg.fillStyle(0x3a2618, 0.85).fillRoundedRect(-22, -11, 44, 22, 10);
    bg.lineStyle(2, 0xf2c14e).strokeRoundedRect(-22, -11, 44, 22, 10);
    cv.badge = ctx.scene.add.container(view.top.x, view.top.y - ay * ART_SCALE - 8, [bg, label]).setName(`cottage-level-${level}`);
    view.container.add(cv.badge);
  }
}

/** "Home of 2 families" / "1 family, room for 1 more" / "Empty, room for 2". */
function occupancyLine(n: number, room: number): string {
  if (n === 0) return room === 1 ? 'Empty.' : `Empty, room for ${room}.`;
  if (n >= room) return n === 1 ? 'Home of a family.' : `Home of ${n} families.`;
  return `${n} ${n === 1 ? 'family' : 'families'}, room for ${room - n} more.`;
}

function doUpgradeCottage(ctx: FarmContext, obj: PlacedObject): void {
  withFarmer(ctx, 'build', obj, buildTime(ctx.game.state, obj.type), () => {
    const r = upgradeCottage(ctx.game, obj);
    if (!r.ok) {
      ctx.ui.toast(r.reason === 'needs' ? `Cannot upgrade: ${missingLines(ctx.game, obj)}` : 'Cannot upgrade', 'error');
      return false;
    }
    ctx.ui.toast(`🏡 Cottage upgraded to level ${r.level}: room for ${cottageRoom(obj)} families`, 'success');
    return true;
  });
}

/** The unmet lines, for the toast when the needs lapsed while the farmer walked there. */
function missingLines(game: Game, obj: PlacedObject): string {
  const c = cottageChecklist(game, obj);
  return [c.level, c.fuel, c.food, c.cost].filter((l) => !l.ok).map((l) => l.text).join('; ');
}

function cottagePanel(ctx: FarmContext, obj: PlacedObject): PanelSpec {
  const { game } = ctx;
  const level = cottageLevel(obj);
  const title = level > 1 ? `Cottage · Level ${level}` : 'Cottage';
  if (obj.site) return { title, icon: '🛖', lines: ['Being built: a free farmer builds it, then a family can move in.'] };
  const n = occupants(game, obj);
  const room = cottageRoom(obj);
  const { approval } = familiesOf(game.state);
  const lines = [`Level ${level} of ${MAX_COTTAGE_LEVEL}.`, occupancyLine(n, room)];
  if (n > 0) lines.push(`Their ${n === 1 ? 'farmer sets' : 'farmers set'} out from the farmhouse door like everyone else. ${approvalFace(approval)} Approval ${approval}% (see 👪 Families).`);
  if (n < room) lines.push(arrivalHint(game));
  const spec: PanelSpec = { title, icon: '🛖', lines, hint: homeGardenLine(game, obj) };
  const next = nextCottageLevel(obj);
  if (!next) {
    lines.push('Top level.');
    return spec;
  }
  const c = cottageChecklist(game, obj);
  lines.push(`⬆️ Level ${next.level} houses ${next.room} families. It needs:`);
  spec.checklist = [
    { id: 'cottage-level', ok: c.level.ok, text: c.level.text },
    { id: 'cottage-fuel', ok: c.fuel.ok, text: c.fuel.text },
    { id: 'cottage-food', ok: c.food.ok, text: c.food.text },
    { id: 'cottage-cost', ok: c.cost.ok, text: c.cost.text },
  ];
  spec.actions = [{ label: `⬆️ Upgrade to level ${next.level}`, disabled: !c.ok, testId: 'cottage-upgrade', onClick: () => doUpgradeCottage(ctx, obj) }];
  return spec;
}

registerBehavior<Record<string, unknown>>(COTTAGE, {
  create: (ctx, obj, view: ObjectView) => {
    cottageViews.set(obj.id, { level: 0, puffs: [], badge: null });
    syncCottage(ctx, obj, view);
  },
  refresh: syncCottage,
  update: (ctx, obj) => {
    const cv = cottageViews.get(obj.id);
    if (!cv) return;
    const on = smoking(ctx.game);
    const families = on ? occupants(ctx.game, obj) : 0;
    // Cosmetic only, so it runs on real time.
    const t = ctx.scene.time.now;
    cv.puffs.forEach((puffs, chimney) =>
      puffs.forEach((p, i) => {
        const lit = chimney < families;
        p.setVisible(lit);
        if (!lit) return;
        const a = p.getData('at') as { x: number; y: number };
        const phase = (t / 2000 + i / PUFFS + chimney * 0.37) % 1;
        p.setPosition(a.x + Math.sin(phase * 5 + i) * 5 + phase * 10, a.y - phase * 40);
        p.setAlpha(0.7 * (1 - phase));
        p.setScale(0.45 + phase * 0.7);
      }),
    );
  },
  destroy: (_ctx, obj) => void cottageViews.delete(obj.id), // the puffs and badge go with the view's container
  panel: cottagePanel,
});
