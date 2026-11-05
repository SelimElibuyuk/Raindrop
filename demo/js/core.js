// Yağmur Fırtınası – oyun çekirdeği (Katman 1)
// Saf mantık: DOM'a dokunmaz. Tarayıcıda window.YF, Node'da module.exports olarak yüklenir;
// böylece aynı kod denge simülasyonunda da çalışır (sim/simulate.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../lib/break_eternity.min.js'));
  } else {
    root.YF = factory(root.Decimal);
  }
})(typeof self !== 'undefined' ? self : this, function (Decimal) {
  'use strict';

  const D = (v) => new Decimal(v);
  const BUILD = 45; // index.html'deki ?v= ile aynı tutulur; alt barda görünür (eski dosya önbellekte mi, anlaşılsın)

  // ---------------------------------------------------------------------------
  // Ayarlanabilir sabitler (denge simülasyonuyla ayarlanır)
  // ---------------------------------------------------------------------------
  const C = {
    START_DAMLA: 10,
    KALICI_DAMLA: 100,
    SET_SIZE: 10,
    SET_MULT: 2,              // 10'lu set tamamlanınca üretici ×2
    NEM_UNLOCK_COST: 1e3,
    NEM_COST_MULT: 10,
    NEM_GAIN: 0.08,           // her Nem alımı üretimi %8 hızlandırır (döküman: %11; sim ile düşürüldü)
    ISLAK_HAVA: 1.5,          // Islak Hava: Nem etkisi %50 güçlü
    CEPHE_NEM_BONUS: 1.0,     // her Hava Cephesi Nem etkisini +%100 güçlendirir
    BD_MULT: 2,               // her Basınç Düşüşü tüm üreticilere ×2
    BD_BASE_REQ: 20,
    BD_REQ_STEP: 15,          // 4. Basınç Düşüşünden sonra her biri +15 Kasırga
    CEPHE_BASE_REQ: 40,       // döküman: 80 (1e100 öncesi erişilemiyordu)
    CEPHE_REQ_STEP: 20,
    SOFTCAP: D('1e100'),
    SOFTCAP_POW: 0.5,         // 1e100 üstünde üretim karekökle yavaşlar
    STORM_AT: D('1e100'),
    // Alım sınırları: e200000'lere varan sonsuz büyümeyi ve her karede binlerce alımı (takılma) önler
    NEM_MAX: 100,
    BD_MAX: 7,
    PROD_MAX: 200,            // her kademeden en fazla alım (20 set)
    // Geç yumuşak tavan (Aşırı Doygunluk): 1e200'den sonra Nem ve 10'lu set bonusunun üssü
    // (200 / log10 damla)^LATE_POW ile küçülür; büyüme durmaz, giderek yavaşlar.
    // Bir sonraki gezegen bu eşikte açılacak (PRD).
    LATE_AT: 200,
    LATE_POW: 3,              // sim: tam ağaçla 1 sa e212.2, 24 sa e214.8 (sim/softcap.js)
    LIGHTNING_BASE: 390,      // Yıldırım ortalama 6,5 dakikada bir belirir
    LIGHTNING_SPREAD: 120,    // ± 120 sn, saniye cinsinden düzgün rastgele (270–510 sn)
    LIGHTNING_FIRST: 20,      // açıldıktan sonraki ilk yıldırım hızlı gelsin
    LIGHTNING_VISIBLE: 10,    // tıklanmazsa bu kadar saniye sonra kaybolur
    LIGHTNING_DURATION: 15,
    LIGHTNING_MULT: 5,
    AUTO_INTERVAL: 0.1,
    // Aşırı Doygunluk kademeleri: tamamlanan gezegen (buz/çöl/gaz) sayısına göre [at, pow]
    // (0 tamamlanmış = LATE_AT/LATE_POW). Doygunluğu Kır alınınca tavan kalkar.
    LATE_TIERS: [[225, 2.5], [250, 2], [300, 1.5]],
    OKYANUS_DONE: D('1e200'),

    // --- Gezegenler (sim/planets.js ile ayarlandı) ---
    PLANET_COVER: 100,        // kaplama = log10(damla) / 100 (Okyanus gibi)
    PLANET_LVL_MULT: 10,      // gezegen güçlendirme düğümü: seviye başına üretim ×10 (taslak; ağaç sonra ele alınacak)
    PLANET_BOOST: { buz: 1e3, col: 1e6, gaz: 1e9 }, // gezegenin temel üretim çarpanı
    PLANET_PART_W: 30,        // gezegen sıfırlamasının Şimşeği = W · (log10 ölçü / 100)² · fırtına çarpanı
    // Gezegen kilidi: zincir (Buz ← Okyanus, Çöl ← Buz, Gaz ← Çöl tamamlandı), gezegenin kendi ekranında Şimşekle açılır
    PLANET_COST: { buz: 0, col: 0, gaz: 0 }, // önceki gezegen bitince bedelsiz açılır (Şimşek beklemesi yok)
    BUZ_MELT_K: 0.5,          // Erit çarpanı = 1 + K · log10(buz)
    BUZ_DONE: D('1e33'),      // tam donma → Büyük Erime (sim: ilk ~17 dk)
    COL_STEAM: 20,            // Çöl'de Sıcak Hava (1. kademe) çok güçlü
    COL_EVAP: 0.05,           // saniyede kaybolan damla oranı
    COL_SHADE_RED: 0.8,       // her Gölge buharlaşmayı ×0,8
    COL_SHADE_COST: 1e3,
    COL_SHADE_MULT: 1e4,
    COL_SHADE_MAX: 20,
    COL_SHIELD_DUR: 20,       // Bulut Kalkanı: kayıp durur (sn)
    COL_SHIELD_CD: 90,        // bekleme (sn)
    COL_DONE: D('1e52'),      // Çöl tam kaplama → Kum Seli (sim: ilk ~31 dk)
    GAZ_FILL: 60,             // basınç 0→1 süresi (sn)
    GAZ_VENT_SEC: 60,         // Boşalt: basınç²× bu kadar saniyelik üretim
    GAZ_VENT_MIN: 0.95,       // tamamlanma için en düşük basınç
    GAZ_DONE: D('1e75'),      // Gaz devi tam kaplama → Süper Fırtına
    GAS_STORM_K: 1,           // Şimşek çarpanı = 1 + K · log10(gaz damla) / 100
    COMET_FRAC: 0.01,         // kuyruklu yıldız: taşan üretimin ^POW · FRAC kadarı sonraki gezegene
    COMET_POW: 0.5,
  };

  const PRODUCERS = [
    { id: 'buhar',    name: 'Buhar',            base: '10',   step: '1e3' },
    { id: 'bulut',    name: 'Bulut',            base: '100',  step: '1e4' },
    { id: 'yagmur',   name: 'Yağmur Bulutu',    base: '1e4',  step: '1e5' },
    { id: 'kumulo',   name: 'Kümülonimbus',     base: '1e6',  step: '1e6' },
    { id: 'hucre',    name: 'Fırtına Hücresi',  base: '1e9',  step: '1e8' },
    { id: 'super',    name: 'Süper Hücre',      base: '1e13', step: '1e10' },
    { id: 'tropik',   name: 'Tropikal Fırtına', base: '1e18', step: '1e12' },
    { id: 'kasirga',  name: 'Kasırga',          base: '1e24', step: '1e15' },
  ].map((p, i) => ({ ...p, tier: i, base: D(p.base), step: D(p.step) }));
  PRODUCERS.forEach((p, i) => { p.makes = i === 0 ? 'Damla' : PRODUCERS[i - 1].name; });

  const STAGES = [
    { id: 'cig',     name: 'Çiğ',            at: 0,   unlock: null,       label: 'Buhar' },
    { id: 'sis',     name: 'Sis',            at: 3,   unlock: 'nem',      label: 'Nem' },
    { id: 'yagmur',  name: 'Yağmur',         at: 10,  unlock: 'bd',       label: 'Basınç Düşüşü' },
    { id: 'saganak', name: 'Sağanak',        at: 25,  unlock: 'yildirim', label: 'Yıldırım' },
    { id: 'firtina', name: 'Fırtına',        at: 50,  unlock: 'cephe',    label: 'Hava Cephesi' },
    { id: 'kuresel', name: 'Küresel fırtına', at: 90, unlock: null,       label: 'Gezegen kararıyor' },
    { id: 'tam',     name: 'Tam kaplama',    at: 100, unlock: 'storm',    label: '???' },
  ]; // at = log10(damla)

  // Şimşek ağacı: dallanan bir yıldırım. x/y: ağaç görünümündeki piksel konumu (TREE_W × TREE_H).
  // parent: görünür olmak için alınmış olması gereken düğüm. via: çizgi bu noktalardan geçerek kırılır.
  // opens: alınınca açılan gezegen. req: ebeveyn dışında ek koşul (nodeReqMet).
  const TREE_W = 1800, TREE_H = 2120;
  const TREE = [
    { id: 'kivilcim', name: 'Kıvılcım', branch: 'Gövde', cost: 1, parent: null, x: 900, y: 120,
      desc: 'Tüm üretim ×2, Şimşek kazancı ×3' },
    { id: 'statikYuk', name: 'Statik Yük', branch: 'Gövde', cost: 10, parent: 'kivilcim', x: 935, y: 560, via: [[880, 330]],
      desc: 'Şimşek kazancı ×2' },
    { id: 'iyonFirtina', name: 'İyon Fırtınası', branch: 'Gövde', cost: 60, parent: 'statikYuk', x: 870, y: 1010, via: [[960, 790]],
      desc: 'Şimşek kazancı ×2' },

    { id: 'buharAkisi', name: 'Buhar Akışı', branch: 'Akış', cost: 1, parent: 'kivilcim', x: 655, y: 245, desc: 'Buhar üretimi ×2' },
    { id: 'yogusma', name: 'Yoğuşma', branch: 'Akış', cost: 2, parent: 'buharAkisi', x: 440, y: 300, desc: 'Tüm üreticiler ×2' },
    { id: 'islakHava', name: 'Islak Hava', branch: 'Akış', cost: 3, parent: 'yogusma', x: 215, y: 370, desc: "Nem'in her alımdaki etkisi %50 güçlü" },
    { id: 'bulutTohum', name: 'Bulut Tohumlama', branch: 'Akış', cost: 8, parent: 'yogusma', x: 470, y: 500,
      desc: 'Bulut, Yağmur Bulutu ve Kümülonimbus ×3' },
    { id: 'derinAkis', name: 'Derin Akış', branch: 'Akış', cost: 15, parent: 'bulutTohum', x: 300, y: 640,
      desc: 'Fırtına Hücresi ve üstü (kademe 5–8) ×3' },
    { id: 'setUstaligi', name: 'Set Ustalığı', branch: 'Akış', cost: 30, parent: 'derinAkis', x: 145, y: 800,
      desc: "10'lu set bonusu ×2 yerine ×2,5" },

    { id: 'buharOto', name: 'Buhar Otomatiği', branch: 'Otomasyon', cost: 1, parent: 'kivilcim', x: 1150, y: 245, desc: 'Buhar kendiliğinden alınır' },
    { id: 'ureticiOto', name: 'Üretici Otomatikleri', branch: 'Otomasyon', cost: 1, levels: 7, parent: 'buharOto', x: 1370, y: 300,
      desc: 'Her seviye bir kademeye (2–8) otomatik alım ekler' },
    { id: 'nemOto', name: 'Nem Otomatiği', branch: 'Otomasyon', cost: 2, parent: 'ureticiOto', x: 1590, y: 380, desc: 'Nem kendiliğinden alınır' },
    { id: 'basincOto', name: 'Basınç Otomatiği', branch: 'Otomasyon', cost: 3, parent: 'nemOto', x: 1460, y: 520,
      desc: 'Basınç Düşüşü koşul sağlanınca kendiliğinden yapılır' },
    { id: 'cepheOto', name: 'Cephe Otomatiği', branch: 'Otomasyon', cost: 20, parent: 'basincOto', x: 1650, y: 650,
      desc: 'Hava Cephesi eşiğe ulaşınca kendiliğinden gelir' },
    { id: 'otoFirtina', name: 'Otomatik Fırtına', branch: 'Otomasyon', cost: 50, parent: 'cepheOto', x: 1520, y: 810,
      desc: 'Kazanç son fırtınanınkine ulaşınca fırtına kendiliğinden kopar' },

    { id: 'kaliciDamla', name: 'Kalıcı Damla', branch: 'Hafıza', cost: 1, parent: 'kivilcim', x: 655, y: 720, via: [[870, 420]],
      desc: 'Her sıfırlamadan sonra 100 damlayla başla' },
    { id: 'basincHafiza', name: 'Basınç Hafızası', branch: 'Hafıza', cost: 3, parent: 'kaliciDamla', x: 470, y: 860,
      desc: 'Her tura 1 Basınç Düşüşü ile başla' },
    { id: 'rekor', name: 'Rekor Çarpanı', branch: 'Hafıza', cost: 5, parent: 'basincHafiza', x: 270, y: 990,
      desc: 'En yüksek damla rekoruna bağlı kalıcı çarpan' },
    { id: 'nemHafiza', name: 'Nem Hafızası', branch: 'Hafıza', cost: 12, parent: 'basincHafiza', x: 585, y: 1050,
      desc: 'Her sıfırlamadan sonra 10 Nem ile başla' },
    { id: 'cepheHafiza', name: 'Cephe Hafızası', branch: 'Hafıza', cost: 40, parent: 'nemHafiza', x: 420, y: 1210,
      desc: 'Her fırtınadan sonra 1 Hava Cephesi ile başla' },
    { id: 'sabitBasinc', name: 'Sabit Basınç', branch: 'Hafıza', cost: 100, parent: 'basincHafiza', x: 180, y: 1160,
      desc: 'Basınç Düşüşü artık üreticileri ve Nem’i sıfırlamaz' },
    { id: 'kaliciCephe', name: 'Kalıcı Cephe', branch: 'Hafıza', cost: 150, parent: 'cepheHafiza', x: 300, y: 1340,
      desc: 'Hava Cephesi artık üreticileri, Nem’i ve Basınç Düşüşlerini sıfırlamaz' },

    { id: 'sikYildirim', name: 'Sık Yıldırım', branch: 'Fırtına', cost: 2, parent: 'kivilcim', x: 1160, y: 700, via: [[925, 440]],
      desc: 'Yıldırım iki kat sık düşer' },
    { id: 'gucluYildirim', name: 'Güçlü Yıldırım', branch: 'Fırtına', cost: 3, parent: 'sikYildirim', x: 1350, y: 850, desc: 'Yıldırım bonusu ×3' },
    { id: 'hizliFirtina', name: 'Hızlı Fırtına', branch: 'Fırtına', cost: 5, parent: 'gucluYildirim', x: 1560, y: 990,
      desc: 'En hızlı turun ne kadar kısaysa o kadar büyük çarpan' },
    { id: 'uzunYildirim', name: 'Uzun Yıldırım', branch: 'Fırtına', cost: 6, parent: 'gucluYildirim', x: 1250, y: 1040,
      desc: 'Yıldırım bonusu iki kat uzun sürer' },
    { id: 'paratoner', name: 'Paratoner', branch: 'Fırtına', cost: 25, parent: 'uzunYildirim', x: 1430, y: 1190,
      desc: 'Yıldırımlar kendiliğinden yakalanır' },
    { id: 'gokGurultusu', name: 'Gök Gürültüsü', branch: 'Fırtına', cost: 35, parent: 'uzunYildirim', x: 1170, y: 1250,
      desc: 'Yıldırım bonusu sürerken fırtına kazancı ×2' },

    // gezegen dalları: her gezegen gövdeden (İyon Fırtınası) ayrılan kendi dalı; via[0] dalın gövdeden ayrıldığı yükseklik
    { id: 'buzDerin', name: 'Derin Don', branch: 'Gezegenler', cost: 2000, levels: 5, planet: 'buz', parent: 'iyonFirtina', x: 600, y: 1380,
      via: [[858, 1180]], desc: 'Her seviye Buz gezegeni üretimi ×10' },
    { id: 'buzErime', name: 'Hızlı Erime', branch: 'Gezegenler', cost: 2000, planet: 'buz', parent: 'buzDerin', x: 370, y: 1480,
      desc: 'Erit çarpanı iki kat hızlı büyür' },
    { id: 'colGunes', name: 'Kavurucu Güneş', branch: 'Gezegenler', cost: 3000, levels: 5, planet: 'col', parent: 'iyonFirtina', x: 640, y: 1780,
      via: [[918, 1640]], desc: 'Her seviye Çöl gezegeni üretimi ×10' },
    { id: 'colVaha', name: 'Vaha', branch: 'Gezegenler', cost: 3000, planet: 'col', parent: 'colGunes', x: 400, y: 1880,
      desc: 'Buharlaşma yarıya iner, Bulut Kalkanı iki kat uzun sürer' },
    { id: 'gazCekirdek', name: 'Gaz Çekirdeği', branch: 'Gezegenler', cost: 4000, levels: 5, planet: 'gaz', parent: 'iyonFirtina', x: 1150, y: 1480,
      via: [[866, 1380]], desc: 'Her seviye Gaz devi üretimi ×10' },
    { id: 'gazPompa', name: 'Basınç Pompası', branch: 'Gezegenler', cost: 4000, planet: 'gaz', parent: 'gazCekirdek', x: 1430, y: 1430,
      desc: 'Basınç iki kat hızlı dolar, Boşalt ×3' },
    { id: 'kuyrukluYildiz', name: 'Kuyruklu Yıldız Akışı', branch: 'Gezegenler', cost: 6000, planet: 'gaz', parent: 'gazCekirdek', x: 1330, y: 1700,
      desc: 'Damlası 1e100\'ü geçen gezegenin taşan üretiminin bir kısmı sonraki gezegene akar' },
    { id: 'doygunlukKir', name: 'Doygunluğu Kır', branch: 'Gezegenler', cost: 15000, planet: 'okyanus', req: 'hepsiDone',
      parent: 'iyonFirtina', x: 900, y: 2010, via: [[850, 1300], [930, 1700]],
      desc: 'Tüm gezegenler tamamlanınca: Aşırı Doygunluk kalkar, Yıldızlar sekmesi açılır' },
  ];
  const TREE_BY_ID = Object.fromEntries(TREE.map((n) => [n.id, n]));

  // Gezegenler: okyanus bugünkü döngü; diğerleri kendi damlası ve 4 üreticisiyle
  const PCOST = [['10', '1e3'], ['100', '1e4'], ['1e4', '1e5'], ['1e6', '1e6']];
  function planetProducers(names, unit) {
    const ps = names.map((n, i) => ({ id: n[0], name: n[1], tier: i, base: D(PCOST[i][0]), step: D(PCOST[i][1]) }));
    ps.forEach((p, i) => { p.makes = i === 0 ? unit : ps[i - 1].name; });
    return ps;
  }
  const PLANETS = [
    { id: 'okyanus', name: 'Okyanus', short: 'Okyanus', order: 0, unit: 'Damla', producers: PRODUCERS },
    { id: 'buz', name: 'Buz', short: 'Buz', order: 1, unit: 'Buz', node: 'buzDerin',
      producers: planetProducers([['kiragi', 'Kırağı'], ['karTanesi', 'Kar Tanesi'], ['buzul', 'Buzul'], ['kutup', 'Kutup Girdabı']], 'Buz') },
    { id: 'col', name: 'Çöl', short: 'Çöl', order: 2, unit: 'Damla', node: 'colGunes',
      producers: planetProducers([['sicakHava', 'Sıcak Hava'], ['toz', 'Toz Bulutu'], ['kumFirtina', 'Kum Fırtınası'], ['serap', 'Serap']], 'Damla') },
    { id: 'gaz', name: 'Gaz devi', short: 'Gaz', order: 3, unit: 'Damla', node: 'gazCekirdek',
      producers: planetProducers([['gazAkimi', 'Gaz Akımı'], ['bant', 'Bant'], ['girdap', 'Girdap'], ['buyukLeke', 'Büyük Leke']], 'Damla') },
  ];
  const PL = Object.fromEntries(PLANETS.map((p) => [p.id, p]));
  const PIDS = PLANETS.map((p) => p.id);
  const NEW_PIDS = ['buz', 'col', 'gaz'];

  // ---------------------------------------------------------------------------
  // Durum
  // ---------------------------------------------------------------------------
  // Gezegen durumu (PS). best: kalıcı en yüksek damla (fırtınada sıfırlanmaz)
  function newPS(id, start) {
    const st = D(start || C.START_DAMLA);
    const ps = { damla: st, p: [0, 1, 2, 3].map(() => ({ amount: D(0), bought: 0 })), runMax: D(st), best: D(st) };
    ps.p[0].amount = D(1); // ilk üretici hediye: Çöl'de başlangıç damlası buharlaşıp kilitlenmesin
    if (id === 'buz') Object.assign(ps, { ice: D(0), melts: 0, bestMelt: D(0) });
    if (id === 'col') Object.assign(ps, { shade: 0, shield: 0, shieldCd: 0 });
    if (id === 'gaz') Object.assign(ps, { pressure: 0, vents: 0, bestVent: D(0) });
    return ps;
  }

  function newState() {
    return {
      version: 2,
      planets: { buz: newPS('buz'), col: newPS('col'), gaz: newPS('gaz') },
      planetOpen: { okyanus: true, buz: false, col: false, gaz: false },
      planetDone: { okyanus: false, buz: false, col: false, gaz: false },
      planetResets: { buz: 0, col: 0, gaz: 0 }, // gezegenin kendi sıfırlama sayısı (kalıcı)
      planetSeen: {},           // arayüz yönlendirmesi: 1 = keşif bildirildi, 2 = gezegene bakıldı
      view: 'okyanus',
      broken: false,
      damla: D(C.START_DAMLA),
      p: PRODUCERS.map(() => ({ amount: D(0), bought: 0 })),
      nem: 0,
      bd: 0,
      cephe: 0,
      runMax: D(C.START_DAMLA),   // bu fırtına turundaki en yüksek damla (kademe görünürlüğü için)
      runTime: 0,
      totalTime: 0,
      recordDamla: D(C.START_DAMLA),
      unlocked: {},               // nem, bd, yildirim, cephe, storm, tree — tekrar kilitlenmez
      stageSeen: 0,
      simsek: 0,
      simsekTotal: 0,
      tree: {},                   // düğüm id -> seviye
      storms: 0,
      fastestRun: null,
      lastStormGain: 0,
      auto: {},                   // otomatik alım anahtarları (true = açık)
      autoTimer: 0,
      lightning: { next: null, visible: 0, active: 0, x: 0.5, y: 0.5, clicked: 0, missed: 0 },
      lastSeen: Date.now(),
      events: [],
    };
  }

  const has = (s, id) => (s.tree[id] || 0) > 0;
  const lvl = (s, id) => s.tree[id] || 0;
  const emit = (s, type, data) => { s.events.push({ type, ...data }); };

  // ---------------------------------------------------------------------------
  // Çarpanlar
  // ---------------------------------------------------------------------------
  function nemGain(s) {
    let g = C.NEM_GAIN * (1 + C.CEPHE_NEM_BONUS * s.cephe);
    if (has(s, 'islakHava')) g *= C.ISLAK_HAVA;
    return g;
  }
  // 1e200 üstünde 1'den küçülen üs katsayısı (Nem ve 10'lu set bonusuna uygulanır)
  // Aşırı Doygunluk kademesi: tamamlanan gezegen sayısıyla gevşer, Doygunluğu Kır ile kalkar
  function lateTier(s) {
    if (!C.LATE_POW || s.broken) return null;
    const n = NEW_PIDS.filter((id) => s.planetDone && s.planetDone[id]).length;
    if (!n) return { at: C.LATE_AT, pow: C.LATE_POW };
    const t = C.LATE_TIERS[Math.min(n, C.LATE_TIERS.length) - 1];
    return { at: t[0], pow: t[1] };
  }
  function lateFactor(s) {
    const lt = lateTier(s);
    if (!lt) return 1;
    const l = s.damla.max(1).log10().toNumber();
    return l <= lt.at ? 1 : Math.pow(lt.at / l, lt.pow);
  }
  const nemMult = (s) => Decimal.pow(1 + nemGain(s), s.nem * lateFactor(s));
  const setBase = (s) => (has(s, 'setUstaligi') ? 2.5 : C.SET_MULT);
  const setMult = (s, i) => Decimal.pow(setBase(s), Math.floor(s.p[i].bought / C.SET_SIZE) * lateFactor(s));

  function lightningMult(s) {
    if (s.lightning.active <= 0) return 1;
    return C.LIGHTNING_MULT * (has(s, 'gucluYildirim') ? 3 : 1);
  }
  const rekorMult = (s) => (has(s, 'rekor') ? Math.max(1, s.recordDamla.max(1).log10().toNumber() / 10) : 1);
  function hizliMult(s) {
    if (!has(s, 'hizliFirtina') || !s.fastestRun) return 1;
    return Math.min(10, Math.max(1, 3600 / s.fastestRun));
  }

  // Tüm üreticilere uygulanan çarpan (set çarpanı hariç)
  function globalMult(s) {
    let m = Decimal.pow(C.BD_MULT, s.bd).mul(nemMult(s));
    let k = lightningMult(s) * rekorMult(s) * hizliMult(s);
    if (has(s, 'kivilcim')) k *= 2;
    if (has(s, 'yogusma')) k *= 2;
    return m.mul(k);
  }

  function producerMult(s, i, gm) {
    let m = setMult(s, i).mul(gm || globalMult(s));
    if (i === 0 && has(s, 'buharAkisi')) m = m.mul(2);
    if (i >= 1 && i <= 3 && has(s, 'bulutTohum')) m = m.mul(3);
    if (i >= 4 && has(s, 'derinAkis')) m = m.mul(3);
    return m;
  }

  // 1e100 üstünde üretim karekökle yavaşlar
  function softcapFactor(s) {
    if (s.damla.lte(C.SOFTCAP)) return D(1);
    return C.SOFTCAP.div(s.damla).pow(C.SOFTCAP_POW);
  }

  // Ham kazancı 1e100 yumuşak tavanından geçirerek ekler. Tavan adım içinde analitik çözülür:
  // dd/dt = r·(S/d)^p  ⇒  d^(1+p) doğrusal büyür. (Eskiden katsayı adımın başındaki damlaya bakıyordu;
  // tek bir adım 1e88'den 1e326'ya fırlayıp tavanı tamamen atlayabiliyordu.)
  function addSoftcapped(d, raw) {
    const S = C.SOFTCAP, p = C.SOFTCAP_POW;
    if (raw.lte(0)) return d;
    if (d.lt(S)) {
      const need = S.sub(d);
      if (raw.lte(need)) return d.add(raw);
      raw = raw.sub(need);       // tavana kadar olan kısım tam sayılır, kalanı yavaşlar
      d = D(S);
    }
    const q = 1 + p;
    return d.pow(q).add(raw.mul(q).mul(S.pow(p))).pow(1 / q);
  }

  function damlaPerSec(s) {
    return s.p[0].amount.mul(producerMult(s, 0)).mul(softcapFactor(s));
  }

  // ---------------------------------------------------------------------------
  // Kademe görünürlüğü / maliyetler
  // ---------------------------------------------------------------------------
  // Kademe 1–4 damla yettikçe, 5–8 her biri bir Basınç Düşüşü ile açılır
  function tierOpen(s, i) {
    if (i < 4) return true;
    return s.bd >= i - 3;
  }
  function tierVisible(s, i) {
    if (!tierOpen(s, i)) return false;
    if (i === 0) return true;
    // sırayla açılır: yalnızca bir önceki kademeden elde varsa görünür (ya da bu kademe zaten alındıysa)
    return s.p[i - 1].amount.gt(0) || s.p[i].bought > 0;
  }
  const highestOpenTier = (s) => Math.min(7, 3 + s.bd);

  function producerCost(s, i) {
    const p = PRODUCERS[i];
    return p.base.mul(p.step.pow(Math.floor(s.p[i].bought / C.SET_SIZE)));
  }
  const nemCost = (s) => D(C.NEM_UNLOCK_COST).mul(Decimal.pow(C.NEM_COST_MULT, s.nem));

  // ---------------------------------------------------------------------------
  // Satın alımlar
  // ---------------------------------------------------------------------------
  function buyProducer(s, i, count) {
    if (!tierOpen(s, i)) return 0;
    let n = 0;
    while (n < count && s.p[i].bought < C.PROD_MAX) {
      const cost = producerCost(s, i);
      if (s.damla.lt(cost)) break;
      s.damla = s.damla.sub(cost);
      s.p[i].amount = s.p[i].amount.add(1);
      s.p[i].bought++;
      n++;
    }
    return n;
  }
  // 10'lu seti tamamla (yetmiyorsa alabildiği kadar)
  function buyUntil10(s, i) {
    return buyProducer(s, i, C.SET_SIZE - (s.p[i].bought % C.SET_SIZE));
  }
  // Önce tam setleri, kalanla tek tek al
  function buyMaxProducer(s, i) {
    if (!tierOpen(s, i)) return 0;
    let total = 0;
    for (let guard = 0; guard < 1000 && s.p[i].bought < C.PROD_MAX; guard++) {
      const left = C.SET_SIZE - (s.p[i].bought % C.SET_SIZE);
      const cost = producerCost(s, i).mul(left);
      if (s.damla.lt(cost)) break;
      total += buyProducer(s, i, left);
    }
    total += buyProducer(s, i, C.SET_SIZE);
    return total;
  }

  function buyNem(s) {
    if (!s.unlocked.nem || s.nem >= C.NEM_MAX) return false;
    const cost = nemCost(s);
    if (s.damla.lt(cost)) return false;
    s.damla = s.damla.sub(cost);
    s.nem++;
    return true;
  }
  function buyMaxNem(s) {
    let n = 0;
    while (n < 10000 && buyNem(s)) n++;
    return n;
  }

  function maxAll(s) {
    buyMaxNem(s);
    for (let i = 7; i >= 0; i--) buyMaxProducer(s, i);
  }

  // Toplu alım önizlemesi (durumu değiştirmez). mode: 1 | 10 | 100 | 'max'
  // Dönüş: { n: alınacak adet, cost: toplam maliyet, can: şu an alınabilir mi }
  function bulkInfo(s, i, mode) {
    return bulkCalc(PRODUCERS[i], s.p[i].bought, s.damla, mode);
  }
  // Okyanus ve gezegen üreticileri için ortak hesap (money: harcanabilir damla)
  function bulkCalc(p, bought0, money, mode) {
    let bought = bought0, cost = D(0), n = 0;
    const target = mode === 'max' ? Infinity : mode;
    for (let guard = 0; guard < 2000 && n < target; guard++) {
      const unit = p.base.mul(p.step.pow(Math.floor(bought / C.SET_SIZE)));
      const left = Math.min(C.SET_SIZE - (bought % C.SET_SIZE), target - n);
      const chunk = unit.mul(left);
      if (mode === 'max') {
        const room = money.sub(cost);
        if (room.lt(chunk)) {
          const k = Math.floor(room.div(unit).toNumber());
          if (k > 0) { n += k; cost = cost.add(unit.mul(k)); }
          break;
        }
      }
      cost = cost.add(chunk);
      n += left;
      bought += left;
    }
    if (mode === 'max' && n === 0) return { n: 1, cost: p.base.mul(p.step.pow(Math.floor(bought0 / C.SET_SIZE))), can: false };
    return { n, cost, can: n > 0 && money.gte(cost) };
  }
  function buyBulk(s, i, mode) {
    const b = bulkInfo(s, i, mode);
    return b.can ? buyProducer(s, i, b.n) : 0;
  }

  // Şu an kaç Nem alınabilir? { n, cost } (n=0 ise cost bir sonrakinin fiyatı)
  function nemMaxInfo(s) {
    let n = 0, cost = D(0), next = nemCost(s);
    while (s.nem + n < C.NEM_MAX && s.damla.gte(cost.add(next))) {
      cost = cost.add(next);
      n++;
      next = next.mul(C.NEM_COST_MULT);
    }
    return { n, cost: n ? cost : nemCost(s) };
  }

  // ---------------------------------------------------------------------------
  // Sıfırlamalar
  // ---------------------------------------------------------------------------
  function bdReq(s) {
    if (s.bd < 4) return { tier: 3 + s.bd, amount: C.BD_BASE_REQ };
    return { tier: 7, amount: C.BD_BASE_REQ + C.BD_REQ_STEP * (s.bd - 4) };
  }
  const canBD = (s) => {
    if (!s.unlocked.bd || s.bd >= C.BD_MAX) return false;
    const r = bdReq(s);
    return s.p[r.tier].amount.gte(r.amount);
  };
  const cepheReq = (s) => ({ tier: 7, amount: C.CEPHE_BASE_REQ + C.CEPHE_REQ_STEP * s.cephe });
  const canCephe = (s) => !!s.unlocked.cephe && s.p[7].amount.gte(cepheReq(s).amount);

  function resetProduction(s) {
    s.damla = D(has(s, 'kaliciDamla') ? C.KALICI_DAMLA : C.START_DAMLA);
    s.p = PRODUCERS.map(() => ({ amount: D(0), bought: 0 }));
    s.nem = has(s, 'nemHafiza') ? 10 : 0;
  }
  const baseBD = (s) => (has(s, 'basincHafiza') ? 1 : 0);

  function doBD(s) {
    if (!canBD(s)) return false;
    s.bd++;
    if (!has(s, 'sabitBasinc')) resetProduction(s);
    emit(s, 'bd', { count: s.bd });
    return true;
  }
  function doCephe(s) {
    if (!canCephe(s)) return false;
    s.cephe++;
    if (!has(s, 'kaliciCephe')) {
      s.bd = baseBD(s);
      resetProduction(s);
    }
    emit(s, 'cephe', { count: s.cephe });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Fırtına (prestige)
  // ---------------------------------------------------------------------------
  function stormMult(s) {
    let m = has(s, 'kivilcim') ? 3 : 1;
    if (has(s, 'statikYuk')) m *= 2;
    if (has(s, 'iyonFirtina')) m *= 2;
    if (has(s, 'gokGurultusu') && s.lightning.active > 0) m *= 2;
    return m;
  }
  // Şimşek parçaları: Okyanus fırtınası (log/100)²; gezegenler kendi sıfırlamalarında W·(ölçü/100)² (logaritmik)
  function planetStormParts(s) {
    const x = s.damla.max(1).log10().toNumber() / 100;
    const parts = { okyanus: x * x, buz: 0, col: 0, gaz: 0 };
    for (const id of NEW_PIDS) {
      if (!planetOpen(s, id)) continue;
      const y = pCoverage(s, id);
      parts[id] = C.PLANET_PART_W * y * y;
    }
    return parts;
  }
  // Okyanus fırtınası yalnızca Okyanus'u sıfırlar; Gaz devinin Şimşek çarpanı her kazanca uygulanır
  function stormGain(s) {
    if (s.damla.lt(C.STORM_AT)) return 0;
    return Math.floor(planetStormParts(s).okyanus * stormMult(s) * gasStormMult(s));
  }
  const canStorm = (s) => s.damla.gte(C.STORM_AT);

  function doStorm(s, auto) {
    if (!canStorm(s)) return 0;
    const gain = stormGain(s);
    s.simsek += gain;
    s.simsekTotal += gain;
    s.storms++;
    s.lastStormGain = gain;
    s.lastRunTime = s.runTime;
    if (!s.fastestRun || s.runTime < s.fastestRun) s.fastestRun = s.runTime;
    s.unlocked.tree = true;
    resetProduction(s);
    s.bd = baseBD(s);
    s.cephe = has(s, 'cepheHafiza') ? 1 : 0;
    s.runMax = D(s.damla);
    s.runTime = 0;
    s.autoPeak = 0;
    emit(s, 'storm', { gain, count: s.storms, auto: !!auto });
    return gain;
  }

  // ---------------------------------------------------------------------------
  // Şimşek ağacı
  // ---------------------------------------------------------------------------
  // Eski gezegen açıcı düğümleri (YAPI 42'de kalktı; gezegen artık kendi ekranında açılır)
  const OPENERS = { buzGezegeni: 'buz', colGezegeni: 'col', gazDevi: 'gaz' };
  // Gezegen düğümü yalnızca o gezegen açıksa var olur (gizem korunur)
  const planetHidden = (s, n) => !!OPENERS[n.id] || (!!n.planet && n.planet !== 'okyanus' && !planetOpen(s, n.planet));
  function nodeVisible(s, id) {
    const n = TREE_BY_ID[id];
    if (!n || !s.unlocked.tree || n.soon || planetHidden(s, n)) return false;
    return !n.parent || has(s, n.parent) || (!!OPENERS[n.parent] && planetOpen(s, OPENERS[n.parent]));
  }
  // Ebeveyn dışındaki ek koşul (gezegen düğümleri)
  function nodeReqMet(s, id) {
    const r = TREE_BY_ID[id].req;
    if (r === 'hepsiDone') return PIDS.every((p) => s.planetDone[p]);
    return true;
  }
  function nodeReqText(s, id) {
    const r = TREE_BY_ID[id].req;
    if (!r || nodeReqMet(s, id)) return null;
    return { hepsiDone: 'Dört gezegen de tamamlanmalı' }[r] || null;
  }
  // Bir alt seviye kilitli "hayalet" olarak görünür: ebeveyni görünür ama alınmamış
  function nodePreview(s, id) {
    const n = TREE_BY_ID[id];
    return !!n && !!n.parent && !planetHidden(s, n) && !nodeVisible(s, id) && nodeVisible(s, n.parent);
  }
  function nodeMaxed(s, id) {
    return lvl(s, id) >= (TREE_BY_ID[id].levels || 1);
  }
  function canBuyNode(s, id) {
    const n = TREE_BY_ID[id];
    return nodeVisible(s, id) && !nodeMaxed(s, id) && s.simsek >= n.cost && nodeReqMet(s, id);
  }
  function buyNode(s, id) {
    if (!canBuyNode(s, id)) return false;
    const n = TREE_BY_ID[id];
    s.simsek -= n.cost;
    s.tree[id] = lvl(s, id) + 1;
    // yeni otomatikler varsayılan olarak açık gelir
    if (id === 'buharOto') s.auto.p0 = true;
    if (id === 'ureticiOto') s.auto['p' + s.tree[id]] = true;
    if (id === 'nemOto') s.auto.nem = true;
    if (id === 'basincOto') s.auto.bd = true;
    if (id === 'basincHafiza' && s.bd < 1) s.bd = 1;
    if (id === 'cepheOto') s.auto.cephe = true;
    if (id === 'otoFirtina') s.auto.storm = true;
    if (id === 'nemHafiza' && s.nem < 10) s.nem = 10;
    emit(s, 'node', { id });
    if (id === 'doygunlukKir' && !s.broken) {
      s.broken = true;
      s.unlocked.stars = true;
      emit(s, 'broken', {});
    }
    return true;
  }

  // Hangi otomatikler sahip olunan durumda?
  function autoOwned(s, key) {
    if (key === 'p0') return has(s, 'buharOto');
    if (key[0] === 'p') return lvl(s, 'ureticiOto') >= Number(key.slice(1));
    if (key === 'nem') return has(s, 'nemOto');
    if (key === 'bd') return has(s, 'basincOto');
    if (key === 'cephe') return has(s, 'cepheOto');
    if (key === 'storm') return has(s, 'otoFirtina');
    if (PL[key] && key !== 'okyanus') return planetOpen(s, key) && (s.planetResets[key] || 0) > 0;
    return false;
  }

  function runAutobuyers(s) {
    if (autoOwned(s, 'nem') && s.auto.nem) buyMaxNem(s);
    for (let i = 7; i >= 0; i--) {
      if (autoOwned(s, 'p' + i) && s.auto['p' + i]) buyMaxProducer(s, i);
    }
    // her gezegenin kendi otomatiği: ilk sıfırlamasından sonra açılır
    for (const id of NEW_PIDS) {
      if (autoOwned(s, id) && s.auto[id]) for (let i = 3; i >= 0; i--) planetBuyMax(s, id, i);
    }
    if (autoOwned(s, 'cephe') && s.auto.cephe && canCephe(s)) doCephe(s);
    // Cephe mümkünken otomatik Basınç Düşüşü yapılmaz; Cephe kararı oyuncuda (ya da Cephe Otomatiğinde)
    if (autoOwned(s, 'bd') && s.auto.bd && !canCephe(s)) doBD(s);
    // düşük verimli otomatik fırtına: en az son fırtınanın kazancı birikince
    // ya da kazanç 10 sn'dir artmıyorsa (e200 tavanında kazanç son fırtınanınkine hiç yetişmeyebilir; tur takılı kalmasın)
    if (autoOwned(s, 'storm') && s.auto.storm && canStorm(s)) {
      const g = stormGain(s);
      if (g > (s.autoPeak || 0)) { s.autoPeak = g; s.autoPeakAt = s.runTime; }
      if (g >= 1 && (g >= Math.max(1, s.lastStormGain) || s.runTime - (s.autoPeakAt || 0) >= 10)) {
        s.autoPeak = 0;
        doStorm(s, true);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Yıldırım
  // ---------------------------------------------------------------------------
  function scheduleLightning(s, first) {
    let t = first ? C.LIGHTNING_FIRST : C.LIGHTNING_BASE + (Math.random() * 2 - 1) * C.LIGHTNING_SPREAD;
    if (!first && has(s, 'sikYildirim')) t /= 2;
    s.lightning.next = t;
  }

  function tickLightning(s, dt) {
    const L = s.lightning;
    if (!s.unlocked.yildirim) return;
    if (L.active > 0) L.active = Math.max(0, L.active - dt);
    if (L.visible > 0) {
      L.visible -= dt;
      if (L.visible <= 0) {
        L.visible = 0;
        L.missed++;
        scheduleLightning(s);
        emit(s, 'lightningMissed', {});
      }
      return;
    }
    if (L.next === null) scheduleLightning(s, true);
    L.next -= dt;
    if (L.next <= 0) {
      L.visible = C.LIGHTNING_VISIBLE;
      // gezegen diskinin içinde rastgele bir nokta (0–1 koordinat)
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.32;
      L.x = 0.5 + Math.cos(a) * r;
      L.y = 0.5 + Math.sin(a) * r;
      emit(s, 'lightning', {});
      if (has(s, 'paratoner')) clickLightning(s);
    }
  }

  const lightningDuration = (s) => C.LIGHTNING_DURATION * (has(s, 'uzunYildirim') ? 2 : 1);

  function clickLightning(s) {
    const L = s.lightning;
    if (L.visible <= 0) return false;
    L.visible = 0;
    L.active = lightningDuration(s);
    L.clicked++;
    scheduleLightning(s);
    emit(s, 'lightningHit', { mult: lightningMult(s) });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Aşamalar
  // ---------------------------------------------------------------------------
  // Kaplama ve aşama anlık damlaya bakar: sıfırlamada bulutlar da dağılır
  function coverage(s) {
    const l = s.damla.max(1).log10().toNumber();
    return Math.max(0, Math.min(1, l / 100));
  }
  function stageIndex(s) {
    const l = s.damla.max(1).log10().toNumber();
    let idx = 0;
    STAGES.forEach((st, i) => { if (l >= st.at) idx = i; });
    return idx;
  }
  function checkStages(s) {
    const idx = stageIndex(s);
    for (let i = 0; i <= idx; i++) {
      const u = STAGES[i].unlock;
      if (u && !s.unlocked[u]) {
        s.unlocked[u] = true;
        emit(s, 'unlock', { stage: i, feature: u });
      }
    }
    if (idx > s.stageSeen) {
      s.stageSeen = idx;
      emit(s, 'stage', { stage: idx });
    }
  }

  // ---------------------------------------------------------------------------
  // Gezegenler
  // ---------------------------------------------------------------------------
  const planetIds = () => PIDS.slice();
  function planetOpen(s, id) { return id === 'okyanus' || !!(s.planetOpen && s.planetOpen[id]); }
  const planetDone = (s, id) => !!(s.planetDone && s.planetDone[id]);
  // Kilit zinciri: her gezegen bir öncekinin tamamlanmasıyla keşfedilir, Şimşekle açılır
  const PLANET_PREV = { buz: 'okyanus', col: 'buz', gaz: 'col' };
  function planetUnlockReq(s, id) {
    const prev = PLANET_PREV[id];
    if (!prev) return null;
    const m = pMeasure(s, prev);
    return { text: `${PL[prev].name} tamamlanmalı`, progress: m.progress, met: m.done, cost: C.PLANET_COST[id], prev, label: m.label, value: m.value };
  }
  function planetUnlockHint(s, id) {
    if (planetOpen(s, id)) return null;
    const r = planetUnlockReq(s, id);
    if (!r) return null;
    return r.met ? `${fmt(r.cost)} Şimşekle açılır` : r.text;
  }
  // sıradaki kilitli gezegen (zincir sırasıyla)
  const nextPlanet = (s) => NEW_PIDS.find((id) => !planetOpen(s, id)) || null;
  // koşulu sağlanmış ama henüz açılmamış gezegen (yönlendirme için)
  function planetReady(s) {
    const id = nextPlanet(s);
    return id && planetUnlockReq(s, id).met ? id : null;
  }
  function canUnlockPlanet(s, id) {
    if (planetOpen(s, id) || nextPlanet(s) !== id) return false;
    const r = planetUnlockReq(s, id);
    return !!r && r.met && s.simsek >= r.cost;
  }
  function unlockPlanet(s, id) {
    if (!canUnlockPlanet(s, id)) return false;
    s.simsek -= C.PLANET_COST[id];
    s.planetOpen[id] = true;
    emit(s, 'planetOpen', { id });
    return true;
  }
  function markDone(s, id) {
    if (s.planetDone[id]) return;
    s.planetDone[id] = true;
    emit(s, 'planetDone', { id });
  }
  const startDamla = (s) => (has(s, 'kaliciDamla') ? C.KALICI_DAMLA : C.START_DAMLA);
  // Her gezegenin kendi sıfırlaması: kaplama tamamlanınca (Buz'da tam donma) yapılır, yalnızca o gezegeni sıfırlar
  const RESET_NAME = { buz: 'Büyük Erime', col: 'Kum Seli', gaz: 'Süper Fırtına' };
  const canPlanetReset = (s, id) => planetOpen(s, id) && pCoverage(s, id) >= 1;
  const planetResetGain = (s, id) => Math.floor(planetStormParts(s)[id] * stormMult(s) * gasStormMult(s));
  function planetReset(s, id, auto) {
    if (!canPlanetReset(s, id)) return 0;
    const gain = planetResetGain(s, id);
    s.simsek += gain;
    s.simsekTotal += gain;
    s.planetResets[id] = (s.planetResets[id] || 0) + 1;
    s.unlocked.tree = true;
    markDone(s, id);
    const old = s.planets[id], ps = newPS(id, startDamla(s));
    ps.best = old.best;
    if (id === 'buz') { ps.melts = old.melts; ps.bestMelt = old.bestMelt; }
    if (id === 'col') ps.shade = 0;
    if (id === 'gaz') { ps.vents = old.vents; ps.bestVent = old.bestVent; }
    s.planets[id] = ps;
    // ilk sıfırlamada gezegenin otomatiği açık gelir
    if (s.planetResets[id] === 1) s.auto[id] = true;
    emit(s, 'planetReset', { id, gain, count: s.planetResets[id], auto: !!auto });
    return gain;
  }
  function planetGlobal(s, id, offline) {
    // her gezegen bir öncekinden güçlü başlar (temel çarpan)
    let m = C.PLANET_BOOST[id] * Math.pow(C.PLANET_LVL_MULT, lvl(s, PL[id].node));
    if (id === 'gaz' && !offline) m *= C.LIGHTNING_MULT * (has(s, 'gucluYildirim') ? 3 : 1); // fırtına hiç durmaz
    return m;
  }
  function planetMult(s, id, i, g) {
    let m = Decimal.pow(C.SET_MULT, Math.floor(s.planets[id].p[i].bought / C.SET_SIZE)).mul(g === undefined ? planetGlobal(s, id) : g);
    if (id === 'col' && i === 0) m = m.mul(C.COL_STEAM);
    return m;
  }
  const softOf = (x) => (x.lte(C.SOFTCAP) ? D(1) : C.SOFTCAP.div(x).pow(C.SOFTCAP_POW));

  function pProducerCost(s, id, i) {
    if (id === 'okyanus') return producerCost(s, i);
    const p = PL[id].producers[i];
    return p.base.mul(p.step.pow(Math.floor(s.planets[id].p[i].bought / C.SET_SIZE)));
  }
  function planetBuy(s, id, i, count) {
    const ps = s.planets[id];
    let n = 0;
    while (n < count && ps.p[i].bought < C.PROD_MAX) {
      const cost = pProducerCost(s, id, i);
      if (ps.damla.lt(cost)) break;
      ps.damla = ps.damla.sub(cost);
      ps.p[i].amount = ps.p[i].amount.add(1);
      ps.p[i].bought++;
      n++;
    }
    return n;
  }
  function planetBuyMax(s, id, i) {
    const ps = s.planets[id];
    let total = 0;
    for (let guard = 0; guard < 1000 && ps.p[i].bought < C.PROD_MAX; guard++) {
      const left = C.SET_SIZE - (ps.p[i].bought % C.SET_SIZE);
      if (ps.damla.lt(pProducerCost(s, id, i).mul(left))) break;
      total += planetBuy(s, id, i, left);
    }
    return total + planetBuy(s, id, i, C.SET_SIZE);
  }
  function pBulkInfo(s, id, i, mode) {
    if (id === 'okyanus') return bulkInfo(s, i, mode);
    const ps = s.planets[id];
    return bulkCalc(PL[id].producers[i], ps.p[i].bought, ps.damla, mode);
  }
  function pBuy(s, id, i, mode) {
    if (id === 'okyanus') return mode === 'set' ? buyUntil10(s, i) : buyBulk(s, i, mode);
    if (!planetOpen(s, id)) return 0;
    if (mode === 'set') return planetBuy(s, id, i, C.SET_SIZE - (s.planets[id].p[i].bought % C.SET_SIZE));
    const b = pBulkInfo(s, id, i, mode);
    return b.can ? planetBuy(s, id, i, b.n) : 0;
  }
  function pTierVisible(s, id, i) {
    if (id === 'okyanus') return tierVisible(s, i);
    const p = s.planets[id].p;
    return i === 0 || p[i - 1].amount.gt(0) || p[i].bought > 0;
  }
  function pMaxAll(s, id) {
    if (id === 'okyanus') return maxAll(s);
    if (!planetOpen(s, id)) return;
    for (let i = 3; i >= 0; i--) planetBuyMax(s, id, i);
  }
  function pProducerRate(s, id, i) {
    if (id === 'okyanus') return i === 0 ? damlaPerSec(s) : s.p[i].amount.mul(producerMult(s, i));
    const ps = s.planets[id];
    const r = ps.p[i].amount.mul(planetMult(s, id, i));
    return i === 0 ? r.mul(softOf(id === 'buz' ? ps.ice : ps.damla)) : r;
  }
  const pDamla = (s, id) => (id === 'okyanus' ? s.damla : s.planets[id].damla);
  // Saniyelik net kazanç (Buz için saniyelik Buz, Çöl için buharlaşma düşülmüş)
  function pDamlaPerSec(s, id) {
    if (id === 'okyanus') return damlaPerSec(s);
    const r = pProducerRate(s, id, 0);
    return id === 'col' ? r.sub(s.planets.col.damla.mul(evapRate(s))) : r;
  }
  const covOf = (d, id) => Math.max(0, Math.min(1, d.max(1).log10().toNumber() / (id ? DONE_AT(id).log10().toNumber() : C.PLANET_COVER)));
  const DONE_AT = (id) => (id === 'col' ? C.COL_DONE : C.GAZ_DONE);
  // Buz'da kaplama = donma: biriken buzun 1e80'e (BUZ_DONE) oranı; Erit buzu harcar, donma geriler
  const freezeOf = (d) => Math.max(0, Math.min(1, d.max(1).log10().toNumber() / C.BUZ_DONE.log10().toNumber()));
  const pCoverage = (s, id) => (id === 'okyanus' ? coverage(s) : id === 'buz' ? freezeOf(s.planets.buz.ice) : covOf(s.planets[id].damla, id));
  const pCoverageBest = (s, id) => (id === 'okyanus' ? covOf(s.recordDamla) : id === 'buz' ? freezeOf(s.planets.buz.bestMelt) : covOf(s.planets[id].best, id));
  const logOf = (d) => d.max(1).log10().toNumber();
  function pMeasure(s, id) {
    const done = planetDone(s, id);
    let label, value, progress;
    if (id === 'okyanus') {
      label = 'Damla rekoru'; value = `${fmt(s.recordDamla)} / ${fmt(C.OKYANUS_DONE)}`;
      progress = logOf(s.recordDamla) / logOf(C.OKYANUS_DONE);
    } else if (id === 'buz') {
      label = 'Donma'; progress = pCoverage(s, 'buz');
      value = `%${Math.floor(progress * 100)} · ${fmt(s.planets.buz.ice)} / ${fmt(C.BUZ_DONE)} Buz`;
    } else if (id === 'col') {
      label = 'En yüksek kaplama'; progress = pCoverageBest(s, 'col');
      value = '%' + Math.floor(progress * 100);
    } else {
      const b = s.planets.gaz.bestVent;
      label = 'Basınçlı boşaltma'; value = `${fmt(b)} / ${fmt(C.GAZ_DONE)}`;
      progress = logOf(b) / logOf(C.GAZ_DONE);
    }
    return { label, value, progress: done ? 1 : Math.max(0, Math.min(1, progress)), done };
  }

  // Buz: biriken buz Erit ile damlaya döner; çarpan buzla logaritmik büyür
  function meltPreview(s) {
    const ice = s.planets.buz.ice;
    const mult = 1 + C.BUZ_MELT_K * (has(s, 'buzErime') ? 2 : 1) * Math.max(0, logOf(ice));
    return { gain: ice.mul(mult), mult };
  }
  function melt(s) {
    const ps = s.planets.buz;
    if (!planetOpen(s, 'buz') || ps.ice.lte(0)) return D(0);
    const gain = meltPreview(s).gain;
    if (ps.ice.gt(ps.bestMelt)) ps.bestMelt = D(ps.ice);
    ps.damla = ps.damla.add(gain);
    ps.ice = D(0);
    ps.melts++;
    trackPlanet(s, 'buz');
    emit(s, 'melt', { gain });
    return gain;
  }

  // Çöl: damla her saniye buharlaşır; Gölge kaybı azaltır, Bulut Kalkanı kısa süre durdurur
  function evapRate(s) {
    const ps = s.planets.col;
    if (ps.shield > 0) return 0;
    return C.COL_EVAP * Math.pow(C.COL_SHADE_RED, ps.shade) * (has(s, 'colVaha') ? 0.5 : 1);
  }
  const shadeCost = (s) => D(C.COL_SHADE_COST).mul(Decimal.pow(C.COL_SHADE_MULT, s.planets.col.shade));
  function buyShade(s) {
    const ps = s.planets.col;
    if (!planetOpen(s, 'col') || ps.shade >= C.COL_SHADE_MAX) return false;
    const cost = shadeCost(s);
    if (ps.damla.lt(cost)) return false;
    ps.damla = ps.damla.sub(cost);
    ps.shade++;
    return true;
  }
  const canShield = (s) => planetOpen(s, 'col') && s.planets.col.shield <= 0 && s.planets.col.shieldCd <= 0;
  function shield(s) {
    if (!canShield(s)) return false;
    const ps = s.planets.col;
    ps.shield = C.COL_SHIELD_DUR * (has(s, 'colVaha') ? 2 : 1);
    ps.shieldCd = Math.max(C.COL_SHIELD_CD, ps.shield);
    emit(s, 'shield', {});
    return true;
  }

  // Gaz: basınç yükselir; Boşalt basınç²'ye bağlı patlama verir, 1'i geçerse kendiliğinden boşalır (yarısı kaybolur)
  const pressure = (s) => s.planets.gaz.pressure;
  function ventPreview(s) {
    const p = s.planets.gaz.pressure;
    const gain = pProducerRate(s, 'gaz', 0).mul(C.GAZ_VENT_SEC * p * p * (has(s, 'gazPompa') ? 3 : 1));
    return { gain, over: p > 1 };
  }
  function vent(s, auto) {
    const ps = s.planets.gaz, p = ps.pressure;
    if (!planetOpen(s, 'gaz') || p <= 0) return D(0);
    const v = ventPreview(s);
    const gain = v.over ? v.gain.div(2) : v.gain;
    ps.damla = addSoftcapped(ps.damla, gain);
    ps.pressure = 0;
    ps.vents++;
    if (!auto && !v.over && p >= C.GAZ_VENT_MIN) {
      if (ps.damla.gt(ps.bestVent)) ps.bestVent = D(ps.damla);
      if (ps.damla.gte(C.GAZ_DONE)) markDone(s, 'gaz');
    }
    trackPlanet(s, 'gaz');
    emit(s, 'vent', { gain, auto: !!auto, over: v.over });
    return gain;
  }
  // Fırtına kazancına Gaz devinin Şimşek çarpanı (logaritmik)
  function gasStormMult(s) {
    if (!planetOpen(s, 'gaz')) return 1;
    return 1 + C.GAS_STORM_K * Math.max(0, logOf(s.planets.gaz.damla)) / 100;
  }

  function trackPlanet(s, id) {
    const ps = s.planets[id];
    if (ps.damla.gt(ps.runMax)) ps.runMax = D(ps.damla);
    if (ps.damla.gt(ps.best)) ps.best = D(ps.damla);
    if (id === 'buz' && ps.ice.gt(ps.bestMelt)) ps.bestMelt = D(ps.ice);
    if (id === 'col' && ps.damla.gte(C.COL_DONE)) markDone(s, 'col');
  }

  function tickPlanets(s, dt, offline) {
    for (const id of NEW_PIDS) {
      if (!planetOpen(s, id)) continue;
      const ps = s.planets[id], g = planetGlobal(s, id, offline);
      for (let i = 3; i >= 1; i--) {
        if (ps.p[i].amount.gt(0)) ps.p[i - 1].amount = ps.p[i - 1].amount.add(ps.p[i].amount.mul(planetMult(s, id, i, g)).mul(dt));
      }
      const raw = ps.p[0].amount.mul(planetMult(s, id, 0, g)).mul(dt);
      if (id === 'buz') ps.ice = addSoftcapped(ps.ice, raw);
      else if (id === 'col') {
        ps.shield = Math.max(0, ps.shield - dt);
        ps.shieldCd = Math.max(0, ps.shieldCd - dt);
        const r = evapRate(s);
        // kesin çözüm: d' = P − r·d (büyük adımlarda da doğru denge)
        if (r > 0) { const e = Math.exp(-r * dt); ps.damla = addSoftcapped(ps.damla.mul(e), raw.mul((1 - e) / (r * dt))); }
        else ps.damla = addSoftcapped(ps.damla, raw);
      } else {
        ps.damla = addSoftcapped(ps.damla, raw);
        ps.pressure += (dt / C.GAZ_FILL) * (has(s, 'gazPompa') ? 2 : 1);
        if (ps.pressure > 1) vent(s, true);
      }
      trackPlanet(s, id);
    }
    if (has(s, 'kuyrukluYildiz')) cometFlow(s, dt, offline);
  }
  // Kuyruklu yıldız: 1e100'ü geçen gezegenin üretiminin ^POW·FRAC kadarı sıradaki açık gezegene akar
  function cometFlow(s, dt, offline) {
    const open = PIDS.filter((id) => planetOpen(s, id));
    for (let k = 0; k < open.length - 1; k++) {
      const src = open[k], dst = open[k + 1];
      if (pDamla(s, src).lt(C.SOFTCAP)) continue;
      const rate = src === 'okyanus' ? s.p[0].amount.mul(producerMult(s, 0))
        : s.planets[src].p[0].amount.mul(planetMult(s, src, 0, planetGlobal(s, src, offline)));
      const flow = rate.max(1).pow(C.COMET_POW).mul(C.COMET_FRAC * dt);
      const ps = s.planets[dst];
      if (dst === 'buz') ps.ice = addSoftcapped(ps.ice, flow);
      else ps.damla = addSoftcapped(ps.damla, flow);
    }
  }

  // ---------------------------------------------------------------------------
  // Zaman adımı
  // ---------------------------------------------------------------------------
  function tick(s, dt, opts) {
    opts = opts || {};
    const gm = globalMult(s);
    // 1e200 tavanı çarpanlara bağlı: bir adımda damla 10 kattan fazla artıp o bölgeye girecekse
    // adım bölünür; yoksa tek adımda tavanın çok üstüne fırlayıp sonra donuyordu
    const lt = lateTier(s);
    if ((opts.depth || 0) < 16 && lt) {
      const next = addSoftcapped(s.damla, s.p[0].amount.mul(producerMult(s, 0, gm)).mul(dt));
      if (next.log10().toNumber() > lt.at && next.gt(s.damla.mul(10))) {
        const sub = Object.assign({}, opts, { depth: (opts.depth || 0) + 1 });
        tick(s, dt / 2, sub);
        tick(s, dt / 2, sub);
        return;
      }
    }
    // üst kademe alttakini üretir
    for (let i = 7; i >= 1; i--) {
      if (s.p[i].amount.gt(0)) {
        s.p[i - 1].amount = s.p[i - 1].amount.add(s.p[i].amount.mul(producerMult(s, i, gm)).mul(dt));
      }
    }
    s.damla = addSoftcapped(s.damla, s.p[0].amount.mul(producerMult(s, 0, gm)).mul(dt));
    if (s.damla.gt(s.runMax)) s.runMax = D(s.damla);
    if (s.damla.gt(s.recordDamla)) s.recordDamla = D(s.damla);
    if (s.damla.gte(C.OKYANUS_DONE)) markDone(s, 'okyanus');
    tickPlanets(s, dt, !!opts.offline);
    s.runTime += dt;
    s.totalTime += dt;

    s.autoTimer += dt;
    if (s.autoTimer >= C.AUTO_INTERVAL) {
      s.autoTimer = 0;
      runAutobuyers(s);
    }
    if (!opts.offline) tickLightning(s, dt);
    checkStages(s);
  }

  // Çevrimdışı ilerleme: tam süre, parçalara bölünerek
  function simulateOffline(s, seconds) {
    if (seconds <= 1) return null;
    const before = D(s.damla), stormsBefore = s.storms;
    const steps = Math.min(2000, Math.ceil(seconds / 0.5));
    const dt = seconds / steps;
    // yıldırım bonusu çevrimdışı süreye taşınmaz
    s.lightning.active = 0;
    for (let k = 0; k < steps; k++) {
      s.autoTimer = C.AUTO_INTERVAL; // her adımda otomatikler çalışsın
      tick(s, dt, { offline: true });
    }
    return { seconds, before, after: D(s.damla), bd: s.bd, storms: s.storms - stormsBefore };
  }

  // ---------------------------------------------------------------------------
  // Kayıt
  // ---------------------------------------------------------------------------
  function serialize(s) {
    const o = { ...s, events: undefined };
    o.damla = s.damla.toString();
    o.runMax = s.runMax.toString();
    o.recordDamla = s.recordDamla.toString();
    o.p = s.p.map((p) => ({ amount: p.amount.toString(), bought: p.bought }));
    o.lastSeen = Date.now();
    o.planets = {};
    for (const id of NEW_PIDS) {
      const ps = s.planets[id], q = { ...ps };
      for (const k of DEC_KEYS) if (ps[k] !== undefined) q[k] = ps[k].toString();
      q.p = ps.p.map((p) => ({ amount: p.amount.toString(), bought: p.bought }));
      o.planets[id] = q;
    }
    return JSON.stringify(o);
  }
  const DEC_KEYS = ['damla', 'runMax', 'best', 'ice', 'bestMelt', 'bestVent'];
  function deserialize(str) {
    const o = JSON.parse(str);
    const s = Object.assign(newState(), o);
    s.damla = D(o.damla);
    s.runMax = D(o.runMax);
    s.recordDamla = D(o.recordDamla);
    s.p = PRODUCERS.map((_, i) => ({
      amount: D(o.p && o.p[i] ? o.p[i].amount : 0),
      bought: o.p && o.p[i] ? o.p[i].bought : 0,
    }));
    s.lightning = Object.assign(newState().lightning, o.lightning || {});
    // sınırlardan önceki kayıtlar: alım sayıları yeni sınırlara çekilir
    s.nem = Math.min(s.nem, C.NEM_MAX);
    s.bd = Math.min(s.bd, C.BD_MAX);
    s.p.forEach((p) => { p.bought = Math.min(p.bought, C.PROD_MAX); });
    delete s.capped;
    s.events = [];
    // sürüm 1 kayıtları: gezegen alanları varsayılanla gelir
    const def = newState();
    s.planets = {};
    for (const id of NEW_PIDS) {
      const q = (o.planets && o.planets[id]) || {}, ps = Object.assign(newPS(id), q);
      for (const k of DEC_KEYS) if (q[k] !== undefined) ps[k] = D(q[k]);
      ps.p = [0, 1, 2, 3].map((i) => ({
        amount: D(q.p && q.p[i] ? q.p[i].amount : 0),
        bought: q.p && q.p[i] ? Math.min(q.p[i].bought, C.PROD_MAX) : 0,
      }));
      s.planets[id] = ps;
    }
    s.planetOpen = Object.assign(def.planetOpen, o.planetOpen || {}, { okyanus: true });
    // YAPI 41 kayıtları: açıcı düğümle açılmış gezegen açık kalır; ağaçta olmayan düğümler düşer
    for (const k of Object.keys(s.tree)) {
      if (OPENERS[k]) s.planetOpen[OPENERS[k]] = true;
      if (OPENERS[k] || !TREE_BY_ID[k]) delete s.tree[k];
    }
    s.planetDone = Object.assign(def.planetDone, o.planetDone || {});
    if (s.recordDamla.gte(C.OKYANUS_DONE)) s.planetDone.okyanus = true;
    s.planetResets = Object.assign(def.planetResets, o.planetResets || {});
    s.view = typeof o.view === 'string' && PIDS.includes(o.view) ? o.view : 'okyanus';
    s.broken = !!o.broken;
    s.version = 2;
    // güvence: fırtına kopmuşsa ağaç ve 1e100'e kadarki tüm aşama özellikleri açıktır
    if (s.storms > 0 || s.simsekTotal > 0 || Object.keys(s.tree).length) {
      s.unlocked = Object.assign({}, s.unlocked, { nem: true, bd: true, yildirim: true, cephe: true, storm: true, tree: true });
    }
    return s;
  }

  // ---------------------------------------------------------------------------
  // Sayı gösterimi: 1e10'a kadar normal (1.000.000), sonrası bilimsel (1,23e15)
  // ---------------------------------------------------------------------------
  // Intl biçimlendiricileri bir kez kurulur; toLocaleString her çağrıda yenisini oluşturur ve yavaştır
  const NF = [0, 1, 2].map((d) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: d }));
  function fmt(x, decimals) {
    const n0 = typeof x === 'number' ? x : null;
    if (n0 !== null && n0 >= 0 && n0 < 1e10) return fmtSmall(n0, decimals);
    x = D(x);
    if (x.lt(0)) return '-' + fmt(x.neg(), decimals);
    if (x.lt(1e10)) return fmtSmall(x.toNumber(), decimals);
    let e = Math.floor(x.log10().toNumber());
    let m = x.div(Decimal.pow(10, e)).toNumber();
    if (m >= 9.995) { m /= 10; e++; }
    return m.toFixed(2).replace('.', ',') + 'e' + e;
  }
  function fmtSmall(n, decimals) {
    if (decimals && n < 1000 && n % 1 !== 0) return NF[decimals].format(n);
    return NF[0].format(Math.floor(n));
  }

  function fmtTime(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
    if (h > 0) return `${h} sa ${m} dk`;
    if (m > 0) return `${m} dk ${s2} sn`;
    return `${s2} sn`;
  }

  return {
    BUILD, Decimal, D, C, PRODUCERS, STAGES, TREE, TREE_BY_ID, TREE_W, TREE_H,
    newState, has, lvl,
    nemGain, nemMult, setBase, setMult, lateFactor, lightningDuration, globalMult, producerMult, damlaPerSec, softcapFactor, lightningMult, rekorMult, hizliMult,
    tierOpen, tierVisible, highestOpenTier, producerCost, nemCost,
    buyProducer, buyUntil10, buyMaxProducer, buyNem, buyMaxNem, maxAll, bulkInfo, buyBulk, nemMaxInfo,
    bdReq, canBD, doBD, cepheReq, canCephe, doCephe,
    stormGain, stormMult, canStorm, doStorm,
    nodeVisible, nodePreview, nodeMaxed, canBuyNode, buyNode, autoOwned,
    clickLightning, coverage, stageIndex,
    tick, simulateOffline, serialize, deserialize, fmt, fmtTime,
    // gezegenler
    PLANETS, planetIds, planetOpen, planetDone, planetUnlockHint, pDamla, pDamlaPerSec, pCoverage, pCoverageBest, pMeasure,
    pProducerCost, pBulkInfo, pBuy, pTierVisible, pMaxAll, pProducerRate, planetMult, planetGlobal,
    meltPreview, melt, evapRate, shadeCost, buyShade, canShield, shield, pressure, ventPreview, vent, gasStormMult,
    planetStormParts, lateTier, nodeReqMet, nodeReqText, RESET_NAME, canPlanetReset, planetResetGain, planetReset,
    planetUnlockReq, canUnlockPlanet, unlockPlanet, nextPlanet, planetReady,
  };
});
