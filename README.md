# farmer

A cheerful 2D farming game for the browser, built with **Phaser 4**, **Vite** and **TypeScript**.
Grow the farm, build fields and pastures, raise animals, turn crops and animal products into
milk, cheese, eggs and more, and sell them to expand.

## Running it

```bash
npm ci
npm run dev                          # http://localhost:5173
npm run dev -- --port 5243 --strictPort
```

| Script              | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Vite dev server with hot reload                |
| `npm run build`     | Typecheck and production build into `dist/`    |
| `npm run preview`   | Serve the production build                     |
| `npm run typecheck` | `tsc --noEmit` (strict)                        |
| `npm run lint`      | ESLint                                         |
| `npm test`          | Vitest unit tests (`src/**/*.test.ts`)         |
| `npm run art`       | Regenerate `public/assets/farm/` from its Python source ([tools/art](tools/art/README.md); needs Python 3.12+ and cairo, not part of CI) |

CI (`.github/workflows/ci.yml`) runs `npm ci`, typecheck, lint, test and build on every PR and on `main`.

### Controls

- **Pan:** drag the map, or WASD / arrow keys. **Zoom:** mouse wheel or pinch.
- **Build:** 🔨 Build → pick an item → click/tap a tile. A green ghost means the spot is valid (and a path from the
  farmhouse reaches it). Esc, right-click or **Cancel** leaves build mode. Each item shows its money cost and the
  **building materials** it takes (🪵 wood, 🪨 stone, 🔩 iron); what you can't pay for is greyed out with what is missing
  ("Needs 4 more 🪵 Wood"), its ghost turns red, and placing it says to buy the rest at the 🏪 Market.
  Paths and fields cost money only; coops, pastures and processing buildings need wood and/or stone,
  and the dairy and loom also need iron. Money and materials are paid on placing. Paths are laid at once; everything
  else becomes a **construction site** (drawn faded, with 🚧 and a progress bar) that a free farmer walks to and builds:
  1.5 game-s per footprint tile, 3–20 s. A site can't be used until it is finished; its panel shows the build only.
- **Demolish:** 🧹 → click an object, or **Demolish** in its panel (which asks first and says what comes back).
  Gives back 50% of its money cost and 50% of its materials (rounded down; an unfinished site gives back everything),
  materials only as far as the storehouses have room: the confirm says what would be lost (demolish mode asks first too when something would be lost).
  A granary or storehouse can't be demolished while its stock wouldn't fit without it ("Sell or use 40 goods first").
- **Storage:** everything the farm holds needs room. **Goods** (crops, eggs, milk, wool, feed, cheese, bread, …) go
  in **granaries**, **materials** (wood, stone, iron) in **storehouses**; the farmhouse holds 30 of each on top. A
  granary holds 100 / 250 / 500 goods at level 1 / 2 / 3 ($30 + 5 🪵 to build), a storehouse 60 / 150 / 300 materials
  ($60 + 8 🪵 + 8 🪨). Click one for its panel: level, the pool's used/capacity, what is stored, and **Upgrade** with its
  cost (level 3 needs 🔩 iron) or why it can't be done yet. An upgrade keeps a farmer busy like building. The level
  shows on the map (each level has its own art, plus an "Lv 2" badge). A granary or storehouse holds nothing while it is
  still a construction site. 🎒 Inventory shows both pools as bars, warns
  from 90% and says clearly when one is full. Wherever items come in, only what fits goes in: a harvest is refused
  ("The granary is full: …") and the crop stays ripe in the field; eggs, milk and wool stay in the pen and finished
  goods in their building until there is room (Collect takes what fits and says what is left); a feed pack is refused
  and materials bought at the Market are capped at the room left; debug **+10** adds what fits. An assigned farmer
  doesn't harvest or collect what won't fit: the Farmers sheet says the granary is full, and a pen's farmer still feeds
  and a building's farmer keeps the queue going meanwhile. Selling, fulfilling
  orders and starting processing jobs free room at once. Time away only moves goods into pens and buildings, as
  always. Saves from before storage keep everything, even above capacity, but nothing new comes into an over-full
  pool until it is back under; a one-time toast suggests building a granary.
