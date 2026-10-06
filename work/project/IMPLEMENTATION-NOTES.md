# Uygulama öncesi inceleme

6 Ekim 2026. Bu aşamada uygulama kaynakları değiştirilmedi; mevcut kod ve testler incelendi.

## Mevcut temel ve sınırlar

- `src/main.js`: küçük, doğrudan DOM kullanan uygulama. Ekleme, düzenleme, tamamlama, filtreleme, silme ve tek silmeyi geri alma mevcut.
- `src/style.css` ve `index.html`: Türkçe, tek sütunlu liste. Mevcut mavi palet ve Arial önceki planla uyumlu. Yeni framework, font, ikon paketi veya sunucu gerekmiyor.
- Kayıt anahtarı `yapilacaklar.v1`; veri biçimi `{id, text, completed}[]`. Şemayı ve anahtarı koru. Metin sınırı 500 karakter.
- Bozuk veya yinelenen kimlikli kayıtlar reddediliyor; bozuk kayıt üzerine yazılmıyor. Yazma hatasında görevler bellekte kalıyor ve uyarı gösteriliyor.
- Kullanıcı metni `textContent`, `.value` ve `setAttribute` ile aktarılıyor. `innerHTML` yalnızca sabit SVG yolları için kullanılıyor; görev metnini buraya taşımamak gerekir.
- Sekmeler ve cihazlar arasında senkronizasyon yok. Birden fazla sekmenin yazması eski listeyle yeni verinin üzerine yazabilir. Bu kapsamda senkronizasyon eklemek yerine mevcut sınırlamayı korumak uygun.

## Öncelikli kullanım riskleri

1. **Düzenleme taslağı kaybolabiliyor.** `edit()` metni yalnızca geçici input içinde tutuyor; `render()` tüm satırları siliyor. Bir görevi düzenlerken filtreye basmak, başka görevi işaretlemek veya yeni görev eklemek taslağı sessizce kaldırır. Önce bu akışı tekrar üret; küçük bir düzenleme durumu ile taslağı yeniden çizimler boyunca koru. Otomatik kaydetme, açık Kaydet/İptal akışının anlamını değiştirir; tercih edilmemeli.
2. **Filtrede tamamlamadan sonra odak giriş alanına dönüyor.** `focusRow()` görünmeyen satır için yeni görev alanına gider. Etkin görevleri klavyeyle sırayla bitirmek zorlaşır. Silmede kullanılan komşu satıra odaklama yaklaşımı burada da uygulanabilir.
3. **Geri alma bağlamı belirsizleşiyor.** Silme sonrası başka işlem `#message` metnini değiştirirken Geri al düğmesi görünür kalır; düğme hâlâ son silinen görevi geri getirir. Etiketi “Son silinen görevi geri al” yapmak en küçük açıklık iyileştirmesi. Çok seviyeli geçmiş gerekmiyor.
4. **Dokunma alanları küçük.** Checkbox 23×23, mobil işlem düğmeleri 32×36 px. Metne bağlı bir label checkbox kullanımını kolaylaştırabilir; düğme hedefleri büyütülürken 360 px genişlikte metin ve düzenleme alanı tekrar kontrol edilmeli. 44 px rahatlık hedefidir; AA için koşulsuz 44 px zorunluluğu yoktur. W3C'nin 24 px veya yeterli aralık kuralı nedeniyle yalnızca mevcut ölçüden ihlal sonucu çıkarılmamalı: [hedef boyutu açıklaması](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum).
5. **Telefon üzerinden HTTP geliştirme adresi sorun çıkarabilir.** Görev ekleme doğrudan `crypto.randomUUID()` kullanıyor. API güvenli bağlam gerektirir; yerel ağ IP adresindeki HTTP erişimi ayrıca denenmeli. Üretimde HTTPS kullan; HTTP telefon testi gerçekten gerekirse destek kontrolü ve küçük bir kimlik üretme alternatifi değerlendir. [MDN randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID).

## Görsel yaklaşım ve ödünleşimler

Mevcut #EEF4FA arka plan, #FFFFFF giriş alanı, #20354B metin, #245DB0 vurgu, #526477 yardımcı metin korunabilir. Ana işlev olan görev yazma ve satırları tarama öne çıkmalı. Mevcut ortalanmış içerik kabı içinde metinler sola hizalı kalabilir; tam genişlikli bir dashboard gerekmez.

Boş ekranın eğik not simgesi, tekrar eden görev sayaçları ve Enter ipuçları görsel incelemede sorgulanmalı. İşe yarayan filtre sayaçlarını koru; tekrarları azalt. Bu, tüm sınırları veya köşe yuvarlamalarını kaldırmak anlamına gelmez. Yeni slogan, dekoratif istatistik veya örnek görevleri kalıcı olarak kullanıcı verisine ekleme.

Tam listeyi yeniden çizmek kişisel küçük listede yeterince basit. Performans için framework veya sanallaştırma eklemek yerine önce taslak ve odak sorununu çöz. Depolama hatası metinlerini görünür tut; görsel sadelik uğruna kaldırma.

## Doğrulama ve uygulama sırası

1. Mevcut tarayıcı ortamını hazırla; boş, dolu ve düzenleme durumlarının 360 ve 1440 px görüntülerini al.
2. Taslak kaybını ve filtrede odak davranışını düzelt; bunları hedefleyen regresyon kontrolü ekle. Ardından geri alma etiketini ve dokunma alanlarını iyileştir.
3. `npm test` ve `npm run build` çalıştır. Gerçek tarayıcıda Tab/Shift+Tab, Space, Enter, Escape ve görünür odağı doğrula. Her iki genişlikte uzun metinle yatay taşma kontrolü yap.
4. Bozuk kayıt koruması, yazma engeli, yeniden yükleme ve HTML metninin etkisiz kalmasını tekrar doğrula.

Bu incelemede Node v24.9.0, Vite 8.3.2 ve jsdom 16.7.0 mevcut. `npm test`: 3/3 geçti. `npm run build`: başarılı.

`tests/browser.cjs` hazır, ancak Playwright proje bağımlılığı değil; Chrome kanalı ve çalışan 5173 sunucusu bekliyor. `PLAYWRIGHT_PATH` ortam değişkeniyle mevcut bir kurulum kullanılabilir. Test şu anda yalnızca dolu mobil/masaüstü ekranını kaydediyor; masaüstü taşmasını, boş/düzenleme görüntülerini ve bütün klavye akışını doğrulamıyor. Bu aşamada gerçek tarayıcı çalıştırılmadı; `artifacts/` içinde yalnızca eski `server.log` bulundu. README'deki önceki ortam engeli güncel deneme yapılmadan bugünün engeli sayılmamalı.
