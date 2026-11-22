// Skill tree art: soil tiles that green with level + leafy vines between nodes. Flat vector, Canvas 2D only.
//   RD.TreeArt.drawTile(ctx, cx, cy, size, { level, max, locked, palette, seed, selected })
//   RD.TreeArt.drawVine(ctx, ax, ay, bx, by, { progress, locked, seed })
//   RD.TreeArt.tileImage(opts, px) -> cached data URL (tile drawn at 88% of px so max-level flowers fit)
//   RD.TreeArt.VINE_GROW_TIME (seconds)
// Everything is deterministic per seed. No filters, blur or image assets.
(function () {
  'use strict';
  const RD = window.RD = window.RD || {};

  const TAU = Math.PI * 2;
  const SOIL = '#cdb3a6';
  const CRACK = '#5e3f2e';
  const OUTLINE = '#4a3326';
  const GRASS = '#6cc16a';
  const GRASS_DARK = '#3f9a49';
  const GRASS_EDGE = '#3b8a42';
  const GRASS_LIGHT = '#80d27c';
  const GRASS_MID = '#5cb85c';
  const OUTLINE_GREEN = '#2d4a2b';
  const DEFAULT_PALETTE = ['#e8484f', '#f5c842', '#f27fb0', '#9b6fd6', '#5b9be8'];
  const LOCK_DIM = 0.55;               // locked tile keeps 55% brightness (~45% dimmer)
  const TILE_FIT = 0.88;               // tileImage: tile fraction of the canvas (room for flowers)
  const imgCache = {};

  // ---------- helpers ----------
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function eOut(t) { const u = 1 - t; return 1 - u * u * u; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rng(seed) {                 // mulberry32
    let a = (Math.imul((seed | 0) + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
  function blobPt(cx, cy, p, ph1, ph2, sc, a) {
    const c = Math.cos(a), sn = Math.sin(a);
    const w = 1 + 0.10 * Math.sin(3 * a + ph1) + 0.07 * Math.sin(5 * a + ph2) + 0.05 * Math.sin(8 * a + ph1 * 2);
    const sc2 = 1 + (sc * 0.016 / Math.max(p, 1)) * Math.sin(13 * a + ph2);
    return [cx + p * w * sc2 * Math.sign(c) * Math.pow(Math.abs(c), 0.72), cy + p * w * sc2 * Math.sign(sn) * Math.pow(Math.abs(sn), 0.72)];
  }
  // Organic wavy blob of half-extent p around (cx, cy); closed smooth path with small scallops.
  function blobPath(ctx, cx, cy, p, ph1, ph2, sc) {
    const N = 64, pts = [], ex = 0.72;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU, c = Math.cos(a), s = Math.sin(a);
      const w = 1 + 0.10 * Math.sin(3 * a + ph1) + 0.07 * Math.sin(5 * a + ph2) + 0.05 * Math.sin(8 * a + ph1 * 2);
      const sc2 = 1 + (sc * 0.016 / Math.max(p, 1)) * Math.sin(13 * a + ph2);
      pts.push([cx + p * w * sc2 * Math.sign(c) * Math.pow(Math.abs(c), ex), cy + p * w * sc2 * Math.sign(s) * Math.pow(Math.abs(s), ex)]);
    }
    const m = (i) => pts[(i + N) % N];
    ctx.moveTo((m(0)[0] + m(N - 1)[0]) / 2, (m(0)[1] + m(N - 1)[1]) / 2);
    for (let i = 0; i < N; i++) {
      const a = m(i), b = m(i + 1);
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    ctx.closePath();
  }
  function blade(ctx, x, y, ang, len, wd, bend, fill) {   // tapered grass blade fill
    const c = Math.cos(ang), sn = Math.sin(ang), nx = -sn, ny = c;
    const tx = x + c * len + nx * bend * len * 0.3, ty = y + sn * len + ny * bend * len * 0.3;
    const o1 = wd * 0.35 + bend * len * 0.12, o2 = wd * 0.35 - bend * len * 0.12;
    ctx.beginPath();
    ctx.moveTo(x + nx * wd / 2, y + ny * wd / 2);
    ctx.quadraticCurveTo(x + c * len * 0.55 + nx * o1, y + sn * len * 0.55 + ny * o1, tx, ty);
    ctx.quadraticCurveTo(x + c * len * 0.5 - nx * o2, y + sn * len * 0.5 - ny * o2, x - nx * wd / 2, y - ny * wd / 2);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  function tuft(ctx, x, y, ang, size, rand, fill) {   // 2-4 blades fanning from one point
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1) - 0.5;
      blade(ctx, x, y, ang + f * 1.0 + (rand() - 0.5) * 0.25, size * (0.75 + rand() * 0.5), size * 0.28, (rand() - 0.5) * 1.2 + f, fill);
    }
  }
  function clover(ctx, x, y, r, fill) {
    ctx.fillStyle = fill;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * TAU / 3;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.62, 0, TAU); ctx.fill();
    }
  }
  // Tapered crack polygon along pts with start width w0 (tip = 0).
  function crackPoly(ctx, pts, w0) {
    const n = pts.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      const w = w0 * (1 - i / (n - 1)) * 0.5;
      L.push([pts[i][0] - dy / d * w, pts[i][1] + dx / d * w]);
      R.push([pts[i][0] + dy / d * w, pts[i][1] - dx / d * w]);
    }
    ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
    for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
    ctx.closePath(); ctx.fill();
  }
  function flower(ctx, x, y, r, color, rand) {
    const rot = rand() * TAU, pr = r * 0.5, d = r * 0.62;
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.strokeStyle = 'rgba(58,32,40,0.55)';
    ctx.fillStyle = color;
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * TAU;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, pr, 0, TAU);
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = color === '#f5c842' ? '#fff3d6' : '#f5c842';
    ctx.beginPath(); ctx.arc(x, y, r * 0.34, 0, TAU); ctx.fill(); ctx.stroke();
  }

  // ---------- tile ----------
  function drawTile(ctx, cx, cy, size, o) {
    o = o || {};
    const s = size, half = s / 2, x0 = cx - half, y0 = cy - half, rad = s * 0.2;
    const locked = !!o.locked;
    const max = o.max > 0 ? o.max : 1;
    const g = locked ? 0 : clamp01((o.level || 0) / max);
    const rand = rng(o.seed || 0);
    const k = locked ? LOCK_DIM : 1;
    const col = (c) => (k === 1 ? c : shade(c, k));
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    if (o.selected) {                       // highlight ring under the outline
      ctx.beginPath(); roundRectPath(ctx, x0, y0, s, s, rad);
      ctx.lineWidth = s * 0.1; ctx.strokeStyle = '#ffe08a'; ctx.stroke();
    }
    // soil
    ctx.beginPath(); roundRectPath(ctx, x0, y0, s, s, rad);
    ctx.fillStyle = col(SOIL); ctx.fill();

    // hole (bare soil patch) half extent; shrinks with g
    const p = g >= 1 ? 0 : (g > 0 ? half * (0.9 - 0.75 * g) : half);
    const ph1 = rand() * TAU, ph2 = rand() * TAU;

    // cracks: 2-4 seeded jagged tapered polygons; grass painted later hides what the patch no longer shows
    ctx.save();
    ctx.beginPath(); roundRectPath(ctx, x0, y0, s, s, rad); ctx.clip();
    ctx.fillStyle = col(CRACK);
    const nCr = g > 0 ? 2 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 3);
    for (let i = 0; i < nCr; i++) {
      let pts = null;
      for (let tries = 0; tries < 8 && !pts; tries++) {
        const a = rand() * TAU, c = Math.cos(a), sn = Math.sin(a), b = 1 / Math.max(Math.abs(c), Math.abs(sn));
        const r0 = g > 0 ? p * 0.9 : half * (0.85 + rand() * 0.25);
        let px = cx + c * b * r0, py = cy + sn * b * r0;
        let h = a + Math.PI + (rand() - 0.5) * 1.5;
        const segs = 5 + Math.floor(rand() * 5), sl = s * (0.3 + rand() * 0.2) / segs * (tries > 5 ? 0.5 : 1);
        const cand = [[px, py]];
        let ok = true;
        for (let j = 0; j < segs; j++) {
          h += (rand() - 0.5) * 1.3;
          px += Math.cos(h) * sl; py += Math.sin(h) * sl;
          cand.push([px, py]);
          if (Math.hypot(px - cx, py - cy) < s * 0.1) ok = false;
        }
        if (ok || tries === 7) pts = cand;
      }
      crackPoly(ctx, pts, s * 0.025);
      const nb = 1 + Math.floor(rand() * 2);
      for (let bI = 0; bI < nb; bI++) {
        const k = 1 + Math.floor(rand() * Math.max(1, pts.length - 3));
        const a0 = pts[k - 1], a1 = pts[k + 1] || pts[k];
        let h = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]) + (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.5);
        const bp = [pts[k]], bl = s * 0.035 * (0.8 + rand() * 0.6), m = 2 + Math.floor(rand() * 2);
        let qx = pts[k][0], qy = pts[k][1];
        for (let j = 0; j < m; j++) { h += (rand() - 0.5) * 0.9; qx += Math.cos(h) * bl; qy += Math.sin(h) * bl; bp.push([qx, qy]); }
        if (Math.hypot(qx - cx, qy - cy) > s * 0.1) crackPoly(ctx, bp, s * 0.014);
      }
    }
    ctx.restore();

    // grass: tile minus the wavy soil patch (even-odd), or whole tile at max
    if (g > 0) {
      ctx.beginPath(); roundRectPath(ctx, x0, y0, s, s, rad);
      if (g < 1) blobPath(ctx, cx, cy, p, ph1, ph2, s);
      ctx.fillStyle = GRASS; ctx.fill('evenodd');
      if (g < 1) {
        ctx.beginPath(); blobPath(ctx, cx, cy, p, ph1, ph2, s);
        ctx.lineWidth = s * 0.03; ctx.strokeStyle = GRASS_EDGE; ctx.stroke();
      }
      // scattered decor in the rim, clipped to the tile, centre ~40% kept calm
      const lo = Math.max(s * 0.26, p * 1.08 + s * 0.02), hi = Math.max(lo + s * 0.01, s * 0.46);
      const spot = () => {
        const a = rand() * TAU, c = Math.cos(a), sn = Math.sin(a), b = 1 / Math.max(Math.abs(c), Math.abs(sn));
        const w = lo + (hi - lo) * rand();
        return [cx + c * b * w, cy + sn * b * w];
      };
      ctx.save(); ctx.beginPath(); roundRectPath(ctx, x0 + s * 0.03, y0 + s * 0.03, s * 0.94, s * 0.94, rad * 0.8); ctx.clip();
      const nBl = Math.round(3 + g * 5);
      for (let i = 0; i < nBl; i++) {            // flat tonal blobs
        const q = spot(), r = s * (0.05 + rand() * 0.05);
        ctx.beginPath(); blobPath(ctx, q[0], q[1], r, rand() * TAU, rand() * TAU, 0);
        ctx.fillStyle = i % 2 ? GRASS_LIGHT : GRASS_MID; ctx.fill();
      }
      const nCl = Math.round(g * 3);
      for (let i = 0; i < nCl; i++) { const q = spot(); clover(ctx, q[0], q[1], s * (0.026 + rand() * 0.008), '#93de88'); }
      const nTu = Math.round(4 + g * 10);
      for (let i = 0; i < nTu; i++) {
        const q = spot();
        tuft(ctx, q[0], q[1], -Math.PI / 2 + (rand() - 0.5) * 0.9, s * (0.07 + rand() * 0.03), rand, i % 3 ? GRASS_DARK : '#4aa94f');
      }
      ctx.restore();
      if (g < 1) {                                // tufts poking from the rim onto the soil
        const nE = Math.round(4 + g * 6);
        for (let i = 0; i < nE; i++) {
          const a = (i / nE) * TAU + (rand() - 0.5) * 0.6, q = blobPt(cx, cy, p, ph1, ph2, s, a);
          tuft(ctx, q[0], q[1], Math.atan2(cy - q[1], cx - q[0]) + (rand() - 0.5) * 0.5, s * (0.05 + rand() * 0.025), rand, GRASS_EDGE);
        }
      }
    }

    // outline
    ctx.beginPath(); roundRectPath(ctx, x0, y0, s, s, rad);
    ctx.lineWidth = s * 0.045; ctx.strokeStyle = col(g >= 1 ? OUTLINE_GREEN : OUTLINE); ctx.stroke();

    // flowers at max level, on corners/edges, overlapping the border
    if (g >= 1) {
      let pal = [];
      (o.palette || []).forEach((c) => { if (pal.indexOf(c) < 0) pal.push(c); });
      DEFAULT_PALETTE.forEach((c) => { if (pal.length < 3 && pal.indexOf(c) < 0) pal.push(c); });
      for (let i = pal.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = pal[i]; pal[i] = pal[j]; pal[j] = t; }
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let i = 3; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = corners[i]; corners[i] = corners[j]; corners[j] = t; }
      const rr = rand(), n = rr < 0.75 ? 4 : (rr < 0.88 ? 3 : 5);
      const spots = corners.slice(0, Math.min(n, 4));
      if (n === 5) spots.push(rand() < 0.5 ? [0, -1] : [0, 1]);
      spots.forEach((sp, i) => {
        const fx = cx + (sp[0] ? sp[0] * 0.455 * s : (rand() - 0.5) * s * 0.4) + (rand() - 0.5) * s * 0.03;
        const fy = cy + sp[1] * 0.455 * s + (rand() - 0.5) * s * 0.03;
        flower(ctx, fx, fy, s * (0.1 + rand() * 0.012), pal[i % pal.length], rand);
      });
    }
    ctx.restore();
  }

  // ---------- vine ----------
  function leaf(ctx, x, y, ang, len, fill) {
    const w = len * 0.42, cs = Math.cos(ang), sn = Math.sin(ang);
    const tx = x + cs * len, ty = y + sn * len;
    const mx = x + cs * len * 0.5, my = y + sn * len * 0.5;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.quadraticCurveTo(mx - sn * w, my + cs * w, tx, ty);
    ctx.quadraticCurveTo(mx + sn * w, my - cs * w, x, y);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#2f5a2a'; ctx.stroke();
  }
  function drawVine(ctx, ax, ay, bx, by, o) {
    o = o || {};
    const locked = !!o.locked;
    const prog = o.progress == null ? 1 : clamp01(o.progress);
    if (prog <= 0) return;
    const rand = rng(o.seed || 0);
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const mAmp = locked ? 1.6 : Math.min(6, Math.max(2, L * 0.025));
    const mWl = locked ? 22 : 70, TW = 2.8, TWL = 36;
    const ph = rand() * TAU, ph2 = rand() * TAU;
    const pos = (t, st) => {               // st: 0 = centre line, +-1 = twisting strands
      const env = Math.sin(Math.PI / 2 * Math.min(1, t * 8, (1 - t) * 8 + 0.15));
      const w = (Math.sin(t * L / mWl * TAU + ph) * mAmp + st * TW * Math.sin(t * L / TWL * TAU + ph2)) * env;
      return [ax + ux * L * t + nx * w, ay + uy * L * t + ny * w];
    };
    const ang = (t) => { const a = pos(t, 0), b = pos(Math.min(1, t + 0.003), 0); return Math.atan2(b[1] - a[1], b[0] - a[0]); };
    const trace = (st, t0, t1) => {
      const n = Math.max(2, Math.ceil(L * (t1 - t0) / 4));
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const p = pos(t0 + (t1 - t0) * i / n, st); if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
    };
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (locked) {
      trace(0, 0, prog); ctx.lineWidth = 4; ctx.strokeStyle = '#3b2a1c'; ctx.stroke();
      trace(0, 0, prog); ctx.lineWidth = 2; ctx.strokeStyle = '#8a6a48'; ctx.stroke();
      const nSt = Math.floor(L / 40);
      ctx.lineWidth = 1.6; ctx.strokeStyle = '#6e5238';
      for (let i = 1; i <= nSt; i++) {
        const t = i / (nSt + 1); if (t > prog) break;
        const p = pos(t, 0), a = ang(t) + (i % 2 ? -1 : 1) * (0.7 + rand() * 0.3), l = 5 + rand() * 4;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    // two intertwined strands: A fully, B fully, then A redrawn over B on every other half-twist
    const strand = (st, t0, t1, fill) => {
      trace(st, t0, t1); ctx.lineWidth = 5; ctx.strokeStyle = '#2f5a2a'; ctx.stroke();
      trace(st, t0, t1); ctx.lineWidth = 3; ctx.strokeStyle = fill; ctx.stroke();
    };
    strand(-1, 0, prog, '#4ba84a');
    strand(1, 0, prog, '#66c95f');
    const half = TWL / 2 / L;               // half-twist length as a fraction of the vine
    const k0 = Math.floor((-ph2 / Math.PI) * 1), off = (((-ph2 / TAU) * TWL) / L);
    for (let k = k0 - 1; k < 2 / half + 2; k++) {
      if (((k % 2) + 2) % 2) continue;
      const t0 = Math.max(0, off + k * half), t1 = Math.min(prog, off + (k + 1) * half);
      if (t1 > t0) strand(-1, t0, t1, '#4ba84a');
    }
    // alternating leaves from the centre line; each pops in as the tip passes
    const gap = 19, n = Math.floor(L / gap);
    for (let i = 1; i < n; i++) {
      const t = i / n, grown = clamp01((prog - t) * L / 14);
      if (grown <= 0) continue;
      const p = pos(t, 0), side = i % 2 ? 1 : -1;
      leaf(ctx, p[0], p[1], ang(t) + side * (0.95 + rand() * 0.2), (11 + rand() * 3) * eOut(grown), i % 3 ? '#74cf6a' : '#58b552');
    }
    if (prog < 1) {                          // growing tip bud
      const p = pos(prog, 0), a = ang(prog);
      leaf(ctx, p[0], p[1], a - 0.5, 9, '#9be08a');
      leaf(ctx, p[0], p[1], a + 0.5, 8, '#82d476');
    }
    ctx.restore();
  }

  // ---------- soil field ----------
  const FIELD = '#b6a095';             // a bit darker / less saturated than tile soil so tiles still pop
  const FIELD_DARK = '#a8918a';
  const FIELD_LIGHT = '#c2ada2';
  const FIELD_CRACK = '#5e4332';

  // Jagged random-walk crack path; branches recurse once. Fills with the current fillStyle.
  function fieldCrack(ctx, rand, x, y, h, len, w0, depth) {
    const segs = Math.max(4, Math.round(len / 18));
    const sl = len / segs, pts = [[x, y]];
    for (let j = 0; j < segs; j++) {
      h += (rand() - 0.5) * 1.1;
      x += Math.cos(h) * sl * (0.7 + rand() * 0.6); y += Math.sin(h) * sl * (0.7 + rand() * 0.6);
      pts.push([x, y]);
    }
    crackPoly(ctx, pts, w0);
    if (depth > 0) {
      const nb = 1 + Math.floor(rand() * 3);
      for (let b = 0; b < nb; b++) {
        const k = 1 + Math.floor(rand() * (pts.length - 2));
        const a0 = pts[k - 1], a1 = pts[k + 1];
        const hb = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]) + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.6);
        fieldCrack(ctx, rand, pts[k][0], pts[k][1], hb, len * (0.25 + rand() * 0.25), w0 * (1 - k / pts.length) * 0.6, depth - 1);
      }
    }
  }
  function drawSoil(ctx, x, y, w, h, o) {
    o = o || {};
    const rand = rng((o.seed || 0) + 7919);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.fillStyle = FIELD; ctx.fillRect(x, y, w, h);
    const area = w * h;
    // subtle tone patches (large, low contrast)
    const nP = Math.round(area / 85000);
    for (let i = 0; i < nP; i++) {
      ctx.beginPath();
      blobPath(ctx, x + rand() * w, y + rand() * h, 50 + rand() * 110, rand() * TAU, rand() * TAU, 0);
      ctx.fillStyle = i % 2 ? FIELD_DARK : FIELD_LIGHT; ctx.fill();
    }
    // sparse long cracks with branches
    const nC = Math.max(1, Math.round(area / 62500));
    ctx.fillStyle = FIELD_CRACK;
    for (let i = 0; i < nC; i++) {
      fieldCrack(ctx, rand, x + rand() * w, y + rand() * h, rand() * TAU, 160 + rand() * 260, 5 + rand() * 4, 1);
    }
    // tiny pebbles: dark base then lighter top, batched per colour
    const nB = Math.round(area / 11000), peb = [];
    for (let i = 0; i < nB; i++) peb.push([x + rand() * w, y + rand() * h, 1.6 + rand() * 2.6, rand() * Math.PI]);
    ctx.fillStyle = '#8f7a6f'; ctx.beginPath();
    peb.forEach((p) => { ctx.moveTo(p[0] + p[2] * 1.2, p[1] + p[2] * 0.4); ctx.ellipse(p[0], p[1] + p[2] * 0.3, p[2] * 1.2, p[2] * 0.8, p[3], 0, TAU); });
    ctx.fill();
    ctx.fillStyle = '#d2c0b4'; ctx.beginPath();
    peb.forEach((p) => { ctx.moveTo(p[0] + p[2], p[1]); ctx.ellipse(p[0], p[1], p[2], p[2] * 0.7, p[3], 0, TAU); });
    ctx.fill();
    ctx.restore();
  }

  // ---------- greenery patches ----------
  const LAWN_FLOWERS = ['#e8484f', '#f5c842', '#f27fb0', '#9b6fd6', '#5b9be8', '#ff9a4a', '#ffffff'];
  const shapeCache = {};
  const NP = 36;                       // edge sample count
  function hashSeed(seed, x, y) { return ((seed | 0) * 73856093) ^ (Math.round(x) * 19349663) ^ (Math.round(y) * 83492791); }
  function patchShape(seed, x, y) {
    const key = seed + '|' + Math.round(x) + '|' + Math.round(y);
    let s = shapeCache[key];
    if (s) return s;
    const rand = rng(hashSeed(seed, x, y));
    const ph1 = rand() * TAU, ph2 = rand() * TAU, ph3 = rand() * TAU;
    s = { m: [], edge: [], inner: [], blobs: [], clovers: [], flowers: [] };
    for (let i = 0; i < NP; i++) {
      const a = (i / NP) * TAU;
      s.m.push(1 + 0.10 * Math.sin(3 * a + ph1) + 0.07 * Math.sin(5 * a + ph2) + 0.05 * Math.sin(8 * a + ph3) + 0.045 * Math.sin(13 * a + ph2 * 1.7) + (rand() - 0.5) * 0.05);
    }
    const mAt = (a) => { const f = ((a / TAU) % 1 + 1) % 1 * NP, i = Math.floor(f), t = f - i; return lerp(s.m[i % NP], s.m[(i + 1) % NP], t); };
    const mkTuft = (x0, y0, ang, th, sz) => {
      const nb = 2 + Math.floor(rand() * 2), bl = [];
      for (let i = 0; i < nb; i++) { const f = i / (nb - 1) - 0.5; bl.push([ang + f * 1.0 + (rand() - 0.5) * 0.25, 0.75 + rand() * 0.5, (rand() - 0.5) * 1.2 + f]); }
      return { x: x0, y: y0, th: th, sz: sz, bl: bl };
    };
    for (let i = 0; i < 14; i++) {          // rim tufts poking outward
      const a = (i / 14) * TAU + (rand() - 0.5) * 0.3, m = mAt(a);
      s.edge.push(mkTuft(Math.cos(a) * m * 0.97, Math.sin(a) * m * 0.97, a + (rand() - 0.5) * 0.6, rand(), 0.8 + rand() * 0.5));
    }
    for (let i = 0; i < 12; i++) {          // interior tufts
      const a = rand() * TAU, d = Math.sqrt(0.04 + rand() * 0.6) * mAt(a);
      s.inner.push(mkTuft(Math.cos(a) * d, Math.sin(a) * d, -Math.PI / 2 + (rand() - 0.5) * 0.9, rand(), 0.7 + rand() * 0.5));
    }
    for (let i = 0; i < 7; i++) {
      const a = rand() * TAU, d = Math.sqrt(rand()) * 0.7 * mAt(a);
      s.blobs.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, rx: 0.1 + rand() * 0.12, ry: 0.07 + rand() * 0.08, rot: rand() * Math.PI, th: rand(), c: i % 2 });
    }
    for (let i = 0; i < 6; i++) {
      const a = rand() * TAU, d = Math.sqrt(rand()) * 0.75 * mAt(a);
      s.clovers.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, th: rand() });
    }
    const pal = LAWN_FLOWERS.slice();
    for (let i = pal.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = pal[i]; pal[i] = pal[j]; pal[j] = t; }
    const nF = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < nF; i++) {
      const a = rand() * TAU, d = (0.25 + 0.5 * Math.sqrt(rand())) * mAt(a);
      s.flowers.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, c: pal[i % pal.length], rot: rand() * TAU, sz: 0.9 + rand() * 0.3 });
    }
    return (shapeCache[key] = s);
  }
  function lawnPath(ctx, s, x, y, r) {      // closed smooth path through scaled edge samples
    const pts = [];
    for (let i = 0; i < NP; i++) { const a = (i / NP) * TAU; pts.push([x + Math.cos(a) * r * s.m[i], y + Math.sin(a) * r * s.m[i]]); }
    const m = (i) => pts[(i + NP) % NP];
    ctx.moveTo((m(0)[0] + m(NP - 1)[0]) / 2, (m(0)[1] + m(NP - 1)[1]) / 2);
    for (let i = 0; i < NP; i++) {
      const a = m(i), b = m(i + 1);
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    ctx.closePath();
  }
  function bladeSub(ctx, x, y, ang, len, wd, bend) {   // same geometry as blade(), no beginPath/fill (batched)
    const c = Math.cos(ang), sn = Math.sin(ang), nx = -sn, ny = c;
    const tx = x + c * len + nx * bend * len * 0.3, ty = y + sn * len + ny * bend * len * 0.3;
    const o1 = wd * 0.35 + bend * len * 0.12, o2 = wd * 0.35 - bend * len * 0.12;
    ctx.moveTo(x + nx * wd / 2, y + ny * wd / 2);
    ctx.quadraticCurveTo(x + c * len * 0.55 + nx * o1, y + sn * len * 0.55 + ny * o1, tx, ty);
    ctx.quadraticCurveTo(x + c * len * 0.5 - nx * o2, y + sn * len * 0.5 - ny * o2, x - nx * wd / 2, y - ny * wd / 2);
    ctx.closePath();
  }
  function drawGreenery(ctx, patches, o) {
    o = o || {};
    const seed = o.seed || 0, list = [];
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      if (!p || !(p.r > 2)) continue;
      list.push({ x: p.x, y: p.y, r: p.r, g: clamp01(p.green == null ? 1 : p.green), s: patchShape(seed, p.x, p.y) });
    }
    if (!list.length) return;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // pass 1: edge rim under the fills (only the outer half of the stroke survives, so no lines inside overlaps)
    ctx.beginPath();
    list.forEach((q) => lawnPath(ctx, q.s, q.x, q.y, q.r));
    ctx.lineWidth = 6; ctx.strokeStyle = GRASS_EDGE; ctx.stroke();
    // pass 2: all fills in one nonzero path, so overlaps merge into one lawn
    ctx.fillStyle = GRASS; ctx.fill();
    // pass 3: tonal blobs, then clovers (batched per colour)
    for (let c = 0; c < 2; c++) {
      ctx.beginPath();
      list.forEach((q) => q.s.blobs.forEach((b) => {
        if (b.c !== c || b.th > 0.15 + q.g * 0.85) return;
        const rx = b.rx * q.r, ry = b.ry * q.r, cx = q.x + b.x * q.r, cy = q.y + b.y * q.r;
        ctx.moveTo(cx + rx, cy); ctx.ellipse(cx, cy, rx, ry, b.rot, 0, TAU);
      }));
      ctx.fillStyle = c ? GRASS_LIGHT : GRASS_MID; ctx.fill();
    }
    ctx.beginPath();
    list.forEach((q) => q.s.clovers.forEach((cv) => {
      if (cv.th > q.g) return;
      const cr = 3.2 + q.r * 0.012, cx = q.x + cv.x * q.r, cy = q.y + cv.y * q.r;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + i * TAU / 3, px = cx + Math.cos(a) * cr * 0.62, py = cy + Math.sin(a) * cr * 0.62;
        ctx.moveTo(px + cr * 0.62, py); ctx.arc(px, py, cr * 0.62, 0, TAU);
      }
    }));
    ctx.fillStyle = '#93de88'; ctx.fill();
    // pass 4: grass tufts (interior in two greens, rim tufts poking outward), batched per colour
    const tufts = (key, sel, fill) => {
      ctx.beginPath();
      list.forEach((q) => q.s[key].forEach((t, i) => {
        if (!sel(i) || t.th > 0.1 + q.g * 0.9) return;
        const size = (7 + q.r * 0.05) * t.sz, bw = size * 0.28;
        t.bl.forEach((b) => bladeSub(ctx, q.x + t.x * q.r, q.y + t.y * q.r, b[0], size * b[1], bw, b[2]));
      }));
      ctx.fillStyle = fill; ctx.fill();
    };
    tufts('inner', (i) => i % 3 !== 0, GRASS_DARK);
    tufts('inner', (i) => i % 3 === 0, '#4aa94f');
    tufts('edge', () => true, GRASS_EDGE);
    // pass 5: flowers on fully grown patches only
    list.forEach((q) => {
      if (q.g < 0.999) return;
      q.s.flowers.forEach((f) => {
        const fr = (5 + q.r * 0.03) * f.sz;
        flower(ctx, q.x + f.x * q.r, q.y + f.y * q.r, fr, f.c, () => f.rot / TAU);
      });
    });
    ctx.restore();
  }

  // ---------- cached image ----------
  function tileImage(opts, px) {
    const key = JSON.stringify(opts || {}) + '|' + px;
    if (imgCache[key]) return imgCache[key];
    const c = document.createElement('canvas');
    c.width = c.height = Math.max(1, Math.round(px));
    drawTile(c.getContext('2d'), px / 2, px / 2, px * TILE_FIT, opts || {});
    return (imgCache[key] = c.toDataURL('image/png'));
  }

  RD.TreeArt = { drawTile: drawTile, drawVine: drawVine, tileImage: tileImage, drawSoil: drawSoil, drawGreenery: drawGreenery, VINE_GROW_TIME: 0.8 };
})();