- **Market:** 🏪 Market sells anything in the inventory at today's price (**Sell everything** keeps building
  materials). Its **Buy building materials** section sells wood, stone and (from level 3) iron: **Buy 1/5/10**, or
  pick any amount with the − / + stepper. It shows the storehouse room left; a purchase is capped at that room
  ("Bought only 5 …") and refused when there is none. Buy prices change daily like sell prices and are always above anything the
  Market pays, so buying and selling back loses money (and selling materials gives no XP). Too little money: the
  purchase is refused with a toast. New farms start without materials; the goal "Buy 10 wood" comes just before
  "Build a chicken coop".
- Click an object to open its action panel.
- **Animals:** build a Chicken Coop or Pasture, open it to buy animals and feed. Fed animals produce
  after their cycle (chicken 3 game-minutes, cow 6, sheep 8); click the pen (or **Collect**) to pick up eggs, milk and wool.
- **Processing:** build a Feed Mill, Dairy, Bakery or Loom, open it and pick a recipe. Inputs are taken at once;
  up to 3 jobs queue and run one at a time (feed 2 game-minutes, butter 4, bread 5, cheese 8, cloth 10).
  Click the building (or **Collect**) to pick up finished goods.
- **Orders:** 📋 Orders shows 3 customer orders for goods you have had before. Fulfil hands over the goods
  for a reward above today's market value; the HUD badge counts orders you can fulfil now. A fulfilled slot
  gets a new order after 8 game-minutes, a discarded one after 20.
- **Crops:** tap an empty field → pick wheat, carrot or corn (paid in money). Each takes a real part of its season:
  wheat 8 game-minutes (10 wheat), carrot 10 (10 carrots), corn 16 (12 corn). Tap a growing field for
  its progress; tap a ripe (swaying, sparkling) field to harvest into the inventory.
- **Farmers:** building, ploughing, planting, harvesting, feeding, collecting and starting a batch each keep a farmer
  busy for a while: ploughing a field 40 game-seconds, sowing 30 s, harvesting 40 s, feeding a pen 20 s, collecting or
  starting a batch 20 s, building 15 s per footprint tile (30 s–3 min; paths need no farmer), plus the walk there and
  back. The farm starts with one farmer; hire more in 👨‍🌾 Farmers: $150 for the 2nd, ×1.2 for each after, up to 20.
  - **Workplaces:** fields, coops, pastures and processing buildings take one farmer each. Assign one with
    **👨‍🌾 Assign a farmer** in the object's panel (or **Unassign**), or pick each farmer's workplace in the 👨‍🌾 Farmers
    sheet, which lists every farmer with their workplace and what they are doing now. A farmer works at one place.
  - **Automatic work:** an assigned farmer does the next job there by themselves. A **field** is ploughed (in a
    ploughing season), sown with its **🌱 Crop plan** (a crop, **Best in season**, the default: the longest grower that is
    ripe before its seasons end, or **None**) and harvested when ripe; ploughing and seed are paid as by hand, and the
    work waits while money is short. A **coop or pasture** gets its products collected and its hungry animals fed from
    stock (it waits without feed). A **processing building** keeps queueing its **⚙️ Keep making** recipe while the
    inputs are in stock and the queue has room, and its finished goods are collected. The panel says why a farmer waits.
  - **Free farmers** (no workplace, or nothing to do there now) build construction sites, oldest first, and take what
    you tap: an unassigned workplace works by hand, and any free farmer does the job (one without a workplace first).
    When work appears at their own workplace again, they go back after their current job. When every farmer is busy,
    tapped work is refused until one is free.
  - The work runs on game time, so speed ×60 and offline catch-up give the same farm; the welcome-back summary
    reports what the farmers harvested, sowed, collected, made and built while you were away.
