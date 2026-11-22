# Yağmur Fırtınası: Roguelite PRD (v0.1, 2026-11-16)

## 1. Vizyon
Bir bulutu kontrol ediyorsun. Kurak toprakta bitkileri suluyorsun; açan her çiçek para veriyor, parayla
kalıcı geliştirmeler alıyorsun. Run'lar çok kısa (20–30 sn), "bir tur daha" hissi oyunun kalbi.
Tür: incremental + roguelite (run → para → kalıcı güç → daha iyi run). İlham: Growing My Manhole'un
kısa run + büyüme + kalıcı upgrade iskeleti.

## 2. Tasarım ilkeleri
- **Su azalıyor:** Bulutun içindeki su sürekli azalır; bu gerilim oyunun ana hissi.
- **Kısa ve aktif:** Bekleme yok. Bir run 30 sn'yi nadiren geçer, sonuç ekranı ve dükkân birkaç saniyelik.
- **Hiçbir zaman sonsuz değil:** Her geliştirme run'ı uzatabilir, ama run'ı sonsuz hale getiren
  hiçbir kombinasyon olmamalı.
- **Erken oyunda su, geç oyunda zaman sınırlar:** Güçlendikçe oyuncunu sınırlayan şey değişir; güç hissi buradan gelir.
- **Yüzde yok, çarpan serbest:** Zorunda kalmadıkça yüzde kullanılmaz. Stat'lar düz sayıdır ("Yağmur şiddeti 3 → 4",
  "+20 su", "−1 su/sn"); şans yerine adet kullanılır ("haritada 2 gül"). Çarpanlar (×2, ×1.25) sevilir ve kullanılır:
  kombo bir çarpandır, ileride ayrı "modifier" çarpanları eklenecek.

## 3. Çekirdek döngü
1. **Run başlar:** Bulut dolu depoyla haritanın ortasında doğar. Haritada rastgele bitkiler var.
2. **Sulama:** Bulut imleci/parmağı takip eder. Basılı tutunca yağmur yağar; yağmur dairesinin içindeki
   her bitki saniyede **yağmur şiddeti** kadar su alır (başlangıç 3).
3. **Çiçek:** Bitki su ihtiyacı dolunca açar → para (aşağıdaki kombo formülü). Kısa süre sonra
   haritada başka bir yerde yeni bir fide çıkar (alan hep dolu kalır).
4. **Kombo:** Bir önceki açılıştan kombo süresi (1.5 sn) içinde açılan her çiçek çarpanı +0.25 artırır
   (×1 → ×1.25 → … en fazla ×3). Para = (bitkinin parası + Bereket + Altın Gül) × kombo.
5. **Run biter:** Su biter ya da (süre modunda) süre dolar.
6. **Sonuç ekranı:** Kazanılan para, açan çiçekler, en yüksek kombo.
7. **Dükkân:** Kalıcı geliştirmeler → "Tekrar" ile yeni run.

## 4. Run sınırı: iki sistem (prototipte ikisi de var, playtest ile seçilecek)

### Sistem A: Süre + Su (`timer`)
- Run'ın sabit bir süresi var (başlangıçta 20 sn). Su ya da süre, hangisi önce biterse run biter.
- Depo 100 su. Yağarken 8 su/sn harcanır (şiddetten bağımsız), ayrıca 2 su/sn pasif buharlaşma var.
- Erken oyunda depo küçük olduğu için su önce biter. Su kazanma geliştirmeleri açılınca sınırı süre çizer.

### Sistem B: Artan Buharlaşma (`evap`)
- Sayaç yok. Buharlaşma 2 su/sn'den başlar, 6. saniyeden sonra her saniye +2 su/sn artar.
- Buharlaşma zamanla arttığı için su kazanma ne kadar güçlü olursa olsun run sonunda biter.

### Açık sorular (playtest)
- Su zamanla mı azalsın, kullandıkça mı? İkisi de debug panelinden ayarlanabilir
  (`passiveDrain`, `rainCost`). Hazır ayarlar: "Sadece zaman", "Sadece kullanım", "Karışık".
- A mı B mi?

## 5. Bitkiler
8 çiçek var. Ayrıntılar, sayılar ve sprite brief'leri: [design/tree-v2.md](design/tree-v2.md) §1.

