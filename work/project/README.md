# Yapılacaklar

Türkçe, tek kullanıcılı görev listesi. Vite, JavaScript ve CSS ile çalışır.

- `npm install`
- `npm run dev` — http://localhost:5173
- `npm test` — DOM tabanlı işlev testleri
- `npm run build` — üretim çıktısı `dist/` klasöründe

Görev ekleme, düzenleme (Enter ile kaydet, Escape ile iptal et), tamamlama, filtreleme ve son silinen görevi geri alma desteklenir. Veriler yalnızca mevcut tarayıcıda saklanır; cihazlar veya sekmeler arasında senkronizasyon yoktur. Bozuk kayıtlar otomatik ezilmez. Kayıt hatalarında uygulama görünür uyarı verir.

`tests/browser.cjs`, Playwright ve Chrome bulunan ortamda tarayıcı testlerini çalıştırır. Önce geliştirme sunucusunu başlatın; sonra `PLAYWRIGHT_PATH` ile Playwright paketinin konumunu belirtip `node tests/browser.cjs` çalıştırın. Ekran görüntüleri `artifacts/` içine yazılır.

Düzenleme taslakları filtre değişiminde ve diğer görev işlemlerinde oturum boyunca korunur; Kaydet ile kayda geçer, İptal/Escape ile silinir. Sayfa yenilenirse kaydedilmemiş taslaklar kaybolur.

6 Ekim 2026 doğrulaması: 5 DOM testi ve üretim derlemesi başarılı. Port dinleme (`EPERM`) ve Chrome başlatma (`SIGABRT`) ortam tarafından engellendi; gerçek tarayıcı testleri ve 360/1440 px görsel doğrulama tamamlanamadı.
