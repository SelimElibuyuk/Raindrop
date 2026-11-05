# Gezegen sistemi – uygulama sözleşmesi (Katman 1, YAPI 41)

Bu dosya iki paralel işin ortak sözleşmesidir: **çekirdek** (`js/core.js`, yeni `js/planets.js`, `sim/`) ve **arayüz** (`index.html`, `js/ui.js`, `style.css`, `js/themes.js`, `js/main.js`, `js/planet.js`). Kaynak: PRD "Gezegen sistemi" + "Katman 1 → Katman 2 geçişi". Oyun dili Türkçe; kod yorumları mevcut dosyalardaki gibi Türkçe ve seyrek.

## Temel kurallar
- Okyanus = bugünkü döngü. Kök durumdaki alanlar (`s.damla`, `s.p`, `s.nem`, `s.bd`, `s.cephe`, `s.runMax` …) **Okyanus'a aittir ve değişmez** (kayıt uyumu, sim, mevcut arayüz).
- Yeni gezegenler: `s.planets.buz`, `s.planets.col`, `s.planets.gaz`. Her biri **kendi damlası, kendi 4 üreticisi ve kendine özgü mekaniği** ile çalışır. Nem / Basınç Düşüşü / Hava Cephesi yeni gezegenlere taşınmaz.
- Tüm açık gezegenler aynı anda üretir; oklar yalnızca bakılan gezegeni değiştirir.
- Fırtına tek ve ortaktır: `doStorm` tüm gezegenleri sıfırlar (açık olma ve "tamamlandı" durumları kalıcıdır). Şimşek kazancı = Okyanus formülü + açık gezegenlerin katkısı.
- Rastgele ödül yok. Yıldırım rastgeleliği yalnızca zamanlamada.

## Gezegenler
| id | ad | özgün mekanik | tamamlanma ölçüsü (bir kez ulaşmak yeter, kalıcı) | açılma |
|---|---|---|---|---|
| okyanus | Okyanus | bugünkü döngü | damla ≥ 1e200 (bir kez) | başlangıç |
| buz | Buz | Üreticiler damla değil **Buz** üretir. **Erit** biriken buzu tek seferde damlaya çevirir; çarpan biriken buzla logaritmik büyür (bekleme ödülü). | tek eritmede ≥ hedef buz | Ağaçta `buzGezegeni` düğümü (ön koşul: Okyanus bir kez 1e100) |
| col | Çöl | Nem yok. Buhar çok güçlü ama **buharlaşma**: damla her saniye belli bir oranda kaybolur (kaplama azalır). **Gölge** alımları kaybı azaltır; **Bulut Kalkanı** (aktif buton) kısa süre kaybı durdurur, bekleme süresi var. | kaplama %100 | `colGezegeni` düğümü (ön koşul: Buz kaplaması ≥ %50) |
| gaz | Gaz devi | Fırtına hiç durmaz: yıldırım bonusu bu gezegende sürekli. **Basınç** zamanla 0→1+ yükselir; **Boşalt** basınca bağlı büyük damla patlaması verir; basınç 1'i geçerse kendiliğinden boşalır ve ödülün yarısı kaybolur ("şimdi mi, biraz daha mı?"). Fırtına kazancına **Şimşek çarpanı** katar. | tek boşaltmada basınç ≥ 0,95 iken ve gaz damlası ≥ hedef | `gazDevi` düğümü (ön koşul: okyanus+buz+çöl tamamlandı) |

