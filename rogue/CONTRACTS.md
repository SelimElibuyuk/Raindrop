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
