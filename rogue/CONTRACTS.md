# Module contracts (prototype v0.1)

All files are plain `<script>` IIFEs that extend the global `window.RD`. Pattern:
`(function (RD) { 'use strict'; ... })(window.RD = window.RD || {});`
No modules, no build step, no external libraries. Comments in English, player-facing text in Turkish.
Load order (index.html): config → meta → run → render → input → ui → main.
`config.js`, `main.js`, `index.html` are owned by the lead; do not change their contracts.

## RD.Meta + RD.computeStats (meta.js)
```
RD.Meta.data      = { coins: number, levels: { [upgradeId]: number }, stats: { runs, bestCoins, totalBlooms, totalCoins } }
RD.Meta.settings  = { mode: 'timer'|'evap', preset: null|'time'|'use'|'mixed', overrides: { [key]: number } }
RD.Meta.load()            // read localStorage (CONFIG.saveKey for data, CONFIG.saveKey+'-settings' for settings); try/catch; defaults if missing/corrupt
RD.Meta.save()            // write both; try/catch
RD.Meta.reset()           // wipe data (not settings) and save
RD.Meta.levelOf(id) -> number
RD.Meta.upgradeEffect(id, level) -> number   // TOTAL bonus at that level; 'add': per*level, 'mul': per*level, 'table': sum(table[0..level-1])
RD.Meta.costOf(id) -> number|null            // ceil(baseCost * growth^level); null when level >= max
RD.Meta.isUnlocked(id) -> bool               // all `requires` {id: minLevel} met
RD.Meta.canBuy(id) -> bool
RD.Meta.buy(id) -> bool                      // spends coins, levels up, saves
RD.Meta.addCoins(n)
RD.Meta.recordRun(result)                    // updates stats
RD.computeStats(levels) -> stats             // copy of CONFIG.base with every upgrade applied:
                                             //   'add'/'table': base + effect;  'mul': base * (1 + effect)
```

## RD.Run (run.js): pure simulation, no DOM, no drawing
```
const run = new RD.Run(stats, rules, field)
  stats  = RD.computeStats(...) output (+ tank may be overridden)
  rules  = { mode, baseTime, passiveDrain, rainCost, evapRamp, rampDelay, timeLimit }  // timeLimit 0 => no timer
  field  = { w, h }  // play area in CSS px
run.update(dt, input)        // input = { x, y, raining } in field coords; x/y may be null before first pointer move
run.resize(w, h)             // clamp cloud & plants into the new field
run.result() -> { coins, blooms, bestCombo, duration, endReason, mode }

Readable fields (render/ui read these every frame):
run.cloud = { x, y, r }      // r = visual radius, scale it with water/tank (fuller cloud = bigger, min ~60%)
run.water, run.tank          // current / max water
run.t                        // elapsed seconds
run.timeLimit                // 0 if no timer
run.drainRate                // current total water/s being lost (passive + evap ramp + rain), for HUD
run.raining                  // true while raining this frame (input.raining && water > 0)
run.rainRadius               // = stats.rainRadius
run.plants = [{ id, x, y, type, water, need, state: 'growing'|'bloomed', age, bloomAge }]
run.coins, run.blooms
run.combo                    // current multiplier, 1 = none
run.comboTimer               // seconds left in combo window, 0 = none
run.bestCombo
run.over, run.endReason      // 'water' | 'time'
run.events                   // cleared at the start of each update; push { type: 'bloom', x, y, coins, combo, plantType }
                             //   and { type: 'end', reason } so render can spawn popups/particles
```
Rules (PRD §3–4):
- Cloud moves toward input (x,y) at most stats.cloudSpeed px/s (smooth follow). Stays inside the field.
- Water loss per second = passiveDrain + (evapRamp * max(0, t - rampDelay)) + (raining ? rainCost : 0). Flat: rain strength does not change the cost.
- While raining every growing plant with distance <= rainRadius gets stats.rainRate * dt water. Bloom when water >= need.
- Bloom: combo multiplier: if comboTimer > 0, combo = min(CONFIG.combo.max, combo + CONFIG.combo.step) else 1; comboTimer = stats.comboWindow.
  coins += max(1, round((plant.coins + stats.coinBonus + (rose ? stats.roseBonus : 0)) * combo)). water = min(tank, water + stats.dew).
- No percentages: stats are flat numbers; multipliers (×) are fine (see PRD §2). stats.cloudSpeed reaching Run is already px/s (main.js converts the level).
- Bloomed plant lingers CONFIG.bloomLinger s then is removed; a new seedling spawns after CONFIG.respawnDelay at a random free spot (min spacing ~40 px, keep 30 px margin, avoid spawning directly under the cloud). Keep stats.plantCount plants on the field.
- Plant type: rose while fewer than stats.roseCount roses are growing, else daisy with CONFIG.daisyChance, else cactus.
- End: water <= 0 → 'water'; timeLimit > 0 and t >= timeLimit → 'time'. Set over once; further updates do nothing.

## RD.Render (render.js): canvas only
```
RD.Render.init(canvas)       // set up DPR-aware canvas sized to its parent (.stage)
RD.Render.resize()
RD.Render.fieldSize() -> { w, h }   // CSS px of the play area
RD.Render.draw(run|null, dt)        // null => idle backdrop (dry land, drifting idle cloud) behind shop/results
```
Draws: cracked dry ground (cheap, pre-rendered to an offscreen canvas on resize), soil turning green/darker
where it was watered (keep a low-res wetness grid in render), plants (growth by water/need, bloom with
flower color from CONFIG.plants), the cloud (soft puffy circles, slightly darker when low on water),
rain streaks inside the rain circle while raining, floating "+N" coin popups and small particles from run.events.
Palette: calm dusk tones in the spirit of Raindrop/demo/js/themes.js (no neon, no glow).

