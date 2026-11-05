// Arayüz: DOM'u bir kez kurar, her karede sadece değişen metin/sınıfları yazar.
// Tasarım: Figma "RainDrop İnc." (Döngü ve Şimşek Ağacı ekranları)
(function (root) {
  'use strict';
  const Y = root.YF;
  const { D, fmt, fmtTime, PRODUCERS, STAGES, TREE, TREE_BY_ID, TREE_W, TREE_H } = Y;
  const TREE_PAD = 420; // ağacın çevresindeki boş gezinme alanı
  const $ = (id) => document.getElementById(id);

  const fmtMult = (x) => '×' + fmt(x, 2);
  const pct = (x) => '%' + fmt(x, 1);
  const pad2 = (n) => String(n).padStart(2, '0');
  const hms = (sec) => { sec = Math.floor(sec || 0); return `${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor(sec / 60) % 60)}:${pad2(sec % 60)}`; };

  // tasarımdaki ikonlar ve doğal boyutları
  const ICON = {
    'p-buhar': [16.667, 14.167], 'p-bulut': [18.333, 13.333], 'p-kumulo': [16.667, 17.5], 'p-hucre': [15.333, 16.667],
    'p-super': [16.667, 16.667], 'b-firtina': [13.8, 15], 'lock-row': [13.333, 17.5], 'b-akis': [15, 12.525],
    'b-oto': [16.5, 14.25], 'b-hafiza': [13.5, 13.5], 'n-kivilcim': [29.333, 29.333], 'lock-tiny': [8, 10.5],
    'bolt-btn-dark': [12, 15], 'globe': [15, 15], 'bolt-spark': [13.28, 24],
  };
  const img = (name) => `<img src="assets/${name}.svg" width="${ICON[name][0]}" height="${ICON[name][1]}" alt="">`;
  const P_ICONS = ['p-buhar', 'p-bulut', 'p-bulut', 'p-kumulo', 'p-hucre', 'p-super', 'p-hucre', 'b-firtina'];
  const BRANCH_ICON = { 'Gövde': 'bolt-spark', 'Akış': 'b-akis', 'Otomasyon': 'b-oto', 'Hafıza': 'b-hafiza', 'Fırtına': 'b-firtina', 'Gezegenler': 'globe' };
  // eylem dalgalarının rengi temadan gelir
  const tc = (k) => root.Theme.rgb(k).replace(/ /g, '');

  // gezegen sistemi (js/planets.js) yoksa bugünkü tek gezegenli davranış
  const HAS_P = typeof Y.planetIds === 'function';
  const PLANET = (id) => (HAS_P && Y.PLANETS.find((p) => p.id === id)) || { id, name: 'Okyanus', producers: PRODUCERS };
  const pname = (id) => PLANET(id).name;
  const upTR = (x) => x.toLocaleUpperCase('tr');

  let S = null;
  let onChange = null;
  let lastSave = 0;
  let lastBought = null;
  const rows = [];
  let prow = [];          // bakılan yeni gezegenin üretici satırları
  let lastView = null, slideDir = 0, lastLocked = false, lockTheme = null;
  // bakılan gezegen: açık ya da sıradaki kilitli gezegen (ağaç açıldıktan sonra); değilse Okyanus
  const lockedId = () => (HAS_P && Y.nextPlanet && S.unlocked.tree ? Y.nextPlanet(S) : null);
  const navIds = () => { const l = lockedId(); return l ? openIds().concat(l) : openIds(); };
  const viewId = () => (HAS_P && S.view && S.view !== 'okyanus' && (Y.planetOpen(S, S.view) || S.view === lockedId()) ? S.view : 'okyanus');
  const isLocked = (v) => v !== 'okyanus' && !Y.planetOpen(S, v);
  // kilitli gezegenin adı koşulu sağlanana kadar gizli
  const vname = (v) => (isLocked(v) && !Y.planetUnlockReq(S, v).met ? '???' : pname(v));
  const openIds = () => (HAS_P ? Y.planetIds().filter((id) => Y.planetOpen(S, id)) : ['okyanus']);

  // ---------------------------------------------------------------------------
  // DOM'a yalnızca değişen değerleri yaz
  // ---------------------------------------------------------------------------
  const elc = {};
  const E = (id) => elc[id] || (elc[id] = $(id));
  function txt(el, v) { if (el._t !== v) { el._t = v; el.textContent = v; } }
  function html(el, v) { if (el._h !== v) { el._h = v; el.innerHTML = v; } }
  function hide(el, h) { if (el.hidden !== h) el.hidden = h; }
  function css(el, prop, v) { const k = '_' + prop; if (el[k] !== v) { el[k] = v; el.style[prop] = v; } }
  function cls(el, name, on) { const k = '_c_' + name; if (el[k] !== on) { el[k] = on; el.classList.toggle(name, on); } }
  function dis(el, d) { if (el.disabled !== d) el.disabled = d; }
  function check(label, on) { const i = label._in || (label._in = label.querySelector('input')); if (i.checked !== on) i.checked = on; }

  // ---------------------------------------------------------------------------
  // Eylem geri bildirimi
  // ---------------------------------------------------------------------------
  function floatAt(el, text, color) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const f = document.createElement('div');
    f.className = 'float ' + (color || '');
    f.textContent = text;
    f.style.left = (r.left + r.width / 2) + 'px';
    f.style.top = (r.top - 4) + 'px';
    E('floats').appendChild(f);
    setTimeout(() => f.remove(), 950);
  }
  function flashRow(el) { el.classList.remove('row-flash'); void el.offsetWidth; el.classList.add('row-flash'); }
  function bumpDrop() { const d = E('drop-tile'); d.classList.remove('bump'); void d.offsetWidth; d.classList.add('bump'); }
  function softFlash() { const f = E('flash'); f.className = 'flash soft'; void f.offsetWidth; f.classList.add('go'); }

  const actions = {
    buy(i, mode, srcEl) {
      const v = viewId();
      if (v !== 'okyanus') return planetBuy(v, i, mode, srcEl);
      const n = mode === 'fill' ? Y.buyUntil10(S, i) : Y.buyBulk(S, i, mode);
      if (n > 0) {
        flashRow(rows[i].el);
        floatAt(srcEl || rows[i].buy, `+${n} ${PRODUCERS[i].name}`);
        onChange();
      }
      return n;
    },
    maxAll() {
      const v = viewId();
      if (v !== 'okyanus') {
        if (isLocked(v)) return;
        const ps = S.planets[v].p, b0 = ps.map((p) => p.bought);
        Y.pMaxAll(S, v);
        ps.forEach((p, i) => { if (prow[i] && p.bought > b0[i]) { flashRow(prow[i].el); floatAt(prow[i].buy, `+${p.bought - b0[i]}`); } });
        onChange();
        return;
      }
      const before = S.p.map((p) => p.bought), nem0 = S.nem;
      Y.maxAll(S);
      S.p.forEach((p, i) => { if (p.bought > before[i]) { flashRow(rows[i].el); floatAt(rows[i].buy, `+${p.bought - before[i]}`); } });
      if (S.nem > nem0) { floatAt(E('nem-btn'), `+${S.nem - nem0} Nem`); root.Planet.pulse(tc('accent')); }
      onChange();
    },
    nem() {
      if (viewId() !== 'okyanus') return;
      const n = Y.buyMaxNem(S);
      if (n) { floatAt(E('nem-btn'), `+${n} Nem`); root.Planet.pulse(tc('accent')); bumpDrop(); onChange(); }
    },
    bd() { if (viewId() === 'okyanus' && Y.doBD(S)) onChange(); },
    cephe() { if (Y.doCephe(S)) onChange(); },
    // gezegenler arasında gez (← →); uçlarda başa döner
    view(step) {
      const ids = navIds();
      if (ids.length < 2) return;
      const i = ids.indexOf(viewId());
      setView(ids[(i + step + ids.length) % ids.length], step);
    },
    melt() { if (Y.D(Y.melt(S)).gt(0)) onChange(); },
    preset() { if (Y.planetReset(S, viewId())) onChange(); },
    vent() { if (Y.D(Y.vent(S)).gt(0)) onChange(); },
    shade() {
      const n0 = S.planets.col.shade;
      Y.buyShade(S);
      if (S.planets.col.shade > n0) { floatAt(E('shade-btn'), '+1 Gölge'); onChange(); }
    },
    shield() { if (Y.canShield(S) && Y.shield(S) !== false) onChange(); },
    unlock() {
      const v = viewId();
      if (isLocked(v) && Y.unlockPlanet(S, v)) { root.Planet.pulse(tc('accent')); onChange(); }
    },
  };

  function setView(id, dir) {
    if (!HAS_P || !navIds().includes(id) || id === viewId()) return;
    const ids = Y.planetIds();
    slideDir = dir || Math.sign(ids.indexOf(id) - ids.indexOf(viewId()));
    S.view = id;
    onChange();
  }

  // satın alınan adet: dönüş değerine güvenmeden 'bought' farkından
  function planetBuy(v, i, mode, srcEl) {
    const st = S.planets[v].p[i], r = prow[i];
    if (!st || !r || isLocked(v)) return 0;
    const b0 = st.bought;
    Y.pBuy(S, v, i, mode === 'fill' ? 10 - (st.bought % 10) : mode);
    const n = S.planets[v].p[i].bought - b0;
    if (n > 0) {
      flashRow(r.el);
      floatAt(srcEl || r.buy, `+${n} ${PLANET(v).producers[i].name}`);
      onChange();
    }
    return n;
  }

  // ---------------------------------------------------------------------------
  // Kurulum
  // ---------------------------------------------------------------------------
  function init(state, changed) {
    S = state;
    onChange = changed;
    buildProducers();
    bindStatic();
    buildTree();
    bindTreeView();
  }

  function buildProducers() {
    const box = E('producers');
    box.innerHTML = '';
    PRODUCERS.forEach((p, i) => rows.push(makeRow(box, p, i)));
  }
  function buildPlanetRows(id) {
    const box = E('pproducers');
    box.innerHTML = '';
    prow = PLANET(id).producers.map((p, i) => makeRow(box, p, i));
  }
  function makeRow(box, p, i) {
    const row = document.createElement('div');
    row.className = 'prow';
    row.innerHTML = `
      <div class="p-left">
        <div class="p-icon">${img(P_ICONS[i])}</div>
        <div class="p-txt"><div class="p-name"><span class="nm">${p.name}</span><label class="auto" hidden><input type="checkbox" data-auto="p${i}"> OTO</label></div><div class="p-sub"></div></div>
      </div>
      <div class="p-count"><div class="n"><b>0</b><span class="lbl">BİRİM</span></div><div class="p-set" title="10'lu set ilerlemesi"><div></div></div></div>
      <div class="p-btns">
        <button class="buy"><span>1 Al</span><small>10 D</small></button>
        <button class="fill10">10'A TAMAMLA</button>
      </div>`;
    const r = {
      el: row, icon: row.querySelector('.p-icon'), sub: row.querySelector('.p-sub'), count: row.querySelector('.p-count'),
      n: row.querySelector('.n b'), set: row.querySelector('.p-set > div'), btns: row.querySelector('.p-btns'),
      auto: row.querySelector('.auto'), buy: row.querySelector('.buy'), buyL: row.querySelector('.buy span'),
      buyC: row.querySelector('.buy small'), fill: row.querySelector('.fill10'),
    };
    r.buy.onclick = () => actions.buy(i, 1, r.buy);
    r.fill.onclick = () => actions.buy(i, 'fill', r.fill);
    box.appendChild(row);
    return r;
  }

  function bindStatic() {
    E('nem-btn').onclick = actions.nem;
    E('bd-btn').onclick = actions.bd;
    E('cephe-btn').onclick = actions.cephe;
    E('melt-btn').onclick = actions.melt;
    E('pr-btn').onclick = actions.preset;
    E('vent-btn').onclick = actions.vent;
    E('shade-btn').onclick = actions.shade;
    E('shield-btn').onclick = actions.shield;
    E('pl-prev').onclick = () => actions.view(-1);
    E('pl-next').onclick = () => actions.view(1);
    E('pl-dots').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) setView(b.dataset.id); };
    E('pl-new').onclick = () => { const r = Y.planetReady(S); if (r) setView(r, 1); };
    E('lock-btn').onclick = actions.unlock;
    E('bolt-callout').onclick = () => { if (Y.clickLightning(S)) onChange(); };
    const storm = () => {
      if (!Y.canStorm(S)) return;
      const first = S.storms === 0;
      stormSequence(Y.doStorm(S), first);
      onChange();
    };
    E('storm-btn').onclick = storm;
    E('return-btn').onclick = () => showTab('cycle');
    E('simsek-box').onclick = () => showTab('tree');
    document.addEventListener('change', (e) => {
      const k = e.target.dataset && e.target.dataset.auto;
      if (k) { S.auto[k] = e.target.checked; onChange(); }
    });
    E('tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); };
    E('modal-close').onclick = () => { E('modal').hidden = true; };
  }

  function showTab(name, why) {
    // tanı için son sekme geçişleri (Ayarlar > Tanı bilgisini kopyala)
    (root.__tabs = root.__tabs || []).push(`${name}:${why || 'tık'}`);
    if (root.__tabs.length > 12) root.__tabs.shift();
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== 'page-' + name; });
    if (name === 'tree') { cls(E('tab-btn-tree'), 'has-buy', false); buildTree(); initTreeView(); }
    if (name === 'stats') updateStats();
    window.scrollTo(0, 0);
  }

  function setBtn(btn, can) { if (btn._can === can) return; btn._can = can; btn.disabled = !can; btn.classList.toggle('can', can); }

  // ---------------------------------------------------------------------------
  // Döngü sayfası – her kare
  // ---------------------------------------------------------------------------
  function update() {
    const s = S;
    const v = viewId(), lk = isLocked(v);
    if (v !== lastView || lk !== lastLocked) switchView(v);
    const gm = Y.globalMult(s);
    if (lk) {
      txt(E('damla'), '0');
      txt(E('dps'), 'Kilitli gezegen');
    } else if (v === 'okyanus') {
      const soft = Y.softcapFactor(s).lt(1);
      txt(E('damla'), fmt(s.damla));
      const late = Y.lateFactor(s) < 1;
      txt(E('dps'), '+' + fmt(Y.damlaPerSec(s), 1) + ' Damla/sn' + (late ? ' · AŞIRI DOYGUNLUK' : soft ? ' · DOYGUNLUK' : ''));
    } else {
      txt(E('damla'), fmt(Y.pDamla(s, v)));
      const r = D(Y.pDamlaPerSec(s, v));
      txt(E('dps'), (r.lt(0) ? '' : '+') + fmt(r, 1) + ' Damla/sn');
    }
    txt(E('damla-lbl'), HAS_P && navIds().length > 1 ? 'DAMLA · ' + upTR(vname(v)) : 'DAMLA');
    const lm = Y.lightningMult(s);
    hide(E('hero-mult'), lm <= 1);
    if (lm > 1) txt(E('hero-mult'), `YILDIRIM ×${lm}`);
    hide(E('simsek-box'), !s.unlocked.tree);
    txt(E('simsek'), fmt(s.simsek));
    const wrap = E('dps-wrap');
    if (wrap.matches(':hover, :focus-within')) updateDpsTip();

    if (v === 'okyanus') { updateProducers(gm); updateResets(); } else if (lk) updateLock(v); else { updatePlanetProducers(v); updatePlanetCards(v); }
    updatePlanetInfo();
    updateGuide(v);
    updatePlanetNav();
    updateFooter();
    updateTreeLight();
    if (!E('page-tree').hidden) updateTreePage();
  }

  function updateProducers(gm) {
    const s = S;
    PRODUCERS.forEach((p, i) => {
      const r = rows[i];
      // sırayla açılır: önceki kademeden elde yoksa görünmez
      const vis = Y.tierVisible(s, i);
      hide(r.el, !vis);
      if (!vis) return;
      const st = s.p[i];
      const m = Y.producerMult(s, i, gm);
      let rate = st.amount.mul(m);
      if (i === 0) rate = rate.mul(Y.softcapFactor(s));
      txt(r.sub, `+${fmt(rate, 1)} ${p.makes}/sn • ${fmtMult(m)}`);
      txt(r.n, fmt(st.amount));
      cls(r.count, 'zero', st.amount.lte(0)); // 0 adette sayı gizli (yer korunur, hizalama bozulmaz)
      css(r.set, 'width', ((st.bought % 10) * 10) + '%');
      const cost = Y.producerCost(s, i);
      const full = st.bought >= Y.C.PROD_MAX;
      txt(r.buyC, full ? `MAKS ${Y.C.PROD_MAX}` : fmt(cost) + ' D');
      dis(r.buy, full || s.damla.lt(cost));
      const left = 10 - (st.bought % 10);
      dis(r.fill, full || s.damla.lt(cost.mul(left)));
      const owned = Y.autoOwned(s, 'p' + i);
      hide(r.auto, !owned);
      if (owned) check(r.auto, !!s.auto['p' + i]);
    });
  }

  // ---------------------------------------------------------------------------
  // Gezegenler: geçiş, üreticiler, kartlar, noktalar
  // ---------------------------------------------------------------------------
  const OKY_CARDS = ['nem-card', 'bd-card', 'cephe-card', 'resets-empty'];
  const PL_CARDS = { buz: ['buz-card'], col: ['evap-card', 'shade-card'], gaz: ['gaz-card'] };
  function switchView(v) {
    const first = lastView === null;
    lastView = v;
    const oky = v === 'okyanus', lk = isLocked(v);
    lastLocked = lk;
    hide(E('producers'), !oky);
    hide(E('pproducers'), oky || lk);
    hide(E('plock-note'), !lk);
    if (!oky && !lk) buildPlanetRows(v);
    txt(E('prod-title'), oky ? 'HİDROLOJİK DÖNGÜ ÜRETİCİLERİ' : lk ? 'KİLİTLİ GEZEGEN' : upTR(pname(v)) + ' ÜRETİCİLERİ');
    if (!oky) OKY_CARDS.forEach((id) => hide(E(id), true)); // Okyanus kartlarını updateResets yeniden açar
    hide(E('goal-card'), oky || lk);
    for (const k in PL_CARDS) PL_CARDS[k].forEach((id) => hide(E(id), k !== v || lk));
    hide(E('pl-lock'), !lk);
    hide(E('cov-box'), lk);
    lockTheme = null;
    if (HAS_P && !lk) root.Theme.setAuto(v);
    if (!first && slideDir) {
      const c = E('planet');
      c.classList.remove('slide-l', 'slide-r'); void c.offsetWidth;
      c.classList.add(slideDir > 0 ? 'slide-l' : 'slide-r');
    }
    slideDir = 0;
    planetNavSig = '';
  }

  function updatePlanetProducers(v) {
    const s = S, ps = s.planets[v].p, defs = PLANET(v).producers, dam = D(Y.pDamla(s, v));
    defs.forEach((p, i) => {
      const r = prow[i];
      if (!r) return;
      const vis = Y.pTierVisible(s, v, i);
      hide(r.el, !vis);
      if (!vis) return;
      const st = ps[i];
      txt(r.sub, `+${fmt(Y.pProducerRate(s, v, i), 1)} ${p.makes}/sn`);
      txt(r.n, fmt(st.amount));
      cls(r.count, 'zero', D(st.amount).lte(0));
      css(r.set, 'width', ((st.bought % 10) * 10) + '%');
      const cost = Y.pProducerCost(s, v, i);
      const full = st.bought >= Y.C.PROD_MAX;
      txt(r.buyC, full ? `MAKS ${Y.C.PROD_MAX}` : fmt(cost) + ' D');
      dis(r.buy, full || dam.lt(cost));
      const fill = Y.pBulkInfo(s, v, i, 10 - (st.bought % 10));
      dis(r.fill, full || !fill.can);
    });
  }

  // kilitli gezegen: koşul (önceki gezegen tamamlanmalı), ilerleme, Şimşek bedeli, Aç
  function updateLock(v) {
    const s = S, r = Y.planetUnlockReq(s, v);
    if (!r) return;
    // tema: koşul sağlanınca gezegenin kendi rengi, öncesinde önceki gezegeninki (gizem korunur)
    const th = r.met ? v : r.prev;
    if (lockTheme !== th) { lockTheme = th; root.Theme.setAuto(th); }
    txt(E('lock-req'), upTR(r.met ? pname(r.prev) + ' tamamlandı' : r.text));
    txt(E('lock-val'), r.met ? (r.cost ? fmt(r.cost) + ' Şimşek' : 'açılmaya hazır') : r.value);
    css(E('lock-fill'), 'width', (r.progress * 100).toFixed(1) + '%');
    txt(E('lock-desc'), r.met ? 'Yeni bir gezegen keşfedildi. Açıldığında kendi üreticileri ve kendine özgü mekaniğiyle çalışır.'
      : `${pname(r.prev)} tamamlanınca bu gezegen keşfedilir.` + (r.cost ? ` Açmak ${fmt(r.cost)} Şimşek ister.` : ''));
    const can = Y.canUnlockPlanet(s, v);
    setBtn(E('lock-btn'), can);
    txt(E('lock-btn-txt'), !r.met ? 'KOŞUL SAĞLANMADI' : can ? (r.cost ? `AÇ · ${fmt(r.cost)} ŞİMŞEK` : 'GEZEGENİ AÇ') : `${fmt(r.cost)} ŞİMŞEK GEREKİYOR`);
  }

  // yönlendirme: önceki gezegen tamamlanınca bir kez sade bildirim; sonra "Yeni gezegen →" ve › okunda sakin nabız.
  // Gezegene bakılınca ya da açılınca kaybolur.
  function updateGuide(v) {
    if (!HAS_P || !Y.planetReady) return;
    const s = S, r = Y.planetReady(s), seen = s.planetSeen || (s.planetSeen = {});
    if (r && !seen[r]) {
      seen[r] = 1;
      toast(`${pname(Y.planetUnlockReq(s, r).prev)} tamamlandı · yeni bir gezegen keşfedildi`, 'Gezegen panelindeki › okuyla ona geçebilirsin.');
    }
    if (r && v === r) seen[r] = 2;
    const on = !!r && seen[r] === 1;
    hide(E('pl-new'), !on);
    cls(E('pl-next'), 'nudge', on);
  }

  let evapMax = 0;
  function updatePlanetCards(v) {
    const s = S, m = Y.pMeasure(s, v);
    txt(E('goal-t'), pname(v));
    txt(E('goal-label'), m.label);
    txt(E('goal-val'), m.value);
    css(E('goal-fill'), 'width', (Math.max(0, Math.min(1, m.progress)) * 100).toFixed(1) + '%');
    hide(E('goal-done'), !m.done);
    // gezegenin kendi sıfırlaması (Buz: Büyük Erime) ve kendi otomatiği
    const rn = Y.RESET_NAME[v], rc = Y.canPlanetReset(s, v);
    setBtn(E('pr-btn'), rc);
    txt(E('pr-btn-txt'), rc ? `${upTR(rn)}: +${fmt(Y.planetResetGain(s, v))} ŞİMŞEK` : `${upTR(rn)} · %${Math.floor(Y.pCoverage(s, v) * 100)}`);
    txt(E('pr-count'), String(s.planetResets[v] || 0));
    hide(E('pr-auto'), !Y.autoOwned(s, v));
    E('pr-auto').querySelector('input').dataset.auto = v;
    check(E('pr-auto'), !!s.auto[v]);
    if (v === 'buz') {
      const B = s.planets.buz, mp = Y.meltPreview(s), can = D(mp.gain).gt(0);
      txt(E('melt-count'), String(B.melts || 0));
      txt(E('ice-amt'), fmt(B.ice) + ' Buz');
      txt(E('melt-mult'), fmtMult(mp.mult));
      dis(E('melt-btn'), !can);
      txt(E('melt-btn-txt'), can ? `ERİT: +${fmt(mp.gain)} DAMLA` : 'Buz birikiyor');
    } else if (v === 'col') {
      const C = s.planets.col, er = Y.evapRate(s);
      evapMax = Math.max(evapMax, er);
      const ep = er * 100, ept = fmt(ep, ep < 1 ? 2 : 1);
      txt(E('evap-pct'), '%' + ept + '/sn');
      css(E('evap-fill'), 'width', (evapMax > 0 ? er / evapMax * 100 : 0).toFixed(1) + '%');
      html(E('evap-desc'), C.shield > 0
        ? `Bulut Kalkanı açık: <b>${Math.ceil(C.shield)} sn</b> boyunca kayıp yok.`
        : `Damla her saniye <b>%${ept}</b> buharlaşıyor. Kalkan kaybı kısa süre durdurur.`);
      dis(E('shield-btn'), !Y.canShield(s));
      txt(E('shield-btn-txt'), C.shield > 0 ? `KALKAN AÇIK · ${Math.ceil(C.shield)} SN` : C.shieldCd > 0 ? `BEKLEME · ${Math.ceil(C.shieldCd)} SN` : 'BULUT KALKANI');
      const cost = Y.shadeCost(s), ok = cost != null && isFinite(D(cost).toNumber());
      txt(E('shade-count'), String(C.shade || 0));
      dis(E('shade-btn'), !ok || D(Y.pDamla(s, 'col')).lt(cost));
      txt(E('shade-btn-txt'), ok ? `GÖLGE AL · ${fmt(cost)} D` : 'GÖLGE DOLU');
    } else if (v === 'gaz') {
      const G = s.planets.gaz, p = Y.pressure(s), vp = Y.ventPreview(s), can = D(vp.gain).gt(0);
      txt(E('vent-count'), String(G.vents || 0));
      txt(E('gas-mult'), 'ŞİMŞEK ' + fmtMult(Y.gasStormMult(s)));
      txt(E('press-val'), p.toFixed(2).replace('.', ','));
      cls(E('press-val'), 'danger', p > 1);
      // çubuk 0 → 1,25; 1'in üstü kırmızı bölge
      css(E('press-fill'), 'width', (Math.min(p, 1.25) / 1.25 * 100).toFixed(1) + '%');
      cls(E('press-fill'), 'over', p > 1);
      html(E('gas-desc'), p > 1
        ? `<b>Basınç 1'i geçti!</b> Kendiliğinden boşalırsa ödülün yarısı kaybolur.`
        : `Basınç sürekli yükselir. Beklersen patlama büyür; 1'i geçerse kendiliğinden boşalır ve ödülün yarısı kaybolur.`);
      dis(E('vent-btn'), !can);
      txt(E('vent-btn-txt'), can ? `BOŞALT: +${fmt(vp.gain)} DAMLA` : 'Basınç birikiyor');
    }
  }

  // gezegen adı + her açık gezegen için kaplama halkalı nokta; sıradaki kilitli gezegen "???"
  let planetNavSig = '';
  function updatePlanetNav() {
    if (!HAS_P) return;
    const s = S, v = viewId(), nav = navIds(), nv = lockedId();
    hide(E('pl-nav'), false);
    hide(E('pl-prev'), nav.length < 2);
    hide(E('pl-next'), nav.length < 2);
    let locked = null;
    const parts = [];
    for (const id of Y.planetIds()) {
      if (Y.planetOpen(s, id)) parts.push([id, Math.round(Y.pCoverage(s, id) * 100), !!Y.planetDone(s, id)]);
      else if (!locked) { locked = id; parts.push([id, -1, Y.planetUnlockHint(s, id) || '']); }
    }
    const sig = v + (nv || '') + JSON.stringify(parts);
    if (sig === planetNavSig) return;
    planetNavSig = sig;
    const C = 2 * Math.PI * 8;
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    html(E('pl-dots'), parts.map(([id, cov, x]) => {
      if (cov < 0 && id === nv) {
        return `<button class="pl-dot locked${id === v ? ' on' : ''}" data-id="${id}" title="${esc(vname(id) + ' · ' + x)}" aria-label="Kilitli gezegen: ${esc(x)}"><i>?</i></button>`;
      }
      if (cov < 0) return `<span class="pl-dot locked" title="${esc(x)}" aria-label="Kilitli gezegen: ${esc(x)}"><i>?</i></span>`;
      const th = root.Theme.THEMES[id], pc = th ? th.css.accent : 'var(--accent)';
      const name = pname(id) + ' · %' + cov + (x ? ' · tamamlandı' : '');
      return `<button class="pl-dot${id === v ? ' on' : ''}${x ? ' done' : ''}" data-id="${id}" style="--pc:${pc}" title="${name}" aria-label="${name}">` +
        `<svg viewBox="0 0 20 20"><circle class="trk" cx="10" cy="10" r="8"/><circle class="arc" cx="10" cy="10" r="8" stroke-dasharray="${(C * cov / 100).toFixed(2)} ${C.toFixed(2)}"/></svg><i></i></button>`;
    }).join(''));
    html(E('pl-name'), vname(v) + (isLocked(v) ? ' <span class="chip mono">KİLİTLİ</span>'
      : Y.planetDone(s, v) ? ' <span class="chip mono accent soft">TAMAMLANDI</span>' : ''));
  }

  function dormant(card, on) { cls(card, 'dormant', on); }

  function updateResets() {
    const s = S;
    // Nem
    hide(E('nem-card'), !s.unlocked.nem);
    hide(E('resets-empty'), !!s.unlocked.nem);
    if (s.unlocked.nem) {
      const info = Y.nemMaxInfo(s);
      txt(E('nem-count'), `${s.nem}/${Y.C.NEM_MAX}`);
      html(E('nem-desc'), `Her alım tüm üretim <b>+${pct(Y.nemGain(s) * 100)}</b> · toplam <b>${fmtMult(Y.nemMult(s))}</b>`);
      txt(E('nem-badge'), info.n > 0 ? 'HAZIR' : pct(Math.min(99.9, s.damla.div(info.cost).toNumber() * 100)));
      dis(E('nem-btn'), info.n === 0);
      txt(E('nem-btn-txt'), s.nem >= Y.C.NEM_MAX ? 'NEM DOLU' : info.n > 0 ? `NEMLENDİR: +${info.n} NEM` : `${fmt(info.cost)} Damla gerekiyor`);
      hide(E('auto-nem'), !Y.autoOwned(s, 'nem'));
      check(E('auto-nem'), !!s.auto.nem);
    }

    // Basınç Düşüşü (açılmadıysa bir sonraki katman olarak sönük görünür)
    const bdOn = !!s.unlocked.bd;
    hide(E('bd-card'), !s.unlocked.nem);
    dormant(E('bd-card'), !bdOn);
    if (!bdOn) {
      html(E('bd-desc'), `<b>Yağmur</b> aşamasında (1,00e10 damla) açılır.`);
      hide(E('bd-btn').parentNode.querySelector('.thr'), true); hide(E('bd-btn'), true); hide(E('bd-pct'), true);
    } else {
      const r = Y.bdReq(s), have = Math.floor(Math.min(r.amount, s.p[r.tier].amount.toNumber()));
      const name = PRODUCERS[r.tier].name, can = Y.canBD(s);
      hide(E('bd-btn').parentNode.querySelector('.thr'), false); hide(E('bd-btn'), false); hide(E('bd-pct'), false);
      txt(E('bd-count'), `${s.bd}/${Y.C.BD_MAX}`);
      html(E('bd-desc'), (s.bd < 4 ? `<em>${PRODUCERS[s.bd + 4].name}</em> açar · ` : '') + 'tüm üretim <b>×2</b> · damla, üretici ve Nem sıfırlanır');
      txt(E('bd-prog'), `${have} / ${r.amount} ${name}`);
      css(E('bd-fill'), 'width', (have / r.amount * 100) + '%');
      txt(E('bd-pct'), '%' + Math.floor(have / r.amount * 100));
      cls(E('bd-btn'), 'ready', can);
      txt(E('bd-btn-txt'), s.bd >= Y.C.BD_MAX ? 'EN YÜKSEK BASINÇ DÜŞÜŞÜ' : can ? 'BASINÇ DÜŞÜR' : `${r.amount - have} ${name} daha gerekiyor`);
      hide(E('auto-bd'), !Y.autoOwned(s, 'bd'));
      check(E('auto-bd'), !!s.auto.bd);
    }

    // Hava Cephesi
    const cOn = !!s.unlocked.cephe;
    hide(E('cephe-card'), !bdOn);
    dormant(E('cephe-card'), !cOn);
    hide(E('cephe-lock'), cOn); hide(E('cephe-thr'), !cOn); hide(E('cephe-btn'), !cOn);
    if (!cOn) {
      html(E('cephe-desc'), `<b>Fırtına</b> aşamasında (1,00e50 damla) açılır.`);
    } else {
      const r = Y.cepheReq(s), have = Math.floor(Math.min(r.amount, s.p[7].amount.toNumber())), can = Y.canCephe(s);
      const next = Y.C.NEM_GAIN * (1 + Y.C.CEPHE_NEM_BONUS * (s.cephe + 1)) * (Y.has(s, 'islakHava') ? Y.C.ISLAK_HAVA : 1);
      txt(E('cephe-count'), String(s.cephe));
      html(E('cephe-desc'), `Nem etkisi <b>${pct(Y.nemGain(s) * 100)} → ${pct(next * 100)}</b> · Basınç Düşüşleri de sıfırlanır`);
      txt(E('cephe-prog'), `${have} / ${r.amount} Kasırga`);
      css(E('cephe-fill'), 'width', (have / r.amount * 100) + '%');
      cls(E('cephe-btn'), 'ready', can);
      txt(E('cephe-btn-txt'), can ? 'CEPHEYİ GETİR' : `${r.amount - have} Kasırga daha gerekiyor`);
    }
    hide(E('auto-cephe'), !Y.autoOwned(s, 'cephe'));
    check(E('auto-cephe'), !!s.auto.cephe);
  }

  // Damla/sn üzerine gelince: üretimin hangi çarpandan ne kadar geldiği
  function updateDpsTip() {
    const s = S, rows2 = [];
    const add = (k, v, on) => { if (on !== false) rows2.push(`<div class="tip-row"><span>${k}</span><b class="mono">${v}</b></div>`); };
    const pv = viewId();
    if (isLocked(pv)) { html(E('dps-tip'), '<div class="lbl">KİLİTLİ GEZEGEN</div>'); return; }
    if (pv !== 'okyanus') {
      PLANET(pv).producers.forEach((p, i) => { if (Y.pTierVisible(s, pv, i)) add(p.name, '+' + fmt(Y.pProducerRate(s, pv, i), 1) + ' ' + p.makes + '/sn'); });
      if (pv === 'col') add('Buharlaşma', '%' + fmt(Y.evapRate(s) * 100, 2) + '/sn');
      if (pv === 'gaz') add('Yıldırım', 'sürekli');
      html(E('dps-tip'), `<div class="lbl">${upTR(pname(pv))} · ÜRETİM</div>${rows2.join('')}` +
        `<div class="tip-row total"><span>Net</span><b class="mono accent">${fmt(Y.pDamlaPerSec(s, pv), 1)}/sn</b></div>`);
      return;
    }
    add('Buhar', fmt(s.p[0].amount) + ' adet');
    add("10'lu set bonusu", fmtMult(Y.setMult(s, 0)));
    add('Basınç Düşüşü', fmtMult(D(Y.C.BD_MULT).pow(s.bd)), s.bd > 0);
    add('Nem', fmtMult(Y.nemMult(s)), s.nem > 0);
    add('Kıvılcım', '×2', Y.has(s, 'kivilcim'));
    add('Yoğuşma', '×2', Y.has(s, 'yogusma'));
    add('Buhar Akışı', '×2', Y.has(s, 'buharAkisi'));
    add('Rekor Çarpanı', fmtMult(Y.rekorMult(s)), Y.has(s, 'rekor'));
    add('Hızlı Fırtına', fmtMult(Y.hizliMult(s)), Y.has(s, 'hizliFirtina'));
    add('Yıldırım', fmtMult(Y.lightningMult(s)), s.lightning.active > 0);
    const sc = Y.softcapFactor(s);
    add('Doygunluk', '÷' + fmt(D(1).div(sc), 2), sc.lt(1));
    const lf = Y.lateFactor(s);
    add('Aşırı doygunluk (Nem ve set üssü)', '×' + lf.toFixed(3), lf < 1);
    html(E('dps-tip'), `<div class="lbl">ÜRETİM DÖKÜMÜ</div>${rows2.join('')}` +
      `<div class="tip-row total"><span>Toplam</span><b class="mono accent">+${fmt(Y.damlaPerSec(s), 1)}/sn</b></div>`);
  }

  const treeOpen = () => !!S.unlocked.tree || S.storms > 0;

  function treeProdMult() {
    return (Y.has(S, 'kivilcim') ? 2 : 1) * (Y.has(S, 'yogusma') ? 2 : 1) * Y.rekorMult(S) * Y.hizliMult(S);
  }

  function updatePlanetInfo() {
    const s = S;
    const pv = viewId();
    const cov = pv === 'okyanus' ? Y.coverage(s) : Y.pCoverage(s, pv);
    const covTxt = fmt(Math.floor(cov * 1000) / 10, 1);
    txt(E('cov-pct'), `%${covTxt} / %100.0`);
    const w = Math.max(0.5, cov * 100);
    const fill = E('cov-fill');
    css(fill, 'width', w.toFixed(2) + '%');
    const bw = (10000 / w).toFixed(1) + '% 100%';
    if (fill._bw !== bw) { fill._bw = bw; fill.style.backgroundSize = bw; }

    // yıldırım: gezegenin üstünde rastgele bir noktada tıklanabilir çağrı
    const L = s.lightning, g = root.Planet.geometry();
    const vis = L.visible > 0;
    hide(E('bolt-callout'), !vis);
    if (vis && g.R) {
      // çağrı gezegen görünümünün dışına taşmasın
      const co = E('bolt-callout'), view = E('planet-wrap');
      const hw = co.offsetWidth / 2 + 8, hh = co.offsetHeight / 2 + 8;
      const x = Math.max(hw, Math.min(view.clientWidth - hw, g.cx + (L.x - 0.5) / 0.36 * g.R));
      const y = Math.max(hh, Math.min(view.clientHeight - hh, g.cy + (L.y - 0.5) / 0.36 * g.R));
      css(co, 'left', x.toFixed(0) + 'px');
      css(co, 'top', y.toFixed(0) + 'px');
      txt(E('bolt-left'), `${Math.ceil(L.visible)} SN İÇİNDE YAKALA`);
    }
    hide(E('buff-chip'), !(L.active > 0));
    if (L.active > 0) {
      txt(E('buff-txt'), `YILDIRIM: ${fmtMult(Y.lightningMult(s))} ÜRETİM`);
      txt(E('buff-time'), pad2(Math.ceil(L.active)) + 's');
    }

    // fırtına butonu ve kazancı yalnızca Okyanus görünümünde (fırtına mantığı ortak)
    const oky = viewId() === 'okyanus';
    hide(E('auto-storm'), !Y.autoOwned(s, 'storm') || !oky);
    check(E('auto-storm'), !!s.auto.storm);

    // fırtına: ilk seferde gizemli ???, sonrasında canlı önizleme
    const ready = Y.canStorm(s) && oky, sb = E('storm-btn');
    hide(sb, !ready);
    if (ready) {
      txt(sb, s.storms === 0 ? '???' : `Fırtına kopar: +${fmt(Y.stormGain(s))} Şimşek`);
      cls(sb, 'preview', s.storms > 0);
      // ilk fırtınanın gizemi korunur
      if (HAS_P && s.storms > 0) {
        const t = "Fırtına yalnızca Okyanus'u sıfırlar.\nDiğer gezegenler kendi sıfırlamalarıyla Şimşek verir.";
        if (sb._ti !== t) { sb._ti = t; sb.title = t; }
      }
    }
  }

  function planetView(t) {
    const v = viewId(), lk = HAS_P && isLocked(v);
    // gezegen her zaman kendi renginde; kilitli siluet keşfedilene dek önceki gezegenin göğünde
    if (HAS_P) root.Planet.setTheme(root.Theme.THEMES[lk && lockTheme ? lockTheme : v].planet);
    if (lk) return { t, cov: 0, stage: 0, boost: false, stormReady: false, locked: true };
    if (v === 'okyanus') return { t, cov: Y.coverage(S), stage: Y.stageIndex(S), boost: S.lightning.active > 0, stormReady: Y.canStorm(S) };
    return { t, cov: Y.pCoverage(S, v), stage: 0, boost: S.lightning.active > 0, stormReady: false, gasStorm: v === 'gaz' };
  }

  function updateFooter() {
    txt(E('f-build'), `KATMAN 1 DEMO · YAPI ${Y.BUILD}`);
    if (!E('page-settings').hidden) {
      txt(E('save-info'), `Kayıt durumu: ${S.storms} fırtına · ${fmt(S.simsekTotal)} toplam Şimşek · ağaç ${S.unlocked.tree ? 'açık' : 'kilitli'} · ${Object.keys(S.tree).length} düğüm`);
    }
    txt(E('f-nem'), String(S.nem));
    txt(E('f-bd'), String(S.bd));
    txt(E('f-storms'), String(S.storms));
    txt(E('f-save'), lastSave ? `${Math.floor((Date.now() - lastSave) / 1000)}s ÖNCE` : '—');
  }

  // ---------------------------------------------------------------------------
  // Şimşek ağacı: dallanan büyük bir yıldırım. Kaydırılır (sürükle / tekerlek), yakınlaşır (Ctrl+tekerlek).
  // Çizgiler bir kez üretilir (konumlar sabit); yalnızca düğüm durumları değişince yeniden çizilir.
  // ---------------------------------------------------------------------------
  function nodeState(n) {
    if (n.soon) return 'soon';
    if (Y.nodeVisible(S, n.id)) {
      const lv = Y.lvl(S, n.id), max = n.levels || 1;
      return lv >= max ? 'owned' : Y.canBuyNode(S, n.id) ? 'can' : lv > 0 ? 'partial' : 'open';
    }
    return Y.nodePreview(S, n.id) ? 'ghost' : 'unknown';
  }

  // tohumlu rastgele: her açılışta aynı yıldırım şekli
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  }
  // orta nokta kaydırma: düz çizgiyi kırık bir şimşek kanalına çevirir
  function jag(pts, rnd, rough, depth) {
    let out = pts;
    for (let d = 0; d < depth; d++) {
      const nx = [out[0]];
      for (let i = 1; i < out.length; i++) {
        const a = out[i - 1], b = out[i], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        const off = (rnd() * 2 - 1) * len * rough;
        nx.push([(a[0] + b[0]) / 2 - (dy / len) * off, (a[1] + b[1]) / 2 + (dx / len) * off], b);
      }
      out = nx;
    }
    return out;
  }
  const pathD = (pts) => 'M' + pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('L');

  let EDGES = null;
  // gezegen dalı düğümü (okyanus dışı) ve gezegeni henüz açılmamış mı
  const plNode = (n) => !!n.planet && n.planet !== 'okyanus';
  const plHidden = (n) => plNode(n) && !Y.planetOpen(S, n.planet);
  function buildEdges() {
    EDGES = [];
    const twigsFor = (pts, rnd, count, maxLen) => {
      let d = '';
      for (let k = 0; k < count; k++) {
        const i = 1 + Math.floor(rnd() * (pts.length - 2)), a = pts[i], b = pts[i + 1] || pts[i - 1];
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + (rnd() < 0.5 ? -1 : 1) * (0.45 + rnd() * 0.75);
        const L = maxLen * (0.35 + rnd() * 0.65);
        const end = [a[0] + Math.cos(ang) * L, a[1] + Math.sin(ang) * L];
        const tw = jag([a, end], rnd, 0.28, 4);
        d += pathD(tw);
        if (rnd() < 0.55) {
          const j = 2 + Math.floor(rnd() * (tw.length - 4)), c = tw[j], ang2 = ang + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6);
          d += pathD(jag([c, [c[0] + Math.cos(ang2) * L * 0.45, c[1] + Math.sin(ang2) * L * 0.45]], rnd, 0.3, 3));
        }
      }
      return d;
    };
    // önce her kenarın kırık noktaları (gezegen dalları gövdenin kendi kanalından ayrılabilsin)
    const PTS = {}, RNDS = {};
    TREE.forEach((n) => {
      if (!n.parent) return;
      const p = TREE_BY_ID[n.parent];
      RNDS[n.id] = seeded(n.id);
      PTS[n.id] = jag([[p.x, p.y], ...(n.via || []), [n.x, n.y]], RNDS[n.id], 0.2, 5);
    });
    TREE.forEach((n) => {
      if (!n.parent) return;
      const p = TREE_BY_ID[n.parent], rnd = RNDS[n.id];
      let pts = PTS[n.id], pre = null, fork = null;
      // gezegen dalı kökü: gövdenin devamındaki kanalda via[0] yüksekliğine en yakın noktadan ayrılır
      const tEnd = plNode(n) && p.branch === 'Gövde' && n.via && TREE.find((m) => m.parent === p.id && m.planet === 'okyanus');
      if (tEnd) {
        const T = PTS[tEnd.id], fy = n.via[0][1];
        let k = 0;
        T.forEach((q, i) => { if (Math.abs(q[1] - fy) < Math.abs(T[k][1] - fy)) k = i; });
        fork = T[k];
        pre = pathD(T.slice(0, k + 1));
        pts = jag([fork, ...n.via.slice(1), [n.x, n.y]], rnd, 0.2, 5);
      }
      const trunk = n.branch === 'Gövde', tail = n.planet === 'okyanus' && p.branch === 'Gövde';
      EDGES.push({
        id: n.id, d: pathD(pts), pre, fork, pl: plNode(n),
        w: trunk ? 5.5 : tail ? 4.5 : p.id === 'kivilcim' ? 3.6 : fork ? 3.2 : n.soon ? 2 : 2.6,
        twigs: twigsFor(pts, rnd, trunk || tail ? 6 : 3, trunk || tail ? 150 : 90),
      });
    });
    // gökten Kıvılcım'a inen kanal ve dağınık üst dallar (süs)
    const r0 = TREE_BY_ID.kivilcim, rnd = seeded('gok');
    const sky = jag([[r0.x - 30, -40], [r0.x, r0.y]], rnd, 0.22, 5);
    EDGES.sky = { d: pathD(sky), twigs: twigsFor(sky, rnd, 5, 160) };
  }

  const planetAccent = (n) => { const th = root.Theme.THEMES[n.planet]; return th ? th.css.accent : '#ffffff'; };
  const planetName = (id) => { const p = (Y.PLANETS || []).find((q) => q.id === id); return p ? p.name : id; };

  // gezegen bölgeleri: açık her gezegenin dalının arkasında çok soluk, yumuşak renk alanı (parlama yok)
  function planetWash() {
    let defs = '', out = '';
    for (const id of [...new Set(TREE.filter(plNode).map((n) => n.planet))]) {
      if (!Y.planetOpen(S, id)) continue;
      const ns = TREE.filter((n) => n.planet === id), c = planetAccent(ns[0]);
      const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      defs += `<radialGradient id="tb-w-${id}"><stop offset="0" stop-color="${c}" stop-opacity=".09"/><stop offset=".6" stop-color="${c}" stop-opacity=".04"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`;
      out += `<ellipse cx="${(x0 + x1) / 2}" cy="${(y0 + y1) / 2 + 10}" rx="${(x1 - x0) / 2 + 180}" ry="${(y1 - y0) / 2 + 140}" fill="url(#tb-w-${id})"/>`;
    }
    return { defs, out };
  }

  function boltSVG() {
    if (!EDGES) buildEdges();
    let dim = '', soon = '', tw0 = '', tw1 = '', can = '', glow = '', core = '', hot = '', strike = '', pl = '', marks = '';
    const skyOn = Y.has(S, 'kivilcim');
    for (const e of EDGES) {
      const n = TREE_BY_ID[e.id], st = nodeState(n), on = Y.has(S, e.id);
      if (n.soon) { soon += `<path d="${e.d}" stroke="${planetAccent(n)}" stroke-width="${e.w}"/>`; continue; }
      if (e.pl) {
        if (plHidden(n)) continue; // gezegen açılana kadar dalı hiç görünmez
        // gezegen dalı kendi renginde, sade: soluk / akan kesik çizgi / dolu
        const c = planetAccent(n);
        pl += `<path class="${on ? 'po' : st === 'can' ? 'pc' : 'pd'}" d="${e.d}" stroke="${c}" stroke-width="${e.w}"/>`;
        if (on && e.pre) { // gövde, dalın ayrıldığı noktaya kadar yanar
          glow += `<path d="${e.pre}" stroke-width="17.6"/>`; core += `<path d="${e.pre}" stroke-width="5.5"/>`; hot += `<path d="${e.pre}" stroke-width="1.9"/>`;
        }
        if (on && lastBought === e.id) strike = `<path class="strike" d="${e.d}" stroke-width="${e.w * 2}"/>`;
        if (e.fork) {
          const left = n.x < e.fork[0], f = e.fork;
          marks += `<circle cx="${f[0].toFixed(0)}" cy="${f[1].toFixed(0)}" r="5" fill="${c}"/>`
            + `<text x="${(f[0] + (left ? -14 : 14)).toFixed(0)}" y="${(f[1] - 10).toFixed(0)}" text-anchor="${left ? 'end' : 'start'}" fill="${c}">${planetName(n.planet).toLocaleUpperCase('tr')}</text>`;
        }
        continue;
      }
      const p = `<path d="${e.d}" stroke-width="${e.w}"/>`;
      if (on) {
        glow += `<path d="${e.d}" stroke-width="${e.w * 3.2}"/>`;
        core += p;
        hot += `<path d="${e.d}" stroke-width="${Math.max(1, e.w * 0.35)}"/>`;
        tw1 += e.twigs;
        if (lastBought === e.id) strike = `<path class="strike" d="${e.d}" stroke-width="${e.w * 2}"/>`;
      } else {
        if (st === 'can') can += p; else dim += p;
        tw0 += e.twigs;
      }
    }
    const sky = EDGES.sky;
    if (skyOn) { glow += `<path d="${sky.d}" stroke-width="16"/>`; core += `<path d="${sky.d}" stroke-width="5"/>`; hot += `<path d="${sky.d}" stroke-width="2"/>`; tw1 += sky.twigs; }
    else { can += `<path d="${sky.d}" stroke-width="4"/>`; tw0 += sky.twigs; }
    const wash = planetWash();
    return `${STARS_SVG()}<defs><filter id="tb-blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="6"/></filter>
      <radialGradient id="tb-sky" gradientUnits="userSpaceOnUse" cx="${TREE_BY_ID.kivilcim.x}" cy="0" r="560"><stop offset="0" stop-color="rgb(var(--yellow-rgb))" stop-opacity=".2"/><stop offset="1" stop-color="rgb(var(--yellow-rgb))" stop-opacity="0"/></radialGradient>${wash.defs}</defs>
      <rect x="${TREE_BY_ID.kivilcim.x - 560}" y="-560" width="1120" height="1120" fill="url(#tb-sky)"/><g class="b-wash">${wash.out}</g>
      <g class="b-dim">${dim}</g><g class="b-soon">${soon}</g><g class="b-tw0">${tw0}</g><g class="b-can">${can}</g><g class="b-pl">${pl}</g>
      <g class="b-glow" filter="url(#tb-blur)">${glow}</g><g class="b-tw1">${tw1}</g><g class="b-core">${core}</g><g class="b-hot">${hot}</g><g class="b-pm">${marks}</g>${strike}`;
  }

  // boş alan karanlık kalmasın: seyrek, sabit yıldızlar
  let starsSvg = '';
  function STARS_SVG() {
    if (starsSvg) return starsSvg;
    const rnd = seeded('yildiz'), count = Math.round(260 * (TREE_W + TREE_PAD * 2) * (TREE_H + TREE_PAD * 2) / (2640 * 2500)); // yoğunluk ağaç boyundan bağımsız
    for (let i = 0; i < count; i++) {
      const x = -TREE_PAD + rnd() * (TREE_W + TREE_PAD * 2), y = -TREE_PAD + rnd() * (TREE_H + TREE_PAD * 2);
      starsSvg += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(0.5 + rnd() * 1.3).toFixed(1)}" opacity="${(0.12 + rnd() * 0.4).toFixed(2)}"/>`;
    }
    starsSvg = `<g class="b-stars">${starsSvg}</g>`;
    return starsSvg;
  }

  let selected = null;
  function nodeHTML(n, st) {
    const pos = `left:${n.x}px;top:${n.y}px${plNode(n) ? `;--pc:${planetAccent(n)}` : ''}`; // gezegen düğümü kendi renginde
    const cl = `tnode ${st}${plNode(n) ? ' pl' : ''}${n.id === 'kivilcim' ? ' root' : ''}${selected === n.id ? ' sel' : ''}${lastBought === n.id ? ' bought-now' : ''}`;
    if (st === 'unknown') return `<button class="${cl}" style="${pos}" data-id="${n.id}" aria-label="Keşfedilmemiş düğüm"><span class="tn-orb">?</span></button>`;
    const max = n.levels || 1, lv = Y.lvl(S, n.id);
    const sub = st === 'soon' ? 'YAKINDA'
      : st === 'owned' ? (max > 1 ? `${lv}/${max}` : 'AKTİF')
        : `⚡ ${n.cost}${max > 1 ? ` · ${lv}/${max}` : ''}`;
    const extra = st === 'soon' ? `;--pc:${planetAccent(n)}` : '';
    return `<button class="${cl}" style="${pos}${extra}" data-id="${n.id}">
      <span class="tn-orb">${img(n.id === 'kivilcim' ? 'n-kivilcim' : BRANCH_ICON[n.branch])}</span>
      <span class="tn-name">${n.name}</span><span class="tn-sub mono">${sub}</span></button>`;
  }

  function renderDetail() {
    const n = TREE_BY_ID[selected];
    if (!n || plHidden(n)) { html(E('tree-detail'), ''); cls(E('tree-detail'), 'off', true); return; }
    const st = nodeState(n), max = n.levels || 1, lv = Y.lvl(S, n.id);
    let head, body, btn = '';
    if (st === 'unknown') {
      head = `<span class="lbl">KEŞFEDİLMEDİ</span><b>???</b>`;
      body = 'Bu dal henüz karanlıkta. Üstündeki düğümleri aldıkça görünür.';
    } else if (st === 'soon') {
      head = `<span class="lbl" style="color:${planetAccent(n)}">GEZEGENLER · YAKINDA</span><b>${n.name}</b>`;
      body = `${n.desc}<br><span class="muted">Gezegen sistemiyle gelecek.</span>`;
    } else {
      const lbl = plNode(n) ? `<span class="lbl" style="color:${planetAccent(n)}">GEZEGEN · ${planetName(n.planet).toLocaleUpperCase('tr')}</span>`
        : `<span class="lbl">${n.branch.toLocaleUpperCase('tr')}</span>`;
      head = `${lbl}<b>${n.name}${max > 1 ? ` <span class="lv">${lv}/${max}</span>` : ''}</b>`;
      body = n.desc;
      if (st === 'owned') btn = `<button class="td-btn owned" disabled>✓ AKTİF</button>`;
      else if (st === 'ghost') btn = `<button class="td-btn" disabled>Önce ${TREE_BY_ID[n.parent].name} alınmalı</button>`;
      else if (st === 'can') btn = `<button class="td-btn can" data-buy="${n.id}">${img('bolt-btn-dark')} ${n.cost} Şimşek ile al</button>`;
      // gezegen koşulu (ör. "Üç gezegen tamamlanmalı") Şimşek eksiğinden önce söylenir
      else if (Y.nodeReqText && Y.nodeReqText(S, n.id)) btn = `<button class="td-btn" disabled>${Y.nodeReqText(S, n.id)}</button>`;
      else btn = `<button class="td-btn" disabled>⚡ ${n.cost} gerekli · ${fmt(n.cost - S.simsek)} eksik</button>`;
    }
    html(E('tree-detail'), `<button class="td-x" data-close aria-label="Kapat">×</button><div class="td-h">${head}</div><p>${body}</p>${btn}`);
    placeDetail();
  }

  // kutu düğümün sağında açılır; sağda yer yoksa solunda. Ağaç kaydıkça düğümü izler.
  function placeDetail() {
    const box = E('tree-detail'), n = TREE_BY_ID[selected];
    if (!n || !zoom) { cls(box, 'off', true); return; }
    const v = E('tree-view');
    const x = (n.x + TREE_PAD) * zoom - v.scrollLeft, y = (n.y + TREE_PAD) * zoom - v.scrollTop;
    const off = (n.id === 'kivilcim' ? 46 : 34) * zoom + 12, w = box.offsetWidth || 260, h = box.offsetHeight || 140;
    const out = x < -20 || y < -20 || x > v.clientWidth + 20 || y > v.clientHeight + 20;
    cls(box, 'off', out);
    if (out) return;
    const flip = x + off + w > v.clientWidth - 8;
    const left = flip ? x - off - w : x + off;
    const top = Math.max(8, Math.min(v.clientHeight - h - 8, y - 30));
    cls(box, 'flip', flip);
    css(box, 'left', Math.max(8, left).toFixed(0) + 'px');
    css(box, 'top', top.toFixed(0) + 'px');
    box.style.setProperty('--ay', Math.max(10, Math.min(h - 20, y - top - 5)).toFixed(0) + 'px');
  }

  function buyTreeNode(id, srcEl) {
    const n = TREE_BY_ID[id];
    if (!Y.buyNode(S, id)) return;
    lastBought = id;
    floatAt(srcEl, `-${n.cost} ⚡`, 'yellow');
    softFlash();
    onChange();
    buildTree();
    setTimeout(() => { lastBought = null; }, 900);
  }

  let treeSig = '';
  function treeSignature() {
    return TREE.map((n) => (plHidden(n) ? 'x' : nodeState(n)) + Y.lvl(S, n.id)).join('|') + '#' + selected;
  }

  // tüm katmanlar TREE_W × TREE_H'den boyutlanır; çevrede TREE_PAD kadar boş gökyüzü
  function sizeTree() {
    css(E('tree-space'), 'width', TREE_W + TREE_PAD * 2 + 'px');
    css(E('tree-space'), 'height', TREE_H + TREE_PAD * 2 + 'px');
    for (const el of [E('tree-lines'), E('tree-nodes')]) {
      css(el, 'left', TREE_PAD + 'px'); css(el, 'top', TREE_PAD + 'px');
      css(el, 'width', TREE_W + 'px'); css(el, 'height', TREE_H + 'px');
    }
  }

  function buildTree() {
    if (!S || !E('tree-nodes')) return;
    sizeTree();
    E('tree-lines').setAttribute('viewBox', `0 0 ${TREE_W} ${TREE_H}`);
    E('tree-lines').innerHTML = boltSVG();
    const shown = TREE.filter((n) => !plHidden(n)); // açılmamış gezegenin dalı hiç çizilmez
    E('tree-nodes').innerHTML = shown.map((n) => nodeHTML(n, nodeState(n))).join('');
    renderDetail();
    const real = shown.filter((n) => !n.soon);
    const owned = real.filter((n) => Y.nodeMaxed(S, n.id)).length;
    txt(E('tree-progress'), `${owned} / ${real.length} düğüm · sürükle: kaydır · Ctrl+tekerlek: yakınlaş`);
    treeSig = treeSignature();
    updateTreePage();
  }

  // ---- kaydırma ve yakınlaştırma ----
  let zoom = 0, drag = null, dragMoved = false;
  function setZoom(z, cx, cy) {
    const v = E('tree-view'), old = zoom || z;
    z = Math.max(0.45, Math.min(1.4, z));
    const px = (v.scrollLeft + cx) / old, py = (v.scrollTop + cy) / old;
    zoom = z;
    css(E('tree-inner'), 'width', (TREE_W + TREE_PAD * 2) * z + 'px');
    css(E('tree-inner'), 'height', (TREE_H + TREE_PAD * 2) * z + 'px');
    css(E('tree-space'), 'transform', `scale(${z})`);
    v.scrollLeft = px * z - cx;
    v.scrollTop = py * z - cy;
    placeDetail();
  }
  function centerOn(id) {
    const n = TREE_BY_ID[id], v = E('tree-view');
    v.scrollLeft = (n.x + TREE_PAD) * zoom - v.clientWidth / 2;
    v.scrollTop = Math.max(0, (n.y + TREE_PAD) * zoom - v.clientHeight * 0.3);
  }
  function initTreeView() {
    if (zoom) return;
    const v = E('tree-view');
    if (!v.clientWidth) return;
    setZoom(Math.max(0.5, Math.min(1, v.clientWidth / 1500)), 0, 0);
    centerOn('kivilcim');
  }
  function bindTreeView() {
    const v = E('tree-view');
    v.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, sl: v.scrollLeft, st: v.scrollTop };
      e.preventDefault(); // sürüklerken tarayıcı metin seçmesin
      dragMoved = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!dragMoved && Math.hypot(dx, dy) > 5) { dragMoved = true; v.classList.add('dragging'); }
      if (dragMoved) { v.scrollLeft = drag.sl - dx; v.scrollTop = drag.st - dy; }
    });
    window.addEventListener('pointerup', () => { drag = null; v.classList.remove('dragging'); });
    v.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = v.getBoundingClientRect();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    E('tree-zoom').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const z = b.dataset.z;
      if (z === '0') centerOn('kivilcim');
      else setZoom(zoom * (z === '+' ? 1.2 : 1 / 1.2), v.clientWidth / 2, v.clientHeight / 2);
    };
    v.addEventListener('scroll', placeDetail, { passive: true });
    // düğüme tıkla: kutu açılır (aynı düğüm ya da boş alan: kapanır)
    v.addEventListener('click', (e) => {
      if (dragMoved || e.detail > 1) return; // çift tıklamanın ikinci tıkı kutuyu kapatmasın
      const b = e.target.closest('.tnode');
      selected = b && b.dataset.id !== selected ? b.dataset.id : null;
      buildTree();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected) { selected = null; buildTree(); } });
    E('tree-nodes').addEventListener('dblclick', (e) => {
      const b = e.target.closest('.tnode');
      if (b && Y.canBuyNode(S, b.dataset.id)) buyTreeNode(b.dataset.id, b);
    });
    E('tree-detail').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) { selected = null; buildTree(); return; }
      const b = e.target.closest('[data-buy]');
      if (b) buyTreeNode(b.dataset.buy, b);
    });
  }

  function updateTreeLight() {
    hide(E('tab-btn-stars'), !(S.broken || (S.unlocked && S.unlocked.stars)));
    // ilk fırtınaya kadar tamamen gizli (gizem korunur); sonra hep görünür
    const open = treeOpen();
    hide(E('tab-btn-tree'), !open);
    if (!open && !E('page-tree').hidden) showTab('cycle', 'ağaç-kapalı');
    const avail = TREE.filter((n) => Y.canBuyNode(S, n.id)).length;
    cls(E('tab-btn-tree'), 'has-buy', avail > 0 && E('page-tree').hidden);
    hide(E('tree-badge'), avail === 0);
    if (avail) txt(E('tree-badge'), String(avail));
    if (!E('page-tree').hidden && treeSignature() !== treeSig) buildTree();
  }

  function updateTreePage() {
    txt(E('tree-simsek'), fmt(S.simsek));
  }

  // ---------------------------------------------------------------------------
  // İstatistik
  // ---------------------------------------------------------------------------
  function updateStats() {
    const s = S;
    const items = [
      ['Bu tur süresi', fmtTime(s.runTime)], ['Toplam oyun süresi', fmtTime(s.totalTime)],
      ['Anlık damla', fmt(s.damla)], ['Rekor damla', fmt(s.recordDamla)],
      ['Toplam fırtına', s.storms], ['En hızlı tur', s.fastestRun ? fmtTime(s.fastestRun) : '—'],
      ['Toplam Şimşek', fmt(s.simsekTotal)], ['Yakalanan / kaçan yıldırım', `${s.lightning.clicked} / ${s.lightning.missed}`],
      ['Basınç Düşüşü çarpanı', fmtMult(D(Y.C.BD_MULT).pow(s.bd))], ['Nem çarpanı', fmtMult(Y.nemMult(s))],
      ['Yıldırım çarpanı', fmtMult(Y.lightningMult(s))], ['Ağaç çarpanı', fmtMult(treeProdMult())],
      ['Şimşek çarpanı (Ç)', '×' + Y.stormMult(s)], ['Toplam üretim çarpanı', fmtMult(Y.globalMult(s))],
    ];
    if (HAS_P) {
      const ids = Y.planetIds();
      items.push(['Açık gezegen', `${openIds().length} / ${ids.length}`], ['Tamamlanan gezegen', `${ids.filter((id) => Y.planetDone(s, id)).length} / ${ids.length}`]);
    }
    html(E('stats'), items.map(([k, v]) => `<div class="stat"><span class="lbl">${k}</span><span class="mono">${v}</span></div>`).join(''));
  }

  // ---------------------------------------------------------------------------
  // Bildirim / modal / fırtına anı
  // ---------------------------------------------------------------------------
  function toast(title, sub, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
    const box = E('toasts');
    while (box.children.length >= 4) box.firstChild.remove();
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4700);
  }
  function modal(body) { E('modal-body').innerHTML = body; E('modal').hidden = false; }

  function stormSequence(gain, first) {
    const f = E('flash');
    f.className = 'flash'; void f.offsetWidth; f.classList.add('go');
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 600);
    root.Planet.pulse(tc('violet'));
    setTimeout(() => {
      if (first) {
        modal(`<div class="lbl yellow">PRESTİJ DÖNGÜSÜ 01</div><h2>Fırtına koptu!</h2><div class="big-n">+${fmt(gain)} ⚡</div>
          <p>Gökyüzü yarıldı ve ilk Şimşek'in düştü. Gezegen yeniden çiğle başlıyor, ama artık bir <b>Şimşek Ağacı</b> var.</p>`);
        E('modal-close').onclick = () => { E('modal').hidden = true; showTab('tree'); E('modal-close').onclick = () => { E('modal').hidden = true; }; };
      } else {
        toast(`Fırtına koptu: +${fmt(gain)} Şimşek`, `Toplam ${S.storms}. fırtına`, 'violet');
      }
    }, 700);
  }

  const UNLOCK_TEXT = {
    nem: ['Sis çöktü', 'Nem açıldı: hava ne kadar nemliyse döngü o kadar hızlı.'],
    bd: ['Yağmur başladı', 'Basınç Düşüşü açıldı: sıfırla, yeni kademe ve ×2 çarpan kazan.'],
    yildirim: ['Sağanak', 'Yıldırım düşmeye başladı. Gezegende belirince yakala!'],
    cephe: ['Fırtına', 'Hava Cephesi açıldı. Gezegende bir siklon gözü oluşuyor.'],
    storm: ['Tam kaplama', 'Gezegenin üstünde bir şey belirdi...'],
  };

  // tekrarlayan olaylar yalnızca öğrenme döneminde (ilk fırtınadan önce) bildirim atar; sonrası sessiz geri bildirim
  const learning = () => S.storms === 0;
  let ventToastShown = false;
  function handleEvents() {
    for (const e of S.events) {
      if (e.type === 'unlock') {
        const t = UNLOCK_TEXT[e.feature];
        if (t) toast(t[0], t[1], e.feature === 'yildirim' ? 'bolt' : e.feature === 'storm' ? 'violet' : '');
      } else if (e.type === 'stage' && STAGES[e.stage].id === 'kuresel') {
        toast('Küresel fırtına', 'Gezegen kararmaya başladı...');
      } else if (e.type === 'lightningHit') {
        root.Planet.pulse(tc('yellow2'));
        softFlash();
        if (learning()) toast('Yıldırım yakalandı!', `Tüm üretim ×${e.mult} · ${Y.lightningDuration(S)} sn`, 'bolt');
      } else if (e.type === 'bd') {
        root.Planet.pulse(tc('yellow'));
        if (e.count <= 4 && learning()) toast(`Basınç Düşüşü #${e.count}`, `${PRODUCERS[e.count + 3].name} açıldı · tüm üreticiler ×2`, 'bolt');
      } else if (e.type === 'storm' && e.auto) {
        root.Planet.pulse(tc('violet'));
        bumpDrop();
      } else if (e.type === 'cephe') {
        root.Planet.pulse(tc('accent'));
        if (S.storms === 0 && e.count === 1) toast(`Hava Cephesi #${e.count}`, `Nem etkisi artık ${pct(Y.nemGain(S) * 100)}`);
      } else if (e.type === 'planetOpen') {
        planetNavSig = '';
        toast(`${pname(e.id)} açıldı`, 'Gezegen oklarıyla ya da ← → tuşlarıyla geçebilirsin.', 'violet');
      } else if (e.type === 'planetDone') {
        planetNavSig = '';
        // yeni gezegen keşfediliyorsa bildirimi yönlendirme verir (updateGuide)
        const nx = Y.planetReady && Y.planetReady(S);
        if (!nx || (S.planetSeen || {})[nx]) toast(`${pname(e.id)} tamamlandı`, 'Bu kalıcı: fırtınadan sonra da tamamlanmış sayılır.', 'violet');
      } else if (e.type === 'melt') {
        if (viewId() === 'buz') { floatAt(E('melt-btn'), `+${fmt(e.gain)} Damla`); root.Planet.pulse(tc('accent')); bumpDrop(); }
      } else if (e.type === 'vent') {
        if (viewId() === 'gaz') {
          floatAt(E('vent-btn'), `+${fmt(e.gain)} Damla`, e.auto ? 'yellow' : '');
          root.Planet.pulse(tc(e.auto ? 'yellow' : 'accent'));
          if (e.auto && !ventToastShown && (ventToastShown = true)) toast('Basınç taştı', `Kendiliğinden boşaldı: +${fmt(e.gain)} Damla, ödülün yarısı kayboldu.`, 'bolt');
        }
      } else if (e.type === 'planetReset') {
        root.Planet.pulse(tc('violet'));
        if (viewId() === e.id) floatAt(E('pr-btn'), `+${fmt(e.gain)} Şimşek`);
        if (e.count === 1) toast(`İlk ${Y.RESET_NAME[e.id]}: +${fmt(e.gain)} Şimşek`, `${pname(e.id)} sıfırlandı; artık kendi otomatik alımı var.`, 'violet');
      } else if (e.type === 'shield') {
        if (viewId() === 'col') { floatAt(E('shield-btn'), 'Kalkan açık'); root.Planet.pulse(tc('accent')); }
      } else if (e.type === 'broken') {
        toast('Doygunluk kırıldı', 'Üst menüde Yıldızlar sekmesi açıldı.', 'violet');
      }
    }
    S.events.length = 0;
  }

  function offlineSummary(r) {
    if (!r || r.seconds < 60 || r.after.lte(r.before)) return;
    modal(`<div class="lbl">ÇEVRİMDIŞI İLERLEME</div><h2>Tekrar hoş geldin</h2>
      <p>${fmtTime(r.seconds)} boyunca bulutlar çalışmaya devam etti.</p>
      <div class="big-n accent">+${fmt(r.after.sub(r.before).max(0))}</div><p>damla toplandı.</p>`);
  }

  function setSaveTime(t) { lastSave = t; }

  root.UI = { init, update, updateStats, planetView, handleEvents, toast, modal, offlineSummary, showTab, actions, setSaveTime };
})(window);
