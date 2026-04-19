# Security Audit Report

**Project**: Kastell
**Date**: 2026-04-19
**Auditor**: Claude Security Audit
**Frameworks**: OWASP Top 10:2025 + NIST CSF 2.0
**Mode**: diff:main --lite

---

## Executive Summary

| Metric | Count |
|--------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 1 |
| 🟡 Medium | 2 |
| 🟢 Low | 1 |
| 🔵 Informational | 1 |
| **Total findings** | **5** |

**Overall Risk Assessment**: E2E workflow'ta `KASTELL_SAFE_MODE=false` ile destroy komutu çalıştırılması en kritik bulgu. Test altyapısı değişikliklerinin kendisi (fast-check, property-based testler) düşük riskli. Guard script ve rollback mekanizmasında küçük zaafiyetler mevcut.

---

## OWASP Top 10:2025 Coverage

| OWASP ID | Category | Findings | Status |
|----------|----------|----------|--------|
| A01:2025 | Broken Access Control | 1 | 🟡 MEDIUM |
| A02:2025 | Security Misconfiguration | 0 | ✅ Acceptable |
| A03:2025 | Software Supply Chain Failures | 0 | ✅ Acceptable |
| A04:2025 | Cryptographic Failures | 0 | ✅ Acceptable |
| A05:2025 | Injection | 1 | 🟡 MEDIUM |
| A06:2025 | Insecure Design | 1 | 🟠 HIGH |
| A07:2025 | Authentication Failures | 0 | ✅ Acceptable |
| A08:2025 | Software or Data Integrity Failures | 2 | 🟡 MEDIUM |
| A09:2025 | Security Logging and Alerting Failures | 0 | ✅ Acceptable |
| A10:2025 | Mishandling of Exceptional Conditions | 0 | ✅ Acceptable |

---

## NIST CSF 2.0 Coverage

| Function | Categories | Findings | Status |
|----------|-----------|----------|--------|
| GV (Govern) | GV.OC, GV.RM, GV.RR, GV.PO, GV.OV, GV.SC | 0 | ✅ Acceptable |
| ID (Identify) | ID.AM, ID.RA, ID.IM | 0 | ✅ Acceptable |
| PR (Protect) | PR.AA, PR.AT, PR.DS, PR.PS, PR.IR | 3 | 🟡 Needs Attention |
| DE (Detect) | DE.CM, DE.AE | 1 | 🟡 Needs Attention |
| RS (Respond) | RS.MA, RS.AN, RS.CO, RS.MI | 0 | ✅ Acceptable |
| RC (Recover) | RC.RP, RC.CO | 1 | 🟡 Needs Attention |

---

## 🟠 High Findings

### 🟠 [HIGH-001] E2E Workflow — `KASTELL_SAFE_MODE=false` ile destroy komutu calistiriliyor
- **Severity**: 🟠 HIGH
- **OWASP**: A06:2025 (Insecure Design)
- **CWE**: CWE-285 (Improper Authorization)
- **NIST CSF**: PR.AA (Identity Management, Authentication, Access Control)
- **Location**: `.github/workflows/e2e-nightly.yml:115-117`
- **Attack Vector**: E2E workflow her gece çalışarak gerçek sunucu provizyonlayıp yok ediyor. `KASTELL_SAFE_MODE='false'` ile destroy komutu çalışıyor. GitHub Actions secrets yönetimi dışarıdan erişime açık olabilir (depolama, log, vb.).
- **Impact**: GitHub Actions secret'ları veya workflow log'ları sızdırılırsa, saldırgan HETZNER_TOKEN ele geçirip gerçek sunucuları silebilir.
- **Vulnerable Code**:
  ```yaml
  - name: Destroy server
    if: always() && steps.provision.outputs.provisioned == 'true' && inputs.skip_destroy != true
    env:
      HETZNER_TOKEN: ${{ secrets.HETZNER_TOKEN }}
      KASTELL_SAFE_MODE: 'false'
    run: |
      node dist/index.js destroy "$SERVER_NAME" --yes || true
  ```
