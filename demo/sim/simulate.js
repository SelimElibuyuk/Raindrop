// Denge simülasyonu: aynı çekirdeği bir bot ile oynatıp aşama ve fırtına sürelerini ölçer.
// Kullanım: node sim/simulate.js [fırtına sayısı] [bot tepki süresi sn] ['{"NEM_GAIN":0.1}' sabit denemesi]
const YF = require('../js/core.js');

const storms = Number(process.argv[2] || 1);
const react = Number(process.argv[3] || 1);   // bot kaç saniyede bir karar verir
const DT = 0.1;
Object.assign(YF.C, JSON.parse(process.argv[4] || '{}'));

const s = YF.newState();
let t = 0, nextAct = 0, runStart = 0, bestRate = 0;
const log = [];
const mark = (msg) => log.push(`${YF.fmtTime(t).padStart(12)}  ${msg}`);

let done = 0;
while (done < storms && t < 3600 * 24) {
  YF.tick(s, DT);
  t += DT;
  for (const e of s.events) {
    if (e.type === 'stage') mark(`aşama: ${YF.STAGES[e.stage].name}  (damla ${YF.fmt(s.damla)}, nem ${s.nem}, BD ${s.bd}, cephe ${s.cephe})`);
    if (e.type === 'bd') mark(`Basınç Düşüşü #${e.count}`);
    if (e.type === 'cephe') mark(`Hava Cephesi #${e.count}  (nem kazancı ${(YF.nemGain(s) * 100).toFixed(1)}%)`);
    if (e.type === "storm" && e.auto) { mark(`OTO-FIRTINA #${s.storms}: +${e.gain} Şimşek`); runStart = t; done++; }
  }
  s.events.length = 0;

  if (s.lightning.visible > 0) YF.clickLightning(s);
  if (t >= nextAct) {
    nextAct = t + react;
    // oyuncu gibi: Şimşek/dk zirveden düşmeye başlayınca ya da tavana dayanınca koparır
    // (eskiden 1e100'de hemen koparıyordu; kazancı olduğundan düşük gösteriyordu)
    const rate = YF.canStorm(s) ? YF.stormGain(s) / Math.max(1, t - runStart) : 0;
    if (rate > bestRate) bestRate = rate;
    if (YF.canStorm(s) && (s.capped || rate < bestRate * 0.97)) {
      bestRate = 0;
      const g = YF.doStorm(s);
      mark(`FIRTINA #${s.storms}: +${g} Şimşek, tur ${YF.fmtTime(t - runStart)}`);
      runStart = t;
      done++;
      // ağaçta en ucuz görünür düğümleri al
      let bought = true;
      while (bought) {
        bought = false;
        const opts = YF.TREE.filter((n) => YF.canBuyNode(s, n.id)).sort((a, b) => a.cost - b.cost);
        if (opts.length) { YF.buyNode(s, opts[0].id); bought = true; }
      }
      mark(`  ağaç: ${Object.entries(s.tree).map(([k, v]) => k + (v > 1 ? 'x' + v : '')).join(', ')}  kalan ${s.simsek}`);
      continue;
    }
    if (YF.canCephe(s) && !process.env.NOCEPHE) YF.doCephe(s);
    else if (YF.canBD(s)) YF.doBD(s);
    YF.maxAll(s);
  }
}
console.log(log.join('\n'));
