# Yetenek ağacı v2 + çiçek kadrosu (tasarım, 2026-11-17)

Kapsam: yeni 8 çiçek, 32 düğümlü ağaç (6 dal), gereken kod değişiklikleri, ekonomi kontrolü.
Kurallar: oyuncuya görünen hiçbir yerde yüzde yok. Tüm stat'lar düz sayı. Çarpanlar `×` ile gösterilir.
Tüm sayılar bir simülasyonla kontrol edildi (§4). Ağaç verisi de doğrulandı: id'ler tekil, her ebeveyn mevcut,
aynı hücrede iki düğüm yok, her çocuk ebeveynine komşu (çapraz dahil), çizgiler kesişmiyor, her `stat` `base` içinde var,
metinde `%` yok.

---

## 1. Çiçekler (8 tür)

| id | Ad | Su | Para | Haritada nasıl çıkar | Özellik (oyuncu metni) |
|---|---|---|---|---|---|
| `cactus` | Kaktüs | 2 | 1 | hep var (dolgu, ağırlık 65) | – |
| `daisy` | Papatya | 6 | 3 | hep var (dolgu, ağırlık 35) | – |
| `tulip` | Lale | 8 | 5 | **Lale Tarhı**: haritada +1 lale (en fazla 3) | – |
| `lavender` | Lavanta | 6 | 3 | **Lavanta**: haritada +1 (en fazla 2) | "Kombo içinde açarsa ×2 para" |
| `bluebell` | Çan Çiçeği | 8 | 2 | **Çan Çiçeği**: haritada +1 (en fazla 2) | "Açınca buluta +5 su" |
| `rose` | Gül | 12 | 8 | baştan 1 tane, **Gül Bahçesi** ile +1 (en fazla 4) | Altın Gül: her gül +5 para |
| `sunflower` | Ayçiçeği | 14 | 7 | **Ayçiçeği**: haritada +1 (en fazla 2) | "İki kez açar". Altın Polen: ×2 para |
| `skylily` | Gök Zambağı | 36 | 30 | **Gök Zambağı**: haritada +1 (en fazla 2) | "Yağmur almazsa 3 su/sn kaybeder" |

- Dolgu çiçekleri (kaktüs, papatya) iç ağırlıkla seçilir ve bu oyuncuya hiç gösterilmez (bugünkü `daisyChance` ile aynı mantık).
  Diğer çiçekler **adetle** tutulur: büyüyen sayısı hedef adedin altına düşünce yerine yenisi çıkar.
- Özellikler kasıtlı olarak az: 3 küçük kural ve 1 solma kuralı. Her biri §3'te tek satırlık bir formül.
- Okunurluk (~48 px, yukarıdan 3/4 açı): her çiçeğin ayrı bir **renk ailesi** ve ayrı bir **silüeti** var.
  Fıçı/top, düz disk, kupa, dikey başak, sarkık çanlar, katlı gül, büyük disk ve uzun yıldız.

### Görsel brief (Stable Diffusion, DreamShaper XL)

