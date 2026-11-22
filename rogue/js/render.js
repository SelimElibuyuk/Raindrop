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
  const SOAK_PER_WET = 0.09;   // grass growth per unit of rain on damp soil (~7 s of rain at the centre to lush)
  const SOAK_WET_MIN = 0.3;    // soil must be this damp before grass starts to grow
  // Grass slowly creeps out of lush cells into their neighbours (soak never decays: grass stays all run).
  // Only used by flora-preview.html; in the game the grass follows run.soil (see syncSoil).
  const SPREAD_TICK = 0.25, SPREAD_FROM = 0.6, SPREAD_DROP = 0.3, SPREAD_RATE = 0.07;
  // In-game: grass level comes from the run's soil grid; dampness is only a short-lived tint under the rain.
  const GAME_WET_DECAY = 0.16;   // damp tint fades in ~5 s
  const SOIL_GROW = 3.2;         // displayed grass level rises at most this much per second (grows, no pop)
  const SOIL_EDGE_NOISE = 0.2;   // per-cell jitter on partly grown cells -> organic patch edges
  // Greenery cache: grass is painted per cell into a persistent offscreen canvas, in square tiles of
  // GREEN_TILE cells. Only tiles whose cells changed growth level are repainted.
  const GREEN_LEVELS = 40;     // growth quantization (small steps -> blades visibly scale up, no pop)
  const GREEN_TICK = 0.1;      // s between level scans
  const GREEN_TILES_PER_FRAME = 2;
  const GREEN_TILE = 5;        // cells per tile side (small: a repaint redraws (5+2)^2 cells)
  // A cell's grass never reaches further than this many cells outside the cell (blades <= 0.8 cell tall,
  // carpet ellipse <= 1.1 cell from the centre). Used both to mark dirty tiles and to pick the cells a
  // tile repaints, so the two always agree and tiles stay seam-free.
  const GREEN_REACH = 1;
  // The logical cloud point is where the rain lands. The cloud itself floats high above it,
  // so the plant being watered stays visible; a ground shadow + ring mark the target.
  // Tallest flower is 62 px × GROW_BOOST (~80 px while growing) + seed variation + pulse: lift keeps the
  // watered plant's head below the cloud's underside.
  function cloudLift() { return clamp(H * 0.19, 125, 150); }
  const MAX_PARTICLES = 260;
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
    // living grass (render-only greenery layer). Warmer and darker than RD.Flora's leaf greens so
    // young plants stay readable on a lush carpet. Carpet tones by growth: fresh olive -> deep lush.
    carpet: ['#a3b462', '#91b35b', '#82b056', '#74aa50'],
    carpetL: ['#b0c06c', '#9fbf65', '#90bc60', '#83b85b'],
    // blades [dark, light] for young and mature grass
    blades: [['#829f49', '#b0c66c'], ['#6c9a45', '#a0c464'], ['#5a8f3e', '#91bf5c']],   // young, mid, mature
    clover: '#6eae57', cloverL: '#90c870',
    wild: ['#f4efe1', '#f3dc7e', '#eeb5c3', '#c3b0e3'], wildC: '#e2a23c',
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
  let frozenEvents = false;     // events of a frozen (finished) run were already handled
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
  function paintGround(g, w, h, seed, noVignette) {
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
    // One path, one fill: the stage zoom repaints the ground every frame, so no per-grain draw calls
    g.beginPath();
    for (let i = 0; i < grains; i++) g.rect(rand() * w, rand() * h, 1.3, 1.3);
    g.fill();

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

    // Very soft edge vignette (dusk), painted once. noVignette: the stage zoom paints it in screen space.
    if (!noVignette) paintVignette(g, w, h);
  }
  function paintVignette(g, w, h) {
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
  // wet: 0..1 dampness (fades slowly); soak: 0..1 grass growth from watering (never fades during a run;
  // drawn as living grass by drawGreen, plus a light tint in drawWet).
  function createWet(w, h, cell) {
    cell = cell || CELL;
    const gw = Math.max(1, Math.ceil(w / cell)), gh = Math.max(1, Math.ceil(h / cell));
    const cv = document.createElement('canvas');
    cv.width = gw; cv.height = gh;
    const g = cv.getContext('2d');
    return { cell: cell, gw: gw, gh: gh, wet: new Float32Array(gw * gh), soak: new Float32Array(gw * gh), cv: cv, g: g, img: g.createImageData(gw, gh) };
  }
  // Adds wetness (and slowly grass tint) in a disc, softer toward the rim so the patch has no hard edge.
  // noSoak: only dampen (the game drives the grass from run.soil instead).
  function wetDisc(L, cx, cy, rr, amount, noSoak) {
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
          // Grass grows on damp soil, fastest at the centre and slower toward the rim, so a patch
          // turns lush from the middle outward with soft, organic edges
          const q = d / R;
          if (!noSoak && wet[k] > SOAK_WET_MIN && soak[k] < 1) soak[k] = Math.min(1, soak[k] + amount * SOAK_PER_WET * (1 - 0.55 * q * q));
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
    const decay = (L.decay || WET_DECAY) * dt;
    // Pass 1: dampness fades over time; grass (soak) stays for the rest of the run
    for (let k = 0; k < n; k++) {
      const v = wet[k];
      if (v <= 0 && soak[k] <= 0) continue;
      any = true;
      if (v > 0) wet[k] = Math.max(0, v - decay);
    }
    if (!any) return false;
    if (!L.soilDriven) {
      L.spT = (L.spT || 0) + dt;
      if (L.spT >= SPREAD_TICK) { spreadSoak(L, L.spT); L.spT = 0; }
    }
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

  // Lush cells slowly seed their neighbours: a cell next to grass grows toward (neighbour - SPREAD_DROP),
  // so greenery creeps out a cell or two over a run and then stops on its own.
  function spreadSoak(L, dt) {
    const soak = L.soak, gw = L.gw, n = soak.length, step = SPREAD_RATE * dt;
    for (let k = 0; k < n; k++) {
      const s = soak[k];
      if (s >= 1 - SPREAD_DROP) continue;
      const x = k % gw;
      let m = 0;
      if (x > 0 && soak[k - 1] > m) m = soak[k - 1];
      if (x < gw - 1 && soak[k + 1] > m) m = soak[k + 1];
      if (k >= gw && soak[k - gw] > m) m = soak[k - gw];
      if (k + gw < n && soak[k + gw] > m) m = soak[k + gw];
      if (m < SPREAD_FROM) continue;
      const t = m - SPREAD_DROP;
      if (s < t) soak[k] = Math.min(t, s + step);
    }
  }

  // Clears dampness, grass and the greenery cache (new run).
  function resetWet(L) {
    L.wet.fill(0); L.soak.fill(0); L.spT = 0;
    L.seed = (Math.random() * 0x7fffffff) | 0;   // new grass layout every run
    const gr = L.gr;
    if (gr) {
      gr.lvl.fill(0); gr.dirty.fill(0); gr.queue.length = 0; gr.t = 0; gr.any = false;
      gr.geo = new Array(L.gw * L.gh);
      gr.g.setTransform(1, 0, 0, 1, 0, 0);
      gr.g.clearRect(0, 0, gr.cv.width, gr.cv.height);
    }
  }

  // ---------- living grass (cached flat-vector greenery over the wet soil) ----------
  // Growth s = drawn level / GREEN_LEVELS (0..1) drives, per cell:
  //   carpet ellipse (from 0.15)  -> tufts of pointed blades, one after another (0.22 .. 0.9)
  //   -> clover leaves (0.6 .. 0.85, some cells) -> tiny wildflowers (0.8 .. 1, some cells).
  // Everything scales from zero with s, so a level change only grows things a little: no popping.
  // Grass tuft sprites: TUFT_VARIANTS shapes (the upper half taller) x TUFT_STEPS growth steps x 3 colour
  // sets, pre-rendered once per dpr. A tuft is a small fan of pointed blades, dark and light alternating.
  const TUFT_VARIANTS = 8, TUFT_STEPS = 16;
  const TUFT_W = 26, TUFT_H = 14, TUFT_BX = 13, TUFT_BY = 13;   // sprite box and tuft base point, CSS px
  const atlases = {};
  function tuftAtlas(dpr) {
    let A = atlases[dpr];
    if (A) return A;
    const sw = Math.ceil(TUFT_W * dpr), sh = Math.ceil(TUFT_H * dpr);
    const cv = document.createElement('canvas');
    cv.width = sw * TUFT_STEPS * 3; cv.height = sh * TUFT_VARIANTS;
    const g = cv.getContext('2d'), r = rng(4242);
    for (let v = 0; v < TUFT_VARIANTS; v++) {
      const tall = v >= TUFT_VARIANTS / 2;
      const n = 3 + Math.floor(r() * 3) + (tall ? 1 : 0), sp = 0.8 + r() * 0.5;
      const H = tall ? 9 + r() * 2 : 6 + r() * 2.5;   // <= 11 px, so a cell's grass stays within GREEN_REACH
      const bl = [];
      for (let b = 0; b < n; b++) {
        const f = b / (n - 1) - 0.5;
        bl.push(f * 4 * sp, f * 1.25 + (r() - 0.5) * 0.3, (0.72 + r() * 0.28) * (1 - Math.abs(f) * 0.45));
      }
      for (let c = 0; c < 3; c++) {
        for (let st = 0; st < TUFT_STEPS; st++) {
          const gt = (st + 1) / TUFT_STEPS, hh = H * gt, hw = 0.6 + 0.7 * gt;
          g.setTransform(dpr, 0, 0, dpr, (c * TUFT_STEPS + st) * sw, v * sh);
          for (let tone = 0; tone < 2; tone++) {
            g.fillStyle = P.blades[c][tone];
            g.beginPath();
            for (let b = tone; b < n; b += 2) {
              const bx = TUFT_BX + bl[b * 3] * gt, a = bl[b * 3 + 1], len = hh * bl[b * 3 + 2], y = TUFT_BY;
              const dx = Math.sin(a), dy = -Math.cos(a);
              g.moveTo(bx - hw, y);
              g.quadraticCurveTo(bx + dx * len * 0.5 - hw * 0.6, y + dy * len * 0.5, bx + dx * len, y + dy * len);
              g.quadraticCurveTo(bx + dx * len * 0.5 + hw * 0.6, y + dy * len * 0.5, bx + hw, y);
              g.closePath();
            }
            g.fill();
          }
        }
      }
    }
    A = atlases[dpr] = { cv: cv, sw: sw, sh: sh };
    return A;
  }

  function createGreen(L, dpr) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(L.gw * L.cell * dpr));
    cv.height = Math.max(1, Math.round(L.gh * L.cell * dpr));
    const tw = Math.ceil(L.gw / GREEN_TILE), th = Math.ceil(L.gh / GREEN_TILE);
    L.gr = {
      cv: cv, g: cv.getContext('2d'), dpr: dpr, tw: tw, th: th,
      lvl: new Uint8Array(L.gw * L.gh), geo: new Array(L.gw * L.gh),
      dirty: new Uint8Array(tw * th), queue: [], t: GREEN_TICK, any: false,
    };
    return L.gr;
  }

  // Seeded per-cell layout (positions, sizes, thresholds), computed once per cell and kept.
  function cellGeo(L, k) {
    const geo = L.gr.geo;
    let o = geo[k];
    if (o) return o;
    const cell = L.cell, x0 = (k % L.gw) * cell, y0 = ((k / L.gw) | 0) * cell;
    // Seeded per run (L.seed) so the layout differs every run, and loosely jittered so no cell grid shows
    const r = rng(Math.imul(k + 1, 2654435761) ^ 0x5bd1e995 ^ (L.seed || 0));
    o = {};
    // carpet: one big rotated ellipse (neighbours overlap into a continuous, lumpy-edged carpet)
    o.bx = x0 + cell * (0.25 + r() * 0.5); o.by = y0 + cell * (0.25 + r() * 0.5);
    o.brx = cell * (0.7 + r() * 0.38); o.bry = o.brx * (0.6 + r() * 0.3); o.ba = r() * 3.1416;
    o.tone = Math.floor(r() * 3) - 1;   // -1..1: per-cell shade shift so equal growth is not one flat colour
    // lighter top-left patch on the carpet (two-tone)
    // (only on some cells and fairly large, so highlights merge into irregular sunlit areas, not a dot grid)
    o.lx = o.bx - cell * (0.05 + r() * 0.2); o.ly = o.by - cell * (0.08 + r() * 0.15); o.lr = cell * (0.5 + r() * 0.3);
    if (r() > 0.42) o.lr = 0;
    // tufts: [x, y, threshold, variant]; the later ones use the taller variants -> denser clumps
    o.tufts = [];
    const nt = 3 + Math.floor(r() * 4);   // 3..6 tufts
    for (let t = 0; t < nt; t++) {
      o.tufts.push([x0 + cell * (0.05 + r() * 0.9), y0 + cell * (0.25 + r() * 0.75), 0.22 + (t / nt) * 0.55 + r() * 0.08,
        (t >= nt * 0.6 ? TUFT_VARIANTS / 2 : 0) + Math.floor(r() * TUFT_VARIANTS / 2)]);
    }
    o.tufts.sort(function (a, b) { return a[1] - b[1]; });
    // clover (about a third of the cells) and a wildflower (about a quarter)
    const cx = x0 + cell * (0.2 + r() * 0.6), cy = y0 + cell * (0.25 + r() * 0.55), ca = r() * 6.283, hasC = r() < 0.34;
    o.cl = hasC ? [cx, cy, ca] : null;
    const fx = x0 + cell * (0.2 + r() * 0.6), fy = y0 + cell * (0.25 + r() * 0.6), fa = r() * 6.283, fc = Math.floor(r() * 4), hasF = r() < 0.27;
    o.fl = hasF ? [fx, fy, fa, fc] : null;
    geo[k] = o;
    return o;
  }

  function carpetOf(s) { return smooth01((s - 0.15) / 0.5); }

  // Paints all grown cells in the inclusive cell range, in fixed passes (carpet, light patches, clover,
  // dark blades, light blades, wildflowers), each batched by colour. Opaque fills only, so any tile
  // repaint gives exactly the pixels a full repaint would.
  const paintList = [];
  function paintCells(g, L, ia, ib, ja, jb) {
    const gr = L.gr, lvl = gr.lvl, gw = L.gw, list = paintList;
    list.length = 0;
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) { const k = j * gw + i; if (lvl[k]) list.push(k); }
    if (!list.length) return;
    const LV = GREEN_LEVELS;
    // Carpet + light patches, lusher buckets on top
    for (let pass = 0; pass < 2; pass++) {
      for (let b = 0; b < 4; b++) {
        let open = false;
        for (let q = 0; q < list.length; q++) {
          const k = list[q], c = carpetOf(lvl[k] / LV);
          if (c <= 0) continue;
          const o = cellGeo(L, k);
          if (Math.max(0, Math.min(3, ((c * 4) | 0) + o.tone)) !== b) continue;
          let x, y, rx, ry;
          if (pass === 0) { x = o.bx; y = o.by; rx = o.brx * c; ry = o.bry * c; }
          else {
            const e = smooth01((c - 0.4) / 0.6);
            if (e <= 0 || !o.lr) continue;
            x = o.lx; y = o.ly; rx = o.lr * e; ry = rx * 0.8;
          }
          if (!open) { g.beginPath(); open = true; }
          g.moveTo(x + rx * Math.cos(o.ba), y + rx * Math.sin(o.ba));
          g.ellipse(x, y, rx, ry, o.ba, 0, 6.283);
        }
        if (open) { g.fillStyle = (pass ? P.carpetL : P.carpet)[b]; g.fill(); }
      }
    }
    // Blade tufts: one pre-rendered sprite each (variant x growth step x colour), cell rows top to bottom
    const A = tuftAtlas(gr.dpr), dpr = gr.dpr, sw = A.sw / dpr, sh = A.sh / dpr;
    for (let q = 0; q < list.length; q++) {
      const k = list[q], s = lvl[k] / LV, col = s < 0.45 ? 0 : (s < 0.7 ? 1 : 2);
      const tufts = cellGeo(L, k).tufts;
      for (let t = 0; t < tufts.length; t++) {
        const tf = tufts[t], step = Math.round(smooth01((s - tf[2]) / 0.3) * TUFT_STEPS) - 1;
        if (step < 0) continue;
        g.drawImage(A.cv, (col * TUFT_STEPS + step) * A.sw, tf[3] * A.sh, A.sw, A.sh,
          Math.round((tf[0] - TUFT_BX) * dpr) / dpr, Math.round((tf[1] - TUFT_BY) * dpr) / dpr, sw, sh);
      }
    }
    // Clover (over the blades so it reads): three round leaves + a lighter highlight dot on each
    for (let pass = 0; pass < 2; pass++) {
      let open = false;
      for (let q = 0; q < list.length; q++) {
        const k = list[q], o = cellGeo(L, k);
        if (!o.cl) continue;
        const e = smooth01((lvl[k] / LV - 0.6) / 0.25);
        if (e <= 0) continue;
        if (!open) { g.beginPath(); open = true; }
        const c = o.cl, lr = 1.9 * e, dd = 1.7 * e;
        for (let m = 0; m < 3; m++) {
          const a = c[2] + m * 2.094;
          let x = c[0] + Math.cos(a) * dd, y = c[1] + Math.sin(a) * dd * 0.85, rr = lr;
          if (pass) { x -= lr * 0.25; y -= lr * 0.3; rr = lr * 0.45; }
          g.moveTo(x + rr, y); g.arc(x, y, rr, 0, 6.283);
        }
      }
      if (open) { g.fillStyle = pass ? P.cloverL : P.clover; g.fill(); }
    }
    // Wildflowers: five soft petals around a warm centre, small enough to stay below the real flowers
    for (let pc = 0; pc < 5; pc++) {
      let open = false;
      for (let q = 0; q < list.length; q++) {
        const k = list[q], o = cellGeo(L, k);
        if (!o.fl || (pc < 4 && o.fl[3] !== pc)) continue;
        const e = smooth01((lvl[k] / LV - 0.8) / 0.2);
        if (e <= 0) continue;
        if (!open) { g.beginPath(); open = true; }
        const f = o.fl;
        if (pc < 4) {
          const pr = 1.25 * e, pd = 1.5 * e;
          for (let m = 0; m < 5; m++) {
            const a = f[2] + m * 1.2566, x = f[0] + Math.cos(a) * pd, y = f[1] + Math.sin(a) * pd;
            g.moveTo(x + pr, y); g.arc(x, y, pr, 0, 6.283);
          }
        } else {
          g.moveTo(f[0] + 0.95 * e, f[1]); g.arc(f[0], f[1], 0.95 * e, 0, 6.283);
        }
      }
      if (open) { g.fillStyle = pc < 4 ? P.wild[pc] : P.wildC; g.fill(); }
    }
  }

  // Repaints one tile: clear its (device-pixel aligned) rect, clip, paint every cell that can reach it.
  function paintTile(L, t) {
    const gr = L.gr, g = gr.g, dpr = gr.dpr, cell = L.cell, R = GREEN_REACH;
    const ti = t % gr.tw, tj = (t / gr.tw) | 0;
    const i0 = ti * GREEN_TILE, j0 = tj * GREEN_TILE;
    const i1 = Math.min(L.gw, i0 + GREEN_TILE), j1 = Math.min(L.gh, j0 + GREEN_TILE);
    const X0 = Math.round(i0 * cell * dpr), Y0 = Math.round(j0 * cell * dpr);
    const X1 = i1 >= L.gw ? gr.cv.width : Math.round(i1 * cell * dpr);
    const Y1 = j1 >= L.gh ? gr.cv.height : Math.round(j1 * cell * dpr);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(X0, Y0, X1 - X0, Y1 - Y0);
    g.save();
    g.beginPath(); g.rect(X0, Y0, X1 - X0, Y1 - Y0); g.clip();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintCells(g, L, Math.max(0, i0 - R), Math.min(L.gw - 1, i1 - 1 + R), Math.max(0, j0 - R), Math.min(L.gh - 1, j1 - 1 + R));
    g.restore();
  }

  // Scans growth levels (every GREEN_TICK), queues the tiles touched by changed cells and repaints a few
  // per frame (all of them when `all`), then blits the greenery layer onto g.
  function drawGreen(g, L, dt, dpr, all) {
    let gr = L.gr;
    let fresh = false;
    if (!gr || gr.dpr !== dpr) { gr = createGreen(L, dpr); fresh = true; }
    gr.t += dt;
    if (all || fresh || gr.t >= (L.tick || GREEN_TICK)) {
      gr.t = 0;
      const soak = L.soak, lvl = gr.lvl, gw = L.gw, gh = L.gh, n = soak.length, R = GREEN_REACH;
      for (let k = 0; k < n; k++) {
        const v = Math.min(GREEN_LEVELS, Math.floor(soak[k] * GREEN_LEVELS + 1e-4));
        if (v === lvl[k]) continue;
        lvl[k] = v;
        if (v) gr.any = true;
        const i = k % gw, j = (k / gw) | 0;
        const ta = Math.floor(Math.max(0, i - R) / GREEN_TILE), tb = Math.floor(Math.min(gw - 1, i + R) / GREEN_TILE);
        const ua = Math.floor(Math.max(0, j - R) / GREEN_TILE), ub = Math.floor(Math.min(gh - 1, j + R) / GREEN_TILE);
        for (let u = ua; u <= ub; u++) for (let tx = ta; tx <= tb; tx++) {
          const t = u * gr.tw + tx;
          if (!gr.dirty[t]) { gr.dirty[t] = 1; gr.queue.push(t); }
        }
      }
    }
    // A rebuilt cache (resize mid-run) catches up over a few frames instead of freezing one frame
    let budget = all ? Infinity : (gr.queue.length > 24 ? (L.burst || 10) : GREEN_TILES_PER_FRAME);
    // Bursts are also capped by time (slow phones): at least 2 tiles, then stop after ~2 ms
    const timed = !all && budget > GREEN_TILES_PER_FRAME, t0 = timed ? performance.now() : 0;
    let done = 0;
    while (gr.queue.length && budget-- > 0) {
      if (timed && done >= GREEN_TILES_PER_FRAME && performance.now() - t0 > 2) break;
      done++;
      const t = gr.queue.shift();
      gr.dirty[t] = 0;
      paintTile(L, t);
    }
    if (gr.any && g) g.drawImage(gr.cv, 0, 0, L.gw * L.cell, L.gh * L.cell);   // g null: rebuild the cache only
  }

  // Rebuilds the grid for a new size; keeps the overlapping dampness and grass so a resize mid-run
  // (e.g. a phone's address bar collapsing) does not wipe the greenery. The cache is repainted.
  function buildWet() {
    const old = wetL;
    wetL = createWet(W, H, CELL);
    wetL.soilDriven = true;
    wetL.decay = GAME_WET_DECAY;
    if (!old) return;
    const gw = Math.min(old.gw, wetL.gw), gh = Math.min(old.gh, wetL.gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      wetL.wet[j * wetL.gw + i] = old.wet[j * old.gw + i];
      wetL.soak[j * wetL.gw + i] = old.soak[j * old.gw + i];
    }
  }

  // Grass follows the run's soil grid (CONTRACTS "Soil"): target level per render cell is the
  // bilinear sample of clamp(soil / lushSoil, 0, 1), so the visuals match the level bar and grow faster
  // with stronger rain. The displayed level eases up toward it (grass grows instead of popping) and
  // never goes down during a run. Partly grown cells get a little seeded jitter for organic edges.
  let soilT = 0;
  function syncSoil(L, run, dt, force) {
    const soil = run && run.soil;
    if (!soil) return;
    soilT += dt;
    const tick = L.tick || GREEN_TICK;
    if (!force && soilT < tick) return;
    const step = force ? 1 : SOIL_GROW * soilT;
    soilT = 0;
    const g = run.greenCell || 32, sgw = run.gw, sgh = run.gh, lush = run.lushSoil || C.lushSoil || 8;
    const cell = L.cell, gw = L.gw, gh = L.gh, soak = L.soak;
    let nz = L.noise;
    if (!nz || nz.length !== soak.length) {
      nz = L.noise = new Float32Array(soak.length);
      const r = rng(9173);
      for (let k = 0; k < nz.length; k++) nz[k] = r() * 2 - 1;
    }
    for (let j = 0; j < gh; j++) {
      let fy = ((j + 0.5) * cell) / g - 0.5;
      fy = clamp(fy, 0, sgh - 1);
      const y0 = fy | 0, y1 = Math.min(sgh - 1, y0 + 1), ty = fy - y0;
      for (let i = 0; i < gw; i++) {
        let fx = ((i + 0.5) * cell) / g - 0.5;
        fx = clamp(fx, 0, sgw - 1);
        const x0 = fx | 0, x1 = Math.min(sgw - 1, x0 + 1), tx = fx - x0;
        const a = soil[y0 * sgw + x0], b = soil[y0 * sgw + x1], c = soil[y1 * sgw + x0], d = soil[y1 * sgw + x1];
        let v = ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty) / lush;
        if (v <= 0) continue;
        if (v > 1) v = 1;
        // Ease-out curve: a cell that just counted for the bar already shows a clear carpet
        v = 1 - Math.pow(1 - v, 1.6);
        const k = j * gw + i;
        v = clamp(v + nz[k] * SOIL_EDGE_NOISE * 4 * v * (1 - v), 0, 1);
        const s = soak[k];
        if (v > s) soak[k] = Math.min(v, s + step);
      }
    }
  }

  function updateWet(dt, run, soilRun) {
    if (run && run.raining) wetDisc(wetL, run.cloud.x, run.cloud.y, run.rainRadius, WET_GAIN * dt, true);
    const sweeping = !!(soilRun && soilRun.sweep && !soilRun.sweep.done);
    // During the victory wave the grass is scanned and repainted faster so it keeps up with the front
    wetL.tick = sweeping ? 0.05 : GREEN_TICK;
    wetL.burst = sweeping ? 16 : 10;
    syncSoil(wetL, soilRun, dt, false);
    drawWet(ctx, wetL, dt);
    drawGreen(ctx, wetL, dt, dpr);
  }

  // ---------- plants (flat vector flowers from RD.Flora) ----------
  // Full plant height in px per type (taller flowers stand out a bit more).
  const PLANT_SIZE = { cactus: 40, daisy: 46, tulip: 50, lavender: 52, bluebell: 48, rose: 52, sunflower: 62, skylily: 62 };
  const BLOOM_OPEN = 0.3;       // s: petals open after a bloom, then the flower fades over CONFIG.bloomLinger
  const REB_OPEN = 0.25, REB_HOLD = 0.2, REB_CLOSE = 0.3;   // s: rebloom pop (sunflower)
  const REGROW_FLOOR = 0.6;     // after a rebloom the stem stays full; only the head regrows
  const SPAWN_POP = 0.35;       // s: new seedlings fade in
  // Growing plants are drawn bigger so buds are easy to spot; the boost settles as the flower opens.
  const GROW_BOOST = 1.3, BLOOM_BOOST = 1.12;
  const START_GROWTH = 0.38;   // visual growth floor for growing plants (water 0 → recognisable bud)
  // Breathing pulse on growing plants that are not being rained on (moving things catch the eye)
  const PULSE_AMP = 0.07, PULSE_PERIOD = 1.4;
  // Water ring at the base of a plant (same style as the boss rings), scaled to the plant
  const RING_K = 0.34, RING_MIN = 11, DONE_FLASH = 0.5;
  let reduceMotion = false;
  try {
    const mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq) {
      reduceMotion = mq.matches;
      const on = function (e) { reduceMotion = e.matches; };
      if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
    }
  } catch (e) { /* no matchMedia */ }

  // Per-plant visual state by plant id. Bloomed plants are removed by Run after bloomLinger, which is
  // shorter than open + fade, so the record keeps drawing them ("ghost") until the fade ends.
  const recs = new Map();
  const drawList = [];
  const floraOpts = { size: 50, growth: 0, bloom: 0, fade: 1, wilt: 0, sway: 0, seed: 0 };

  function inRain(p, run) {
    return !!(run && run.raining && Math.hypot(p.x - run.cloud.x, p.y - run.cloud.y) <= run.rainRadius);
  }

  // Is (x, y) inside the dry ring of a tulip-queen arm that is being watered right now?
  function inDryRing(x, y, run) {
    const boss = run.boss;
    if (!boss || boss.kind !== 'arms' || !run.level) return false;
    const R = run.level.boss.dryRadius || 80;
    for (let i = 0; i < boss.parts.length; i++) {
      const q = boss.parts[i];
      if (q.wet && !q.done && Math.hypot(q.x - x, q.y - y) < R) return true;
    }
    return false;
  }

  function updatePlants(dt, run) {
    for (const r of recs.values()) r.seen = false;
    for (let i = 0; i < run.plants.length; i++) {
      const p = run.plants[i];
      let r = recs.get(p.id);
      if (!r) {
        r = { p: p, seen: true, bloomT: -1, reb: -1, regrow: false, peak: 0, wilt: 0, wet: false,
          pw: p.water, lose: 0, ringA: 0, pulse: 1, hold: false, intro: -1, shown: false, dn: 0 };
        // Planted by a stage-up while the zoom plays: pops in on the zoom's clock (staggered from the centre)
        if (ZX && ZX.p < 1) { r.intro = 0; r.dn = clamp(Math.hypot(p.x - W / 2, p.y - H / 2) / ZX.maxD, 0, 1); }
        recs.set(p.id, r);
      }
      if (r.intro >= 0) {
        const pp = ZX ? ZX.p : 1;
        r.intro = ZX && ZX.still ? (pp >= 0.55 ? smooth01((pp - 0.55) / 0.35) : 0)
          : clamp((pp - (ZOOM_POP_AT + ZOOM_POP_SPREAD * r.dn)) / ZOOM_POP_LEN, 0, 1);
        // Fully popped: the zoom's reveal replaces the age fade (p.age only starts once the zoom ends)
        if (r.intro >= 1) { r.intro = -1; r.shown = true; }
      }
      r.p = p;
      r.seen = true;
      r.wet = inRain(p, run);
      if (p.state === 'bloomed') {
        // A finished run is no longer updated (victory wave): the flower opens on its own clock and,
        // after a boss win, stays in full bloom instead of fading.
        if (run.over) r.bloomT = (r.bloomT < 0 ? p.bloomAge : r.bloomT) + dt;
        else r.bloomT = p.bloomAge;
        r.hold = !!(run.over && run.bossWin);
      }
      // Ring state: losing water (wilting / dried by a boss arm) turns it orange; fades in and out
      const losing = p.state === 'growing' && !r.wet && p.water < r.pw - 1e-5;
      r.lose += ((losing ? 1 : 0) - r.lose) * Math.min(1, dt * 8);
      r.pw = p.water;
      const showRing = p.state === 'growing' && (p.water > 0.001 || r.wet);
      r.ringA += ((showRing ? 1 : 0) - r.ringA) * Math.min(1, dt * 6);
      // Pulse amount: settles while the cloud rains on the plant
      r.pulse += ((r.wet || reduceMotion ? 0 : 1) - r.pulse) * Math.min(1, dt * 5);
      if (r.reb >= 0) { r.reb += dt; if (r.reb >= REB_OPEN + REB_HOLD + REB_CLOSE) r.reb = -1; }
      // Thirsty flowers (CONFIG wilt) droop as they lose water outside the rain; eased so the
      // rain-circle edge does not flicker.
      if (p.state === 'growing' && inDryRing(p.x, p.y, run)) {
        r.wilt += (1 - r.wilt) * Math.min(1, dt * 3);   // dried by the boss arm next to it
      } else if (C.plants[p.type].wilt && p.state === 'growing') {
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
      const f = r.hold ? 0 : clamp((r.bloomT - BLOOM_OPEN) / C.bloomLinger, 0, 1);
      fade = 1 - f * f;
      if (fade <= 0.01) return;
    } else {
      const f = clamp(p.water / p.need, 0, 1);
      // Unwatered plants already show as a small, typed bud (user: buds must be easy to spot), not a tiny sprout
      growth = r.regrow ? REGROW_FLOOR + (1 - REGROW_FLOOR) * f : START_GROWTH + (1 - START_GROWTH) * f;
      if (r.reb >= 0) {
        const t = r.reb;
        if (t < REB_OPEN + REB_HOLD) { bloom = clamp(t / REB_OPEN, 0, 1); growth = 1; }
        else { const k = clamp((t - REB_OPEN - REB_HOLD) / REB_CLOSE, 0, 1); bloom = 1 - k; growth = 1 + (growth - 1) * k; }
      }
      const s0 = r.shown ? 1 : clamp(p.age / SPAWN_POP, 0, 1);
      fade = 1 - (1 - s0) * (1 - s0);
    }
    // Stage zoom pop-in: grows from small with a light overshoot while fading in
    let pop = 1;
    if (r.intro >= 0) {
      if (r.intro <= 0) return;
      fade = smooth01(r.intro * 2.2);
      pop = ZX && ZX.still ? 1 : 0.3 + 0.7 * eBack(r.intro);
    }
    const w = r.wilt;
    // Gentle sway, slower and smaller when wilted; a light shiver while being rained on
    let sway = Math.sin(clock * (1.7 - 0.9 * w) + p.id * 1.37) * 0.035 * (1 - 0.5 * w);
    if (r.wet) sway += Math.sin(clock * 9 + p.id) * 0.02;
    const base = PLANT_SIZE[p.type] || 50;
    // Bigger while growing; eases down a little as the petals open
    let size = base * (GROW_BOOST + (BLOOM_BOOST - GROW_BOOST) * bloom);
    if (r.bloomT < 0 && r.reb < 0 && r.pulse > 0.001) {
      // Soft breathing, own phase per plant; settles under the rain
      size *= 1 + PULSE_AMP * r.pulse * Math.sin(clock * 6.2832 / PULSE_PERIOD + p.id * 2.39);
    }
    size *= pop;
    if (r.intro < 0) plantRing(r, base * GROW_BOOST);
    const o = floraOpts;
    o.size = size;
    o.growth = growth; o.bloom = bloom; o.fade = fade; o.wilt = w; o.sway = sway; o.seed = p.id;
    o.golden = !!p.golden; o.time = clock;
    if (RD.Flora) RD.Flora.draw(ctx, p.type, p.x, p.y, o);
  }

  // Water ring at the plant's base (boss ring style): blue fills with water, orange while losing it,
  // a short gold flash when the plant blooms.
  function plantRing(r, size) {
    const p = r.p, rx = Math.max(RING_MIN, size * RING_K), y = p.y + 3;
    if (r.bloomT >= 0 || r.reb >= 0) {
      const t = r.bloomT >= 0 ? r.bloomT : r.reb;
      if (t >= DONE_FLASH) return;
      const f = t / DONE_FLASH;
      ctx.globalAlpha = 1 - f * f;
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.6 * (1 - f * 0.5);
      ctx.strokeStyle = BP.ringDone;
      const R = rx * (1 + 0.35 * f);
      ctx.beginPath(); ctx.ellipse(p.x, y, R, R * 0.4, 0, 0, 6.283); ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    const a = r.ringA;
    if (a < 0.02) return;
    const frac = clamp(p.water / p.need, 0, 1);
    // Calm when idle, full strength while rained on or losing water
    ctx.globalAlpha = a * (r.wet || r.lose > 0.5 ? 1 : 0.85);
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = BP.ringBg;
    ctx.beginPath(); ctx.ellipse(p.x, y, rx, rx * 0.4, 0, 0, 6.283); ctx.stroke();
    if (frac > 0.005) {
      // Fills from the front (the part the plant does not hide) around both sides to the back
      ctx.lineWidth = 2.8;
      ctx.strokeStyle = r.lose > 0.5 ? BP.ringLose : BP.ringWater;
      ctx.beginPath(); ctx.ellipse(p.x, y, rx, rx * 0.4, 0, Math.PI / 2 - frac * Math.PI, Math.PI / 2 + frac * Math.PI); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- linked-flower vines (run.plants[].link / linkWet) ----------
  // One thin vine per linked pair, drawn once (lower id first) while both are growing, under the plants.
  // Small per-pair render state (fade, travelling water pulse) keyed by "a-b" ids; dropped once faded out.
  const linkRecs = new Map();
  const LINK_FADE = 0.3, LINK_PULSE_SEC = 0.9;
  function drawLinks(run, dt) {
    const plants = run.plants, byId = new Map();
    if (plants) for (let i = 0; i < plants.length; i++) byId.set(plants[i].id, plants[i]);
    const seen = new Set();
    if (plants) {
      for (let i = 0; i < plants.length; i++) {
        const p = plants[i];
        if (p.link == null || p.id >= p.link) continue;
        const q = byId.get(p.link);
        if (!q) continue;
        const key = p.id + '-' + q.id;
        seen.add(key);
        let r = linkRecs.get(key);
        if (!r) { r = { a: 0, glow: 0, t: 0, dir: 1, seed: (p.id * 7.31 + q.id * 3.17) % 6.283, x0: 0, y0: 0, x1: 0, y1: 0 }; linkRecs.set(key, r); }
        r.x0 = p.x; r.y0 = p.y; r.x1 = q.x; r.y1 = q.y;
        const alive = p.state === 'growing' && q.state === 'growing';
        r.a = clamp(r.a + (alive ? dt : -dt) / LINK_FADE, 0, 1);
        const wet = alive && (p.linkWet || q.linkWet);
        if (wet) {
          // Pulse travels from the wet plant toward its partner
          const dir = p.linkWet ? 1 : -1;
          if (r.glow < 0.05 || dir !== r.dir) { r.dir = dir; if (r.glow < 0.05) r.t = 0; }
          r.t = (r.t + dt / LINK_PULSE_SEC) % 1;
        }
        r.glow = clamp(r.glow + (wet ? dt : -dt) / 0.15, 0, 1);
      }
    }
    // Pairs that vanished from the plant list fade out on their last known positions
    for (const [key, r] of linkRecs) {
      if (!seen.has(key)) {
        r.a -= dt / LINK_FADE; r.glow = 0;
        if (r.a <= 0) { linkRecs.delete(key); continue; }
      }
      if (r.a <= 0.003) continue;
      drawVine(r);
    }
  }
  function drawVine(r) {
    const dx = r.x1 - r.x0, dy = r.y1 - r.y0, len = Math.hypot(dx, dy);
    if (len < 4) return;
    const nx = -dy / len, ny = dx / len;           // unit normal
    const bend = len * 0.07 * Math.sin(r.seed);    // slight curve
    const n = Math.max(8, Math.round(len / 12));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, k = Math.sin(Math.PI * t);
      const off = bend * 4 * t * (1 - t) + Math.sin(t * 9 + clock * 1.3 + r.seed) * 1.8 * k;
      pts.push(r.x0 + dx * t + nx * off, r.y0 + dy * t + ny * off);
    }
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.85 * r.a;
    ctx.strokeStyle = '#4a6634';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (let i = 1; i <= n; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
    ctx.stroke();
    // A few tiny leaves, alternating sides
    ctx.fillStyle = '#5c7d3c';
    const nl = Math.max(3, Math.min(6, Math.round(len / 55)));
    for (let j = 1; j <= nl; j++) {
      const i = Math.round(n * j / (nl + 1)), lx = pts[i * 2], ly = pts[i * 2 + 1], side = j & 1 ? 1 : -1;
      ctx.beginPath();
      ctx.ellipse(lx + nx * side * 3, ly + ny * side * 3, 3.2, 1.5, Math.atan2(dy, dx) + side * 0.7, 0, 6.283);
      ctx.fill();
    }
    // Soft water-blue pulse travelling along the vine
    if (r.glow > 0.01) {
      const u = r.dir > 0 ? r.t : 1 - r.t, f = u * n, i0 = Math.min(n - 1, Math.floor(f)), fr = f - i0;
      const gx = pts[i0 * 2] + (pts[i0 * 2 + 2] - pts[i0 * 2]) * fr, gy = pts[i0 * 2 + 1] + (pts[i0 * 2 + 3] - pts[i0 * 2 + 1]) * fr;
      const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, 16);
      gr.addColorStop(0, 'rgba(150,210,255,0.75)');
      gr.addColorStop(1, 'rgba(150,210,255,0)');
      ctx.globalAlpha = r.a * r.glow;
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(gx, gy, 16, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- water splash flyers (run.splashes) ----------
  // A water blob flying on a parabolic arc (peak ~40 px above the straight line), stretched along its motion.
  function drawSplashFlyers(run) {
    const list = run.splashes;
    if (!list || !list.length) return;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const u = clamp((s.t || 0) / (s.fly || 0.4), 0, 1);
      const arc = (a, b, h) => a + (b - a) * u - (h ? 4 * h * u * (1 - u) : 0);
      const px = arc(s.sx, s.x), py = arc(s.sy, s.y, 40);
      // Tangent for the stretch direction
      const vx = s.x - s.sx, vy = (s.y - s.sy) - 4 * 40 * (1 - 2 * u);
      const ang = Math.atan2(vy, vx), st = 1.5;
      const r = 5.5 * (0.85 + 0.15 * Math.sin(u * Math.PI));
      // Faint trail
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = P.rainA;
      const tx = px - Math.cos(ang) * r * 2.2, ty = py - Math.sin(ang) * r * 2.2;
      ctx.beginPath(); ctx.ellipse(tx, ty, r * 0.9, r * 0.5, ang, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = P.rainB;
      ctx.beginPath(); ctx.ellipse(px, py, r * st, r * 0.8, ang, 0, 6.283); ctx.fill();
      ctx.fillStyle = P.rainA;
      ctx.beginPath(); ctx.ellipse(px - Math.cos(ang) * r * 0.3, py - Math.sin(ang) * r * 0.3 - r * 0.25, r * 0.5, r * 0.25, ang, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlants() {
    drawList.length = 0;
    for (const r of recs.values()) drawList.push(r);
    if (B) for (let i = 0; i < B.parts.length; i++) drawList.push(B.parts[i]);
    drawList.sort(function (a, b) { return a.p.y - b.p.y; });
    for (let i = 0; i < drawList.length; i++) {
      const r = drawList[i];
      if (r.isBoss) drawBossPart(r); else drawPlant(r);
    }
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
  // Big drops (crit system): one large teardrop per run.drops entry, falling from the cloud to its target
  // with gravity-like ease-in. Drawn flat in the same two blues as the rain streaks.
  const BIG_R = 6.5;
  function drawBigDrops(run) {
    const list = run.drops;
    if (!list || !list.length) return;
    const cr = run.cloud.r;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const u = clamp(d.t / (d.fall || 0.3), 0, 1), e = u * u;
      // Falls straight down from the cloud's underside (drawn above the pointer), like the normal rain
      const top = Math.min(d.y, cloudDrawY(d.sy, cr) + cr * (CLOUD_BOTTOM - 0.12));
      const px = d.x, py = top + (d.y - top) * e;
      // Faint landing mark on the ground that tightens as the drop nears
      ctx.globalAlpha = 0.22 * u;
      ctx.strokeStyle = P.rainB;
      ctx.lineWidth = 1.5;
      const mr = BIG_R * (2.4 - 1.2 * u);
      ctx.beginPath(); ctx.ellipse(d.x, d.y, mr, mr * 0.4, 0, 0, 6.283); ctx.stroke();
      // Teardrop: point up, round belly down, a little longer the faster it falls
      const r = BIG_R * (0.55 + 0.45 * Math.min(1, u * 3)), tail = r * (2.3 + 1.2 * e);
      ctx.globalAlpha = 1;
      ctx.fillStyle = P.rainB;
      ctx.beginPath();
      ctx.moveTo(px, py - tail);
      ctx.quadraticCurveTo(px + r * 1.05, py - r * 0.9, px + r, py);
      ctx.arc(px, py, r, 0, Math.PI);
      ctx.quadraticCurveTo(px - r * 1.05, py - r * 0.9, px, py - tail);
      ctx.fill();
      ctx.fillStyle = P.rainA;
      ctx.beginPath(); ctx.ellipse(px - r * 0.35, py - r * 0.1, r * 0.28, r * 0.5, 0.2, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Landing of a big drop: small splash for a normal one, a burst + "Kritik!" for a crit.
  function dropEvent(e) {
    const x = e.x, y = e.y;
    addSplash(splashes, x, y);
    if (!e.crit) return;   // a non-crit big drop lands like a normal raindrop
    for (let i = 0; i < 14 && particles.length < MAX_PARTICLES; i++) {
      const a = -Math.PI * (0.1 + 0.8 * Math.random()), sp = 70 + Math.random() * 90;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: 0.35 + Math.random() * 0.2,
        r: 1.8 + Math.random() * 1.2, color: i & 1 ? P.rainA : P.splash, g: 320 });
    }
    addRing(x, y, 4, 40, 0.45, P.splash, 3);
    addRing(x, y, 2, 24, 0.35, P.rainB, 2);
    shake(2, 0.12);
    addPopup(x, y - 22, 'Kritik!', { size: 21, life: 1.1, color: '#e8f5ff', edge: 'rgba(20,44,78,0.9)' });
  }

  function drawRain(dt, run) {
    const top = cloudDrawY(run.cloud.y, run.cloud.r) + run.cloud.r * (CLOUD_BOTTOM - 0.12);
    stepRain(ctx, drops, dt, run.cloud.x, run.cloud.y, run.rainRadius, top, onRainHit);
  }

  // ---------- mini clouds, sudden shower, moist vapor (all guarded: fields may be missing) ----------
  let miniDrops = [];                 // one rain drop list per mini cloud (index-keyed)
  let showerR = null;                 // render state of the shower: { x, y, r, a (cloud/rain fade), warn (shadow 0..1), drops }
  const vapor = [];                   // rising wisps over moist plants
  const MAX_VAPOR = 36;

  function resetWeather() { miniDrops = []; showerR = null; vapor.length = 0; }

  // Warn-phase shadow on the ground (drawn before the plants)
  function drawShowerShadow(run, dt) {
    const sh = run.shower, cfg = (RD.CONFIG && RD.CONFIG.shower) || {};
    if (sh && isFinite(sh.x) && isFinite(sh.y) && sh.r > 0) {
      if (!showerR) showerR = { x: sh.x, y: sh.y, r: sh.r, a: 0, warn: 0, drops: [] };
      showerR.x = sh.x; showerR.y = sh.y; showerR.r = sh.r;
      const wd = cfg.warn || 1.2;
      const target = sh.phase === 'warn' ? clamp((sh.t || 0) / wd, 0, 1) : 1;
      showerR.warn = Math.max(showerR.warn, target);
      showerR.live = true;
      showerR.rain = sh.phase === 'rain';
    } else if (showerR) {
      showerR.live = false; showerR.rain = false;
      showerR.warn = Math.max(0, showerR.warn - dt * 2);   // ~0.5 s fade
    }
    if (!showerR) return;
    const s = showerR, e = 1 - (1 - s.warn) * (1 - s.warn);
    if (s.warn > 0.01) {
      const rr = s.r * (0.6 + 0.4 * e);
      const g = ctx.createRadialGradient(s.x, s.y, rr * 0.2, s.x, s.y, rr);
      g.addColorStop(0, 'rgba(34,28,24,' + (0.30 * e) + ')');
      g.addColorStop(0.75, 'rgba(34,28,24,' + (0.2 * e) + ')');
      g.addColorStop(1, 'rgba(34,28,24,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, rr, rr * 0.7, 0, 0, 6.283); ctx.fill();
    }
  }

  // Rain phase: cloud over the circle with rain across it, fading out once the shower ends
  function drawShowerCloud(run, dt) {
    const s = showerR;
    if (!s) return;
    s.a = clamp(s.a + (s.rain ? dt * 3 : -dt * 2), 0, 1);
    if (s.a <= 0.01) { if (!s.live) showerR = null; return; }
    const cr = ((run.cloud && run.cloud.r) || 50) * 1.1;
    const cy = cloudDrawY(s.y, cr);
    const top = cy + cr * (CLOUD_BOTTOM - 0.12);
    ctx.globalAlpha = s.a;
    stepRain(ctx, s.drops, s.rain ? dt : 0, s.x, s.y, s.r, top, s.rain ? onRainHit : null);
    drawCloudArt(ctx, s.x, cy, cr, 0.2, 0.025, clock);
    ctx.globalAlpha = 1;
  }

  // Small clouds with their own light rain (drawn before the main cloud so the player's stays on top)
  function drawMinis(run, dt) {
    const list = run.minis, cfg = RD.CONFIG && RD.CONFIG.mini;
    if (!list || !list.length || !cfg || !(cfg.r > 0)) { if (miniDrops.length) miniDrops = []; return; }
    if (miniDrops.length !== list.length) { miniDrops = []; for (let i = 0; i < list.length; i++) miniDrops.push([]); }
    const mr = (((run.cloud && run.cloud.r) || 50) * 0.5);
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || !isFinite(m.x) || !isFinite(m.y)) continue;
      const top = cloudDrawY(m.y, mr) + mr * (CLOUD_BOTTOM - 0.12);
      ctx.globalAlpha = 0.85;
      stepRain(ctx, miniDrops[i], dt, m.x, m.y, cfg.r, top, miniHit);
      ctx.globalAlpha = 1;
      drawCloudArt(ctx, m.x, cloudDrawY(m.y, mr), mr, 0.1, 0.02, clock + i * 1.7);
    }
  }
  function miniHit(x, y) { if (Math.random() < 0.15) addSplash(splashes, x, y); }

  // Faint, slow vapor wisps rising from moist plants (cap MAX_VAPOR)
  function drawVapor(run, dt) {
    const pl = run.plants;
    if (pl && dt > 0) {
      for (let i = 0; i < pl.length && vapor.length < MAX_VAPOR; i++) {
        const p = pl[i];
        if (p && p.moist === true && Math.random() < dt * 0.5) {
          vapor.push({ x: p.x + (Math.random() - 0.5) * 18, y: p.y - 2, age: 0, life: 2 + Math.random() * 1.2, ph: Math.random() * 6.283, r: 2.5 + Math.random() * 2 });
        }
      }
    }
    if (!vapor.length) return;
    ctx.fillStyle = '#f3f6ee';
    for (let i = vapor.length - 1; i >= 0; i--) {
      const q = vapor[i];
      q.age += dt;
      if (q.age >= q.life) { vapor.splice(i, 1); continue; }
      const f = q.age / q.life;
      ctx.globalAlpha = 0.16 * Math.sin(f * Math.PI);
      const x = q.x + Math.sin(q.ph + q.age * 1.6) * 4, y = q.y - q.age * 13;
      ctx.beginPath(); ctx.ellipse(x, y, q.r * (0.8 + f), q.r * (1.2 + f * 0.8), 0, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- boss flower (PRD §12) ----------
  // Ground decals (cracks, roots, rings, thorn vines) are drawn before the plants; the boss bodies join
  // the plants' y-sorted draw list; gauges that must stay readable under the cloud are drawn after it.
  // All visual state is derived from run.boss every frame (events only add bursts/popups).
  const BOSS_SIZE = { arms: 96, shield: 104, shade: 112 };
  const BOSS_ENTER = 0.9;        // s: plant shoots up after the spawn
  const BOSS_FLOOR = 0.55;       // displayed growth at 0 water, so a boss looks big from the start
  const VINE_N = 14, VINE_PTS = 9;
  const BP = {
    root: '#6e5236', rootL: '#8f7150', rootOn: '#6f9a52',
    mound: '#9a7f5c', moundL: '#ad9370',
    dry: '#8a5a2e', dryFill: 'rgba(140,96,52,', flake: '#a07a4a',
    vine: '#4a6634', vineL: '#6d8a4a', thorn: '#6b4a2e', thornHot: '#c0533a', leaf: '#5f8a45',
    ringBg: 'rgba(30,24,36,0.28)', ringWater: '#a9d6f5', ringLose: '#e9a15a', ringDone: '#f4c35c',
    heat0: '#f3d27c', heat1: '#e0603a',
  };
  const PETAL_COLS = ['#f6bf34', '#fbf7ee', '#e0617f', '#ea7a4a', '#ad8fdb', '#97d68b'];
  const MAX_PETALS = 360, MAX_RINGS = 40;
  let petals = [], rings = [];
  let shakeT = 0, shakeDur = 0.3, shakeAmp = 0;
  let B = null;                  // render state of the current boss
  const bossList = [];

  function eBack(t) { const u = t - 1; return 1 + 2.70158 * u * u * u + 1.70158 * u * u; }
  function shake(amp, dur) { if (amp >= shakeAmp * (shakeT / shakeDur || 0)) { shakeAmp = amp; shakeDur = dur; shakeT = dur; } }

  function initBoss(run) {
    const boss = run.boss, cfg = run.level ? run.level.boss : {}, r = rng(((boss.x * 13 + boss.y * 7) | 0) + 99);
    B = { boss: boss, cfg: cfg, kind: boss.kind, parts: [], vines: [], blockT: 0, scorchA: 0, wilt: 0, lean: 0, openA: 0 };
    for (let i = 0; i < boss.parts.length; i++) {
      const q = boss.parts[i], cracks = [];
      for (let k = 0; k < 7; k++) {
        const a = k * 0.898 + r() * 0.5;
        const c = crackPoints(r, q.x + Math.cos(a) * 10, q.y + Math.sin(a) * 6, a, 3, 10 + r() * 7);
        cracks.push({ xs: c.xs, ys: c.ys, wd: 1.6 + r() * 1.2 });
      }
      // Root from the boss centre to each arm: a gentle curve with a random side bend
      const dx = q.x - boss.x, dy = q.y - boss.y, bend = (r() - 0.5) * 0.6;
      B.parts.push({ q: q, cracks: cracks, peak: 0, wilt: 0, doneT: -1, dryA: 0, seed: 7000 + i * 31, flakeT: 0,
        cx: boss.x + dx * 0.5 - dy * bend, cy: boss.y + dy * 0.5 + dx * bend, len: Math.hypot(dx, dy) * 1.1,
        p: { y: q.y }, isBoss: true });
    }
    if (boss.kind === 'shield') {
      const R = cfg.shieldRadius || 110;
      for (let i = 0; i < VINE_N; i++) {
        const a0 = i * 6.283 / VINE_N + (r() - 0.5) * 0.15, span = 6.283 / VINE_N * 1.3;
        const xs = [], ys = [], th = [];
        for (let k = 0; k < VINE_PTS; k++) {
          const a = a0 + span * k / (VINE_PTS - 1), rad = R + Math.sin(k * 1.3 + i * 2.1) * 5 + (r() - 0.5) * 4;
          xs.push(Math.cos(a)); ys.push(Math.sin(a)); th.push(rad);
        }
        // Retract order is scrambled so the ring breaks up unevenly as the soil greens
        B.vines.push({ xs: xs, ys: ys, rad: th, at: ((i * 5) % VINE_N) / VINE_N * 0.8, side: i & 1 });
      }
    }
  }

  function syncBoss(run, dt) {
    if (!run || !run.boss) { B = null; return; }
    if (!B || B.boss !== run.boss) initBoss(run);
    const boss = run.boss, k = Math.min(1, dt * 4);
    for (let i = 0; i < B.parts.length; i++) {
      const bp = B.parts[i], q = bp.q;
      bp.p.y = q.y;
      if (q.done && bp.doneT < 0) bp.doneT = clock;
      // Unwatered arms droop as they lose water (relative to the best they had)
      let target = 0;
      if (q.wet || q.water > bp.peak) bp.peak = q.water;
      if (B.kind === 'arms' && !q.wet && !q.done) target = clamp((bp.peak - q.water) / q.need * 3, 0, 1);
      bp.wilt += (target - bp.wilt) * k;
      bp.dryA += ((B.kind === 'arms' && q.wet ? 1 : 0) - bp.dryA) * Math.min(1, dt * 5);
    }
    if (B.blockT > 0) B.blockT = Math.max(0, B.blockT - dt);
    if (B.kind === 'shield') B.openA += ((boss.shield >= 1 ? 1 : 0) - B.openA) * Math.min(1, dt * 3);
    if (B.kind === 'shade') {
      const heat = clamp(boss.shade / (B.cfg.shadeMax || 1), 0, 1);
      B.wilt += ((boss.scorched ? 1 : heat * 0.35) - B.wilt) * Math.min(1, dt * 3);
      B.scorchA += ((boss.scorched ? 1 : 0) - B.scorchA) * Math.min(1, dt * 4);
      // Leans away from the cloud while it shades the flower (it wants the sun)
      const q = boss.parts[0], dx = run.cloud.x - q.x;
      const over = clamp(1 - Math.abs(dx) / 160, 0, 1) * (q.wet || boss.shade > 0 ? 1 : 0);
      const want = -(dx >= 0 ? 1 : -1) * 0.18 * Math.max(heat, over * 0.5);
      B.lean += (want - B.lean) * Math.min(1, dt * 3);
    }
    // Dry flakes blown out of the ring around a watered arm
    if (B.kind === 'arms') {
      const R = B.cfg.dryRadius || 80;
      for (let i = 0; i < B.parts.length; i++) {
        const bp = B.parts[i];
        if (bp.dryA < 0.5) continue;
        bp.flakeT -= dt;
        if (bp.flakeT > 0 || particles.length >= MAX_PARTICLES) continue;
        bp.flakeT = 0.06;
        const a = Math.random() * 6.283, d = R * (0.3 + Math.random() * 0.65);
        particles.push({ x: bp.q.x + Math.cos(a) * d, y: bp.q.y + Math.sin(a) * d * 0.8, vx: Math.cos(a) * 30, vy: -18 - Math.random() * 12,
          age: 0, life: 0.6, r: 1.4 + Math.random(), color: BP.flake, g: 40 });
      }
    }
  }

  function bossEnter(boss) { return boss.t >= BOSS_ENTER ? 1 : clamp(boss.t / BOSS_ENTER, 0, 1); }

  // Thin ground ring under a boss part: water progress (blue), losing water (orange), done (gold).
  function partRing(x, y, frac, losing, done, rx) {
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = BP.ringBg;
    ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.4, 0, 0, 6.283); ctx.stroke();
    if (frac <= 0.005 && !done) return;
    ctx.strokeStyle = done ? BP.ringDone : (losing ? BP.ringLose : BP.ringWater);
    ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.4, 0, -Math.PI / 2, -Math.PI / 2 + (done ? 1 : frac) * 6.283); ctx.stroke();
  }

  function drawVines(boss) {
    const s = clamp(boss.shield, 0, 1), x0 = boss.x, y0 = boss.y;
    const hot = B.blockT > 0;
    for (let pass = 0; pass < 3; pass++) {
      ctx.beginPath();
      for (let i = 0; i < B.vines.length; i++) {
        const v = B.vines[i];
        const L = 1 - smooth01((s - v.at) / 0.22);
        if (L <= 0.02) continue;
        const n = Math.max(2, Math.round(L * (VINE_PTS - 1)) + 1);
        const wob = hot ? Math.sin(clock * 50 + i) * 1.5 : 0;
        if (pass < 2) {
          for (let k = 0; k < n; k++) {
            const rr = v.rad[k] + wob, px = x0 + v.xs[k] * rr, py = y0 + v.ys[k] * rr;
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
        } else {
          // Thorns: small triangles pointing alternately out and in, plus a leaf every few points
          for (let k = 1; k < n; k++) {
            const rr = v.rad[k] + wob, px = x0 + v.xs[k] * rr, py = y0 + v.ys[k] * rr;
            const sgn = (k + v.side) & 1 ? 1 : -1, nx = v.xs[k] * sgn, ny = v.ys[k] * sgn;
            const tx = -v.ys[k], ty = v.xs[k];
            ctx.moveTo(px + tx * 3, py + ty * 3);
            ctx.lineTo(px + nx * 9.5, py + ny * 9.5);
            ctx.lineTo(px - tx * 3, py - ty * 3);
            ctx.closePath();
          }
        }
      }
      if (pass === 0) { ctx.strokeStyle = BP.vine; ctx.lineWidth = 7.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); }
      else if (pass === 1) { ctx.strokeStyle = BP.vineL; ctx.lineWidth = 2.6; ctx.stroke(); }
      else { ctx.fillStyle = hot ? BP.thornHot : BP.thorn; ctx.fill(); }
    }
    // Leaves
    ctx.fillStyle = BP.leaf;
    ctx.beginPath();
    for (let i = 0; i < B.vines.length; i++) {
      const v = B.vines[i];
      const L = 1 - smooth01((s - v.at) / 0.22);
      if (L < 0.6) continue;
      const k = 4, rr = v.rad[k], px = x0 + v.xs[k] * rr, py = y0 + v.ys[k] * rr;
      const a = Math.atan2(v.ys[k], v.xs[k]) + (v.side ? 0.9 : -0.9);
      ctx.moveTo(px + Math.cos(a) * 7, py + Math.sin(a) * 7);
      ctx.ellipse(px + Math.cos(a) * 3.5, py + Math.sin(a) * 3.5, 6 * L, 2.8 * L, a, 0, 6.283);
    }
    ctx.fill();
  }

  // Ground layer of the boss (before plants).
  function drawBossDecals(run) {
    if (!B) return;
    const boss = run.boss, cfg = B.cfg, t = boss.t, ent = bossEnter(boss);
    // Cracked ground burst under every part; stays faintly as a scar
    const ca = t < 1.6 ? 1 : Math.max(0.4, 1 - (t - 1.6) / 1.5), cp = eBack(clamp(t / 0.35, 0, 1));
    ctx.globalAlpha = ca;
    for (let i = 0; i < B.parts.length; i++) {
      const bp = B.parts[i], q = bp.q;
      ctx.save();
      ctx.translate(q.x, q.y); ctx.scale(cp, cp); ctx.translate(-q.x, -q.y);
      ctx.fillStyle = P.crackLip;
      ctx.beginPath();
      for (let k = 0; k < bp.cracks.length; k++) { const c = bp.cracks[k]; ctx.save(); ctx.translate(0.6, 1.3); crackShape(ctx, c.xs, c.ys, c.wd); ctx.restore(); }
      ctx.fill();
      ctx.fillStyle = P.crack;
      ctx.beginPath();
      for (let k = 0; k < bp.cracks.length; k++) { const c = bp.cracks[k]; crackShape(ctx, c.xs, c.ys, c.wd); }
      ctx.fill();
      ctx.restore();
      // Soil mound the plant grows from
      ctx.fillStyle = BP.mound;
      ctx.beginPath(); ctx.ellipse(q.x, q.y + 1, 22 * ent, 8 * ent, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = BP.moundL;
      ctx.beginPath(); ctx.ellipse(q.x - 4, q.y - 1, 13 * ent, 4.5 * ent, 0, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (B.kind === 'arms') {
      // Roots linking the arms to the queen's heart in the middle (green once that arm is done)
      ctx.lineCap = 'round';
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < B.parts.length; i++) {
          const bp = B.parts[i], q = bp.q;
          ctx.strokeStyle = pass ? BP.rootL : (q.done ? BP.rootOn : BP.root);
          ctx.lineWidth = pass ? 1.6 : 4.5;
          ctx.setLineDash([bp.len * ent, 9999]);
          ctx.beginPath(); ctx.moveTo(boss.x, boss.y); ctx.quadraticCurveTo(bp.cx, bp.cy, q.x, q.y); ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      ctx.fillStyle = BP.root;
      ctx.beginPath(); ctx.ellipse(boss.x, boss.y, 14 * ent, 7 * ent, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = BP.rootL;
      ctx.beginPath(); ctx.ellipse(boss.x - 3, boss.y - 2, 7 * ent, 3 * ent, 0, 0, 6.283); ctx.fill();
      // Dry ring spreading around an arm while it is watered (it dries the plants nearby)
      const R = cfg.dryRadius || 80;
      for (let i = 0; i < B.parts.length; i++) {
        const bp = B.parts[i], q = bp.q, a = bp.dryA;
        if (a < 0.02) continue;
        ctx.fillStyle = BP.dryFill + (0.2 * a).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(q.x, q.y, R, 0, 6.283); ctx.fill();
        ctx.strokeStyle = BP.dry;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        for (let w = 0; w < 2; w++) {
          const ph = (clock * 0.8 + w * 0.5) % 1;
          ctx.globalAlpha = a * (1 - ph) * 0.8;
          ctx.beginPath(); ctx.arc(q.x, q.y, R * (0.25 + 0.75 * ph), 0, 6.283); ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = a * 0.55;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(q.x, q.y, R, 0, 6.283); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else if (B.kind === 'shield') {
      const R = cfg.shieldRadius || 110, s = clamp(boss.shield, 0, 1), fade = 1 - B.openA;
      if (fade > 0.02) {
        // The circle that needs greening: subtle dashed ring + green progress arc along it
        ctx.globalAlpha = fade * ent;
        ctx.strokeStyle = 'rgba(247,237,219,0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 7]);
        ctx.beginPath(); ctx.arc(boss.x, boss.y, R + 14, 0, 6.283); ctx.stroke();
        ctx.setLineDash([]);
        if (s > 0.005) {
          ctx.strokeStyle = '#97d68b';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.arc(boss.x, boss.y, R + 14, -Math.PI / 2, -Math.PI / 2 + s * 6.283); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.save();
      ctx.translate(boss.x, boss.y); ctx.scale(ent, ent); ctx.translate(-boss.x, -boss.y);
      drawVines(boss);
      ctx.restore();
    }

    // Water progress rings at the base of every part
    for (let i = 0; i < B.parts.length; i++) {
      const bp = B.parts[i], q = bp.q;
      const losing = B.kind === 'arms' ? (!q.wet && q.water < bp.peak - 0.05) : (B.kind === 'shade' && boss.scorched);
      partRing(q.x, q.y + 4, clamp(q.water / q.need, 0, 1), losing, q.done, 26 * ent);
    }
  }

  // A boss body in the y-sorted plant list.
  function drawBossPart(bp) {
    const q = bp.q, boss = B.boss, ent = bossEnter(boss);
    const f = clamp(q.water / q.need, 0, 1);
    let size = BOSS_SIZE[B.kind] || 92, growth = BOSS_FLOOR + (1 - BOSS_FLOOR) * f, bloom = 0, wilt = bp.wilt, x = q.x;
    if (q.done) {
      const d = clock - bp.doneT;
      growth = 1; bloom = clamp(d / 0.4, 0, 1); wilt = 0;
      size *= 1 + 0.2 * Math.sin(Math.PI * clamp(d / 0.5, 0, 1));
    }
    if (ent < 1) { size *= Math.max(0.05, eBack(ent)); growth *= clamp(ent * 1.4, 0, 1); }
    let sway = Math.sin(clock * 1.3 + bp.seed) * 0.03;
    if (q.wet) sway += Math.sin(clock * 9 + bp.seed) * 0.02;
    if (B.kind === 'shade') { sway += B.lean; wilt = q.done ? 0 : B.wilt; }
    if (B.kind === 'shield' && B.blockT > 0) x += Math.sin(clock * 70) * 3 * (B.blockT / 0.35);
    const o = floraOpts;
    o.size = size; o.growth = growth; o.bloom = bloom; o.fade = 1; o.wilt = wilt; o.sway = sway; o.seed = bp.seed; o.golden = false;
    if (RD.Flora) RD.Flora.draw(ctx, B.boss.type, x, q.y, o);
  }

  // Readable on top of the cloud: the sunflower's heat gauge and heat shimmer.
  function drawBossOverlay() {
    if (!B || B.kind !== 'shade') return;
    const boss = B.boss, q = boss.parts[0];
    if (q.done) return;
    const size = BOSS_SIZE.shade, ent = bossEnter(boss);
    const heat = clamp(boss.shade / (B.cfg.shadeMax || 1), 0, 1);
    const hx = q.x + Math.sin(B.lean) * size * 0.8, hy = q.y - size * 0.82 * ent;
    // Heat shimmer: wavy lines rising off the head while scorched
    if (B.scorchA > 0.02) {
      ctx.strokeStyle = 'rgba(255,205,140,' + (0.65 * B.scorchA).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const bx = hx - 27 + i * 18, ph = (clock * 1.4 + i * 0.27) % 1, y0 = hy - 18 - ph * 26;
        for (let k = 0; k <= 8; k++) {
          const y = y0 - k * 3.2, x = bx + Math.sin(clock * 6 + k * 0.9 + i) * 3;
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    // Heat gauge: small arc above the head (fills with shade; red and blinking when scorched)
    if (heat <= 0.01 && !boss.scorched) return;
    const gx = hx, gy = hy - 36, gr = 13;
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(36,25,18,0.7)';
    ctx.beginPath(); ctx.arc(gx, gy, gr, Math.PI, 2 * Math.PI); ctx.stroke();
    ctx.lineWidth = 3.2;
    const blink = boss.scorched ? 0.55 + 0.45 * Math.sin(clock * 14) : 1;
    ctx.globalAlpha = blink;
    ctx.strokeStyle = mix(BP.heat0, BP.heat1, boss.scorched ? 1 : heat);
    ctx.beginPath(); ctx.arc(gx, gy, gr, Math.PI, Math.PI + Math.max(0.05, boss.scorched ? 1 : heat) * Math.PI); ctx.stroke();
    // Little sun in the middle
    ctx.fillStyle = mix(BP.heat0, BP.heat1, heat);
    ctx.beginPath(); ctx.arc(gx, gy - 1, 3.4, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function addPetals(x, y, n, cols, sp, up) {
    for (let i = 0; i < n && petals.length < MAX_PETALS; i++) {
      const a = Math.random() * 6.283, v = sp * (0.4 + Math.random() * 0.8);
      petals.push({ x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 16, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - up * (0.6 + Math.random() * 0.6),
        rot: Math.random() * 6.283, vr: (Math.random() - 0.5) * 9, w: 2.4 + Math.random() * 1.8, h: 4.5 + Math.random() * 3,
        age: 0, life: 1.4 + Math.random() * 1.1, color: cols[(Math.random() * cols.length) | 0] });
    }
  }
  function addRing(x, y, r0, r1, life, color, w) {
    if (rings.length < MAX_RINGS) rings.push({ x: x, y: y, r0: r0, r1: r1, age: 0, life: life, color: color, w: w });
  }
  function addDirt(x, y, n) {
    for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
      const a = -Math.PI * Math.random(), sp = 60 + Math.random() * 110;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, age: 0, life: 0.5 + Math.random() * 0.4,
        r: 1.6 + Math.random() * 2, color: Math.random() < 0.5 ? P.crack : P.pebble, g: 420 });
    }
  }
  function addPopup(x, y, text, opts) {
    if (popups.length >= MAX_POPUPS) return;
    const o = opts || {};
    popups.push({ x: x, y: y, text: text, age: 0, life: o.life || 1.2, big: true, size: o.size, color: o.color, edge: o.edge });
  }

  function bossEvent(e, run) {
    const boss = run.boss, col = boss ? (C.plants[boss.type] || {}).bloom || '#f4c35c' : '#f4c35c';
    if (e.type === 'bossSpawn') {
      const parts = boss ? boss.parts : [{ x: e.x, y: e.y }];
      for (let i = 0; i < parts.length; i++) {
        addRing(parts[i].x, parts[i].y, 6, 70, 0.6, '#f3e3c0', 4);
        addRing(parts[i].x, parts[i].y, 4, 44, 0.45, P.crack, 3);
        addDirt(parts[i].x, parts[i].y, 18);
      }
      shake(6, 0.4);
    } else if (e.type === 'bossPart') {
      addPetals(e.x, e.y - 60, 26, [col, col, '#f6a072', '#fbf7ee'], 150, 120);
      addRing(e.x, e.y - 50, 10, 60, 0.5, col, 4);
      if (boss) {
        let n = 0;
        for (let i = 0; i < boss.parts.length; i++) if (boss.parts[i].done) n++;
        addPopup(e.x, e.y - 110, n + '/' + boss.parts.length, { size: 20, color: '#fbf7ee', edge: 'rgba(40,30,50,0.8)' });
      }
    } else if (e.type === 'bossBlocked') {
      if (B) B.blockT = 0.35;
      for (let i = 0; i < 10 && particles.length < MAX_PARTICLES; i++) {
        const a = Math.random() * 6.283, sp = 60 + Math.random() * 80;
        particles.push({ x: e.x, y: e.y - 40, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, age: 0, life: 0.35, r: 1.4 + Math.random(),
          color: i & 1 ? BP.thornHot : '#fbe3c4', g: 200 });
      }
      addPopup(e.x, e.y - 112, 'Dikenler!', { size: 16, color: '#ffb4a2', edge: 'rgba(60,20,20,0.8)', life: 0.9 });
      shake(2.5, 0.2);
    } else if (e.type === 'bossScorch') {
      for (let i = 0; i < 12 && particles.length < MAX_PARTICLES; i++) {
        particles.push({ x: e.x + (Math.random() - 0.5) * 40, y: e.y - 70 - Math.random() * 20, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 30,
          age: 0, life: 0.9, r: 2 + Math.random() * 2, color: '#9a8a7a', g: -10 });
      }
      addPopup(e.x, e.y - 128, 'Yandı!', { size: 18, color: '#ffb27a', edge: 'rgba(70,30,10,0.8)' });
      shake(3, 0.25);
    } else if (e.type === 'bossWin') {
      const cols = [col, col].concat(PETAL_COLS);
      addPetals(e.x, e.y - 60, 110, cols, 260, 220);
      if (boss) for (let i = 0; i < boss.parts.length; i++) addPetals(boss.parts[i].x, boss.parts[i].y - 60, 30, cols, 180, 160);
      addRing(e.x, e.y - 40, 10, 150, 0.9, '#fbf7ee', 5);
      addRing(e.x, e.y - 40, 6, 100, 0.7, col, 4);
      addPopup(e.x, e.y - 150, '+' + e.coins, { size: 30, life: 2.2 });
      shake(5, 0.35);
    }
  }

  // ---------- victory wave (boss win, CONTRACTS "victory sweep") ----------
  // A bright green front expands from the boss with radius run.sweep.r; the grass behind it grows in from
  // run.soil (eased by syncSoil), leaves and petals are flung outward from the front.
  const SW = { leaf: ['#7fbf55', '#5f9a4c', '#9fd27a', '#b6e08a'], edge: '#d9f5a8', wash: 'rgba(120,176,80,' };
  let sweepRef = null, sweepFxT = 0;

  function drawSweep(run, dt) {
    const sw = run.sweep;
    if (!sw || sw.done) return;
    if (sweepRef !== sw) { sweepRef = sw; sweepFxT = 0; shake(5, 0.6); }
    const x = sw.x, y = sw.y, r = sw.r;
    if (r <= 1) return;
    // Soft wash behind the front (fills in before the grass tiles catch up) + bright leading band.
    // One radial gradient per frame: cheap, no blur.
    const inner = Math.max(0, r - 90);
    const gr = ctx.createRadialGradient(x, y, inner, x, y, r + 4);
    gr.addColorStop(0, SW.wash + '0)');
    gr.addColorStop(0.55, SW.wash + '0.16)');
    gr.addColorStop(0.9, 'rgba(190,236,130,0.42)');
    gr.addColorStop(1, 'rgba(190,236,130,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 6.283); ctx.fill();
    // Crisp front lines (two widths, fading toward the end of the sweep)
    const endF = clamp((sw.max - r) / 200, 0, 1);
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.35 * endF;
    ctx.strokeStyle = SW.leaf[2];
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, r - 6), 0, 6.283); ctx.stroke();
    ctx.globalAlpha = 0.85 * endF;
    ctx.strokeStyle = SW.edge;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.stroke();
    ctx.globalAlpha = 1;
    // Leaves / petals flung outward from the visible part of the front
    sweepFxT += dt;
    const rate = 1 / 90;   // ~90 per second, capped by MAX_PETALS
    let guard = 0;
    while (sweepFxT >= rate && guard++ < 8) {
      sweepFxT -= rate;
      if (petals.length >= MAX_PETALS) break;
      let px = 0, py = 0, a = 0, ok = false;
      for (let t = 0; t < 4 && !ok; t++) {
        a = Math.random() * 6.283;
        px = x + Math.cos(a) * r; py = y + Math.sin(a) * r;
        ok = px > -10 && px < W + 10 && py > -10 && py < H + 10;
      }
      if (!ok) continue;
      const leaf = Math.random() < 0.65, v = 70 + Math.random() * 110;
      petals.push({ x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - 90 - Math.random() * 70,
        rot: Math.random() * 6.283, vr: (Math.random() - 0.5) * 10, w: leaf ? 2.2 + Math.random() * 1.2 : 2 + Math.random() * 1.4,
        h: leaf ? 5 + Math.random() * 3 : 3.5 + Math.random() * 2.5, age: 0, life: 0.9 + Math.random() * 0.7,
        color: leaf ? SW.leaf[(Math.random() * SW.leaf.length) | 0] : PETAL_COLS[(Math.random() * PETAL_COLS.length) | 0] });
    }
  }

  // ---------- events / fx ----------
  function fmtCombo(c) { return '×' + (Math.round(c * 100) / 100); }

  function handleEvents(run) {
    for (const e of run.events) {
      if (e.type !== 'bloom') {
        if (e.type.indexOf('boss') === 0) bossEvent(e, run);
        else if (e.type === 'drop') dropEvent(e);
        else if (e.type === 'splash') addSplash(splashes, e.x, e.y);
        else if (e.type === 'shower' && isFinite(e.x) && isFinite(e.y)) {
          const R = e.r > 0 ? e.r : 60;
          for (let i = 0; i < 6; i++) {
            const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * R;
            addSplash(splashes, e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.7);
          }
        }
        else if (e.type === 'time' && popups.length < MAX_POPUPS) {
          popups.push({ x: e.x, y: e.y - 70, text: '+' + (e.sec || 1) + ' sn', age: 0, life: 1.2, big: true, color: '#ffe9a8', edge: 'rgba(60,40,10,0.85)' });
        }
        continue;   // 'seedling' and other events need no fx
      }
      const col = C.plants[e.plantType].bloom, ph = (PLANT_SIZE[e.plantType] || 50) * BLOOM_BOOST;
      for (let i = 0; i < 9 && particles.length < MAX_PARTICLES; i++) {
        const a = Math.random() * 6.283, sp = 40 + Math.random() * 60;
        particles.push({ x: e.x, y: e.y - ph * 0.8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, age: 0, life: 0.55 + Math.random() * 0.3, r: 1.8 + Math.random() * 1.6, color: col, g: 220 });
      }
      if (e.rebloom) startRebloom(e, run);
      if (e.victory) {
        // Victory wave bloom: petal pop + gold coin popup
        addPetals(e.x, e.y - ph * 0.7, 10, [col, col, '#fbf7ee', '#f6bf34'], 120, 110);
        addRing(e.x, e.y - ph * 0.6, 4, 34, 0.45, col, 3);
        addPopup(e.x, e.y - ph - 12, '+' + e.coins, { size: 19, life: 1.3, color: '#ffd76a', edge: 'rgba(60,40,10,0.85)' });
      } else if (popups.length < MAX_POPUPS) {
        const mul = e.mul > 1 ? ' ×' + (Math.round(e.mul * 100) / 100) : '';
        const q = { x: e.x, y: e.y - ph - 10, text: '+' + e.coins + mul + (e.combo > 1 ? ' ' + fmtCombo(e.combo) : ''), age: 0, life: 1.1, big: e.combo > 1 || !!mul };
        if (e.golden) { q.color = '#ffc933'; q.edge = 'rgba(80,46,4,0.92)'; q.size = 19; q.life = 1.3; }
        popups.push(q);
      }
      if (e.refund > 0 && !e.victory && popups.length < MAX_POPUPS) {
        popups.push({ x: e.x + 14, y: e.y - 6, text: '+' + e.refund + ' su', age: 0, life: 1.0, big: false, color: '#a9d6f5', edge: 'rgba(20,40,70,0.8)' });
      }
      // A bloom greens a patch around it (run.soil does the real work; this is the visible pop)
      if (!e.victory) {
        const R = (C.bloomGreen && C.bloomGreen.radius) || 44;
        addRing(e.x, e.y, 6, R, 0.5, '#9fd27a', 3);
        for (let i = 0; i < 8 && petals.length < MAX_PETALS; i++) {
          const a = Math.random() * 6.283, d = R * (0.3 + Math.random() * 0.6), v = 30 + Math.random() * 40;
          petals.push({ x: e.x + Math.cos(a) * d, y: e.y + Math.sin(a) * d * 0.6, vx: Math.cos(a) * v, vy: -40 - Math.random() * 40,
            rot: Math.random() * 6.283, vr: (Math.random() - 0.5) * 8, w: 2 + Math.random(), h: 4.5 + Math.random() * 2,
            age: 0, life: 0.6 + Math.random() * 0.3, color: SW.leaf[(Math.random() * SW.leaf.length) | 0] });
        }
        const L = wetL, ci = Math.floor(e.x / CELL), cj = Math.floor(e.y / CELL);
        for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
          if (i >= 0 && j >= 0 && i < L.gw && j < L.gh) L.wet[j * L.gw + i] = Math.min(1, L.wet[j * L.gw + i] + 0.4);
        }
      }
    }
  }

  function drawFx(dt) {
    // Shock rings (ground bursts)
    for (let i = rings.length - 1; i >= 0; i--) {
      const q = rings[i];
      q.age += dt;
      if (q.age >= q.life) { rings.splice(i, 1); continue; }
      const f = q.age / q.life, e = 1 - (1 - f) * (1 - f);
      ctx.globalAlpha = 1 - f;
      ctx.strokeStyle = q.color;
      ctx.lineWidth = q.w * (1 - f * 0.7);
      const r = q.r0 + (q.r1 - q.r0) * e;
      ctx.beginPath(); ctx.ellipse(q.x, q.y, r, r * 0.55, 0, 0, 6.283); ctx.stroke();
    }
    // Petal confetti: tumbling flat petals with a little air drag
    for (let i = petals.length - 1; i >= 0; i--) {
      const q = petals[i];
      q.age += dt;
      if (q.age >= q.life) { petals.splice(i, 1); continue; }
      const drag = Math.max(0, 1 - 1.6 * dt);
      q.vx *= drag; q.vy = q.vy * drag + 230 * dt;
      q.x += q.vx * dt + Math.sin(clock * 3 + i) * 12 * dt;
      q.y += q.vy * dt;
      q.rot += q.vr * dt;
      const f = q.age / q.life;
      ctx.globalAlpha = f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3;
      ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.ellipse(q.x, q.y, q.w, q.h * Math.abs(Math.cos(q.rot * 0.7)) + 0.8, q.rot, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
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
      ctx.font = '700 ' + (q.size || (q.big ? 17 : 15)) + 'px Geist, "JetBrains Mono", system-ui, sans-serif';
      const y = q.y - 26 * (1 - (1 - f) * (1 - f));
      ctx.lineWidth = q.size > 20 ? 4 : 3;
      ctx.strokeStyle = q.edge || P.coinEdge;
      ctx.strokeText(q.text, q.x, y);
      ctx.fillStyle = q.color || P.coin;
      ctx.fillText(q.text, q.x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- growing-garden stage zoom (PRD §19, CONTRACTS "Growing-garden stages") ----------
  // run.js swaps the field inside update() and then freezes for run.zoom.dur s. At the first draw of a new
  // run.zoom the OLD field still lives in render state (recs -> old plant objects, the soak grid + grass
  // cache, linkRecs, fx), so it is re-drawn into three temporary device-px layers:
  //   L0 ground (sand, no vignette)  L1 soil (damp tint + grass)  L2 garden (vines, plants, splashes, fx)
  // No cloud, rain or target in them: those stay live in screen space and keep their size.
  // Then the camera pulls back: the layers shrink by `k` toward the field centre (scale s: 1 -> k) while
  // the NEW world is drawn under the matching camera scale z = s / k (2 -> 1), so its shrunken green core
  // sits where the old field shrinks to and fresh sand slides in from the screen edges. The old sand
  // dissolves into the live sand early, the old garden cross-fades into the real core at the end, the new
  // plants pop in from the centre outward and the cloud swells once ("the cloud grew").
  const ZOOM_POP_AT = 0.5, ZOOM_POP_SPREAD = 0.3, ZOOM_POP_LEN = 0.16;   // plant pop-in windows (zoom progress)
  const ZOOM_TAIL = 0.5;          // s the stage title keeps fading after the freeze ends
  let ZX = null;                  // transition state, see startStageZoom
  let zoomRef = null;             // run.zoom object the transition belongs to

  function smoother(t) { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); }

  function zoomLayer() {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return cv;
  }

  function startStageZoom(run) {
    const SG = C.stages || {};
    let ev = null;
    for (let i = 0; i < run.events.length; i++) if (run.events[i].type === 'stage') { ev = run.events[i]; break; }
    const k = clamp((ev && ev.shrink) || SG.shrink || 0.5, 0.1, 1);
    // Fx of this last update (the bloom that filled the bar, drops) belong to the old field: bake them in too
    handleEvents(run);
    const L0 = zoomLayer(), L1 = zoomLayer(), L2 = zoomLayer();
    paintGround(L0.getContext('2d'), W, H, 1337, true);
    const g1 = L1.getContext('2d');
    drawWet(g1, wetL, 0);
    drawGreen(g1, wetL, 0, dpr, true);          // `all`: flush pending tiles so the layer is complete
    const keep = ctx;
    ctx = L2.getContext('2d');
    try {
      for (const r of linkRecs.values()) if (r.a > 0.003) drawVine(r);
      drawPlants();
      stepSplashes(ctx, splashes, 0);
      drawFx(0);
    } finally { ctx = keep; }
    // Switch the render state to the new field: no old records, ghosts, vines or fx survive the swap
    recs.clear(); drawList.length = 0; linkRecs.clear();
    particles.length = 0; popups.length = 0; splashes.length = 0; petals.length = 0; rings.length = 0;
    resetWeather();
    // The grass only ever grows (syncSoil), so the shrunken soil needs a full rebuild of the layer + cache
    resetWet(wetL);
    soilT = 0;
    syncSoil(wetL, run, 0, true);
    // Queue every grown tile now; they paint over the next frames (burst budget) while the live core is
    // still hidden under the opaque old soil layer (cA = 0 until p = 0.25), so the swap frame stays light
    drawGreen(null, wetL, GREEN_TICK, dpr, false);
    ZX = { run: run, k: k, stage: (ev && ev.stage) || run.stage, of: (ev && ev.of) || run.stageCount,
      time: ev ? ev.time : (SG.timeAdd || 0), L0: L0, L1: L1, L2: L2, p: 0, tail: 0, burst: false, leafT: 0,
      still: reduceMotion, maxD: Math.max(1, Math.hypot(W / 2, H / 2)), s: 1, z: 1 / k, gA: 1, sA: 1 };
  }

  // Progress and curves for this frame (p from run.zoom so a frame can be rendered at any exact moment)
  function zoomStep(run, dt) {
    const Z = ZX, zm = run.zoom;
    Z.p = zm && zm === zoomRef ? clamp(zm.t / (zm.dur || 1), 0, 1) : 1;
    if (Z.p >= 1) Z.tail += dt;
    const p = Z.p, k = Z.k;
    if (Z.still) {
      // Reduced motion: no camera move, the old garden simply dissolves into the new one
      Z.s = 1; Z.z = 1;
      Z.gA = Z.sA = 1 - smooth01((p - 0.25) / 0.6);
    } else {
      Z.s = 1 + (k - 1) * smoother((p - 0.04) / 0.64);   // ends exactly at k, at rest (p = 0.68)
      Z.z = Math.max(1, Z.s / k);
      Z.gA = 1 - smooth01((p - 0.02) / 0.26);            // old sand -> live sand, early
      Z.sA = 1 - smooth01((p - 0.66) / 0.28);            // old garden -> real core, at the end
    }
    Z.cA = Z.still ? 1 : smooth01((p - 0.25) / 0.4);   // live core fades in under the old soil
  }

  // Camera scale about the field centre (world -> device px)
  function worldT(z) {
    const cx = W / 2, cy = H / 2;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, (cx - cx * z) * dpr, (cy - cy * z) * dpr);
  }
  function screenT() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  // One snapshot layer, scaled by s about the field centre, drawn in device px
  function drawZoomLayer(cv, s, a) {
    if (a <= 0.003) return;
    const w = cv.width * s, h = cv.height * s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = a;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cv, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
    ctx.globalAlpha = 1;
    screenT();
  }

  // Ground + soil while the zoom plays (replaces the cached ground blit and updateWet for those frames)
  function drawZoomField(run, dt) {
    const Z = ZX;
    // Live sand, vector at camera scale (crisp at any zoom), then the old sand on top dissolving away
    worldT(Z.z);
    paintGround(ctx, W, H, 1337, true);
    screenT();
    drawZoomLayer(Z.L0, Z.s, Z.gA);
    paintVignette(ctx, W, H);
    // Live damp tint + grass (the shrunken core), under the old soil layer that shrinks onto it. It fades in
    // while the opaque old layer still covers it, so frame 0 matches the last frame and nothing doubles.
    worldT(Z.z);
    ctx.globalAlpha = Z.cA;
    updateWet(dt, null, run);
    ctx.globalAlpha = 1;
    screenT();
    drawZoomLayer(Z.L1, Z.s, Z.sA);
  }

  // Cloud swell factor and brightening (0..1) for the growth beat
  function zoomSwell() {
    if (!ZX || ZX.still || ZX.p >= 1) return { r: 1, glow: 0 };
    const w = clamp((ZX.p - 0.16) / 0.62, 0, 1), b = Math.sin(Math.PI * w);
    // One big swell, then a small settle wobble that ends exactly at rest
    return { r: 1 + 0.2 * b + 0.04 * Math.sin(3 * Math.PI * w) * w, glow: b };
  }

  // Effects of the growth beat, drawn in screen space around the live cloud
  function zoomCloudFx(run, dt) {
    const Z = ZX;
    if (!Z || Z.still || Z.p >= 1) return;
    const c = run.cloud, sw = zoomSwell(), cy = cloudDrawY(c.y, c.r);
    // Soft daylight behind the cloud while it swells
    if (sw.glow > 0.01) {
      const R = c.r * 2.6;
      const gr = ctx.createRadialGradient(c.x, cy, c.r * 0.3, c.x, cy, R);
      gr.addColorStop(0, 'rgba(255,250,236,' + (0.38 * sw.glow) + ')');
      gr.addColorStop(1, 'rgba(255,250,236,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(c.x, cy, R, 0, 6.283); ctx.fill();
    }
    // At the peak: a ring of drops bursts out of the cloud and a gust ring rolls over the ground
    if (!Z.burst && Z.p >= 0.44) {
      Z.burst = true;
      const n = 30;
      for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
        const a = (i / n) * 6.283 + Math.random() * 0.2, sp = 150 + Math.random() * 110;
        particles.push({ x: c.x + Math.cos(a) * c.r * 0.9, y: cy + Math.sin(a) * c.r * 0.45, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 60,
          age: 0, life: 0.55 + Math.random() * 0.35, r: 1.8 + Math.random() * 1.6, color: i & 1 ? P.rainA : P.splash, g: 300 });
      }
      const rr = run.rainRadius || 60;
      addRing(c.x, c.y, rr * 0.4, rr * 2.4, 0.8, P.splash, 3);
      addRing(c.x, c.y, rr * 0.2, rr * 1.5, 0.6, P.rainB, 2);
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * rr;
        addSplash(splashes, c.x + Math.cos(a) * d, c.y + Math.sin(a) * d * 0.7);
      }
    }
    // Leaves lift off the shrinking garden and drift outward (the garden is growing past the old edge)
    if (Z.p > 0.06 && Z.p < 0.62) {
      Z.leafT += dt;
      const rate = 1 / 45, cx = W / 2, cy0 = H / 2, ex = W * 0.5 * Z.s, ey = H * 0.5 * Z.s;
      let guard = 0;
      while (Z.leafT >= rate && guard++ < 4) {
        Z.leafT -= rate;
        if (petals.length >= MAX_PETALS) break;
        const a = Math.random() * 6.283, d = 0.55 + Math.random() * 0.45;
        const x = cx + Math.cos(a) * ex * d, y = cy0 + Math.sin(a) * ey * d, v = 90 + Math.random() * 90;
        const leaf = Math.random() < 0.8;
        petals.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 70 - Math.random() * 60,
          rot: Math.random() * 6.283, vr: (Math.random() - 0.5) * 9, w: 2 + Math.random() * 1.3, h: 4.5 + Math.random() * 3,
          age: 0, life: 0.9 + Math.random() * 0.6,
          color: leaf ? SW.leaf[(Math.random() * SW.leaf.length) | 0] : PETAL_COLS[(Math.random() * PETAL_COLS.length) | 0] });
      }
    }
  }

  // "Aşama 2/3" + "+12 sn": outlined text straight on the scene, centred above the field core
  function drawStageTitle() {
    const Z = ZX, p = Z.p;
    const out = Z.tail > 0 ? 1 - smooth01(Z.tail / ZOOM_TAIL) : 1;
    const inA = smooth01((p - 0.1) / 0.14);
    const a = inA * out;
    if (a <= 0.01) return;
    const x = W / 2, y = clamp(H * 0.3, 120, H / 2 - 60);
    const sc = Z.still ? 1 : 0.8 + 0.2 * eBack(clamp((p - 0.1) / 0.22, 0, 1));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = a;
    ctx.translate(x, y); ctx.scale(sc, sc);
    ctx.font = '800 50px Geist, "JetBrains Mono", system-ui, sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(36,25,18,0.9)';
    ctx.strokeText('Aşama ' + Z.stage + '/' + Z.of, 0, 0);
    ctx.fillStyle = '#f7eddb';
    ctx.fillText('Aşama ' + Z.stage + '/' + Z.of, 0, 0);
    if (Z.time > 0) {
      const b = smooth01((p - 0.2) / 0.14) * out;
      if (b > 0.01) {
        ctx.globalAlpha = b;
        ctx.font = '700 26px Geist, "JetBrains Mono", system-ui, sans-serif';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(60,40,10,0.88)';
        ctx.strokeText('+' + Z.time + ' sn', 0, 48);
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText('+' + Z.time + ' sn', 0, 48);
      }
    }
    ctx.restore();
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
    ZX = null;   // the stage zoom layers no longer match the canvas; the new field just shows
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
    // After a boss run ends the results overlay is translucent: keep the final field (bloomed boss,
    // celebration) frozen behind it instead of switching to the idle backdrop.
    let scene = run, frozen = false;
    if (!run && lastRun && lastRun.over && lastRun.boss && RD.game && RD.game.screen === 'results') { scene = lastRun; frozen = true; }
    if (scene !== lastRun) {
      // New run (or back to idle): drop run-specific effects
      if (scene) resetWet(wetL);
      particles.length = 0; popups.length = 0; drops.length = 0; splashes.length = 0;
      petals.length = 0; rings.length = 0; shakeT = 0; B = null;
      recs.clear(); drawList.length = 0; linkRecs.clear();
      sweepRef = null; soilT = 0; resetWeather();
      ZX = null; zoomRef = null;
      lastRun = scene;
      frozenEvents = false;
    }
    // Stage up: snapshot the old field from render state before anything below switches to the new one
    let eventsDone = false;
    if (scene && !frozen && scene.zoom && scene.zoom !== zoomRef) {
      zoomRef = scene.zoom;
      startStageZoom(scene);
      eventsDone = true;
    }
    if (ZX && (ZX.run !== scene || frozen)) ZX = null;
    if (ZX) zoomStep(scene, dt);
    const zooming = !!(ZX && ZX.p < 1);
    let ox = 0, oy = 0;
    if (shakeT > 0) {
      shakeT = Math.max(0, shakeT - dt);
      const a = shakeAmp * shakeT / shakeDur;
      ox = (Math.random() - 0.5) * 2 * a; oy = (Math.random() - 0.5) * 2 * a;
    }
    ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    if (zooming) drawZoomField(scene, dt);
    else {
      if (ox || oy) ctx.drawImage(ground, -8, -8, W + 16, H + 16);
      else ctx.drawImage(ground, 0, 0, W, H);
      updateWet(dt, scene && !frozen ? scene : null, scene);
    }

    if (scene) {
      updatePlants(dt, scene);
      syncBoss(scene, dt);
      // A finished run is no longer updated, so its last events would repeat every frame
      if ((!frozen || !frozenEvents) && !eventsDone) handleEvents(scene);
      if (frozen) frozenEvents = true;
      const c = scene.cloud;
      if (!frozen) drawSweep(scene, dt);
      drawBossDecals(scene);
      drawTarget(ctx, c.x, c.y, scene.rainRadius, scene.raining);
      const wdt = frozen ? 0 : dt;
      drawShowerShadow(scene, wdt);
      if (zooming) {
        // Old garden shrinking onto the core, then the new world (vines late, plants popping in) at camera scale
        drawZoomLayer(ZX.L2, ZX.s, ZX.sA);
        worldT(ZX.z);
        if (ZX.p > 0.9) drawLinks(scene, dt);
        drawPlants();
        screenT();
      } else {
        drawLinks(scene, frozen ? 0 : dt);
        drawPlants();
      }
      drawVapor(scene, wdt);
      drawSplashFlyers(scene);
      if (scene.raining) drawRain(dt, scene);
      drawBigDrops(scene);
      stepSplashes(ctx, splashes, dt);
      drawMinis(scene, wdt);
      drawShowerCloud(scene, wdt);
      let low = scene.tank > 0 ? 1 - scene.water / scene.tank : 1;
      let cr = c.r;
      if (zooming) {
        // Growth beat: the cloud keeps its size while the world shrinks, and swells once to sell it
        zoomCloudFx(scene, dt);
        const sw = zoomSwell();
        cr *= sw.r;
        low *= 1 - 0.7 * sw.glow;
      }
      // Opaque on purpose: the two flat layers would show a seam if drawn translucent
      drawCloud(c.x, c.y, cr, low, scene.raining ? 0.03 : 0.012);
      drawBossOverlay();
      // Behind the results panel: no floating text (the celebration already played during the win hold)
      if (frozen) popups.length = 0;
    } else {
      // Idle backdrop: one slowly drifting cloud
      const x = W * (0.5 + 0.32 * Math.sin(clock * 0.12));
      const y = H * (0.3 + 0.06 * Math.sin(clock * 0.2 + 1)) + cloudLift();
      drawCloud(x, y, 52, 0.25, 0.015);
    }
    drawFx(dt);
    if (ZX) {
      drawStageTitle();
      if (ZX.p >= 1 && ZX.tail >= ZOOM_TAIL) ZX = null;   // done: drop the snapshot layers
    }
  }

  RD.Render = {
    init: init, resize: resize, fieldSize: fieldSize, draw: draw,
    // Shared scenery painters (used by flora-preview.html); all take an explicit ctx, no module state.
    art: {
      paintGround: paintGround,
      createWet: createWet, wetDisc: wetDisc, drawWet: drawWet,
      drawGreen: drawGreen, resetWet: resetWet,   // drawGreen(ctx, L, dt, dpr, all): cached living grass
      drawCloud: drawCloudArt, cloudBottom: CLOUD_BOTTOM,
      drawTarget: drawTarget,
      stepRain: stepRain, stepSplashes: stepSplashes, addSplash: addSplash,
    },
  };
})(window.RD = window.RD || {});
