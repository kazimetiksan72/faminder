# Tablet kurulumu

Hedef: prize bağlı, yalnızca yatay kullanılan Android tablet veya iPad. iPad'de tam ekran zorunludur; sağ ve sol yatay yön desteklenir, dikey yönler desteklenmez. Bu ayarlar native derlemeye yazılır; yalnızca JavaScript güncellemesi yeterli değildir.

## Geliştirme

Depo kökünde `npm ci` ve `npm run build -w @faminder/shared` çalıştırın. `apps/tablet/.env.example` dosyasını aynı klasörde `.env` olarak kopyalayın:

```dotenv
EXPO_PUBLIC_API_URL=https://PROJENIZ.vercel.app/api
```

Bu adres herkese açık bir ayardır; Gemini ve MongoDB anahtarlarını buraya koymayın. Ardından kökte `npm run tablet` çalıştırın. SDK 57 ile uyumlu Expo Go veya development build kullanın. Fiziksel tablet yerel API'ye bağlanacaksa bilgisayarın LAN IP'sini yazın ve aynı ağa bağlanın; `localhost` tabletin kendisini işaret eder. Dağıtılacak APK'da HTTPS kullanın.

## Android APK

Expo hesabınızla EAS kurulumu ve ilk proje bağlantısı gerekir. Komutları `apps/tablet` klasöründe çalıştırın:

```sh
npx eas-cli login
npx eas-cli build:configure
npx eas-cli env:create --environment preview --name EXPO_PUBLIC_API_URL --value https://PROJENIZ.vercel.app/api --visibility plaintext
npx eas-cli build --platform android --profile preview
```

`eas.json` içindeki `preview` profili yüklenebilir APK üretir. `production` profili mağaza için AAB üretir; aynı API URL'sini production EAS ortamına da ekleyin. İlgili hesabın build kotası ve Android imzalama adımları EAS tarafından yönetilir. APK henüz üretilmedi.

## Kabloyla iPad kurulumu

Mac'te Xcode, CocoaPods ve geçerli bir Apple geliştirme imzası gerekir. iPad'i kabloyla bağlayın, bilgisayara güvenin ve **Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu** seçeneğini açın. Yeniden başlatmanın ardından iPad üzerindeki onayı tamamlayın.

`apps/tablet/.env.local` içinde bu cihazın erişebileceği `EXPO_PUBLIC_API_URL` değerini belirleyin. Yerel API için iPad ve Mac aynı ağda olmalıdır; Vercel yayına alındığında HTTPS adresiyle yeniden derleyin. API anahtarlarını tablet ortamına eklemeyin.

```sh
# Depo kökünde:
npm run build -w @faminder/shared
npm run ios -w @faminder/tablet -- --device --configuration Release
```

Release derlemesi JavaScript paketini uygulamaya gömer; uygulamayı açmak için Metro gerekmez. Yerel API kullanılan kurulumda Mac'teki `npm run dev` sunucusu çalışmaya devam etmelidir. İlk açılışta iPad yerel ağ erişimi isterse eşleştirme için izin verin.

Ücretsiz kişisel Apple hesabının geliştirme profili 7 gün geçerlidir; süre dolunca yeniden derleyip kurmak gerekir. Uzun süreli dağıtım için uygun Apple Developer üyeliği ve dağıtım profili gerekir.

Yön ayarları `app.json` dosyasında saklanır. Android 16'nın büyük ekranlarda yön kısıtlarını yok saymasını engelleyen API 36 uyumluluk ayarı `plugins/with-landscape.cjs` ile eklenir. Hedef API 37 veya daha yükseğe çıkarılırken bu istisna yeniden değerlendirilmelidir; [Android belgeleri](https://developer.android.com/about/versions/16/behavior-changes-16) bu istisnanın kaldırılacağını belirtir.

## İlk eşleştirme

1. Uygulamayı Android tablete veya iPad'e kurup açın.
2. Tabletin gösterdiği 6 haneli kodu panelde **Tabletler → Tablet bağla** bölümüne yazın.
3. Tablete “Salon tableti” gibi bir ad verin.
4. Metin ve programın eşitlenmesini bekleyin. Panelde metnin tablete ulaştığı görünür; ses bu aşamada üretilmez.
5. İnternet açıkken panelden birkaç dakika sonrasına bir hatırlatıcı ekleyin. Tablet zamanı gelince Node.js API üzerinden Gemini sesini alır, yerel önbelleğine kaydeder ve otomatik okur. Medya sesini cihaz ayarlarından ayarlayın.

Kod 10 dakika geçerlidir; süresi dolunca kendiliğinden yenilenir. Bağlantı hatalarında tablet otomatik yeniden dener. Tablet, eşleştirme sırrını kanıtlamadan cihaz anahtarını alamaz. Cihaz anahtarı SecureStore'da saklanır.