Ortak ön ek (her prompt'un başına):
`game sprite, single plant, top-down three-quarter view, centered, soft painterly style, muted dusk palette, clean readable silhouette, plain flat light background, no text`
Ortak negatif: `photo, realistic, neon, glow, bloom lighting, multiple plants, pot, frame, text, watermark, busy background, harsh shadow`

| Çiçek | Silüet / renk (sap `color`, çiçek `bloom`) | Tomurcuk (bud) prompt | Açmış (bloom) prompt |
|---|---|---|---|
| Kaktüs | Kısa, yuvarlak fıçı kaktüs; adaçayı yeşili `#7a9e6a`, safran çiçekler `#f2c14e` | `small round barrel cactus, sage green ribs, tiny closed yellow nub on top` | `small round barrel cactus, sage green ribs, crown of small saffron yellow flowers on top` |
| Papatya | Alçak yaprak rozeti + tek düz beyaz disk; `#8cb488` / krem `#f3ede2` | `low rosette of soft green leaves, one tight green bud with white tips` | `low rosette of leaves, one large flat white daisy facing up, warm yellow center` |
| Lale | İki geniş yaprak + yumurta/kupa; `#6f9e6a` / kiremit turuncu `#e07a4f` | `two broad green leaves, one closed egg-shaped coral tulip bud` | `two broad green leaves, one open cup-shaped terracotta orange tulip` |
| Lavanta | İnce dikey başaklar (3–5); gri-yeşil `#7f9c86` / leylak `#a58ad0` | `cluster of thin grey-green stems with closed pale green flower spikes` | `cluster of thin stems topped with lilac purple lavender spikes, vertical` |
| Çan Çiçeği | Kavisli sap + sarkık 3 çan; `#6e9a7a` / peygamber mavisi `#6f93d6` | `arching green stem with three closed pale blue teardrop buds` | `arching stem with three drooping cornflower blue bell flowers, a water droplet on one bell` |
| Gül | Küçük çalı + katlı gül başı; `#6a9a66` / koyu gül pembesi `#d65c7a` | `small leafy rose bush, one tight dusky pink rosebud` | `small leafy rose bush, one open layered deep rose pink rose` |
| Ayçiçeği | Uzun sap, büyük yapraklar, iri disk; `#78a05e` / altın sarısı `#e9b23c` | `tall sunflower stalk with big leaves, closed green star-shaped bud` | `tall sunflower stalk, one large golden sunflower head with brown center, facing up` |
| Gök Zambağı | İnce uzun sap + 6 köşeli yıldız; `#5f8e86` / gece mavisi `#4d5fa8` | `slender tall stem, long closed indigo spear-shaped lily bud` | `slender tall stem, six-pointed star lily, deep indigo petals with pale silver edges` |

Not: Ayçiçeğinin ilk açılışından sonra tomurcuk sprite'ı tekrar kullanılabilir.
Gök Zambağı solarken (su azalırken) sprite biraz soluklaştırılabilir. Bu isteğe bağlı.

---

## 2. Yetenek ağacı v2

Kök **Bulut** (0,0). Altı dal farklı yönlere açılıyor. 32 düğüm (+kök), toplam 99 seviye.
Tüm ağacın maliyeti yaklaşık **772 bin para**.

```
 sütun   -6        -5        -4        -3        -2        -1        0         1          2          3          4
  -3                                                     Verimli   Çiy       F.Gözü
  -2                                                     Sızdırm.  B.Depo    Şimşek     G.Gürült.  Sağanak
  -1               A.Polen             A.Gül     Kombo             Depo      KaraBulut
   0     G.Zambağı Ayçiçeği  ÇanÇiçeği G.Bahçesi Tohum     Bereket   [BULUT]   Y.Alanı    Y.Şiddeti  BolYağmur  Y.Toprak
   1                         Lavanta   LaleTarhı           Rüzgar    İlkbahar             GenişBulut
   2                                             F.Rüzgarı T.Rüzgarı Yaz
   3                                                                 UzunYaz
```

| Dal (`branch`) | Yön | Rol |
|---|---|---|
| Su (`water`) | yukarı | depo, buharlaşma, çiy. Erken oyunun ana sınırı. |
| Fırtına (`storm`) | sağ-yukarı | geç oyun: × para çarpanı, kombo tavanı/adımı, şiddet. Pahalı. |
| Yağmur (`rain`) | sağ | alan, şiddet, Yumuşak Toprak (her çiçek −1 su ister) |
| Mevsim (`time`) | aşağı | +1 / +2 / +3 sn. Pahalı, toplam en fazla **+10 sn** |
| Rüzgar (`wind`) | sol-aşağı | hız, Tohum Rüzgarı (+2 bitki) |
| Bereket (`bounty`) | sol | para, bitki sayısı, kombo süresi ve **bütün çiçek açılımları** |

Yeniden kullanılan id'ler (kayıt korunur): tank, tank2, seal, dew, thrift, radius, flow, radius2, flow2, bounty, seeds,
combo, rare, gold, wind, gust, time1, time2, time3. `radius2`'nin adı "Geniş Bulut" oldu, çünkü "Sağanak" artık Fırtına dalında.

### config.js'e yapıştırılacak veri

```js
    base: {
      tank: 100,           // water at run start
      rainRadius: 40,      // px
      rainRate: 3,         // "Yağmur şiddeti": water/s to EACH plant under the rain
      cloudSpeed: 4,       // level; px/s = cloudSpeed * speedPx (main.js)
      coinBonus: 0,        // extra coins on every bloom
      roseBonus: 0,        // extra coins on every rose
      coinMul: 1,          // NEW: global coin multiplier (×), Fırtına branch
      sunflowerMul: 1,     // NEW: sunflower coin multiplier (×), Altın Polen
      plantCount: 10,      // plants alive on the field at once
      roseCount: 1,        // roses kept on the field
      tulipCount: 0,       // NEW: tulips kept on the field
      lavenderCount: 0,    // NEW
      bluebellCount: 0,    // NEW
      sunflowerCount: 0,   // NEW
      skylilyCount: 0,     // NEW
      needReduce: 0,       // NEW: water need removed from every plant (min 1)
      comboWindow: 1.5,    // s
      comboStep: 0.25,     // NEW (was CONFIG.combo.step)
      comboMax: 3,         // NEW (was CONFIG.combo.max)
      dew: 0,              // water refunded per bloom
      timeBonus: 0,        // s, Mevsim branch (max +10)
      drainReduce: 0,      // su/sn removed from passive drain
      rainCostReduce: 0,   // su/sn removed from rain cost
    },

    // countStat: kept on the field by count. weight: filler pick weight (internal, never shown).
    // bonusStat: flat coins added for this type. mulStat: × for this type.
    // comboX: × when bloomed while combo > 1. refund: su back on bloom. rebloom: extra blooms. wilt: su/s lost when not rained on.
    plants: {
      cactus:    { label: 'Kaktüs',      need: 2,  coins: 1,  color: '#7a9e6a', bloom: '#f2c14e', weight: 65 },
      daisy:     { label: 'Papatya',     need: 6,  coins: 3,  color: '#8cb488', bloom: '#f3ede2', weight: 35 },
      tulip:     { label: 'Lale',        need: 8,  coins: 5,  color: '#6f9e6a', bloom: '#e07a4f', countStat: 'tulipCount' },
      lavender:  { label: 'Lavanta',     need: 6,  coins: 3,  color: '#7f9c86', bloom: '#a58ad0', countStat: 'lavenderCount', comboX: 2 },
      bluebell:  { label: 'Çan Çiçeği',  need: 8,  coins: 2,  color: '#6e9a7a', bloom: '#6f93d6', countStat: 'bluebellCount', refund: 5 },
      rose:      { label: 'Gül',         need: 12, coins: 8,  color: '#6a9a66', bloom: '#d65c7a', countStat: 'roseCount', bonusStat: 'roseBonus' },
      sunflower: { label: 'Ayçiçeği',    need: 14, coins: 7,  color: '#78a05e', bloom: '#e9b23c', countStat: 'sunflowerCount', mulStat: 'sunflowerMul', rebloom: 1 },
      skylily:   { label: 'Gök Zambağı', need: 36, coins: 30, color: '#5f8e86', bloom: '#4d5fa8', countStat: 'skylilyCount', wilt: 3 },
    },
    // daisyChance and combo {step,max} are replaced by plants[].weight and base.comboStep/comboMax
    // (only readers: run.js _pickType and _bloom, both changed in §3).

    upgrades: [
      { id: 'core', label: 'Bulut', desc: 'Her şeyin başladığı yer', kind: 'root', max: 1, pos: [0, 0] },

      // Water / tank (up)
      { id: 'tank',      branch: 'water',  label: 'Depo',            desc: '+20 su',                   stat: 'tank',           kind: 'add', per: 20,   max: 5, baseCost: 8,     growth: 1.6,  parent: 'core',      need: 1, pos: [0, -1] },
      { id: 'tank2',     branch: 'water',  label: 'Büyük Depo',      desc: '+40 su',                   stat: 'tank',           kind: 'add', per: 40,   max: 4, baseCost: 60,    growth: 2,    parent: 'tank',      need: 3, pos: [0, -2] },
      { id: 'seal',      branch: 'water',  label: 'Sızdırmazlık',    desc: '−1 su/sn buharlaşma',      stat: 'drainReduce',    kind: 'add', per: 1,    max: 2, baseCost: 40,    growth: 2.5,  parent: 'tank',      need: 2, pos: [-1, -2] },
      { id: 'dew',       branch: 'water',  label: 'Çiy',             desc: 'Açan çiçek +1 su',         stat: 'dew',            kind: 'add', per: 1,    max: 3, baseCost: 500,   growth: 2.5,  parent: 'tank2',     need: 2, pos: [0, -3] },
      { id: 'thrift',    branch: 'water',  label: 'Verimli Yağmur',  desc: '−1 su/sn yağmur tüketimi', stat: 'rainCostReduce', kind: 'add', per: 1,    max: 4, baseCost: 100,   growth: 2.1,  parent: 'seal',      need: 1, pos: [-1, -3] },

      // Storm (up-right, late)
      { id: 'storm',     branch: 'storm',  label: 'Kara Bulut',      desc: 'Tüm para çarpanı +0.1',    stat: 'coinMul',        kind: 'add', per: 0.1,  max: 5, baseCost: 8000,  growth: 1.3,  parent: 'core',      need: 1, pos: [1, -1] },
      { id: 'lightning', branch: 'storm',  label: 'Şimşek',          desc: 'En yüksek kombo +0.25',    stat: 'comboMax',       kind: 'add', per: 0.25, max: 4, baseCost: 15000, growth: 1.35, parent: 'storm',     need: 2, pos: [1, -2] },
      { id: 'thunder',   branch: 'storm',  label: 'Gök Gürültüsü',   desc: 'Kombo adımı +0.25',        stat: 'comboStep',      kind: 'add', per: 0.25, max: 1, baseCost: 40000, growth: 1,    parent: 'storm',     need: 1, pos: [2, -2] },
      { id: 'downpour',  branch: 'storm',  label: 'Sağanak',         desc: '+1 şiddet',                stat: 'rainRate',       kind: 'add', per: 1,    max: 5, baseCost: 12000, growth: 1.3,  parent: 'thunder',   need: 1, pos: [3, -2] },
      { id: 'eye',       branch: 'storm',  label: 'Fırtına Gözü',    desc: 'Tüm para çarpanı +0.1',    stat: 'coinMul',        kind: 'add', per: 0.1,  max: 5, baseCost: 25000, growth: 1.2,  parent: 'lightning', need: 2, pos: [1, -3] },

      // Rain + soil (right)
      { id: 'radius',    branch: 'rain',   label: 'Yağmur Alanı',    desc: '+8 alan',                  stat: 'rainRadius',     kind: 'add', per: 8,    max: 4, baseCost: 10,    growth: 1.7,  parent: 'core',      need: 1, pos: [1, 0] },
      { id: 'flow',      branch: 'rain',   label: 'Yağmur Şiddeti',  desc: '+1 şiddet',                stat: 'rainRate',       kind: 'add', per: 1,    max: 4, baseCost: 16,    growth: 1.8,  parent: 'radius',    need: 1, pos: [2, 0] },
      { id: 'radius2',   branch: 'rain',   label: 'Geniş Bulut',     desc: '+12 alan',                 stat: 'rainRadius',     kind: 'add', per: 12,   max: 3, baseCost: 200,   growth: 2.2,  parent: 'radius',    need: 3, pos: [2, 1] },
      { id: 'flow2',     branch: 'rain',   label: 'Bol Yağmur',      desc: '+2 şiddet',                stat: 'rainRate',       kind: 'add', per: 2,    max: 3, baseCost: 500,   growth: 2.3,  parent: 'flow',      need: 3, pos: [3, 0] },
      { id: 'soil',      branch: 'rain',   label: 'Yumuşak Toprak',  desc: 'Her çiçek −1 su ister',    stat: 'needReduce',     kind: 'add', per: 1,    max: 2, baseCost: 12000, growth: 2.5,  parent: 'flow2',     need: 2, pos: [4, 0] },

      // Seasons / time (down): hard cap +10 s total (3×1 + 2×2 + 1×3)
      { id: 'time1',     branch: 'time',   label: 'İlkbahar',        desc: '+1 sn run süresi',         stat: 'timeBonus',      kind: 'add', per: 1,    max: 3, baseCost: 150,   growth: 2.5,  parent: 'core',      need: 1, pos: [0, 1] },
      { id: 'time2',     branch: 'time',   label: 'Yaz',             desc: '+2 sn run süresi',         stat: 'timeBonus',      kind: 'add', per: 2,    max: 2, baseCost: 6000,  growth: 2.5,  parent: 'time1',     need: 3, pos: [0, 2] },
      { id: 'time3',     branch: 'time',   label: 'Uzun Yaz',        desc: '+3 sn run süresi',         stat: 'timeBonus',      kind: 'add', per: 3,    max: 1, baseCost: 40000, growth: 1,    parent: 'time2',     need: 2, pos: [0, 3] },

      // Wind / movement (down-left)
      { id: 'wind',      branch: 'wind',   label: 'Rüzgar',          desc: '+1 hız',                   stat: 'cloudSpeed',     kind: 'add', per: 1,    max: 4, baseCost: 10,    growth: 1.7,  parent: 'core',      need: 1, pos: [-1, 1] },
      { id: 'gust',      branch: 'wind',   label: 'Fırtına Rüzgarı', desc: '+2 hız',                   stat: 'cloudSpeed',     kind: 'add', per: 2,    max: 2, baseCost: 400,   growth: 2.5,  parent: 'wind',      need: 3, pos: [-2, 2] },
      { id: 'windseed',  branch: 'wind',   label: 'Tohum Rüzgarı',   desc: '+2 bitki',                 stat: 'plantCount',     kind: 'add', per: 2,    max: 2, baseCost: 3000,  growth: 2,    parent: 'wind',      need: 2, pos: [-1, 2] },

      // Bounty + flowers (left): every flower unlock lives here
      { id: 'bounty',    branch: 'bounty', label: 'Bereket',         desc: 'Her çiçek +1 para',        stat: 'coinBonus',      kind: 'add', per: 1,    max: 5, baseCost: 14,    growth: 1.8,  parent: 'core',      need: 1, pos: [-1, 0] },
      { id: 'seeds',     branch: 'bounty', label: 'Tohum',           desc: '+2 bitki',                 stat: 'plantCount',     kind: 'add', per: 2,    max: 4, baseCost: 25,    growth: 2,    parent: 'bounty',    need: 1, pos: [-2, 0] },
      { id: 'combo',     branch: 'bounty', label: 'Kombo',           desc: '+0.5 sn kombo süresi',     stat: 'comboWindow',    kind: 'add', per: 0.5,  max: 4, baseCost: 60,    growth: 2.2,  parent: 'bounty',    need: 2, pos: [-2, -1] },
      { id: 'tulip',     branch: 'bounty', label: 'Lale Tarhı',      desc: 'Haritada +1 lale',         stat: 'tulipCount',     kind: 'add', per: 1,    max: 3, baseCost: 40,    growth: 2.2,  parent: 'seeds',     need: 1, pos: [-3, 1] },
      { id: 'lavender',  branch: 'bounty', label: 'Lavanta',         desc: 'Haritada +1 lavanta',      stat: 'lavenderCount',  kind: 'add', per: 1,    max: 2, baseCost: 1000,  growth: 2,    parent: 'tulip',     need: 2, pos: [-4, 1] },
      { id: 'rare',      branch: 'bounty', label: 'Gül Bahçesi',     desc: 'Haritada +1 gül',          stat: 'roseCount',      kind: 'add', per: 1,    max: 3, baseCost: 90,    growth: 2.3,  parent: 'seeds',     need: 2, pos: [-3, 0] },
      { id: 'gold',      branch: 'bounty', label: 'Altın Gül',       desc: 'Her gül +5 para',          stat: 'roseBonus',      kind: 'add', per: 5,    max: 3, baseCost: 1200,  growth: 2,    parent: 'rare',      need: 2, pos: [-3, -1] },
      { id: 'bluebell',  branch: 'bounty', label: 'Çan Çiçeği',      desc: 'Haritada +1 çan çiçeği',   stat: 'bluebellCount',  kind: 'add', per: 1,    max: 2, baseCost: 700,   growth: 2,    parent: 'rare',      need: 1, pos: [-4, 0] },
      { id: 'sunflower', branch: 'bounty', label: 'Ayçiçeği',        desc: 'Haritada +1 ayçiçeği',     stat: 'sunflowerCount', kind: 'add', per: 1,    max: 2, baseCost: 6000,  growth: 2,    parent: 'bluebell',  need: 1, pos: [-5, 0] },
      { id: 'pollen',    branch: 'bounty', label: 'Altın Polen',     desc: 'Ayçiçeği ×2 para',         stat: 'sunflowerMul',   kind: 'add', per: 1,    max: 1, baseCost: 30000, growth: 1,    parent: 'sunflower', need: 2, pos: [-5, -1] },
      { id: 'skylily',   branch: 'bounty', label: 'Gök Zambağı',     desc: 'Haritada +1 gök zambağı',  stat: 'skylilyCount',   kind: 'add', per: 1,    max: 2, baseCost: 20000, growth: 2,    parent: 'sunflower', need: 1, pos: [-6, 0] },
    ],
```

Tam ağaçtaki son değerler: depo 360, alan 108, şiddet 19, hız 12, bitki 22, kombo süresi 3.5 sn, kombo ×4 (adım 0.5),
para çarpanı ×2, buharlaşma 0, yağmur tüketimi 4 su/sn, ek süre +10 sn. Adetle tutulan çiçeklerin toplamı en fazla 15
(gül 4, lale 3, lavanta 2, çan 2, ayçiçeği 2, zambak 2). Bitki sayısı en fazla 22, yani dolgu çiçeklere hep yer kalır.

---

## 3. Kod değişiklikleri (lead için)

**run.js**
1. **Su ihtiyacı:** spawn'da `need = Math.max(1, cfg.need - s.needReduce)`.
2. **Tür seçimi (`_pickType`):** `C.plants` sırasıyla dolaş. `cfg.countStat` olan her tür için, büyüyen sayısı `< s[cfg.countStat]` ise o türü döndür.
   Hiçbiri değilse `weight > 0` olan dolgu türlerden ağırlıklı rastgele seç. `rose`'a özel kod kalkar. Spawn'da `bloomsLeft = 1 + (cfg.rebloom || 0)` ayarla.
3. **Kombo:** `combo = min(s.comboMax, combo + s.comboStep)` (`C.combo` yerine stats).
4. **Para:**
   `flat = cfg.coins + s.coinBonus + (cfg.bonusStat ? s[cfg.bonusStat] : 0)`
   `mul  = combo × s.coinMul × (cfg.mulStat ? s[cfg.mulStat] : 1) × (cfg.comboX && combo > 1 ? cfg.comboX : 1)`
   `gain = max(1, round(flat × mul))`. Lavanta için popup'ta "×2" göstermek isteyebilirsin. Bunun için event'e `mul` eklenebilir.
5. **Su iadesi:** açılışta `water = min(tank, water + s.dew + (cfg.refund || 0))`.
6. **İki kez açma:** parayı ve event'i normal işle. Sonra `if (--p.bloomsLeft > 0) { p.water = 0; /* state 'growing' kalır, respawn eklenmez */ }`.
   Değilse bugünkü `bloomed` + respawn akışı devam eder. Event'e `rebloom: true` eklenebilir (render bitkiyi tomurcuğa döndürür).
7. **Solma:** sulama döngüsünde, bu karede yağmur altında olmayan her büyüyen bitki için `if (cfg.wilt) p.water = max(0, p.water - cfg.wilt × dt)`.

**main.js / config modes (Artan Buharlaşma):** Mevcut kurallarla (ramp 1, gecikme 4 + tüm ek süre) tam ağaçta evap run'ı yaklaşık **49 sn** sürüyor.
Yine de her zaman bitiyor, ama hedefin çok üstünde. Öneri (A): `evap: { evapRamp: 2, rampDelay: 6 }` ve
buildRules'ta `r.rampDelay += stats.timeBonus * 0.5`. Bununla tam ağaçta run yaklaşık **34 sn** sürüyor.
Alternatif (B): ramp 2, gecikme 4, ek sürenin tamamı. Bununla yaklaşık 37 sn sürüyor ve Mevsim metni iki modda da aynı kalıyor.

**ui.js / style.css**
- `BRANCH_LABEL`: `time: 'Mevsim'`, `storm: 'Fırtına'`, `wind: 'Rüzgar'`. `BRANCH_ICON`: `wind: 'wind'` (storm zaten var).
- CSS: `.b-storm { --c: #8a96ad; }` (arduvaz mavisi), `.b-wind { --c: #b9c98a; }` (adaçayı sarısı).
- `UNIT` / `STAT_NAME` yeni stat'lar için:
  - tulipCount 'Lale', lavenderCount 'Lavanta', bluebellCount 'Çan çiçeği', sunflowerCount 'Ayçiçeği', skylilyCount 'Gök zambağı'
  - needReduce 'Su ihtiyacı' ("−0 → −1")
  - coinMul 'Para çarpanı', sunflowerMul 'Ayçiçeği çarpanı', comboMax 'En yüksek kombo', comboStep 'Kombo adımı'
- `×` formatı: `coinMul`, `sunflowerMul`, `comboMax` için "şimdi → sonra" metni `×1.3 → ×1.4` olarak gösterilsin (en fazla 2 ondalık).
- render.js: yeni türler `C.plants[type].color/bloom` ile hemen çizilebilir. Sprite'lar §1'deki brief'le gelir.

**Bitmezlik kontrolü**
- *Süre + Su:* süre sabit bir tavan, `20 + timeBonus ≤ 30 sn`. Hiçbir kombinasyon bunu aşamaz.
- *Artan Buharlaşma:* su kazancı sınırlı. Respawn sayacı açılış anında başlar ve `bloomLinger` ile paralel işler.
  Bu yüzden bir yuva `respawnDelay + need/rainRate` sürede döner: açılış hızı en fazla 22 / (0.8 + 1/19) ≈ 26 açılış/sn
  (ayçiçeğinin ikinci açılışı bunu biraz artırır). Kazanç en fazla ≈ 26 × 3 (çiy) + çan iadeleri ≈ 85–90 su/sn.
  Buharlaşma ise sınırsız büyüyor. En kötü teorik durumda (A) ile `360 + 87u − u² = 0`, buradan u ≈ 91, yani run en fazla ~100 sn.
  Mevcut kurallarla en fazla ~190 sn. Gerçekçi oyunda (simülasyon) (A) ile ~34 sn. Her durumda sonlu.

---

## 4. Ekonomi kontrolü

Yöntem: run.js mantığının sadeleştirilmiş bir kopyası. Alan 600×700. "Değer/saniye" en iyi bitkiye giden ve yalnızca altında bitki varken
yağdıran açgözlü bir bot oynuyor. Her run'dan sonra alınabilen en ucuz düğümü alıyor. Her satır 4 tohumun ortalaması.
"En yakın bitki" botu ilk run'da **11 açılış, 17 para, 14 sn** yapıyor; değer botu 3 açılış, 13 para. Gerçek oyuncu bu ikisinin arasında olur.

**Süre + Su**

| Run | Para/run | Açılış | Süre | Sınır | Bu run'a kadar ilk kez alınanlar | Toplam kazanç |
|---|---|---|---|---|---|---|
| 1 | 13–17 | 3–11 | 12–14 sn | su | Depo | 13 |
| 3 | 20 | 4 | 13.5 sn | su | Yağmur Alanı, Rüzgar | 53 |
| 6 | 48 | 9 | 16 sn | su | Bereket, Yağmur Şiddeti, Tohum | 170 |
| 10 | 230 | 23 | 20 sn | **süre** | Sızdırmazlık, Lale Tarhı | 690 |
| 20 | 1.1 bin | 48 | 22 sn | süre | Kombo, Gül Bahçesi, Verimli Yağmur, İlkbahar, Fırtına Rüzgarı, Çiy, Çan Çiçeği | 8.6 bin |
| 40 | 3.1 bin | 68 | 25 sn | süre | Lavanta (24), Altın Gül (26), Tohum Rüzgarı (33) | 51 bin |
| 60 | 4.3 bin | 68 | 25 sn | süre | Ayçiçeği (42), Kara Bulut (44), Yumuşak Toprak (50), Şimşek (60) | 126 bin |
| 100 | 8.2 bin | 79 | 27 sn | süre | Gök Zambağı (71), Fırtına Gözü (83), Altın Polen (99) | 378 bin |
| ~135 | 15 bin | 109 | 30 sn | süre | Gök Gürültüsü (112), Sağanak (113), **ağaç tamam** | 773 bin |

**Artan Buharlaşma (öneri A ile)**

| Run | Para/run | Açılış | Süre | Sınır | Not |
|---|---|---|---|---|---|
| 1 | 11–13 | 3–9 | 10–11 sn | su | Depo 1 |
| 3 | 13 | 3 | 11 sn | su | |
| 6 | 23 | 5 | 12 sn | su | Şiddet 1, Alan 2 |
| 10 | 71 | 12 | 13 sn | su | |
| 20 | 780 | 34 | 20 sn | su | Büyük Depo 3, Kombo 3 |
| 40 | 3.7 bin | 80 | 29 sn | su | İlkbahar |
| ~120 | 17.6 bin | 123 | 34 sn | su | **ağaç tamam** |

- **Güçlenme hissi:** ilk 20 run'da her run sonrası en az bir alım var. **Sapma:** 20. run'dan sonra bot run'ların ancak yarısında alım yapıyor.
  Süre modunda 3 run'dan uzun 14 alımsız ara var, en uzunu 5 run. Gerçek oyuncu daha az kazandığı için bu aralar 7–8 run'a uzayabilir.
  Çözüm kolu: tek seferlik büyük alımları (`thunder` 40 bin, `time3` 40 bin, `pollen` 30 bin) 2–3 ucuz seviyeye böl
  ya da geç dönem tekrarlı düğümlerde `growth` değerini düşür (1.2–1.3).
- **Sınırın yer değiştirmesi:** süre modunda bot yaklaşık 8–10. run'da sudan süreye geçiyor (PRD hedefi 5–6. Gerçek oyuncu biraz daha geç geçer).
- **Toplam süre:** bot ağacı 120–135 run'da bitiriyor (~35 sn run + dükkân, ~1.3 saat). Gerçek oyuncu bottan daha az verimli
  olacağı için tahmin **2–3 saat**.
- **Ayar kolları:** Fırtına dalı toplamın yaklaşık 2/3'ü (506 bin). Oyun çok uzun gelirse önce `storm/eye/downpour` `baseCost` düşürülür.
  İlk saat yavaş gelirse `tank2`/`rare`/`radius2` `baseCost` düşürülür.

---

## 5. Gerekçe

Erken düğümler (8–25 para) ilk run'ın kazancıyla alınabiliyor ve suyu büyütüyor: depo, yağmur, rüzgar. Böylece ilk run'larda sınır sudur ve her run
güçlenme hissi verir. Bereket dalı sayıyla tutulan çiçeklerle haritayı yavaş yavaş zenginleştiriyor. Her yeni çiçek bir hedef ve bir görsel
ödül. Özellikler bilinçli olarak tek kurallık: su veren çan, kombo seven lavanta, iki kez açan ayçiçeği, sulanmazsa solan zambak. Bunlar rotayı
değiştirir ama kod yükü küçüktür. Süre dalı sabit bir tavanla (+10 sn) pahalı tutuldu. Böylece orta oyunda sınır süreye kayar ve çarpanlar
devreye girer. Fırtına dalı oyuncunun sevdiği `×` hissini taşıyor: para ×2, kombo tavanı ×4, daha hızlı kombo adımı. Hepsi ucu açık değil,
sınırlı. Hiçbir statta yüzde yok. Artan Buharlaşma modu her durumda sonlu kalıyor. Hedef süre için buharlaşma ramp'ini ikiye çıkarmak önerilir.

## Lead'in karar vermesi gerekenler
1. **Kayıt:** eski id'ler korundu (ilerleme taşınır, `max` düşenler yüklemede kırpılır). Temiz denge testi için `saveKey: 'rd-rogue-v2'` önerilir.
2. **Evap kuralı:** öneri A (ramp 2, gecikme 6, ek sürenin yarısı, ~34 sn), öneri B (ramp 2, gecikme 4, ~37 sn) ya da mevcut kural (~49 sn).
3. **`rose` genellemesi:** öneri `countStat/bonusStat/mulStat` alanlarıyla genel kod. `roseCount/roseBonus` stat adları aynı kalır.
4. **Gök Zambağı solması** isteğe bağlı 4. kural. Kod yükü istenmezse `wilt` alanı silinir ve çiçek sade bir büyük ödül olur.
5. Mevsim dalının adı: UI'da `time` dalı "Zaman" yerine "Mevsim" olarak gösterilecek (BRANCH_LABEL).
6. **Geç oyun temposu:** 20. run'dan sonra alımlar 3–5 run'da bir (gerçek oyuncu için 7–8). §4'teki kol uygulansın mı?
7. İlk run'daki açılış sayısı oyun tarzına göre 3–11 arası. Bu, 5–10 hedefinin iki yanına taşıyor. Playtest ile bakılmalı.
