# Yağmur Fırtınası – Katman 1 demosu

Tasarım dökümanındaki (`../Yağmur Fırtınası – Incremental Oyun Tasarım Taslağı.docx`) Katman 1'in oynanabilir taslağı.

## Çalıştırma

`index.html` dosyasına çift tıkla. Kurulum ya da internet gerekmez; break_eternity.js `lib/` içinde.

Kısayollar: `M` hepsini al · `1`–`8` kademeyi 10'a tamamla · `N` Nem (en fazla) · `B` Basınç Düşüşü.
Damla/sn yazısının üzerine gelince üretimin hangi çarpandan ne kadar geldiği açılır.
Yazı tipleri (Geist, JetBrains Mono) Google Fonts'tan gelir; internet yoksa sistem yazı tipine düşer.
Ayarlar sekmesinde test hızı (×10 / ×100), kayıt dışa/içe aktarma ve sıfırlama var.

## Dosyalar

- `js/core.js`: oyun mantığı (DOM'suz). Tüm denge sabitleri en üstteki `C` nesnesinde.
- `js/planet.js`: gezegen çizimi. Piksel bazlı küre: kıta ve bulut dokuları 3B gürültüden üretilir, bulut haritası alan ağırlıklı sıralanır (kaplama %40 ise yüzeyin %40'ı bulut). Fırtına aşamasından itibaren siklon gözü, %90'dan sonra kararma.
- `assets/`: Figma tasarımından (RainDrop İnc.) indirilen ikonlar ve logo.
- `js/themes.js`: gezegen temaları (Okyanus, Buz, Çöl, Gaz devi). Renkler `İnspo/` paletlerinden türetildi; Ayarlar > Gezegen teması ile önizlenir.
- `js/planets.js`: gezegen sistemi için yükleme kontrolü (mantık `core.js` içinde). Sözleşme: `PLANETS_SPEC.md`. Buz (Erit), Çöl (buharlaşma, Gölge, Bulut Kalkanı), Gaz devi (basınç, Boşalt); zincirle açılır (önceki gezegen tamamlanınca), açma gezegenin kendi ekranında.
- `js/ui.js`: arayüz (Figma tasarımına göre), Şimşek ağacı (kaydırılıp yakınlaştırılabilen dallanan yıldırım, 26 düğüm + gezegen dalları (gezegen açılınca görünür)), eylem geri bildirimleri (yüzen +N, satır parlaması, gezegen dalgaları).
- `js/main.js`: oyun döngüsü, kayıt, çevrimdışı ilerleme, kısayollar.
- `sim/simulate.js`: denge simülasyonu (Okyanus).
- `sim/planets.js`: tüm Katman 1 (gezegenler + Doygunluğu Kır) zaman çizelgesi: `node sim/planets.js 16`.

## Denge simülasyonu

```
node sim/simulate.js 10 1
```

Bot her saniye "hepsini al" yapar, Cephe ya da Basınç Düşüşü alabiliyorsa alır, fırtına koparır ve ağaçta en ucuz düğümü seçer.
Dördüncü argümanla sabitler denenir: `node sim/simulate.js 1 1 "{\"NEM_GAIN\":0.1}"`. `NOCEPHE=1` verilirse bot Cephe kullanmaz.

## Dökümandan sapan / eklenen kararlar

| Konu | Döküman | Demo | Neden |
|---|---|---|---|
| Nem etkisi | %11 | %8 | %11'de bot İlk Fırtına'ya 19 dk'da ulaşıyor (hedef 30–60) |
| Hava Cephesi koşulu | 80 Kasırga | 40 (+20 her Cephe) | 80 Kasırga ≈ 1e129 damla, 1e100'den önce erişilemiyor |
| Cephe etkisi | "Nem güçlenir" | her Cephe Nem etkisini +%100 artırır | daha zayıfken reset zarar ettiriyordu |
| ??? butonu | — | yalnızca ilk fırtınada; sonra adıyla kilitli "Fırtına" butonu | oyuncu artık ne olduğunu biliyor |
| Yıldırım | açık soru | 390 sn ± 120 sn (270–510 sn, saniye cinsinden rastgele), 10 sn görünür, tıklanınca 15 sn ×5; sıradaki süre gösterilmez | kararlaştırıldı |
| Kıvılcım | açık soru | üretim ×2, Şimşek ×3 | kararlaştırıldı |
| Çevrimdışı | açık soru | tam süre (otomatikler de çalışır, yıldırım düşmez) | kararlaştırıldı |

Sim sonucu (bot): İlk Fırtına ~36 dk (Cephe'siz ~55 dk). Sonraki turlar 19, 16, 15, 13, 7… dakikaya iniyor.
Şu an Ç'yi artıran tek düğüm Kıvılcım; o yüzden fırtına başına kazanç 3 civarında kalıyor. Dökümandaki 1, 3, 5, 10, 30 eğrisi için ağaca Ç düğümleri eklenmeli.