| Çiçek | Su | Para | Haritada | Özellik |
|---|---|---|---|---|
| Kaktüs | 2 | 1 | dolgu | – |
| Papatya | 6 | 3 | dolgu | – |
| Lale | 8 | 5 | Lale Tarhı ile adet | – |
| Lavanta | 6 | 3 | adet | Kombo içinde açarsa ×2 para |
| Çan Çiçeği | 8 | 2 | adet | Açınca buluta +5 su |
| Gül | 12 | 8 | baştan 1, Gül Bahçesi ile artar | Altın Gül: +5 para |
| Ayçiçeği | 14 | 7 | adet | İki kez açar; Altın Polen ×2 |
| Gök Zambağı | 36 | 30 | adet | Yağmur almazsa 3 su/sn kaybeder |

Para = (bitkinin parası + Bereket + çiçek bonusu) × kombo × para çarpanı × çiçek çarpanı.

## 6. Yetenek ağacı v2 (meta, kalıcı)
Kök **Bulut**'tan 6 dal açılır: Su (yukarı), Fırtına (sağ-yukarı, geç oyun × çarpanları), Yağmur (sağ),
Mevsim (aşağı, +1/+2/+3 sn, toplam en fazla +10 sn), Rüzgar (sol-aşağı), Bereket (sol, tüm çiçek açılımları).
32 düğüm; tam liste ve ekonomi simülasyonu [design/tree-v2.md](design/tree-v2.md) §2 ve §4'te.
Bir düğüm ebeveyni 1. seviyeye gelince görünür, ebeveynin `need` seviyesinde alınabilir. Detay paneli gerçek değeri
gösterir ("Şiddet 3 → 4", "Para çarpanı ×1.1 → ×1.2").
Artan Buharlaşma modu: buharlaşma 6. saniyeden sonra her saniye +2 su/sn artar; Mevsim bonusunun yarısı bu gecikmeye eklenir.

## 7. Ekranlar
- **Run:** Tam ekran canvas + HUD (su çubuğu, süre/buharlaşma göstergesi, para, kombo).
- **Sonuç:** Para, çiçek sayısı, en iyi kombo, "Dükkân" / "Tekrar".
- **Yetenek ağacı:** Kaydırılabilir ağaç, düğüm detay paneli (seviye, etki şimdi → sonra, maliyet, "Al"), "Yağmura Başla".
- **Debug paneli** (`D` tuşu ya da köşedeki ⚙): mod seçimi, hazır ayarlar, sayı kaydırıcıları, +1000 para, kaydı sıfırla.

## 8. Teknik
- Vanilla JS, `<script>` ile yüklenen dosyalar, tek global ad alanı `RD`. Derleme adımı yok.
- `Raindrop/rogue/` altında ayrı proje; eski demo (`Raindrop/demo`) arşiv olarak kalır.
- Kayıt: `localStorage` (`rd-rogue-v1`); try/catch ile, kayıt yoksa da oyun çalışır.
- Dosyalar:
  - `js/config.js`: tüm sayılar, bitkiler, geliştirmeler, modlar (tasarım verisi)
  - `js/meta.js`: kayıt/yükleme, satın alma, `computeStats()`
  - `js/run.js`: run simülasyonu (saf mantık, çizim yok)
  - `js/render.js`: canvas çizimi
  - `js/input.js`: imleç/dokunma, basılı tutma
  - `js/ui.js`: HUD, sonuç, dükkân, debug paneli (DOM)
  - `js/main.js`: oyun döngüsü ve ekran durum makinesi
- Mobil uyumlu: dokunma ile takip + basılı tutma; 375 px genişlikte taşma yok.

## 9. Kapsam dışı (v0.1)
Düşmanlar, biyomlar, run içi kart seçimi, ses, offline kazanç, büyük sayı kütüphanesi.
Bunlar çekirdek döngü eğlenceli bulunduktan sonra değerlendirilecek.

## 10. Başarı ölçütü (prototip)
- İlk run ≈ 10–15 sn sürüyor ve 5–10 çiçek açılıyor.
- 5–6 run sonra ilk "su artık yetiyor" anı (süre modunda) hissediliyor.
- İki sistem ve drain ayarları debug panelinden run ortasında değil, run başında değiştirilebiliyor.

