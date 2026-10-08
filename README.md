# Faminder

Aile rutinlerini salondaki veya koridordaki tablette seslendiren uygulama. React yönetim paneli, Node.js API, MongoDB ve React Native / Expo tablet uygulaması aynı npm workspace içinde bulunur.

## Başlangıç

Node.js 24 LTS ve npm gerekir (`.nvmrc` hazırdır). Komutları depo kökünde çalıştırın.

```sh
npm ci
cp .env.example .env
npm run dev
```

Mevcut yerel `.env` dosyası varsa üzerine yazmayın. MongoDB bilgileri burada tutulur; Git'e dahil edilmez. `GEMINI_API_KEY` yalnızca Vercel ortam değişkenlerine eklenebilir; yerel demo için gerekli değildir.

- Yönetim paneli: http://localhost:5173
- Örnek aileyle etkileşimli demo: http://localhost:5173/demo
- API sağlık kontrolü: http://localhost:3001/api/health
- MongoDB bağlantı kontrolü: `npm run db:check`

Demo verileri yalnızca tarayıcıda saklanır. Gerçek hesapla karışmaz, ses üretmez veya tablet bağlamaz. Ana sayfadan aile hesabınızı oluşturabilirsiniz.

## Hazır olan akışlar

- Hesap oluşturma, oturum açma ve aileye özel veriler.
- Aile üyeleri; günlük, haftanın belirli günlerinde veya tek seferlik rutinler.
- Türkçe metin, ses, konuşma tarzı, saat dilimi ve sessiz saat ayarları.
- Her rutin için en fazla iki ön hatırlatma; 1–1440 dakika önce, kişiye ve kalan süreye göre otomatik metin ve panelde duyuru önizlemesi.
- Hatırlatıcıları metin olarak eşitleme; ilk okuma anında Gemini ile sese çevirme.
- Sunucuda ses saklamadan, üretilen WAV dosyalarını tablette önbelleğe alma.
- Tablet için 10 dakika geçerli 6 haneli eşleştirme kodu ve cihaz iptali.
- Tablette SQLite programı ve yerel zamanlayıcı. Daha önce üretilmiş sesler çevrimdışı çalar; yeni metnin ilk okuması internet gerektirir.
- Seslendirme, tamamlandı, 5 dakika erteleme ve geçmiş kayıtları.
- Metin değişikliklerini hemen uygulama; değişen metne eski sesi kullanmama ve yinelenen duyuruları engelleme.

## Vercel

**Tek Vercel projesi** paneli ve Node.js API'yi birlikte yayınlar. Root Directory depo kökü (`.`), Framework Preset **Other** olmalıdır. `vercel.json` build ve yönlendirmeleri içerir.

Ortam değişkenleri, ilk yayın ve cihaz eşleştirme adımları için [Vercel kurulumu](docs/VERCEL.md).

## Tablet

```sh
cp apps/tablet/.env.example apps/tablet/.env
npm run tablet
```

`EXPO_PUBLIC_API_URL` değerini `https://PROJENIZ.vercel.app/api` olarak ayarlayın. Yerel API kullanırken `localhost` yerine bilgisayarın tabletin erişebildiği LAN IP'si gerekir.

Android APK, EAS kurulumu ve duvar tableti ayarları için [tablet kurulumu](docs/TABLET.md).

## Kontroller

```sh
npm test
npm run typecheck
npm run build
cd apps/tablet
npx expo install --check
npx expo export --platform android --output-dir dist
```

Testler gerçek Atlas verisini değiştirmez. API testleri geçici MongoDB başlatır ve Gemini yanıtını taklit eder. [Doğrulama kapsamı](docs/VALIDATION.md), [mimari ve davranışlar](docs/ARCHITECTURE.md).

## Dizinler

| Dizin             | İçerik                                             |
| ----------------- | -------------------------------------------------- |
| `apps/admin`      | React / Vite yönetim paneli                        |
| `apps/api`        | Express API, kimlik doğrulama ve Gemini TTS geçidi |
| `apps/tablet`     | React Native / Expo duvar uygulaması               |
| `packages/shared` | Ortak tipler, doğrulama ve saat dilimi hesapları   |
| `api/index.ts`    | Vercel Function giriş noktası                      |

Bu sürüm ön planda, ekran açık çalışır. Uygulama kapalıyken alarm, Android cihaz yönetimiyle otomatik açılış ve kilitli kiosk modu bu sürümün kapsamı dışındadır. Fiziksel tablette uzun süreli çalışma testi ve gerçek Gemini ses denemesi yapılmalıdır.
