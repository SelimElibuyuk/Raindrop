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
      rainRate: 2,         // "Yağmur şiddeti": water/s to EACH plant under the rain
      cloudSpeed: 4,       // level; px/s = cloudSpeed * speedPx (main.js)
      coinBonus: 0,        // extra coins on every bloom
      roseBonus: 0,        // extra coins on every rose
      coinMul: 1,          // NEW: global coin multiplier (×), Fırtına branch
      sunflowerMul: 1,     // NEW: sunflower coin multiplier (×), Altın Polen
      plantCount: 10,      // plants placed at run start (all cactus unless a flower chance rolls); no respawn (PRD §14)
      respawnChance: 0,    // % per bloom that a new seedling appears (Filizlenme node under Tohum, max 7.5)
      clusterChance: 0,    // % per placed plant to grow a small group (2-3 more) around it; clusters feed the combo
      // % chance (tree nodes) that a placed plant becomes this flower; added to plants[type].baseChance (PRD §15)
      daisyChance: 0,
      tulipChance: 0,
      lavenderChance: 0,
      bluebellChance: 0,
      roseChance: 0,
      sunflowerChance: 0,
      skylilyChance: 0,
      needReduce: 0,       // NEW: water need removed from every plant (min 1)
      comboStep: 0.25,     // combo × gained per extra plant watered at the same time (PRD §14)
      comboMax: 3,         // NEW (was CONFIG.combo.max)
      dew: 0,              // water refunded per bloom
      timeBonus: 0,        // s, Mevsim branch (max +10)
      timeChance: 0,       // % chance that a bloom adds timeChanceSec to the run timer
      leftoverGold: 0,     // extra gold per greened area from leftover water (base pay is CONFIG.leftover.gold)
      drainReduce: 0,      // su/sn removed from passive drain
      rainCostReduce: 0,   // su/sn removed from rain cost
    },
    speedPx: 65,

    // Run-limit systems (PRD §4). A run starts with a copy of the active mode, then debug overrides.
    modes: {
      timer: {
        label: 'Süre + Su',
        baseTime: 30,       // s; run ends at baseTime + timeBonus (+ bloom time chances)
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

    // chanceStat: stats key with the % chance (tree) that a placed plant becomes this flower; baseChance: % granted as
    // soon as the flower is unlocked (boss reward). Rolls go from the highest `bar` down; no hit = cactus (PRD §15).
    // bar: level-bar progress points per bloom (every tier above the previous one).
    // bonusStat: flat coins added for this type. mulStat: × for this type.
    // comboX: × when bloomed while combo > 1. refund: su back on bloom. rebloom: extra blooms. wilt: su/s lost when not rained on.
    plants: {
      cactus:    { bar: 1, label: 'Kaktüs',      need: 3,  coins: 1,  color: '#7a9e6a', bloom: '#f2c14e' },
      daisy:     { bar: 2, chanceStat: 'daisyChance', baseChance: 0, label: 'Papatya',     need: 5,  coins: 3,  color: '#8cb488', bloom: '#f3ede2' },
      tulip:     { bar: 3, chanceStat: 'tulipChance', baseChance: 10, label: 'Lale',        need: 7,  coins: 5,  color: '#6f9e6a', bloom: '#e07a4f' },
      lavender:  { bar: 4, chanceStat: 'lavenderChance', baseChance: 0, label: 'Lavanta',     need: 5,  coins: 3,  color: '#7f9c86', bloom: '#a58ad0', comboX: 2 },
      bluebell:  { bar: 5, chanceStat: 'bluebellChance', baseChance: 0, label: 'Çan Çiçeği',  need: 7,  coins: 2,  color: '#6e9a7a', bloom: '#6f93d6', refund: 5 },
      rose:      { bar: 6, chanceStat: 'roseChance', baseChance: 10, label: 'Gül',         need: 10, coins: 8,  color: '#6a9a66', bloom: '#d65c7a', bonusStat: 'roseBonus' },
      sunflower: { bar: 7, chanceStat: 'sunflowerChance', baseChance: 10, label: 'Ayçiçeği',    need: 12, coins: 7,  color: '#78a05e', bloom: '#e9b23c', mulStat: 'sunflowerMul', rebloom: 1 },
      skylily:   { bar: 10, chanceStat: 'skylilyChance', baseChance: 0, label: 'Gök Zambağı', need: 28, coins: 30, color: '#5f8e86', bloom: '#4d5fa8', wilt: 3 },
    },
    // Levels (PRD §12, §14). Greening soil and blooms fill the level bar (see greenShare / bossNeed).
    // A full bar summons the boss (bonus water/time). Watering the boss through its trick clears the level,
    // ends the run as a win, pays `reward` and unlocks `unlocks` (a flower) + the next level.
    startFlowers: ['cactus', 'daisy'],
    greenCell: 32,        // px; soil grid used for the level bar
    greenNeed: 2,         // soil water a cell needs to count as greened (bar +1)
    groundMul: 0.5,       // soil gets rainRate × groundMul per second → stronger rain greens faster
    lushSoil: 8,          // soil water at which a cell is fully lush (render grass level = soil / lushSoil)
    // Level bar split (PRD §14): greening the WHOLE field is worth greenShare × barTarget; the rest comes from
    // blooms, each worth (1 − greenShare) × barTarget × plants[type].bar / bossNeed(level). Not a cap: points are scaled.
    greenShare: 0.3,
    greenHard: 1.7,       // greenNeed and lushSoil × greenHard^(level − 1): level 2 needs 1.7× water, level 3 2.9× (PRD §16)
    // Flower points (plants[].bar) needed for the bloom part of the bar: base × mul^(level − 1) → 15, 30, 60 (PRD §15)
    bossNeed: { base: 15, mul: 2 },
    timeChanceSec: 1,     // s added when a bloom rolls stats.timeChance
    leftover: { waterPerArea: 5, gold: 1 },  // run end: every waterPerArea su left greens one area → gold (+ stats.leftoverGold)
    bloomGreen: { radius: 44, soil: 6 },   // a bloom soaks/greens a small patch around the plant
    victory: { speed: 460, hold: 0.9 },    // boss win: green wave from the boss outward (px/s), then hold (s)
    levels: [
      { id: 1, name: 'Çatlak Vadi', barTarget: 110, bossTime: 8, bossWater: 40, reward: 30, unlocks: 'tulip',
        boss: { kind: 'arms', type: 'tulip', label: 'Lale Kraliçesi', arms: 3, need: 10, wilt: 1.5, dryRadius: 80, dryRate: 4,
          hint: '3 kolu da sula! Sulanmayan kol kurur.' } },
      { id: 2, name: 'Dikenli Bayır', barTarget: 380, bossTime: 9, bossWater: 50, reward: 70, unlocks: 'rose',
        boss: { kind: 'shield', type: 'rose', label: 'Gül Ana', need: 70, shieldRadius: 130, shieldFrac: 0.8,
          hint: 'Önce çevresini yeşert, dikenler çekilsin.' } },
      { id: 3, name: 'Güneş Tepesi', barTarget: 480, bossTime: 10, bossWater: 60, reward: 140, unlocks: 'sunflower',
        boss: { kind: 'shade', type: 'sunflower', label: 'Dev Ayçiçeği', need: 75, shadeMax: 1.3, cool: 0.9, scorch: 8,
          hint: 'Üstünde fazla kalma! Gölgede solar.' } },
    ],

    bloomLinger: 0.6,        // s a bloomed flower stays visible

    // Skill tree (PRD §6). Each node: parent (id), need (parent level required to unlock, default 1),
    // pos [col, row] in tree grid units (root at 0,0; up = negative row). A node is visible once its
    // parent has level >= 1, and buyable once the parent has level >= need. The root is always owned.
    // effect(level) is the TOTAL bonus: 'add' => per*level. All upgrades are flat 'add' (no percentages).
    // Optional `gate: <levelId>`: the node cannot be bought until that level's boss is beaten (Meta.gateOpen).
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
      { id: 'sundial',   branch: 'time',   label: 'Güneş Saati',     desc: 'Çiçek açınca %5 ihtimalle +1 sn', stat: 'timeChance', kind: 'add', per: 5, max: 4, baseCost: 120, growth: 2.2, parent: 'time1', need: 1, pos: [1, 1] },
      { id: 'time1',     branch: 'time',   label: 'İlkbahar',        desc: '+1 sn run süresi',         stat: 'timeBonus',      kind: 'add', per: 1,    max: 3, baseCost: 150,   growth: 2.5,  parent: 'core',      need: 1, pos: [0, 1] },
      { id: 'time2',     branch: 'time',   label: 'Yaz',             desc: '+2 sn run süresi',         stat: 'timeBonus',      kind: 'add', per: 2,    max: 2, baseCost: 6000,  growth: 2.5,  parent: 'time1',     need: 3, pos: [0, 2] },
      { id: 'time3',     branch: 'time',   label: 'Uzun Yaz',        desc: '+3 sn run süresi',         stat: 'timeBonus',      kind: 'add', per: 3,    max: 1, baseCost: 40000, growth: 1,    parent: 'time2',     need: 2, pos: [0, 3] },

      // Wind / movement (down-left)
      { id: 'wind',      branch: 'wind',   label: 'Rüzgar',          desc: '+1 hız',                   stat: 'cloudSpeed',     kind: 'add', per: 1,    max: 4, baseCost: 10,    growth: 1.7,  parent: 'core',      need: 1, pos: [-1, 1] },
      { id: 'gust',      branch: 'wind',   label: 'Fırtına Rüzgarı', desc: '+2 hız',                   stat: 'cloudSpeed',     kind: 'add', per: 2,    max: 2, baseCost: 400,   growth: 2.5,  parent: 'wind',      need: 3, pos: [-2, 2] },
      { id: 'windseed',  branch: 'wind',   label: 'Tohum Rüzgarı',   desc: '+5 bitki',                 stat: 'plantCount',     kind: 'add', per: 5,    max: 2, baseCost: 3000,  growth: 2,    parent: 'wind',      need: 2, pos: [-1, 2] },

      // Bounty + flowers (left): every flower unlock lives here
      { id: 'bounty',    branch: 'bounty', label: 'Bereket',         desc: 'Her çiçek +1 para',        stat: 'coinBonus',      kind: 'add', per: 1,    max: 5, baseCost: 14,    growth: 1.8,  parent: 'core',      need: 1, pos: [-1, 0] },
      { id: 'seeds',     branch: 'bounty', label: 'Tohum',           desc: '+5 bitki',                 stat: 'plantCount',     kind: 'add', per: 5,    max: 5, baseCost: 25,    growth: 2,    parent: 'bounty',    need: 1, pos: [-2, 0] },
      { id: 'puddle',    branch: 'bounty', label: 'Birikinti',       desc: 'Kalan su: alan başına +1 altın', stat: 'leftoverGold', kind: 'add', per: 1, max: 2, baseCost: 60,    growth: 3,    parent: 'bounty',    need: 2, pos: [-2, -1] },
      { id: 'sprout',    branch: 'bounty', label: 'Filizlenme',      desc: 'Açan çiçek +%1.5 ihtimalle yeni fidan bırakır', stat: 'respawnChance', kind: 'add', per: 1.5, max: 5, baseCost: 60, growth: 2.2, parent: 'seeds', need: 1, pos: [-2, 1] },
      { id: 'cluster',   branch: 'bounty', label: 'Tohum Kümesi',    desc: 'Küme ihtimali +%5',        stat: 'clusterChance',  kind: 'add', per: 5,    max: 3, baseCost: 80,    growth: 2.5,  parent: 'sprout',    need: 1, pos: [-3, 2] },
      { id: 'daisy',     branch: 'bounty', label: 'Papatya Tarhı',   desc: 'Papatya ihtimali +%10', stat: 'daisyChance', kind: 'add', per: 10, max: 3, baseCost: 30, growth: 2, parent: 'bounty', need: 1, pos: [-1, -1] },
      { id: 'tulip',     branch: 'bounty', label: 'Lale Tarhı',      desc: 'Lale ihtimali +%10', stat: 'tulipChance', kind: 'add', per: 10, max: 3, baseCost: 40,    growth: 2.2,  parent: 'seeds',     need: 1, pos: [-3, 1] },
      { id: 'lavender',  branch: 'bounty', label: 'Lavanta',         desc: 'Lavanta ihtimali +%10', stat: 'lavenderChance', kind: 'add', per: 10, max: 2, baseCost: 1000,  growth: 2,    parent: 'tulip',     need: 2, pos: [-4, 1] },
      { id: 'rare',      branch: 'bounty', label: 'Gül Bahçesi',     desc: 'Gül ihtimali +%10', stat: 'roseChance', kind: 'add', per: 10, max: 3, baseCost: 90,    growth: 2.3,  parent: 'seeds',     need: 2, pos: [-3, 0] },
      { id: 'gold',      branch: 'bounty', label: 'Altın Gül',       desc: 'Her gül +5 para',          stat: 'roseBonus',      kind: 'add', per: 5,    max: 3, baseCost: 1200,  growth: 2,    parent: 'rare',      need: 2, pos: [-3, -1] },
      { id: 'bluebell',  branch: 'bounty', label: 'Çan Çiçeği',      desc: 'Çan çiçeği ihtimali +%10', stat: 'bluebellChance', kind: 'add', per: 10, max: 2, baseCost: 700,   growth: 2,    parent: 'rare',      need: 1, pos: [-4, 0] },
      { id: 'sunflower', branch: 'bounty', label: 'Ayçiçeği',        desc: 'Ayçiçeği ihtimali +%10', stat: 'sunflowerChance', kind: 'add', per: 10, max: 2, baseCost: 6000,  growth: 2,    parent: 'rare',      need: 1, pos: [-5, 0] },
      { id: 'pollen',    branch: 'bounty', label: 'Altın Polen',     desc: 'Ayçiçeği ×2 para',         stat: 'sunflowerMul',   kind: 'add', per: 1,    max: 1, baseCost: 30000, growth: 1,    parent: 'sunflower', need: 2, pos: [-5, -1] },
      { id: 'skylily',   branch: 'bounty', label: 'Gök Zambağı',     desc: 'Gök zambağı ihtimali +%10', stat: 'skylilyChance', kind: 'add', per: 10, max: 2, baseCost: 20000, growth: 2,    parent: 'sunflower', need: 1, pos: [-6, 0] },
    ],
  };
})(window.RD = window.RD || {});
