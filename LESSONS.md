# Kastell — Lessons Learned

Bu dosya Kastell gelistirme surecinde ogrenilen dersleri icerir.
Tek kaynak — memory/lessons-learned.md ile BURAYA konsolide edildi.

<!-- LESSONS_START -->

## Test & Mock
- YAPMA: Error handling testinde mock'u dolayli tetikleme. jest.spyOn ile core fonksiyonu dogrudan mock'la
- YAPMA: EventEmitter-based spawn mock'ta `mockReturnValue` kullanma. `mockImplementation(() => createMockProcess(0))` kullan
- YAPMA: CloudProvider mock'ta interface metotlarini eksik birakma. Interface degisince TUM mock'lari guncelle
- YAPMA: Polling loop testlerinde gercek setTimeout kullanma. `jest.useFakeTimers()` + `jest.runAllTimersAsync()` kullan
- YAPMA: Spinner (Ora) ciktisini consoleSpy ile test etme. Ora kendi stream'ine yazar
- YAPMA: Side-effect'li modul ekleyip test mock'unu unutma. Gercek exec calisir!
- BEST PRACTICE: Side-effect'li moduller eklerken TUM consumer test dosyalarinda mock ekle
- BEST PRACTICE: Error handling testlerinde mapper hint dogrulamak icin hata mesajini mapper pattern'iyle eslestir

## Guvenlik
- YAPMA: API'den donen IP'yi dogrulamadan kullanma. assertValidIp ile terminal escape injection engelle
- ZORUNLU: Catch bloklarinda uygun mapper kullan: Provider→mapProviderError, SSH→mapSshError, FS→mapFileSystemError
- BEST PRACTICE: API'den donen IP dogrulanamiyorsa ip="pending" kaydet
- BEST PRACTICE: Servis durdurma failure path'lerde best-effort restart (tryRestartCoolify pattern)
- YAPMA: Kismen basarili islemleri "complete" raporlama. "partially complete" + retry komutu goster
- BEST PRACTICE: Security fix'leri mock + build uzerinde gercek fonksiyon cagrilariyla dogrula

## npm & CI/CD
- YAPMA: npm overrides ile farkli major versiyonlardaki ayni paketi ayri hedeflemeye calisma
- YAPMA: eslint'in ajv@6'sini ajv@8'e override etme (path farkliligi)
- YAPMA: npm overrides'da `">=X"` kullanma. Scoped override + caret range kullan
- YAPMA: package-lock.json commit'lemeden push etme. CI'da `npm ci` strict mod kullanir
- YAPMA: npm install --package-lock-only calistirmayi unutma
- BEST PRACTICE: ESLint 10 `preserve-caught-error`: catch'te `{ cause: error }` ekle
- BEST PRACTICE: npm publish: build → eslint → test → CI 6/6 → tag → publish → npm view
- BEST PRACTICE: Push oncesi `npx eslint src/` calistir
- BEST PRACTICE: Commit oncesi `npm ci` ile lock file sync kontrolu yap
- BEST PRACTICE: Version bump → `npm install --package-lock-only` ile lock sync

## Provider & Deploy
- BEST PRACTICE: Provider-specific IP wait. Vultr 2-5dk, Linode 1-2dk, DO 30-60s, Hetzner aninda
- BEST PRACTICE: Vultr getServerStatus'ta server_status != null kontrolu yap
- BEST PRACTICE: Exit code 130 (SIGINT) normal cikis — uyari gosterme
- YAPMA: DO'da Ubuntu 24.04 kullanma. Cloud-init timing bug'i var. 22.04 stabil
- KRITIK: Coolify v4 FQDN: PostgreSQL instance_settings tablosu (id=0)
- KRITIK: Hetzner default sifre SSH acik → rootkit riski. Ilk is SSH key + root disable

## Git
- YAPMA: Kullanici "commit at" dediginde push da yapma. Ayrica onay al
- YAPMA: gh auth hesap degisebilir. Push 403 → `gh auth switch --user omrfc`

## Mimari
- YAPMA: Komutlari index.ts icinde inline yazma. Her komut src/commands/ altinda ayri dosya
- YAPMA: Plan onayi ≠ uygulama onayi. Kullanici "basla" demeden implement etme
- BEST PRACTICE: Pragmatik yol: Simdi cikar, feedback al, sonra guncelle. YAGNI
- BEST PRACTICE: UX sorunlarini hemen duzelt. Kucuk rahatsizliklar guveni zedeler

<!-- LESSONS_END -->
