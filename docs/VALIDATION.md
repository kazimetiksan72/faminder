# Doğrulama — 8 Ekim 2026

## Yapılan kontroller

- 41 otomatik test geçti: 7 ortak zamanlayıcı, 12 API/MongoDB entegrasyonu, 15 tablet motoru ve 7 yerel ses önbelleği testi.
- Tüm workspace TypeScript kontrolleri geçti.
- React panel ve Node.js API production build'leri oluşturuldu.
- Android için Expo JavaScript/Hermes dışa aktarımı alındı; APK/native derleme değildir.
- Xcode 26.5 ile iOS Release native derlemesi başarılı. `com.faminder.tablet`, kabloyla bağlı iPad mini 5 (iPadOS 26.3.1) cihazına kuruldu. Kullanıcı geliştirici profiline güven onayını verdi; uygulama açıldı ve çalışan süreç doğrulandı. Açılış konsolunda JavaScript hatası görülmedi. Fiziksel yön değiştirme testi yapılmadı; ses denemesi aşağıda belirtilmiştir.
- iPad sürümü `https://faminder.vercel.app/api` üretim API adresine güncellendi. Geliştirme profilinin son geçerlilik tarihi 14 Ekim 2026'dır; kalıcı dağıtım yapılmadı.
- Üretilen iOS uygulamasında tam ekran ve yalnızca iki yatay yön doğrulandı. Android manifestinde sensorLandscape ve API 36 büyük ekran uyumluluk ayarı doğrulandı; fiziksel Android yön testi yapılmadı.
- `expo install --check`: SDK bağımlılıkları uyumlu.
- Sağlanan MongoDB Atlas adresine bağlantı ve ping başarılı. Entegrasyon testleri ayrı, geçici MongoDB kullanır.
- Panelin masaüstü ve 390 piksel mobil görünümü incelendi; yatay taşma yok.
- Demo panelde rutin oluşturma, seçili günler, kişi seçimi, saat düzenleme, duraklatma ve filtreleme denendi. Saat alanı gerçek klavye girdisiyle doğrulandı.
- Metin tabanlı modele geçişten sonra mevcut demo rutinleri ve düzenleyip kaydetme akışı tarayıcıda yeniden doğrulandı.
- Tarayıcı konsolunda hata/uyarı görülmedi. Ekran görüntüleri yerel `artifacts` klasöründedir.

## GitHub / Vercel yayın öncesi kontrolü

- Node.js 24.21.0 ile 36 test ve tüm TypeScript kontrolleri geçti. Vercel ve CI sürümü `24.x` olarak sabitlendi.
- Yalnızca Git'e girecek dosyalardan, `.env` dosyaları olmadan temiz bir kopya oluşturuldu. `NODE_ENV=production` ile `vercel.json` içindeki workspace kurulum komutu çalıştırıldı; panel/API/ortak paket kurulumu ve üretim build'i başarılı. `--include=dev` ile derleme araçlarının üretim ortamında da kurulması doğrulandı.
- Vercel'in resmi `@vercel/node` 22.0.0 builder'ı API'yi `nodejs24.x` fonksiyonu olarak paketledi. 430 dosyalık pakette tablet kaynakları ve yerel `.env` dosyaları bulunmadığı doğrulandı.
- Paket ayrı bir geçici dizinde açıldı ve bağımsız çalıştırıldı. Geçici MongoDB üzerinde sağlık kontrolü, yetkisiz erişim, hesap oluşturma, Secure oturum çerezi, snapshot ve origin kısıtlaması başarılı.
- Vercel routing-utils ile `/api/health` ve `/api/auth/login` yollarının API'ye, `/demo` yolunun panelin `index.html` dosyasına yönlendiği doğrulandı.
- Git'e girecek dosyalar, yerel gerçek bağlantı bilgileri ve anahtar örüntüleriyle karşılaştırıldı; gizli bilgiler, cihaz derlemeleri ve yerel kayıtlar dahil edilmedi.

Üretim kurulumu için gereken [ortam değişkenleri](VERCEL.md) ayrıca belgelenmiştir.

Yeni akışta metin kaydetme/eşitlemenin Gemini çağrısı yapmadığı, sunucuda ses koleksiyonu oluşmadığı, sürüm/aile kontrolü, yerel dosyanın çevrimdışı tekrar kullanımı, eski sese geri dönülmemesi ve iptal edilen ses isteğinin dosya yazmaması test edilir.

Tablet istekleri React Native'in desteklediği AbortController ile iptal edilir. Testler statik AbortSignal.timeout/any olmadan çalıştırıldı; takılı kalan ses isteğinin zaman aşımıyla sonlanması da doğrulandı.

## Canlı ses ve duyuru tonu

- Vercel üretim API sağlık kontrolü başarılı; Gemini ses yapılandırması etkin.
- 8 Ekim tarihinde üretim API ile eşleştirilmiş iPad'de canlı Gemini konuşması `played` kaydedildi; kullanıcı konuşmayı duyduğunu doğruladı. Geçici hatırlatma kaldırıldı.
- Her okumaya 1,9 saniyelik yerel iki notalı ton eklendi; son 300 ms sessizdir. WAV dosyasında tepe genliği 0,32, oynatma seviyesi 0,65 olarak sınırlandı.
- Otomatik testler konuşma hazır olmadan tonun başlamamasını, ton → konuşma sırasını, iptali, ton hatasında konuşmanın başlamamasını ve ton sırasında gelen duraklatma/sürüm/sessiz saat değişikliklerini kapsar.
- Android dışa aktarımında ve iOS Release uygulamasında gömülü WAV dosyası doğrulandı. Tonu içeren sürüm iPad'e kuruldu ve açıldı.

## Otomatik testlerin sınırları

Otomatik testlerde Gemini yanıtı geçerli bir WAV örneğiyle taklit edilir; canlı anahtar kullanılmaz ve ücretli API çağrısı yapılmaz. Tablet testlerinde Expo ses API'si ve depolama taklit edilir. Gerçek hoparlör, işletim sistemi yaşam döngüsü ve SQLite native sürücüsü için fiziksel cihaz testi gerekir.

## Bağımlılıklar

API üretim bağımlılıkları için `npm audit --workspace @faminder/api --omit=dev`: 0 bulgu. Tüm workspace audit'inde kritik bulgu kalmadı; Expo/Metro geliştirme zincirinde iki kök uyarıdan gelen 15 yüksek seviye kayıt var: `braces` ve `node-forge`. Mevcut registry sürümlerinde bunlar için uyumlu düzeltme bulunmadı; audit'in önerdiği Expo 44'e geri dönüş uygulanmadı. `uuid` ve `shell-quote` uyumlu yamalı sürümlere override edildi.

İzleme bağlantıları: [braces bildirimi](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [node-forge bildirimi](https://github.com/advisories/GHSA-86w9-cpqp-85rv).

## Henüz yapılmayanlar

- EAS APK/AAB ve fiziksel Android cihaz testi.
- 24 saatlik kesintisiz güç/ısı/ses/ekran denemesi.

iPad'de kısa süreli ses akışı doğrulandı; kesintisiz duvar tableti kullanımı için uzun süreli cihaz denemesi henüz yapılmadı.