## 11. Sıradaki işler (2026-11-17 listesi; 1 ve 2 numara 2026-11-20'de yapıldı)
Durum: Vektör çiçekler (`js/flora.js`) ile zemin, bulut ve yağmur çizimleri kullanıcı tarafından beğenildi. Ağaç v2 ve 8 çiçek oyunda.
Henüz commit yapılmadı.

1. **Zemin gerçekten canlansın.** Sulanan yerler şu an sadece hafifçe yeşeriyor, bu yetersiz. Hedef:
   - sulanan yerlerde gerçek çimenler çıksın (flat vektör ot öbekleri, filizler, belki küçük yabani çiçekler),
   - çok sulanan bölgeler yemyeşil olsun, yeşillik komşu kareye yavaşça yayılabilir,
   - "kuraklığa karşı alanları yeşertiyorsun" hissi run boyunca net görünsün.
   - İlgili kod: `js/render.js` içindeki `wet`/`soak` ızgarası ve `drawWet` (`SOAK_PER_WET`, `ag`). Çimen çizimi flora.js tarzında olmalı.
     Performans için çimenleri hücre başına önbelleğe alıp ızgarayla birlikte çiz.
2. **Tomurcuk hâlindeki çiçekler zor ayırt ediliyor.** Büyüme sırasında türler birbirine benziyor.
   - Tomurcuk/sap aşamasında her türü belirgin yap: tür rengi daha erken ve daha güçlü görünsün,
     silüetler (yaprak şekli, boy, tomurcuk biçimi) daha farklı olsun, gerekirse altta küçük bir tür rengi noktası olsun.
   - Kontrol yeri: `flora-preview.html` "Büyüme aşamaları" satırları (growth 0.25–0.8 arası).
3. **Yetenek ağacı henüz istenen hâlde değil.** Kullanıcı birkaç eksiği söyleyecek; o eksikler konuşulduktan sonra
   fiyatlar ve geliştirmeler birlikte yeniden dengelenecek. Mevcut veri ve ekonomi simülasyonu: `design/tree-v2.md`.
   Bilinen açık: 20. run'dan sonra satın almalar 3–5 run'da bire düşüyor; tek seferlik pahalı düğümler (thunder, time3, pollen) bölünebilir.
   **Görsel ilham (kullanıcının paylaştığı 4 örnek, `design/refs/skilltree-ref-1..4.webp`). Kopyalanmayacak, kendi tarzımızla yorumlanacak:**
   - Ağaç **çok daha büyük ve yoğun** olmalı (örneklerde 100+ düğüm): uzun zincirler, dallanan alt kollar, dal sonlarında
     yelpaze gibi açılan uç düğümler, ortada büyük bir merkez/hub ve dalların başında daha büyük "ana düğümler".
   - Düğümlerde **ikon + seviye göstergesi** (ör. "LVL 1/3", Roma rakamı veya pip), açılmamışlar **kilit ikonuyla gri**,
     alınabilir/yeni olanlar küçük bir rozet/nokta ile işaretli (yeşil artı, "!" gibi).
   - **Bağlantı çizgileri durumu anlatır:** alınmış yol parlak/renkli, kilitli yol soluk.
   - Dallar **renk/tema ile ayrışır** (her dalın kendi rengi ve ikon ailesi), aynı istatistiğin seviyeleri yan yana zincir olur.
   - Kapsayıcı bir **çerçeve/zemin teması** (parşömen kâğıdı, ahşap pano gibi) ve arkada soluk dekoratif çizimler var. Bizde
     bunun karşılığı oyunun temasına uygun olmalı (ör. gökyüzü/bulut haritası, toprak/kök ağı, yaprak damarları).
   - **Hover/seçim kartı:** ad, seviye, açıklama, "şimdi → sonra" değeri, maliyet (birden fazla para birimi olabilir).
   - Kenarda kontrol ipuçları ("Sürükle: kaydır", "Tekerlek: yakınlaştır", "Ortala"), büyük "Başla" butonu, köşede para göstergeleri.
   - Not: menülerde, butonlarda ve kutularda **henüz oturmuş bir stil yok**. Ağacı yaparken genel UI dili de (çerçeve, buton, panel,
     tipografi) birlikte belirlenecek. Oyunun flat vektör sanatıyla (flora.js) uyumlu olmalı.