## RD.Input (input.js)
```
RD.Input.init(canvas)
RD.Input.state = { x, y, down }   // field coords (CSS px relative to canvas), down = pointer held OR Space held
```
Pointer events (mouse + touch), `touch-action: none` on the canvas, prevent context menu, release on pointerup/cancel/blur.

## RD.UI (ui.js): DOM overlays
```
RD.UI.init({ onStartRun, onOpenShop })
RD.UI.showScreen('run'|'results'|'shop')   // toggles #hud, #screen-results, #screen-shop
RD.UI.updateHud(run)                      // water bar, timer (timer mode) or evaporation meter (evap mode), coins, combo
RD.UI.showResults(result)                 // coins earned, blooms, best combo, end reason, buttons: Dükkân / Tekrar (Tekrar = onStartRun)
RD.UI.renderShop()                        // coin total, upgrade cards from CONFIG.upgrades (level/max, desc, cost, locked state), "Run Başlat"
```
Debug panel `#dbg` (toggle with `D` key or `#dbg-btn`): mode select (timer/evap), drain preset buttons
(time/use/mixed/none), number inputs for overrides baseTime, passiveDrain, rainCost, evapRamp, rampDelay, tank
(empty = use default; show the default as placeholder), "+1000 para", "Kaydı sıfırla". Changes write
RD.Meta.settings and save; they apply on the next run start.

## Art (2026-11-17): flat vector, drawn in code
- `js/flora.js` → `RD.Flora.draw(ctx, type, x, y, {size, growth, bloom, fade, wilt, sway, seed})`, `RD.Flora.icon(type, px)`.
  Plants are drawn from growth = water/need (sprout → stem → leaves → bud → bloom). No image assets.
- `RD.Render.art` exposes pure helpers (paintGround, createWet, wetDisc, drawWet, drawCloud, cloudBottom, drawTarget,
  stepRain, stepSplashes, addSplash, drawGreen, resetWet) used by `flora-preview.html`. The cloud is a flat two-tone vector drawn high above its
  rain target (cloudLift); the target has a ground shadow + dashed ring.

## Levels + boss (2026-11-20, PRD §12)
- `new RD.Run(stats, rules, field, ctx)`; ctx = { level: CONFIG.levels[i], flowers: {type:true} } from `RD.Meta.currentLevel()` / `unlockedFlowers()`.
- Run fields for render/ui: `level` (cfg), `bar` 0..1, `barPoints`, `barTarget`, `greenCell`, `gw`, `gh`, `greened` (Uint8Array, 1 = cell counted),
  `boss` = { kind 'arms'|'shield'|'shade', type (flower type), label, hint, x, y, t, parts:[{x,y,water,need,done,wet}],
  shield (≥1 = down, rose), shade / scorched (sunflower) }, `bossWin`.
- Events: `bossSpawn {x,y,label,hint,bossType}`, `bossPart {x,y}`, `bossBlocked {x,y}`, `bossScorch {x,y}`, `bossWin {x,y,coins,unlocks}`; end reason `'boss'`.
- `result()` adds levelId, levelName, bar, bossReached, bossWin, unlocks.
- Meta: `data.level` (highest unlocked; > levels.length = all cleared), `currentLevel()`, `allCleared()`, `unlockedFlowers()`, `flowerOfStat()`;
  `recordRun(result)` advances the level on a boss win. Tree nodes whose stat belongs to a locked flower are hidden.

## Soil, bloom greening, victory sweep (2026-11-20 b)
- `run.soil` (Float32Array, gw×gh, cell = `run.greenCell` px) is the single source of truth for watered ground.
  Rain adds `stats.rainRate × CONFIG.groundMul` per second (stronger rain greens faster); a bloom adds `CONFIG.bloomGreen.soil`
  in `bloomGreen.radius`. Visual grass level per cell = clamp(soil / CONFIG.lushSoil, 0, 1). `run.greened[k]` = counted for the bar.
- Boss win: `run.over` + `endReason 'boss'`, then main.js calls `run.victoryStep(dt)` each frame until it returns true.
  `run.sweep = { x, y, r, max, done, coins, blooms }`: a wave grows from the boss; cells inside r become lush (soil = lushSoil),
  every growing plant it passes blooms (normal `bloom` event with `victory: true`). `result()` adds bossReward, sweepCoins, sweepBlooms.

## Skill tree art: soil tiles + vines (2026-11-21, js/treeart.js)

Design source: user sketch (Excalidraw). A node is a rounded-square soil tile that greens as it levels up;
nodes are linked by a leafy vine instead of a straight line. Canvas 2D only, flat vector like flora.js
(solid fills, dark soft outline, no blur/shadowBlur/ctx.filter, no gradients beyond flat bands).

```js
RD.TreeArt.drawTile(ctx, cx, cy, size, {
  level, max,        // integers; green = level / max (0 = bare cracked soil, 1 = fully lush)
  locked,            // true → bare soil + darkened (clearly unavailable), ignores level
  palette,           // optional array of flower colours for max level (≥ 3 distinct hues); default mixed
  seed,              // integer; cracks, grass curls and flower spots are deterministic per seed
  selected,          // optional: thick outline highlight
})
RD.TreeArt.drawVine(ctx, ax, ay, bx, by, {
  progress,          // 0..1 how far the vine has grown from A to B (animation drives this)
  locked,            // true → dry thin brown twig/stub, no leaves (path not yet open)
  seed,
})
RD.TreeArt.tileImage(opts, px) -> cached data URL of drawTile at px×px (for DOM nodes)
RD.TreeArt.VINE_GROW_TIME = 0.8   // seconds, ease-out; never above 1 s
```

