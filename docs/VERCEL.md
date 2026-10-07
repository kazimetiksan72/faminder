# Vercel kurulumu

Panel ve API tek alan adında çalışır. Tarayıcı `/api` üzerinden istek yapar; oturum çerezi aynı alan adında kalır. API, `api/index.ts` girişinden Express uygulamasını dışa aktarır. Panel statik dosyaları `apps/admin/dist` klasörüne derlenir.

## 1. Projeyi içe aktarın

Vercel'de **Add New → Project → Import Git Repository** ile [kazimetiksan72/faminder](https://github.com/kazimetiksan72/faminder) reposunun `main` dalını seçin:

| Ayar             | Değer                                  |
| ---------------- | -------------------------------------- |
| Root Directory   | `.` (depo kökü)                        |
| Framework Preset | Other                                  |
| Node.js Version  | 24.x (`package.json` içinde sabit)     |
| Install Command  | `vercel.json` içindeki komutu kullanın |
| Build Command    | `npm run build`                        |
| Output Directory | `apps/admin/dist`                      |

Kurulum, build ve output ayarları kökteki `vercel.json` içinde hazırdır; panelden değiştirmek gerekmez. `apps/admin` klasörünü Root Directory seçmeyin; API ve ortak paket de aynı projeye dahildir. Vercel kurulumu yalnızca panel, API, ortak paket ve kök geliştirme araçlarını yükler; tabletin native bağımlılıkları ve test MongoDB indirmesi yayın derlemesine dahil edilmez.

## 2. Ortam değişkenleri

**Settings → Environment Variables** bölümüne ekleyin. Anahtarların başına `VITE_` veya `EXPO_PUBLIC_` koymayın.

| Değişken           | Değer                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| `MONGODB_URI`      | Atlas connection string; mevcut yerel `.env` içindeki değer kullanılabilir |
| `MONGODB_DB`       | `faminder` (varsayılan; isteğe bağlı)                                      |
| `GEMINI_API_KEY`   | Google AI Studio'dan aldığınız anahtar                                     |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-lite-tts` (varsayılan; isteğe bağlı)                     |
| `ADMIN_ORIGINS`    | Panelin tam origin'i; ör. `https://faminder.vercel.app`                    |
| `NODE_ENV`         | `production` (Vercel üretim ortamı)                                        |

İlk deploy öncesinde en az `MONGODB_URI`, `GEMINI_API_KEY` ve `ADMIN_ORIGINS` değerlerini **Production** ortamına girin. `ADMIN_ORIGINS`, Vercel'in gerçekten atadığı alan adı olmalıdır; örnekteki alan adının size verildiğini varsaymayın. Origin değerine son `/` eklemeyin. Birden fazla izinli alan adını virgülle ayırın. Özel alan adına geçerken yeni origin'i ekleyip yeniden deploy edin. Rastgele Vercel preview adresleri otomatik olarak izinli değildir; deneyeceğiniz preview origin'ini açıkça ekleyin ve tercihen ayrı bir test veritabanı kullanın.

MongoDB Atlas kullanıcısının `faminder` veritabanında okuma, yazma ve indeks oluşturma yetkisi olmalı. Atlas Network Access ayarı Vercel'den gelen bağlantıları kabul etmelidir. Bağlantı sorununda `/api/health` ve Vercel Function loglarını kontrol edin.

## 3. Deploy ve ilk kullanım

1. Deploy edin. Ortam değişkenlerini sonradan değiştirdiyseniz **Redeploy** yapın.
2. `https://PROJENIZ.vercel.app/api/health` yanıtında `ok: true` ve `speechConfigured: true` kontrol edin. Bu, MongoDB bağlantısını ve anahtarın tanımlandığını doğrular; anahtarın Gemini'de çalıştığını tek başına doğrulamaz.
3. Panelden yeni aile hesabınızı oluşturun. Üyeleri ekleyip kısa bir hatırlatıcı kaydedin.
4. **Sesi dinle** seçeneğine basın; metin o anda Gemini ile seslendirilir. Kota/model erişimi hataları panelde gösterilir. Panel önizlemesi her kullanımda ses üretir; sorun düzeldikten sonra yeniden deneyebilirsiniz.
5. Tableti aynı projedeki `/api` adresiyle derleyin ve [tablet kurulumundaki](TABLET.md) eşleştirmeyi yapın.
6. Panelde metnin tablete ulaştığını kontrol edin. Tablette internet açıkken **Ses denemesi** yapın; ardından aynı metnin tekrarını internet kapalıyken deneyin. Panel önizlemesi tabletin önbelleğini doldurmaz.

Tablet API'ye tarayıcı oturumu olmadan erişir. Vercel Deployment Protection'ın üretim API'sini Vercel giriş sayfasıyla engellemediğini kontrol edin. Uygulama kendi yönetici oturumu ve cihaz kimlik doğrulamasını uygular.

## İstek anında ses üretimi

`POST /api/reminders/:id/speech`, yönetici oturumu veya tablet kimliğiyle çağrılır. İstek yalnızca rutin sürümünü ve ses önbelleği anahtarını taşır; okunacak metni sunucu ilgili ailenin kaydından alır. Gemini anahtarı sadece Vercel ortamında bulunur. API WAV yanıtını doğrudan istemciye gönderir, veritabanına veya sunucu diskine ses kaydetmez. GridFS, ses işi koleksiyonları ve cron artık kullanılmaz; `CRON_SECRET` gerekmez.

Hatırlatıcı kaydetmek veya eşitlemek Gemini çağrısı yapmaz. Tablet ilk okumada aldığı sesi kendi diskinde tutar. Metin, ses, tarz ve model aynıysa sonraki tekrarlar bu dosyadan çalar; saat veya renk değişikliği ses önbelleğini bozmaz. İlk okuma için internet ve çalışan Gemini anahtarı gerekir. Sunucuda kalıcı ses önbelleği olmadığı için her tablet kendi ilk üretimini yapar.

Sağlayıcı zaman aşımı 90 saniye, istemci sınırı 105 saniye, Vercel Function süresi 300 saniyedir. Aile başına saatte 120 ses isteği sınırı vardır. Ses en fazla 3 MiB, metin en fazla 400 karakterdir. Otomatik arka plan üretimi veya ücretli tekrar deneme yapılmaz. İlk duyuruda üretim süresi kadar gecikme olabilir; 2 dakikayı aşan gecikmeler tablet tarafından seslendirilmez.

Eski sürümde oluşmuş GridFS koleksiyonları otomatik silinmez; yeni akış onları okumaz veya yazmaz. Mevcut hatırlatıcı kayıtları veri kaybı olmadan metin biçiminde sunulur. API ve tablet uygulamasını birlikte güncelleyin.

Hesabınızdaki Vercel süre/kota ve kullanım koşullarını yayın öncesinde kontrol edin. Üretim yayını bu çalışma sırasında yapılmadı. Temiz workspace kurulumu, Node.js 24 üretim build'i, Vercel'in resmi Node builder'ıyla fonksiyon paketlemesi ve paketlenmiş API'nin bağımsız çalışması doğrulandı. Kapsam için [doğrulama notları](VALIDATION.md).

Resmî referanslar: [Vercel Functions](https://vercel.com/docs/functions), [rewrites](https://vercel.com/docs/rewrites), [Gemini ses üretimi](https://ai.google.dev/gemini-api/docs/speech-generation).