4. Küçük notlar: gerçek telefonda performans ve dokunmatik (pinch/sürükleme) testi yapılmadı; iki run sistemi (Süre + Su /
   Artan Buharlaşma) hâlâ playtest ile seçilecek.

## 12. Bölüm + boss çiçek sistemi (TASLAK, 2026-11-20, kullanıcı fikri; ayrıntılar konuşuluyor)
Kullanıcının fikri: zemini sulamak (yeşertmek) bir **bölüm barını** doldurur. Bar dolunca **boss çiçek** çıkar. Boss sulanınca
bölüm tamamlanır ve yeni bölüme geçilir. **Her bölüm yeni bir çiçek açar.** Boss düz sulanmaz; her bölümde küçük bir hilesi olur.
Kullanıcının örneği: boss'un farklı yerlerde 3 kolu var, her biri ayrı sulanmalı ve sulanan kol çevresini kurutur.

Claude'un önerisi (onay bekliyor):
- 8 bölüm (her biri bir çiçek). Bölüm N'nin boss'u yeni çiçeğin dev hâli; yenince o çiçek sonraki run'larda tarlada çıkar.
  Böylece çiçek açılımları ağaçtan bölümlere taşınır, ağaç bulutun gücüne odaklanır.
- Bar run içinde dolar (yeşertilen alan + açan çiçekler). Dolarsa boss gelir. Su/süre biterse run biter, para ve geliştirmeler
  kalır, oyuncu güçlenip tekrar dener (roguelite).
- Boss hileleri (bölüm sırasına göre zorlaşır):
  1. Dev Papatya: taç yaprakları çevrede tek tek açılır, her biri ayrı noktadan sulanır.
  2. Lale Kraliçesi: 3 kol farklı yerlerde; sulanan kol çevresini kurutur (yeşilliği siler).
  3. Kaktüs Devi: dikenleri açıkken su işlemez; ritimle, dikenler kapanınca sula.
  4. Lavanta: sulandıkça başka yere kaçar; bulut hızı önemli.
  5. Çan Çiçeği: çanlar sırayla çalar, doğru sırayla sulanmalı.
  6. Gül: dikenli sarmaşık kalkanı; önce çevresini yeşert, kalkan düşsün, sonra sula.
  7. Ayçiçeği: bulut üstünde fazla kalırsa gölgede solar; kısa kısa sula.
  8. Gök Zambağı (final): fazlı; kollar, kaçma ve kuraklık dalgası bir arada.
**Kararlar (kullanıcı, 2026-11-20):**
- Bar **run içinde** dolar. Aynı run'da bar dolup boss yenilmezse run biter; para ve geliştirmeler kalır, oyuncu tekrar dener.
- Ağaçtaki çiçek düğümleri **çiçek güçlendirmeye** döner. Çiçeği bölüm açar; ağaç o çiçeğin adedini, parasını ve özelliğini güçlendirir.
  Açılmamış çiçeğin düğümleri ağaçta görünmez.
- **Önce 3 bölümlük prototip.** His oturunca 8 bölüme genişletilecek.

**Prototip (3 bölüm):** başlangıç çiçekleri kaktüs ve papatya.
| Bölüm | Ad | Boss | Hile | Açtığı çiçek |
|---|---|---|---|---|
| 1 | Çatlak Vadi | Lale Kraliçesi | 3 kol farklı yerlerde; sulanmayan kol su kaybeder, sulanan kol çevresindeki bitkileri kurutur | Lale |
| 2 | Dikenli Bayır | Gül Ana | Dikenli sarmaşık kalkanı: önce çevresini yeşert, kalkan düşünce gövdeyi sula | Gül |
| 3 | Güneş Tepesi | Dev Ayçiçeği | Bulut üstünde fazla kalırsa gölgede kalıp solar; kısa kısa sula | Ayçiçeği |

