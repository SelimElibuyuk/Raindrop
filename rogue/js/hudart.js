// HUD bars drawn as flat vector art (same vocabulary as js/treeart.js). Canvas 2D only, no filters/gradients/images.
//   RD.HudArt.drawGrowBar(ctx, w, h, frac, { seed, t, bossType })
//   RD.HudArt.drawWaterBar(ctx, w, h, frac, { t, low })
//   RD.HudArt.budReserve(h) -> px reserved at the right end of the grow bar when bossType is given (h * 1.3)
// w/h are CSS px; the caller sets ctx.setTransform(dpr,0,0,dpr,0,0) and clears the canvas. Shapes are
// precomputed per (seed, w, h) in a small cache; per frame only a clip, a few fills and the wavy front run.
(function () {
  'use strict';
  const RD = window.RD = window.RD || {};

  const TAU = Math.PI * 2;
  const SOIL = '#cdb3a6', SOIL_DARK = '#b6a095', SOIL_LIGHT = '#d9c5ba';
  const CRACK = '#5e3f2e', OUTLINE = '#4a3326', OUTLINE_GREEN = '#2d4a2b';
  const GRASS = '#6cc16a', GRASS_DARK = '#3f9a49', GRASS_EDGE = '#3b8a42', GRASS_LIGHT = '#80d27c', GRASS_MID = '#5cb85c';
  const FLOWERS = ['#e8484f', '#f5c842', '#f27fb0', '#9b6fd6', '#5b9be8', '#ff9a4a', '#ffffff'];
  const TRACK_DARK = '#1e140d', TRACK_RIM = '#150d08';
  const WATER = '#4fb3ff', WATER_LIGHT = '#9bd8ff', WATER_EDGE = '#2f86d6';
  const CORAL = '#ff6f61', CORAL_LIGHT = '#ffa396', CORAL_EDGE = '#d9473c';

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function rng(seed) {                    // mulberry32 (same as treeart.js)
    let a = (Math.imul((seed | 0) + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function roundRectPath(p, x, y, w, h, r) {
    p.moveTo(x + r, y);
    p.lineTo(x + w - r, y); p.arcTo(x + w, y, x + w, y + r, r);
    p.lineTo(x + w, y + h - r); p.arcTo(x + w, y + h, x + w - r, y + h, r);
    p.lineTo(x + r, y + h); p.arcTo(x, y + h, x, y + h - r, r);
    p.lineTo(x, y + r); p.arcTo(x, y, x + r, y, r);
    p.closePath();
  }
  function trackPath(x, y, w, h) { const p = new Path2D(); roundRectPath(p, x, y, w, h, h / 2); return p; }

  // tapered crack polygon (start width w0, tip 0) appended to Path2D p
  function crackPoly(p, pts, w0) {
    const n = pts.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      const w = w0 * (1 - i / (n - 1)) * 0.5;
      L.push([pts[i][0] - dy / d * w, pts[i][1] + dx / d * w]);
      R.push([pts[i][0] + dy / d * w, pts[i][1] - dx / d * w]);
    }
    p.moveTo(L[0][0], L[0][1]);
    for (let i = 1; i < n; i++) p.lineTo(L[i][0], L[i][1]);
    for (let i = n - 1; i >= 0; i--) p.lineTo(R[i][0], R[i][1]);
    p.closePath();
  }
  function bladeSub(p, x, y, ang, len, wd, bend) {   // tapered blade, same geometry as treeart.js
    const c = Math.cos(ang), sn = Math.sin(ang), nx = -sn, ny = c;
    const tx = x + c * len + nx * bend * len * 0.3, ty = y + sn * len + ny * bend * len * 0.3;
    const o1 = wd * 0.35 + bend * len * 0.12, o2 = wd * 0.35 - bend * len * 0.12;
    p.moveTo(x + nx * wd / 2, y + ny * wd / 2);
    p.quadraticCurveTo(x + c * len * 0.55 + nx * o1, y + sn * len * 0.55 + ny * o1, tx, ty);
    p.quadraticCurveTo(x + c * len * 0.5 - nx * o2, y + sn * len * 0.5 - ny * o2, x - nx * wd / 2, y - ny * wd / 2);
    p.closePath();
  }
  function tuftSub(p, x, y, ang, size, rand) {
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1) - 0.5;
      bladeSub(p, x, y, ang + f * 1.0 + (rand() - 0.5) * 0.25, size * (0.75 + rand() * 0.5), size * 0.3, (rand() - 0.5) * 1.2 + f);
    }
  }

  // ---------- grow bar ----------
  const growCache = {};
  let growCount = 0;
  function growShape(seed, w, h, reserve) {
    const key = seed + '|' + w + '|' + h + '|' + reserve;
    let s = growCache[key];
    if (s) return s;
    if (growCount > 24) { for (const k in growCache) delete growCache[k]; growCount = 0; }
    growCount++;
    const rand = rng(seed * 31 + Math.round(w) * 7 + Math.round(h));
    const tx = 2, ty = 2, th = h - 4, tw = w - reserve - 2;
    s = { tx: tx, ty: ty, th: th, tw: tw, reserve: reserve, ph1: rand() * TAU, ph2: rand() * TAU };
    s.track = trackPath(tx, ty, tw, th);
    // soil details: cracks, tone patches, pebbles
    s.cracks = new Path2D(); s.tone = new Path2D(); s.toneL = new Path2D(); s.peb = new Path2D(); s.pebL = new Path2D();
    const nCr = Math.max(3, Math.round(tw / 70));
    for (let i = 0; i < nCr; i++) {
      let x = tx + (i + rand()) / nCr * tw, y = ty + (rand() < 0.5 ? 0 : th) + (rand() - 0.5) * 2;
      let hd = (y < h / 2 ? 1 : -1) * Math.PI / 2 + (rand() - 0.5) * 1.3;
      const segs = 4 + Math.floor(rand() * 3), sl = th * (0.35 + rand() * 0.25), pts = [[x, y]];
      for (let j = 0; j < segs; j++) { hd += (rand() - 0.5) * 1.5; x += Math.cos(hd) * sl; y += Math.sin(hd) * sl; pts.push([x, y]); }
      crackPoly(s.cracks, pts, th * 0.2);
    }
    for (let i = 0; i < Math.round(tw / 90); i++) {
      const cx = tx + rand() * tw, cy = ty + rand() * th, rx = th * (0.7 + rand() * 0.8), ry = th * (0.3 + rand() * 0.3);
      const P = i % 2 ? s.tone : s.toneL;
      P.moveTo(cx + rx, cy); P.ellipse(cx, cy, rx, ry, (rand() - 0.5) * 0.4, 0, TAU);
    }
    for (let i = 0; i < Math.round(tw / 22); i++) {
      const cx = tx + rand() * tw, cy = ty + th * (0.2 + rand() * 0.6), r = 0.9 + rand() * 1.3;
      s.peb.moveTo(cx + r * 1.2, cy + r * 0.3); s.peb.ellipse(cx, cy + r * 0.3, r * 1.2, r * 0.8, 0, 0, TAU);
      s.pebL.moveTo(cx + r, cy); s.pebL.ellipse(cx, cy, r, r * 0.7, 0, 0, TAU);
    }
    // lawn decor (clipped by the fill front at draw time)
    s.blobL = new Path2D(); s.blobM = new Path2D(); s.tuftA = new Path2D(); s.tuftB = new Path2D();
    for (let i = 0; i < Math.round(tw / 30); i++) {
      const cx = tx + rand() * tw, cy = ty + rand() * th, rx = th * (0.25 + rand() * 0.3), ry = th * (0.15 + rand() * 0.2);
      const P = i % 2 ? s.blobL : s.blobM;
      P.moveTo(cx + rx, cy); P.ellipse(cx, cy, rx, ry, (rand() - 0.5) * 0.6, 0, TAU);
    }
    for (let i = 0; i < Math.round(tw / 13); i++) {
      const cx = tx + rand() * tw, cy = ty + th * (0.55 + rand() * 0.5);
      tuftSub(i % 3 ? s.tuftA : s.tuftB, cx, cy, -Math.PI / 2 + (rand() - 0.5) * 0.9, th * (0.28 + rand() * 0.18), rand);
    }
    // tiny flowers: appear when the fill front passes them
    s.fl = [];
    const nF = Math.max(4, Math.round(tw / 48)), pal = FLOWERS.slice();
    for (let i = pal.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = pal[i]; pal[i] = pal[j]; pal[j] = t; }
    for (let i = 0; i < nF; i++) {
      s.fl.push({ x: tx + th * 0.6 + (i + 0.2 + rand() * 0.6) / nF * (tw - th * 1.2), y: ty + th * (0.3 + rand() * 0.4),
        r: th * (0.17 + rand() * 0.06), c: pal[i % pal.length], rot: rand() * TAU });
    }
    return (growCache[key] = s);
  }
  function drawFlower(ctx, x, y, r, color, rot) {
    const pr = r * 0.5, d = r * 0.62;
    ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + i * TAU / 5, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      ctx.moveTo(px + pr, py); ctx.arc(px, py, pr, 0, TAU);
    }
    ctx.fill();
    ctx.fillStyle = color === '#f5c842' ? '#fff3d6' : '#f5c842';
    ctx.beginPath(); ctx.arc(x, y, r * 0.34, 0, TAU); ctx.fill();
  }

  function drawGrowBar(ctx, w, h, frac, o) {
    o = o || {};
    frac = clamp01(frac || 0);
    const t = o.t || 0, boss = o.bossType || null;
    const s = growShape(o.seed || 0, w, h, boss ? Math.round(h * 1.3) : 0);
    const tx = s.tx, ty = s.ty, th = s.th, tw = s.tw;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // soil
    ctx.fillStyle = SOIL; ctx.fill(s.track);
    ctx.save();
    ctx.clip(s.track);
    ctx.fillStyle = SOIL_DARK; ctx.fill(s.tone);
    ctx.fillStyle = SOIL_LIGHT; ctx.fill(s.toneL);
    ctx.fillStyle = CRACK; ctx.fill(s.cracks);
    ctx.fillStyle = '#8f7a6f'; ctx.fill(s.peb);
    ctx.fillStyle = '#d2c0b4'; ctx.fill(s.pebL);

    // lawn: filled 0..frac with a wavy bumpy front
    if (frac > 0) {
      const fx = tx + (tw + 4) * frac, ph1 = s.ph1, ph2 = s.ph2 + t * 0.9;
      const front = new Path2D();             // one small Path2D per frame (~th/2 points)
      front.moveTo(tx - 4, ty - 2);
      const step = 2;
      for (let y = ty - 2; y <= ty + th + 2; y += step) {
        const k = frac >= 1 ? 0 : 1;
        front.lineTo(fx + k * (2.2 * Math.sin(y * 0.55 + ph1) + 1.2 * Math.sin(y * 1.35 + ph2)), y);
      }
      front.lineTo(tx - 4, ty + th + 2);
      front.closePath();
      ctx.fillStyle = GRASS; ctx.fill(front);
      ctx.save();
      ctx.clip(front);
      ctx.fillStyle = GRASS_MID; ctx.fill(s.blobM);
      ctx.fillStyle = GRASS_LIGHT; ctx.fill(s.blobL);
      ctx.fillStyle = GRASS_DARK; ctx.fill(s.tuftA);
      ctx.fillStyle = '#4aa94f'; ctx.fill(s.tuftB);
      ctx.restore();
      if (frac < 1) { ctx.lineWidth = 2.2; ctx.strokeStyle = GRASS_EDGE; ctx.stroke(front); }
      ctx.restore();
      // flowers pop in as the front passes
      const fl = s.fl;
      for (let i = 0; i < fl.length; i++) {
        const f = fl[i], g = clamp01((fx - 2 - f.x) / 10);
        if (g <= 0) continue;
        drawFlower(ctx, f.x, f.y, f.r * (0.4 + 0.6 * g * (2 - g)), f.c, f.rot);
      }
    } else {
      ctx.restore();
    }

    // rim like tiles
    ctx.lineWidth = 3; ctx.strokeStyle = frac >= 1 ? OUTLINE_GREEN : OUTLINE;
    ctx.stroke(s.track);

    // boss bud at the right end, ground at the bar's bottom
    if (boss && RD.Flora && RD.Flora.draw) {
      const cx = tx + tw + s.reserve / 2 - 1, gy = h - 2;
      ctx.fillStyle = GRASS; ctx.beginPath(); ctx.ellipse(cx, gy, s.reserve * 0.4, 2.6, 0, 0, TAU); ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = OUTLINE_GREEN; ctx.stroke();
      RD.Flora.draw(ctx, boss, cx, gy - 1, { size: h - 1, growth: 0.3 + 0.7 * frac, bloom: frac * frac, seed: o.seed || 0 });
    }
    ctx.restore();
  }

  // ---------- water bar ----------
  const waterCache = {};
  function waterTrack(w, h) {
    const k = w + 'x' + h;
    return waterCache[k] || (waterCache[k] = trackPath(2, 2, w - 4, h - 4));
  }
  function drawWaterBar(ctx, w, h, frac, o) {
    o = o || {};
    frac = clamp01(frac || 0);
    const t = o.t || 0, low = !!o.low;
    const tx = 2, ty = 2, tw = w - 4, th = h - 4, track = waterTrack(w, h);
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.fillStyle = TRACK_DARK; ctx.fill(track);
    if (frac > 0) {
      const fx = tx + (tw + 4) * frac, k = frac >= 1 ? 0 : 1;
      const fill = low ? CORAL : WATER, light = low ? CORAL_LIGHT : WATER_LIGHT, edge = low ? CORAL_EDGE : WATER_EDGE;
      const pulse = low ? 0.75 + 0.25 * Math.sin(t * 6) : 1;
      ctx.save();
      ctx.clip(track);
      const front = new Path2D();
      front.moveTo(tx - 4, ty - 2);
      for (let y = ty - 2; y <= ty + th + 2; y += 2) {
        front.lineTo(fx + k * (1.6 * Math.sin(y * 0.7 + t * 3.2) + 0.9 * Math.sin(y * 1.6 - t * 2.1)), y);
      }
      front.lineTo(tx - 4, ty + th + 2);
      front.closePath();
      ctx.fillStyle = fill; ctx.fill(front);
      ctx.save();
      ctx.clip(front);
      // flat lighter band along the top, a darker band along the bottom (no gradients)
      ctx.globalAlpha = pulse;
      ctx.fillStyle = light; ctx.fillRect(tx, ty + th * 0.14, fx - tx, th * 0.22);
      ctx.fillStyle = edge; ctx.fillRect(tx, ty + th * 0.78, fx - tx, th * 0.22);
      ctx.globalAlpha = 1;
      // bubbles drifting up, wrapping
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const bx = tx + ((i * 0.37 + 0.11 + t * (0.025 + i * 0.012)) % 1) * Math.max(0, fx - tx - 8);
        const u = (t * (0.35 + i * 0.12) + i * 0.4) % 1, by = ty + th * (0.85 - 0.7 * u), br = th * (0.07 + 0.04 * (i % 2));
        ctx.moveTo(bx + br, by); ctx.arc(bx, by, br, 0, TAU);
      }
      ctx.fill();
      ctx.restore();
      if (frac < 1) { ctx.lineWidth = 2; ctx.strokeStyle = edge; ctx.stroke(front); }
      ctx.restore();
    }
    ctx.lineWidth = 3; ctx.strokeStyle = TRACK_RIM; ctx.stroke(track);
    ctx.restore();
  }

  RD.HudArt = { drawGrowBar: drawGrowBar, drawWaterBar: drawWaterBar, budReserve: function (h) { return Math.round(h * 1.3); } };
})();
