# Phase 60: SSH Cipher Hardening - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

`kastell lock` çalıştırıldığında zayıf SSH cipher, MAC ve KEX algoritmalarını sshd_config'den minus-prefix blacklist syntax ile kaldırır. `sshd -t` validasyonu ile doğrular, başarısız olursa otomatik rollback uygular. Lock ve audit aynı sabit tanımlarını paylaşır.

</domain>

<decisions>
## Implementation Decisions

### Blacklist sabit paylaşımı
- WEAK_CIPHERS, WEAK_MACS, WEAK_KEX array'leri `constants.ts`'e taşınacak (şu an crypto.ts'de)
- Hem `lock.ts` hem `crypto.ts` constants.ts'den import edecek — tek kaynak (SSHC-05)
- Sadece array formatında tutulacak. Minus-prefix string'i (`-arcfour,-3des-cbc,...`) lock.ts'de üretilecek
- Audit tarafı array'i doğrudan kullanmaya devam edecek

### Step yerleşimi ve sıralama
- Yeni `buildSshCipherCommand()` fonksiyonu ayrı bir step olarak eklenir — Step 1 (sshHardening) içine gömülmez
- Group 1 (SSH & Auth) içinde, Step 1'den hemen sonra konumlandırılır
- `LockStepResult`'a yeni `sshCipher: boolean` alanı eklenir
- Step kendi `.bak` backup'ını alır: `sshd_config.bak-cipher` — Step 1'in backup'ına bağımlı değil
- Non-fatal: başarısızlıkta rollback yapılır, hata loglanır, diğer step'ler devam eder (pwquality pattern)

### sshd -t rollback mekanizması
- Tek SSH komut zinciri: `cp backup → append directives → sshd -t → başarılıysa restart, başarısızsa restore`
- DNS rollback pattern'i ile aynı yaklaşım (buildDnsRollbackCommand gibi)
- Rollback durumunda stepErrors'a detaylı mesaj: "SSH cipher hardening rolled back: sshd -t failed with [error]. Original config restored."

### Audit uyumluluğu
- Mevcut crypto.ts check logic'i değiştirilmeyecek
- `sshd -T` efektif config'i döner — minus-prefix blacklist uygulandıktan sonra weak cipher'lar listede olmaz
- Sabitlerin constants.ts'e taşınması dışında audit tarafında değişiklik yok

### Claude's Discretion
- Komut zincirinin exact shell syntax'ı
- Minus-prefix vs tam satır append kararı (lock builder içinde)
- sshd restart vs reload tercihi (cipher context'inde)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Lock pattern
- `src/core/lock.ts` — LockStepResult tipi, runLockStep() pattern, step sıralaması, buildXxxCommand() convention
- `src/core/lock.ts:buildSysctlHardeningCommand()` — printf + config file pattern örneği
- `src/core/lock.ts:438-446` — DNS rollback pattern (buildDnsRollbackCommand)

### Audit check'leri
- `src/core/audit/checks/crypto.ts` — WEAK_CIPHERS/MACS/KEX tanımları (taşınacak), check logic
- `src/core/audit/checks/ssh.ts` — SSH check parser pattern

### Sabitler
- `src/constants.ts` — PROVIDER_REGISTRY ve diğer sabitler (WEAK_* buraya taşınacak)

### Requirements
- `.planning/REQUIREMENTS.md` §SSH Crypto — SSHC-01 through SSHC-06

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildHardeningCommand()` (secure.ts): Mevcut SSH hardening — password auth, root login, etc.
- `raw()` (sshCommand.ts): SSH komut builder utility
- `runLockStep()` (lock.ts): Step execution + error handling wrapper
- DNS rollback pattern (lock.ts:438-446): sshd -t rollback için referans implementation

### Established Patterns
- Lock step'leri `buildXxxCommand() → runLockStep() → steps.xxx = result.ok` pattern'ini takip eder
- Non-fatal step'ler: hata durumunda `stepErrors[key] = error`, devam et (pwquality, aide gibi)
- Her step kendi SshCommand'ını döner, tek SSH exec'te çalışır

### Integration Points
- `LockStepResult` interface'ine `sshCipher` alanı eklenmeli
- `constants.ts`'e WEAK_CIPHERS/MACS/KEX export'ları eklenmeli
- `crypto.ts`'deki import'lar constants.ts'e yönlendirilmeli
- MCP `server_lock` tool description'ında step sayısı güncellenmeli (16→17)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 60-ssh-cipher-hardening*
*Context gathered: 2026-03-18*