Bar puanı: yeşeren her toprak hücresi +1, açan her çiçek +2. Bar dolunca boss çıkar, bulut biraz su ve süre kazanır.
Bar hedefleri: Bölüm 1 → 60, Bölüm 2 → 120, Bölüm 3 → 170 puan. Boss gelince +8/9/10 sn ve +40/50/60 su; ödül 40/90/180 para.
Bot simülasyonu (2026-11-20): geliştirmesiz bar %74'te kalıyor; erken geliştirmelerle Bölüm 1 geçiliyor, Bölüm 2 sınırda (~%40),
orta seviye geliştirmelerle Bölüm 3 açılıyor. Kod: `run.js` (_waterGround, _addBar, _spawnBoss, _updateBoss), `config.levels`,
`meta` (data.level, unlockedFlowers, açılmamış çiçeğin ağaç düğümleri gizli).
Boss yenilince run zaferle biter (bonus para), sonraki bölüm ve yeni çiçek açılır.

**Durum (2026-11-20 sonu):** Bölüm barı, 3 boss (mantık + görsel), HUD bölüm paneli, boss bandı, zafer/kaçtı/normal sonuç ekranları,
ağaçta bölüm şeridi ve debug'da "Bölümü seç" çalışıyor. Boss yenilince kutlama 1.4 sn tam ekran oynuyor, sonra sonuç ekranı açılıyor.
Sulanan zeminde çimen/yonca/kır çiçeği (§11.1) ve türe özgü tomurcuklar (§11.2) yapıldı. Gerçek telefonda test edilmedi.
Açık: boss'ların gerçek oyunda his testi (özellikle Lale kollarının bulutun altında kalması, Ayçiçeği'nin su azken başsız görünmesi),
8 bölüme genişleme, yeni büyük yetenek ağacı ve genel UI stili (§11.3).

**Playtest düzeltmesi (2026-11-20, kullanıcı: "oyun çok hızlı bitiyor, upgrade'ler önemsiz, 3 boss çok kolay"):**
- Yağmur şiddeti tabanı 3 → 2, çiçeklerin su ihtiyacı yeniden ayarlandı (kaktüs 3, papatya 5, lale 7, lavanta 5, çan 7, gül 10,
  ayçiçeği 12, zambak 28). Bir çiçek ~1.5–2.5 sn sürer; her şiddet seviyesi belirgin hızlandırır.
