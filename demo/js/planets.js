// Yağmur Fırtınası – gezegen sistemi (Buz, Çöl, Gaz devi)
// Gezegen mantığı tick ile iç içe olduğu için js/core.js içinde yaşar (YF.PLANETS, YF.melt, YF.vent …).
// Bu dosya yalnızca yükleme sırası sözleşmesi için vardır: tarayıcıda window.YF'i, Node'da çekirdeği döndürür.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else factory(root.YF);
})(typeof self !== 'undefined' ? self : this, function (YF) {
  'use strict';
  if (!YF || !YF.PLANETS) throw new Error('planets.js: önce core.js yüklenmeli');
  return YF;
});