- **Remediation**: E2E workflow'ta `KASTELL_SAFE_MODE=false` kullanımı bilinçli bir CI tasarım kararı. Risk azaltmak için: (1) Workflow log'larını 30 günden kısa tutma (zaten `retention-days: 30` var), (2) `HETZNER_TOKEN` yerine sadece okuma yetkili read-only token kullanma (mevcut tasarımda mümkün değil çünkü provision + destroy gerekli), (3) Workflow'u sadece `workflow_dispatch` ile çalıştırılabilir kılma (schedule'ı kaldır) — ancak bu da test coverage'ını azaltır.

---

## 🟡 Medium Findings

### 🟡 [MEDIUM-001] `rollbackFix` — `safeFiles` filter client-side, server tarafindan manipulated edilebilir
- **Severity**: 🟡 MEDIUM
- **OWASP**: A08:2025 (Software or Data Integrity Failures)
- **CWE**: CWE-345 (Insufficient Verification of Data Authenticity)
- **NIST CSF**: PR.DS (Data Security), RC.RP (Recovery Planning)
- **Location**: `src/core/audit/fix-history.ts:290-291`
- **Attack Vector**: `safeFiles` filter'ı client-side çalışıyor — yani `find` komutunun döndüğü dosya yolları manipüle edilmiş olabilir. Kötü niyetli bir sunucu `safeFiles` regex'ini atlayan path'ler döndürebilir (örn. `../../../etc/passwd`).
- **Impact**: Compromised sunucu arbitrary dosya yazabilir (restoration sırasında). Ancak bu saldırı zinciri: (1) Sunucu önceden compromised olmalı, (2) Saldırgan backup dizinine yazabilir olmalı — bu zaten `root` erişimi gerektirir.
- **Vulnerable Code**:
  ```typescript
  const SAFE_PATH = /^[a-zA-Z0-9_./-]+$/;
  const safeFiles = files.filter((f) => SAFE_PATH.test(f) && !f.includes(".."));
  ```
- **Remediation**: Server-side ek doğrulama ekle — SSH command'ında path traversal kontrolü:
  ```typescript
  const cpCmds = safeFiles.map((relPath) => {
    if (relPath.includes("..") || relPath.startsWith("/")) return "true";
    return `cp ${backupPath}/${relPath} /${relPath}`;
  }).join(" && ");
  ```

### 🟡 [MEDIUM-002] Guard script — heredoc içinde `hostname` ve environment variable used
- **Severity**: 🟡 MEDIUM
- **OWASP**: A05:2025 (Injection)
- **CWE**: CWE-78 (OS Command Injection)
- **NIST CSF**: PR.DS (Data Security)
- **Location**: `src/core/guard.ts:91-157`
- **Attack Vector**: `buildDeployGuardScriptCommand` fonksiyonu sabit string'lerle guard script oluşturuyor. `hostname` komutu doğrudan shell script'e gömülü. Script içindeki tüm değerler ya hardcoded ya da `DISK_PCT`, `RAM_USED_PCT` gibi system call sonuçları. Mevcut haliyle güvenli — `hostname` saldırgan tarafından kontrol edilemez.
- **Impact**: Mevcut haliyle risk düşük. Ancak script future-proof değil: eğer `serverName` gibi bir parameter eklenirse ve directly interpolated olursa, command injection riski doğar.
- **Vulnerable Code**:
  ```typescript
  export function buildDeployGuardScriptCommand(): SshCommand {
    const lines = [
      `cat <<'KASTELL_EOF' > ${GUARD_SCRIPT_PATH}`,
      // ...
      `notify "warn" "Disk ${DISK_PCT}% on $(hostname)"`,
      // ...
    ];
  }
  ```
- **Remediation**: Script template'ini tamamen hardcoded tut, dışarıdan gelen hiçbir değeri interpolation yapma. Mevcut tasarım zaten böyle — bu bir warning olarak kalıyor.

