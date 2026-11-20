// DOM overlays: HUD, results, skill tree and the debug panel. All player-facing text is Turkish.
(function (RD) {
  'use strict';
  const C = RD.CONFIG;

  const END_TEXT = { water: 'Su bitti!', time: 'Süre doldu!' };
  const TOAST_MS = 3200;       // boss arrival banner
  const LEVEL_ICON_PX = 64;
  const EVAP_METER_MAX = 12;   // water/s that fills the evaporation meter completely
  const COUNT_UP_MS = 800;     // results "+N" count-up duration
  const DBG_FIELDS = [         // [override key, label]
    ['baseTime', 'Süre (sn)'],
    ['passiveDrain', 'Pasif kayıp (su/sn)'],
    ['rainCost', 'Yağmur maliyeti'],
    ['evapRamp', 'Buharlaşma artışı (su/sn²)'],
    ['rampDelay', 'Artış gecikmesi (sn)'],
    ['tank', 'Depo (su)'],
  ];
  const PRESET_BTNS = [['time', 'Sadece zaman'], ['use', 'Sadece kullanım'], ['mixed', 'Karışık'], [null, 'Yok']];

  // ---------- Inline icons (24x24, currentColor) ----------
  function svg(cls, body) { return '<svg class="ico ' + cls + '" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>'; }
  const ICON_BODY = {
    drop: '<path d="M12 3C9 8 6 11 6 15a6 6 0 0 0 12 0c0-4-3-7-6-12z"/>',
    rain: '<path d="M7 14a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 7a3.6 3.6 0 0 1 .5 7.1L7 14z"/>' +
      '<path d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    flower: '<circle cx="12" cy="6.6" r="3.6"/><circle cx="17.4" cy="12" r="3.6"/><circle cx="12" cy="17.4" r="3.6"/>' +
      '<circle cx="6.6" cy="12" r="3.6"/><circle cx="12" cy="12" r="2.6" class="ico-core"/>',
    wind: '<path d="M3 9h10.5a3 3 0 1 0-3-3M3 13.5h15a3 3 0 1 1-3 3M3 18h6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    hourglass: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 5 4 6 4 8.5s-4 3.5-4 8.5M16 3.5c0 5-4 6-4 8.5s4 3.5 4 8.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    storm: '<path d="M7 14a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 7a3.6 3.6 0 0 1 .5 7.1L7 14z"/>' +
      '<path d="M12.5 13l-2.5 4h3l-1.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    bolt: '<path d="M13.5 2.5L5.5 13.5h5.2l-1.2 8 8-11h-5.2z"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  };
  function icon(name, cls) { return svg((cls || '') + ' ico-' + name, ICON_BODY[name] || ICON_BODY.storm); }
  function coinIcon(cls) {
    return svg('coin-ico ' + (cls || ''), '<circle cx="12" cy="12" r="10" class="c1"/><circle cx="12" cy="12" r="6" fill="none" class="c2" stroke-width="2"/>');
  }
  // Icon per branch (unknown/future branches fall back to the storm icon) and per stat where it reads better.
  const BRANCH_ICON = { water: 'drop', rain: 'rain', bounty: 'flower', time: 'hourglass', storm: 'storm', wind: 'wind' };
  const STAT_ICON = { cloudSpeed: 'wind', timeBonus: 'hourglass', dew: 'drop', drainReduce: 'drop', tank: 'drop' };
  function nodeIcon(u) { return STAT_ICON[u.stat] || BRANCH_ICON[u.branch] || 'storm'; }

  // Flower unlock nodes (stat ends in "Count") show the bloomed flower drawn by RD.Flora, else the flower icon.
  function flowerType(u) {
    const m = /^(\w+)Count$/.exec(u.stat || '');
    return m && C.plants[m[1]] && m[1] !== 'plant' ? m[1] : null;
  }
  function spriteIcon(type, cls) {
    if (!RD.Flora) return null;
    const src = RD.Flora.icon(type, 64);   // cached data URL
    if (!src) return null;
    return '<img class="' + (cls || '') + ' tn-sprite" src="' + src + '" alt="" draggable="false">';
  }
  function nodeVisual(u, cls) {
    const t = flowerType(u);
    return (t && spriteIcon(t, cls)) || icon(nodeIcon(u), cls);
  }

  let cb = { onStartRun: function () {}, onOpenShop: function () {} };
  const el = {};                          // cached elements
  const hudCache = {};                    // last written HUD values
  let comboWindow = 1;                    // largest comboTimer seen for the current combo (bar scale)
  let lastComboTimer = 0;
  let lastComboVal = 1;
  let countRaf = 0;
  let dbgInputs = {};

  function $(id) { return document.getElementById(id); }
  function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function fmtCombo(c) { return '×' + (Math.round(c * 100) / 100).toString(); }
  function fmtInt(n) { return String(Math.round(n)); }
  function modeLabel(m) { return C.modes[m] ? C.modes[m].label : String(m); }
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Write to the DOM only when the value changed (HUD runs every frame).
  function setText(key, node, value) {
    if (hudCache[key] !== value) { hudCache[key] = value; node.textContent = value; }
  }
  function setWidth(key, node, frac) {
    const pct = Math.round(Math.max(0, Math.min(1, frac)) * 200) / 2; // 0.5% steps
    if (hudCache[key] !== pct) { hudCache[key] = pct; node.style.width = pct + '%'; }
  }
  function setHidden(key, node, hidden) {
    if (hudCache[key] !== hidden) { hudCache[key] = hidden; node.hidden = hidden; }
  }
  function setClass(key, node, cls, on) {
    if (hudCache[key] !== on) { hudCache[key] = on; node.classList.toggle(cls, on); }
  }
  // Ring progress: the circle uses pathLength=100, so the offset is simply the consumed share.
  function setRing(key, node, frac) {
    const off = Math.round((1 - Math.max(0, Math.min(1, frac))) * 100);
    if (hudCache[key] !== off) { hudCache[key] = off; node.style.strokeDashoffset = String(off); }
  }
  function pop(node) {
    node.classList.remove('pop');
    void node.offsetWidth;               // restart the animation
    node.classList.add('pop');
  }

  // ---------- HUD ----------
  function buildHud() {
    el.hud.innerHTML =
      '<div class="hud-row">' +
        '<div class="hud-tank" id="hud-tank">' + icon('drop', 'hud-ico') +
          '<div class="bar"><div class="bar-fill bar-water" id="hud-water-bar"></div></div>' +
          '<span class="hud-num" id="hud-water-num"></span>' +
        '</div>' +
        '<div class="hud-coins">' + coinIcon('hud-coin') + '<span class="hud-num" id="hud-coins"></span></div>' +
      '</div>' +
      '<div class="hud-level" id="hud-level" hidden></div>' +
      '<div class="hud-row hud-row2">' +
        '<div class="hud-pill" id="hud-timer">' +
          '<svg class="hud-ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="rg-bg" cx="12" cy="12" r="9" pathLength="100"/>' +
          '<circle class="rg-fg" id="hud-time-ring" cx="12" cy="12" r="9" pathLength="100" transform="rotate(-90 12 12)"/></svg>' +
          '<span class="hud-num" id="hud-time-num"></span>' +
        '</div>' +
        '<div class="hud-pill hud-evap" id="hud-evap" hidden>' + icon('storm', 'hud-ico') +
          '<div class="bar bar-thin"><div class="bar-fill bar-evap" id="hud-evap-bar"></div></div>' +
          '<span class="hud-num" id="hud-evap-num"></span>' +
        '</div>' +
        '<div class="hud-combo" id="hud-combo" hidden>' +
          '<span class="hud-num" id="hud-combo-num"></span>' +
          '<div class="bar bar-thin"><div class="bar-fill bar-combo" id="hud-combo-bar"></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="hud-toast" id="hud-toast" hidden></div>';
    ['water-num', 'water-bar', 'coins', 'timer', 'time-num', 'time-ring', 'evap', 'evap-num', 'evap-bar',
      'combo', 'combo-num', 'combo-bar', 'level', 'toast'].forEach(function (k) { el['h_' + k.replace(/-/g, '_')] = $('hud-' + k); });
  }

  function resetHudCache() {
    for (const k in hudCache) delete hudCache[k];
    comboWindow = 1;
    lastComboTimer = 0;
    lastComboVal = 1;
  }

  // ---------- Level bar / boss panel (PRD §12) ----------
  // lv.run/lv.mode: which run and which layout ('bar' | 'boss') the panel was built for.
  const lv = { run: null, mode: null, nodes: null, toastTimer: 0 };

  function flowerImg(type, px, cls) {
    const src = RD.Flora && type ? RD.Flora.icon(type, px) : '';
    return src ? '<img class="' + (cls || '') + '" src="' + src + '" alt="" draggable="false">' : '';
  }
  function levelTitle(level) { return 'Bölüm ' + level.id + ' · ' + level.name; }
  function miniBar(id, cls) {
    return '<div class="bar bar-thin lv-mini"><div class="bar-fill ' + (cls || '') + '" id="' + id + '"></div></div>';
  }

  function buildLevelBar(run) {
    const level = run.level;
    el.h_level.className = 'hud-level';
    el.h_level.innerHTML =
      '<div class="lv-name">' + levelTitle(level) + '</div>' +
      '<div class="lv-row"><div class="bar bar-thin lv-bar"><div class="bar-fill bar-level" id="lv-bar"></div></div>' +
        '<span class="lv-num" id="lv-num"></span>' +
        '<span class="lv-goal">' + flowerImg(level.boss.type, LEVEL_ICON_PX, 'lv-ico') + '</span></div>';
    lv.nodes = { bar: $('lv-bar'), num: $('lv-num') };
  }

  function buildBossPanel(run) {
    const boss = run.boss;
    let body = '';
    if (boss.kind === 'arms') {
      body = '<div class="lv-pips">';
      for (let i = 0; i < boss.parts.length; i++) body += '<div class="lv-pip" id="lv-pip' + i + '">' + miniBar('lv-pf' + i, 'bar-boss') + '</div>';
      body += '</div>';
    } else if (boss.kind === 'shield') {
      body = '<div class="lv-line"><span class="lv-tag" id="lv-thorn-tag">Dikenler</span>' + miniBar('lv-thorn', 'bar-thorn') + '</div>' +
        '<div class="lv-line"><span class="lv-tag">Gövde</span>' + miniBar('lv-water', 'bar-boss') + '</div>';
    } else {
      body = '<div class="lv-line"><span class="lv-tag">Su</span>' + miniBar('lv-water', 'bar-boss') + '</div>' +
        '<div class="lv-line"><span class="lv-tag" id="lv-heat-tag">Sıcaklık</span>' + miniBar('lv-heat', 'bar-heat') + '</div>';
    }
    el.h_level.className = 'hud-level is-boss';
    el.h_level.innerHTML =
      '<div class="lv-name lv-boss-name">' + flowerImg(boss.type, LEVEL_ICON_PX, 'lv-ico') + '<span>' + boss.label + '</span></div>' + body;
    lv.nodes = { water: $('lv-water'), thorn: $('lv-thorn'), thornTag: $('lv-thorn-tag'), heat: $('lv-heat'), heatTag: $('lv-heat-tag'), pips: [] };
    for (let i = 0; i < boss.parts.length; i++) { const p = $('lv-pip' + i); if (p) lv.nodes.pips.push({ box: p, fill: $('lv-pf' + i) }); }
  }

  function showToast(boss) {
    el.h_toast.innerHTML = flowerImg(boss.type, 96, 'toast-ico') +
      '<div class="toast-title">' + boss.label + ' geldi!</div><div class="toast-hint">' + boss.hint + '</div>';
    el.h_toast.hidden = false;
    el.h_toast.classList.remove('show');
    void el.h_toast.offsetWidth;          // restart the animation
    el.h_toast.classList.add('show');
    clearTimeout(lv.toastTimer);
    lv.toastTimer = setTimeout(function () { el.h_toast.hidden = true; el.h_toast.classList.remove('show'); }, TOAST_MS);
  }
  function hideToast() {
    clearTimeout(lv.toastTimer);
    if (el.h_toast) { el.h_toast.hidden = true; el.h_toast.classList.remove('show'); }
  }

  function updateLevel(run) {
    if (!run.level) { setHidden('lvH', el.h_level, true); return; }
    setHidden('lvH', el.h_level, false);
    const mode = run.boss ? 'boss' : 'bar';
    if (lv.run !== run || lv.mode !== mode) {
      // Fresh boss: switched from the bar this run, or first seen within its first second
      const spawned = mode === 'boss' && ((lv.run === run && lv.mode === 'bar') || run.boss.t < 1);
      if (lv.run !== run) hideToast();
      lv.run = run; lv.mode = mode;
      for (const k in hudCache) if (k.indexOf('lv_') === 0) delete hudCache[k];
      if (mode === 'boss') buildBossPanel(run); else buildLevelBar(run);
      if (spawned) showToast(run.boss);
    }
    const n = lv.nodes;
    if (mode === 'bar') {
      setWidth('lv_bar', n.bar, run.bar);
      setText('lv_num', n.num, fmtInt(Math.min(run.barPoints, run.barTarget)) + '/' + fmtInt(run.barTarget));
      return;
    }
    const boss = run.boss;
    if (boss.kind === 'arms') {
      for (let i = 0; i < n.pips.length; i++) {
        const q = boss.parts[i];
        setWidth('lv_pf' + i, n.pips[i].fill, q.done ? 1 : q.water / q.need);
        setClass('lv_pd' + i, n.pips[i].box, 'done', q.done);
        setClass('lv_pw' + i, n.pips[i].box, 'wet', !!q.wet);
      }
      return;
    }
    const q = boss.parts[0];
    setWidth('lv_w', n.water, q.done ? 1 : q.water / q.need);
    if (boss.kind === 'shield') {
      const open = boss.shield >= 1;
      setWidth('lv_th', n.thorn, Math.min(1, boss.shield));
      setText('lv_tt', n.thornTag, open ? 'Açıldı' : 'Dikenler');
      setClass('lv_to', el.h_level, 'shield-open', open);
    } else {
      const shadeMax = (run.level.boss.shadeMax || 1);
      setWidth('lv_ht', n.heat, boss.scorched ? 1 : boss.shade / shadeMax);
      setText('lv_htt', n.heatTag, boss.scorched ? 'Yandı!' : 'Sıcaklık');
      setClass('lv_hs', el.h_level, 'scorched', !!boss.scorched);
    }
  }

  function updateHud(run) {
    if (!run || !el.h_coins) return;
    updateLevel(run);
    setText('wn', el.h_water_num, fmtInt(run.water) + '/' + fmtInt(run.tank));
    setWidth('wb', el.h_water_bar, run.tank > 0 ? run.water / run.tank : 0);
    setClass('wlow', el.h_water_bar, 'low', run.tank > 0 && run.water / run.tank < 0.25);
    setText('coins', el.h_coins, fmtInt(run.coins));

    const timed = run.timeLimit > 0;
    setHidden('timerH', el.h_timer, !timed);
    setHidden('evapH', el.h_evap, timed);
    if (timed) {
      const left = Math.max(0, run.timeLimit - run.t);
      setText('tn', el.h_time_num, fmt1(left));
      setRing('tr', el.h_time_ring, left / run.timeLimit);
      setClass('tlow', el.h_timer, 'low', left <= 5);
    } else {
      setText('en', el.h_evap_num, fmt1(run.drainRate) + ' su/sn');
      setWidth('eb', el.h_evap_bar, run.drainRate / EVAP_METER_MAX);
    }

    const comboOn = run.combo > 1 && run.comboTimer > 0;
    setHidden('comboH', el.h_combo, !comboOn);
    if (comboOn) {
      // A larger timer than last frame means the combo window was refreshed.
      if (run.comboTimer > lastComboTimer) comboWindow = Math.max(run.comboTimer, 0.001);
      setText('cn', el.h_combo_num, fmtCombo(run.combo));
      setWidth('cb', el.h_combo_bar, run.comboTimer / comboWindow);
      if (run.combo > lastComboVal) pop(el.h_combo);
      lastComboVal = run.combo;
    } else {
      lastComboVal = 1;
    }
    lastComboTimer = comboOn ? run.comboTimer : 0;
  }

  // ---------- Results ----------
  function stopCountUp() { if (countRaf) { cancelAnimationFrame(countRaf); countRaf = 0; } }

  function countUp(node, target) {
    stopCountUp();
    if (target <= 0 || reducedMotion()) { node.textContent = '+' + fmtInt(target); return; }
    const t0 = performance.now();
    node.textContent = '+0';
    const step = function (now) {
      const p = Math.min(1, (now - t0) / COUNT_UP_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = '+' + fmtInt(target * eased);
      if (p < 1) countRaf = requestAnimationFrame(step);
      else { countRaf = 0; node.classList.add('done'); }
    };
    countRaf = requestAnimationFrame(step);
  }

  // Level block of the results screen: victory, boss escaped, or level bar progress (no percentages).
  function levelBlockHtml(result) {
    const level = result.levelId ? C.levels[result.levelId - 1] : null;
    if (!level) return '';
    const run = RD.game && RD.game.run;
    const boss = run && run.level === level ? run.boss : null;
    if (result.bossWin) {
      const t = result.unlocks, pl = t && C.plants[t];
      const reward = result.bossReward != null ? result.bossReward
        : Math.round((level.reward || 0) * ((run && run.stats && run.stats.coinMul) || 1));
      const sweepCoins = result.sweepCoins || 0, sweepBlooms = result.sweepBlooms || 0;
      let confetti = '';
      for (let i = 0; i < 14; i++) confetti += '<i style="--i:' + i + '"></i>';
      return '<div class="res-win">' +
          '<div class="res-confetti" aria-hidden="true">' + confetti + '</div>' +
          (pl ? '<div class="res-flower">' + flowerImg(t, 112, 'res-flower-img') + '</div>' +
            '<div class="res-unlock">Yeni çiçek: <b>' + pl.label + '</b></div>' : '') +
          '<div class="res-reward">' + level.boss.label + ' ödülü ' + coinIcon('mini-coin') + '<b>+' + fmtInt(reward) + '</b> dahil</div>' +
          (sweepCoins > 0 || sweepBlooms > 0
            ? '<div class="res-reward res-sweep">Zafer dalgası: ' + coinIcon('mini-coin') + '<b>+' + fmtInt(sweepCoins) + '</b> para, <b>' +
              fmtInt(sweepBlooms) + '</b> çiçek</div>' : '') +
        '</div>';
    }
    if (result.bossReached && boss) {
      let body = '';
      if (boss.kind === 'arms') {
        let done = 0, pips = '';
        boss.parts.forEach(function (q) {
          if (q.done) done++;
          pips += '<span class="res-pip' + (q.done ? ' on' : '') + '"><i style="width:' + Math.round(Math.min(1, q.water / q.need) * 100) + '%"></i></span>';
        });
        body = '<div class="res-boss-line"><span>Sulanan kol: <b>' + done + '/' + boss.parts.length + '</b></span></div><div class="res-pips">' + pips + '</div>';
      } else {
        const q = boss.parts[0], w = Math.min(1, q.water / q.need);
        if (boss.kind === 'shield') {
          body += '<div class="res-boss-line"><span>Dikenler</span>' + resBar(Math.min(1, boss.shield), 'bar-thorn') + '</div>';
        }
        body += '<div class="res-boss-line"><span>Su</span>' + resBar(w, 'bar-boss') + '</div>';
      }
      return '<div class="res-level res-escaped">' +
          '<div class="res-level-name">' + flowerImg(boss.type, 48, 'res-lv-ico') + '<span>' + boss.label + '</span></div>' + body +
        '</div>';
    }
    const pts = Math.min(level.barTarget, Math.round((result.bar || 0) * level.barTarget));
    return '<div class="res-level">' +
        '<div class="res-level-name">' + flowerImg(level.boss.type, 48, 'res-lv-ico') + '<span>' + levelTitle(level) + '</span></div>' +
        '<div class="res-boss-line"><span>Yeşillik barı: <b>' + pts + '/' + level.barTarget + '</b></span></div>' +
        resBar(pts / level.barTarget, 'bar-level') +
      '</div>';
  }
  function resBar(frac, cls) {
    return '<div class="bar res-bar"><div class="bar-fill ' + cls + '" style="width:' + (Math.round(Math.max(0, Math.min(1, frac)) * 200) / 2) + '%"></div></div>';
  }

  function showResults(result) {
    const total = RD.Meta.data.coins;
    const chip = function (ic, label, value) {
      return '<div class="chip">' + icon(ic, 'chip-ico') + '<span class="chip-val">' + value + '</span><span class="chip-lbl">' + label + '</span></div>';
    };
    const win = !!result.bossWin;
    const escaped = !win && result.bossReached;
    const title = win ? 'Bölüm tamamlandı!' : (escaped ? 'Boss kaçtı!' : (END_TEXT[result.endReason] || 'Tur bitti!'));
    const sub = win ? (result.levelName ? 'Bölüm ' + result.levelId + ' · ' + result.levelName : '')
      : (escaped ? (END_TEXT[result.endReason] || '') + ' Az kaldı!' : '');
    // Next step after a win: the next level (or the end of the prototype)
    let next = '';
    if (win) {
      next = RD.Meta.allCleared() ? 'Prototip bitti! Son bölümü tekrar oynayabilirsin'
        : 'Sıradaki: ' + levelTitle(RD.Meta.currentLevel());
    }
    el.results.innerHTML =
      '<div class="panel panel-narrow results-panel' + (win ? ' is-win' : '') + '">' +
        '<h2 class="res-title">' + title + '</h2>' +
        (sub ? '<div class="res-sub res-sub-top">' + sub + '</div>' : '') +
        levelBlockHtml(result) +
        '<div class="res-sub">Kazandığın para</div>' +
        '<div class="big-coins">' + coinIcon('big-coin') + '<span id="res-coins">+' + fmtInt(result.coins) + '</span></div>' +
        '<div class="chips">' +
          chip('flower', 'çiçek', fmtInt(result.blooms)) +
          chip('bolt', 'en iyi kombo', fmtCombo(result.bestCombo || 1)) +
          chip('hourglass', 'süre', fmt1(result.duration) + ' sn') +
        '</div>' +
        '<div class="res-total">Toplam ' + coinIcon('mini-coin') + '<b>' + fmtInt(total) + '</b>' +
          '<span class="res-mode">' + modeLabel(result.mode) + '</span></div>' +
        (next ? '<div class="res-next">' + next + '</div>' : '') +
        '<div class="btn-stack">' +
          '<button class="btn btn-primary btn-big btn-wide" id="res-again">' + (win && !RD.Meta.allCleared() ? 'Sonraki Bölüm' : 'Tekrar') + '</button>' +
          '<button class="btn btn-wide" id="res-shop">Yetenek Ağacı</button>' +
        '</div>' +
      '</div>';
    $('res-shop').addEventListener('click', function () { cb.onOpenShop(); });
    $('res-again').addEventListener('click', function () { cb.onStartRun(); });
    showScreen('results');
    countUp($('res-coins'), result.coins);
  }

  // ---------- Skill tree ----------
  const TREE_ZOOM_MIN = 0.6, TREE_ZOOM_MAX = 1.6, TREE_DRAG_PX = 6, TREE_DBL_MS = 350;
  const BRANCH_LABEL = { water: 'Su', rain: 'Yağmur', bounty: 'Bereket', time: 'Mevsim', storm: 'Fırtına', wind: 'Rüzgar' };
  const UNIT = { tank: ' su', rainRadius: '', rainRate: '', cloudSpeed: '', coinBonus: ' para', roseBonus: ' para',
    plantCount: '', roseCount: '', tulipCount: '', lavenderCount: '', bluebellCount: '', sunflowerCount: '', skylilyCount: '', needReduce: '',
    coinMul: '', sunflowerMul: '', comboMax: '', comboStep: '', comboWindow: ' sn', dew: ' su', timeBonus: ' sn', drainReduce: ' su/sn', rainCostReduce: ' su/sn' };
  const tree = {
    built: false, view: { x: 0, y: 0, z: 1 }, selected: null, needCenter: true,
    seen: null, sp: 0, pointers: new Map(), g: null, lastTap: { id: null, t: 0 },
  };

  function treeSpacing() { return window.innerWidth <= 480 ? 92 : 120; }

  // Player-facing stat names; the detail panel shows the real stat value now -> next ("Şiddet 3 → 4").
  const STAT_NAME = { tank: 'Depo', rainRadius: 'Alan', rainRate: 'Şiddet', cloudSpeed: 'Hız', coinBonus: 'Çiçek başına', roseBonus: 'Gül başına',
    plantCount: 'Bitki', roseCount: 'Gül', tulipCount: 'Lale', lavenderCount: 'Lavanta', bluebellCount: 'Çan çiçeği', sunflowerCount: 'Ayçiçeği',
    skylilyCount: 'Gök zambağı', needReduce: 'Su ihtiyacı', coinMul: 'Para çarpanı', sunflowerMul: 'Ayçiçeği çarpanı', comboMax: 'En yüksek kombo', comboStep: 'Kombo adımı', comboWindow: 'Kombo süresi', dew: 'Çiçek başına', timeBonus: 'Ek süre', drainReduce: 'Buharlaşma', rainCostReduce: 'Yağmur tüketimi' };

  function fmtNum(v) { return String(Math.round(v * 10) / 10); }

  // Stat value at a given node level, all other levels as they are now.
  function statAt(u, lv) {
    const M = RD.Meta;
    const levels = Object.assign({}, M.data.levels);
    levels[u.id] = lv;
    const s = RD.computeStats(levels);
    const mode = RD.CONFIG.modes[M.settings.mode] || RD.CONFIG.modes.timer;
    if (u.stat === 'drainReduce') return Math.max(0, mode.passiveDrain - s.drainReduce);
    if (u.stat === 'rainCostReduce') return Math.max(1, mode.rainCost - s.rainCostReduce);
    return s[u.stat];
  }

  const MUL_STATS = { coinMul: 1, sunflowerMul: 1, comboMax: 1 };
  function fmtEffect(u, lv) {
    const v = statAt(u, lv);
    if (MUL_STATS[u.stat]) return '×' + (Math.round(v * 100) / 100);
    if (u.stat === 'needReduce') return '−' + fmtNum(v);
    const plus = (u.stat === 'coinBonus' || u.stat === 'roseBonus' || u.stat === 'dew' || u.stat === 'timeBonus') ? '+' : '';
    return plus + fmtNum(v) + (UNIT[u.stat] || '');
  }

  // Level pips: one dot per level.
  function pipsHtml(u, lv, cls) {
    if (u.max < 2) return '';
    let s = '<span class="' + (cls || 'tn-pips') + '" aria-hidden="true">';
    for (let i = 0; i < u.max; i++) s += '<i' + (i < lv ? ' class="on"' : '') + '></i>';
    return s + '</span>';
  }

  function buildTree() {
    el.shop.classList.add('screen-tree');
    el.shop.innerHTML =
      '<div class="tree-wrap">' +
        '<header class="tree-head">' +
          '<div class="tree-title"><h2 class="tree-h">Yetenek Ağacı</h2><div class="tree-mode" id="tree-mode"></div></div>' +
          '<div class="coin-pill">' + coinIcon('pill-coin') + '<span class="shop-coins" id="tree-coins"></span></div>' +
        '</header>' +
        '<div class="tree-levels" id="tree-levels"></div>' +
        '<div class="tree-main">' +
          '<div class="tree-vp" id="tree-vp"><div class="tree-world" id="tree-world"></div></div>' +
          '<div class="tree-ctl">' +
            '<button class="tree-btn" id="tree-zout" aria-label="Uzaklaştır">−</button>' +
            '<button class="tree-btn" id="tree-zin" aria-label="Yakınlaştır">+</button>' +
            '<button class="tree-btn tree-btn-txt" id="tree-center">Ortala</button>' +
          '</div>' +
          '<aside class="tree-detail" id="tree-detail" hidden></aside>' +
        '</div>' +
        '<footer class="tree-foot"><button class="btn btn-primary btn-big btn-wide" id="shop-start">' + icon('rain', 'btn-ico') + 'Yağmura Başla</button></footer>' +
      '</div>';
    el.t_vp = $('tree-vp'); el.t_world = $('tree-world'); el.t_detail = $('tree-detail');
    el.t_coins = $('tree-coins'); el.t_mode = $('tree-mode'); el.t_levels = $('tree-levels');
    $('shop-start').addEventListener('click', function () { cb.onStartRun(); });
    $('tree-zin').addEventListener('click', function () { zoomAt(vpCenter(), 1.2); });
    $('tree-zout').addEventListener('click', function () { zoomAt(vpCenter(), 1 / 1.2); });
    $('tree-center').addEventListener('click', function () { centerTree(); });
    el.t_detail.addEventListener('click', function (e) {
      const t = e.target.closest ? e.target.closest('button') : null;
      if (!t) return;
      if (t.id === 'tree-close') { tree.selected = null; renderShop(); }
      else if (t.id === 'tree-buy' && tree.selected) buyNode(tree.selected);
    });
    bindTreeInput();
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () {
        if (el.shop.hidden) return;
        if (tree.sp && tree.sp !== treeSpacing()) renderShop();
        if (tree.needCenter) centerTree();
      }).observe(el.t_vp);
    }
    tree.built = true;
  }

  function applyView() {
    const v = tree.view;
    el.t_world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.z + ')';
  }
  function vpCenter() { return { x: el.t_vp.clientWidth / 2, y: el.t_vp.clientHeight / 2 }; }
  function centerTree() {
    const w = el.t_vp.clientWidth, h = el.t_vp.clientHeight;
    if (!w || !h) return;               // hidden: retry when the viewport gets a size
    tree.view.x = w / 2; tree.view.y = h / 2;
    tree.needCenter = false;
    applyView();
  }
  // Zoom by factor around a point given in viewport coordinates.
  function zoomAt(p, factor) {
    const v = tree.view;
    const z = Math.max(TREE_ZOOM_MIN, Math.min(TREE_ZOOM_MAX, v.z * factor));
    const k = z / v.z;
    v.x = p.x - (p.x - v.x) * k;
    v.y = p.y - (p.y - v.y) * k;
    v.z = z;
    applyView();
  }

  function buyNode(id) {
    if (RD.Meta.buy(id)) { renderShop(); refreshDebug(); }
  }

  function tapNode(id) {
    const now = Date.now();
    const dbl = id && tree.lastTap.id === id && now - tree.lastTap.t < TREE_DBL_MS;
    tree.lastTap = { id: id, t: now };
    if (dbl && RD.Meta.canBuy(id)) { tree.selected = id; buyNode(id); return; }
    tree.selected = id;                  // null deselects
    renderShop();
  }

  function bindTreeInput() {
    const vp = el.t_vp;
    const rel = function (e) { const r = vp.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pair = function () {
      const a = Array.from(tree.pointers.values());
      return { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2 };
    };
    vp.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const n = e.target.closest ? e.target.closest('.tnode') : null;
      tree.pointers.set(e.pointerId, rel(e));
      if (tree.pointers.size === 1) {
        tree.g = { sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, id: n ? n.getAttribute('data-id') : null };
      } else if (tree.pointers.size === 2 && tree.g) {
        tree.g.moved = true;
        tree.g.pair = pair();
      }
    });
    vp.addEventListener('pointermove', function (e) {
      if (!tree.pointers.has(e.pointerId) || !tree.g) return;
      tree.pointers.set(e.pointerId, rel(e));
      const g = tree.g;
      if (tree.pointers.size >= 2) {
        const p = pair();
        if (g.pair) {
          tree.view.x += p.mx - g.pair.mx; tree.view.y += p.my - g.pair.my;
          zoomAt({ x: p.mx, y: p.my }, p.d / g.pair.d);
        }
        g.pair = p;
        return;
      }
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > TREE_DRAG_PX) {
        g.moved = true;
        try { vp.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
        vp.classList.add('dragging');
      }
      if (g.moved) {
        tree.view.x += e.clientX - g.lx; tree.view.y += e.clientY - g.ly;
        applyView();
      }
      g.lx = e.clientX; g.ly = e.clientY;
    });
    const end = function (e) {
      if (!tree.pointers.has(e.pointerId)) return;
      tree.pointers.delete(e.pointerId);
      const g = tree.g;
      if (!g) return;
      if (tree.pointers.size === 0) {
        tree.g = null;
        vp.classList.remove('dragging');
        if (e.type === 'pointerup' && !g.moved) tapNode(g.id);
      } else if (tree.pointers.size === 1) {
        // Pinch ended: continue as a pan from the remaining finger without a jump.
        const rest = Array.from(tree.pointers.values())[0];
        const r = vp.getBoundingClientRect();
        g.lx = rest.x + r.left; g.ly = rest.y + r.top; g.pair = null;
      }
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    vp.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomAt(rel(e), Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    // Keyboard activation (Enter) of a focused node; pointer taps are handled above.
    vp.addEventListener('click', function (e) {
      if (e.detail !== 0) return;
      const n = e.target.closest ? e.target.closest('.tnode') : null;
      if (n) { tree.selected = n.getAttribute('data-id'); renderShop(); }
    });
  }

  function detailHtml(u) {
    const M = RD.Meta;
    const lv = M.levelOf(u.id);
    const close = '<button class="tree-x" id="tree-close" aria-label="Kapat">×</button>';
    const root = u.kind === 'root';
    const bcls = root ? 'b-root' : 'b-' + u.branch;
    const disc = '<span class="td-disc ' + bcls + '">' + (root ? icon('drop') : nodeVisual(u, '')) + '</span>';
    if (root) {
      return '<div class="td-head">' + disc + '<div class="td-titles"><div class="td-name">' + u.label + '</div>' +
          '<div class="td-sub">Başlangıç</div></div>' + close + '</div>' +
        '<div class="td-desc">' + u.desc + '</div><div class="td-note">Her zaman açık</div>';
    }
    const st = M.nodeState(u.id);
    const cost = M.costOf(u.id);
    let eff = (STAT_NAME[u.stat] ? '<span class="td-eff-name">' + STAT_NAME[u.stat] + '</span>' : '') +
      '<span class="td-eff-cur">' + fmtEffect(u, lv) + '</span>';
    if (lv < u.max) eff += '<span class="td-arrow">→</span><span class="td-eff-next">' + fmtEffect(u, lv + 1) + '</span>';
    let foot;
    if (st === 'maxed') {
      foot = '<span class="card-max">Tamamlandı</span>';
    } else if (st === 'locked') {
      const p = M.upgradeById(u.parent);
      foot = '<span class="td-need">' + icon('lock', 'td-lock') + '<span>Gereken: ' + (p ? p.label : u.parent) + ' Sv ' + (u.need || 1) + '</span></span>' +
        '<button class="btn td-buy" id="tree-buy" disabled>Al</button>';
    } else {
      const can = M.canBuy(u.id);
      foot = '<span class="td-cost' + (can ? '' : ' poor') + '">' + coinIcon('td-coin') + cost + '</span>' +
        '<button class="btn btn-gold td-buy" id="tree-buy"' + (can ? '' : ' disabled') + '>Al</button>';
    }
    return '<div class="td-head">' + disc + '<div class="td-titles"><div class="td-name">' + u.label + '</div>' +
        '<div class="td-sub">' + (BRANCH_LABEL[u.branch] || '') + ' · Sv ' + lv + '/' + u.max + pipsHtml(u, lv, 'td-pips') + '</div></div>' + close + '</div>' +
      '<div class="td-desc">' + u.desc + '</div>' +
      '<div class="td-eff">' + eff + '</div>' +
      '<div class="td-foot">' + foot + '</div>';
  }

  // Level strip under the tree header: current level name + one marker per level (cleared / current / locked).
  function levelsHtml() {
    const M = RD.Meta;
    if (!C.levels || !C.levels.length) return '';
    const all = M.allCleared(), cur = M.currentLevel();
    let marks = '';
    C.levels.forEach(function (level) {
      const st = M.data.level > level.id ? 'cleared' : (M.data.level === level.id ? 'current' : 'locked');
      const name = levelTitle(level) + (st === 'cleared' ? ' (tamamlandı)' : (st === 'locked' ? ' (kilitli)' : ''));
      marks += '<span class="lvm lvm-' + st + '" title="' + name + '" aria-label="' + name + '">' +
        flowerImg(level.boss.type, 48, 'lvm-ico') +
        (st === 'cleared' ? '<b class="lvm-badge">✓</b>' : (st === 'locked' ? '<b class="lvm-badge lvm-lock">' + icon('lock', '') + '</b>' : '')) +
        '</span>';
    });
    const text = all ? '<span class="tl-name">Prototip bitti!</span><span class="tl-sub">Son bölümü tekrar oynayabilirsin</span>'
      : '<span class="tl-name">' + levelTitle(cur) + '</span><span class="tl-sub">Boss: ' + cur.boss.label + '</span>';
    return '<div class="tl-text">' + text + '</div><div class="tl-marks">' + marks + '</div>';
  }

  // Rebuilds the whole tree from current Meta state, so it always reflects visibility
  // (nothing is patched incrementally; the "new node" animation is cosmetic only).
  function renderShop() {
    const M = RD.Meta;
    if (!tree.built) buildTree();
    const sp = treeSpacing();
    tree.sp = sp;
    const D = sp === 92 ? 52 : 68, DR = sp === 92 ? 64 : 84;
    const animate = !el.shop.hidden && !reducedMotion();
    const firstRender = tree.seen === null;
    const seen = new Set();
    let lines = '', nodes = '';
    C.upgrades.forEach(function (u) {
      const st = M.nodeState(u.id);
      if (st === 'hidden') return;
      const isNew = animate && !firstRender && !tree.seen.has(u.id);
      seen.add(u.id);
      const lv = M.levelOf(u.id);
      const root = u.kind === 'root';
      const d = root ? DR : D;
      const cx = u.pos[0] * sp, cy = u.pos[1] * sp;
      const par = u.parent ? M.upgradeById(u.parent) : null;
      if (par) {
        lines += '<line class="tline b-' + u.branch + (lv > 0 ? ' on' : '') + (isNew ? ' is-new' : '') + '" x1="' +
          par.pos[0] * sp + '" y1="' + par.pos[1] * sp + '" x2="' + cx + '" y2="' + cy + '"/>';
      }
      const buyable = M.canBuy(u.id);
      let inner, label = u.label, extra = '';
      if (root) inner = icon('drop', 'tn-ico');
      else if (st === 'locked') { inner = icon('lock', 'tn-ico'); label = '?'; }
      else {
        inner = nodeVisual(u, 'tn-ico');
        extra = pipsHtml(u, lv, 'tn-pips');
        if (st !== 'maxed') {
          extra += '<span class="tn-cost' + (buyable ? ' ok' : '') + '">' + coinIcon('tn-coin') + M.costOf(u.id) + '</span>';
        }
      }
      const cls = 'tnode ' + (root ? 'b-root' : 'b-' + u.branch) + ' st-' + st + (root ? ' is-root' : '') +
        (buyable ? ' can-buy' : '') + (tree.selected === u.id ? ' sel' : '') + (isNew ? ' is-new' : '');
      nodes += '<button class="' + cls + '" data-id="' + u.id + '" style="left:' + (cx - d / 2) + 'px;top:' + (cy - d / 2) +
        'px;width:' + d + 'px;height:' + d + 'px" aria-label="' + u.label + '">' +
        inner + extra +
        '<span class="tn-lbl" style="top:' + (d + 9) + 'px;width:' + (sp - 10) + 'px">' + label + '</span></button>';
    });
    tree.seen = seen;
    if (tree.selected && !seen.has(tree.selected)) tree.selected = null;   // e.g. after a progress reset
    el.t_world.innerHTML = '<svg class="tree-lines" width="1" height="1" viewBox="0 0 1 1">' + lines + '</svg>' + nodes;
    el.t_coins.textContent = fmtInt(M.data.coins);
    el.t_mode.textContent = modeLabel(M.settings.mode);
    el.t_levels.innerHTML = levelsHtml();
    const sel = tree.selected ? M.upgradeById(tree.selected) : null;
    el.t_detail.hidden = !sel;
    if (sel) el.t_detail.innerHTML = detailHtml(sel);
    applyView();
    if (tree.needCenter) centerTree();
  }

  // ---------- Screens ----------
  function showScreen(name) {
    el.hud.hidden = name !== 'run';
    el.results.hidden = name !== 'results';
    el.shop.hidden = name !== 'shop';
    if (name !== 'results') stopCountUp();
    if (name !== 'run') hideToast();
    if (name === 'run') resetHudCache();
    if (name === 'shop' && tree.built && tree.needCenter) requestAnimationFrame(centerTree);
  }

  // ---------- Debug panel ----------
  // The value a run would use if the override were empty.
  function defaultFor(key) {
    const s = RD.Meta.settings;
    if (key === 'tank') return RD.computeStats(RD.Meta.data.levels).tank;
    const preset = s.preset && C.drainPresets[s.preset];
    if (preset && (key === 'passiveDrain' || key === 'rainCost')) return preset[key];
    const m = C.modes[s.mode] || C.modes.timer;
    return m[key];
  }

  function refreshDebug() {
    const s = RD.Meta.settings;
    if (!dbgInputs.mode) return;
    dbgInputs.mode.value = s.mode;
    el.dbg.querySelectorAll('[data-preset]').forEach(function (b) {
      b.classList.toggle('active', (s.preset || '') === b.getAttribute('data-preset'));
    });
    DBG_FIELDS.forEach(function (f) {
      const inp = dbgInputs[f[0]];
      inp.placeholder = String(defaultFor(f[0]));
      if (document.activeElement !== inp) {
        inp.value = typeof s.overrides[f[0]] === 'number' ? String(s.overrides[f[0]]) : '';
      }
    });
    el.dbg.querySelectorAll('[data-level]').forEach(function (b) {
      b.classList.toggle('active', String(Math.min(RD.Meta.data.level, C.levels.length)) === b.getAttribute('data-level'));
    });
    const coins = $('dbg-coins');
    if (coins) coins.textContent = 'Para: ' + fmtInt(RD.Meta.data.coins);
  }

  function refreshShopIfVisible() { if (!el.shop.hidden) renderShop(); }

  function toggleDebug(force) {
    const show = typeof force === 'boolean' ? force : el.dbg.hidden;
    el.dbg.hidden = !show;
    if (show) refreshDebug();
  }

  function buildDebug() {
    let fields = '';
    DBG_FIELDS.forEach(function (f) {
      fields += '<label class="dbg-field"><span>' + f[1] + '</span>' +
        '<input type="number" step="any" inputmode="decimal" data-key="' + f[0] + '"></label>';
    });
    let presets = '';
    PRESET_BTNS.forEach(function (p) {
      presets += '<button class="chip-btn" data-preset="' + (p[0] || '') + '">' + p[1] + '</button>';
    });
    let levelBtns = '';
    C.levels.forEach(function (level) { levelBtns += '<button class="chip-btn" data-level="' + level.id + '">' + level.id + '</button>'; });
    let modeOpts = '';
    for (const m in C.modes) modeOpts += '<option value="' + m + '">' + C.modes[m].label + '</option>';
    el.dbg.innerHTML =
      '<div class="dbg-head"><b>Debug</b><span class="dbg-tag">dev</span><button class="dbg-close" id="dbg-close" aria-label="Kapat">×</button></div>' +
      '<p class="dbg-note">Değişiklikler bir sonraki run\'da geçerli</p>' +
      '<label class="dbg-field"><span>Mod</span><select id="dbg-mode">' + modeOpts + '</select></label>' +
      '<div class="dbg-sub">Kayıp ön ayarı</div><div class="chip-row">' + presets + '</div>' +
      '<div class="dbg-sub">Değer geçersiz kılma (boş = varsayılan)</div>' + fields +
      '<div class="dbg-sub">Bölümü seç</div><div class="chip-row" id="dbg-levels">' + levelBtns + '</div>' +
      '<div class="dbg-sub">Kayıt</div><div class="dbg-coins" id="dbg-coins"></div>' +
      '<div class="chip-row"><button class="chip-btn" id="dbg-plus">+1000 para</button>' +
      '<button class="chip-btn chip-danger" id="dbg-reset">Kaydı sıfırla</button></div>';

    dbgInputs = { mode: $('dbg-mode') };
    el.dbg.querySelectorAll('input[data-key]').forEach(function (inp) { dbgInputs[inp.getAttribute('data-key')] = inp; });

    dbgInputs.mode.addEventListener('change', function () {
      RD.Meta.settings.mode = dbgInputs.mode.value;
      RD.Meta.save(); refreshDebug(); refreshShopIfVisible();
    });
    el.dbg.querySelectorAll('[data-preset]').forEach(function (b) {
      b.addEventListener('click', function () {
        RD.Meta.settings.preset = b.getAttribute('data-preset') || null;
        RD.Meta.save(); refreshDebug();
      });
    });
    el.dbg.querySelectorAll('input[data-key]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        const k = inp.getAttribute('data-key');
        const v = parseFloat(inp.value);
        if (inp.value.trim() === '' || !isFinite(v)) delete RD.Meta.settings.overrides[k];
        else RD.Meta.settings.overrides[k] = v;
        RD.Meta.save();
      });
    });
    el.dbg.querySelectorAll('[data-level]').forEach(function (b) {
      b.addEventListener('click', function () {
        RD.Meta.data.level = parseInt(b.getAttribute('data-level'), 10) || 1;
        RD.Meta.save(); refreshDebug(); refreshShopIfVisible();
      });
    });
    $('dbg-plus').addEventListener('click', function () {
      RD.Meta.addCoins(1000); RD.Meta.save(); refreshDebug(); refreshShopIfVisible();
    });
    $('dbg-reset').addEventListener('click', function () {
      if (!confirm('Tüm ilerleme silinsin mi? Bu geri alınamaz.')) return;
      RD.Meta.reset(); refreshDebug(); refreshShopIfVisible();
    });
    $('dbg-close').addEventListener('click', function () { toggleDebug(false); });
  }

  // ---------- Init ----------
  function init(callbacks) {
    cb = Object.assign(cb, callbacks || {});
    el.hud = $('hud'); el.results = $('screen-results'); el.shop = $('screen-shop');
    el.dbg = $('dbg'); el.dbgBtn = $('dbg-btn');
    buildHud();
    buildDebug();
    el.dbgBtn.addEventListener('click', function () { toggleDebug(); });
    addEventListener('keydown', function (e) {
      if (e.key !== 'd' && e.key !== 'D') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
      toggleDebug();
    });
  }

  RD.UI = { init: init, showScreen: showScreen, updateHud: updateHud, showResults: showResults, renderShop: renderShop };
})(window.RD = window.RD || {});