## Duvarda kullanım

- Uygulama ön planda ve tablet prize bağlı kalsın. `expo-keep-awake` ekranın uygulama açıkken uyumasını önler.
- Android'in ekran sabitleme özelliğiyle uygulamanın yanlışlıkla kapatılmasını sınırlayabilirsiniz. Otomatik açılış ve tam yönetilen kiosk bu sürümde yoktur.
- Otomatik tarih/saat açık olsun. Sunucu ile 1 dakikadan fazla fark algılanırsa uygulama bilgi verir.
- Sessiz saatler panelden etkinleştirilmişse rutin ekranda görünür, ses çalmaz.
- Her sesli duyurudan önce düşük sesli, iki notalı bir ton ve kısa bir duraklama duyulur. Ton ve duraklama toplam 1,9 saniyedir; önbellekten okumada da çalar. Ton uygulamada gömülüdür; ek ağ isteği veya Gemini ücreti oluşturmaz. Kaynak dosya `node scripts/generate-chime.mjs` ile yeniden üretilebilir.
- Uygulama arka plana alınır veya kapatılırsa zamanında seslendirme garanti edilmez. Arka plana geçiş mevcut sesi keser.

Tablet ekranında düğme, kaydırma veya dokunarak işlem yapma yoktur. Seslendirme sonucu görünür; duyuru kartı işlem bittikten 15 saniye sonra kendiliğinden sıradaki programa döner. Yaklaşan rutinler üçerli gruplar halinde 15 saniyede bir değişir. Seslendirme, görevin tamamlandığı anlamına gelmez. Aynı dakikadaki duyurular sıraya girer; 2 dakikayı aşan gecikmeler seslendirilmeden “Kaçırıldı” kaydedilir.

Tablet bağlantısı panelden kaldırılır. İptal bilgisi bir sonraki ağ isteğinde cihaza ulaşınca yerel aile verileri ve sesler temizlenir, eşleştirme ekranı otomatik açılır. Çevrimdışı tablet, iptal bilgisi ulaşana kadar indirilmiş programını çalıştırır.

## Ön hatırlatmalar

Panelde **Ön hatırlatma ekle** ile iki farklı süre seçilebilir (1–1440 dakika). Etkinliğin asıl saatinde, “Saatinde tablet ne söylesin?” alanındaki metin okunur. Ön bildirimler kişi, başlık ve kalan süreye göre otomatik hazırlanır. En az bir saat kalan aynı gün etkinliklerinde “bugün”, önceki güne taşanlarda uygun gün ifadesi kullanılır. Gün hesabı etkinliğin saat dilimine göre yapılır.

Ön bildirim ve ana duyuru ayrı olaylardır; tablet üzerinde onay veya erteleme gerekmez. Etkinlik başlamışsa geciken ön bildirim atlanır. Sessiz saatler, duraklatma ve silme tüm bildirimlere uygulanır. Her duyurudan önce yumuşak ton çalar.

Her farklı ön bildirim metni ilk okunduğunda Gemini sesi oluşturulur, sonraki aynı metinler tablet önbelleğinden kullanılır. Eski hatırlatıcılara kendiliğinden ön bildirim eklenmez. Yeni özellik için API/panel ve tablet birlikte güncellenmelidir.

## Cihazda kabul denemesi

Vercel ve gerçek ses hazır olduktan sonra:

- 2–3 dakika sonrasına rutin kurun; bir kez çaldığını, seslendirme sonucunun panel geçmişine geldiğini ve duyuru kartının otomatik kapandığını kontrol edin.
- Tablette bir kez seslendirilen metin için Wi-Fi'yi kapatın; sonraki tekrarın önbellekten çalıştığını kontrol edin. Yeni metnin ilk okuması çevrimdışıyken ses üretemez; ekranda hata görünmelidir.
- Uygulamayı kapatıp açın; daha önce duyurulan aynı olay tekrar çalmamalı.
- Saat dilimi, geceyi aşan sessiz saatler ve 2 rutin aynı dakikada senaryolarını deneyin.
- Metni değiştirip yeni metnin eşitlendiğini kontrol edin; ses isteği başarısız olsa da eski metnin sesi çalmamalı. Ses üretilirken duraklatma/silme işlemi tablette eşitlenirse oynatma iptal edilmelidir.
- Tableti bir gece boyunca açık bırakıp en az 24 saatlik güç/ısı/ses/ekran denemesi yapın.

Eski GridFS sürümünden geçişte API ve tablet uygulamasını birlikte güncelleyin. Tablet ilk açılışta internet üzerinden metin programını yeniden eşitlemelidir. Eski sesli snapshot otomatik kullanılmaz; eşleştirme ve gerçekleşmiş olay kayıtları korunur.