- Zemin yeşerme hızı yağmur şiddetine bağlı (`soil += şiddet × 1.5 / sn`); hücre 2 suda bara sayılır, 8 suda yemyeşil olur.
- Açan çiçek çevresinde (44 px) küçük bir alanı yeşertir (bara da puan verir).
- Boss yenilince boss'tan dışa yayılan **zafer dalgası**: geçtiği her yer yemyeşil olur, kalan tüm çiçekler açar, ekstra para gelir.
- Yeni sayılar: bar 110 / 380 / 480; boss su ihtiyacı Lale kolu 10 (kuruma 1.5/sn), Gül 70 (kalkan: 130 px içinde alanın 8/10'u yeşil),
  Ayçiçeği 75 (ısı sınırı 1.3 sn, yanınca 8 su/sn kaybeder); ödül 30 / 70 / 140.
- İlerleme simülasyonu (bot, her run sonrası en ucuz geliştirmeyi alıyor, medyan): Bölüm 1 boss'una 9. run'da ulaşıp 13.'de yeniyor,
  Bölüm 2: 24/25, Bölüm 3: 40/44. Önceden 3 bölüm ~15 run'da bitiyordu. Gerçek oyuncu biraz daha yavaş olur.
- Görsel istekler: her bitkide boss tarzı su halkası, tomurcuklar daha büyük ve sulanana kadar hafifçe nefes alıyor.

## 13. Boss sonrası yeni mekanikler (2026-11-21, kullanıcı kararları)
- Her boss yenildikten sonra oyuncu yeni bir **mekaniğe** ulaşabilmeli.
- **Mekaniklere kullanıcı karar verecek.** Claude'un önerdiği liste (sağanak, şimşek, gölet, gökkuşağı) beğenilmedi; öneri yapılmayacak.
- Mekanik **yetenek ağacında** açılır. Boss'u yenmek mekaniği otomatik vermez; yalnızca ağaçtaki ilgili düğümün **satın alma kilidini** açar.
  Düğüm boss yenilene kadar kilitli görünür (hangi boss'un açtığı belli olur), yenilince parayla alınabilir hâle gelir.
- **Dengeleme** mekanikler eklendikten sonra yapılacak; mekanikler oynanışı hızlandıracağı için tempo hedefi o zaman belirlenecek.

## 14. Run yapısı v2 (2026-11-22, kullanıcı kararları)
Kaynak: kullanıcının yapılacaklar listesi (kritik, combo, özel upgrade, run içi kart seçimi, boss düzeni, zorlaşan yeşerme).
- **Sayı gösterimi (hibrit):** yüzde yalnızca şans/ihtimal içeren yerlerde ("%10 ihtimalle ..."). Altın, hasar, su, adet gibi sabit değerler tam sayı. × çarpanlar kalır.
- **Çiçekler sınırlı, hepsi baştan sahada:** çiçek sayısı belirgin şekilde artar ama açan çiçeğin yerine otomatik yenisi çıkmaz. Yeni çiçek yalnızca şansa bağlı özelliklerle (upgrade/kart) gelir. Bu, boss'a ikinci bir kapı olur: önce güçlendirme gerekir.
- **Boss barı:** hem yeşerme hem çiçek doldurur. Yeşeren hücrenin puanı bölümün ihtiyacına göre ölçeklenir: **tüm alanın toplamı barın %30'u** eder (sınır/kesme yok, oran). Kalan %70 çiçeklerden gelir; çiçeksiz boss'a ulaşılamaz.
- **Süre:** run 30 sn ile başlar, güçlendirmelerle ~90 sn'ye çıkabilir. Upgrade fikri: çiçek açtığında belirli bir ihtimalle süre eklenir.
- **Erken bitiş (Claude önerisi, itiraz edilmedi):** süre, su veya çiçek hangisi önce biterse run biter; çiçek bitince boş bekleme olmaz.
- **Kalan su:** run sonunda kalan su toprağa dökülür, yeşeren her alan çok az altın verir (ör. 1). Ağaçta geliştirilebilir ama hiçbir zaman çiçek sulamaktan kârlı olmaz.
- **3. boss (Dev Ayçiçeği):** gölge/ısı döngüsü çok uzun ve sıkıcı. Mekanik baştan değişecek.
- **Boss fikir havuzu (3 fikir, 3 farklı boss'ta kullanılacak; hangisi hangi boss'a, sonra karar):**
  1. *Güneşe dönen baş:* baş yavaşça döner, yalnızca arkasından (gölge tarafı) sulanınca hasar alır; bulutla etrafında dolaşılır, ısı barı yok.
  2. *Tohum saçma:* boss çevresine tohum saçar, fidana dönüşür; fidanları açtırmak boss'a hasar verir (combo/zincir ile uyumlu).
  3. *Kısa aşamalar:* tek uzun döngü yerine 3 kısa aşama, her birinde farklı hareket; toplam süre kısa.
- **Yeni combo:** süre penceresi kalkar. Combo, **aynı anda sulanan** bitkilerden gelir (önce açan bitki cezalandırılmaz). Çarpan güçlendirmelerle artar; mini bulutlar ve aynı anda sulama özellikleriyle beslenir.
- **Sıradaki konular:** seviye atlayınca kart seçimi (seviye sulanan çiçek sayısına bağlı, boss'tan önce 2-3 seviye), kritik (çiçek çevresindeki noktalar ve/veya sulama sonrası hızlanma + yeşillik bonusu), seviye başına zorlaşan yeşerme.

## 15. Çiçek ihtimali + ilerleme puanı (2026-11-22, kullanıcı kararları)
- Run başında **10 kaktüs**; başka çiçek garanti değil. "Tohum" düğümleri bitki sayısını artırır.
- Her çiçeğin bir **ihtimali** var: yerleşen bitki, en değerli çiçekten başlayarak zar atar; tutmazsa kaktüs.
  Boss'la açılan çiçek bir başlangıç ihtimaliyle gelir (lale/gül/ayçiçeği %10); ağaçta her çiçek için "+%10 ihtimal" düğümü var (papatya dahil).
- Her çiçek bara bir öncekinden fazla puan verir: kaktüs 1, papatya 2, lale 3, lavanta 4, çan 5, gül 6, ayçiçeği 7, gök zambağı 10.
- Boss için gereken çiçek puanı: temel × çarpan (15 × 2^(bölüm−1) → 15, 30, 60). Barın %70'i bu puandan, %30'u yeşermeden.
- Sayılar dengelemede ayarlanacak.

## 16. Zorlaşan yeşerme + yeni fidan (2026-11-22, kullanıcı kararları)
- Yeşerme her bölümde zorlaşır: hücre başına gereken su ve tam yeşillik × 1.7^(bölüm−1) (2. bölüm 1.7×, 3. bölüm ~2.9×). Zemine giden yağmur 1.5×'ten 1.2×'e indi.
- "Tohum" düğümü: seviye başına +5 bitki (5 seviye). "Tohum Rüzgarı" da +5 bitki.
- Tohum'a bağlı ayrı düğüm "Filizlenme": açan çiçek seviye başına +%1.5 ihtimalle yeni fidan bırakır (5 seviye, en fazla %7.5). "Tohum Kümesi" artık Filizlenme'nin altında.
- (2026-11-22, revize) Yağmurla yeşerme tüm bölümlerde belirgin yavaşladı (zemine giden yağmur 1.2× → 0.5×). Çiçek açınca yeşeren küçük alan değişmedi.

## 17. Crit (big drop) and golden flowers (2026-11-23)
- **Big drop:** while raining the cloud drops one visible big drop every 0.6 s (Damla Sıklığı: −0.1 s per level, min 0.3 s)
  onto a random growing plant or open boss part under the rain. Each landing rolls the crit chance (base %5, Kritik +%5).
- **Crit = a jump, not an instant bloom:** adds `rain strength × (2 s + Ağır Damla s)` of water at once. Tied to rain,
  not to the flower's need, so flower water needs can change later and boss parts get a fair, small push
  (shield/shade bosses only take it when normal rain would count).
- **Golden flower:** any type; each placed plant rolls %1 (Altın Tohum +%1). Drawn fully gold with a sparkle.
  Pays its own coins × 5 (Altın Değer +×2); bar progress as a normal flower. One shared branch, not per flower.
- Old "Altın Gül" node renamed "Gül Bahçıvanı" to avoid confusion.

## 18. Etkileşim özellikleri (2026-11-23, kullanıcı kararları)
- Çiçek özellikleri (lavanta kombo ×2, çan suyu, ayçiçeği 2. açış, gök zambağı solması) şimdilik kaldırıldı.
- Su Sekmesi: açan çiçek ihtimalle en yakın çiçeğe/çiçeklere su sektirir (zincirlenebilir).
- Kök Bağı: run başında uzak iki çiçek bağlanır; biri yağmurdayken diğeri de sulanır. Komboya sayılmaz.
- Bulutçuk: kendi kendine en yakın çiçeğe giden, deposuz mini bulut. Komboya sayılmaz, kritik yok.
- Nemli Toprak: yeşil zemindeki çiçekler kendiliğinden yavaşça sulanır.
- Ani Yağmur: 20 sn'de bir (Sık Yağmur ile en az 12 sn) rastgele bir çiçeğin üstüne uyarılı kısa bir sağanak.
  Merkez seçilen çiçekten r×0.25–0.55 kaydırılır (rastgele görünsün, çiçek yine içeride).
- Denge sonra: önce tüm özellikler eklenecek (kullanıcı kararı).

## 19. Büyüyen bahçe: aşamalar (2026-11-23, kullanıcı kararları)
- Bölümler kalıyor. Her run 3 aşama: bar her dolduğunda "uzaklaşma" olur; 3. dolumda boss sahanın ortasında belirir.
- Uzaklaşmada saha aynı boyda kalır (bulut da aynı boy): eski sulanan alan ortada küçük yeşil bir çekirdek olur,
  eski çiçekler silinir, yeni ve daha kaliteli çiçekler gelir. Bar sıfırlanır, gereksinim artar, süreye ekleme gelir,
  su aynen devam eder. Bar dolmazsa run biter; tekrar 1. aşamadan başlanır.
- Önemli olan his: kamera geri çekiliyormuş, bahçe büyüyormuş, bulut büyüyormuş gibi görünmeli.
- Kart seçimi bu molaya eklenecek (sonraki adım).
