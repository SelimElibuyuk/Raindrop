// Katman 1 gezegen simülasyonu: bot Okyanus'u simulate.js gibi oynar, gezegenleri de yönetir
// (Erit, Gölge/Kalkan, 0,96 basınçta Boşalt), sıradaki gezegeni hazır olunca Şimşekle açar, ağaçta en ucuz düğümü alır.
// Çiftlik: Şimşek/dk düşünce fırtına. İtme: gezegen hedefi varken fırtına yok (ilerleme durana ya da 40 dk'ya kadar).
// Kullanım: node sim/planets.js [saat=16] ['{"BUZ_DONE":"1e80"}']
// Sonuç (YAPI 43: her gezegenin kendi sıfırlaması, gezegen açma bedelsiz): ilk fırtına 44 dk, Okyanus tamam 2 sa 38 dk,
// Büyük Erime 16 dk sonra, Kum Seli 31 dk, Süper Fırtına 40 dk; Katman 1 ~4 sa (taslak: gezegenler ayrıntılı ele alınacak).
const YF = require('../js/planets.js');
const HOURS = Number(process.argv[2] || 16);
for (const [k, v] of Object.entries(JSON.parse(process.argv[3] || '{}'))) YF.C[k] = typeof v === 'string' ? YF.D(v) : v;
const DT = 0.2;
const s = YF.newState();
let t = 0, nextAct = 0, runStart = 0, bestRate = 0, push = false, lastProg = 0, lastProgT = 0, lastMelt = 0;
const log = [];
const mark = (m) => log.push(`${YF.fmtTime(t).padStart(12)}  ${m}`);
const pending = () => YF.planetIds().filter((id) => YF.planetOpen(s, id) && !YF.planetDone(s, id));
const prog = () => pending().reduce((a, id) => a + YF.pMeasure(s, id).progress + YF.pCoverage(s, id), 0);
let treeDone = false;
const unlockNext = () => { const id = YF.planetReady(s); return !!id && YF.unlockPlanet(s, id); };
while (t < HOURS * 3600 && !s.broken) {
  YF.tick(s, DT); t += DT;
  for (const e of s.events) {
    if (e.type === 'planetOpen') mark(`GEZEGEN AÇILDI: ${e.id}`);
    if (e.type === 'planetDone') mark(`GEZEGEN TAMAMLANDI: ${e.id}`);
    if (e.type === 'broken') mark('DOYGUNLUĞU KIR');
    if (e.type === 'storm' && s.storms === 1) mark(`ilk fırtına +${e.gain}`);
  }
  s.events.length = 0;
  if (s.lightning.visible > 0) YF.clickLightning(s);
  if (t < nextAct) continue;
  nextAct = t + 1;
  // gezegen kilidi: önceki tamamlanınca Şimşekle aç
  if (unlockNext() && treeDone) { push = true; lastProg = 0; lastProgT = t; }
  // gezegenler
  for (const id of ['buz', 'col', 'gaz']) if (YF.planetOpen(s, id)) YF.pMaxAll(s, id);
  if (YF.planetOpen(s, 'buz')) {
    const b = s.planets.buz, m = YF.meltPreview(s);
    // donmaya 15 dk'dan fazla varsa eritip büyü, yoksa bırak donsun (Büyük Erime)
    const ttf = YF.C.BUZ_DONE.sub(b.ice).div(YF.pDamlaPerSec(s, 'buz').max(1)).toNumber();
    if (ttf > 900 && t - lastMelt > 5 && m.gain.gt(b.damla.mul(10).add(100))) { YF.melt(s); lastMelt = t; YF.pMaxAll(s, 'buz'); }
  }
  if (YF.planetOpen(s, 'col')) { while (YF.shadeCost(s).lt(s.planets.col.damla.mul(0.5)) && YF.buyShade(s)); if (YF.canShield(s)) YF.shield(s); }
  if (YF.planetOpen(s, 'gaz') && YF.pressure(s) >= 0.96) YF.vent(s);
  // her gezegenin kendi sıfırlaması (Büyük Erime / Kum Seli / Süper Fırtına)
  for (const id of ['buz', 'col', 'gaz']) if (YF.canPlanetReset(s, id)) { const g = YF.planetReset(s, id); if (s.planetResets[id] <= 2) mark(`${YF.RESET_NAME[id]} #${s.planetResets[id]}: +${g}`); }
  // fırtına kararı
  const rate = YF.canStorm(s) ? YF.stormGain(s) / Math.max(1, t - runStart) : 0;
  if (rate > bestRate) bestRate = rate;
  let storm = YF.canStorm(s) && rate < bestRate * 0.97;
  if (push) {
    const p = prog();
    if (p > lastProg + 0.002) { lastProg = p; lastProgT = t; }
    storm = YF.canStorm(s) && (!pending().length || t - lastProgT > 180 || t - runStart > 2400);
    s.auto.storm = false;
  }
  if (storm) {
    bestRate = 0;
    YF.doStorm(s);
    runStart = t;
    if (push) { push = false; if (YF.has(s, 'otoFirtina')) s.auto.storm = true; }
    let bought = true, planetNode = unlockNext();
    while (bought) {
      bought = false;
      const opts = YF.TREE.filter((n) => YF.canBuyNode(s, n.id)).sort((a, b) => a.cost - b.cost);
      if (opts.length) { YF.buyNode(s, opts[0].id); bought = true; if (opts[0].branch === 'Gezegenler') planetNode = true; }
    }
    if (!treeDone && YF.TREE.filter((n) => n.branch !== 'Gezegenler').every((n) => YF.nodeMaxed(s, n.id))) { treeDone = true; mark('ana ağaç bitti'); }
    // gezegen düğümü alındıysa ya da 30 dk'da bir: itme turu
    if (treeDone && (planetNode || t - lastProgT > 1800) && pending().length) { push = true; lastProg = 0; lastProgT = t; }
    continue;
  }
  if (YF.canCephe(s)) YF.doCephe(s); else if (YF.canBD(s)) YF.doBD(s);
  YF.maxAll(s);
}
console.log(log.join('\n'));
console.log(`son: ${YF.fmtTime(t)}, şimşek ${s.simsek}, fırtına ${s.storms}`);
for (const id of YF.planetIds()) { const m = YF.pMeasure(s, id); console.log(id, m.label, m.value, (m.progress * 100).toFixed(1) + '%', m.done); }
console.log('ağaç:', Object.entries(s.tree).filter(([k]) => YF.TREE_BY_ID[k].branch === 'Gezegenler').map(([k, v]) => k + 'x' + v).join(', '));