- **Kuyruklu yıldız akışı** (`kuyrukluYildiz` düğümü): damlası 1e100'ü geçen gezegenin taşan üretiminin bir kısmı sıradaki açık gezegene akar.
- **Aşırı Doygunluk kademesi** (Okyanus'un e200 tavanı): tamamlanan gezegen sayısına göre `{at, pow}` = Okyanus yalnız `{200,3}`, +Buz `{225,2.5}`, +Çöl `{250,2}`, +Gaz `{300,1.5}`, Doygunluğu Kır → kalkar. `lateFactor` bunu kullanır.
- **Doygunluğu Kır** (`doygunlukKir` düğümü): dört gezegen tamamlanınca alınabilir. Alınınca `s.broken = true`, `s.unlocked.stars = true`, event `broken`. Arayüz üst menüde **Yıldızlar** sekmesini açar (içerik: "Katman 2 yakında" yer tutucu, sade).
- Ağaçtaki `soon` düğümler gerçek düğüm olur (maliyetli). Her yeni gezegene 1–2 güçlendirme düğümü eklenebilir (çekirdek karar verir; arayüz ağacı TREE'den genel olarak çizer, gerekirse `TREE_W/TREE_H` büyür).

## Durum (kayıtta)
```
s.planets = { buz: PS, col: PS, gaz: PS }   // PS: { damla: Decimal, p: [{amount: Decimal, bought}] ×4, runMax: Decimal, ...özel }
  buz özel: { ice: Decimal, melts: n, bestMelt: Decimal }
  col özel: { shade: n, shield: sn kalan, shieldCd: sn kalan }
  gaz özel: { pressure: number, vents: n }
s.planetOpen  = { okyanus: true, buz: false, col: false, gaz: false }
s.planetDone  = { okyanus: false, ... }      // kalıcı
s.view        = 'okyanus'                    // arayüzün baktığı gezegen (kayıtta, mantığı etkilemez)
s.broken      = false
```
`deserialize` eski kayıtları taşır (alanlar yoksa varsayılan). Kayıt `version: 2`.

## Çekirdek API (hepsi `YF` üzerinden, saf, DOM yok)
```
PLANETS                       // [{id, name, short, order, unit:'Damla'|'Buz'..., producers:[{id,name,base,step,makes}] }] (okyanus dahil; okyanus producers = PRODUCERS)
planetIds()                   // ['okyanus','buz','col','gaz']
planetOpen(s,id) / planetDone(s,id)
planetUnlockHint(s,id)        // kilitliyse kısa Türkçe ipucu metni, açıksa null
pDamla(s,id)                  // okyanus için s.damla
pDamlaPerSec(s,id)            // net (çöl için buharlaşma düşülmüş)
pCoverage(s,id)               // 0..1 (gezegen çizimi ve noktalardaki halka)
pMeasure(s,id)                // { label, value: string, progress: 0..1, done: bool } tamamlanma ölçüsü
pProducerCost(s,id,i) / pBulkInfo(s,id,i,mode) / pBuy(s,id,i,mode) / pTierVisible(s,id,i) / pMaxAll(s,id)
pProducerRate(s,id,i)         // o kademenin saniyelik üretimi (gösterim için)
// Buz
meltPreview(s) -> { gain: Decimal, mult: number } ; melt(s) -> Decimal
// Çöl
evapRate(s) -> number (saniyelik oran, 0..1) ; shadeCost(s) ; buyShade(s) ; canShield(s) ; shield(s)
// Gaz
pressure(s) -> number ; ventPreview(s) -> { gain: Decimal, over: bool } ; vent(s) -> Decimal ; gasStormMult(s) -> number
planetStormParts(s)           // { okyanus: n, buz: n, col: n, gaz: n } ; stormGain(s) bunların toplamı × çarpanlar
lateTier(s) -> { at, pow } | null
```
Mevcut fonksiyonlar (`stormGain`, `canStorm`, `doStorm`, `coverage`, `tick`, `simulateOffline`, `serialize/deserialize`) yeni gezegenleri kapsayacak şekilde genişler; imzaları değişmez. `coverage(s)` Okyanus'unkini döndürmeye devam eder.

Yeni event'ler (`s.events`): `planetOpen {id}`, `planetDone {id}`, `melt {gain}`, `vent {gain, auto, over}`, `shield {}`, `broken {}`.

## Denge hedefleri (sim ile kontrol)
- İlk fırtına ~44 dk değişmesin (Okyanus döngüsüne dokunma).
- Her yeni gezegende ilk 10 dk içinde en az bir karar (Erit zamanı, Gölge/Kalkan, Boşalt zamanı).
- Tek gezegenin tamamlanması ~2–3 sa; Katman 1 tamamı simde 10–15 sa aralığına yakın.
- Gezegen eklenince Şimşek kazancı kaçak büyümesin (PRD çarpan kuralı: logaritmik).

## Arayüz
- Gezegen panelinde ‹ › okları ve ← → klavye; altta gezegen adı + her gezegen için nokta (küçük kaplama halkası). Sonraki kilitli gezegen "???" siluet noktası; ondan sonrakiler görünmez.
- Bakılan gezegene göre üreticiler listesi ve alttaki kartlar değişir: Okyanus'ta bugünkü Nem/Basınç/Cephe kartları; Buz'da Erit kartı; Çöl'de buharlaşma göstergesi + Gölge + Kalkan; Gaz'da basınç göstergesi + Boşalt. Fırtına butonu ortak kalır, kazanç dökümünü (gezegen katkıları) tooltip'te gösterir.
- Tema: ayarlardaki "Otomatik" = bakılan gezegenin teması. Buz/Çöl/Gaz temaları Okyanus'taki gibi sade alacakaranlık yorumuna çekilir: **neon / parlayan kenar / bloom yok**, tonal katmanlar, ince kenar çizgileri; şimşek rengi her yerde kehribar.
- Geçişte gezegen yana kayar (kısa, sade). `prefers-reduced-motion` saygı görür.
- Doygunluğu Kır sonrası üst menüde Yıldızlar sekmesi (yer tutucu).
- Mobil genişlikte taşma yok.

## Sahiplik ve sürüm
- Çekirdek ajanı yalnızca `js/core.js`, `js/planets.js`, `sim/*` dosyalarına yazar. Arayüz ajanı yalnızca `index.html`, `js/ui.js`, `js/main.js`, `js/themes.js`, `js/planet.js`, `style.css` dosyalarına yazar.
- `planets.js`, `core.js`'ten sonra, `planet.js`'ten önce yüklenir: `<script src="js/planets.js?v=41">`. `planets.js` UMD'dir ve çekirdeği genişletir (ya da çekirdek onu içerir); tarayıcıda API yine `window.YF` üzerindedir.
- YAPI numarası 41'e lider tarafından çıkarılır (core.js `BUILD`, index.html `data-build` ve `?v=`). Arayüz ajanı index.html'de `?v=41` kullanabilir.

---

# Ek: YAPI 42 değişiklikleri (kaba taslak; her gezegen sonra ayrıntılı ele alınacak)

Oyuncu geri bildirimi: (1) yeni gezegenler ağaç düğümüyle açılmasın, kilit gezegenin kendi üzerinde olsun; ilk gezegen bitince oyun oyuncuyu yeni gezegene yönlendirsin. (2) Fırtına butonu yalnızca Okyanus'ta olmalı (Buz'da görünüyor). (3) Şimşek Ağacı'na eklenen yeni düğümler arka planla uyuşmuyor; ağaç arayüzü yeniden tasarlanmalı.

## Gezegen kilidi (Agent A)
- Ağaçtaki açıcı düğümler (`buzGezegeni`, `colGezegeni`, `gazDevi`) kaldırılır. Gezegenler zincirle açılır: Buz ← Okyanus tamamlandı (1e200), Çöl ← Buz tamamlandı, Gaz ← Çöl tamamlandı.
- Açma gezegenin kendi ekranında yapılır: koşul sağlanınca kilitli gezegende "Aç" butonu (Şimşek bedeli `C.PLANET_COST = { buz, col, gaz }`; denge için ayarlanır).
- Çekirdek API (yeni): `planetUnlockReq(s,id) -> { text, progress: 0..1, met: bool, cost }`, `canUnlockPlanet(s,id)`, `unlockPlanet(s,id)` (Şimşek düşer, `planetOpen` event'i), `nextPlanet(s) -> id | null` (sıradaki kilitli gezegen), `planetReady(s) -> id | null` (koşulu sağlanmış ama açılmamış gezegen; yönlendirme için). `planetUnlockHint` kalır (kısa metin).
- `nodeVisible` genel kuralı: `planet` alanı `okyanus` dışında olan düğüm yalnızca o gezegen açıksa görünür (gizem korunur). `opens` alanı ve işlenmesi kalkar.
- Arayüz: sıradaki kilitli gezegene oklarla gidilebilir; koyu siluet gezegen, adı koşul sağlanana kadar "???", gezegen panelinde kilit kartı (koşul metni, ilerleme çubuğu, bedel, "Aç" butonu). Diğer kartlar ve üreticiler kilitliyken gizli.
- Yönlendirme: `planetReady` ilk kez dolu olunca sade bir bildirim ("Okyanus tamamlandı · yeni bir gezegen keşfedildi") + gezegen panelinde "Yeni gezegen →" düğmesi ve › okunda sakin bir nabız (neon yok). Görülünce/açılınca kaybolur.
- Fırtına butonu ve fırtına kazancı göstergesi yalnızca Okyanus görünümünde; diğer gezegenlerde gizli. Fırtına mantığı ortak kalır.

## Şimşek Ağacı (Agent B)
- `TREE_W/TREE_H` neyse ağacın tamamı (yıldırım SVG'si, gökyüzü, yıldızlar, ışık geçişi, düğüm katmanı, kaydırma alanı) ona göre boyutlanır; `style.css`'teki sabit 1800×1660 / 2640×2500 kalkar (JS'ten ayarlanır).
- Gezegen düğümleri her gezegenin kendi dalı olur: gezegen açılınca görünür, dal ve düğümler o gezegenin vurgu renginde (temadan), dalın arkasında çok düşük opaklıkta gezegen renginde yumuşak bir bölge; parlama/neon yok. Dal kökünde küçük bir gezegen işareti olabilir.
- Mevcut gezegen düğümleri: `buzDerin`, `buzErime` (buz), `colGunes`, `colVaha` (col), `gazCekirdek`, `gazPompa`, `kuyrukluYildiz` (gaz), `doygunlukKir` (gövdenin sonu, okyanus). Açıcı düğümler kalktığı için yeni ebeveynler ve konumlar verilir (ör. gezegen dalının kökü `iyonFirtina`). Etkiler ve maliyetler Agent A'nındır; Agent B yalnızca `parent`, `via`, `x`, `y`, `TREE_W`, `TREE_H` alanlarına dokunur ve üç açıcı düğümü siler.
- Kullanıcının sevdiği şeyler korunur: büyük, kaydırılabilir dallanan yıldırım; düğümün yanında açılan bilgi kutusu; sürüklerken metin seçilmemesi; geniş kenar boşluğu.

## Dosya sahipliği (aynı dosyalarda paralel çalışılıyor)
- `js/core.js`: Agent B yalnızca `TREE` dizisi ile `TREE_W/TREE_H` satırına; Agent A geri kalan her yere (ve `C` sabitlerine).
- `js/ui.js`: Agent B ağaç fonksiyonlarına (`nodeState` … `bindTreeView`, `renderDetail`, `placeDetail`, `buildTree`, `initTreeView`, `setZoom`, `centerOn`); Agent A geri kalanına.
- `style.css`: Agent B `.tree-*`, `.tnode*`, `.td-*` kurallarına; Agent A diğerlerine. Yeni kurallar her ajanın kendi yorum başlığı altında.
- `index.html`: Agent B yalnızca `#page-tree` bölümüne; Agent A geri kalanına.
- `sim/*`, `js/planets.js`, `js/themes.js`, `js/planet.js`, `js/main.js`: Agent A.
- Paylaşılan dosyalarda yalnızca Edit aracıyla küçük, hedefli değişiklik; dosyanın tamamını yeniden yazma ve `sed -i` yok. Her düzenlemeden önce dosyayı yeniden oku.