- **Farmhouse and roads:** every farm has a farmhouse (it can't be built or demolished). Idle farmers rest on its bench;
  for a job a farmer walks out of the door **along paths** to the work (0.4 game-s per tile), works there (hoeing,
  sowing, harvesting, hammering, feeding) and walks back, busy the whole way. Work on a field, pen or building is refused
  until a path joins it to the door ("No path leads there"), and the build ghost turns red where no path reaches.
  New farms start with a road from the door to both fields; older saves get a farmhouse and roads to what they built.
- **Seasons:** a game day lasts 8 real minutes at ×1 and each season 4 days, about 30 minutes (days 1–4 spring,
  5–8 summer, 9–12 autumn, 13–16 winter, then round again), so a year takes about 2 hours. The pace is slow on
  purpose: a new player reaches level 2 in 10–15 minutes and level 5 in 2–3 hours. The HUD shows the season next to
  the day and a toast announces each new one. A field must be **ploughed** ($5) before sowing.
  Ploughing works in spring, summer and autumn, and the soil stays ploughed through harvests until the winter frost,
  which turns every empty field back to unploughed (faded soil); in winter nothing can be ploughed or sown.
  Each crop is sown only in its seasons (wheat: spring–autumn, carrot: spring and autumn, corn: spring and summer),
  and only while it will be ripe before they end. A ripe crop keeps in the field, even into winter.
  The new farm's two starting fields come ploughed.
- **Sound:** starts on the first click/tap (browser autoplay rules). 🔊 in the HUD mutes everything; ⚙️ Settings has
  Music and Effects sliders, a mute switch and the audio Credits. Sound settings are kept in localStorage
  (`farmer.audio`), not in the save. Music and the ambience pause while the tab is hidden.

### Debug mode (QA)

Open `/?debug=1` for a panel with **+$1000**, **+10 of any item**, clock speed **×1 / ×10 / ×60 / ×300**
(at ×60 a season passes in 32 real seconds, at ×300 in under 7 and a whole year in under half a minute),
**Next season** (jumps the clock to the start of the next season, like time away but without the summary) and
**Refresh orders** (fills every order slot now). **+10** adds only what the granaries or storehouses have room for.
`window.farm` always returns a frozen, read-only snapshot of the game state (plus `day`), e.g.
`window.farm.money`, `window.farm.inventory`, `window.farm.objects`. `window.farm.orders` holds the
orders board: `known` goods and `slots[i]` (`order: { customer, items: [{ itemId, qty }], reward }` or
`refill: { start, duration }` with `reason: 'fulfilled' | 'discarded'`).
`window.farm.iso.tileToScreen(x, y)` returns the page pixel of tile (x, y)'s centre at the current camera, so a
script can click a known tile (`page.mouse.click(p.x, p.y)`). Browsers report mouse positions in whole CSS pixels,
so to click "just inside" an edge, stay at least 2 px inside it.
`window.farm.storage` is `{ goods: { used, capacity }, materials: { used, capacity } }`; each storage building's
level is `state.level` of its entry in `window.farm.objects` (type `granary` or `storehouse`).
`window.farm.season` is `{ season, dayOfSeason, msLeft }` (e.g. `season: 'winter'`, game ms until the next season).
`window.farm.workers` is `{ farmers, free, hireCost, list, assignments, plans, recipes, sites }`: `list[i]` is
`{ farmer, workplace, job, activity }` (workplace: object id or null; job: the running job's kind or null; activity:
the text the Farmers sheet shows), `assignments` maps workplace id → farmer, `plans` field id → crop plan
(`best`, `none` or a crop id), `recipes` building id → "Keep making" recipe, and `sites` lists the construction sites
oldest first (`{ id, type, x, y, workMs, paid, builder: { farmer, progress } | null }`). A placed object that is still a
site carries `site: { workMs, paid }` in `window.farm.objects`.
`window.farm.audio` is `{ muted, musicVolume, sfxVolume, lastPlayed }`, where `lastPlayed` lists the last 20 sound
keys played (e.g. `plant`, `coins`, `levelup`, `cluck`), so you can check which sounds fire without hearing them.

## Folder layout

```
src/
  main.ts            Wires everything: load save, HUD, Phaser game, autosave, window.farm
  logic/             Plain TypeScript, no Phaser (lint-enforced), unit-tested
    types.ts           GameState and friends
    game.ts            Game: the single owner of the state + typed events
    economy.ts         canAfford / spend / earn (money never goes negative)
    inventory.ts       add / remove / count (counts never go negative)
    land.ts            land ownership grid
    placement.ts       canPlace / objectAt
    clock.ts           game clock, Day N, game-time timers
    seasons.ts         seasons from the game clock (2 days each), season runs for ploughing and sowing windows
    market.ts          daily sell prices (base × 0.8–1.2 by day + item id), sell / sellAll; material buy prices, buy
    parcels.ts         land parcels, adjacency, parcel prices ($500, ×1.5), buyParcel
    save.ts            versioned save/load + migrations + defaults
    slices.ts          feature-owned global state (GameState.ext)
    crops.ts           ploughing, planting (in season), growth stages, harvest, starting fields
    workers.ts         farmers: hiring, jobs that keep a farmer busy, workplaces, crop plans, recipes (state slice `workers`)
    work.ts            the work scheduler: assigned farmers work their workplace, free ones build sites; steps on game time
    roads.ts           the farmhouse and paths: the route a farmer walks to a site; farmhouse for new and old farms
    orders.ts          orders board: known goods, seeded order generation, rewards, fulfil/discard, refill timers
    storage.ts         goods/materials pools: capacity, used, spaceFor (Game.addItem takes only what fits), upgrades
  data/              Content as data
    items.ts           item catalogue (ids shared by every feature)
    materials.ts       building materials (wood, stone, iron): ids, the level the Market sells each from, cost text
    storage.ts         granary and storehouse buildables, levels and capacities, the farmhouse store
    buildables.ts      build menu registry (+ the core Path)
    crops.ts           crop catalogue (with each crop's seasons) + the Field buildable
    seasons.ts         season names, icons, length, ploughing seasons and cost
    customers.ts       customer names for orders
  game/              Glue between logic, scene and UI
    context.ts         FarmContext, PanelSpec, ToolState
    hooks.ts           registerBehavior / registerHudButton / onGameStart / registerSettingsSection / registerDebugInfo
    signals.ts         uiSignals: UI moments that are not state changes (refused action, welcome-back opened)
  scenes/            Phaser scenes
    iso.ts             isometric projection (no Phaser, unit-tested): ISO_W/ISO_H, tile ↔ world, picking, depth order
    depth.ts           depth layers (ground, flat, shadow, tall, signs, ghost…)
    art.ts             the art pack (no Phaser, unit-tested): texture key → pack sprite, path/fence autotile
    sprites.ts         drawing pack sprites (anchors, 2x art at half scale, shadows)
    textures.ts        the few runtime-drawn textures (bubbles, sparkles, smoke, `missing`)
    BootScene.ts       loads the pack (progress bar), anchors, animations, composed textures
    FarmScene.ts       ground (one Blitter), scenery, objects, camera, build/demolish input
  ui/                HTML/CSS overlay above the canvas
    hud.ts             top bar, side sheet (build, inventory, settings, action panel), toasts, dialogs
    debug.ts           ?debug=1 panel
  features/          One folder per feature, auto-loaded (see below)
    path/              reference feature
    animals/           coops, pastures, wandering animals (data: src/data/animals.ts, logic: src/logic/animals.ts)
    processing/        feed mill, dairy, bakery, loom (data: src/data/processing.ts, logic: src/logic/processing.ts)
    fields/            field + crop views, ripe effects, plough/plant/harvest panel
    seasons/           season-change toasts, `window.farm.season`
    market/            🏪 Market HUD button: sell panel and Buy section for building materials
    storage/           granary and storehouse: art per level, level badge, storage panel with Upgrade,
                       `window.farm.storage`, the one-time notice for old saves
    orders/            📋 Orders HUD button (with badge) and orders panel
    workers/           👨‍🌾 Farmers HUD button, hire and workplace sheet, farmers at work on the map, `window.farm.workers`
                       (data: src/data/workers.ts, logic: src/logic/workers.ts and work.ts; hand work goes through
                       `withFarmer`, workplace panels get their farmer block from `workplacePanel`, src/game/workers.ts)
    land/              "For sale" signs on parcels next to owned land, buy dialog
    audio/             effects, animal voices, ambience, music; mute button, sound settings, credits
                       (files: public/audio/*.mp3, licences: CREDITS.md)
```

## Extending the game

Features live in `src/features/<name>/index.ts`. Every such file is imported automatically
(`import.meta.glob` in `src/features/index.ts`), and registers what it needs as a side effect.
**A new feature should not need to edit any shared file**, so parallel work rarely conflicts.

### Add an item

Items are shared ids, so they live in one place: add an entry to `ITEMS` in `src/data/items.ts`
(`id`, `name`, `category`, base sell `price`, emoji `icon`). Use the id everywhere else; give it a pack icon
in `public/assets/farm/*/icons/<id>.png` and list it in `ICON_ART` (`src/scenes/art.ts`), and its emoji in any
label shows as that icon
(`game.addItem('egg', 3)`, `game.count('milk')`).

### Add a buildable

```ts
// src/features/coop/index.ts
import { registerBuildable } from '../../data/buildables';
import { registerBehavior } from '../../game/hooks';
import { startTimer, timerDone, timerProgress, type Timer } from '../../logic/clock';

interface CoopState { hens: number; timer: Timer | null }

// `texture` is a sprite of the art pack (public/assets/farm/manifest.json), or a game key mapped to one in
// TEXTURE_ART (src/scenes/art.ts). It is drawn anchored on the footprint's top corner, with its shadow.
registerBuildable({
  id: 'coop',
  name: 'Chicken coop',
  cost: 100, // money
  materials: { wood: 8 }, // optional: { wood?, stone?, iron? }, bought at the Market; omit for money-only
  footprint: { w: 3, h: 3 }, // the sprite's footprint in the manifest
  texture: 'chicken_coop',
  category: 'animals',
  initialState: (): CoopState => ({ hens: 0, timer: null }), // also fills old saves
});

registerBehavior<CoopState>('coop', {
  create(ctx, obj, view) { /* add sprites to view.container */ },
  update(ctx, obj, view, gameDt) { /* animate; runs every frame */ },
  refresh(ctx, obj, view) { /* obj.state changed: update the view */ },
  panel: (ctx, obj) => ({
    title: 'Chicken coop',
    icon: '🐔',
    lines: [`Hens: ${obj.state.hens}`],
    progress: obj.state.timer ? { value: timerProgress(ctx.game.state.clock, obj.state.timer) } : undefined,
    actions: [
      {
        label: 'Collect eggs',
        disabled: !obj.state.timer || !timerDone(ctx.game.state.clock, obj.state.timer),
        onClick: () => {
          ctx.game.addItem('egg', obj.state.hens);
          obj.state.timer = startTimer(ctx.game.state.clock, 60_000);
          ctx.game.touch(obj); // announce the state change
          ctx.ui.floatText(obj.x, obj.y, `+${obj.state.hens} 🥚`);
        },
      },
    ],
  }),
});
```

The build menu (with money and material costs), ghost preview, placement rules, charging money and
materials (`game.place` refuses with reason `money` or `materials` and changes nothing), construction sites, demolish
refunds (half of both; everything for an unfinished site), saving and the action panel all come for free. Keep money +
materials at their usual buy prices (about $6 wood, $7 stone, $22 iron) in line with the level curve
(`src/logic/balance.test.ts`). A "Demolish" action is appended to every object panel. Placed from the build menu, it is
a construction site (`obj.site`) until a farmer has built it: no `onClick` and no `panel` run for it until then.

### Add a workplace

A buildable becomes a workplace (a farmer can be assigned; the panel gets the farmer block) by adding its type to
`isWorkplaceType` in `src/logic/workers.ts`, and its automatic work by a case in `workplaceNext` (`src/logic/work.ts`):
return `{ task: { kind, workMs, run } }` when there is a job (`run` does it now, as a tap would, and returns whether it
did) or `{ wait: reason }` when there is none. If its work can appear when a timer ends, add that end time in
`nextWorkEvent`, so the scheduler (and offline catch-up) wakes up then. Game time only: never frames or `Date.now()`.

### Add a timer

Never use `setTimeout`, `setInterval` or `Date.now()` for gameplay. Store a `Timer`
(`startTimer(clock, durationMs)`) in the object's state and read it with `timerProgress`,
`timerRemaining` and `timerDone`. Timers run on game time, so they survive save/load and
speed up with the debug clock speed. `game.now` is the current game time in ms;
1 day = 8 real minutes at ×1 (`DAY_MS`), 1 season = 4 days (`SEASON_DAYS`). Subscribe to `game.events.on('day', ...)`
for daily events. Keep durations in the data files (`src/data/*`, `src/logic/constants.ts`) and check the level
curve with `src/logic/balance.test.ts` after changing them. Time away is caught up when the game opens again
(`src/logic/offline.ts`, at ×1, up to `MAX_OFFLINE_MS`): timers simply end, and farmers do their work on the way.
Use `game.advance(ms)` to move time in tests (it runs the work scheduler); setting `clock.elapsed` directly skips the farmers.

### Other extension points

- **HUD button** (e.g. Market): `registerHudButton({ id, label, icon, onClick: (ctx) => ctx.ui.openPanel(...) })`.
  Add `badge: (ctx) => n` to show a count on the button (hidden at 0).
- **Global feature state** (e.g. market prices): `registerStateSlice('market', () => ({ ... }))`
  and `getSlice(game.state, 'market')`. Defaults are merged into old saves.
- **Custom sheet** (markup of your own, like the Market): `ctx.ui.toggleSheet({ id, title, signature, render, tick })`.
- **Confirm dialog:** `await ctx.ui.confirm(title, message, { confirmLabel, variant, disabled, hint })`.
- **Taps on empty tiles** (e.g. locked land): `registerTileTapHandler((ctx, x, y) => true /* handled */)`.
- **Panel drop-downs:** a `PanelSpec` may have `choices: [{ id, label, value, options, onChange }]`, rendered as
  `<select data-testid="panel-choice-<id>">` above the actions (e.g. the crop plan).
- **Work that needs a farmer:** wrap it in `withFarmer(ctx, kind, obj, durationMs, () => didIt)` from
  `src/game/workers.ts`; it refuses with a toast when every farmer is busy or no path leads from the farmhouse to the
  site, and sends a farmer along the path only if the action succeeded.
- **Selling:** `sell(game, itemId, qty?)` / `dailyPrice(game.day, itemId)` from `src/logic/market.ts`.
- **Buying materials:** `buy(game, itemId, qty)` / `buyPrice(game.day, itemId)` from `src/logic/market.ts`;
  `game.missingMaterials(def.materials)` and `game.canPayFor(type)` say whether a building can be paid for.
- **Items coming in:** always `game.addItem(itemId, qty)`. It takes only what the storage pools have room for and
  returns how many went in; check `game.spaceFor(itemId)` first for all-or-nothing intake (like a harvest), and
  leave what didn't fit where it was (in the pen, the building, the field). Rules: `src/logic/storage.ts`.
- **Feedback:** `ctx.ui.toast(msg, 'success' | 'error')`, `ctx.ui.floatText(tileX, tileY, text)`.
  Money changes float next to the money counter automatically.
- **Events:** `game.events.on('money' | 'inventory' | 'objectAdded' | 'objectRemoved' | 'objectChanged' | 'land' | 'day' | 'speed' | 'reset', fn)`.
- **Land:** `game.setLandOwned(x, y, true)` repaints tiles and fences.
- **Startup logic:** `onGameStart((ctx) => { ... })`.
- **New-game content:** `onNewGame((state) => addStartingObject(state, 'field', x, y))` from
  `src/logic/state.ts` (runs only for brand-new farms, not loaded saves).

## Save data

Autosaved to `localStorage` (`farmer.save`) every 10 s and when the tab is hidden or closed.
Saves are versioned (`SAVE_VERSION` in `src/logic/save.ts`). Missing fields fall back to
defaults, so adding state needs no migration; restructuring does (add one to `migrations`).
Settings → **New game** resets the farm after a confirmation.

## Art

The isometric farm pack in `public/assets/farm/` (its `README.md` and `manifest.json`; licence in
CREDITS.md). The 2x set is loaded and drawn at half scale, so one world pixel is one 1x pack pixel and a tile
is 128 × 64. `src/scenes/art.ts` maps the game's texture keys to pack sprites; anchors come from the manifest.
Only speech bubbles, sparkles and smoke are drawn at runtime. Emoji remain only where the pack has no icon
(animals, buildings, HUD buttons).

The pack is generated by Python code in [`tools/art/`](tools/art/README.md): `npm run art` rebuilds it into
`public/assets/farm/`. New crops, animals and buildings get their art there, in the same style; its README
has setup steps and a worked example.
