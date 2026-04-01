# Security Audit Report

**Project**: Kastell CLI v1.17.0
**Date**: 2026-04-01
**Auditor**: Claude Security Audit
**Frameworks**: OWASP Top 10:2025 + NIST CSF 2.0
**Mode**: full
**Previous Audit**: 2026-03-29 (v1.16.0)

---

## Executive Summary

| Metric | Count |
|--------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 2 |
| 🟡 Medium | 5 |
| 🟢 Low | 4 |
| 🔵 Informational | 0 |
| 🔲 Gray-box findings | 5 |
| 📍 Security hotspots | 8 |
| 🧹 Code smells | 7 |
| **Total findings** | **31** |

**Overall Risk Assessment**: The codebase demonstrates strong security fundamentals — consistent IP validation, array-form subprocess invocation, AES-256-GCM encryption, whitelist-only API response sanitization, and layered SAFE_MODE enforcement. No critical vulnerabilities found. The 2 HIGH findings are concentrated in rollback path trust and shell command construction patterns. All findings are defence-in-depth improvements, not exploitable from external input in the current threat model.

**Changes since v1.16.0 audit**: Previous audit had 29 findings (0 critical, 1 high). This audit: 0 critical, 2 high. New findings are in v1.17 features (rollback, schedule, doctor auto-fix). Previous HIGH-001 (deferred structured logging) remains deferred to v2.0.

---

## OWASP Top 10:2025 Coverage

| OWASP ID | Category | Findings | Status |
|----------|----------|----------|--------|
| A01:2025 | Broken Access Control | 2 | 🟡 Acceptable (theoretical) |
| A02:2025 | Security Misconfiguration | 2 | 🟡 Needs Attention |
| A03:2025 | Software Supply Chain Failures | 1 | ✅ Acceptable |
| A04:2025 | Cryptographic Failures | 0 | ✅ Clean |
| A05:2025 | Injection | 5 | 🟠 Needs Attention |
| A06:2025 | Insecure Design | 0 | ✅ Clean |
| A07:2025 | Authentication Failures | 1 | ✅ Acceptable |
| A08:2025 | Software or Data Integrity Failures | 0 | ✅ Clean |
| A09:2025 | Security Logging and Alerting Failures | 2 | 🟡 Needs Attention |
| A10:2025 | Mishandling of Exceptional Conditions | 1 | ✅ Acceptable |

---

## NIST CSF 2.0 Coverage

| Function | Categories | Findings | Status |
|----------|-----------|----------|--------|
| GV (Govern) | GV.SC | 1 | ✅ Acceptable |
| ID (Identify) | ID.AM, ID.RA | 0 | ✅ Clean |
| PR (Protect) | PR.AA, PR.DS, PR.PS | 8 | 🟡 Needs Attention |
| DE (Detect) | DE.CM, DE.AE | 2 | 🟡 Needs Attention |
| RS (Respond) | RS.MA | 0 | ✅ Clean |
| RC (Recover) | RC.RP | 0 | ✅ Clean |

---

## 🟠 High Findings

### 🟠 [HIGH-001] Path Traversal in Rollback File Restoration
- **Severity**: 🟠 HIGH
- **OWASP**: A05:2025 (Injection)
- **CWE**: CWE-22 (Path Traversal)
- **NIST CSF**: PR.DS (Data Security)
- **Location**: `src/core/audit/fix-history.ts:280`
- **Vulnerable Code**:
  ```typescript
  const cpCmds = files.map((relPath) => `cp ${backupPath}/${relPath} /${relPath}`).join(" && ");
  const batchResult = await sshExec(ip, raw(cpCmds));
  ```
- **Attack Vector**: `relPath` comes from `find` output on the remote server. If the backup directory is tampered with, a crafted file path like `../../etc/cron.d/backdoor` would write attacker-controlled content to arbitrary system paths during rollback.
- **Impact**: Arbitrary file write on the managed server during rollback. Requires attacker to already have write access to the backup directory on the remote server.
- **Remediation**: Validate `relPath` entries against a path traversal regex before constructing the `cp` command. Reject any path containing `..`.

### 🟠 [HIGH-002] Shell Injection Pattern in Schedule Manager execSync
- **Severity**: 🟠 HIGH
- **OWASP**: A05:2025 (Injection)
- **CWE**: CWE-78 (OS Command Injection)
- **NIST CSF**: PR.DS (Data Security)
- **Location**: `src/core/scheduleManager.ts:83-84`
- **Vulnerable Code**:
  ```typescript
  const cronInstallCmd = `(crontab -l 2>/dev/null | grep -v '${marker}'; echo '${entry}') | crontab -`;
  execSync(cronInstallCmd, { env: sanitizedEnv() });
  ```