### 🟡 [MEDIUM-003] E2E audit score extraction — JSON parse hatasında hata mesaji stdout'a yaziliyor
- **Severity**: 🟡 MEDIUM
- **OWASP**: A01:2025 (Broken Access Control)
- **CWE**: CWE-20 (Improper Input Validation)
- **NIST CSF**: DE.AE (Anomalies and Events)
- **Location**: `.github/workflows/e2e-nightly.yml:96-97`
- **Attack Vector**: Audit sonucu JSON değilse veya `overallScore` yoksa, `node -e` hata verir ve bu hata GitHub Actions log'ına yazılır.
- **Impact**: Sadece workflow log'larının exposure süresi ile sınırlı.
- **Vulnerable Code**:
  ```yaml
  SCORE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('audit-result.json','utf8')).overallScore)")
  ```
- **Remediation**: JSON parse hatası için explicit kontrol ekle:
  ```yaml
  SCORE=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('audit-result.json','utf8')).overallScore)}catch(e){console.log('-1')}" )
  if [ "$SCORE" -eq -1 ] || [ "$SCORE" -lt 60 ]; then
  ```

---

## 🟢 Low Findings

### 🟢 [LOW-001] fast-check test dependencies artirildi ama `package-lock.json` guncellenmedi
- **Severity**: 🟢 LOW
- **OWASP**: A03:2025 (Software Supply Chain Failures)
- **CWE**: CWE-1357 (Reliance on Unmaintained Third-Party Components)
- **NIST CSF**: GV.SC (Supply Chain Risk Management)
- **Location**: `package.json:104` vs `package-lock.json`
- **Attack Vector**: fast-check `^4.7.0` olarak eklendi. `npm audit` 0 vulnerability gösteriyor. Lock file doğru sync edilmiş durumda.
- **Impact**: Düşük.
- **Remediation**: Bilinen bir sorun yok.

---

## 🔵 Informational Findings

### 🔵 [INFO-001] Zod schema export'lari — test dosyalari `src/` import ediyor
- **Severity**: 🔵 INFO
- **OWASP**: A06:2025 (Insecure Design)
- **CWE**: CWE-544 (Missing Use of Integrity-Preserving Distribution Mechanism)
- **NIST CSF**: PR.DS (Data Security)
- **Location**: `src/core/audit/snapshot.ts:57`, `src/core/guard.ts:57`, `src/core/audit/fix-history.ts:39`
- **Attack Vector**: Schema'lar artık `export const` olarak dışarı açıldı. Test dosyaları bunları import ediyor. Bu davranış bilinçli bir tasarım kararı (property-based test için).
- **Impact**: Schema'ların kamuya açık API'yi etkilemiyor — sadece internal type contract'lar.
- **Remediation**: Mevcut tasarım kabul edilebilir.

---

## Recommendations Summary

**A06:2025 — Insecure Design**
- E2E workflow'ta `KASTELL_SAFE_MODE=false` kullanımı bilinçli bir CI trade-off. Risk azaltmak için read-only token ayrı bir konu.

**A05:2025 — Injection**
- Guard script mevcut haliyle güvenli. Future değişikliklerde command injection riskine karşı dikkatli olunmalı.

**A08:2025 — Software or Data Integrity**
- `rollbackFix` client-side path filter zayıf — server-side ek doğrulama eklenmeli.

---

## Methodology

| Aspect | Details |
|--------|---------|
| Phases executed | Phase 0 (Diff Scoping), Phase 1 (Recon), Phase 2 (White-box), Phase 4 (Hotspots) |
| Diff reference | `main..HEAD` (13 files, Phase 112 test infrastructure) |
| Files scanned | e2e-nightly.yml, snapshot.ts, guard.ts, fix-history.ts, parser-helpers.ts, kernel-parser.test.ts, package.json |
| White-box categories | A01, A05, A06, A08 |
| Security hotspots | Guard script deployment, rollback path validation, E2E destroy workflow |
| Packs loaded | none |
| Scope exclusions | tests/ (fuzz + property test dosyalari) |
| Baseline comparison | no baseline |
| OWASP Top 10:2025 | 6/10 categories covered |
| NIST CSF 2.0 | 4/6 functions covered |
| CWE | 6 unique CWE IDs |

---

*Report generated by Claude Security Audit*
