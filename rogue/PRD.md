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