- **Attack Vector**: `execSync` with shell-interpolated string. Currently safe because `sanitizeServerName` only allows `[a-zA-Z0-9._-]` and `validateCronExpr` constrains the cron expression. However, one future regex relaxation away from injection.
- **Impact**: Local crontab manipulation if input validation is ever relaxed.
- **Remediation**: Replace `execSync` with `spawnSync` using array arguments, or use a temp file approach for crontab updates.

---

## 🟡 Medium Findings

### 🟡 [MEDIUM-001] Unvalidated backupPath in Remote Shell Commands
- **Severity**: 🟡 MEDIUM
- **OWASP**: A05:2025 (Injection)
- **CWE**: CWE-78 (OS Command Injection)
- **NIST CSF**: PR.DS
- **Location**: `src/core/audit/fix-history.ts:255-281`
- **Attack Vector**: `backupPath` from `fix-history.json` is passed unvalidated to `raw()` shell commands. If the local JSON file is tampered with, crafted paths execute arbitrary commands on the remote server.
- **Impact**: Root command execution on managed server. Requires local file system access to `~/.kastell/`.
- **Remediation**: Validate `backupPath` against pattern `/^\/root\/\.kastell\/fix-backups\/fix-\d{4}-\d{2}-\d{2}-\d{3}$/` in the Zod schema.

### 🟡 [MEDIUM-002] execSync with Shell String for Machine ID
- **Severity**: 🟡 MEDIUM
- **OWASP**: A05:2025 (Injection)
- **CWE**: CWE-78
- **NIST CSF**: PR.DS
- **Location**: `src/utils/encryption.ts:93-104`
- **Attack Vector**: Hardcoded `execSync` calls with shell strings. No injection today, but structural risk — should use `spawnSync` array form.
- **Remediation**: Replace with `spawnSync("cmd", ["/c", "reg", "query", ...], { shell: false })`.

### 🟡 [MEDIUM-003] sedReplaceHandler Shell Injection via Single-Quote
- **Severity**: 🟡 MEDIUM
- **OWASP**: A05:2025 (Injection)
- **CWE**: CWE-78
- **NIST CSF**: PR.DS
- **Location**: `src/core/audit/handlers/sedReplace.ts:64`
- **Attack Vector**: `escapeSedPipe` only escapes `\` and `|`, not single-quotes. If a fix command definition contains `'`, shell injection is possible.
- **Remediation**: Use `printf '%s'` to pass content via shell variable.

### 🟡 [MEDIUM-004] `&&` Not Blocked by SHELL_METACHAR Guard
- **Severity**: 🟡 MEDIUM
- **OWASP**: A05:2025 (Injection)
- **CWE**: CWE-78
- **NIST CSF**: PR.DS
- **Location**: `src/core/audit/fix.ts:44`
- **Attack Vector**: `SHELL_METACHAR` regex does not block `&&`. Handler chain catches most cases, but defence-in-depth gap.
- **Remediation**: Add `&` to the SHELL_METACHAR pattern.

### 🟡 [MEDIUM-005] SAFE_MODE Defaults to false Without MCP Detection
- **Severity**: 🟡 MEDIUM
- **OWASP**: A02:2025 (Security Misconfiguration)
- **CWE**: CWE-1188
- **NIST CSF**: PR.PS
- **Location**: `src/core/manage.ts:15-37`
- **Attack Vector**: `isSafeMode()` returns `false` when no env var is set. Running MCP server without env var enables destructive operations.
- **Remediation**: Detect MCP context and default to `true`.

---

## 🟢 Low Findings

### 🟢 [LOW-001] sanitizeStderr Not Applied Consistently
- **Severity**: 🟢 LOW
- **OWASP**: A09:2025
- **CWE**: CWE-532
- **Location**: `src/utils/ssh.ts:361`, `src/utils/errorMapper.ts:163`

### 🟢 [LOW-002] debugLog Writes Unredacted Objects
- **Severity**: 🟢 LOW
- **OWASP**: A09:2025
- **CWE**: CWE-532
- **Location**: `src/utils/logger.ts:39-41`

### 🟢 [LOW-003] getServers() No Individual Field Validation
- **Severity**: 🟢 LOW
- **OWASP**: A02:2025
- **CWE**: CWE-20
- **Location**: `src/utils/config.ts:21-41`

### 🟢 [LOW-004] Retry-After Header No Upper Bound
- **Severity**: 🟢 LOW
- **OWASP**: A02:2025
- **CWE**: CWE-400
- **Location**: `src/utils/retry.ts:26-31`
- **Remediation**: Cap `delayMs` at `maxDelayMs`.

---

## 📍 Security Hotspots

### [HOTSPOT-001] `raw()` Escape Bypass
- **Location**: `src/utils/sshCommand.ts:42-44`
- **Why sensitive**: Zero-sanitization casting. Any runtime value = shell injection.

