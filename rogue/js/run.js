// Run simulation: pure logic, no DOM and no drawing. See CONTRACTS.md "RD.Run".
(function (RD) {
  'use strict';
  const C = RD.CONFIG;

  const MARGIN = 30;        // keep plants this far from the field edge
  const SPACING = 40;       // min distance between plants
  const CLOUD_CLEAR = 56;   // new seedlings avoid spawning this close to the cloud
  const CLOUD_BASE_R = 44;  // visual cloud radius when the tank is full
  const CLOUD_MIN_FRAC = 0.6;
  const CLUSTER_GAP = 26;
  const COMBO_GRACE = 0.3;  // s a plant may leave the rain and still keep its watering group (combo)   // distance between plants inside one cluster (fits under a small rain circle)

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  class Run {
    // ctx = { level: CONFIG.levels[i], flowers: { type: true } } (PRD §12); optional for old callers/tests
    constructor(stats, rules, field, ctx) {
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
      this.comboN = 0;      // growing plants under the rain this frame (HUD)
      this.bestCombo = 1;
      this.over = false;
      this.endReason = null;
      this.events = [];

      this._nextId = 1;

      // Level bar + boss (PRD §12)
      ctx = ctx || {};
      this.level = ctx.level || null;
      this.flowers = ctx.flowers || null;          // null = every flower allowed
      this.barTarget = this.level ? this.level.barTarget : 0;
      this.bloomNeed = this.level ? C.bossNeed.base * Math.pow(C.bossNeed.mul, this.level.id - 1) : 0;
      this.barPoints = 0;
      this.bar = 0;                                // 0..1
      this.boss = null;                            // see _spawnBoss
      this.bossWin = false;
      this.greenCell = C.greenCell || 32;
      // Greening gets harder every level (PRD §16): soil water needed per cell and for full lushness × greenHard^(id−1)
      const gk = this.level ? Math.pow(C.greenHard || 1, this.level.id - 1) : 1;
      this.greenNeed = (C.greenNeed || 2.5) * gk;
      this.lushSoil = (C.lushSoil || 8) * gk;
      this.greenPts = 0;                           // bar points per greened cell, fixed in _initGreen
      this._initGreen();

      this._spawnInitial(stats.plantCount);
      this._updateCloudRadius();
    }

    // Pick a random free spot; relax the constraints if the field is crowded.
    _findSpot() {
      const w = this.w, h = this.h;
      const minX = Math.min(MARGIN, w / 2), maxX = Math.max(w - MARGIN, w / 2);
      const minY = Math.min(MARGIN + 70, h / 2) /* plants grow upward: keep their heads below the top edge/HUD */, maxY = Math.max(h - MARGIN, h / 2);
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

    // Each placed plant rolls its flower chances from the highest bar down (chance = baseChance + stat, in %);
    // the first hit wins, otherwise a cactus. Only unlocked flowers (this.flowers, null = all) take part.
    _pickType() {
      const s = this.stats;
      const ok = this.flowers;
      const list = [];
      for (const type in C.plants) {
        const cfg = C.plants[type];
        if (!cfg.chanceStat || (ok && !ok[type])) continue;
        list.push({ type, cfg });
      }
      list.sort((a, b) => (b.cfg.bar || 0) - (a.cfg.bar || 0));
      for (const { type, cfg } of list) {
        if (Math.random() * 100 < (cfg.baseChance || 0) + (s[cfg.chanceStat] || 0)) return type;
      }
      return 'cactus';
    }

    // Initial field: mostly single plants. Each placed plant has stats.clusterChance % to grow a small group
    // (2-3 more plants right next to it); clusters make the combo reachable but stay a minority.
    _spawnInitial(n) {
      const chance = this.stats.clusterChance || 0;
      let left = n;
      while (left > 0) {
        const center = this._spawnPlant();
        left--;
        if (!center || !(Math.random() * 100 < chance)) continue;
        const extra = 2 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < extra && left > 0; i++, left--) this._spawnPlant(this._clusterSpot(center));
      }
    }

    // Free spot CLUSTER_GAP-ish away from a cluster center; null falls back to a random spot.
    _clusterSpot(c) {
      const minX = Math.min(MARGIN, this.w / 2), maxX = Math.max(this.w - MARGIN, this.w / 2);
      const minY = Math.min(MARGIN + 70, this.h / 2), maxY = Math.max(this.h - MARGIN, this.h / 2);
      for (let attempt = 0; attempt < 24; attempt++) {
        const a = Math.random() * Math.PI * 2, d = CLUSTER_GAP * (1 + Math.random() * 0.4);
        const x = clamp(c.x + Math.cos(a) * d, minX, maxX), y = clamp(c.y + Math.sin(a) * d, minY, maxY);
        let ok = true;
        for (const p of this.plants) if (Math.hypot(p.x - x, p.y - y) < CLUSTER_GAP * 0.9) { ok = false; break; }
        if (ok) return { x, y };
      }
      return null;
    }

    _spawnPlant(at) {
      const spot = at || this._findSpot();
      if (!spot) return null;
      const type = this._pickType();
      const plant = {
        id: this._nextId++,
        x: spot.x, y: spot.y,
        type: type,
        water: 0,
        need: Math.max(1, C.plants[type].need - (this.stats.needReduce || 0)),
        bloomsLeft: 1 + (C.plants[type].rebloom || 0),
        state: 'growing',
        age: 0,
        bloomAge: 0,
      };
      this.plants.push(plant);
      return plant;
    }

    // Adds one new growing plant mid-run (for chance cards); returns it or null
    spawnSeedling() {
      const p = this._spawnPlant();
      if (p) this.events.push({ type: 'seedling', x: p.x, y: p.y });
      return p;
    }

    _updateCloudRadius() {
      const frac = this.tank > 0 ? clamp(this.water / this.tank, 0, 1) : 0;
      this.cloud.r = CLOUD_BASE_R * (CLOUD_MIN_FRAC + (1 - CLOUD_MIN_FRAC) * frac);
    }

    _bloom(p) {
      const s = this.stats;
      const cfg = C.plants[p.type];

      // Combo is set per frame in update() from the plants under the rain
      if (this.combo > this.bestCombo) this.bestCombo = this.combo;

      // Coins: flat part first, then every multiplier (combo, Fırtına, per-flower ×, lavender's combo ×2)
      const flat = cfg.coins + s.coinBonus + (cfg.bonusStat ? s[cfg.bonusStat] : 0);
      const extraMul = (cfg.mulStat ? s[cfg.mulStat] : 1) * (cfg.comboX && this.combo > 1 ? cfg.comboX : 1);
      const gain = Math.max(1, Math.round(flat * this.combo * s.coinMul * extraMul));
      this.coins += gain;
      this.blooms++;
      if (this.level && this.bloomNeed > 0) this._addBar((1 - C.greenShare) * this.barTarget * (cfg.bar || 1) / this.bloomNeed);
      // Chance for extra run time
      if (this.timeLimit > 0 && Math.random() * 100 < (s.timeChance || 0)) {
        this.timeLimit += C.timeChanceSec;
        this.events.push({ type: 'time', x: p.x, y: p.y, sec: C.timeChanceSec });
      }
      // A bloom greens a small patch around the plant
      if (C.bloomGreen && !this.over) this._waterGround(p.x, p.y, C.bloomGreen.radius, C.bloomGreen.soil * this.greenNeed / (C.greenNeed || 2.5));
      this.water = Math.min(this.tank, this.water + s.dew + (cfg.refund || 0));

      p.bloomsLeft = (p.bloomsLeft || 1) - 1;
      const rebloom = p.bloomsLeft > 0;
      if (rebloom) {
        p.water = 0; // blooms again later (sunflower); stays on the field
      } else {
        p.state = 'bloomed';
        p.bloomAge = 0;
        p.water = p.need;
        // Tohum node: a bloom may leave a new seedling behind (pushed before the bloom event, which must stay last)
        if (s.respawnChance > 0 && !this.over && Math.random() * 100 < s.respawnChance) this.spawnSeedling();
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

      // Watering and blooming.
      // Combo = size of the watering group: every plant remembers the most plants that were under the rain together
      // with it (p.group) while it kept being watered. A slower flower watered alongside a cactus keeps the group after
      // the cactus blooms. Leaving the rain for more than COMBO_GRACE s drops the group.
      const comboOf = function (g) { return g <= 1 ? 1 : Math.min(s.comboMax, 1 + s.comboStep * (g - 1)); };
      let hudN = 0;
      if (this.raining) {
        const rr = this.rainRadius, amount = s.rainRate * dt;
        let n = 0;
        for (const p of this.plants) {
          if (p.state === 'growing' && Math.hypot(p.x - c.x, p.y - c.y) <= rr) n++;
        }
        for (const p of this.plants) {
          if (p.state !== 'growing') continue;
          if (Math.hypot(p.x - c.x, p.y - c.y) <= rr) {
            p.group = Math.max(p.group || 0, n);
            p.dryT = 0;
            if (p.group > hudN) hudN = p.group;
            p.water += amount;
            p.wet = true;
            if (p.water >= p.need) { this.combo = comboOf(p.group); this._bloom(p); }
          }
        }
      }
      for (const p of this.plants) {
        if (p.state !== 'growing' || p.wet || !p.group) continue;
        p.dryT = (p.dryT || 0) + dt;
        if (p.dryT > COMBO_GRACE) p.group = 0;
      }
      this.comboN = hudN;
      this.combo = comboOf(hudN);
      // Soil greening (level bar) and boss
      if (this.raining) this._waterGround(c.x, c.y, this.rainRadius, s.rainRate * (C.groundMul || 1) * dt);
      if (this.boss) this._updateBoss(dt);
      if (this.over) return;

      // Wilting flowers lose water while not under the rain
      for (const p of this.plants) {
        const w = C.plants[p.type].wilt;
        if (w && p.state === 'growing' && !p.wet) p.water = Math.max(0, p.water - w * dt);
        p.wet = false;
      }

      // Plant lifecycle: aging, linger removal
      for (let i = this.plants.length - 1; i >= 0; i--) {
        const p = this.plants[i];
        p.age += dt;
        if (p.state === 'bloomed') {
          p.bloomAge += dt;
          if (p.bloomAge >= C.bloomLinger) this.plants.splice(i, 1);
        }
      }
      // End conditions (water first: it is the more informative reason)
      if (this.water <= 0) {
        this.water = 0;
        this._finish('water');
      } else if (this.timeLimit > 0 && this.t >= this.timeLimit) {
        this._finish('time');
      } else if (!this.boss && !this.plants.some(function (p) { return p.state === 'growing'; })) {
        this._finish('flowers');
      }
      this._updateCloudRadius();
    }

    // ---------- level bar ----------
    _initGreen() {
      const g = this.greenCell;
      this.gw = Math.max(1, Math.ceil(this.w / g));
      this.gh = Math.max(1, Math.ceil(this.h / g));
      this.soil = new Float32Array(this.gw * this.gh);      // water soaked per cell
      this.greened = new Uint8Array(this.gw * this.gh);     // 1 once the cell counted for the bar
      this.greenCount = 0;
      this.greenPts = this.level ? C.greenShare * this.barTarget / (this.gw * this.gh) : 0;
    }

    _waterGround(x, y, r, amount) {
      const g = this.greenCell, need = this.greenNeed;
      const i0 = Math.max(0, Math.floor((x - r) / g)), i1 = Math.min(this.gw - 1, Math.floor((x + r) / g));
      const j0 = Math.max(0, Math.floor((y - r) / g)), j1 = Math.min(this.gh - 1, Math.floor((y + r) / g));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * g, cy = (j + 0.5) * g;
        if (Math.hypot(cx - x, cy - y) > r + g * 0.35) continue;
        const k = j * this.gw + i;
        this.soil[k] += amount;
        if (!this.greened[k] && this.soil[k] >= need) {
          this.greened[k] = 1;
          this.greenCount++;
          this._addBar(this.greenPts);
        }
      }
    }

    // Fraction of soil cells inside a circle that are greened (the rose boss shield)
    _greenFrac(x, y, r) {
      const g = this.greenCell;
      let n = 0, on = 0;
      for (let j = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++) {
        const cx = (i + 0.5) * g, cy = (j + 0.5) * g;
        if (Math.hypot(cx - x, cy - y) > r) continue;
        n++; if (this.greened[j * this.gw + i]) on++;
      }
      return n ? on / n : 1;
    }

    _addBar(points) {
      if (!this.level || this.boss) return;
      this.barPoints += points;
      this.bar = Math.min(1, this.barPoints / this.barTarget);
      if (this.bar >= 1) this._spawnBoss();
    }

    // ---------- boss ----------
    _spawnBoss() {
      const lv = this.level, b = lv.boss;
      const cx = this.w / 2, cy = clamp(this.h * 0.52, 120, this.h - 80);
      const boss = { kind: b.kind, type: b.type, label: b.label, hint: b.hint, x: cx, y: cy,
        parts: [], t: 0, shield: 0, shade: 0, scorched: false, done: false };
      if (b.kind === 'arms') {
        const rad = Math.min(this.w, this.h) * 0.3;
        for (let i = 0; i < b.arms; i++) {
          const a = -Math.PI / 2 + i * (Math.PI * 2 / b.arms) + 0.35;
          boss.parts.push({ x: clamp(cx + Math.cos(a) * rad, 50, this.w - 50), y: clamp(cy + Math.sin(a) * rad, 110, this.h - 50),
            water: 0, need: b.need, done: false, wet: false });
        }
      } else {
        boss.parts.push({ x: cx, y: cy, water: 0, need: b.need, done: false, wet: false });
      }
      // Clear ordinary plants that overlap the boss parts
      for (let i = this.plants.length - 1; i >= 0; i--) {
        const p = this.plants[i];
        if (boss.parts.some(function (q) { return Math.hypot(q.x - p.x, q.y - p.y) < 50; })) this.plants.splice(i, 1);
      }
      this.boss = boss;
      if (this.timeLimit > 0) this.timeLimit += lv.bossTime || 0;
      this.water = Math.min(this.tank, this.water + (lv.bossWater || 0));
      this.events.push({ type: 'bossSpawn', x: cx, y: cy, label: b.label, hint: b.hint, bossType: b.type });
    }

    _updateBoss(dt) {
      const boss = this.boss, b = this.level.boss, c = this.cloud, s = this.stats;
      boss.t += dt;
      const rr = this.rainRadius, amount = this.raining ? s.rainRate * dt : 0;
      for (const q of boss.parts) q.wet = !q.done && this.raining && Math.hypot(q.x - c.x, q.y - c.y) <= rr + 14;

      if (b.kind === 'arms') {
        for (const q of boss.parts) {
          if (q.done) continue;
          if (q.wet) {
            q.water += amount;
            // A watered arm dries the plants around it
            for (const p of this.plants) {
              if (p.state === 'growing' && Math.hypot(p.x - q.x, p.y - q.y) < b.dryRadius) p.water = Math.max(0, p.water - b.dryRate * dt);
            }
          } else {
            q.water = Math.max(0, q.water - b.wilt * dt);
          }
          if (q.water >= q.need) { q.done = true; this.events.push({ type: 'bossPart', x: q.x, y: q.y }); }
        }
      } else if (b.kind === 'shield') {
        boss.shield = this._greenFrac(boss.x, boss.y, b.shieldRadius) / b.shieldFrac;   // >= 1 means shield down
        const q = boss.parts[0];
        if (q.wet) {
          if (boss.shield >= 1) q.water += amount;
          else if (!boss._blockT || boss.t - boss._blockT > 0.8) { boss._blockT = boss.t; this.events.push({ type: 'bossBlocked', x: q.x, y: q.y }); }
        }
        if (q.water >= q.need) q.done = true;
      } else if (b.kind === 'shade') {
        const q = boss.parts[0];
        if (q.wet) boss.shade += dt; else boss.shade = Math.max(0, boss.shade - b.cool * dt);
        if (!boss.scorched && boss.shade >= b.shadeMax) { boss.scorched = true; this.events.push({ type: 'bossScorch', x: q.x, y: q.y }); }
        if (boss.scorched && boss.shade <= 0) boss.scorched = false;
        if (boss.scorched) q.water = Math.max(0, q.water - b.scorch * dt);
        else if (q.wet) q.water += amount;
        if (q.water >= q.need) q.done = true;
      }

      if (boss.parts.every(function (q) { return q.done; })) {
        boss.done = true;
        this.bossWin = true;
        const reward = Math.round((this.level.reward || 0) * (s.coinMul || 1));
        this.coins += reward;
        this.events.push({ type: 'bossWin', x: boss.x, y: boss.y, coins: reward, unlocks: this.level.unlocks });
        this.bossReward = reward;
        this.sweep = { x: boss.x, y: boss.y, r: 0, max: Math.hypot(Math.max(boss.x, this.w - boss.x), Math.max(boss.y, this.h - boss.y)) + 40,
          done: false, coins: 0, blooms: 0, hold: (C.victory && C.victory.hold) || 0.9 };
        this._finish('boss');
      }
    }

    // Boss win celebration (called by main.js every frame after a boss win, instead of update):
    // a green wave spreads from the boss; every cell it passes turns lush and every growing plant blooms (extra coins).
    victoryStep(dt) {
      const sw = this.sweep;
      this.events.length = 0;
      if (!sw || sw.done) return true;
      const prev = sw.r;
      sw.r = Math.min(sw.max, sw.r + ((C.victory && C.victory.speed) || 460) * dt);
      const g = this.greenCell, lush = this.lushSoil;
      for (let j = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++) {
        const d = Math.hypot((i + 0.5) * g - sw.x, (j + 0.5) * g - sw.y);
        if (d <= sw.r) { const k = j * this.gw + i; if (this.soil[k] < lush) this.soil[k] = lush; this.greened[k] = 1; }
      }
      for (const p of this.plants) {
        if (p.state !== 'growing') continue;
        const d = Math.hypot(p.x - sw.x, p.y - sw.y);
        if (d > prev - 1 && d <= sw.r) {
          const before = this.coins;
          p.bloomsLeft = 1;
          this._bloom(p);
          const ev = this.events[this.events.length - 1];
          if (ev && ev.type === 'bloom') ev.victory = true;
          sw.coins += this.coins - before;
          sw.blooms++;
        }
      }
      if (sw.r >= sw.max) {
        sw.hold -= dt;
        if (sw.hold <= 0) sw.done = true;
      }
      return sw.done;
    }

    _finish(reason) {
      if (this.over) return;
      this.over = true;
      this.endReason = reason;
      this.raining = false;
      this.drainRate = 0;
      // Leftover water greens extra areas for gold (not when the tank ran dry)
      this.leftoverAreas = 0;
      this.leftoverGold = 0;
      if (reason !== 'water' && this.water > 0) {
        this.leftoverAreas = Math.floor(this.water / C.leftover.waterPerArea);
        this.leftoverGold = this.leftoverAreas * (C.leftover.gold + (this.stats.leftoverGold || 0));
        this.coins += this.leftoverGold;
      }
      this.events.push({ type: 'end', reason: reason });
    }

    resize(w, h) {
      this.w = w;
      this.h = h;
      this.cloud.x = clamp(this.cloud.x, 0, w);
      this.cloud.y = clamp(this.cloud.y, 0, h);
      const minX = Math.min(MARGIN, w / 2), maxX = Math.max(w - MARGIN, w / 2);
      const minY = Math.min(MARGIN + 70, h / 2) /* plants grow upward: keep their heads below the top edge/HUD */, maxY = Math.max(h - MARGIN, h / 2);
      for (const p of this.plants) {
        p.x = clamp(p.x, minX, maxX);
        p.y = clamp(p.y, minY, maxY);
      }
      // The level-bar soil grid keeps its counts; only the grid size follows the field
      const oldW = this.gw, oldSoil = this.soil, oldG = this.greened;
      this.gw = Math.max(1, Math.ceil(w / this.greenCell));
      this.gh = Math.max(1, Math.ceil(h / this.greenCell));
      this.soil = new Float32Array(this.gw * this.gh);
      this.greened = new Uint8Array(this.gw * this.gh);
      for (let k = 0; k < oldSoil.length; k++) {
        const i = k % oldW, j = Math.floor(k / oldW);
        if (i < this.gw && j < this.gh) { this.soil[j * this.gw + i] = oldSoil[k]; this.greened[j * this.gw + i] = oldG[k]; }
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
        levelId: this.level ? this.level.id : 0,
        levelName: this.level ? this.level.name : '',
        bar: this.bar,
        bossReached: !!this.boss,
        bossWin: this.bossWin,
        unlocks: this.bossWin && this.level ? this.level.unlocks : null,
        bossReward: this.bossReward || 0,
        sweepCoins: this.sweep ? this.sweep.coins : 0,
        sweepBlooms: this.sweep ? this.sweep.blooms : 0,
        leftoverAreas: this.leftoverAreas || 0,
        leftoverGold: this.leftoverGold || 0,
      };
    }
  }

  RD.Run = Run;
})(window.RD = window.RD || {});
