// Geç oyun sınır denemesi: ağacı tamamlanmış bir oyuncu tek turda ne kadar ileri gider?
// Üretici alım sınırı (PROD_MAX) ve 1e200 sonrası yumuşak tavan gücü (LATE_POW) için tablo basar.
// Kullanım: node sim/softcap.js [saat]   (varsayılan 12)
const YF = require('../js/core.js');
const { D } = YF;

const HOURS = Number(process.argv[2] || 24);
const DT = 0.5;
const CHECK = [1 / 6, 1, 6, 24].filter((h) => h <= HOURS);

function endgameState() {
  const s = YF.newState();
  s.unlocked = { nem: true, bd: true, yildirim: true, cephe: true, storm: true, tree: true };
  YF.TREE.forEach((n) => { s.tree[n.id] = n.levels || 1; });
  Object.assign(s.auto, { p0: true, p1: true, p2: true, p3: true, p4: true, p5: true, p6: true, p7: true, nem: true, bd: true });
  s.storms = 20;
  s.fastestRun = 360;                 // Hızlı Fırtına ×10
  s.recordDamla = D('1e200');         // Rekor Çarpanı ×20
  s.damla = D(YF.C.KALICI_DAMLA);
  s.bd = 1;                           // Basınç Hafızası
  return s;
}

function run(prodMax, latePow, softPow) {
  Object.assign(YF.C, { PROD_MAX: prodMax, LATE_POW: latePow, SOFTCAP_POW: softPow });
  const s = endgameState();
  const hit = {};
  const at = {};
  let t = 0, next = 0;
  while (t < HOURS * 3600) {
    YF.tick(s, DT);
    t += DT;
    s.events.length = 0;
    if (s.lightning.visible > 0) YF.clickLightning(s);
    if (t >= next) {
      next = t + 1;
      if (YF.canCephe(s)) YF.doCephe(s);
      else if (YF.canBD(s)) YF.doBD(s);
      YF.maxAll(s);
    }
    const l = s.damla.max(1).log10().toNumber();
    for (const e of [100, 200, 250, 300]) if (l >= e && hit[e] === undefined) hit[e] = t;
    for (const h of CHECK) if (at[h] === undefined && t >= h * 3600) at[h] = { log: l, gain: YF.stormGain(s), late: YF.lateFactor(s) };
  }
  const end = { log: s.damla.max(1).log10().toNumber(), gain: YF.stormGain(s), late: YF.lateFactor(s) };
  return { hit, at, end };
}

const tm = (sec) => (sec === undefined ? '—' : sec < 3600 ? `${Math.round(sec / 60)} dk` : `${(sec / 3600).toFixed(1)} sa`);
const rows = [];
for (const sp of [0.5]) for (const pm of [200]) {
  for (const lp of [3, 4, 5, 6]) {
    const t0 = Date.now();
    const r = run(pm, lp, sp);
    const end = r.end;
    rows.push([
      sp, pm, lp || 'yok', tm(r.hit[100]), tm(r.hit[200]), tm(r.hit[250]),
      ...CHECK.map((h) => `e${r.at[h].log.toFixed(1)}`),
      end.gain, end.late.toFixed(3), ((Date.now() - t0) / 1000).toFixed(0) + 's',
    ].join(' | '));
  }
}
console.log(['1e100 tavan üssü', 'üretici sınırı', 'k', '1e100', '1e200', '1e250', ...CHECK.map((h) => (h < 1 ? `${h * 60} dk` : `${h} sa`)), `Şimşek (${HOURS} sa)`, 'tavan katsayısı', 'süre'].join(' | '));
console.log(rows.join('\n'));
