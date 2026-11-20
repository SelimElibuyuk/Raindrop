// Flat vector flowers drawn in code (no sprites).
//   RD.Flora.draw(ctx, type, x, y, opts)  (x, y) = ground point
//     opts = { size, growth 0..1, bloom 0..1, fade 0..1, wilt 0..1, sway (rad), seed }
//   RD.Flora.icon(type, px) -> data URL of the fully bloomed plant (cached)
// Style: flat fills, no outlines, one lighter/darker tone per part, side view standing on the ground.
// Each design lives in its own unit space (ground at 0, up is -y) and is scaled so the fully grown
// plant is opts.size px tall. Every part is a continuous function of growth/bloom/wilt, so the
// growth animation never steps; ~25 plants at 60 fps need no offscreen caching.
(function (RD) {
  'use strict';

  const TAU = Math.PI * 2;
  const DRY = '#a88c63';                   // wilt colour target: dry straw brown
  const SHADOW = 'rgba(52,36,24,0.22)';
  const WSTEPS = 12;                       // wilt colour quantization steps
  const WILT_MIX = 0.72;                   // how far a fully wilted plant moves toward DRY
  const EMPTY = {};

  // ---------- math ----------
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function ph(g, a, b) { return clamp01((g - a) / (b - a)); }       // phase of g inside [a, b]
  function eOut(t) { const u = 1 - t; return 1 - u * u * u; }
  function eInOut(t) { return t * t * (3 - 2 * t); }
  function eBack(t) { const u = t - 1; return 1 + 2.70158 * u * u * u + 1.70158 * u * u; } // overshoot ~1.1
  function hash(seed, k) {
    let h = (Math.imul(seed | 0, 374761393) + Math.imul(k | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // Stem height fraction: sprout (0-0.15), stem rises (0.15-0.6), full from 0.6 on (cactus body).
  function stemFrac(g) {
    return g < 0.15 ? 0.1 + 0.13 * (g / 0.15) : (g < 0.6 ? 0.23 + 0.77 * ((g - 0.15) / 0.45) : 1);
  }
  // Per-type stem height fraction: 0.1 at g = 0, full at g = end. curve < 1 shoots up early (sunflower),
  // curve > 1 stays low and bolts late (daisy), so the types reach different heights at every stage.
  function stemF(g, end, curve) {
    const t = g >= end ? 1 : g / end;
    return 0.1 + 0.9 * (curve === 1 ? t : Math.pow(t, curve));
  }
  // Shared bud timing (all types): buds appear from 0.3 and reach full size at 1. The flower colour
  // shows faintly as soon as the bud appears, is clear by 0.5 and strong by 0.7 (both are 1 at g = 1).
  function budG(g) { return eOut(ph(g, 0.3, 1)); }
  function tintG(g) { return 0.3 * ph(g, 0.3, 0.4) + 0.7 * ph(g, 0.4, 0.72); }

  // ---------- colour ----------
  const rgbCache = {};
  function rgbOf(hex) {
    let c = rgbCache[hex];
    if (!c) {
      const n = parseInt(hex.slice(1), 16);
      c = rgbCache[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return c;
  }
  function hex2(v) { const s = Math.round(v).toString(16); return s.length < 2 ? '0' + s : s; }
  function mixHex(a, b, t) {
    const x = rgbOf(a), y = rgbOf(b);
    return '#' + hex2(x[0] + (y[0] - x[0]) * t) + hex2(x[1] + (y[1] - x[1]) * t) + hex2(x[2] + (y[2] - x[2]) * t);
  }
  let WS = 0;                              // wilt step of the plant being drawn
  const colCache = {};
  // Palette colour with the current wilt applied.
  function col(hex) {
    if (!WS) return hex;
    const k = hex + WS;
    return colCache[k] || (colCache[k] = mixHex(hex, DRY, WS / WSTEPS * WILT_MIX));
  }
  // a -> b by t (quantized), then wilt.
  function mixc(a, b, t) {
    const q = Math.round(clamp01(t) * 24);
    if (q === 0) return col(a);
    if (q === 24) return col(b);
    const k = a + b + q + '|' + WS;
    let c = colCache[k];
    if (!c) {
      c = mixHex(a, b, q / 24);
      if (WS) c = mixHex(c, DRY, WS / WSTEPS * WILT_MIX);
      colCache[k] = c;
    }
    return c;
  }

  // ---------- primitives (append to the current path) ----------
  function circ(ctx, x, y, r) {
    if (r <= 0.05) return;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
  function ell(ctx, x, y, rx, ry, rot) {
    if (rx <= 0.05 || ry <= 0.05) return;
    ctx.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
    ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  }
  // Pointed petal/leaf. a = direction (0 = up, + = clockwise), r0 = distance of the base from (cx, cy),
  // wid ~ half width, round = tip fullness, side: 0 whole, 1 / -1 only that half (straight midrib),
  // c1f = where the base bulge sits along the length (small = round, cup-like base).
  function petalPath(ctx, cx, cy, a, r0, len, wid, round, side, c1f) {
    if (len <= 0.05) return;
    const dx = Math.sin(a), dy = -Math.cos(a), nx = -dy, ny = dx;
    const bx = cx + dx * r0, by = cy + dy * r0, tx = bx + dx * len, ty = by + dy * len;
    const c1 = (c1f || 0.25) * len, c2 = 0.78 * len, w2 = wid * round;
    ctx.moveTo(bx, by);
    if (side >= 0) ctx.bezierCurveTo(bx + dx * c1 + nx * wid, by + dy * c1 + ny * wid, bx + dx * c2 + nx * w2, by + dy * c2 + ny * w2, tx, ty);
    else ctx.lineTo(tx, ty);
    if (side <= 0) ctx.bezierCurveTo(bx + dx * c2 - nx * w2, by + dy * c2 - ny * w2, bx + dx * c1 - nx * wid, by + dy * c1 - ny * wid, bx, by);
    else ctx.lineTo(bx, by);
  }
  function fillPath(ctx, c) { ctx.fillStyle = c; ctx.fill(); }
  // Two-tone leaf: light leaf, darker lower half.
  function leaf(ctx, x, y, a, len, wid, cL, cD, round, c1f) {
    if (len < 0.4) return;
    const r = round || 0.55;
    ctx.beginPath(); petalPath(ctx, x, y, a, 0, len, wid, r, 0, c1f); fillPath(ctx, cL);
    ctx.beginPath(); petalPath(ctx, x, y, a, 0, len, wid, r, a < 0 ? -1 : 1, c1f); fillPath(ctx, cD);
  }

  // ---------- stem (one quadratic curve, shared state to avoid allocations) ----------
  const st = { x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0 };
  const pt = { x: 0, y: 0, a: 0 };
  // Upright stem of height h with a small sideways bend; wilt bends it over and down.
  function setStem(h, bend, w) {
    st.x0 = 0; st.y0 = 0;
    st.x1 = bend + h * 0.55 * w; st.y1 = -h * (1 - 0.33 * w);
    st.cx = bend * 0.25 + h * 0.06 * w; st.cy = -h * (0.62 - 0.05 * w);
  }
  // Point and direction (0 = up) on the stem at t.
  function stemAt(t) {
    const u = 1 - t;
    pt.x = u * u * st.x0 + 2 * u * t * st.cx + t * t * st.x1;
    pt.y = u * u * st.y0 + 2 * u * t * st.cy + t * t * st.y1;
    const dx = 2 * u * (st.cx - st.x0) + 2 * t * (st.x1 - st.cx);
    const dy = 2 * u * (st.cy - st.y0) + 2 * t * (st.y1 - st.cy);
    pt.a = (dx === 0 && dy === 0) ? 0 : Math.atan2(dx, -dy);
  }
  function strokeStem(ctx, width, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(st.x0, st.y0);
    ctx.quadraticCurveTo(st.cx, st.cy, st.x1, st.y1);
    ctx.stroke();
  }
  // Seed leaves (sprout): there from the start, they shrink away as real leaves take over (gone by 0.6).
  // Each type has its own shape (pair or single blade, size, spread) and the tips are tinted in the
  // flower's colour, so even a fresh sprout tells its type at a glance.
  // Q = [count (1 = single upright blade, 2 = pair), length, width, roundness, spread angle,
  //      anchor height on the stem in design units (0 = at the ground)]
  function seedLeaves(ctx, S, h, cL, cD, Q, leafHex, tipHex) {
    const g = S.g;
    const k = (0.7 + 0.3 * eOut(ph(g, 0, 0.12))) * (1 - eInOut(ph(g, 0.34, 0.6)));
    if (k <= 0.02) return;
    stemAt(h > 0 ? Math.min(1, Q[5] / h) : 1);
    const len = Q[1] * k, wid = Q[2] * k, rnd = Q[3];
    const open = Q[4] * (0.45 + 0.55 * eOut(ph(g, 0, 0.14))) + S.w * 0.5;
    const cT = mixc(leafHex, tipHex, 0.85);
    if (Q[0] === 1) {
      seedLeaf(ctx, pt.x, pt.y, pt.a + open, len, wid, rnd, cL, cD, cT);
    } else {
      seedLeaf(ctx, pt.x, pt.y, pt.a - open, len, wid, rnd, cL, cD, cT);
      seedLeaf(ctx, pt.x, pt.y, pt.a + open, len, wid, rnd, cL, cD, cT);
    }
  }
  // One seed leaf with a coloured tip (the outer ~half of the leaf, inset so it stays inside the outline).
  function seedLeaf(ctx, x, y, a, len, wid, rnd, cL, cD, cT) {
    leaf(ctx, x, y, a, len, wid, cL, cD, rnd);
    if (len < 2) return;
    ctx.beginPath(); petalPath(ctx, x, y, a, len * 0.45, len * 0.55, wid * 0.7, rnd, 0); fillPath(ctx, cT);
  }
  // Seed leaf shapes per type (see seedLeaves for the fields).
  const SEED_DAISY = [2, 10, 6.6, 0.95, 1.4, 4];       // round spoon pair lying almost flat
  const SEED_TULIP = [1, 19, 7, 0.6, 0.1, 0];          // one broad upright blade
  const SEED_LAV = [2, 13, 2.6, 0.5, 0.45, 9];         // narrow needle V
  const SEED_BELL = [1, 18, 3.2, 0.5, 0.45, 0];        // one thin leaning blade
  const SEED_ROSE = [2, 10, 5.6, 0.8, 0.95, 9];        // small oval pair (on a bronze stem)
  const SEED_SUN = [2, 16, 8.8, 0.85, 1.05, 12];       // big thick oval pair
  const SEED_LILY = [1, 25, 3.2, 0.45, 0.05, 0];       // one long straight spear
  // Moves to the stem tip and rotates for the flower head (follows the stem, droops when wilted).
  function toHead(ctx, follow, droop, w) {
    stemAt(1);
    ctx.translate(pt.x, pt.y);
    ctx.rotate(pt.a * follow + w * droop);
  }

  // ---------- designs ----------
  // Cactus: round barrel; its body is the "stem". Ribs are tonal lenses, crown of small yellow flowers.
  function ribLens(ctx, W, H, u, t) {
    const xb = u * W * 0.34, yb = -H * 0.05, xt = u * W * 0.1, yt = -H * 0.95;
    const cx = 2 * (u * W * 0.5) - (xb + xt) / 2, cy = -H - (yb + yt) / 2;
    ctx.moveTo(xb, yb);
    ctx.quadraticCurveTo(cx + t, cy, xt, yt);
    ctx.quadraticCurveTo(cx - t, cy, xb, yb);
  }
  const RIBS = [-0.72, -0.18, 0.28, 0.72];
  function barrel(ctx, W, H, P, spines) {
    ctx.beginPath();
    ctx.moveTo(-W * 0.36, 0);
    ctx.bezierCurveTo(-W * 0.58, -H * 0.22, -W * 0.56, -H * 0.97, 0, -H);
    ctx.bezierCurveTo(W * 0.56, -H * 0.97, W * 0.58, -H * 0.22, W * 0.36, 0);
    ctx.closePath();
    fillPath(ctx, col(P.body));
    const k = W / 44;
    ctx.beginPath(); ribLens(ctx, W, H, -0.44, 3.4 * k); fillPath(ctx, col(P.bodyL));
    ctx.beginPath();
    for (let i = 0; i < RIBS.length; i++) ribLens(ctx, W, H, RIBS[i], 1.1 * k);
    fillPath(ctx, col(P.bodyD));
    if (!spines || W < 14) return;
    ctx.beginPath();
    for (let i = 0; i < RIBS.length; i++) {
      const u = RIBS[i], xb = u * W * 0.34, yb = -H * 0.05, xt = u * W * 0.1, yt = -H * 0.95;
      const cx = 2 * (u * W * 0.5) - (xb + xt) / 2, cy = -H - (yb + yt) / 2;
      for (let j = 0; j < 3; j++) {
        const t = 0.28 + j * 0.24, v = 1 - t;
        circ(ctx, v * v * xb + 2 * v * t * cx + t * t * xt, v * v * yb + 2 * v * t * cy + t * t * yt, 0.85 * k);
      }
    }
    fillPath(ctx, col(P.spine));
  }
  const CACTUS_CROWN = [[-0.3, 0.93, 0.8], [0, 1.0, 1], [0.3, 0.93, 0.8]];
  function drawCactus(ctx, S, P) {
    const g = S.g, w = S.w, e = stemFrac(g);
    const W = (8 + 30 * e) * (1 + 0.06 * w), H = (7 + 41 * e) * (1 - 0.18 * w);
    barrel(ctx, W, H, P, true);
    // Small pup in front on some plants
    if (S.r3 < 0.6) {
      const pk = eOut(ph(g, 0.4, 0.75));
      if (pk > 0.02) {
        ctx.save(); ctx.translate(W * 0.42, 1); ctx.scale(pk * 0.4, pk * 0.4 * (1 - 0.15 * w));
        barrel(ctx, 38, 40, P, false);
        ctx.restore();
      }
    }
    // Seedling nubs on top (cactus seed leaves)
    const nk = (0.5 + 0.5 * eOut(ph(g, 0, 0.1))) * (1 - eInOut(ph(g, 0.12, 0.32)));
    if (nk > 0.02) {
      leaf(ctx, -0.5, -H + 1, -0.85, 5 * nk, 3 * nk, col(P.bodyL), col(P.body), 0.9);
      leaf(ctx, 0.5, -H + 1, 0.85, 5 * nk, 3 * nk, col(P.bodyL), col(P.body), 0.9);
    }
    // Crown: buds, then small flowers
    const bs = budG(g), b = S.b, o = eBack(b);
    if (bs <= 0.01) return;
    const tint = 0.8 * tintG(g) + 0.4 * b;
    const bud = bs * (1 - ph(b, 0, 0.5));
    for (let j = 0; j < 3; j++) {
      const c = CACTUS_CROWN[j], x = c[0] * W, y = -H * c[1] - 0.5, s = c[2];
      if (bud > 0.01) {
        ctx.beginPath(); circ(ctx, x, y, 2.7 * bud * s); fillPath(ctx, mixc(P.bodyL, P.flower, tint));
      }
      if (b > 0) {
        const rot = j * 0.5 + (1 - Math.min(1, o)) * 0.8;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) petalPath(ctx, x, y, rot + i * TAU / 6, 0.5 * o, 5.2 * o * s, 2.3 * o * s, 0.95, 0);
        fillPath(ctx, col(P.flower));
        ctx.beginPath();
        for (let i = 0; i < 6; i += 2) petalPath(ctx, x, y, rot + i * TAU / 6, 0.5 * o, 5.2 * o * s, 2.3 * o * s, 0.95, 1);
        fillPath(ctx, col(P.flowerD));
        ctx.beginPath(); circ(ctx, x, y, 1.6 * Math.min(1, o) * s); fillPath(ctx, col(P.center));
      }
    }
  }

  // Daisy: low leaf rosette, slim stem, white petal disc with a yellow centre.
  const DAISY_A = [-1.25, 1.2, -0.7, 0.62, -0.12];
  function drawDaisy(ctx, S, P) {
    // Stays a low, wide rosette for long; the stem bolts late.
    const g = S.g, w = S.w, sf = stemF(g, 0.85, 2.2), h = 56 * sf;
    const cL = col(P.leaf), cD = col(P.leafD);
    for (let i = 0; i < 5; i++) {
      const u = eOut(ph(g, 0.05 + i * 0.06, 0.25 + i * 0.06));
      if (u <= 0) continue;
      const a0 = DAISY_A[i] + (S.rnd(20 + i) - 0.5) * 0.25;
      const a = a0 * (0.5 + 0.5 * u) + (a0 < 0 ? -1 : 1) * w * 0.45;
      leaf(ctx, a0 * 1.4, 0, a, (18 + 6 * S.rnd(30 + i)) * u, 6.2 * u, cL, cD, 0.7);
    }
    setStem(h, (S.r1 - 0.5) * 7 * sf, w);
    strokeStem(ctx, 2.8, col(P.stem));
    seedLeaves(ctx, S, h, cL, cD, SEED_DAISY, P.leaf, P.petal);
    const u = eOut(ph(g, 0.5, 0.72));
    if (u > 0) { stemAt(0.42); leaf(ctx, pt.x, pt.y, pt.a + 0.85 + w * 0.5, 12 * u, 4 * u, cL, cD); }

    toHead(ctx, 0.7, 0.8, w);
    const bs = budG(g), b = S.b, o = eBack(b);
    const bud = bs * (1 - ph(b, 0, 0.45));
    if (bud > 0.01) {
      const r = 5.4 * bud, tint = tintG(g);
      ctx.beginPath(); circ(ctx, 0, -r * 0.8, r); fillPath(ctx, col(P.bud));
      if (tint > 0) { ctx.beginPath(); ell(ctx, 0, -r * 1.25, r * 0.72, r * 0.55 * (0.5 + 0.5 * tint), 0); fillPath(ctx, mixc(P.bud, P.petal, tint)); }
      ctx.beginPath(); ctx.moveTo(-r, -r * 0.8); ctx.arc(0, -r * 0.8, r, Math.PI, 0, true); ctx.closePath(); fillPath(ctx, col(P.leafD));
    }
    if (b > 0) {
      ctx.translate(0, -2 * Math.min(1, o));
      ctx.scale(1, 0.88);
      const n = 12, rot = (1 - Math.min(1, o)) * 0.7 + S.r2 * 0.5;
      const len = 13 * o, wid = 3.3 * o, r0 = 2.6 * o;
      ctx.beginPath();
      for (let i = 0; i < n; i++) petalPath(ctx, 0, 0, rot + (i + 0.5) * TAU / n, r0, len * 0.92, wid, 0.95, 0);
      fillPath(ctx, col(P.petalD));
      ctx.beginPath();
      for (let i = 0; i < n; i++) petalPath(ctx, 0, 0, rot + i * TAU / n, r0, len, wid, 0.95, 0);
      fillPath(ctx, col(P.petal));
      const cr = 5.2 * (0.35 + 0.65 * Math.min(1, o));
      ctx.beginPath(); circ(ctx, 0, 0, cr); fillPath(ctx, col(P.center));
      ctx.beginPath(); ctx.moveTo(cr, 0); ctx.arc(0, 0, cr, 0, Math.PI); ctx.closePath(); fillPath(ctx, col(P.centerD));
    }
  }

  // Tulip: two broad leaves, cup flower that opens from a closed egg.
  function drawTulip(ctx, S, P) {
    // Broad leaves come first and dominate; the stem stays short until the egg bud rises.
    const g = S.g, w = S.w, sf = stemF(g, 0.75, 1.4), h = 56 * sf;
    const cL = col(P.leaf), cD = col(P.leafD);
    setStem(h, (S.r1 - 0.5) * 6 * sf, w);
    strokeStem(ctx, 3.3, col(P.stem));
    seedLeaves(ctx, S, h, cL, cD, SEED_TULIP, P.leaf, P.petal);
    const u1 = eOut(ph(g, 0.03, 0.3)), u2 = eOut(ph(g, 0.12, 0.4));
    if (u1 > 0) leaf(ctx, -1, 0, (-0.3 - 0.2 * S.r3) * (0.6 + 0.4 * u1) - w * 0.5, 40 * u1, 10.5 * u1, cL, cD, 0.6);
    if (u2 > 0) leaf(ctx, 1, 0, (0.36 + 0.2 * S.r4) * (0.6 + 0.4 * u2) + w * 0.5, 32 * u2, 9.5 * u2, cL, cD, 0.6);

    toHead(ctx, 0.7, 0.9, w);
    const bs = budG(g), b = S.b, o = eBack(b);
    if (bs <= 0.01) return;
    const reveal = 0.8 * tintG(g) + 0.55 * eOut(ph(b, 0, 0.7));
    const sz = bs * (0.8 + 0.2 * o);
    const spread = 0.34 * o, len = 24 * sz, wid = (8.2 + 1.3 * o) * sz;
    ctx.beginPath();
    petalPath(ctx, 0, 1, -spread, 0, len * 0.94, wid * 0.8, 0.75, 0, 0.08);
    petalPath(ctx, 0, 1, spread, 0, len * 0.94, wid * 0.8, 0.75, 0, 0.08);
    fillPath(ctx, col(P.petalD));
    ctx.beginPath(); petalPath(ctx, 0, 1, 0, 0, len, wid, 0.75, 0, 0.08); fillPath(ctx, col(P.petal));
    ctx.beginPath(); petalPath(ctx, 0, 1, 0, 0, len * 0.92, wid * 0.55, 0.75, -1, 0.08); fillPath(ctx, col(P.petalL));
    greenBase(ctx, 1, len, wid, reveal, P, function () {
      petalPath(ctx, 0, 1, -spread, 0, len * 0.94, wid * 0.8, 0.75, 0, 0.08);
      petalPath(ctx, 0, 1, spread, 0, len * 0.94, wid * 0.8, 0.75, 0, 0.08);
      petalPath(ctx, 0, 1, 0, 0, len, wid, 0.75, 0, 0.08);
    });
  }

  // Bud colouring: the petals are drawn in their real colour, then a green cover (clipped to the bud
  // shape) recedes from the base so the tip shows colour first. reveal 0 = all green, 1 = no green.
  // The right half of the cover uses the darker bud tone.
  function greenBase(ctx, y0, len, wid, reveal, P, shape) {
    if (reveal >= 0.99) return;
    const hgt = len * (1 - reveal) + 0.5;
    ctx.save();
    ctx.beginPath(); shape(); ctx.clip();
    ctx.beginPath(); ell(ctx, 0, y0, Math.max(wid * 2.5, 1), hgt, 0); fillPath(ctx, col(P.bud));
    ctx.beginPath(); ctx.moveTo(0, y0 + 1); ctx.lineTo(0, y0 - hgt);
    ctx.lineTo(wid * 2.5, y0 - hgt); ctx.lineTo(wid * 2.5, y0 + 1); ctx.closePath();
    ctx.save(); ctx.clip(); ctx.beginPath(); ell(ctx, 0, y0, Math.max(wid * 2.5, 1), hgt, 0); fillPath(ctx, col(P.budD)); ctx.restore();
    ctx.restore();
  }

  // Lavender: several thin stems with lilac spikes made of stacked small ovals.
  const LAV_LEAF = [-0.95, 0.85, -0.5, 0.45];
  function drawLavender(ctx, S, P) {
    const g = S.g, w = S.w, b = S.b, o = eBack(b);
    const cL = col(P.leaf), cD = col(P.leafD);
    for (let i = 0; i < 4; i++) {
      const u = eOut(ph(g, 0.05 + i * 0.06, 0.25 + i * 0.06));
      if (u <= 0) continue;
      const a0 = LAV_LEAF[i];
      leaf(ctx, a0 * 2, 0, a0 * (0.55 + 0.45 * u) + (a0 < 0 ? -1 : 1) * w * 0.4, 20 * u, 3.3 * u, cL, cD, 0.5);
    }
    const n = S.r1 < 0.5 ? 4 : 5;
    const tint = 0.85 * tintG(g) + 0.4 * b, swell = 1 + 0.3 * o;
    const cS = col(P.stem), c1 = mixc(P.bud, P.petal, tint), c2 = mixc(P.budD, P.petalD, tint);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1), off = Math.abs(f - 0.5);
      const ang = (f - 0.5) * 0.62 + (S.rnd(40 + i) - 0.5) * 0.1;
      // Side stems follow the centre one closely, so the fan of thin stems reads early.
      const delay = off * 0.06;
      const gi = ph(g, delay, 1);
      const hi = (58 - off * 22 + S.rnd(50 + i) * 6) * stemF(gi, 0.65, 0.85) * (delay > 0 ? eOut(ph(g, delay, delay + 0.1)) : 1);
      if (hi < 0.5) continue;
      ctx.save();
      ctx.rotate(ang + (ang < 0 ? -1 : 1) * w * 0.45);
      setStem(hi, 0, w * 0.6);
      strokeStem(ctx, 1.9, cS);
      if (off < 0.01 || (n === 4 && i === 1)) seedLeaves(ctx, S, hi, cL, cD, SEED_LAV, P.leaf, P.petal);
      const bs = eOut(ph(gi, 0.28, 1));
      if (bs > 0.01) {
        toHead(ctx, 1, 0.4, w);
        const len = 24 * bs;
        ctx.beginPath();
        for (let k = 1; k < 7; k++) {
          const r = (1.45 + 0.16 * k) * bs * swell;
          ell(ctx, r * 0.55, -len * (1 - k / 6) + 1.1 * bs, r * 0.85, r * 1.08, 0.35);
        }
        fillPath(ctx, c2);
        ctx.beginPath();
        for (let k = 0; k < 7; k++) {
          const r = (1.45 + 0.16 * k) * bs * swell;
          ell(ctx, k === 0 ? 0 : -r * 0.55, -len * (1 - k / 6), r * 0.85, r * 1.08, -0.35);
        }
        fillPath(ctx, c1);
      }
      ctx.restore();
    }
  }

  // Bluebell: arching stem with three drooping bells.
  // Bell hangs from (0, 0) with its mouth at y = L; f = 0 closed teardrop bud, 1 = open with flared lobes.
  function bellPath(ctx, L, W, f, half) {
    const hw = W * 0.5, m = hw * (1 + 0.35 * f);
    const yP = L * 0.75 + (L - 1 - L * 0.75) * f;            // outer lip points
    const yQ = L + hw * 0.35 + (-0.6 - hw * 0.35) * f;        // notches between lobes
    const yS = L + hw * 0.25 + (2 - hw * 0.25) * f;           // side lobe control
    const yM = L + hw * 0.5 + (2 - hw * 0.5) * f;             // middle lobe control
    const xS = hw * 0.78, xQ = hw * 0.33;
    if (half === 0) {
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-hw * 1.1, 0, -hw, yP * 0.6, -m, yP);
      ctx.quadraticCurveTo(-xS, yS, -xQ, yQ);
      ctx.quadraticCurveTo(0, yM, xQ, yQ);
      ctx.quadraticCurveTo(xS, yS, m, yP);
      ctx.bezierCurveTo(hw, yP * 0.6, hw * 1.1, 0, 0, 0);
    } else {
      // right half only (darker tone)
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(hw * 1.1, 0, hw, yP * 0.6, m, yP);
      ctx.quadraticCurveTo(xS, yS, xQ, yQ);
      ctx.quadraticCurveTo((xQ) / 2, (yQ + yM) / 2, 0, 0.25 * yQ + 0.5 * yM + 0.25 * yQ);
      ctx.closePath();
    }
  }
  const BB_LEAF_A = [-0.55, 0.3, -0.12], BB_LEAF_L = [30, 26, 35];
  function drawBluebell(ctx, S, P) {
    const g = S.g, w = S.w, b = S.b, o = eBack(b);
    const cL = col(P.leaf), cD = col(P.leafD);
    for (let i = 0; i < 3; i++) {
      const u = eOut(ph(g, 0.06 + i * 0.08, 0.27 + i * 0.08));
      if (u > 0) leaf(ctx, (i - 1) * 1.5, 0, BB_LEAF_A[i] * (0.6 + 0.4 * u) + (BB_LEAF_A[i] < 0 ? -1 : 1) * w * 0.4, BB_LEAF_L[i] * u, 4.3 * u, cL, cD, 0.5);
    }
    const sf = stemF(g, 0.7, 1), h = 88 * sf;
    const A = eInOut(ph(g, 0.2, 0.62));                  // how far the stem arches over (early: the hook reads)
    st.x0 = 0; st.y0 = 0;
    st.cx = 3 * A + h * 0.04 * w; st.cy = -h * (1 + 0.12 * A) * (1 - 0.15 * w);
    st.x1 = h * (0.5 * A + 0.18 * w); st.y1 = -h * (1 - 0.38 * A - 0.2 * w);
    strokeStem(ctx, 2.3, col(P.stem));
    seedLeaves(ctx, S, h, cL, cD, SEED_BELL, P.leaf, P.petal);
    const tint = tintG(g) + 0.5 * b;
    const cB = mixc(P.bud, P.petal, tint), cBD = mixc(P.budD, P.petalD, tint), cS = col(P.stem);
    for (let i = 0; i < 3; i++) {
      const bs = eOut(ph(g, 0.32 + i * 0.08, 0.72 + i * 0.09));
      if (bs <= 0.01) continue;
      stemAt(0.62 + i * 0.18);
      const ex = pt.x + 1.6 * bs, ey = pt.y + 3.6 * bs;
      ctx.strokeStyle = cS; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(ex, ey); ctx.stroke();
      const L = (9 + 5.5 * o) * bs, W = (6.5 + 6 * o) * bs;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(0.22 - i * 0.07 + w * 0.3);
      ctx.beginPath(); bellPath(ctx, L, W, o, 0); fillPath(ctx, cB);
      ctx.beginPath(); bellPath(ctx, L, W, o, 1); fillPath(ctx, cBD);
      ctx.restore();
    }
  }

  // Rose: leafy stem with thorns, layered spiral rose head in dusky pink.
  function compoundLeaf(ctx, x, y, a, len, cS, cL, cD) {
    if (len < 0.5) return;
    const dx = Math.sin(a), dy = -Math.cos(a);
    ctx.strokeStyle = cS; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * len * 0.5, y + dy * len * 0.5); ctx.stroke();
    const mx = x + dx * len * 0.28, my = y + dy * len * 0.28;
    leaf(ctx, mx, my, a - 0.9, len * 0.42, len * 0.2, cL, cD, 0.75);
    leaf(ctx, mx, my, a + 0.9, len * 0.42, len * 0.2, cL, cD, 0.75);
    leaf(ctx, x + dx * len * 0.48, y + dy * len * 0.48, a, len * 0.56, len * 0.26, cL, cD, 0.75);
  }
  const ROSE_LT = [0.3, 0.5, 0.7], ROSE_LS = [-1, 1, -1], ROSE_THORN = [0.2, 0.38, 0.56, 0.8];
  // Back petals seen over the cup rim: angle, length (units of the head radius)
  const ROSE_BACK_A = [-1.2, -0.48, 0.38, 1.12], ROSE_BACK_L = [0.82, 1.0, 1.02, 0.84];
  // Swirl in the open heart: offset, alternately tilted ovals [dx, dy, rx, ry, rot, tone]
  const ROSE_SWIRL = [[0.03, -0.4, 0.5, 0.3, 0, 0], [-0.1, -0.45, 0.34, 0.2, 0.3, 1], [0.08, -0.5, 0.22, 0.13, -0.35, 0], [-0.03, -0.53, 0.1, 0.065, 0.3, 1]];
  // Rose head in side/three-quarter view: back petals, a swirled heart, the cup and two front petals
  // wrapping over each other. Origin = cup centre; cup bottom at y = 0.72 R.
  function roseHead(ctx, R, cP, cPD, cPL) {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) petalPath(ctx, 0, R * 0.2, ROSE_BACK_A[i], 0, R * ROSE_BACK_L[i], R * 0.62, 1.15, 0, 0.3);
    fillPath(ctx, cPD);
    for (let i = 0; i < ROSE_SWIRL.length; i++) {
      const q = ROSE_SWIRL[i];
      ctx.beginPath(); ell(ctx, q[0] * R, q[1] * R, q[2] * R, q[3] * R, q[4]); fillPath(ctx, q[5] ? cPD : cP);
    }
    // Cup body
    ctx.beginPath();
    ctx.moveTo(-0.84 * R, -0.36 * R);
    ctx.quadraticCurveTo(-0.92 * R, 0.6 * R, 0, 0.72 * R);
    ctx.quadraticCurveTo(0.92 * R, 0.6 * R, 0.84 * R, -0.36 * R);
    ctx.quadraticCurveTo(0.4 * R, -0.04 * R, 0, -0.18 * R);
    ctx.quadraticCurveTo(-0.4 * R, -0.04 * R, -0.84 * R, -0.36 * R);
    fillPath(ctx, cP);
    // Front-left petal (light) wraps across the cup ...
    ctx.beginPath();
    ctx.moveTo(-0.84 * R, -0.36 * R);
    ctx.quadraticCurveTo(-0.9 * R, 0.6 * R, 0.06 * R, 0.72 * R);
    ctx.quadraticCurveTo(0.5 * R, 0.5 * R, 0.5 * R, 0.0);
    ctx.quadraticCurveTo(-0.1 * R, 0.16 * R, -0.84 * R, -0.36 * R);
    fillPath(ctx, cPL);
    // ... and the front-right petal (mid tone) overlaps it
    ctx.beginPath();
    ctx.moveTo(0.84 * R, -0.36 * R);
    ctx.quadraticCurveTo(0.92 * R, 0.6 * R, 0, 0.72 * R);
    ctx.quadraticCurveTo(-0.34 * R, 0.6 * R, -0.36 * R, 0.24 * R);
    ctx.quadraticCurveTo(0.28 * R, 0.32 * R, 0.84 * R, -0.36 * R);
    fillPath(ctx, cP);
  }
  function drawRose(ctx, S, P) {
    // Young rose growth is bronze-red (stem and leaves) and greens up by g = 0.95.
    const g = S.g, w = S.w, sf = stemF(g, 0.7, 1), h = 60 * sf;
    const yk = 1 - ph(g, 0.35, 0.95);
    const cL = mixc(P.leaf, P.youngL, 0.8 * yk), cD = mixc(P.leafD, P.youngD, 0.8 * yk), cS = mixc(P.stem, P.young, yk);
    setStem(h, (S.r1 - 0.5) * 8 * sf, w);
    strokeStem(ctx, 3, cS);
    seedLeaves(ctx, S, h, cL, cD, SEED_ROSE, P.youngL, P.petal);
    const tu = eOut(ph(g, 0.18, 0.4));
    if (tu > 0) {
      ctx.beginPath();
      for (let j = 0; j < ROSE_THORN.length; j++) {
        stemAt(ROSE_THORN[j]);
        const sd = j % 2 ? 1 : -1, dx = Math.sin(pt.a), dy = -Math.cos(pt.a), nx = -dy * sd, ny = dx * sd;
        const bx = pt.x + nx * 1.2, by = pt.y + ny * 1.2;
        ctx.moveTo(bx - dx * 1.6, by - dy * 1.6);
        ctx.lineTo(bx + nx * 2.6 * tu + dx * 1.4 * tu, by + ny * 2.6 * tu + dy * 1.4 * tu);
        ctx.lineTo(bx + dx * 0.6, by + dy * 0.6);
        ctx.closePath();
      }
      fillPath(ctx, col(P.thorn));
    }
    for (let i = 0; i < 3; i++) {
      const u = eOut(ph(g, 0.1 + i * 0.1, 0.3 + i * 0.1));
      if (u <= 0) continue;
      stemAt(ROSE_LT[i]);
      compoundLeaf(ctx, pt.x, pt.y, pt.a + ROSE_LS[i] * (0.5 + 0.55 * u + w * 0.4), 17 * u, cS, cL, cD);
    }

    toHead(ctx, 0.7, 0.8, w);
    const bs = budG(g), b = S.b, o = eBack(b);
    const tint = 0.9 * tintG(g) + 0.4 * b;
    const bud = bs * (1 - ph(b, 0.1, 0.6));
    if (bud > 0.01) {
      const bl = 13 * bud, bw = 5.4 * bud;
      ctx.beginPath(); petalPath(ctx, 0, 0, 0, 0, bl, bw, 0.6, 0, 0.15); fillPath(ctx, col(P.petal));
      ctx.beginPath(); petalPath(ctx, 0, 0, 0, 0, bl, bw, 0.6, 1, 0.15); fillPath(ctx, col(P.petalD));
      greenBase(ctx, 0, bl, bw, tint, P, function () { petalPath(ctx, 0, 0, 0, 0, bl, bw, 0.6, 0, 0.15); });
      leaf(ctx, 0, 0, -0.42, 9 * bud, 2.6 * bud, cL, cD, 0.5);
      leaf(ctx, 0, 0, 0.42, 9 * bud, 2.6 * bud, cL, cD, 0.5);
    }
    if (b > 0) {
      const R = 13 * o, oc = Math.min(1, o);
      leaf(ctx, 0, -R * 0.3, -2.1, 8 * o, 2.6 * o, cL, cD, 0.5);
      leaf(ctx, 0, -R * 0.3, 2.1, 8 * o, 2.6 * o, cL, cD, 0.5);
      ctx.rotate((1 - oc) * 0.45);
      ctx.translate(0, -R * 0.66);
      roseHead(ctx, R, col(P.petal), col(P.petalD), col(P.petalL));
    }
  }

  // Sunflower: tall, big leaves, large golden ray disc around a seeded brown centre.
  const SUN_LT = [0.24, 0.44, 0.64], SUN_LS = [-1, 1, -1], SUN_LL = [25, 23, 18], SUN_LW = [12.5, 11.5, 9];
  function drawSunflower(ctx, S, P) {
    // Shoots up fast on a thick stem: the tallest plant early on.
    const g = S.g, w = S.w, sf = stemF(g, 0.6, 0.75), h = 72 * sf;
    const cL = col(P.leaf), cD = col(P.leafD), cS = col(P.stem);
    setStem(h, (S.r1 - 0.5) * 6 * sf, w);
    strokeStem(ctx, 4.4, cS);
    seedLeaves(ctx, S, h, cL, cD, SEED_SUN, P.leaf, P.petal);
    for (let i = 0; i < 3; i++) {
      const u = eOut(ph(g, 0.08 + i * 0.1, 0.32 + i * 0.1));
      if (u <= 0) continue;
      stemAt(SUN_LT[i]);
      const a = pt.a + SUN_LS[i] * (0.45 + 0.8 * u + w * 0.5);
      const dx = Math.sin(a), dy = -Math.cos(a), pl = 4 * u;
      ctx.strokeStyle = cS; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(pt.x + dx * pl, pt.y + dy * pl); ctx.stroke();
      leaf(ctx, pt.x + dx * pl, pt.y + dy * pl, a, SUN_LL[i] * u, SUN_LW[i] * u, cL, cD, 0.7, 0.14);
    }

    toHead(ctx, 0.6, 0.8, w);
    const bs = budG(g), b = S.b, o = eBack(b), oc = Math.min(1, o);
    if (bs <= 0.01 && b <= 0) return;
    ctx.translate(0, -3 * bs);
    ctx.scale(1, 0.92);
    if (b > 0) {
      const n = 16, rot = (1 - oc) * 0.6 + S.r2;
      ctx.beginPath();
      for (let i = 0; i < n; i++) petalPath(ctx, 0, 0, rot + (i + 0.5) * TAU / n, 7 * o, 13.5 * o, 3.6 * o, 0.8, 0);
      fillPath(ctx, col(P.petalD));
      ctx.beginPath();
      for (let i = 0; i < n; i++) petalPath(ctx, 0, 0, rot + i * TAU / n, 7 * o, 12.5 * o, 3.4 * o, 0.8, 0);
      fillPath(ctx, col(P.petal));
    }
    const bud = bs * (1 - ph(b, 0, 0.5));
    if (bud > 0.01) {
      const tint = tintG(g);
      if (tint > 0) {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) petalPath(ctx, 0, 0, (i + 0.5) * TAU / 10, 4 * bud, 4.5 * bud * tint, 1.9 * bud, 0.8, 0);
        fillPath(ctx, col(P.petal));
      }
      ctx.beginPath();
      for (let i = 0; i < 10; i++) petalPath(ctx, 0, 0, i * TAU / 10, 3 * bud, 5.5 * bud, 2.2 * bud, 0.45, 0);
      fillPath(ctx, cL);
    }
    const R = 6 * bs + 3.5 * oc;
    if (R > 0.2) {
      const k = ph(b, 0, 0.5);
      ctx.beginPath(); circ(ctx, 0, 0, R); fillPath(ctx, mixc(P.leafD, P.center, k));
      ctx.beginPath(); circ(ctx, 0, 0, R * 0.6); fillPath(ctx, mixc(P.leafD, P.centerD, k));
      if (b > 0) {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) { const a = i * TAU / 10; circ(ctx, Math.sin(a) * R * 0.8, -Math.cos(a) * R * 0.8, R * 0.09); }
        for (let i = 0; i < 5; i++) { const a = i * TAU / 5 + 0.3; circ(ctx, Math.sin(a) * R * 0.32, -Math.cos(a) * R * 0.32, R * 0.08); }
        fillPath(ctx, mixc(P.leafD, P.seed, k));
      }
    }
  }

  // Skylily: slender tall stem, six-pointed star lily (indigo petals with pale edges) opening from a spear bud.
  const LILY_BACK = [Math.PI, 2 * Math.PI / 3, -2 * Math.PI / 3], LILY_FRONT = [Math.PI / 3, -Math.PI / 3, 0];
  const LILY_STAMEN = [-0.9, -0.45, 0, 0.45, 0.9];
  function lilyLayer(ctx, angs, o, r0, len, wid, edge, cE, cP) {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) petalPath(ctx, 0, 0, angs[i] * o, r0, len + edge * 1.3, wid + edge, 0.7, 0, 0.3);
    fillPath(ctx, cE);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) petalPath(ctx, 0, 0, angs[i] * o, r0 + 0.6, len, wid, 0.7, 0, 0.3);
    fillPath(ctx, cP);
  }
  function drawSkylily(ctx, S, P) {
    // Long blade leaves first, then a very slender stem that keeps rising to the tallest height.
    const g = S.g, w = S.w, sf = stemF(g, 0.85, 1.3), h = 68 * sf;
    const cL = col(P.leaf), cD = col(P.leafD);
    const u1 = eOut(ph(g, 0.04, 0.3)), u2 = eOut(ph(g, 0.14, 0.42));
    if (u1 > 0) leaf(ctx, -1, 0, -0.32 * (0.6 + 0.4 * u1) - w * 0.5, 34 * u1, 4.2 * u1, cL, cD, 0.5);
    if (u2 > 0) leaf(ctx, 1, 0, 0.42 * (0.6 + 0.4 * u2) + w * 0.5, 27 * u2, 3.8 * u2, cL, cD, 0.5);
    setStem(h, (S.r1 - 0.5) * 6 * sf, w);
    strokeStem(ctx, 2.2, col(P.stem));
    seedLeaves(ctx, S, h, cL, cD, SEED_LILY, P.leaf, P.petal);
    const u3 = eOut(ph(g, 0.36, 0.58));
    if (u3 > 0) { stemAt(0.45); leaf(ctx, pt.x, pt.y, pt.a + 0.5 + w * 0.5, 17 * u3, 3.2 * u3, cL, cD, 0.5); }

    toHead(ctx, 0.7, 0.9, w);
    const bs = budG(g), b = S.b, o = eBack(b), oc = Math.min(1, o);
    if (bs <= 0.01) return;
    const tint = Math.min(1, tintG(g) + 0.25 * b);
    const len = 19 * bs * (0.88 + 0.12 * oc), wid = (2.8 + 2 * oc) * bs, r0 = 1.2 * oc;
    const edge = (0.5 + 0.9 * oc) * bs;
    const cE = mixc(P.bud, P.edge, 0.3 * tint + 0.7 * b);
    ctx.scale(1, 1 - 0.12 * oc);
    lilyLayer(ctx, LILY_BACK, o, r0, len, wid, edge, cE, mixc(P.budD, P.petalD, tint));
    lilyLayer(ctx, LILY_FRONT, o, r0, len, wid, edge, cE, mixc(P.bud, P.petal, tint));
    if (b > 0.2) {
      const k = ph(b, 0.2, 0.8), sl = 8 * k;
      ctx.strokeStyle = col(P.stamen); ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 0; i < LILY_STAMEN.length; i++) {
        const a = LILY_STAMEN[i];
        ctx.moveTo(0, 0); ctx.lineTo(Math.sin(a) * sl, -Math.cos(a) * sl);
      }
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < LILY_STAMEN.length; i++) {
        const a = LILY_STAMEN[i];
        circ(ctx, Math.sin(a) * sl, -Math.cos(a) * sl, 1.1 * k);
      }
      circ(ctx, 0, 0, 1.6 * k);
      fillPath(ctx, col(P.stamen));
    }
  }

  // ---------- type table ----------
  // h = full height in design units (bloomed), ic = top part of the plant framed by icons, wd = full width,
  // cx = horizontal centre of the bounding box (wd/cx: icon fallback framing only; icons are auto-fitted),
  // shadow = shadow radius, lean = how much the per-seed lean applies.
  const TYPES = {
    cactus: { h: 56, ic: 1, wd: 46, cx: 4, shadow: 22, lean: 0.3, draw: drawCactus,
      pal: { body: '#79a96b', bodyD: '#5d8a56', bodyL: '#9cc48a', spine: '#f4ecd6', flower: '#f7c548', flowerD: '#ec9b3a', center: '#d4642e' } },
    daisy: { h: 76, ic: 0.6, wd: 56, cx: 0, shadow: 22, lean: 1, draw: drawDaisy,
      pal: { leaf: '#7db577', leafD: '#5a9258', stem: '#68a062', bud: '#86b97a', petal: '#fbf7ee', petalD: '#e4d9c4', center: '#f2b632', centerD: '#d98a24' } },
    tulip: { h: 84, ic: 0.46, wd: 52, cx: 0, shadow: 20, lean: 1, draw: drawTulip,
      pal: { leaf: '#72a96a', leafD: '#548a50', stem: '#629a5c', bud: '#8cbf72', budD: '#6ea35a', budL: '#a6d08c', petal: '#ea7a4a', petalD: '#c95735', petalL: '#f6a072' } },
    lavender: { h: 84, ic: 0.8, wd: 56, cx: 0, shadow: 22, lean: 1, draw: drawLavender,
      pal: { leaf: '#89a98e', leafD: '#6a8a71', stem: '#7a9a80', bud: '#9db89b', budD: '#7f9c84', petal: '#ad8fdb', petalD: '#8566c0' } },
    bluebell: { h: 76, ic: 0.78, wd: 68, cx: 14, shadow: 22, lean: 1, draw: drawBluebell,
      pal: { leaf: '#6fa57c', leafD: '#52865f', stem: '#5f9570', bud: '#8cbf8f', budD: '#6fa274', petal: '#6f95dc', petalD: '#4e72c0' } },
    rose: { h: 82, ic: 0.42, wd: 50, cx: 0, shadow: 20, lean: 1, draw: drawRose,
      pal: { leaf: '#67a063', leafD: '#4b7e48', stem: '#5b8f55', thorn: '#4a7a44', young: '#8f4e45', youngL: '#a8784f', youngD: '#80543f', bud: '#7fb06e', budD: '#5f9450', petal: '#e0617f', petalD: '#b6405f', petalL: '#f293a8' } },
    sunflower: { h: 98, ic: 0.6, wd: 60, cx: 0, shadow: 22, lean: 1, draw: drawSunflower,
      pal: { leaf: '#7aaa58', leafD: '#5a8a41', stem: '#6d9c4e', petal: '#f6bf34', petalD: '#e0941e', center: '#6e4526', centerD: '#4e2f1a', seed: '#a0703c' } },
    skylily: { h: 90, ic: 0.5, wd: 50, cx: 0, shadow: 16, lean: 1, draw: drawSkylily,
      pal: { leaf: '#5f978c', leafD: '#457970', stem: '#56897f', bud: '#7fae9c', budD: '#62927f', budL: '#a9cdbe', petal: '#5262b8', petalD: '#3b4895', edge: '#d7defa', stamen: '#f3d27c' } },
  };

  // ---------- public ----------
  // Per-plant state (reused): growth, bloom, wilt, seed values.
  const S = { g: 0, b: 0, w: 0, seed: 0, varied: false, r1: 0.5, r2: 0.5, r3: 0.5, r4: 0.5,
    rnd: function (k) { return S.varied ? hash(S.seed, k) : 0.5; } };

  function draw(ctx, type, x, y, opts) {
    const T = TYPES[type] || TYPES.daisy;
    const o = opts || EMPTY;
    const fade = o.fade == null ? 1 : o.fade;
    if (fade <= 0.004) return;
    const size = o.size || 56;
    const varied = o.seed != null;
    const seed = varied ? (Math.round(o.seed * 7919) | 0) : 0;
    S.g = clamp01(o.growth == null ? 1 : o.growth);
    S.b = clamp01(o.bloom || 0);
    S.w = clamp01(o.wilt || 0);
    S.seed = seed;
    S.varied = varied;
    S.r1 = S.rnd(1); S.r2 = S.rnd(2); S.r3 = S.rnd(3); S.r4 = S.rnd(4);
    const k = size * (varied ? 1 + (hash(seed, 11) - 0.5) * 0.16 : 1) / T.h;
    const lean = varied ? (hash(seed, 12) - 0.5) * 0.12 * T.lean : 0;
    const flip = varied && hash(seed, 13) < 0.5;
    WS = Math.round(S.w * WSTEPS);

    ctx.save();
    ctx.globalAlpha *= fade;
    ctx.translate(x, y);
    // Soft ground shadow (not rotated), grows with the plant
    const sr = T.shadow * k * (0.4 + 0.6 * eOut(Math.min(1, S.g * 1.5)));
    ctx.fillStyle = SHADOW;
    ctx.beginPath(); ctx.ellipse(0, 0.5, sr, sr * 0.3, 0, 0, TAU); ctx.fill();
    ctx.rotate(lean + (o.sway || 0));
    ctx.scale(flip ? -k : k, k);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    T.draw(ctx, S, T.pal);
    ctx.restore();
    WS = 0;
  }

  const iconCache = {};
  const ICON_FILL = 0.9;       // the framed part's larger side fills this much of the icon
  const fitCache = {};
  // Bounding box (in design units, relative to the ground point) of the framed top part of the bloomed
  // plant, measured from the opaque pixels of a reference render (the soft ground shadow is ignored).
  function iconFit(type, T) {
    if (fitCache[type] !== undefined) return fitCache[type];
    let res = null;
    try {
      const U = 3, cw = Math.ceil(T.wd * 3 * U), ch = Math.ceil(T.h * 1.4 * U);
      const gx = cw / 2, gy = ch - 4 * U;
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const g = c.getContext('2d');
      draw(g, type, gx, gy, { size: T.h * U, growth: 1, bloom: 1 });
      const d = g.getImageData(0, 0, cw, ch).data;
      const A = 110;                         // above the shadow alpha (~56)
      let minY = -1;
      for (let y = 0; y < ch && minY < 0; y++) {
        for (let x = 0; x < cw; x++) if (d[(y * cw + x) * 4 + 3] > A) { minY = y; break; }
      }
      if (minY >= 0) {
        const cropY = Math.min(gy, minY + T.ic * (gy - minY));
        let minX = cw, maxX = -1;
        for (let y = minY; y <= cropY; y++) {
          const row = y * cw;
          for (let x = 0; x < cw; x++) if (d[(row + x) * 4 + 3] > A) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
        }
        if (maxX >= minX) {
          res = { w: (maxX - minX + 1) / U, h: (cropY - minY + 1) / U, cx: ((minX + maxX) / 2 - gx) / U, cy: ((minY + cropY) / 2 - gy) / U };
        }
      }
    } catch (e) { res = null; }
    fitCache[type] = res;
    return res;
  }
  function icon(type, px) {
    px = Math.max(8, Math.round(px || 48));
    const dpr = Math.min(Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1), 3);
    const key = type + '|' + px + '|' + dpr;
    if (iconCache[key]) return iconCache[key];
    const T = TYPES[type] || TYPES.daisy;
    const c = document.createElement('canvas');
    c.width = c.height = Math.round(px * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    // Frame the top T.ic of the bloomed plant (tall flowers are cropped so the head reads at icon size);
    // the ground point may fall below the canvas. The framed part is measured once from a reference
    // render so every icon fills its square the same way.
    const fit = iconFit(type, T);
    if (fit) {
      const s = px * ICON_FILL / Math.max(fit.w, fit.h);
      draw(g, type, px / 2 - fit.cx * s, px / 2 - fit.cy * s, { size: T.h * s, growth: 1, bloom: 1 });
    } else {
      const unit = Math.min(px * 0.9 / (T.h * T.ic), px * 1.1 / T.wd);
      const top = px * 0.5 - T.h * T.ic * unit * 0.5;
      draw(g, type, px / 2 - T.cx * unit, top + T.h * unit, { size: T.h * unit, growth: 1, bloom: 1 });
    }
    let url;
    try { url = c.toDataURL('image/png'); } catch (e) { url = ''; }
    iconCache[key] = url;
    return url;
  }

  RD.Flora = { draw: draw, icon: icon, types: Object.keys(TYPES) };
})(window.RD = window.RD || {});
