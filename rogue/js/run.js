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
      this.drops = [];      // falling big drops (render draws them); see _updateDrops
      this.dropT = 0;       // s since the last drop spawn (only counts while raining)
      this.goldens = 0;     // blooms of golden plants
      this.splashes = [];   // water blobs flying from a bloom to a nearby flower (render draws them); see _updateSplashes
      this.minis = [];      // mini clouds { x, y, target, ang } that water plants on their own; see _updateMinis
      this.shower = null;   // sudden shower { x, y, r, t, phase: 'warn' | 'rain' } or null; see _updateShower
      this.showerT = 0;     // s since the last shower ended

      this._nextId = 1;

      // Level bar + boss (PRD §12)
      ctx = ctx || {};
      this.level = ctx.level || null;
      this.flowers = ctx.flowers || null;          // null = every flower allowed
      this.barTarget = this.level ? this.level.barTarget : 0;
      this.bloomNeedBase = this.level ? C.bossNeed.base * Math.pow(C.bossNeed.mul, this.level.id - 1) : 0;
      // Growing-garden stages (PRD §19, CONTRACTS t)
      const SG = C.stages;
      this.stage = 1;
      this.stageCount = this.level && SG ? SG.count : 1;
      this.zoom = null;              // { t, dur, stage } while the zoom-out pause plays (update() is frozen)
      this._stageUpPending = false;  // set by _addBar, applied at the end of update()
      this.bloomNeed = this._stageNeed();
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
      this._linkPlants();
      for (let i = 0; i < (stats.miniClouds || 0); i++) {
        this.minis.push({ x: this.w * (i + 1) / (stats.miniClouds + 1), y: MARGIN + Math.random() * Math.max(1, this.h - 2 * MARGIN),
          target: null, ang: Math.random() * Math.PI * 2 });
      }
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
      // Later stages plant better flowers: every allowed flower gets +chanceBonus % per stage after the first
      const bonus = C.stages && this.stage > 1 ? C.stages.chanceBonus * (this.stage - 1) : 0;
      for (const { type, cfg } of list) {
        if (Math.random() * 100 < (cfg.baseChance || 0) + (s[cfg.chanceStat] || 0) + bonus) return type;
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

    // Linked flowers: each unlinked plant rolls stats.linkChance; on a hit it pairs with a random unlinked plant at least
    // C.link.minDist away (none -> no link). Links are stored as partner ids (p.link); later seedlings are never linked.
    _linkPlants() {
      const chance = this.stats.linkChance || 0;
      if (!(chance > 0)) return;
      const minD = C.link.minDist;
      for (const p of this.plants) {
        if (p.link || !(Math.random() * 100 < chance)) continue;
        const cands = this.plants.filter(function (q) {
          return q !== p && !q.link && Math.hypot(q.x - p.x, q.y - p.y) >= minD;
        });
        if (!cands.length) continue;
        const q = cands[Math.floor(Math.random() * cands.length)];
        p.link = q.id;
        q.link = p.id;
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
        golden: Math.random() * 100 < (this.stats.goldChance || 0),
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
      // Golden flowers pay goldMul x
      const extraMulG = extraMul * (p.golden ? (s.goldMul || 1) : 1);
      const gain = Math.max(1, Math.round(flat * this.combo * s.coinMul * extraMulG));
      this.coins += gain;
      this.blooms++;
      if (p.golden) this.goldens++;
      if (this.level && this.bloomNeed > 0) this._addBar((1 - C.greenShare) * this.barTarget * (cfg.bar || 1) / this.bloomNeed);
      // Chance for extra run time
      if (this.timeLimit > 0 && Math.random() * 100 < (s.timeChance || 0)) {
        this.timeLimit += C.timeChanceSec;
        this.events.push({ type: 'time', x: p.x, y: p.y, sec: C.timeChanceSec });
      }
      // A bloom greens a small patch around the plant
      if (C.bloomGreen && !this.over) this._waterGround(p.x, p.y, C.bloomGreen.radius, C.bloomGreen.soil * this.greenNeed / (C.greenNeed || 2.5));
      this.water = Math.min(this.tank, this.water + s.dew + (cfg.refund || 0));

      // Splash: a bloom may throw water at the nearest other growing flowers (flyers pushed before the bloom event)
      if (s.splashChance > 0 && !this.over && Math.random() * 100 < s.splashChance) {
        const n = C.splash.count + (s.splashCount || 0);
        const amount = s.rainRate * (C.splash.sec + (s.splashSec || 0));
        const near = [];
        for (const q of this.plants) {
          if (q !== p && q.state === 'growing') near.push({ q: q, d: Math.hypot(q.x - p.x, q.y - p.y) });
        }
        near.sort(function (a, b) { return a.d - b.d; });
        for (let i = 0; i < n && i < near.length; i++) {
          const q = near[i].q;
          this.splashes.push({ sx: p.x, sy: p.y, x: q.x, y: q.y, t: 0, fly: C.splash.fly, target: q, amount: amount });
        }
      }

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
        mul: extraMul > 1 ? extraMul : 0, refund: cfg.refund || 0, rebloom: rebloom, golden: !!p.golden });
    }

    update(dt, input) {
      this.events.length = 0;
      if (this.over) return;
      // Zoom-out pause between stages: the whole simulation (timer included) waits
      if (this.zoom) {
        this.zoom.t += dt;
        if (this.zoom.t >= this.zoom.dur) this.zoom = null;
        return;
      }
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

      // Per-frame water flags, set again below (render reads them after update)
      for (const p of this.plants) { p.linkWet = false; p.miniWet = false; p.moist = false; p.showerWet = false; p.miniAmt = 0; }
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
      // Mini clouds water on their own (also while the player is not raining); they run before the link block
      // so that p.miniWet / p.miniAmt are known there.
      this._updateMinis(dt);
      // Linked flowers: a plant watered by the player rain or a mini cloud this frame passes the same amount to its
      // growing partner. Links never count for the combo and leave the partner's group untouched.
      {
        const rainAmount = s.rainRate * dt;
        const wetNow = this.plants.filter(function (p) { return (p.wet || p.miniWet) && p.link; });
        for (const p of wetNow) {
          const q = this.plants.find(function (o) { return o.id === p.link; });
          if (!q || q.state !== 'growing' || q.wet || q.miniWet) continue;
          q.water += p.wet ? rainAmount : p.miniAmt;
          q.linkWet = true;
          if (q.water >= q.need) { this.combo = 1; this._bloom(q); }
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
      this._updateDrops(dt, comboOf);
      this._updateSplashes(dt);
      this._updateMoist(dt);
      this._updateShower(dt);
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
      if (this._stageUpPending) { this._stageUp(); this._updateCloudRadius(); return; }
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

    // Big drops: while raining one drop spawns every interval and falls onto a random growing plant / unfinished
    // boss part under the rain (or a random point in the rain circle). On landing it may crit: a lump of water.
    _updateDrops(dt, comboOf) {
      const s = this.stats, c = this.cloud, B = C.bigDrop;
      // Land the falling drops first (also while not raining; the ones in the air finish)
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        d.t += dt;
        if (d.t < d.fall) continue;
        this.drops.splice(i, 1);
        const tg = d.target;
        let hit = false, crit = false;
        if (tg) {
          const valid = tg.part ? this._partOpen(tg.part) : tg.plant.state === 'growing';
          if (valid) {
            hit = true;
            crit = Math.random() * 100 < (s.critChance || 0);
            if (crit) {
              const amount = s.rainRate * (B.critSec + (s.critSec || 0));
              if (tg.plant) {
                const p = tg.plant;
                p.water += amount;
                if (p.water >= p.need) { this.combo = comboOf(p.group || 1); this._bloom(p); }
              } else {
                tg.part.water += amount;   // completion is checked by _updateBoss
              }
            }
          }
        }
        this.events.push({ type: 'drop', x: d.x, y: d.y, hit: hit, crit: crit });
      }
      if (this.over) return;
      if (!this.raining || !B) { this.dropT = 0; return; }
      this.dropT += dt;
      const interval = Math.max(B.minInterval, B.interval - B.step * (s.dropRate || 0));
      if (this.dropT < interval) return;
      this.dropT = 0;
      const rr = this.rainRadius;
      const cands = [];
      for (const p of this.plants) {
        if (p.state === 'growing' && Math.hypot(p.x - c.x, p.y - c.y) <= rr) cands.push({ plant: p, x: p.x, y: p.y });
      }
      if (this.boss) {
        for (const q of this.boss.parts) {
          if (this._partOpen(q) && Math.hypot(q.x - c.x, q.y - c.y) <= rr + 14) cands.push({ part: q, x: q.x, y: q.y });
        }
      }
      let target = null, x, y;
      if (cands.length) {
        target = cands[Math.floor(Math.random() * cands.length)];
        x = target.x; y = target.y;
      } else {
        const a = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * rr;
        x = c.x + Math.cos(a) * rad; y = c.y + Math.sin(a) * rad;
      }
      this.drops.push({ sx: c.x, sy: c.y, x: x, y: y, t: 0, fall: B.fall, target: target, crit: false });
    }

    // Splash flyers: fly for `fly` s, then water the target if it is still growing (may bloom it, which can chain).
    // Runs every frame, also while not raining. Flyers pushed by a landing bloom start flying next frame.
    _updateSplashes(dt) {
      for (let i = this.splashes.length - 1; i >= 0; i--) {
        const f = this.splashes[i];
        f.t += dt;
        if (f.t < f.fly) continue;
        this.splashes.splice(i, 1);
        const q = f.target;
        const hit = !!q && q.state === 'growing';
        if (hit) {
          q.water += f.amount;
          if (q.water >= q.need) { this.combo = 1; this._bloom(q); }
        }
        this.events.push({ type: 'splash', x: f.x, y: f.y, hit: hit });
      }
    }

    // Mini clouds: each chases the nearest growing plant no other mini targets and waters everything under it.
    // Blooms they cause use combo 1 and leave the plant's group untouched.
    _updateMinis(dt) {
      if (this.over || !this.minis.length) return;
      const s = this.stats, M = C.mini;
      const speed = (M.speed + M.speedStep * (s.miniSpeed || 0)) * dt;
      const amount = (s.rainRate * M.rateMul + (s.miniRate || 0)) * dt;
      for (const m of this.minis) {
        if (!m.target || m.target.state !== 'growing') m.target = null;
        if (!m.target) {
          const taken = this.minis.map(function (o) { return o.target; });
          let best = null, bd = Infinity;
          for (const p of this.plants) {
            if (p.state !== 'growing' || taken.indexOf(p) >= 0) continue;
            const d = Math.hypot(p.x - m.x, p.y - m.y);
            if (d < bd) { bd = d; best = p; }
          }
          m.target = best;
        }
        if (m.target) {
          const dx = m.target.x - m.x, dy = m.target.y - m.y, d = Math.hypot(dx, dy);
          if (d <= speed || d === 0) { m.x = m.target.x; m.y = m.target.y; }
          else { m.x += dx / d * speed; m.y += dy / d * speed; }
        } else {
          // No target: drift slowly
          m.ang += (Math.random() - 0.5) * 2 * dt;
          m.x += Math.cos(m.ang) * speed * 0.3;
          m.y += Math.sin(m.ang) * speed * 0.3;
        }
        m.x = clamp(m.x, 0, this.w);
        m.y = clamp(m.y, 0, this.h);
        for (const p of this.plants.slice()) {
          if (p.state !== 'growing' || Math.hypot(p.x - m.x, p.y - m.y) > M.r) continue;
          p.water += amount;
          p.miniWet = true;
          p.miniAmt = Math.max(p.miniAmt || 0, amount);
          if (p.water >= p.need) { this.combo = 1; this._bloom(p); }
        }
        this._waterGround(m.x, m.y, M.r, amount * (C.groundMul || 1));
        if (this.over) return;
      }
    }

    // Moist soil: growing plants on a greened cell that got no other water this frame drink on their own.
    _updateMoist(dt) {
      const s = this.stats;
      if (this.over || !(s.moistOn > 0)) return;
      const amount = (C.moist.rate + C.moist.step * (s.moistRate || 0)) * dt;
      const g = this.greenCell;
      for (const p of this.plants.slice()) {
        if (p.state !== 'growing' || p.wet || p.miniWet) continue;
        const i = Math.min(this.gw - 1, Math.max(0, Math.floor(p.x / g))), j = Math.min(this.gh - 1, Math.max(0, Math.floor(p.y / g)));
        if (!this.greened[j * this.gw + i]) continue;
        p.moist = true;
        p.water += amount;
        if (p.water >= p.need) { this.combo = 1; this._bloom(p); }
      }
    }

    // Sudden shower: after the interval it appears over a random growing plant, warns, rains, then ends.
    _updateShower(dt) {
      const s = this.stats, S = C.shower;
      if (this.over || !(s.showerOn > 0)) return;
      if (!this.shower) {
        this.showerT += dt;
        const interval = Math.max(S.minInterval, S.interval - S.step * (s.showerFreq || 0));
        if (this.showerT < interval) return;
        const grow = this.plants.filter(function (p) { return p.state === 'growing'; });
        const r = S.r + S.rStep * (s.showerSize || 0);
        let x, y;
        if (grow.length) {
          // Off-centre so it looks random, but the chosen plant stays well inside the circle
          const p = grow[Math.floor(Math.random() * grow.length)];
          const a = Math.random() * Math.PI * 2, d = r * (0.25 + 0.3 * Math.random());
          x = clamp(p.x + Math.cos(a) * d, 0, this.w); y = clamp(p.y + Math.sin(a) * d, 0, this.h);
        } else { x = Math.random() * this.w; y = Math.random() * this.h; }
        this.shower = { x: x, y: y, r: r, t: 0, phase: 'warn' };
        return;
      }
      const sh = this.shower;
      sh.t += dt;
      if (sh.phase === 'warn') {
        if (sh.t < S.warn) return;
        sh.phase = 'rain';
        sh.t = 0;
        this.events.push({ type: 'shower', x: sh.x, y: sh.y, r: sh.r });
        return;
      }
      const amount = S.rate * dt;
      for (const p of this.plants.slice()) {
        if (p.state !== 'growing' || Math.hypot(p.x - sh.x, p.y - sh.y) > sh.r) continue;
        p.water += amount;
        p.showerWet = true;
        if (p.water >= p.need) { this.combo = 1; this._bloom(p); }
      }
      if (!this.over) this._waterGround(sh.x, sh.y, sh.r, amount * (C.groundMul || 1));
      if (sh.t >= S.dur) { this.shower = null; this.showerT = 0; }
    }

    // A boss part that still takes water from a crit drop (same rules as normal rain in _updateBoss)
    _partOpen(q) {
      const boss = this.boss;
      if (!boss || q.done) return false;
      const kind = this.level.boss.kind;
      if (kind === 'shield') return boss.shield >= 1;
      if (kind === 'shade') return !boss.scorched;
      return true;
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
      if (!this.level || this.boss || this._stageUpPending) return;
      this.barPoints += points;
      this.bar = Math.min(1, this.barPoints / this.barTarget);
      if (this.bar < 1) return;
      // Full bar: next stage (applied at the end of this update so no loop sees a half-swapped field), or the boss
      if (this.stage < this.stageCount) this._stageUpPending = true;
      else this._spawnBoss();
    }

    // Bloom points needed to fill the bar in the current stage
    _stageNeed() {
      const m = C.stages && C.stages.needMul ? (C.stages.needMul[this.stage - 1] || C.stages.needMul[C.stages.needMul.length - 1]) : 1;
      return this.bloomNeedBase * m;
    }

    // Stage up (PRD §19): the field keeps its size. Old plants and in-flight effects are cleared, the greened soil
    // shrinks into a central core (it does not count for the new bar), a fresh set of plants is placed with better
    // flower chances, the bar restarts with a higher need and some time is added. Water carries over.
    // Pushes { type: 'stage', stage, of, shrink } and starts the zoom pause (this.zoom) during which update() is frozen.
    _stageUp() {
      const SG = C.stages, k = SG.shrink;
      this._stageUpPending = false;
      this.stage++;
      this.plants = [];
      this.drops.length = 0;
      this.splashes.length = 0;
      this.shower = null;
      this.showerT = 0;
      this.dropT = 0;
      for (const m of this.minis) m.target = null;
      this.combo = 1;
      this.comboN = 0;
      // Shrink the soil grid around the field centre: new cell -> old position (x − cx) / k + cx
      const g = this.greenCell, gw = this.gw, gh = this.gh, cx = this.w / 2, cy = this.h / 2;
      const oldSoil = this.soil, oldG = this.greened;
      this.soil = new Float32Array(gw * gh);
      this.greened = new Uint8Array(gw * gh);
      this.greenCount = 0;
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        // Old area folding into this cell starts at the cell's top-left edge mapped back (1/k old cells per axis)
        const ox = (i * g - cx) / k + cx + 0.01, oy = (j * g - cy) / k + cy + 0.01;
        const oi = Math.floor(ox / g), oj = Math.floor(oy / g);
        if (oi < 0 || oj < 0 || oi >= gw || oj >= gh) continue;
        // Keep the strongest soil of the old cells that fold into this one (1/k old cells per axis)
        let best = 0, green = 0;
        const span = Math.max(1, Math.round(1 / k));
        for (let dj = 0; dj < span; dj++) for (let di = 0; di < span; di++) {
          const ii = Math.min(gw - 1, oi + di), jj = Math.min(gh - 1, oj + dj), ok = jj * gw + ii;
          if (oldSoil[ok] > best) best = oldSoil[ok];
          if (oldG[ok]) green = 1;
        }
        const nk = j * gw + i;
        this.soil[nk] = best;
        if (green) { this.greened[nk] = 1; this.greenCount++; }
      }
      // The core is free: the bar's green share is spread over the cells still dry
      const free = Math.max(1, gw * gh - this.greenCount);
      this.greenPts = C.greenShare * this.barTarget / free;
      this.barPoints = 0;
      this.bar = 0;
      this.bloomNeed = this._stageNeed();
      if (this.timeLimit > 0) this.timeLimit += SG.timeAdd || 0;
      this._spawnInitial(this.stats.plantCount);
      this._linkPlants();
      this.zoom = { t: 0, dur: SG.pause || 1.5, stage: this.stage };
      this.events.push({ type: 'stage', stage: this.stage, of: this.stageCount, shrink: k, time: SG.timeAdd || 0 });
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
      for (const m of this.minis) { m.x = clamp(m.x, 0, w); m.y = clamp(m.y, 0, h); }
      if (this.shower) { this.shower.x = clamp(this.shower.x, 0, w); this.shower.y = clamp(this.shower.y, 0, h); }
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
        stage: this.stage,
        stageCount: this.stageCount,
        bossWin: this.bossWin,
        unlocks: this.bossWin && this.level ? this.level.unlocks : null,
        bossReward: this.bossReward || 0,
        sweepCoins: this.sweep ? this.sweep.coins : 0,
        sweepBlooms: this.sweep ? this.sweep.blooms : 0,
        leftoverAreas: this.leftoverAreas || 0,
        leftoverGold: this.leftoverGold || 0,
        golden: this.goldens,
      };
    }
  }

  RD.Run = Run;
})(window.RD = window.RD || {});