### [HOTSPOT-002] SAFE_MODE Single Gate
- **Location**: `src/core/manage.ts:15-37`
- **Why sensitive**: Entire destructive-action gate on one env lookup.

### [HOTSPOT-003] `remove` Action Missing SAFE_MODE Check
- **Location**: `src/mcp/tools/serverManage.ts:136-154`
- **Why sensitive**: Inconsistency with `destroy` which checks `isSafeMode()`.

### [HOTSPOT-004] Guard Metrics Unauthenticated Write
- **Location**: `src/core/guard.ts:138-149`
- **Why sensitive**: Shell variable interpolation in JSON heredoc. `auditScore` hardcoded 0.

### [HOTSPOT-005] ControlMaster Socket No Dir Permissions
- **Location**: `src/utils/ssh.ts:379-386`
- **Why sensitive**: `/tmp/kastell-ssh/` created without `mode: 0o700`.

### [HOTSPOT-006] Rollback Script No Integrity Check
- **Location**: `src/core/audit/fix-history.ts:261-270`
- **Why sensitive**: Remote `restore-commands.sh` executed without hash verification.

### [HOTSPOT-007] sanitizedEnv() Blocklist vs Allowlist
- **Location**: `src/utils/ssh.ts:127-141`
- **Why sensitive**: New env vars with non-standard names pass through.

### [HOTSPOT-008] assertValidServerId Slash for Linode
- **Location**: `src/providers/base.ts:120-124`
- **Why sensitive**: One slash allowed. Future regex relaxation opens path traversal.

---

## 🧹 Code Smells

### [SMELL-001] `isSafeMode()` in Wrong Module (`manage.ts`)
### [SMELL-002] Silent Catch-All in getGuardStates/loadFixHistory
### [SMELL-003] backupPath No Format Constraint in Zod Schema
### [SMELL-004] sanitizeStderr Defined But Not Wired Into SSH Path
### [SMELL-005] Wildcard Caret Ranges on Production Dependencies
### [SMELL-006] MCP Tool Top-Level Catch Returns Raw Error Messages
### [SMELL-007] Guard Marker Unescaped in grep Pattern

---

## Recommendations Summary

**Priority 1 (Quick wins):**
1. Add `&` to `SHELL_METACHAR` regex (MEDIUM-004)
2. Cap `Retry-After` at `maxDelayMs` (LOW-004)
3. Add `backupPath` format validation in Zod schema (MEDIUM-001)

**Priority 2 (Structural):**
4. Replace `execSync` with `spawnSync` in `encryption.ts` (MEDIUM-002)
5. Apply `sanitizeStderr` to SSH error returns (LOW-001)
6. Route MCP error responses through sanitizer (SMELL-006)
7. Add `mode: 0o700` to ControlMaster socket dir (HOTSPOT-005)

**Priority 3 (Design — v2.0 scope):**
8. Detect MCP context for SAFE_MODE default (MEDIUM-005)
9. Validate `relPath` in rollback file restoration (HIGH-001)
10. Extract `isSafeMode()` to dedicated module (SMELL-001)

---

## Clean Areas

- **IP validation** (`assertValidIp`) — comprehensive, blocks private/loopback/reserved
- **SSH subprocess** — all `spawn`/`spawnSync` use array args, never shell strings
- **AES-256-GCM** — correct IV/tag/salt, `scryptSync` key derivation
- **shellEscape/cmd** — POSIX `'\''` idiom, builder pattern
- **FORBIDDEN categories** — SSH/Firewall/Docker blocked at tier resolution level
- **MCP Zod schemas** — all tools validated before handler dispatch
- **Response sanitization** — whitelist-only `sanitizeResponseData`
- **Token scrubbing** — `sanitizedEnv()` strips TOKEN/SECRET/PASSWORD/CREDENTIAL
- **Package handlers** — `VALID_PKG_REGEX` with anchored match
- **Sysctl handler** — SSH probe + rollback for network keys

---

## Methodology

| Aspect | Details |
|--------|---------|
| Phases executed | 1-5 (full) |
| Frameworks detected | TypeScript, Commander.js, Inquirer.js, Axios, MCP SDK, Jest |
| White-box categories | 20/20 OWASP categories checked |
| Gray-box testing | MCP tools, SSH boundary, provider API, config files, fix engine |
| Security hotspots | 8 flagged |
| Code smells | 7 identified |
| Custom checks loaded | 10 from `.claude/security-audit-custom/` |
| OWASP Top 10:2025 | 10/10 categories covered |
| NIST CSF 2.0 | GV, ID, PR, DE, RS, RC covered |
| CWE | 8 unique CWE IDs (22, 78, 20, 400, 532, 1188, 297, 390) |

---

*Report generated by Claude Security Audit*
