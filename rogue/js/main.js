// Game loop and screen state machine. Wires Meta, Run, Render, Input and UI together.
(function (RD) {
  'use strict';
  const C = RD.CONFIG;

  // Build the run rules from the selected mode, drain preset and debug overrides (PRD §4).
  RD.buildRules = function (stats, settings) {
    const mode = C.modes[settings.mode] ? settings.mode : 'timer';
    const r = Object.assign({}, C.modes[mode]);
    const preset = settings.preset && C.drainPresets[settings.preset];
    if (preset) { r.passiveDrain = preset.passiveDrain; r.rainCost = preset.rainCost; }
    const ov = settings.overrides || {};
    for (const k of ['baseTime', 'passiveDrain', 'rainCost', 'evapRamp', 'rampDelay']) {
      if (typeof ov[k] === 'number' && isFinite(ov[k])) r[k] = ov[k];
    }
    r.mode = mode;
    // Tree upgrades that reduce water loss (Sızdırmazlık, Verimli Yağmur): flat su/sn
    r.passiveDrain = Math.max(0, r.passiveDrain - stats.drainReduce);
    r.rainCost = Math.max(r.rainCost > 0 ? 1 : 0, r.rainCost - stats.rainCostReduce);
    if (mode === 'timer') {
      r.timeLimit = r.baseTime + stats.timeBonus;
    } else {
      r.timeLimit = 0;
      r.rampDelay += stats.timeBonus * 0.5; // option A in design/tree-v2.md
    }
    return r;
  };

  // Stats with debug overrides that target stats (currently only tank).
  function runStats(settings) {
    const s = RD.computeStats(RD.Meta.data.levels);
    const ov = settings.overrides || {};
    if (typeof ov.tank === 'number' && ov.tank > 0) s.tank = ov.tank;
    s.cloudSpeedLevel = s.cloudSpeed;
    s.cloudSpeed = s.cloudSpeed * C.speedPx; // Run works in px/s
    return s;
  }

  const game = { screen: 'shop', run: null, last: 0 };
  RD.game = game;

  function startRun() {
    const settings = RD.Meta.settings;
    const stats = runStats(settings);
    const rules = RD.buildRules(stats, settings);
    const f = RD.Render.fieldSize();
    game.run = new RD.Run(stats, rules, f);
    game.screen = 'run';
    RD.UI.showScreen('run');
  }

  function endRun() {
    const result = game.run.result();
    RD.Meta.addCoins(result.coins);
    RD.Meta.recordRun(result);
    RD.Meta.save();
    game.screen = 'results';
    RD.UI.showResults(result);
  }

  function openShop() {
    game.screen = 'shop';
    RD.UI.showScreen('shop');
    RD.UI.renderShop();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - (game.last || now)) / 1000);
    game.last = now;
    if (game.screen === 'run' && game.run) {
      const inp = RD.Input.state;
      game.run.update(dt, { x: inp.x, y: inp.y, raining: inp.down });
      RD.UI.updateHud(game.run);
      if (game.run.over) endRun();
    }
    RD.Render.draw(game.screen === 'run' ? game.run : null, dt);
    requestAnimationFrame(frame);
  }

  function boot() {
    RD.Meta.load();
    const canvas = document.getElementById('field');
    RD.Render.init(canvas);
    RD.Input.init(canvas);
    RD.UI.init({ onStartRun: startRun, onOpenShop: openShop });
    addEventListener('resize', function () {
      RD.Render.resize();
      if (game.run) { const f = RD.Render.fieldSize(); game.run.resize(f.w, f.h); }
    });
    openShop();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.RD = window.RD || {});