Visual rules:
- level 0 / locked: tan soil (#cdb3a6-ish) with dark brown wavy cracks, dark outline.
- locked: same soil, multiplied darker (about 45% dimmer) so it reads as unavailable at a glance.
- 0 < green < 1: wavy grass rim grows from the edges inward; bare soil patch in the middle shrinks
  (patch inset ∝ green). Level 1 of N already shows a visible green rim.
- green = 1 (max): whole tile lush green with darker grass curls; 3–5 small flat flowers on the
  corners/edges in at least 3 different colours (never one colour, never one flower shape repeated alone).
- The skill icon is NOT drawn by TreeArt; it is overlaid on top (DOM icon) and must stay readable:
  keep the tile centre calm (no busy curls in the middle ~40%).
- Vine: green stem with a gentle sine wobble + small alternating leaves; grows from A to B with progress.

## Skill tree screen: dry ground that greens with progress (2026-11-21 b)

User direction: the whole tree background is dry cracked land; buying/levelling nodes greens the land
around them. Nodes are TreeArt tiles, links are TreeArt vines. Desktop web only (1280–1920 wide).

### New TreeArt API (js/treeart.js)
```js
RD.TreeArt.drawSoil(ctx, x, y, w, h, { seed })
  // Static dry field over the rect: flat tan/brown base with a few tone patches, scattered random
  // cracks (same crack style as tiles, larger/longer, sparse), tiny pebbles. Deterministic per seed.
  // Callers cache it (offscreen canvas) — it is drawn once per tree build / resize, never per frame.
RD.TreeArt.drawGreenery(ctx, patches, { seed })
  // patches: [{ x, y, r, green }]  (world px; green 0..1 = node level/max)
  // Each patch is an organic wavy green blob of radius r (bumpy edge, grass tufts poking out, tonal
  // blobs, clovers — same vocabulary as tile grass). Overlapping patches must merge into one lawn
  // (draw all fills first, then all edges/details, so no outlines inside overlaps).
  // green === 1 → also 3–6 small multi-colour flowers scattered in the patch (never one colour).
  // Must be cheap enough to redraw every frame for ~35 patches during a 0.8 s animation.
```

### Tree screen layering (js/ui.js, style.css)
- `.tree-world` holds: `<canvas class="tree-ground">` (bottom) + node buttons (top). The SVG `.tree-lines` is removed.
- Ground canvas covers the node bounds + 480 px margin each side (world coords), positioned with
  left/top in world px; backing size = css size × min(devicePixelRatio, 2), capped so neither side
  exceeds 4096 px. It pans/zooms with `.tree-world`.
- Per draw: blit the cached soil, then `drawGreenery(patches)`, then all vines
  (`drawVine(parent centre → child centre)`; `locked` when the child level is 0, else progress 1).
- Patch per node: root `{ r: 115, green: 1 }`; owned node `r = 46 + 64 × level/max`, `green = level/max`;
  level 0 / locked → no patch. The viewport background outside the canvas uses the soil base colour.
- Node button = rounded square (radius ≈ 22 % of size), size 76 px (root 96 px), background-image =
  `RD.TreeArt.tileImage({ level, max, locked, seed: node index }, size × 2)` shown at 100/88 % so the
  tile body fills the button (flowers may overhang). States: locked → `locked: true` + lock icon;
  available level 0 → bare soil; owned → level/max; maxed → level = max; root → level = max.
  Icon stays centred and readable (light icon with a dark soft backing disc or dark outline).
  Pips + cost badge + label keep their current behaviour.
- Buy animation: when a node's level increases, over `RD.TreeArt.VINE_GROW_TIME` (ease-out) its patch
  radius tweens old → new, and on 0 → 1 the vine from its parent grows progress 0 → 1. Redraw the
  ground canvas per animation frame only while a tween runs. `prefers-reduced-motion` → jump to end.

## Skill tree: crisp rendering at any zoom (2026-11-21 c)

Problem: tiles (tileImage at 2× CSS size), the ground (one world-sized bitmap, capped at 4096 px) and
flower icons (Flora.icon 64 px) were rasterised once and then scaled by the CSS zoom transform → blurry.
Rule: every bitmap is rendered at the pixel size it is shown at (CSS size × zoom × devicePixelRatio).

- Ground: a screen-space `<canvas class="tree-ground">` that fills `.tree-vp` (NOT inside `.tree-world`),
  backing size = vp size × DPR (no 2× cap). Each redraw: `ctx.setTransform(DPR·z, 0, 0, DPR·z, DPR·x, DPR·y)`
  with the tree view `{x, y, z}`, then drawSoil (world rect = visible world area, or the full ground bounds),
  drawGreenery, the night tint, vines — all vector, so it is sharp at every zoom.
  - Soil caching: soil is static, so it may be cached in an offscreen canvas rendered at the CURRENT
    z × DPR for the full ground bounds (cap ~16 M pixels; above that draw it live). Re-render that cache
    only when z changes (debounced ~120 ms after the last zoom step; until then blit the old cache scaled).
    Panning never re-renders the cache, it only blits it with the new offset.
  - Redraw the ground canvas on pan, zoom, resize, renderShop and while a buy tween runs — coalesced into
    one requestAnimationFrame. The soil must keep the same random layout at every zoom (fixed seed, world coords).
  - Soil-colour bounds: outside the ground bounds fill with SOIL_BG so panning never shows an edge.
- Tiles and flower icons: render at `round(cssSize × z × DPR)` px (bucket the size to steps of ~16 px to
  limit cache entries). Re-render node images when z settles (same debounce), not every zoom step.
- Must stay smooth: pan/zoom ≥ 50 fps on the tree at 1920×1080 with ~35 nodes; measure.

## Skill tree: whole-tree art canvas (2026-11-21 d) — supersedes "crisp rendering at any zoom"
User direction: draw everything once, directly in vector (like the game), never as images.
- `.tree-world` (translate only, rounded to device px) holds `canvas.tree-art` + `div.tree-nodes`.
- `tree-art` covers the whole land (node bounds + GROUND_MARGIN) at zoom × DPR (area capped at 40 M px).
  `redrawArt()` paints, in vector: soil, lawn patches, night tint, vines, tile rim + bottom edge, `drawTile`,
  icon disc, flower icons via `RD.Flora.drawIcon(ctx, type, cx, cy, px)`. No tileImage / Flora.icon in the tree.
- Pan: no redraw. Zoom: `.tree-nodes` gets CSS `zoom` (DOM text/SVG re-laid out → sharp), the canvas is
  stretched until the zoom settles (140 ms) and is then redrawn once at the new scale.
- Buy tween: `paintArt(rect)` repaints only the dirty rect around the bought node per frame.
- DOM node buttons are transparent hit targets carrying the SVG icon, pips, cost badge, label, selection
  outline and can-buy pulse.

## HUD redesign (2026-11-21 e) — desktop web (1280–1920), same language as the tree
Goal: the run HUD matches the tree: chunky "tile" panels and themed bars drawn directly in vector.
Game logic, run fields and updateHud's data flow stay the same; only markup/style/drawing change.

### Panel style (all HUD panels)
- background `#1d1839` at .94 alpha, radius 18px, rim + raised edge like tree tiles:
  `box-shadow: 0 0 0 3px rgba(13,10,31,.6), 0 7px 0 3px rgba(13,10,31,.5)`. Cream text (#f7eddb), numbers in
  `var(--mono)` 700. No blur, no gradients, no glow. Nothing in the HUD takes pointer events.

### Layout (absolute, top of the screen, 20px from edges)
- Top-left **water panel**, width 340px, height 64px: big drop icon (32px, water blue) + water bar canvas
  (flex, 22px tall) + number "64/100" (22px). Low water (< 1/4 tank) → bar turns coral, number coral.
- Top-centre **level panel**, width min(560px, 42vw): title row "Bölüm 1 · Çatlak Vadi" (14px, 600, cream2)
  and right-aligned "64/110" (16px mono); below a grow-bar canvas 30px tall that ends in the boss flower bud.
  When the boss spawns the same panel becomes the boss panel: boss name in gold (18px, 800) + its bars
  (arms: 3 segments; shield: "Dikenler" + "Gövde"; shade: "Su" + "Sıcaklık"), bars 14px tall, CSS-styled flat
  fills with the same rounded dark track; scorched blink / shield-open green as today.
- Top-right: **timer dial** 72px circle panel (SVG ring 6px stroke, number 24px inside; ≤5 s coral) and to its
  left a **coin panel** height 64px (gold coin 30px + number 26px gold). Evap mode shows its meter panel in
  the timer's place (same style).
- **Combo badge** under the timer dial, right-aligned: gold tile (`--gold`, rim `--gold-ed`), "×1.75" 24px
  `--on-gold`, a thin ring/bar of the combo window; pop animation kept; hidden when combo ≤ 1.
- **Boss toast**: centred at 28vh, max-width 440px, same panel style with a 3px gold inner rim; flower
  icon 96px, title 26px, hint 16px. Animation unchanged; reduced motion respected.
- Debug gear stays top-right corner; keep HUD clear of it (right offset ≥ 64px).

### js/hudart.js → RD.HudArt (vector, cheap: < 0.5 ms per call at these sizes, called every frame)
```js
RD.HudArt.drawGrowBar(ctx, w, h, frac, { seed, t, bossType })
  // Rounded track. Unfilled: tan soil (TreeArt soil tones) with a few small seeded cracks.
  // Filled 0..frac from the left: lawn green with a wavy bumpy front edge, small grass tufts, and a few
  // tiny multi-colour flowers that appear as the fill passes their positions. Dark rim like tiles.
  // bossType: draws that flower (RD.Flora.draw) at the right end, growth/bloom rising with frac
  // (bud at 0, open at 1), drawn slightly larger than h so it pokes out of the bar. Reserve ~h*1.3 px for it.
RD.HudArt.drawWaterBar(ctx, w, h, frac, { t, low })
  // Rounded dark track; water fill with an animated gentle wave on its right edge (t = seconds),
  // two or three small light bubbles drifting; low → coral instead of water blue. Dark rim.
```
Both take CSS-pixel w/h; the caller sets `ctx.setTransform(dpr,0,0,dpr,0,0)` and the backing store = css × DPR
(redo on resize/DPR change). Shape randomness precomputed per seed (no per-frame allocation).

## Minimal UI style (2026-11-21 f) — applies to every screen
User-approved direction after the HUD: no boxes, no panel backgrounds, no rounded frames (they read as a mobile game).
- Text/icons sit on the scene with the HUD outline: `text-shadow: 0 2px 0 var(--ink), 1px 0 0 var(--ink), -1px 0 0 var(--ink),
  0 -1px 0 var(--ink), 0 0 4px rgba(var(--deep-rgb), .6)` where `--ink: rgba(var(--deep-rgb), .9)`; icons `filter: drop-shadow(0 2px 0 …)`.
- Overlays (results, tree screen) use a flat dim of the scene: `rgba(var(--bg-rgb), .72)` full-screen, no card behind content.
  Content is centred in a column (max-width ~560px) with clear type hierarchy: title 40px/800, sub 18px, rows 18px with
  right-aligned mono numbers separated by thin 1px lines `rgba(247,237,219,.14)`, total 34px gold mono.
- Buttons: flat fill, radius 6px, height 52px, 18px/700 text, no bottom-edge bevel, hover = slightly lighter fill,
  active = 1px down; primary water blue (`--on-water` text), gold for buy, secondary = transparent with 2px cream outline.
  Focus-visible ring kept. Min target 44px.
- Tree screen chrome: header and level strip without backgrounds (outlined text over the dim/land), detail panel = no card:
  a right-side column over a vertical dim strip `rgba(var(--bg-rgb), .78)` with straight edges; zoom buttons as small flat square
  buttons; footer CTA flat without bar background.
- Keep all behaviour and ids; only markup classes/CSS change where needed.

## Boss-gated tree nodes (2026-11-21 g, PRD §13)
Mechanics are tree nodes whose purchase is locked until a level's boss has been beaten (never auto-granted).
- Upgrade field `gate: <levelId>` (optional). Gate is open when `Meta.gateOpen(u)` → `!u.gate || Meta.data.level > u.gate`
  (same rule as `unlockedFlowers`: level N's boss beaten ⇔ data.level > N).
- Visibility: a gated node follows the normal rules (`isVisible`: parent level ≥ 1, flower rule). Being gated does NOT hide it.
- `nodeState` adds `'gated'`: visible, level 0, gate closed (checked before 'locked'/'available'). `isUnlocked`/`canBuy` false while gated.
  Children of a gated node stay hidden (parent level 0), so the gate also hides the mechanic's own sub-branch.
- Tree view: gated tile = locked (dark) tile, but the icon is the gating boss's flower (`C.levels[gate-1].boss.type`, drawn on
  the art canvas like flower icons) with a small lock badge; label shows the node name (not "?"). Detail panel: name, desc, and
  footer "Gereken: <boss.label> yenilmeli" with a disabled "Al". When the gate opens the node renders as a normal 'available' node.
- Debug panel "Bölümü seç" already changes data.level, which opens/closes gates — use it to test.
- No real mechanic nodes are added yet (the user will define them). Test with a temporary node injected in memory only.

## Run structure v2 (2026-11-22 h, PRD §14)
Supersedes the combo window and respawn rules above (lines on comboTimer / respawnDelay).

**Config** (`js/config.js`): `base.plantCount` 24, `base.timeChance` 0 (%), `base.leftoverGold` 0, `comboWindow` and
`respawnDelay` removed, `modes.timer.baseTime` 30, `greenShare` 0.3, `timeChanceSec` 1, `leftover {waterPerArea, gold}`,
`bloomPoints` removed, every level has `bloomNeed`. Tree: node `combo` replaced by `puddle` (stat leftoverGold),
new `sundial` (stat timeChance, child of time1).

**Flowers (run.js)**: all `stats.plantCount` plants are placed in the constructor; a bloomed plant is NOT replaced
(no `_respawn`). Keep a public `spawnSeedling()` (= `_spawnPlant()` + push a `{type:'seedling', x, y}` event) for
future chance cards. Rebloom (sunflower) unchanged.

**Level bar**: `_initGreen` sets `this.greenPts = C.greenShare * barTarget / (gw * gh)`; a newly greened cell adds
`greenPts` (fractional). A bloom adds `(1 − C.greenShare) * barTarget / level.bloomNeed`. barPoints may be fractional;
UI shows it rounded. On resize keep greenPts unchanged (computed once).

**Combo** (no timer): at the start of the watering step count `n` = growing plants inside the rain circle while raining.
Every bloom in that frame uses `this.combo = min(s.comboMax, 1 + s.comboStep * (n − 1))` (n ≥ 1). When not raining or
n ≤ 1, `this.combo = 1`. `this.comboN = n` (plants counted) is public for the HUD. `bestCombo` unchanged.
`comboTimer` is removed. Lavender comboX still applies when combo > 1.

**Time chance**: on each bloom, if `timeLimit > 0` and `Math.random() * 100 < s.timeChance`, `timeLimit += C.timeChanceSec`
and push event `{type:'time', x, y, sec}`.

**End conditions**, in order: water ≤ 0 → 'water'; time → 'time'; no plant in state 'growing' and no boss active
(`!this.boss`) → 'flowers'. Boss fights keep running even when no flowers are left.

**Leftover water** (in `_finish`, except reason 'water'): `areas = floor(water / C.leftover.waterPerArea)`,
`leftoverGold = areas * (C.leftover.gold + s.leftoverGold)`; add to `this.coins`; `result()` gains
`leftoverAreas`, `leftoverGold` (0 when none). Water itself is not changed.

**UI**: HUD combo shows `×combo` with the count of plants under rain (no timer bar); the combo bar element is hidden or
repurposed. Result screen: when `leftoverGold > 0` a row "Kalan su: N alan yeşerdi  +G". `END_TEXT.flowers` =
"Çiçek kalmadı". Stat labels: `timeChance` → 'Ek süre ihtimali' shown with '%' (chance rule), `leftoverGold` →
'Kalan su altını'. Remove comboWindow labels. Popup for event 'time': "+1 sn".

**Clusters (2026-11-22 i):** `base.clusterSize` 1 (tree node `cluster` "Tohum Kümesi", +1 per level, max 3 → 4).
`Run._spawnInitial(n)` places groups of clusterSize: a center from `_findSpot()`, then members ~CLUSTER_GAP (26 px)
around it via `_clusterSpot()`. Base = spread out, so early combos are rare by design.

## Flower chances + bar points (2026-11-22 j, PRD §15)
Supersedes countStat / filler weight and level.bloomNeed.
- **Config:** `base.plantCount` 10; per-flower `<flower>Chance` stats (%, from tree nodes); each plant has `bar`
  (progress points: cactus 1, daisy 2, tulip 3, lavender 4, bluebell 5, rose 6, sunflower 7, skylily 10),
  `chanceStat`, `baseChance` (% granted once the flower is unlocked; tulip/rose/sunflower 10, others 0).
  `weight` and `countStat` are gone. `CONFIG.bossNeed {base 15, mul 2}`; levels have no `bloomNeed`.
- **Placement (run.js `_pickType`):** for every placed plant, go through the unlocked flowers (`this.flowers`, null =
  all) that have a chanceStat, sorted by `bar` descending; chance = baseChance + stats[chanceStat]; first roll that hits
  (`Math.random()*100 < chance`) picks that type. No hit → 'cactus'. Cactus is always allowed.
- **Bar:** `bloomNeed = C.bossNeed.base * Math.pow(C.bossNeed.mul, level.id − 1)` (computed in the constructor,
  `this.bloomNeed`, public). A bloom adds `(1 − C.greenShare) * barTarget * cfg.bar / bloomNeed` (cfg.bar default 1).
- **Meta:** `flowerOfStat` must match `chanceStat` (instead of countStat) so a flower's chance node is buyable only
  after the flower is unlocked.
- **UI:** stats ending in `Chance` render as "%N" (same as timeChance). Labels: daisyChance 'Papatya ihtimali',
  tulipChance 'Lale ihtimali', lavenderChance 'Lavanta ihtimali', bluebellChance 'Çan çiçeği ihtimali', roseChance
  'Gül ihtimali', sunflowerChance 'Ayçiçeği ihtimali', skylilyChance 'Gök zambağı ihtimali'. The tree node visual that
  matched `/^(\w+)Count$/` (draws the flower) must match `/^(\w+)Chance$/` (skip timeChance: not a flower).

## Clean tree screen + fixes (2026-11-22 k)
- HUD level bar: boss bud at the bar end removed (players mistook it for a plant).
- Results `.panel`: `overflow-x: hidden`, scrollbar hidden (entry animations flashed a scrollbar).
- Tree: the land (`landBounds`) covers EVERY node in CONFIG (hidden ones too) + GROUND_MARGIN 700, drawn once;
  `clampView()` keeps the viewport inside the land (min zoom = what still covers the viewport), so no empty area shows.
- Tree chrome floats on the land (title/coins/levels top, − + Ortala bottom-left, start button bottom); no bars.
- Node info = small window next to the selected node (`placeDetail()`, follows pan/zoom, flips left near the edge).
- Dirty-rect repaint clips on whole device pixels (no seam); the pulsing `.can-buy` outline is removed (gold cost
  badge marks buyable nodes).

## Combo groups + chance clusters (2026-11-22 l) — supersedes the per-frame combo and clusterSize
- **Combo:** each growing plant keeps `p.group` = the most growing plants that were under the rain together with it
  while it kept being watered; leaving the rain for more than COMBO_GRACE (0.3 s) resets it. A bloom pays
  `combo = min(comboMax, 1 + comboStep·(group − 1))`, so a slow flower watered with a fast one keeps the combo after
  the fast one blooms. HUD: `run.comboN` = largest group among plants under the rain now.
- **Clusters:** `base.clusterChance` 0 (%); node `cluster` "+%5" ×3. Every placed plant rolls it; a hit adds 2-3 plants
  right next to it. At 15 % about a third of the plants sit in groups; the rest stay single.

## Greening difficulty + seedlings (2026-11-22 m, PRD §16)
- `CONFIG.greenHard` 1.7: Run sets `this.greenNeed` / `this.lushSoil` = CONFIG value × greenHard^(level.id − 1);
  `_waterGround`, the victory sweep and render.js grass use the run values; the bloom patch soil scales the same way.
  `groundMul` 1.2.
- Upgrade defs may carry `also: { stat, per }` (second flat stat per level, computeStats). (Currently unused.) Tohum: plantCount +5 per level;
  separate node `sprout` "Filizlenme" (child of seeds): respawnChance +1.5 per level (max 5); `cluster` moved under it. A bloom (not a rebloom) rolls respawnChance → `spawnSeedling()`, pushed before
  the bloom event. The info window shows the `also` stat as a second effect line.
- (n) `groundMul` 0.5 (rain → soil). Bloom patches unchanged.

## Crit (big drop) + golden flowers (2026-11-23 o)
**Config (js/config.js)**
- `base`: `critChance: 5` (%), `critSec: 0` (extra s), `dropRate: 0` (levels), `goldChance: 1` (%), `goldMul: 5` (×).
- `CONFIG.bigDrop = { interval: 0.6, minInterval: 0.3, step: 0.1, fall: 0.3, critSec: 2 }`.
  Drop interval = max(minInterval, interval − step·dropRate). Crit amount = `stats.rainRate × (bigDrop.critSec + stats.critSec)`.
- Tree nodes (rain branch): `crit` "Kritik" critChance +5 ×4 (parent flow, pos [3,1]); `critpow` "Ağır Damla" critSec +1 ×3
  (parent crit, [4,1]); `droprate` "Damla Sıklığı" dropRate +1 ×3 (parent crit, [3,2]).
  Bounty branch: `goldseed` "Altın Tohum" goldChance +1 ×4 (parent puddle, [-2,-2]); `goldval` "Altın Değer" goldMul +2 ×3
  (parent goldseed, [-3,-2]). Old node `gold` label → "Gül Bahçıvanı" (id unchanged).

**Run (js/run.js)**
- `this.drops = []`, `this.dropT = 0`. While raining, `dropT += dt`; at the interval spawn one drop:
  `{ sx, sy, x, y, t: 0, fall, target, crit: false }` — `sx,sy` = cloud pos at spawn; target = random growing plant or
  not-done boss part under the rain (same reach test as normal watering); `x,y` = target pos, or a random point in the
  rain circle when there is no target (`target: null`). Not raining: dropT resets to 0, no new drops; falling ones finish.
- Landing (`t >= fall`): removed from `drops`; if target still valid (plant `growing` / part not `done`), roll critChance.
  Crit on a plant: `p.water += amount`; if ≥ need → `this.combo = comboOf(p.group || 1)`, `_bloom(p)`.
  Crit on a boss part: add `amount` only where normal rain would count (arms: always; shield: only if `boss.shield >= 1`;
  shade: only if not `scorched`); the boss completion check runs as usual.
  Always push `{ type: 'drop', x, y, hit: bool, crit: bool }` (hit = landed on a valid target).
- Golden: `_spawnPlant` sets `golden = Math.random()*100 < stats.goldChance`. `_bloom`: coin `extraMul *= goldMul` when golden;
  bloom event gets `golden: true|false`. Bar points unchanged. Result `golden` count = `this.goldens` (blooms of golden plants).

**Render (js/render.js, js/flora.js)**
- Draw every `run.drops` entry each frame: a large drop falling from (sx,sy) to (x,y) by `t/fall`.
- `'drop'` event: small splash; `crit` → big splash + outlined "Kritik!" popup (no box).
- `RD.Flora.draw(..., opts.golden = true)` draws the whole plant (stem, leaves, petals, body) in a gold palette
  (luminance-mapped ramp), plus a soft sparkle; render passes `golden: p.golden`. Golden bloom popup coin text in gold.
- (p, 2026-11-23) Flower traits removed for now (comboX, refund, rebloom, wilt deleted from `plants`; code keeps the
  guarded paths). Non-crit big drop lands like a normal raindrop (splash only, no bouncing particles/ring); crit keeps its burst.

## Tree spread (2026-11-23 q)
- Node `pos` = old grid × 1.25 + branch direction × 1.4 (water up, storm up-right, rain right, time down, wind down-left,
  bounty left): each branch is its own island reaching out from `core`. New nodes keep ≥ 1.25 between nodes.

## Water splash + linked flowers (2026-11-23 r)
**Config**
- `base`: `splashChance: 0` (%), `splashSec: 0` (extra s), `splashCount: 0` (extra targets), `linkChance: 0` (%).
- `CONFIG.splash = { sec: 1, count: 1, fly: 0.4 }`; `CONFIG.link = { minDist: 160 }`.
- Nodes (water branch): `splash` "Su Sekmesi" splashChance +10 ×5 (parent dew, pos [0, -6.4], baseCost 200, growth 2.2);
  `splashpow` "Sekme Gücü" splashSec +1 ×3 (parent splash, [-1.25, -6.4], 500, 2.4);
  `splashmulti` "Çoklu Sekme" splashCount +1 ×2 (parent splash, [0, -7.65], 1500, 3).
  Wind branch: `link` "Kök Bağı" linkChance +5 ×4 (parent windseed, [-2.44, 4.94], 300, 2.3).
**Run**
- Splash: in `_bloom` (any bloom, also reblooms; not when `this.over`), roll splashChance; on hit pick the
  `splash.count + splashCount` nearest OTHER `growing` plants and push one flyer each to `this.splashes`:
  `{ sx, sy, x, y, t: 0, fly: splash.fly, target: plant }`, amount = `rainRate × (splash.sec + splashSec)`.
  Push the flyers BEFORE the bloom event (bloom event stays last). `_updateSplashes(dt)` runs every update (also not
  raining): on landing remove it; if target still `growing`: `water += amount`, if ≥ need → `this.combo = 1` then
  `_bloom(target)` (can chain). Push `{ type: 'splash', x, y, hit }` on landing.
- Links: after `_spawnInitial`, each plant without a link rolls linkChance; on hit pair it with a random unlinked
  plant ≥ `link.minDist` away (none → no link). Set `p.link = q.id`, `q.link = p.id` (ids). Seedlings spawned later are never linked.
- Watering: after the normal rain loop, for each plant that was watered under the rain this frame (`p.wet` true),
  its partner (if `growing` and not itself wet this frame) gets the same `amount`, is flagged `p.linkWet = true`
  (reset every frame), and blooms at need with `this.combo = 1` (links never count for the combo; partner `group` untouched).
**Render**
- `run.splashes`: a water blob flying on an arc from (sx,sy) to (x,y) by t/fly; `'splash'` event: normal small splash.
- Links: a thin green vine between linked plants while BOTH are `growing` (look up by id in `run.plants`); when either
  has `linkWet`, a soft water-blue pulse flows along the vine toward the partner. Under plants, above the ground.

## Mini clouds + moist soil + sudden shower (2026-11-23 s)
None of these count for the combo (blooms they cause use `this.combo = 1`, plant `group` untouched) and none roll crits.
Blooms they cause go through `_bloom` (so splash works). Links pass water only from player rain and mini clouds
(set `p.miniWet = true` for plants a mini cloud waters this frame, reset every frame; link code uses `p.wet || p.miniWet`).
**Config**
- `base`: `miniClouds: 0`, `miniRate: 0`, `miniSpeed: 0`, `moistOn: 0`, `moistRate: 0`, `showerOn: 0`, `showerSize: 0`, `showerFreq: 0`.
- `CONFIG.mini = { r: 26, rateMul: 0.5, speed: 45, speedStep: 20 }` — rain radius px; water/s = rainRate × rateMul + miniRate;
  px/s = speed + speedStep × miniSpeed.
- `CONFIG.moist = { rate: 0.5, step: 0.5 }` — water/s = rate + step × moistRate.
- `CONFIG.shower = { interval: 20, step: 2, minInterval: 12, warn: 1.2, dur: 3.5, r: 70, rStep: 14, rate: 3 }`.
- Nodes:
  storm: `minicloud` "Bulutçuk" miniClouds +1 ×2 (parent eye, [3.69, -4.94], 2000, 3) desc '+1 mini bulut';
  `minipow` "Bulutçuk Şiddeti" miniRate +1 ×3 (parent minicloud, [4.94, -4.94], 3000, 2.2) desc '+1 şiddet';
  `minispeed` "Bulutçuk Hızı" miniSpeed +1 ×2 (parent minicloud, [3.69, -6.19], 2500, 2.5) desc '+1 hız'.
  time: `shower` "Ani Yağmur" showerOn +1 ×1 (parent sundial, [1.25, 3.9], 400, 1) desc 'Ara sıra rastgele bir yere yağmur yağar';
  `showerwide` "Geniş Yağmur" showerSize +1 ×3 (parent shower, [2.5, 3.9], 600, 2.2) desc '+1 alan';
  `showerfreq` "Sık Yağmur" showerFreq +1 ×3 (parent shower, [1.25, 5.15], 800, 2.4) desc '−2 sn aralık'.
  bounty: `moist` "Nemli Toprak" moistOn +1 ×1 (parent daisy, [-2.65, -2.5], 300, 1) desc 'Yeşil zemindeki çiçekler kendiliğinden sulanır';
  `roots` "Derin Kökler" moistRate +1 ×3 (parent moist, [-3.9, -3.75], 500, 2.2) desc '+0.5 su/sn'.
**Run**
- `this.minis = []` built in the constructor: `miniClouds` entries `{ x, y, target: null }`, spread around the field.
  Each frame (not over): pick/keep a target = nearest growing plant not targeted by another mini; move toward it at
  the speed; water every growing plant within `mini.r` (`p.miniWet = true`, bloom at need with combo 1); also
  `_waterGround(x, y, r, rate × groundMul × dt)`. No target → drift slowly. Minis work while the player is not raining too.
- Moist soil (`moistOn > 0`): every growing plant whose cell is `greened` and that is not `wet`/`miniWet` this frame
  gets moist water/s; flag `p.moist = true` (reset every frame) for the render.
- Shower (`showerOn > 0`): `this.shower = null | { x, y, r, t, phase: 'warn' | 'rain' }`. Timer `showerT` counts up;
  at `max(minInterval, interval − step × showerFreq)` spawn centred on a random growing plant (none → random spot),
  `r = shower.r + rStep × showerSize`, phase 'warn' for `warn` s, then 'rain' for `dur` s: waters plants inside at
  `shower.rate` water/s (`p.showerWet = true`, reset every frame) and greens the ground like rain; then null and the
  timer restarts. Events: `{ type: 'shower', x, y, r }` when the rain phase starts.
**Render**
- Minis: small cloud (reuse drawCloudArt at ~0.5 scale, drawn above plants like the main cloud) with its own light rain.
- Shower warn: a darkening, soft shadow circle on the ground that grows in; rain phase: a cloud drifts over it with
  rain falling across the circle; fade out at the end.
- Moist plants: faint rising vapor wisps (very subtle).

## Growing-garden stages (2026-11-23 t, PRD §19)
**Config:** `CONFIG.stages = { count: 3, needMul: [1, 1.5, 2.2], chanceBonus: 10, timeAdd: 12, shrink: 0.5, pause: 1.8 }`.
**Run (done):**
- `run.stage` (1-based), `run.stageCount` (3 with a level, else 1). `run.bloomNeed = bloomNeedBase × needMul[stage−1]`.
- A full bar in stage < stageCount sets `_stageUpPending`; at the END of that update `_stageUp()` runs:
  old plants removed (`run.plants` is a NEW array of fresh plants, new ids), drops/splashes/shower cleared, mini targets
  reset; the soil grid (`soil`, `greened`) is resampled so the old field shrinks ×`shrink` around the field centre
  (core stays green, does not count for the new bar); bar = 0; time += timeAdd; fresh `plantCount` plants placed with
  flower chances +chanceBonus % per stage after the first; links re-rolled.
  Pushes `{ type: 'stage', stage, of, shrink, time }` — the canvas still shows the LAST frame of the old field at this moment.
- `run.zoom = { t, dur, stage }` for `pause` s after that: `update()` returns at once (timer, water, everything frozen).
  `run.zoom` becomes null when the pause ends. Render keeps drawing every frame with real dt.
- Full bar in the last stage → boss in the middle (unchanged). Field size never changes; cloud keeps its size.
- `result()` adds `stage`, `stageCount`.
**Render / UI (to do):** the zoom-out must FEEL like the garden grows and the camera pulls back (see PRD §19).
