// Persistent meta-progression: coins, upgrade levels, stats and debug settings (localStorage).
(function (RD) {
  'use strict';
  const C = RD.CONFIG;

  function defaultData() {
    return { coins: 0, levels: {}, stats: { runs: 0, bestCoins: 0, totalBlooms: 0, totalCoins: 0 } };
  }
  function defaultSettings() {
    return { mode: 'timer', preset: null, overrides: {} };
  }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  function upgradeById(id) {
    for (let i = 0; i < C.upgrades.length; i++) if (C.upgrades[i].id === id) return C.upgrades[i];
    return null;
  }

  const Meta = {
    data: defaultData(),
    settings: defaultSettings(),

    load: function () {
      const d = defaultData();
      const s = defaultSettings();
      try {
        const raw = localStorage.getItem(C.saveKey);
        if (raw) {
          const o = JSON.parse(raw);
          if (o && typeof o === 'object') {
            d.coins = Math.max(0, Math.floor(num(o.coins, 0)));
            if (o.levels && typeof o.levels === 'object') {
              C.upgrades.forEach(function (u) {
                if (u.kind === 'root') return;
                const lv = Math.floor(num(o.levels[u.id], 0));
                if (lv > 0) d.levels[u.id] = Math.min(lv, u.max);
              });
            }
            if (o.stats && typeof o.stats === 'object') {
              for (const k in d.stats) d.stats[k] = num(o.stats[k], 0);
            }
          }
        }
      } catch (e) { /* corrupt or unavailable storage: keep defaults */ }
      try {
        const raw = localStorage.getItem(C.saveKey + '-settings');
        if (raw) {
          const o = JSON.parse(raw);
          if (o && typeof o === 'object') {
            if (C.modes[o.mode]) s.mode = o.mode;
            if (o.preset && C.drainPresets[o.preset]) s.preset = o.preset;
            if (o.overrides && typeof o.overrides === 'object') {
              for (const k in o.overrides) {
                if (typeof o.overrides[k] === 'number' && isFinite(o.overrides[k])) s.overrides[k] = o.overrides[k];
              }
            }
          }
        }
      } catch (e) { /* keep defaults */ }
      Meta.data = d;
      Meta.settings = s;
    },

    save: function () {
      try {
        localStorage.setItem(C.saveKey, JSON.stringify(Meta.data));
        localStorage.setItem(C.saveKey + '-settings', JSON.stringify(Meta.settings));
      } catch (e) { /* storage unavailable: play on without persistence */ }
    },

    // Wipes progress but keeps debug settings.
    reset: function () {
      Meta.data = defaultData();
      Meta.save();
    },

    levelOf: function (id) {
      const u = upgradeById(id);
      if (u && u.kind === 'root') return 1; // the root node is always owned
      return Meta.data.levels[id] || 0;
    },

    upgradeById: upgradeById,

    // Tree visibility: a node shows once its parent has level >= 1 (root is always visible).
    isVisible: function (id) {
      const u = upgradeById(id);
      if (!u) return false;
      if (!u.parent) return true;
      return Meta.levelOf(u.parent) >= 1;
    },

    // 'owned' (level>0, not max) | 'maxed' | 'available' (buyable once affordable) | 'locked' (visible, parent level too low) | 'hidden'
    nodeState: function (id) {
      const u = upgradeById(id);
      if (!u || !Meta.isVisible(id)) return 'hidden';
      const lv = Meta.levelOf(id);
      if (lv >= u.max) return 'maxed';
      if (!Meta.isUnlocked(id)) return 'locked';
      return lv > 0 ? 'owned' : 'available';
    },

    // TOTAL bonus at the given level.
    upgradeEffect: function (id, level) {
      const u = upgradeById(id);
      if (!u || level <= 0) return 0;
      if (u.kind === 'table') {
        let sum = 0;
        for (let i = 0; i < level && i < u.table.length; i++) sum += u.table[i];
        return sum;
      }
      return u.per * level; // 'add' and 'mul'
    },

    costOf: function (id) {
      const u = upgradeById(id);
      if (!u) return null;
      const lv = Meta.levelOf(id);
      if (lv >= u.max) return null;
      return Math.ceil(u.baseCost * Math.pow(u.growth, lv));
    },

    isUnlocked: function (id) {
      const u = upgradeById(id);
      if (!u) return false;
      if (!u.parent) return true;
      return Meta.levelOf(u.parent) >= (u.need || 1);
    },

    canBuy: function (id) {
      const cost = Meta.costOf(id);
      return cost !== null && Meta.isUnlocked(id) && Meta.data.coins >= cost;
    },

    buy: function (id) {
      if (!Meta.canBuy(id)) return false;
      Meta.data.coins -= Meta.costOf(id);
      Meta.data.levels[id] = Meta.levelOf(id) + 1;
      Meta.save();
      return true;
    },

    addCoins: function (n) {
      Meta.data.coins += Math.max(0, Math.floor(n || 0));
    },

    recordRun: function (result) {
      const st = Meta.data.stats;
      st.runs += 1;
      st.bestCoins = Math.max(st.bestCoins, result.coins || 0);
      st.totalBlooms += result.blooms || 0;
      st.totalCoins += result.coins || 0;
    },
  };
  RD.Meta = Meta;

  // Base stats with every upgrade applied. 'mul' upgrades scale the base: base * (1 + effect).
  RD.computeStats = function (levels) {
    const s = Object.assign({}, C.base);
    levels = levels || {};
    C.upgrades.forEach(function (u) {
      if (u.kind === 'root') return;
      const lv = Math.min(levels[u.id] || 0, u.max);
      if (lv <= 0) return;
      const eff = Meta.upgradeEffect(u.id, lv);
      if (u.kind === 'mul') s[u.stat] = s[u.stat] * (1 + eff);
      else s[u.stat] = s[u.stat] + eff;
    });
    return s;
  };
})(window.RD = window.RD || {});
