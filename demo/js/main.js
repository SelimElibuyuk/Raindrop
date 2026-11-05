// Oyun döngüsü, kayıt ve kısayollar
(function () {
  'use strict';
  const Y = window.YF, UI = window.UI;
  const SAVE_KEY = 'yagmur-firtinasi-k1';

  // Aynı anda tek sekme kaydeder: en son açılan sekme kaydın sahibi olur.
  // (İki sekme açıkken eski sekme her 10 sn'de kendi eski durumunu yazıp ilerlemeyi siliyordu.)
  const OWNER_KEY = SAVE_KEY + '-sahip';
  const TAB_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let saving = true;   // sıfırlama/içe aktarma sırasında ya da başka sekme devralınca kapanır
  let loadError = false;

  let speed = 1;
  let S = load();
  try { localStorage.setItem(OWNER_KEY, TAB_ID); } catch (e) { /* depolama yok */ }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return Y.newState(); }
    if (!raw) return Y.newState();
    try {
      return Y.deserialize(raw);
    } catch (e) {
      // okunamayan kaydın üzerine yeni oyun yazılmasın: önce yedekle
      console.warn('Kayıt okunamadı', e);
      try { localStorage.setItem(SAVE_KEY + '-yedek-' + Date.now(), raw); } catch (e2) { /* yok say */ }
      loadError = true;
      return Y.newState();
    }
  }
  function save() {
    if (!saving) return;
    try {
      if (localStorage.getItem(OWNER_KEY) !== TAB_ID) { stopSaving(); return; }
      localStorage.setItem(SAVE_KEY, Y.serialize(S));
      UI.setSaveTime(Date.now());
    } catch (e) { /* gizli pencere vb. */ }
  }
  function stopSaving() {
    if (!saving) return;
    saving = false;
    UI.modal(`<div class="lbl">KAYIT</div><h2>Oyun başka bir sekmede açık</h2>
      <p>İlerlemen silinmesin diye bu sekme artık kaydetmiyor. Diğer sekmede oynamaya devam et ya da bu sekmeyi yeniden yükle.</p>`);
  }
  // başka sekme açılıp sahipliği alırsa bu sekme kaydetmeyi bırakır
  window.addEventListener('storage', (e) => {
    if (e.key === OWNER_KEY && e.newValue !== TAB_ID) stopSaving();
  });

  // tema ilk çizimden önce: bakılan gezegene göre ya da Ayarlar'daki önizleme
  const HAS_P = typeof Y.planetIds === 'function';
  const view0 = HAS_P && S.view && Y.planetOpen(S, S.view) ? S.view : 'okyanus';
  const themePref = window.Theme.pref();
  window.Theme.setAuto(view0);
  window.Theme.apply(themePref === 'auto' ? view0 : themePref);
  UI.init(S, () => { UI.handleEvents(); UI.update(); });
  if (loadError) UI.toast('Kayıt okunamadı', 'Eski kayıt yedeklendi, yeni oyun başladı.');
  // sayfa ile betikler farklı sürümdense tarayıcı eski dosyaları önbellekten getiriyor demektir
  if (document.documentElement.dataset.build !== String(Y.BUILD)) {
    UI.toast('Eski dosyalar yüklendi', 'Sayfayı Ctrl+Shift+R ile yenile.');
  }

  // çevrimdışı ilerleme (tam süre)
  const away = (Date.now() - (S.lastSeen || Date.now())) / 1000;
  const offline = Y.simulateOffline(S, away);
  UI.handleEvents();
  UI.offlineSummary(offline);

  // ---- tek döngü: mantık + arayüz + gezegen her karede, ekran yenilemesiyle senkron ----
  // (ayrı zamanlayıcılar sayaçların 10 fps'de sıçramasına yol açıyordu)
  const canvas = document.getElementById('planet');
  const t0 = performance.now();
  let last = t0;
  function step(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 10) {
      // sekme arka planda uyutulduysa çevrimdışı gibi hesapla
      Y.simulateOffline(S, dt * speed);
    } else if (dt > 0) {
      dt *= speed;
      while (dt > 0) { const st = Math.min(dt, 0.1); Y.tick(S, st); dt -= st; }
    }
    UI.handleEvents();
  }
  (function frame(now) {
    step(now);
    UI.update();
    window.Planet.draw(canvas, UI.planetView((now - t0) / 1000));
    requestAnimationFrame(frame);
  })(t0);
  // sekme görünmezken rAF durur; arka planda da ilerleme sürsün
  setInterval(() => { if (document.hidden) step(performance.now()); }, 1000);
  setInterval(() => { if (!document.getElementById('page-stats').hidden) UI.updateStats(); }, 500);

  // ---- kayıt ----
  setInterval(save, 10000);
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  // ---- kısayollar ----
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if ((k === 'arrowleft' || k === 'arrowright') && !$('page-cycle').hidden) {
      e.preventDefault();
      UI.actions.view(k === 'arrowleft' ? -1 : 1);
    } else if (k === 'm') UI.actions.maxAll();
    else if (k === 'n') UI.actions.nem();
    else if (k === 'b') UI.actions.bd();
    else if (k >= '1' && k <= '8') UI.actions.buy(Number(k) - 1, 'fill');
  });

  // ---- ayarlar ----
  const $ = (id) => document.getElementById(id);
  $('save-btn').onclick = () => { save(); UI.toast('Kaydedildi'); };
  $('export-btn').onclick = () => {
    const ta = $('save-text');
    ta.hidden = false;
    ta.value = btoa(unescape(encodeURIComponent(Y.serialize(S))));
    ta.select();
    try { navigator.clipboard.writeText(ta.value); UI.toast('Kayıt panoya kopyalandı'); } catch (e) { /* elle kopyalanabilir */ }
  };
  $('import-btn').onclick = () => {
    const ta = $('save-text');
    if (ta.hidden || !ta.value.trim()) { ta.hidden = false; ta.value = ''; ta.placeholder = 'Kayıt metnini yapıştır, sonra tekrar İçe aktar'; ta.focus(); return; }
    try {
      const imported = Y.deserialize(decodeURIComponent(escape(atob(ta.value.trim()))));
      saving = false; // yeniden yüklenirken eski durum içe aktarılanın üzerine yazılmasın
      localStorage.setItem(SAVE_KEY, Y.serialize(imported));
      location.reload();
    } catch (e) { UI.toast('Kayıt okunamadı', 'Metni kontrol et'); }
  };
  // Tanı: Şimşek Ağacı sekmesinin gerçekte neden görünmediğini tek metinde toplar
  $('diag-btn').onclick = () => {
    const tab = $('tab-btn-tree'), page = $('page-tree'), cs = (el) => (el ? getComputedStyle(el) : null);
    const r = tab ? tab.getBoundingClientRect() : null;
    // reklam engelleyici yemi: tipik reklam sınıflı bir öğe gizlenirse engelleyici sayfaya müdahale ediyordur
    const bait = document.createElement('div');
    bait.className = 'adsbox ad-banner banner-ad';
    bait.style.cssText = 'position:absolute;left:-999px;top:0;width:10px;height:10px;';
    document.body.appendChild(bait);
    setTimeout(() => {
      const info = {
        build: { html: document.documentElement.dataset.build, js: Y.BUILD },
        save: { storms: S.storms, tree: !!S.unlocked.tree, simsek: S.simsek, nodes: Object.keys(S.tree) },
        tab: tab ? {
          hiddenAttr: tab.hidden, cls: tab.className, display: cs(tab).display, visibility: cs(tab).visibility,
          opacity: cs(tab).opacity, rect: r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        } : 'YOK',
        nav: [...document.querySelectorAll('#tabs button')].map((b) => b.textContent.trim() + (b.offsetWidth ? '' : ' (görünmez)')),
        page: { hidden: page.hidden, display: cs(page).display, nodes: document.querySelectorAll('#tree-nodes .tnode').length },
        adblock: bait.offsetHeight === 0 || cs(bait).display === 'none',
        errors: (window.__errs || []).slice(-8),
        tabs: (window.__tabs || []).slice(),
        current: [...document.querySelectorAll('.page')].filter((p) => !p.hidden).map((p) => p.id),
        where: location.protocol, ua: navigator.userAgent,
      };
      bait.remove();
      const ta = $('save-text');
      ta.hidden = false;
      ta.value = JSON.stringify(info);
      ta.select();
      try { navigator.clipboard.writeText(ta.value); UI.toast('Tanı bilgisi panoya kopyalandı'); } catch (e) { /* elle kopyalanabilir */ }
    }, 300);
  };
  $('reset-btn').onclick = () => {
    if (!confirm('Tüm ilerleme silinecek. Emin misin?')) return;
    saving = false; // yeniden yüklenirken visibilitychange eski durumu geri yazmasın
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* yok say */ }
    location.reload();
  };
  const speedBtns = $('speed-btns');
  function markSpeed() { speedBtns.querySelectorAll('button').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === speed)); }
  speedBtns.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    speed = Number(b.dataset.speed);
    markSpeed();
  };
  markSpeed();
  const themeBtns = $('theme-btns');
  function markTheme() { const v = window.Theme.pref(); themeBtns.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.theme === v)); }
  themeBtns.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    window.Theme.setPref(b.dataset.theme);
    markTheme();
  };
  markTheme();

  window.game = { get state() { return S; }, save }; // konsoldan deneme için
})();
