// Gezegen temaları: her gezegenin kendi arayüz renkleri ve gezegen/uzay paleti.
// Renkler İnspo/ klasöründeki paletlerden türetildi (görseller oyunda kullanılmaz):
// Okyanus = mor-lacivert gece, Buz = arduvaz-camgöbeği, Çöl = gül-mürdüm akşamı (#4C1D3D → #FFBB94),
// Gaz devi = alacakaranlık (#26425A, #86A8CF, #C38EB4, #E1CBD7). Hepsi tonal ve sade: neon, parlayan kenar yok.
(function (root) {
  'use strict';

  const THEMES = {
    okyanus: {
      name: 'Okyanus',
      css: {
        // mor-lacivert alacakaranlık (İnspo: mor bulutlu gece göğü); altın şimşek bu zeminde öne çıkar
        bg: '#0e0c1e', card: '#15132b', card2: '#1a1833', el: '#242044', el2: '#2e2a54', deep: '#0a0918',
        text: '#ece8f4', text2: '#bab3cd', muted: '#857e9e', dim: '#3e3859',
        accent: '#aea8e2', accent2: '#7c76c2', 'on-accent': '#16122e', violet: '#c9a3d6',
      },
      planet: {
        id: 'okyanus', kind: 'terra', sea: 0.62,
        ocean: [[10, 26, 64], [56, 116, 172]], coast: [206, 214, 184],
        land: [[92, 160, 108], [52, 116, 88], [126, 138, 104]], peak: [230, 230, 238], ice: [222, 226, 244],
        cloud: [238, 236, 250], storm: [64, 56, 98], atmo: [168, 160, 228], halo: [160, 150, 220],
        space: [[34, 27, 68], [10, 8, 22]], star: [222, 216, 242], spark: [204, 194, 236],
        layers: ['#2d2662', '#251f53', '#1d1844', '#161236'], layerA: 0.75,
      },
    },
    // Buz/Çöl/Gaz da Okyanus gibi sade alacakaranlık: koyu tonal katmanlar, düşük doygunluk, parlama yok
    buz: {
      name: 'Buz',
      css: {
        // soğuk arduvaz-camgöbeği gece; buz rengi yalnızca vurguda
        bg: '#0b1419', card: '#111c23', card2: '#15222a', el: '#1e3039', el2: '#283c47', deep: '#081014',
        text: '#e8f1f4', text2: '#b3c5cc', muted: '#7d929b', dim: '#344954',
        accent: '#a9cdd9', accent2: '#6f97a7', 'on-accent': '#0d1f27', violet: '#b8b4dc',
      },
      planet: {
        id: 'buz', kind: 'ice', sea: 0.5,
        ocean: [[92, 132, 160], [146, 184, 206]], coast: [58, 92, 118],
        land: [[118, 156, 182], [164, 196, 214], [198, 220, 232]], peak: [232, 240, 246], ice: [222, 234, 242],
        cloud: [236, 242, 248], storm: [60, 82, 102], atmo: [150, 188, 208], halo: [128, 166, 190],
        space: [[22, 40, 52], [6, 12, 18]], star: [208, 226, 236], spark: [168, 198, 212],
        layers: ['#1f3946', '#19303b', '#132630', '#0e1d25'], layerA: 0.75,
      },
    },
    col: {
      name: 'Çöl',
      css: {
        // tozlu gül-mürdüm akşamı; kum rengi yalnızca vurguda
        bg: '#170e14', card: '#20141c', card2: '#261921', el: '#33222c', el2: '#3f2b37', deep: '#110a0f',
        text: '#f3e8e6', text2: '#cdb7b5', muted: '#9a8285', dim: '#4c3842',
        accent: '#dfb39c', accent2: '#b38578', 'on-accent': '#2a1616', violet: '#c9a3c8',
      },
      planet: {
        id: 'col', kind: 'desert', sea: 0.12,
        ocean: [[40, 88, 106], [74, 136, 146]], coast: [148, 92, 88],
        land: [[164, 92, 88], [196, 128, 106], [218, 162, 134]], peak: [238, 206, 182], ice: [238, 214, 198],
        cloud: [242, 222, 210], storm: [94, 54, 70], atmo: [216, 160, 142], halo: [196, 140, 128],
        space: [[50, 24, 40], [16, 7, 14]], star: [238, 214, 204], spark: [222, 180, 158],
        layers: ['#482a39', '#3c2330', '#311c27', '#26151f'], layerA: 0.75,
      },
    },
    gaz: {
      name: 'Gaz devi',
      css: {
        // mavi-leylak alacakaranlık (#26425A, #86A8CF, #C38EB4, #E1CBD7), Okyanus'tan biraz daha soğuk
        bg: '#100f1c', card: '#171627', card2: '#1c1a2f', el: '#27253f', el2: '#312e4d', deep: '#0b0a15',
        text: '#ece9f3', text2: '#bdb7cc', muted: '#878199', dim: '#403b57',
        accent: '#c4abcb', accent2: '#9483aa', 'on-accent': '#1d1424', violet: '#a9b2dc',
      },
      planet: {
        id: 'gaz', kind: 'gas', sea: 0,
        bands: [[38, 62, 86], [106, 134, 168], [160, 128, 158], [200, 186, 200], [104, 62, 86], [70, 58, 108]],
        ocean: [[0, 0, 0], [0, 0, 0]], coast: [0, 0, 0], land: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], peak: [0, 0, 0], ice: [0, 0, 0],
        cloud: [226, 218, 234], storm: [62, 46, 88], atmo: [176, 160, 204], halo: [156, 140, 186],
        space: [[30, 22, 56], [8, 6, 18]], star: [214, 204, 236], spark: [194, 178, 212],
        layers: ['#2e2650', '#261f44', '#1e1938', '#17132c'], layerA: 0.75, ring: [200, 188, 206],
      },
    },
  };

  const PREF_KEY = 'yagmur-firtinasi-tema';
  // Şimşek rengi her gezegende aynı: limon sarısı değil, yıldırım fotoğrafındaki sıcak kehribar
  const YELLOW = { yellow: '#e6b664', yellow2: '#f5d699', 'on-yellow': '#2b1d02' };
  let current = 'okyanus';
  const rgbCache = {};

  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`; };

  function apply(id) {
    const t = THEMES[id] || THEMES.okyanus;
    current = THEMES[id] ? id : 'okyanus';
    const st = document.documentElement.style;
    const vars = Object.assign({}, t.css, YELLOW);
    for (const k in vars) {
      st.setProperty('--' + k, vars[k]);
      rgbCache[k] = hexRgb(vars[k]);
      st.setProperty('--' + k + '-rgb', rgbCache[k]);
    }
    document.documentElement.dataset.planet = current;
    if (root.Planet) root.Planet.setTheme(t.planet);
  }

  // Görünüm tercihi bu tarayıcıya özgü; kayıtta tutulmaz. 'auto' = bakılan gezegen
  let autoId = 'okyanus';
  function pref() { try { return localStorage.getItem(PREF_KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function setPref(v) {
    try { localStorage.setItem(PREF_KEY, v); } catch (e) { /* depolama yok */ }
    apply(v === 'auto' ? autoId : v);
  }
  // bakılan gezegen değişince: tercih 'auto' ise arayüz renkleri de değişir
  function setAuto(id) {
    if (!THEMES[id]) id = 'okyanus';
    if (id === autoId) return;
    autoId = id;
    if (pref() === 'auto') apply(id);
  }

  root.Theme = { THEMES, apply, pref, setPref, setAuto, rgb: (k) => rgbCache[k] || '255, 255, 255', get current() { return current; } };
})(window);
