// Canvas rendering only. See CONTRACTS.md "RD.Render".
// Art style: flat vector (flat fills, no outlines, two tones per part), matching RD.Flora.
// The scenery painters (ground, wet soil, cloud, rain) are pure functions of their arguments and are
// also exposed as RD.Render.art so flora-preview.html draws exactly the same look.
(function (RD) {
  'use strict';
  const C = RD.CONFIG;

  const CELL = 14;             // wetness grid cell size, CSS px
  const WET_GAIN = 1.6;        // wetness per second while rained on
  const WET_DECAY = 0.035;     // wetness lost per second (slow fade)
  const SOAK_PER_WET = 0.09;   // grass tint gained per unit of rain on soaked soil (~7 s of rain to full)
  const SOAK_DECAY = 0.004;    // grass tint lost per second (lingers for the rest of the run)
  // The logical cloud point is where the rain lands. The cloud itself floats high above it,
  // so the plant being watered stays visible; a ground shadow + ring mark the target.
  function cloudLift() { return clamp(H * 0.16, 105, 130); } // tallest flower (62px) + cloud underside stays clear
  const MAX_PARTICLES = 160;
  const MAX_POPUPS = 40;
  const MAX_SPLASHES = 48;

  // Palette: calm dusk tones, no neon
  const P = {
    // ground
    sand: '#bea67f', sandL: '#c5ae89', sandD: '#b8a07b', sandDD: '#b29a75',
    crack: '#927858', crackLip: '#cdb793',
    pebble: '#9c8769', pebbleL: '#b9a586',
    tuft: '#a5a064', tuftD: '#88884f',
    grain: '#a68d69',
    // wet soil: damp brown-olive, turning grassy where it was soaked for long
    damp: [122, 114, 78], grass: [118, 140, 86],
    // cloud: full (0) -> empty (1)
    cloudL0: '#f5f1ea', cloudL1: '#a9adba',
    cloudS0: '#c9cbd8', cloudS1: '#7b8193',
    cloudH0: '#ffffff', cloudH1: '#c2c6d0',
    // rain
    rainA: 'rgba(214,230,246,0.9)', rainB: 'rgba(146,182,224,0.9)', splash: '#dcebf7',
    ring: 'rgba(240,244,250,0.28)',
    coin: '#f7e3a1', coinEdge: 'rgba(60,44,28,0.75)',
  };

  let canvas = null, ctx = null, parent = null;
  let dpr = 1, W = 800, H = 600;
  let ground = null;           // offscreen flat-vector ground canvas (device px)
  let wetL = null;             // wet soil layer (see createWet)
  let particles = [], popups = [], drops = [], splashes = [];
  let lastRun = null;
  let clock = 0;

  // ---------- helpers ----------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  const rgbCache = {};
  function rgb(hex) {
    let c = rgbCache[hex];
    if (!c) {
      const n = parseInt(hex.slice(1), 16);
      c = rgbCache[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return c;
  }
  // Quantized hex mix, cached (the cloud asks for a few of these every frame).
  const mixCache = {};
  function mix(a, b, t) {
    const q = Math.round(clamp(t, 0, 1) * 32);
    const k = a + b + q;
    let s = mixCache[k];
    if (!s) {
      const x = rgb(a), y = rgb(b), f = q / 32;
      s = mixCache[k] = 'rgb(' + Math.round(x[0] + (y[0] - x[0]) * f) + ',' + Math.round(x[1] + (y[1] - x[1]) * f) + ',' + Math.round(x[2] + (y[2] - x[2]) * f) + ')';
    }
    return s;
  }
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  // ---------- ground (flat vector dry land, painted once per resize) ----------
  // Closed soft blob through n jittered points (quadratic curves through the edge midpoints).
  function blob(g, rand, x, y, rx, ry, n) {
    const px = [], py = [];
    const rot = rand() * 6.283;
    for (let i = 0; i < n; i++) {
      const a = rot + i * 6.283 / n, k = 0.78 + rand() * 0.34;
      px.push(x + Math.cos(a) * rx * k);
      py.push(y + Math.sin(a) * ry * k);
    }
    g.moveTo((px[n - 1] + px[0]) / 2, (py[n - 1] + py[0]) / 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      g.quadraticCurveTo(px[i], py[i], (px[i] + px[j]) / 2, (py[i] + py[j]) / 2);
    }
    g.closePath();
  }
  // Stylised crack: an angular polyline turned into a tapered flat polygon (widest in the middle).
  function crackShape(g, xs, ys, wmax) {
    const n = xs.length, lx = [], ly = [], rx = [], ry = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let dx = xs[b] - xs[a], dy = ys[b] - ys[a];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      const f = i / (n - 1), w = wmax * Math.sin(f * Math.PI) + 0.15;
      lx.push(xs[i] - dy * w); ly.push(ys[i] + dx * w);
      rx.push(xs[i] + dy * w); ry.push(ys[i] - dx * w);
    }
    g.moveTo(lx[0], ly[0]);
    for (let i = 1; i < n; i++) g.lineTo(lx[i], ly[i]);
    for (let i = n - 1; i >= 0; i--) g.lineTo(rx[i], ry[i]);
    g.closePath();
  }
  function crackPoints(rand, x, y, ang, segs, seg) {
    const xs = [x], ys = [y];
    for (let i = 0; i < segs; i++) {
      ang += (rand() - 0.5) * 1.1;
      x += Math.cos(ang) * seg * (0.7 + rand() * 0.6);
      y += Math.sin(ang) * seg * (0.7 + rand() * 0.6);
      xs.push(x); ys.push(y);
    }
    return { xs: xs, ys: ys, ang: ang };
  }

  // Paints the dry field onto g (already scaled to CSS px), w x h CSS px.
  function paintGround(g, w, h, seed) {
    const rand = rng(seed == null ? 1337 : seed);
    const area = w * h;
    g.fillStyle = P.sand;
    g.fillRect(0, 0, w, h);

    // Large soft tonal patches: lighter first, then a few darker ones (flat fills, low contrast)
    const nL = Math.round(area / 26000) + 5, nD = Math.round(area / 46000) + 3;
    g.fillStyle = P.sandL;
    g.beginPath();
    for (let i = 0; i < nL; i++) { const r = 50 + rand() * 120; blob(g, rand, rand() * w, rand() * h, r, r * (0.55 + rand() * 0.25), 7); }
    g.fill();
    g.fillStyle = P.sandD;
    g.beginPath();
    for (let i = 0; i < nD; i++) { const r = 40 + rand() * 100; blob(g, rand, rand() * w, rand() * h, r, r * (0.5 + rand() * 0.25), 7); }
    g.fill();
    g.fillStyle = P.sandDD;
    g.beginPath();
    for (let i = 0; i < Math.round(nD * 0.5); i++) { const r = 18 + rand() * 30; blob(g, rand, rand() * w, rand() * h, r, r * 0.55, 6); }
    g.fill();

    // Sand grains: sparse tiny dots
    g.fillStyle = P.grain;
    const grains = Math.round(area / 1600);
    for (let i = 0; i < grains; i++) g.fillRect(rand() * w, rand() * h, 1.3, 1.3);

    // Cracks: a few angular tapered shapes with a light lip below (two-tone), some with one branch
    const nC = Math.round(area / 42000) + 4;
    const cracks = [];
    for (let i = 0; i < nC; i++) {
      const c = crackPoints(rand, rand() * w, rand() * h, rand() * 6.283, 3 + Math.floor(rand() * 3), 14 + rand() * 10);
      cracks.push({ xs: c.xs, ys: c.ys, wd: 1.6 + rand() * 0.9 });
      if (rand() < 0.6) {
        const k = 1 + Math.floor(rand() * (c.xs.length - 2));
        const b = crackPoints(rand, c.xs[k], c.ys[k], c.ang + (rand() < 0.5 ? 1 : -1) * (0.9 + rand() * 0.5), 2, 10 + rand() * 6);
        cracks.push({ xs: b.xs, ys: b.ys, wd: 1.1 });
      }
    }
    g.fillStyle = P.crackLip;
    g.beginPath();
    for (let i = 0; i < cracks.length; i++) {
      const c = cracks[i];
      g.save(); g.translate(0.6, 1.3); crackShape(g, c.xs, c.ys, c.wd); g.restore();
    }
    g.fill();
    g.fillStyle = P.crack;
    g.beginPath();
    for (let i = 0; i < cracks.length; i++) crackShape(g, cracks[i].xs, cracks[i].ys, cracks[i].wd);
    g.fill();

    // Pebbles: dark body, lighter top-left face; sometimes in small groups
    const nP = Math.round(area / 9000) + 6;
    const pb = [];
    for (let i = 0; i < nP; i++) {
      const x = rand() * w, y = rand() * h, m = rand() < 0.3 ? 3 : 1;
      for (let j = 0; j < m; j++) {
        const r = 1.4 + rand() * (j ? 1.6 : 2.6);
        pb.push(x + (rand() - 0.5) * 10 * j, y + (rand() - 0.5) * 6 * j, r);
      }
    }
    g.fillStyle = P.pebble;
    g.beginPath();
    for (let i = 0; i < pb.length; i += 3) { g.moveTo(pb[i] + pb[i + 2], pb[i + 1]); g.ellipse(pb[i], pb[i + 1], pb[i + 2], pb[i + 2] * 0.72, 0, 0, 6.283); }
    g.fill();
    g.fillStyle = P.pebbleL;
    g.beginPath();
    for (let i = 0; i < pb.length; i += 3) {
      const r = pb[i + 2] * 0.7, x = pb[i] - pb[i + 2] * 0.22, y = pb[i + 1] - pb[i + 2] * 0.2;
      g.moveTo(x + r, y); g.ellipse(x, y, r, r * 0.62, 0, 0, 6.283);
    }
    g.fill();

    // Dry grass tufts: a few thin pointed blades, alternating two straw-olive tones
    const nT = Math.round(area / 20000) + 4;
    const bl = [[], []];
    for (let i = 0; i < nT; i++) {
      const x = rand() * w, y = rand() * h, n = 3 + Math.floor(rand() * 3), s = 0.8 + rand() * 0.5;
      for (let j = 0; j < n; j++) {
        const f = n === 1 ? 0 : j / (n - 1) - 0.5;
        bl[j & 1].push(x + f * 4 * s, y, f * 1.3 + (rand() - 0.5) * 0.25, (5 + rand() * 4) * s * (1 - Math.abs(f) * 0.6));
      }
    }
    for (let t = 0; t < 2; t++) {
      g.fillStyle = t ? P.tuftD : P.tuft;
      g.beginPath();
      const b = bl[t];
      for (let i = 0; i < b.length; i += 4) {
        const x = b[i], y = b[i + 1], a = b[i + 2], len = b[i + 3];
        const dx = Math.sin(a), dy = -Math.cos(a);
        g.moveTo(x - 1, y);
        g.quadraticCurveTo(x + dx * len * 0.5 - 0.6, y + dy * len * 0.5, x + dx * len, y + dy * len);
        g.quadraticCurveTo(x + dx * len * 0.5 + 0.6, y + dy * len * 0.5, x + 1, y);
        g.closePath();
      }
      g.fill();
    }

    // Very soft edge vignette (dusk), painted once
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.max(w, h) * 0.78);
    vg.addColorStop(0, 'rgba(40,30,50,0)');
    vg.addColorStop(1, 'rgba(40,30,50,0.2)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  }

  function buildGround() {
    ground = document.createElement('canvas');
    ground.width = Math.max(1, Math.round(W * dpr));
    ground.height = Math.max(1, Math.round(H * dpr));
    const g = ground.getContext('2d');
    g.scale(dpr, dpr);
    paintGround(g, W, H, 1337);
  }

  // ---------- wet soil (low-res grid, drawn scaled with smoothing) ----------
  // wet: 0..1 dampness (fades slowly); soak: 0..1 grass tint from long watering (fades very slowly).
  function createWet(w, h, cell) {
    cell = cell || CELL;
    const gw = Math.max(1, Math.ceil(w / cell)), gh = Math.max(1, Math.ceil(h / cell));
    const cv = document.createElement('canvas');
    cv.width = gw; cv.height = gh;
    const g = cv.getContext('2d');
    return { cell: cell, gw: gw, gh: gh, wet: new Float32Array(gw * gh), soak: new Float32Array(gw * gh), cv: cv, g: g, img: g.createImageData(gw, gh) };
  }
  // Adds wetness (and slowly grass tint) in a disc, softer toward the rim so the patch has no hard edge.
  function wetDisc(L, cx, cy, rr, amount) {
    const cell = L.cell, gw = L.gw, gh = L.gh, wet = L.wet, soak = L.soak;
    const x0 = Math.max(0, Math.floor((cx - rr) / cell)), x1 = Math.min(gw - 1, Math.floor((cx + rr) / cell));
    const y0 = Math.max(0, Math.floor((cy - rr) / cell)), y1 = Math.min(gh - 1, Math.floor((cy + rr) / cell));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d = Math.hypot((i + 0.5) * cell - cx, (j + 0.5) * cell - cy);
        if (d <= rr + cell * 0.5) {
          const k = j * gw + i;
          // Wetness rises toward a radial cap, so even a long soak keeps a round, soft rim
          const R = rr + cell * 0.5, cap = Math.min(1, 1.6 * (1 - (d / R) * (d / R)));
          if (wet[k] < cap) wet[k] = Math.min(cap, wet[k] + amount * (1 - 0.5 * d / (rr + cell)));
          // Grass tint grows on soaked soil toward a radial cap (full at the centre, none at the rim),
          // so long watering leaves a round, soft-edged patch instead of a blocky one
          const f = 1 - (d / rr) * (d / rr);
          if (f > 0 && wet[k] > 0.5 && soak[k] < f) soak[k] = Math.min(f, soak[k] + amount * SOAK_PER_WET);
        }
      }
    }
  }
  // Decays the grid by dt, writes the pixels and draws the layer onto g. Returns false if nothing to draw.
  function drawWet(g, L, dt) {
    const wet = L.wet, soak = L.soak, data = L.img.data;
    const d0 = P.damp, g0 = P.grass;
    const gw = L.gw, n = wet.length;
    let any = false;
    // Pass 1: both fade over time (the grass tint only once the soil has dried a bit)
    for (let k = 0; k < n; k++) {
      let v = wet[k], s = soak[k];
      if (v <= 0 && s <= 0) continue;
      any = true;
      if (s > 0 && v < 0.5) s = Math.max(0, s - SOAK_DECAY * dt);
      if (v > 0) v = Math.max(0, v - WET_DECAY * dt);
      wet[k] = v; soak[k] = s;
    }
    if (!any) return false;
    // Pass 2: pixels from a 5-tap average (rounds off the grid's blocky corners)
    for (let k = 0; k < n; k++) {
      const x = k % gw, l = x > 0 ? k - 1 : k, r = x < gw - 1 ? k + 1 : k;
      const u = k >= gw ? k - gw : k, d = k + gw < n ? k + gw : k;
      const v = (wet[k] * 2 + wet[l] + wet[r] + wet[u] + wet[d]) / 6;
      const s = (soak[k] * 2 + soak[l] + soak[r] + soak[u] + soak[d]) / 6;
      if (v <= 0.001 && s <= 0.001) { data[k * 4 + 3] = 0; continue; }
      // Flat-ish damp patch: alpha rises quickly to a plateau, the smoothing upscale gives soft edges
      const aw = smooth01(v / 0.45) * 0.5;
      const t = smooth01(s), ag = t * 0.34;
      const o = k * 4;
      data[o] = d0[0] + (g0[0] - d0[0]) * t;
      data[o + 1] = d0[1] + (g0[1] - d0[1]) * t;
      data[o + 2] = d0[2] + (g0[2] - d0[2]) * t;
      data[o + 3] = Math.round((aw > ag ? aw : ag) * 255);
    }
    L.g.putImageData(L.img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(L.cv, 0, 0, L.gw * L.cell, L.gh * L.cell);
    return true;
  }

  function buildWet() { wetL = createWet(W, H, CELL); }

  function updateWet(dt, run) {
    if (run && run.raining) wetDisc(wetL, run.cloud.x, run.cloud.y, run.rainRadius, WET_GAIN * dt);
    drawWet(ctx, wetL, dt);
  }

  // ---------- plants (flat vector flowers from RD.Flora) ----------
  // Full plant height in px per type (taller flowers stand out a bit more).
  const PLANT_SIZE = { cactus: 40, daisy: 46, tulip: 50, lavender: 52, bluebell: 48, rose: 52, sunflower: 62, skylily: 62 };
  const BLOOM_OPEN = 0.3;       // s: petals open after a bloom, then the flower fades over CONFIG.bloomLinger
  const REB_OPEN = 0.25, REB_HOLD = 0.2, REB_CLOSE = 0.3;   // s: rebloom pop (sunflower)
  const REGROW_FLOOR = 0.6;     // after a rebloom the stem stays full; only the head regrows
  const SPAWN_POP = 0.35;       // s: new seedlings fade in

  // Per-plant visual state by plant id. Bloomed plants are removed by Run after bloomLinger, which is
  // shorter than open + fade, so the record keeps drawing them ("ghost") until the fade ends.
  const recs = new Map();
  const drawList = [];
  const floraOpts = { size: 50, growth: 0, bloom: 0, fade: 1, wilt: 0, sway: 0, seed: 0 };

  function inRain(p, run) {
    return !!(run && run.raining && Math.hypot(p.x - run.cloud.x, p.y - run.cloud.y) <= run.rainRadius);
  }

  function updatePlants(dt, run) {
    for (const r of recs.values()) r.seen = false;
    for (let i = 0; i < run.plants.length; i++) {
      const p = run.plants[i];
      let r = recs.get(p.id);
      if (!r) { r = { p: p, seen: true, bloomT: -1, reb: -1, regrow: false, peak: 0, wilt: 0, wet: false }; recs.set(p.id, r); }
      r.p = p;
      r.seen = true;
      r.wet = inRain(p, run);
      if (p.state === 'bloomed') r.bloomT = p.bloomAge;
      if (r.reb >= 0) { r.reb += dt; if (r.reb >= REB_OPEN + REB_HOLD + REB_CLOSE) r.reb = -1; }
      // Thirsty flowers (CONFIG wilt) droop as they lose water outside the rain; eased so the
      // rain-circle edge does not flicker.
      if (C.plants[p.type].wilt && p.state === 'growing') {
        if (r.wet || p.water > r.peak) r.peak = p.water;
        const target = r.wet ? 0 : clamp((r.peak - p.water) / p.need * 2.5, 0, 1);
        r.wilt += (target - r.wilt) * Math.min(1, dt * 4);
      } else {
        r.wilt += (0 - r.wilt) * Math.min(1, dt * 4);
      }
    }
    // Ghosts: bloomed plants already removed by Run keep opening/fading on their own clock.
    for (const [id, r] of recs) {
      if (r.seen) continue;
      if (r.bloomT >= 0 && r.bloomT < BLOOM_OPEN + C.bloomLinger) r.bloomT += dt;
      else recs.delete(id);
    }
  }

  // Rebloom events carry the plant's exact position; find the plant to play its pop.
  function startRebloom(e, run) {
    for (let i = 0; i < run.plants.length; i++) {
      const p = run.plants[i];
      if (p.x === e.x && p.y === e.y && p.type === e.plantType) {
        const r = recs.get(p.id);
        if (r) { r.reb = 0; r.regrow = true; }
        return;
      }
    }
  }

  function drawPlant(r) {
    const p = r.p;
    let growth, bloom = 0, fade = 1;
    if (r.bloomT >= 0) {
      growth = 1;
      bloom = clamp(r.bloomT / BLOOM_OPEN, 0, 1);
      const f = clamp((r.bloomT - BLOOM_OPEN) / C.bloomLinger, 0, 1);
      fade = 1 - f * f;
      if (fade <= 0.01) return;
    } else {
      const f = clamp(p.water / p.need, 0, 1);
      growth = r.regrow ? REGROW_FLOOR + (1 - REGROW_FLOOR) * f : f;
      if (r.reb >= 0) {
        const t = r.reb;
        if (t < REB_OPEN + REB_HOLD) { bloom = clamp(t / REB_OPEN, 0, 1); growth = 1; }
        else { const k = clamp((t - REB_OPEN - REB_HOLD) / REB_CLOSE, 0, 1); bloom = 1 - k; growth = 1 + (growth - 1) * k; }
      }
      const s0 = clamp(p.age / SPAWN_POP, 0, 1);
      fade = 1 - (1 - s0) * (1 - s0);
    }
    const w = r.wilt;
    // Gentle sway, slower and smaller when wilted; a light shiver while being rained on
    let sway = Math.sin(clock * (1.7 - 0.9 * w) + p.id * 1.37) * 0.035 * (1 - 0.5 * w);
    if (r.wet) sway += Math.sin(clock * 9 + p.id) * 0.02;
    const o = floraOpts;
    o.size = PLANT_SIZE[p.type] || 50;
    o.growth = growth; o.bloom = bloom; o.fade = fade; o.wilt = w; o.sway = sway; o.seed = p.id;
    if (RD.Flora) RD.Flora.draw(ctx, p.type, p.x, p.y, o);

    if (r.wet && r.bloomT < 0 && r.reb < 0 && growth > 0.01 && growth < 1) {
      // Small, subtle progress ring under the plant while it is being watered
      const g = clamp(p.water / p.need, 0, 1);
      const ry = p.y + 7, rr = 3.6;
      ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(30,24,36,0.22)';
      ctx.beginPath(); ctx.arc(p.x, ry, rr, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(169,214,245,0.85)';
      ctx.beginPath(); ctx.arc(p.x, ry, rr, -Math.PI / 2, -Math.PI / 2 + g * Math.PI * 2); ctx.stroke();
    }
  }

  function drawPlants() {
    drawList.length = 0;
    for (const r of recs.values()) drawList.push(r);
    drawList.sort(function (a, b) { return a.p.y - b.p.y; });
    for (let i = 0; i < drawList.length; i++) drawPlant(drawList[i]);
  }

  // ---------- cloud (flat vector: light lobes over a flat lower shade band, small crescent highlight) ----------
  // Lobes [dx, dy, r] in units of the cloud radius; the base capsule gives the flat underside.
  const LOBES = [[-0.6, 0.04, 0.38], [-0.18, -0.22, 0.5], [0.3, -0.14, 0.45], [0.68, 0.08, 0.32], [-0.86, 0.2, 0.24]];
  const BASE_X = 0.9, BASE_Y = 0.24, BASE_H = 0.26;   // capsule half-width, centre y, half-height
  const LIFT = 0.11;                                   // light layer sits this much higher -> shade band
  const CLOUD_BOTTOM = BASE_Y + BASE_H;                // underside, in units of r below the centre

  function cloudPath(g, x, y, r, t, wob, up, k) {
    // Capsule base
    const bx = (BASE_X - (1 - k) * 0.5) * r, by = y + (BASE_Y - up) * r, bh = BASE_H * r * k;
    g.moveTo(x - bx, by - bh);
    g.lineTo(x + bx, by - bh);
    g.arc(x + bx, by, bh, -Math.PI / 2, Math.PI / 2);
    g.lineTo(x - bx, by + bh);
    g.arc(x - bx, by, bh, Math.PI / 2, Math.PI * 1.5);
    g.closePath();
    for (let i = 0; i < LOBES.length; i++) {
      const q = LOBES[i], s = 1 + Math.sin(t * 2.2 + i * 1.7) * wob;
      const lx = x + q[0] * r, ly = y + (q[1] - up) * r, lr = q[2] * r * s * k;
      g.moveTo(lx + lr, ly);
      g.arc(lx, ly, lr, 0, 6.283);
    }
  }

  // (x, y) = where the cloud is drawn (its centre); r = radius; low 0 (full) .. 1 (empty) greys it;
  // t = time in s for the breathing wobble.
  function drawCloudArt(g, x, y, r, low, wob, t) {
    low = clamp(low, 0, 1);
    const k = 1 + Math.sin(t * 1.3) * wob * 0.5;    // gentle breathing
    const light = mix(P.cloudL0, P.cloudL1, low * 0.85);
    const shade = mix(P.cloudS0, P.cloudS1, low * 0.85);
    // Shade silhouette, then the light layer lifted so a flat band of shade stays at the bottom
    g.fillStyle = shade;
    g.beginPath(); cloudPath(g, x, y, r * k, t, wob, 0, 1); g.fill();
    g.fillStyle = light;
    g.beginPath(); cloudPath(g, x, y, r * k, t, wob, LIFT, 0.97); g.fill();
    // Crescent highlight on the big top lobe (fades as the cloud greys)
    if (low < 0.95) {
      const q = LOBES[1], s = 1 + Math.sin(t * 2.2 + 1.7) * wob, R = r * k;
      const lx = x + q[0] * R, ly = y + (q[1] - LIFT) * R, lr = q[2] * R * s * 0.97;
      g.fillStyle = mix(P.cloudH0, P.cloudH1, low);
      g.beginPath(); g.arc(lx - lr * 0.2, ly - lr * 0.2, lr * 0.6, 0, 6.283); g.fill();
      g.fillStyle = light;
      g.beginPath(); g.arc(lx - lr * 0.06, ly - lr * 0.06, lr * 0.6, 0, 6.283); g.fill();
    }
  }

  function cloudDrawY(y, r) { return Math.max(r * 0.75, y - cloudLift()); }

  function drawCloud(x, y, r, lowFrac, wobble) {
    drawCloudArt(ctx, x, cloudDrawY(y, r), r, lowFrac, wobble, clock);
  }

  // Soft shadow on the ground under the rain target + dashed rain-area ring (drawn before plants).
  function drawTarget(g, x, y, rr, raining) {
    g.fillStyle = 'rgba(30,24,36,0.16)';
    g.beginPath(); g.ellipse(x, y, rr * 1.05, rr * 0.62, 0, 0, 7); g.fill();
    // Rain-area ring on the ground: brighter while raining
    g.strokeStyle = P.ring;
    g.globalAlpha = raining ? 1 : 0.7;
    g.lineWidth = 1.5;
    g.setLineDash([5, 6]);
    g.beginPath(); g.arc(x, y, rr, 0, 7); g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  // ---------- rain (flat capsule streaks in two blues + splash rings) ----------
  // drops: array kept by the caller; (cx, cy) ground target, rr radius, top = y where streaks start
  // (just above the cloud's underside so the cloud hides where they emerge). onHit(x, y) per landing.
  function stepRain(g, drops, dt, cx, cy, rr, top, onHit) {
    const want = clamp(Math.round(rr * 0.8), 18, 110);
    while (drops.length < want) drops.push({ a: Math.random() * 6.283, d: Math.sqrt(Math.random()), p: Math.random() });
    drops.length = want;
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      // pass 0: pale long streaks, pass 1: deeper blue short ones
      g.strokeStyle = pass ? P.rainB : P.rainA;
      g.lineWidth = pass ? 2 : 2.3;
      const len = pass ? 7 : 11;
      g.beginPath();
      for (let i = pass; i < drops.length; i += 2) {
        const dr = drops[i];
        dr.p += dt * 3.2;
        if (dr.p >= 1) {
          dr.p -= 1;
          if (onHit) onHit(cx + Math.cos(dr.a) * dr.d * rr, cy + Math.sin(dr.a) * dr.d * rr);
          dr.a = Math.random() * 6.283;
          dr.d = Math.sqrt(Math.random());
        }
        const gx = cx + Math.cos(dr.a) * dr.d * rr;
        const gy = cy + Math.sin(dr.a) * dr.d * rr;
        // Streak travels from the cloud's underside down to its ground point
        const py = top + (gy - top) * dr.p;
        g.moveTo(gx, py - len);
        g.lineTo(gx, py - 0.5);
      }
      g.stroke();
    }
  }

  // Flat splash rings (flattened ellipses that widen and thin out). Updates and draws; removes finished.
  function stepSplashes(g, list, dt) {
    if (!list.length) return;
    g.strokeStyle = P.splash;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.age += dt;
      if (s.age >= s.life) { list.splice(i, 1); continue; }
      const f = s.age / s.life, rx = 1.5 + 5.5 * (1 - (1 - f) * (1 - f));
      g.globalAlpha = 0.8 * (1 - f);
      g.lineWidth = 1.4 - f * 0.8;
      g.beginPath(); g.ellipse(s.x, s.y, rx, rx * 0.38, 0, 0, 6.283); g.stroke();
    }
    g.globalAlpha = 1;
  }
  function addSplash(list, x, y, max) {
    if (list.length < (max || MAX_SPLASHES)) list.push({ x: x, y: y, age: 0, life: 0.3 + Math.random() * 0.1 });
  }

  function onRainHit(x, y) {
    if (Math.random() < 0.3) addSplash(splashes, x, y);
    if (particles.length < MAX_PARTICLES && Math.random() < 0.18) {
      particles.push({ x: x, y: y, vx: (Math.random() - 0.5) * 22, vy: -20 - Math.random() * 14, age: 0, life: 0.3, r: 1.1, color: P.splash, g: 160 });
    }
  }
  function drawRain(dt, run) {
    const top = cloudDrawY(run.cloud.y, run.cloud.r) + run.cloud.r * (CLOUD_BOTTOM - 0.12);
    stepRain(ctx, drops, dt, run.cloud.x, run.cloud.y, run.rainRadius, top, onRainHit);
  }

  // ---------- events / fx ----------
  function fmtCombo(c) { return '×' + (Math.round(c * 100) / 100); }

  function handleEvents(run) {
    for (const e of run.events) {
      if (e.type !== 'bloom') continue;
      const col = C.plants[e.plantType].bloom;
      for (let i = 0; i < 9 && particles.length < MAX_PARTICLES; i++) {
        const a = Math.random() * 6.283, sp = 40 + Math.random() * 60;
        particles.push({ x: e.x, y: e.y - (PLANT_SIZE[e.plantType] || 50) * 0.8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, age: 0, life: 0.55 + Math.random() * 0.3, r: 1.8 + Math.random() * 1.6, color: col, g: 220 });
      }
      if (e.rebloom) startRebloom(e, run);
      if (popups.length < MAX_POPUPS) {
        const mul = e.mul > 1 ? ' ×' + (Math.round(e.mul * 100) / 100) : '';
        popups.push({ x: e.x, y: e.y - (PLANT_SIZE[e.plantType] || 50) - 10, text: '+' + e.coins + mul + (e.combo > 1 ? ' ' + fmtCombo(e.combo) : ''), age: 0, life: 1.1, big: e.combo > 1 || !!mul });
      }
      if (e.refund > 0 && popups.length < MAX_POPUPS) {
        popups.push({ x: e.x + 14, y: e.y - 6, text: '+' + e.refund + ' su', age: 0, life: 1.0, big: false, color: '#a9d6f5', edge: 'rgba(20,40,70,0.8)' });
      }
      // A bloom soaks the soil around it a bit
      const L = wetL, ci = Math.floor(e.x / CELL), cj = Math.floor(e.y / CELL);
      for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
        if (i >= 0 && j >= 0 && i < L.gw && j < L.gh) L.wet[j * L.gw + i] = Math.min(1, L.wet[j * L.gw + i] + 0.3);
      }
    }
  }

  function drawFx(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.age += dt;
      if (q.age >= q.life) { particles.splice(i, 1); continue; }
      q.vy += q.g * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      ctx.globalAlpha = 1 - q.age / q.life;
      ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = popups.length - 1; i >= 0; i--) {
      const q = popups[i];
      q.age += dt;
      if (q.age >= q.life) { popups.splice(i, 1); continue; }
      const f = q.age / q.life;
      ctx.globalAlpha = f < 0.6 ? 1 : 1 - (f - 0.6) / 0.4;
      ctx.font = '700 ' + (q.big ? 17 : 15) + 'px Geist, "JetBrains Mono", system-ui, sans-serif';
      const y = q.y - 26 * (1 - (1 - f) * (1 - f));
      ctx.lineWidth = 3;
      ctx.strokeStyle = q.edge || P.coinEdge;
      ctx.strokeText(q.text, q.x, y);
      ctx.fillStyle = q.color || P.coin;
      ctx.fillText(q.text, q.x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- public ----------
  function resize() {
    if (!canvas) return;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, w);
    H = Math.max(1, h);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    buildGround();
    buildWet();
  }

  function init(cv) {
    canvas = cv;
    parent = cv.parentElement || document.body;
    ctx = cv.getContext('2d');
    cv.style.position = 'absolute';
    cv.style.left = '0';
    cv.style.top = '0';
    cv.style.width = '100%';
    cv.style.height = '100%';
    cv.style.display = 'block';
    resize();
  }

  function fieldSize() { return { w: W, h: H }; }

  function draw(run, dt) {
    if (!ctx) return;
    dt = clamp(dt || 0, 0, 0.05);
    clock += dt;
    if (run !== lastRun) {
      // New run (or back to idle): drop run-specific effects
      if (run) { wetL.wet.fill(0); wetL.soak.fill(0); }
      particles.length = 0; popups.length = 0; drops.length = 0; splashes.length = 0;
      recs.clear(); drawList.length = 0;
      lastRun = run;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(ground, 0, 0, W, H);
    updateWet(dt, run);

    if (run) {
      updatePlants(dt, run);
      handleEvents(run);
      const c = run.cloud;
      drawTarget(ctx, c.x, c.y, run.rainRadius, run.raining);
      drawPlants();
      if (run.raining) drawRain(dt, run);
      stepSplashes(ctx, splashes, dt);
      const low = run.tank > 0 ? 1 - run.water / run.tank : 1;
      // Opaque on purpose: the two flat layers would show a seam if drawn translucent
      drawCloud(c.x, c.y, c.r, low, run.raining ? 0.03 : 0.012);
    } else {
      // Idle backdrop: one slowly drifting cloud
      const x = W * (0.5 + 0.32 * Math.sin(clock * 0.12));
      const y = H * (0.3 + 0.06 * Math.sin(clock * 0.2 + 1)) + cloudLift();
      drawCloud(x, y, 52, 0.25, 0.015);
    }
    drawFx(dt);
  }

  RD.Render = {
    init: init, resize: resize, fieldSize: fieldSize, draw: draw,
    // Shared scenery painters (used by flora-preview.html); all take an explicit ctx, no module state.
    art: {
      paintGround: paintGround,
      createWet: createWet, wetDisc: wetDisc, drawWet: drawWet,
      drawCloud: drawCloudArt, cloudBottom: CLOUD_BOTTOM,
      drawTarget: drawTarget,
      stepRain: stepRain, stepSplashes: stepSplashes, addSplash: addSplash,
    },
  };
})(window.RD = window.RD || {});
