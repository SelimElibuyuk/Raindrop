// Run simulation: pure logic, no DOM and no drawing. See CONTRACTS.md "RD.Run".
(function (RD) {
  'use strict';
  const C = RD.CONFIG;

  const MARGIN = 30;        // keep plants this far from the field edge
  const SPACING = 40;       // min distance between plants
  const CLOUD_CLEAR = 56;   // new seedlings avoid spawning this close to the cloud
  const CLOUD_BASE_R = 44;  // visual cloud radius when the tank is full
  const CLOUD_MIN_FRAC = 0.6;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  class Run {
    constructor(stats, rules, field) {
      this.stats = stats;
      this.rules = rules;
      this.w = field.w;
      this.h = field.h;

      this.tank = stats.tank;
      this.water = stats.tank;
      this.t = 0;
      this.timeLimit = rules.timeLimit > 0 ? rules.timeLimit : 0;
      this.drainRate = 0;
      this.raining = false;
      this.rainRadius = stats.rainRadius;

      this.cloud = { x: this.w / 2, y: this.h / 2, r: CLOUD_BASE_R };
      this.plants = [];
      this.coins = 0;
      this.blooms = 0;
      this.combo = 1;
      this.comboTimer = 0;
      this.bestCombo = 1;
      this.over = false;
      this.endReason = null;
      this.events = [];

      this._nextId = 1;
      this._respawn = [];   // seconds left until each pending seedling appears

      for (let i = 0; i < stats.plantCount; i++) this._spawnPlant();
      this._updateCloudRadius();
    }

    // Pick a random free spot; relax the constraints if the field is crowded.
    _findSpot() {
      const w = this.w, h = this.h;
      const minX = Math.min(MARGIN, w / 2), maxX = Math.max(w - MARGIN, w / 2);
      const minY = Math.min(MARGIN + 45, h / 2) /* plants grow upward: keep their heads below the top edge/HUD */, maxY = Math.max(h - MARGIN, h / 2);
      let best = null, bestScore = -Infinity;
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = minX + Math.random() * (maxX - minX);
        const y = minY + Math.random() * (maxY - minY);
        let nearest = Infinity;
        for (const p of this.plants) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < nearest) nearest = d;
        }
        const dc = Math.hypot(this.cloud.x - x, this.cloud.y - y);
        if (nearest >= SPACING && dc >= CLOUD_CLEAR) return { x, y };
        // Fallback score: prefer the most spaced-out candidate
        const score = Math.min(nearest, SPACING) + Math.min(dc, CLOUD_CLEAR);
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
      return best;
    }

    // Plants with a countStat are kept on the field by count (e.g. stats.roseCount roses);
    // otherwise pick a filler plant by its internal weight (never shown to the player).
    _pickType() {
      const s = this.stats;
      for (const type in C.plants) {
        const cfg = C.plants[type];
        if (!cfg.countStat) continue;
        let n = 0;
        for (const p of this.plants) if (p.type === type && p.state === 'growing') n++;
        if (n < (s[cfg.countStat] || 0)) return type;
      }
      let total = 0;
      for (const type in C.plants) total += C.plants[type].weight || 0;
      let r = Math.random() * total;
      for (const type in C.plants) {
        r -= C.plants[type].weight || 0;
        if (r < 0) return type;
      }
      return 'cactus';
    }

    _spawnPlant() {
      const spot = this._findSpot();
      if (!spot) return;
      const type = this._pickType();
      this.plants.push({
        id: this._nextId++,
        x: spot.x, y: spot.y,
        type: type,
        water: 0,
        need: Math.max(1, C.plants[type].need - (this.stats.needReduce || 0)),
        bloomsLeft: 1 + (C.plants[type].rebloom || 0),
        state: 'growing',
        age: 0,
        bloomAge: 0,
      });
    }

    _updateCloudRadius() {
      const frac = this.tank > 0 ? clamp(this.water / this.tank, 0, 1) : 0;
      this.cloud.r = CLOUD_BASE_R * (CLOUD_MIN_FRAC + (1 - CLOUD_MIN_FRAC) * frac);
    }

    _bloom(p) {
      const s = this.stats;
      const cfg = C.plants[p.type];

      // Combo multiplier: ×1 = no chain, +comboStep per bloom inside the window
      if (this.comboTimer > 0) this.combo = Math.min(s.comboMax, this.combo + s.comboStep);
      else this.combo = 1;
      this.comboTimer = s.comboWindow;
      if (this.combo > this.bestCombo) this.bestCombo = this.combo;

      // Coins: flat part first, then every multiplier (combo, Fırtına, per-flower ×, lavender's combo ×2)
      const flat = cfg.coins + s.coinBonus + (cfg.bonusStat ? s[cfg.bonusStat] : 0);
      const extraMul = (cfg.mulStat ? s[cfg.mulStat] : 1) * (cfg.comboX && this.combo > 1 ? cfg.comboX : 1);
      const gain = Math.max(1, Math.round(flat * this.combo * s.coinMul * extraMul));
      this.coins += gain;
      this.blooms++;
      this.water = Math.min(this.tank, this.water + s.dew + (cfg.refund || 0));

      p.bloomsLeft = (p.bloomsLeft || 1) - 1;
      const rebloom = p.bloomsLeft > 0;
      if (rebloom) {
        p.water = 0; // blooms again later (sunflower); stays on the field
      } else {
        p.state = 'bloomed';
        p.bloomAge = 0;
        p.water = p.need;
        this._respawn.push(C.respawnDelay);
      }
      this.events.push({ type: 'bloom', x: p.x, y: p.y, coins: gain, combo: this.combo, plantType: p.type,
        mul: extraMul > 1 ? extraMul : 0, refund: cfg.refund || 0, rebloom: rebloom });
    }

    update(dt, input) {
      this.events.length = 0;
      if (this.over) return;
      const s = this.stats, r = this.rules;
      const inp = input || {};

      // Cloud follows the pointer at most cloudSpeed px/s
      const c = this.cloud;
      if (typeof inp.x === 'number' && typeof inp.y === 'number') {
        const dx = inp.x - c.x, dy = inp.y - c.y;
        const d = Math.hypot(dx, dy);
        const step = s.cloudSpeed * dt;
        if (d <= step || d === 0) { c.x = inp.x; c.y = inp.y; }
        else { c.x += dx / d * step; c.y += dy / d * step; }
      }
      c.x = clamp(c.x, 0, this.w);
      c.y = clamp(c.y, 0, this.h);

      this.t += dt;
      this.raining = !!inp.raining && this.water > 0;

      // Water loss
      let drain = r.passiveDrain + r.evapRamp * Math.max(0, this.t - r.rampDelay);
      if (this.raining) drain += r.rainCost; // flat: rain strength does not change the cost
      this.drainRate = drain;
      this.water -= drain * dt;

      // Watering and blooming
      if (this.raining) {
        const rr = this.rainRadius, amount = s.rainRate * dt;
        for (const p of this.plants) {
          if (p.state !== 'growing') continue;
          if (Math.hypot(p.x - c.x, p.y - c.y) <= rr) {
            p.water += amount;
            p.wet = true;
            if (p.water >= p.need) this._bloom(p);
          }
        }
      }
      // Wilting flowers lose water while not under the rain
      for (const p of this.plants) {
        const w = C.plants[p.type].wilt;
        if (w && p.state === 'growing' && !p.wet) p.water = Math.max(0, p.water - w * dt);
        p.wet = false;
      }

      // Plant lifecycle: aging, linger removal, respawn
      for (let i = this.plants.length - 1; i >= 0; i--) {
        const p = this.plants[i];
        p.age += dt;
        if (p.state === 'bloomed') {
          p.bloomAge += dt;
          if (p.bloomAge >= C.bloomLinger) this.plants.splice(i, 1);
        }
      }
      for (let i = this._respawn.length - 1; i >= 0; i--) {
        this._respawn[i] -= dt;
        if (this._respawn[i] <= 0) {
          this._respawn.splice(i, 1);
          this._spawnPlant();
        }
      }

      // Combo window
      if (this.comboTimer > 0) {
        this.comboTimer = Math.max(0, this.comboTimer - dt);
        if (this.comboTimer === 0) this.combo = 1;
      }

      // End conditions (water first: it is the more informative reason)
      if (this.water <= 0) {
        this.water = 0;
        this._finish('water');
      } else if (this.timeLimit > 0 && this.t >= this.timeLimit) {
        this._finish('time');
      }
      this._updateCloudRadius();
    }

    _finish(reason) {
      this.over = true;
      this.endReason = reason;
      this.raining = false;
      this.drainRate = 0;
      this.events.push({ type: 'end', reason: reason });
    }

    resize(w, h) {
      this.w = w;
      this.h = h;
      this.cloud.x = clamp(this.cloud.x, 0, w);
      this.cloud.y = clamp(this.cloud.y, 0, h);
      const minX = Math.min(MARGIN, w / 2), maxX = Math.max(w - MARGIN, w / 2);
      const minY = Math.min(MARGIN + 45, h / 2) /* plants grow upward: keep their heads below the top edge/HUD */, maxY = Math.max(h - MARGIN, h / 2);
      for (const p of this.plants) {
        p.x = clamp(p.x, minX, maxX);
        p.y = clamp(p.y, minY, maxY);
      }
    }

    result() {
      return {
        coins: this.coins,
        blooms: this.blooms,
        bestCombo: this.bestCombo,
        duration: this.t,
        endReason: this.endReason,
        mode: this.rules.mode,
      };
    }
  }

  RD.Run = Run;
})(window.RD = window.RD || {});
