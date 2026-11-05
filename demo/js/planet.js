// Gezegen görünümü: ilerleme çubuğunun kendisi.
// Piksel bazlı küre çizimi: kıtalar ve bulutlar küre üzerinde 3B gürültüden üretilir (dikişsiz).
// Bulut haritası alan ağırlıklı sıralanır; böylece kaplama %40 ise gezegenin tam %40'ı buluttur.
(function (root) {
  'use strict';

  const TW = 512, TH = 256;          // doku boyutu (eşdikdörtgen)
  const SEA = 0.62;                  // deniz seviyesi (sıralı yükseklikte): ~%38 kara

  // ---------------------------------------------------------------------------
  // Gürültü
  // ---------------------------------------------------------------------------
  function hash3(x, y, z) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
      l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
      w);
  }
  function fbm(x, y, z, oct, seed) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) {
      s += a * noise3(x * f + seed * 17.13, y * f + seed * 3.71, z * f + seed * 9.37);
      n += a; a *= 0.5; f *= 2.03;
    }
    return s / n;
  }

  // Küre yüzeyinden örneklenen doku, alan ağırlıklı sıralamayla 0–1'e yayılır
  function makeTexture(seed, scale, oct, warp, band) {
    const t = new Float32Array(TW * TH);
    for (let y = 0; y < TH; y++) {
      const lat = (0.5 - (y + 0.5) / TH) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < TW; x++) {
        const lon = ((x + 0.5) / TW) * Math.PI * 2;
        let px = cl * Math.sin(lon) * scale, py = sl * scale, pz = cl * Math.cos(lon) * scale;
        if (warp) {
          const q = fbm(px * 0.7, py * 0.7, pz * 0.7, 3, seed + 5) - 0.5;
          const r = fbm(px * 0.7 + 3.1, py * 0.7, pz * 0.7, 3, seed + 9) - 0.5;
          px += q * warp; py += r * warp; pz += (q - r) * warp;
        }
        let v = fbm(px, py, pz, oct, seed);
        if (band) v += band * Math.cos(lat * 6);
        t[y * TW + x] = v;
      }
    }
    // alan ağırlıklı sıralama: kutuplar eşdikdörtgende fazla yer kaplar, cos(enlem) ile dengelenir
    const idx = new Uint32Array(TW * TH);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    idx.sort((a, b) => t[a] - t[b]);
    const w = new Float32Array(TH);
    let total = 0;
    for (let y = 0; y < TH; y++) { w[y] = Math.cos((0.5 - (y + 0.5) / TH) * Math.PI); total += w[y] * TW; }
    const out = new Float32Array(TW * TH);
    let acc = 0;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      acc += w[(i / TW) | 0];
      out[i] = acc / total;
    }
    return out;
  }

  let LAND = null, BAND = null, CLOUD = null, DETAIL = null, LANDC = null;
  // varsayılan tema (themes.js yüklenmeden önce de çizebilsin)
  let P = {
    id: 'okyanus', kind: 'terra', sea: SEA,
    ocean: [[10, 26, 64], [56, 116, 172]], coast: [206, 214, 184],
    land: [[92, 160, 108], [52, 116, 88], [126, 138, 104]], peak: [230, 230, 238], ice: [222, 226, 244],
    cloud: [238, 236, 250], storm: [64, 56, 98], atmo: [168, 160, 228], halo: [160, 150, 220],
    space: [[34, 27, 68], [10, 8, 22]], star: [222, 216, 242], spark: [204, 194, 236],
    layers: ['#2d2662', '#251f53', '#1d1844', '#161236'], layerA: 0.75,
  };
  const lerp3 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

  function setTheme(p) {
    if (!p) return;
    const changed = p.id !== P.id;
    P = p;
    if (changed) { LANDC = null; lastRender = -1; }
  }

  // Zemin rengi hiç değişmez: piksel başına dallanma yerine tema başına bir kez renge çevrilir (r, g, b, deniz)
  function bakeSurface() {
    const sea = P.sea, kind = P.kind;
    if (kind === 'gas' && !BAND) BAND = makeTexture(57, 1.1, 4, 2.4, 0.9);
    LANDC = new Uint8ClampedArray(TW * TH * 4);
    for (let y = 0; y < TH; y++) {
      const lat = (0.5 - (y + 0.5) / TH) * Math.PI, alat = Math.abs(lat);
      for (let x = 0; x < TW; x++) {
        const i = y * TW + x, h = LAND[i];
        let c, ocean = 0;
        if (kind === 'gas') {
          // bantlar: palet renkleri arasında yumuşak geçiş, ince türbülans çizgileriyle
          const B = P.bands, v = BAND[i] * (B.length - 1), k = Math.min(B.length - 2, v | 0), f = v - k;
          c = lerp3(B[k], B[k + 1], f * f * (3 - 2 * f));
          const ln = 0.92 + 0.08 * Math.sin(BAND[i] * 160);
          c = [c[0] * ln, c[1] * ln, c[2] * ln];
        } else if ((kind === 'terra' || kind === 'ice') && alat > 1.36 - (h - 0.5) * 0.2) {
          c = P.ice;                                                             // kutup buzu
        } else if (h < sea) {
          const s = h / sea, s3 = s * s * s;
          c = lerp3(P.ocean[0], P.ocean[1], s3); ocean = 255;
        } else {
          const e = (h - sea) / (1 - sea);
          if (e < 0.035) c = P.coast;                                            // kıyı
          else if (e < 0.7) c = lerp3(P.land[0], P.land[1], (e - 0.035) / 0.665);
          else if (e < 0.93) c = lerp3(P.land[1], P.land[2], (e - 0.7) / 0.23);
          else c = lerp3(P.land[2], P.peak, (e - 0.93) / 0.07);
          if (kind === 'desert') {
            // basamaklı kanyonlar ve kumul çizgileri
            const terr = (e * 14) % 1 < 0.08 ? 0.82 : 1;
            const dune = 1 + 0.06 * Math.sin(lat * 46 + h * 34);
            c = [c[0] * terr * dune, c[1] * terr * dune, c[2] * terr * dune];
          } else if (kind === 'ice') {
            // buz çatlakları: yükselti eş çizgileri koyu ve ince
            const crack = Math.abs(((e * 9) % 1) - 0.5) > 0.47 ? 0.62 : 1;
            c = [c[0] * crack, c[1] * crack, c[2] * crack];
          }
        }
        LANDC[i * 4] = c[0]; LANDC[i * 4 + 1] = c[1]; LANDC[i * 4 + 2] = c[2]; LANDC[i * 4 + 3] = ocean;
      }
    }
  }

  function ensureTextures() {
    if (!LAND) {
      LAND = makeTexture(11, 1.7, 6, 1.2, 0);
      CLOUD = makeTexture(23, 2.3, 5, 1.6, 0.06);
      DETAIL = makeTexture(41, 6.0, 3, 0, 0);
    }
    if (!LANDC) bakeSurface();
  }

  // ---------------------------------------------------------------------------
  // Piksel geometrisi (boyut değişince yeniden kurulur)
  // ---------------------------------------------------------------------------
  let G = null;
  const L = (() => { const v = [-0.55, 0.5, 0.67], n = Math.hypot(...v); return v.map((c) => c / n); })();
  const HV = (() => { const v = [L[0], L[1], L[2] + 1], n = Math.hypot(...v); return v.map((c) => c / n); })();

  function buildGeometry(N) {
    const tilt = 0.4, ct = Math.cos(tilt), st = Math.sin(tilt);
    const max = N * N;
    const g = {
      N, count: 0,
      pix: new Uint32Array(max), lonU: new Float32Array(max), rowOff: new Int32Array(max),
      px: new Float32Array(max), py: new Float32Array(max), pz: new Float32Array(max),
      lit: new Float32Array(max), spec: new Float32Array(max), rim3: new Float32Array(max), atm: new Float32Array(max),
    };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = ((i + 0.5) / N) * 2 - 1, y = -(((j + 0.5) / N) * 2 - 1);
        const r2 = x * x + y * y;
        if (r2 > 1) continue;
        const z = Math.sqrt(1 - r2);
        // görüş uzayından gezegen uzayına (eksen eğikliği)
        const pX = x, pY = y * ct + z * st, pZ = -y * st + z * ct;
        const lat = Math.asin(Math.max(-1, Math.min(1, pY))), lon = Math.atan2(pX, pZ);
        const k = g.count++;
        g.pix[k] = j * N + i;
        g.lonU[k] = (lon / (Math.PI * 2) + 1) % 1;
        g.rowOff[k] = Math.min(TH - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * TH))) * TW;
        g.px[k] = pX; g.py[k] = pY; g.pz[k] = pZ;
        const diff = Math.max(0, x * L[0] + y * L[1] + z * L[2]);
        g.lit[k] = 0.07 + 0.93 * diff;
        g.atm[k] = 0.3 + diff;
        g.spec[k] = Math.pow(Math.max(0, x * HV[0] + y * HV[1] + z * HV[2]), 60) * 210;
        g.rim3[k] = (1 - z) * (1 - z) * (1 - z) * 0.55;
      }
    }
    g.canvas = document.createElement('canvas');
    g.canvas.width = g.canvas.height = N;
    g.ctx = g.canvas.getContext('2d');
    g.img = g.ctx.createImageData(N, N);
    g.d32 = new Uint32Array(g.img.data.buffer);
    return g;
  }

  // ---------------------------------------------------------------------------
  // Gezegen piksel çizimi
  // ---------------------------------------------------------------------------
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const CYC = (() => { const lat = 0.42, lon = 1.3; return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]; })();

  function renderSphere(view) {
    const t0 = performance.now();
    const g = G, d32 = g.d32, cov = view.cov, t = view.t;
    const dark = smooth(0.88, 1, cov);
    const stormy = smooth(0.35, 0.95, cov);
    const haze = view.stage === 1 ? 0.18 : 0.04;
    const thr = 1 - cov;
    const rotL = t * 0.035, rotC = t * 0.045;
    const uL = rotL / (Math.PI * 2), uC = rotC / (Math.PI * 2), uD = -t * 0.01;

    // bulut rengi: tema bulutu → fırtına rengi (koyulaştıkça)
    const [cr, cg, cb] = lerp3(P.cloud, P.storm, Math.min(1, 0.37 * stormy + 0.63 * dark));
    const [ar, ag, ab] = P.atmo;

    // siklon gözü (Fırtına aşamasından itibaren); merkez bulutlarla birlikte döner
    const cycK = smooth(0.48, 0.75, cov);
    const cycR = 0.32 + 0.22 * cycK, cosR = Math.cos(cycR);
    const cr0 = Math.cos(-rotC), sr0 = Math.sin(-rotC);
    const cx = CYC[0] * cr0 + CYC[2] * sr0, cy = CYC[1], cz = -CYC[0] * sr0 + CYC[2] * cr0;

    // dış pikseller hiç yazılmadığı için şeffaf kalır; her karede temizlemeye gerek yok
    const fr = (x) => x - Math.floor(x);
    const oL = fr(uL), oC = fr(uC), oD = fr(uD);
    const lo = thr - 0.07, hiA = thr + 0.06, lo2 = thr - 0.02, hi2 = thr + 0.12, sLo = thr - 0.05, sHi = thr + 0.08;
    const dm = 1 - 0.5 * dark, on = cov > 0 ? 1 : 0;
    const st = (a0, b0, x) => { let q = (x - a0) / (b0 - a0); q = q < 0 ? 0 : q > 1 ? 1 : q; return q * q * (3 - 2 * q); };
    for (let k = 0; k < g.count; k++) {
      const ro = g.rowOff[k], u0 = g.lonU[k];
      // zemin (önceden renklendirilmiş doku)
      let u = u0 + oL; if (u >= 1) u -= 1;
      const li = (ro + ((u * TW) | 0)) * 4;
      let r = LANDC[li], gg = LANDC[li + 1], b = LANDC[li + 2];
      const ocean = LANDC[li + 3];

      // bulut örneği (siklon bölgesinde koordinat sarmal biçimde bükülür)
      let cro = ro, cu = u0, eye = 1, cyc = 0;
      if (cycK > 0) {
        const px = g.px[k], py = g.py[k], pz = g.pz[k];
        const dt = px * cx + py * cy + pz * cz;
        if (dt > cosR) {
          const f = 1 - Math.acos(dt < 1 ? dt : 1) / cycR;
          cyc = f;
          // salınım sınırlı: zamanla büyüyen bir terim sarmalı sonsuza dek sıkıştırıp halka deseni yapıyordu
          const ang = f * f * (cycK * 3.2 + 0.5 * Math.sin(t * 0.25));
          const ca = Math.cos(ang), sa = Math.sin(ang), dk = dt * (1 - ca);
          const qx = px * ca + (cy * pz - cz * py) * sa + cx * dk;
          const qy = py * ca + (cz * px - cx * pz) * sa + cy * dk;
          const qz = pz * ca + (cx * py - cy * px) * sa + cz * dk;
          const lat = Math.asin(qy > 1 ? 1 : qy < -1 ? -1 : qy);
          cro = Math.min(TH - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * TH))) * TW;
          cu = (Math.atan2(qx, qz) / (Math.PI * 2) + 1) % 1;
          eye = st(0.97, 0.9, f * cycK + (1 - cycK) * 0.5);
        }
      }
      let uc = cu + oC; if (uc >= 1) uc -= 1;
      let ud = u0 + oD; if (ud >= 1) ud -= 1;
      const cxi = (uc * TW) | 0;
      const det = DETAIL[cro + ((ud * TW) | 0)];
      const c = CLOUD[cro + cxi] + (det - 0.5) * 0.12 + cyc * 0.22 * cycK;
      // yumuşak kenar: ince bulut yarı saydam, çekirdek opak
      const a = on * st(lo, hiA, c) * eye * (0.55 + 0.45 * st(lo2, hi2, c));
      // bulut gölgesi zemine düşer
      const shadow = on * st(sLo, sHi, CLOUD[ro + ((cxi + 4) % TW)]) * 0.4;
      // bulut dokusu + kalın çekirdekler fırtınada koyulaşır
      let thick = (c - thr) * 4; thick = thick < 0 ? 0 : thick > 1 ? 1 : thick;
      const core = (0.8 + 0.2 * det) * (1 - 0.38 * stormy * thick) * a;
      const ga = (1 - a) * (1 - shadow);
      r = r * ga + cr * core; gg = gg * ga + cg * core; b = b * ga + cb * core;

      // ışık, deniz parıltısı, pus ve atmosfer kenarı
      const lit = g.lit[k];
      r *= lit; gg *= lit; b *= lit;
      if (ocean) { const sp = g.spec[k] * (1 - a); r += sp; gg += sp; b += sp * 0.9; }
      const hz = haze + g.rim3[k], ih = 1 - hz, at = hz * g.atm[k];
      // tek 32 bitlik yazım (ABGR, küçük uçlu); Uint8Clamped'e bayt bayt yazmaktan çok daha hızlı
      let R8 = (r * ih + ar * at) * dm, G8 = (gg * ih + ag * at) * dm, B8 = (b * ih + ab * at) * dm * 1.04;
      R8 = R8 > 255 ? 255 : R8 | 0; G8 = G8 > 255 ? 255 : G8 | 0; B8 = B8 > 255 ? 255 : B8 | 0;
      d32[g.pix[k]] = 0xff000000 | (B8 << 16) | (G8 << 8) | R8;
    }
    g.ctx.putImageData(g.img, 0, 0);
    stats.ms = performance.now() - t0;
  }
  const stats = { ms: 0 };

  // ---------------------------------------------------------------------------
  // Sahne
  // ---------------------------------------------------------------------------
  const rnd = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const STARS = Array.from({ length: 180 }, () => ({ x: rnd(), y: rnd(), s: rnd() * 1.3 + 0.3, p: rnd() * 6.28 }));
  const FLASHES = Array.from({ length: 10 }, () => ({ a: rnd() * 6.28, r: Math.sqrt(rnd()) * 0.8, phase: rnd() * 10 }));
  const SPARKS = Array.from({ length: 7 }, () => ({ x: rnd(), y: rnd() * 0.55, s: 4 + rnd() * 7, p: rnd() * 6.28 }));
  const pulses = [];
  let geo = { cx: 0, cy: 0, R: 0 };
  let lastRender = -1;

  function pulse(color) { pulses.push({ t0: performance.now(), color }); }

  // gaz devi şimşekleri: her döngüde aynı tohumdan yeni bir kırık çizgi (birim küre koordinatlarında)
  const GAS_BOLTS = 3, gasCache = {};
  function gasBolt(i, cyc) {
    const key = i + ':' + cyc;
    if (gasCache[key]) return gasCache[key];
    let h = (Math.imul(i + 1, 2654435761) ^ Math.imul(cyc + 7, 40503)) >>> 0;
    const r = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
    const a = r() * Math.PI * 2, d = 0.15 + r() * 0.5;
    let x = Math.cos(a) * d, y = Math.sin(a) * d * 0.8;
    const dir = r() * Math.PI * 2, pts = [[x, y]];
    for (let j = 0; j < 6; j++) {
      const ang = dir + (r() - 0.5) * 1.4;
      x += Math.cos(ang) * 0.06; y += Math.sin(ang) * 0.06;
      pts.push([x, y]);
    }
    for (const k in gasCache) delete gasCache[k]; // yalnızca güncel döngüler kalsın
    gasCache[key] = pts;
    return pts;
  }

  function draw(canvas, view) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w < 4 || h < 4) return; // görünmüyorsa çizme
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ensureTextures();
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42, t = view.t;
    geo = { cx, cy, R };

    // çözünürlük: ekrandaki boyuta yakın, en fazla 360 px (bulanık bulutlar için yeterli)
    const N = Math.max(64, Math.min(360, Math.round(R * 2 * dpr * 0.8))) & ~1;
    if (!G || G.N !== N) { G = buildGeometry(N); lastRender = -1; }
    // küre en fazla 30 fps; yavaş cihazda çizim süresine göre 15 fps'e kadar iner (arayüz tam hızda kalır)
    const every = Math.min(1 / 15, Math.max(1 / 30, stats.ms * 4 / 1000));
    if (!view.locked && (t - lastRender > every || lastRender < 0)) { renderSphere(view); lastRender = t; }

    const dark = smooth(0.88, 1, view.cov);
    const bg = ctx.createRadialGradient(cx, cy * 0.8, 0, cx, cy, Math.max(w, h) * 0.75);
    bg.addColorStop(0, `rgb(${P.space[0]})`);
    bg.addColorStop(1, `rgb(${P.space[1]})`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    for (const s of STARS) {
      ctx.fillStyle = `rgba(${P.star},${(0.25 + 0.3 * Math.sin(t * 1.2 + s.p)) * (1 - 0.5 * dark)})`;
      ctx.fillRect(s.x * w, s.y * h, s.s, s.s);
    }
    // dört köşeli parıltılar
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of SPARKS) {
      const a = (0.35 + 0.35 * Math.sin(t * 0.9 + s.p)) * (1 - 0.6 * dark), x = s.x * w, y = s.y * h, L = s.s;
      ctx.fillStyle = `rgba(${P.spark},${a})`;
      ctx.beginPath();
      ctx.moveTo(x, y - L); ctx.quadraticCurveTo(x, y, x + L * 0.7, y); ctx.quadraticCurveTo(x, y, x, y + L);
      ctx.quadraticCurveTo(x, y, x - L * 0.7, y); ctx.quadraticCurveTo(x, y, x, y - L); ctx.fill();
    }
    ctx.restore();

    // kesik kağıt gibi katmanlı dalgalar: kaplama arttıkça yükselir
    const nl = P.layers.length;
    for (let i = 0; i < nl; i++) {
      const base = h * (0.66 + i * 0.085) - view.cov * h * 0.12, amp = h * (0.035 + 0.01 * i);
      const wl = w * (0.55 + 0.18 * i), ph = t * 0.04 * (i % 2 ? -1 : 1) + i * 1.7;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w + 8; x += 8) {
        const k = (x / wl) * Math.PI * 2 + ph;
        ctx.lineTo(x, base + Math.sin(k) * amp + Math.sin(k * 2.3 + i) * amp * 0.35);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.globalAlpha = P.layerA;
      ctx.fillStyle = P.layers[i];
      ctx.fill();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = `rgb(${P.spark})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // kilitli gezegen: koyu siluet, ince sade kenar; parlama/hale yok
    if (view.locked) {
      ctx.fillStyle = `rgb(${P.space[1]})`;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      const sg = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.05, cx, cy, R);
      sg.addColorStop(0, 'rgba(255,255,255,0.06)');
      sg.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = sg;
      ctx.fill();
      ctx.strokeStyle = `rgba(${P.spark},0.16)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      lastRender = -1;
      return;
    }

    // atmosfer halesi
    const halo =view.stormReady ? [185, 160, 255] : view.boost ? [255, 220, 90] : P.halo;
    const ha = view.stormReady ? 0.45 + 0.2 * Math.sin(t * 4) : view.boost ? 0.4 : 0.3 * (1 - 0.4 * dark);
    const hg = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.32);
    hg.addColorStop(0, `rgba(${halo},${ha})`);
    hg.addColorStop(1, `rgba(${halo},0)`);
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.32, 0, Math.PI * 2); ctx.fill();

    // gaz devinin halkası: arka yarısı gezegenin arkasında, ön yarısı önünde
    const ring = (front) => {
      if (!P.ring) return;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(-0.32); ctx.scale(1, 0.26);
      for (const [rr, a, lw] of [[1.55, 0.55, R * 0.16], [1.82, 0.35, R * 0.08], [1.38, 0.25, R * 0.05]]) {
        ctx.strokeStyle = `rgba(${P.ring},${a})`;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(0, 0, R * rr, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    };
    ring(false);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(G.canvas, cx - R, cy - R, R * 2, R * 2);
    ring(true);

    // bulut içi şimşek parıltıları (Fırtına aşamasından itibaren)
    if (view.stage >= 4) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      for (const f of FLASHES) {
        const k = (t * 0.8 + f.phase) % 5;
        if (k > 0.16) continue;
        const x = cx + Math.cos(f.a) * f.r * R, y = cy + Math.sin(f.a) * f.r * R;
        const fg = ctx.createRadialGradient(x, y, 0, x, y, R * 0.28);
        fg.addColorStop(0, `rgba(200,200,255,${0.55 * (1 - k / 0.16)})`);
        fg.addColorStop(1, 'rgba(200,200,255,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(x - R * 0.3, y - R * 0.3, R * 0.6, R * 0.6);
      }
      ctx.restore();
    }

    // gaz devi: fırtına hiç durmaz. Sade, ince kehribar çatallar; parlama/bloom yok
    if (view.gasStorm) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 0; i < GAS_BOLTS; i++) {
        const per = 2.6 + i * 0.7, ph = (t + i * 1.37) / per, cyc = Math.floor(ph), k = (ph - cyc) * per;
        if (k > 0.32) continue;
        const pts = gasBolt(i, cyc), a = k < 0.06 ? 0.75 : 0.75 * (1 - (k - 0.06) / 0.26);
        ctx.strokeStyle = `rgba(230,182,100,${a.toFixed(3)})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        pts.forEach(([x, y], j) => (j ? ctx.lineTo(cx + x * R, cy + y * R) : ctx.moveTo(cx + x * R, cy + y * R)));
        ctx.stroke();
      }
      ctx.restore();
    }

    // eylem dalgaları (alım, sıfırlama, yıldırım)
    const now = performance.now();
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], k = (now - p.t0) / 900;
      if (k >= 1) { pulses.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(${p.color},${(1 - k) * 0.8})`;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * (1 + k * 0.35), 0, Math.PI * 2); ctx.stroke();
      if (k < 0.25) {
        ctx.fillStyle = `rgba(${p.color},${0.18 * (1 - k / 0.25)})`;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  root.Planet = { draw, pulse, setTheme, geometry: () => geo, stats };
})(window);
