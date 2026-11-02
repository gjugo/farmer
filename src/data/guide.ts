/**
 * The first-session guide's steps: what each card says and what it points at. What finishes a step is in
 * `src/logic/guide.ts` (by the step's `id`); the card, ring and map marker are drawn by `src/features/guide`.
 */

export type GuideStepId =
  | 'look'
  | 'assign'
  | 'speed'
  | 'sow'
  | 'develop'
  | 'field'
  | 'harvest'
  | 'sell'
  | 'materials'
  | 'granary'
  | 'cottage'
  | 'done';

/**
 * Something on screen a step's ring goes round, tried in order: the first one shown wins.
 * - `'btn-build'`: the element with that `data-testid`;
 * - `'sell-all-*'`: the first element whose `data-testid` starts with `sell-all-`;
 * - `'action:Assign a farmer'`: the open panel's action button whose label contains the text.
 */
export type GuideRingTarget = string;

/**
 * Where a step's map marker stands: the farmhouse door, a field without a farmer, an empty field without a farmer, a
 * ripe field.
 */
export type GuideMapTarget = 'door' | 'field-free' | 'field-empty' | 'field-ripe';

export interface GuideStepDef {
  id: GuideStepId;
  title: string;
  /** One or two short sentences, naming the hotkey. */
  text: string;
  ring: readonly GuideRingTarget[];
  /** A pulsing marker on the map, shown while no sheet is open. */
  map?: GuideMapTarget;
  /** No ring on an action of an open panel whose lines contain this text (e.g. the field that has a farmer). */
  ringUnless?: string;
}

export const GUIDE_STEPS: readonly GuideStepDef[] = [
  {
    id: 'look',
    title: 'Look around',
    text: 'Drag the map or use WASD to move; the mouse wheel or a pinch zooms. The chips top left count your farmers, homes, approval and supplies.',
    ring: ['hud-overview'],
  },
  {
    id: 'assign',
    title: 'Put your farmer to work',
    text: 'Tap a starting field, then 👨‍🌾 Assign a farmer: they plough, sow (🌱 Best in season) and harvest it by themselves.',
    ring: ['action:Assign a farmer'],
    map: 'field-free',
  },
  {
    id: 'speed',
    title: 'Speed up time',
    text: 'Work and crops take time: ⏩ ×4 or ⏭ ×12 (keys 1–3) speed it up. ⏸ or Space pauses.',
    ring: ['speed-12'],
  },
  {
    id: 'sow',
    title: 'Sow a field yourself',
    text: 'Tap the other field and pick 🌾 Wheat. A free farmer walks over and sows it; if yours is busy, try again in a moment.',
    ring: ['action:Wheat ·'],
    map: 'field-empty',
    ringUnless: 'works here ·',
  },
  {
    id: 'develop',
    title: 'Your farm’s level',
    text: 'Tap ⭐ the level for Development: 🎯 Goals pay money and XP, so claim the finished ones.',
    ring: ['btn-level'],
  },
  {
    id: 'field',
    title: 'Build a field',
    text: '🔨 Build (B) → 🌾 Farming → Field. The ghost turns green where a path from the farmhouse reaches it: lay one with 🛤️ Paths (P).',
    ring: ['build-field', 'build-cat-farming', 'btn-build'],
  },
  {
    id: 'harvest',
    title: 'Bring in the harvest',
    text: 'Your farmer harvests ripe wheat (or tap it → Harvest). The resource bar shows it; the farmhouse holds only 30 goods.',
    ring: ['action:Harvest', 'hud-resources'],
    map: 'field-ripe',
  },
  {
    id: 'sell',
    title: 'Sell at the Market',
    text: '⚖️ Trade (T) → 🏪 Market sells your crops. Past the daily allowance prices drop, so sell a little each day.',
    ring: ['sell-all-*', 'btn-trade'],
  },
  {
    id: 'materials',
    title: 'Wood and stone',
    text: 'Buildings need 🪵 wood and 🪨 stone. Buy wood at the Market, or build a 🪓 Woodcutter’s Lodge near trees and assign a farmer.',
    ring: ['buy-5-wood', 'build-woodcutter', 'btn-trade'],
  },
  {
    id: 'granary',
    title: 'Build a granary',
    text: '🔨 Build → 📦 Storage → Granary: room for 100 goods. A free farmer builds the site.',
    ring: ['build-granary', 'build-cat-storage', 'btn-build'],
  },
  {
    id: 'cottage',
    title: 'More farmers',
    text: 'Farmers come as families into 🛖 Cottages (🔨 → 🏠 Homes). Approval of 50% or more (food, firewood in winter) brings them: 👪 Farm (F) → Families.',
    ring: ['build-cottage', 'build-cat-homes', 'btn-build'],
  },
  {
    id: 'done',
    title: 'You’re set!',
    text: '📖 Almanac (H) warns of hazards, every level-up offers a perk, and ⚙️ Menu → Settings restarts this guide.',
    ring: ['btn-almanac'],
  },
];
