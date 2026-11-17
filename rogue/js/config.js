// Design data for the roguelite prototype. All tunables live here; see PRD.md.
(function (RD) {
  'use strict';

  RD.CONFIG = {
    saveKey: 'rd-rogue-v2',

    // Base stats before upgrades (world units = CSS pixels of the play area)
    // Plain flat numbers only (no percentages): see memory "no-percentages".
    base: {
      tank: 100,           // water at run start
      rainRadius: 40,      // px
      rainRate: 3,         // "Yağmur şiddeti": water/s to EACH plant under the rain
      cloudSpeed: 4,       // level; px/s = cloudSpeed * speedPx (main.js)
      coinBonus: 0,        // extra coins on every bloom
      roseBonus: 0,        // extra coins on every rose
      coinMul: 1,          // NEW: global coin multiplier (×), Fırtına branch
      sunflowerMul: 1,     // NEW: sunflower coin multiplier (×), Altın Polen
      plantCount: 10,      // plants alive on the field at once
      roseCount: 1,        // roses kept on the field
      tulipCount: 0,       // NEW: tulips kept on the field
      lavenderCount: 0,    // NEW
      bluebellCount: 0,    // NEW
      sunflowerCount: 0,   // NEW
      skylilyCount: 0,     // NEW
      needReduce: 0,       // NEW: water need removed from every plant (min 1)
      comboWindow: 1.5,    // s
      comboStep: 0.25,     // NEW (was CONFIG.combo.step)
      comboMax: 3,         // NEW (was CONFIG.combo.max)
      dew: 0,              // water refunded per bloom
      timeBonus: 0,        // s, Mevsim branch (max +10)
      drainReduce: 0,      // su/sn removed from passive drain
      rainCostReduce: 0,   // su/sn removed from rain cost
    },
    speedPx: 65,

    // Run-limit systems (PRD §4). A run starts with a copy of the active mode, then debug overrides.
    modes: {
      timer: {
        label: 'Süre + Su',
        baseTime: 20,       // s; run ends at baseTime + timeBonus
        passiveDrain: 2,    // su/sn always
        rainCost: 8,        // su/sn while raining (flat, independent of rain strength)
        evapRamp: 0,
        rampDelay: 0,
      },
      evap: {
        label: 'Artan Buharlaşma',
        baseTime: 0,        // no timer
        passiveDrain: 2,
        rainCost: 8,
        evapRamp: 2,        // drain grows by 2 su/sn every second after rampDelay
        rampDelay: 6,       // s; half of timeBonus is added here in evap mode (design/tree-v2.md, option A)
      },
    },

    // Debug presets for the "time vs use" question (applied on top of the selected mode)
    drainPresets: {
      time:  { label: 'Sadece zaman',    passiveDrain: 6, rainCost: 0 },
      use:   { label: 'Sadece kullanım', passiveDrain: 0, rainCost: 8 },
      mixed: { label: 'Karışık',         passiveDrain: 2, rainCost: 8 },
    },

    // countStat: kept on the field by count. weight: filler pick weight (internal, never shown).
    // bonusStat: flat coins added for this type. mulStat: × for this type.
    // comboX: × when bloomed while combo > 1. refund: su back on bloom. rebloom: extra blooms. wilt: su/s lost when not rained on.
    plants: {
      cactus:    { label: 'Kaktüs',      need: 2,  coins: 1,  color: '#7a9e6a', bloom: '#f2c14e', weight: 65 },
      daisy:     { label: 'Papatya',     need: 6,  coins: 3,  color: '#8cb488', bloom: '#f3ede2', weight: 35 },
      tulip:     { label: 'Lale',        need: 8,  coins: 5,  color: '#6f9e6a', bloom: '#e07a4f', countStat: 'tulipCount' },
      lavender:  { label: 'Lavanta',     need: 6,  coins: 3,  color: '#7f9c86', bloom: '#a58ad0', countStat: 'lavenderCount', comboX: 2 },
      bluebell:  { label: 'Çan Çiçeği',  need: 8,  coins: 2,  color: '#6e9a7a', bloom: '#6f93d6', countStat: 'bluebellCount', refund: 5 },
      rose:      { label: 'Gül',         need: 12, coins: 8,  color: '#6a9a66', bloom: '#d65c7a', countStat: 'roseCount', bonusStat: 'roseBonus' },
      sunflower: { label: 'Ayçiçeği',    need: 14, coins: 7,  color: '#78a05e', bloom: '#e9b23c', countStat: 'sunflowerCount', mulStat: 'sunflowerMul', rebloom: 1 },
      skylily:   { label: 'Gök Zambağı', need: 36, coins: 30, color: '#5f8e86', bloom: '#4d5fa8', countStat: 'skylilyCount', wilt: 3 },
    },
    respawnDelay: 0.8,       // s after a bloom before a new seedling appears
    bloomLinger: 0.6,        // s a bloomed flower stays visible

    // Skill tree (PRD §6). Each node: parent (id), need (parent level required to unlock, default 1),
    // pos [col, row] in tree grid units (root at 0,0; up = negative row). A node is visible once its
    // parent has level >= 1, and buyable once the parent has level >= need. The root is always owned.
    // effect(level) is the TOTAL bonus: 'add' => per*level. All upgrades are flat 'add' (no percentages).
    upgrades: [
      { id: 'core', label: 'Bulut', desc: 'Her şeyin başladığı yer', kind: 'root', max: 1, pos: [0, 0] },

      // Water / tank (up)
      { id: 'tank',      branch: 'water',  label: 'Depo',            desc: '+20 su',                   stat: 'tank',           kind: 'add', per: 20,   max: 5, baseCost: 8,     growth: 1.6,  parent: 'core',      need: 1, pos: [0, -1] },
      { id: 'tank2',     branch: 'water',  label: 'Büyük Depo',      desc: '+40 su',                   stat: 'tank',           kind: 'add', per: 40,   max: 4, baseCost: 60,    growth: 2,    parent: 'tank',      need: 3, pos: [0, -2] },
      { id: 'seal',      branch: 'water',  label: 'Sızdırmazlık',    desc: '−1 su/sn buharlaşma',      stat: 'drainReduce',    kind: 'add', per: 1,    max: 2, baseCost: 40,    growth: 2.5,  parent: 'tank',      need: 2, pos: [-1, -2] },
      { id: 'dew',       branch: 'water',  label: 'Çiy',             desc: 'Açan çiçek +1 su',         stat: 'dew',            kind: 'add', per: 1,    max: 3, baseCost: 500,   growth: 2.5,  parent: 'tank2',     need: 2, pos: [0, -3] },
      { id: 'thrift',    branch: 'water',  label: 'Verimli Yağmur',  desc: '−1 su/sn yağmur tüketimi', stat: 'rainCostReduce', kind: 'add', per: 1,    max: 4, baseCost: 100,   growth: 2.1,  parent: 'seal',      need: 1, pos: [-1, -3] },

      // Storm (up-right, late)
      { id: 'storm',     branch: 'storm',  label: 'Kara Bulut',      desc: 'Tüm para çarpanı +0.1',    stat: 'coinMul',        kind: 'add', per: 0.1,  max: 5, baseCost: 8000,  growth: 1.3,  parent: 'core',      need: 1, pos: [1, -1] },
      { id: 'lightning', branch: 'storm',  label: 'Şimşek',          desc: 'En yüksek kombo +0.25',    stat: 'comboMax',       kind: 'add', per: 0.25, max: 4, baseCost: 15000, growth: 1.35, parent: 'storm',     need: 2, pos: [1, -2] },
      { id: 'thunder',   branch: 'storm',  label: 'Gök Gürültüsü',   desc: 'Kombo adımı +0.25',        stat: 'comboStep',      kind: 'add', per: 0.25, max: 1, baseCost: 40000, growth: 1,    parent: 'storm',     need: 1, pos: [2, -2] },
      { id: 'downpour',  branch: 'storm',  label: 'Sağanak',         desc: '+1 şiddet',                stat: 'rainRate',       kind: 'add', per: 1,    max: 5, baseCost: 12000, growth: 1.3,  parent: 'thunder',   need: 1, pos: [3, -2] },
      { id: 'eye',       branch: 'storm',  label: 'Fırtına Gözü',    desc: 'Tüm para çarpanı +0.1',    stat: 'coinMul',        kind: 'add', per: 0.1,  max: 5, baseCost: 25000, growth: 1.2,  parent: 'lightning', need: 2, pos: [1, -3] },

      // Rain + soil (right)
      { id: 'radius',    branch: 'rain',   label: 'Yağmur Alanı',    desc: '+8 alan',                  stat: 'rainRadius',     kind: 'add', per: 8,    max: 4, baseCost: 10,    growth: 1.7,  parent: 'core',      need: 1, pos: [1, 0] },
      { id: 'flow',      branch: 'rain',   label: 'Yağmur Şiddeti',  desc: '+1 şiddet',                stat: 'rainRate',       kind: 'add', per: 1,    max: 4, baseCost: 16,    growth: 1.8,  parent: 'radius',    need: 1, pos: [2, 0] },
      { id: 'radius2',   branch: 'rain',   label: 'Geniş Bulut',     desc: '+12 alan',                 stat: 'rainRadius',     kind: 'add', per: 12,   max: 3, baseCost: 200,   growth: 2.2,  parent: 'radius',    need: 3, pos: [2, 1] },
      { id: 'flow2',     branch: 'rain',   label: 'Bol Yağmur',      desc: '+2 şiddet',                stat: 'rainRate',       kind: 'add', per: 2,    max: 3, baseCost: 500,   growth: 2.3,  parent: 'flow',      need: 3, pos: [3, 0] },
      { id: 'soil',      branch: 'rain',   label: 'Yumuşak Toprak',  desc: 'Her çiçek −1 su ister',    stat: 'needReduce',     kind: 'add', per: 1,    max: 2, baseCost: 12000, growth: 2.5,  parent: 'flow2',     need: 2, pos: [4, 0] },

      // Seasons / time (down): hard cap +10 s total (3×1 + 2×2 + 1×3)
      { id: 'time1',     branch: 'time',   label: 'İlkbahar',        desc: '+1 sn run süresi',         stat: 'timeBonus',      kind: 'add', per: 1,    max: 3, baseCost: 150,   growth: 2.5,  parent: 'core',      need: 1, pos: [0, 1] },
      { id: 'time2',     branch: 'time',   label: 'Yaz',             desc: '+2 sn run süresi',         stat: 'timeBonus',      kind: 'add', per: 2,    max: 2, baseCost: 6000,  growth: 2.5,  parent: 'time1',     need: 3, pos: [0, 2] },
      { id: 'time3',     branch: 'time',   label: 'Uzun Yaz',        desc: '+3 sn run süresi',         stat: 'timeBonus',      kind: 'add', per: 3,    max: 1, baseCost: 40000, growth: 1,    parent: 'time2',     need: 2, pos: [0, 3] },

      // Wind / movement (down-left)
      { id: 'wind',      branch: 'wind',   label: 'Rüzgar',          desc: '+1 hız',                   stat: 'cloudSpeed',     kind: 'add', per: 1,    max: 4, baseCost: 10,    growth: 1.7,  parent: 'core',      need: 1, pos: [-1, 1] },
      { id: 'gust',      branch: 'wind',   label: 'Fırtına Rüzgarı', desc: '+2 hız',                   stat: 'cloudSpeed',     kind: 'add', per: 2,    max: 2, baseCost: 400,   growth: 2.5,  parent: 'wind',      need: 3, pos: [-2, 2] },
      { id: 'windseed',  branch: 'wind',   label: 'Tohum Rüzgarı',   desc: '+2 bitki',                 stat: 'plantCount',     kind: 'add', per: 2,    max: 2, baseCost: 3000,  growth: 2,    parent: 'wind',      need: 2, pos: [-1, 2] },

      // Bounty + flowers (left): every flower unlock lives here
      { id: 'bounty',    branch: 'bounty', label: 'Bereket',         desc: 'Her çiçek +1 para',        stat: 'coinBonus',      kind: 'add', per: 1,    max: 5, baseCost: 14,    growth: 1.8,  parent: 'core',      need: 1, pos: [-1, 0] },
      { id: 'seeds',     branch: 'bounty', label: 'Tohum',           desc: '+2 bitki',                 stat: 'plantCount',     kind: 'add', per: 2,    max: 4, baseCost: 25,    growth: 2,    parent: 'bounty',    need: 1, pos: [-2, 0] },
      { id: 'combo',     branch: 'bounty', label: 'Kombo',           desc: '+0.5 sn kombo süresi',     stat: 'comboWindow',    kind: 'add', per: 0.5,  max: 4, baseCost: 60,    growth: 2.2,  parent: 'bounty',    need: 2, pos: [-2, -1] },
      { id: 'tulip',     branch: 'bounty', label: 'Lale Tarhı',      desc: 'Haritada +1 lale',         stat: 'tulipCount',     kind: 'add', per: 1,    max: 3, baseCost: 40,    growth: 2.2,  parent: 'seeds',     need: 1, pos: [-3, 1] },
      { id: 'lavender',  branch: 'bounty', label: 'Lavanta',         desc: 'Haritada +1 lavanta',      stat: 'lavenderCount',  kind: 'add', per: 1,    max: 2, baseCost: 1000,  growth: 2,    parent: 'tulip',     need: 2, pos: [-4, 1] },
      { id: 'rare',      branch: 'bounty', label: 'Gül Bahçesi',     desc: 'Haritada +1 gül',          stat: 'roseCount',      kind: 'add', per: 1,    max: 3, baseCost: 90,    growth: 2.3,  parent: 'seeds',     need: 2, pos: [-3, 0] },
      { id: 'gold',      branch: 'bounty', label: 'Altın Gül',       desc: 'Her gül +5 para',          stat: 'roseBonus',      kind: 'add', per: 5,    max: 3, baseCost: 1200,  growth: 2,    parent: 'rare',      need: 2, pos: [-3, -1] },
      { id: 'bluebell',  branch: 'bounty', label: 'Çan Çiçeği',      desc: 'Haritada +1 çan çiçeği',   stat: 'bluebellCount',  kind: 'add', per: 1,    max: 2, baseCost: 700,   growth: 2,    parent: 'rare',      need: 1, pos: [-4, 0] },
      { id: 'sunflower', branch: 'bounty', label: 'Ayçiçeği',        desc: 'Haritada +1 ayçiçeği',     stat: 'sunflowerCount', kind: 'add', per: 1,    max: 2, baseCost: 6000,  growth: 2,    parent: 'bluebell',  need: 1, pos: [-5, 0] },
      { id: 'pollen',    branch: 'bounty', label: 'Altın Polen',     desc: 'Ayçiçeği ×2 para',         stat: 'sunflowerMul',   kind: 'add', per: 1,    max: 1, baseCost: 30000, growth: 1,    parent: 'sunflower', need: 2, pos: [-5, -1] },
      { id: 'skylily',   branch: 'bounty', label: 'Gök Zambağı',     desc: 'Haritada +1 gök zambağı',  stat: 'skylilyCount',   kind: 'add', per: 1,    max: 2, baseCost: 20000, growth: 2,    parent: 'sunflower', need: 1, pos: [-6, 0] },
    ],
  };
})(window.RD = window.RD || {});
