# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-04-20

### Added
- **`classifyError` helper** — unified instanceof-based error branching for KastellError hierarchy (TransientError, ValidationError, BusinessError, PermissionError)
- **`logSafeModeBlock`** — structured security logging wired into all 9 `isSafeMode()` guard sites in commands/ and MCP tools
- **`secureWriteFileSync` / `secureMkdirSync` / `ensureSecureDir`** — platform-aware secure file operations with POSIX permission enforcement
- **`configRepair` core + CLI** — `kastell config repair` diagnoses and repairs corrupted config files
- **MCP audit enhancements** — snapshot save/compare, category/severity filter, threshold gate, profile filter for `server_audit`
- **`--checks` flag** — `kastell fix --checks KERN-SYNCOOKIES,...` for specific check IDs
- **Property-based tests** — fast-check arbitraries for MCP and config Zod schemas
- **Fuzz tests** — kernel, firewall, and filesystem parser fuzzing with fast-check
- **E2E nightly workflow** — CI provision→lock→audit→destroy end-to-end pipeline
- **Schema exports** — property-based snapshot tests for Zod schema stability

### Changed
- **Structured error migration (P107+P113)** — all 9 commands/ catch blocks use `instanceof` branching instead of string matching; mappers (mapProviderError, mapSshError, mapFileSystemError) preserved for backward compat
- **Security logging (P107)** — SecurityLogger module with JSON audit trail, throw-point migration
- **Audit DRY (P106)** — shared sysctl utility, typed audit categories, v1.12 review backlog closed
- **CONFIG_DIR→KASTELL_DIR (P105)** — unified path constant, inline paths eliminated
- **Code quality** — template literals, cleaner conditionals, import cleanup across codebase
- **MCP parity** — CLI/MCP feature gap closed (parity matrix verification tests added)

### Security
- **secureWrite migration (SEC-06)** — all credential files use `secureWriteFileSync` with 0o600 permissions
- **TOCTOU fix** — removed `existsSync` guard before `secureMkdirSync` in auth.ts
- **Path traversal guard** — server-side validation in `rollbackFix` for E2E JSON parse errors
- **ESLint security plugins (P108)** — Zod schemas for all 4 providers, shellEscape utility, retry resilience (502/503/ETIMEDOUT)
- **CI hardening** — explicit permissions blocks in all workflows, SHA-pinned checkout actions
- **Dependency updates** — axios 1.15.0 (CVE-2025-62718), follow-redirects 1.16.0, hono 4.12.14, actions/cache 5.0.5

### Tests
- 240 suites, 10127 tests, 12 snapshots (up from ~9500 in v1.17.1)
- Coverage threshold: 90% global, 95% audit, 90% provider, 90% MCP

## [1.17.1] - 2026-04-01

### Security
- **28 defence-in-depth fixes** from 5-skill security audit (security-audit, supply-chain, insecure-defaults, sharp-edges, code-review)
- **`sshExec` type narrowing** — accepts `SshCommand` only (removed `| string`), 33 callers wrapped with `raw()` for explicit shell trust
- **`SAFE_MODE` typo-safe** — accepts `"yes"`, `"1"`, `"on"` as truthy; warns on unrecognized values; `remove` action now gated
- **`sanitizedEnv()` expanded blocklist** — 10 secret patterns (up from 4): TOKEN, SECRET, PASSWORD, CREDENTIAL, API_KEY, APIKEY, AUTH_KEY, AUTHKEY, PRIVATE_KEY, ACCESS_KEY
- **Rollback SHA256 integrity** — `restore-commands.sh` checksum written during backup, verified before execution
- **MCP error sanitization** — all 12 tool handlers route errors through `sanitizeStderr` to prevent IP/path leakage
- **Path traversal guard** — `relPath` in rollback validated with allowlist regex (`/^[a-zA-Z0-9_./-]+$/`)
- **`backupPath` Zod regex** — format constraint prevents tampered `fix-history.json` from injecting shell commands
- **`SHELL_METACHAR`** — added `&` to block `&&` on fallback path
- **`sedReplace` path quoting** — POSIX single-quote escape for file paths
- **`DEBIAN_FRONTEND` scope** — applied to both `apt-get update` and `apt-get upgrade`

### Changed
- **`scheduleManager` `execSync` → `spawnSync`** — temp file approach, no shell interpolation, `updateCrontab()` DRY helper
- **`encryption.ts` `execSync` → `spawnSync`** — array args for machine ID retrieval
- **Production deps pinned** — all 11 dependencies use exact versions (no caret ranges)
- **`isSafeMode()` extracted** to `src/utils/safeMode.ts` (re-exported from `manage.ts`)
- **Platform fallback** — detection failure defaults to `"bare"` (was `"coolify"`)
- **`cmd("")` throws** — empty string arguments rejected
- **`timeoutMs=0` guard** — falls back to default instead of instant kill
- **ControlMaster socket dir** — created with `mode: 0o700`
- **`debugLog` redaction** — sensitive keywords and objects redacted
- **`getServers()` hardened** — JSON.parse catch, provider validation against `SUPPORTED_PROVIDERS`
- **`warnIfPermissionError`** — shared helper for EACCES/EPERM distinction

## [1.17.0] - 2026-04-01

### Added
- **Bulk rollback** — `kastell fix --rollback-all` and `--rollback-to <fix-id>` for batch fix reversal
- **Doctor auto-fix** — `kastell doctor --auto-fix` diagnose-then-fix pipeline with `--dry-run` and `--force` options
- **Fix scheduling** — `kastell schedule fix|audit` installs local cron for automated fix/audit runs with `list` and `remove` management
- **Fix engine DRY refactor** — shared bulk rollback helpers, sed-replace and aptUpgrade programmatic handlers
- **Custom fix profiles** — user-defined profiles loaded from `~/.kastell/profiles/` alongside built-in web-server/database/mail-server
- **SSH ControlMaster** — connection multiplexing for fix engine prevents sshd MaxStartups exhaustion during bulk operations
- **Interactive menu full CLI parity** — schedule category, audit extras (snapshot/trend/watch/host/threshold/report/compare), fix extras (category/diff/report/rollback-to), doctor/lock/evidence/maintain/backup/status/snapshot/fleet options, shared validators
- **WAF bot detection checks** — NGX-WAF-BOT-DETECT and NGX-WAF-CHALLENGE-MODE audit checks for nginx bot mitigation
- **`--no-interactive` flag** — `kastell fix --no-interactive` for scheduled/automated runs without confirmation prompts

### Fixed
- **SSH lockout prevention** — NET-HOSTS-DENY moved to GUARDED tier, prevents TCP wrapper lockout via `/etc/hosts.deny`
- **Sysctl SSH breakage** — all sysctl fixes promoted to GUARDED tier, network sysctl SSH probe with automatic rollback (D-20)
- **Session-terminating commands** — reboot/shutdown/poweroff/halt promoted to GUARDED tier (D-22)
- **SSH ControlMaster Windows** — Unix-style `/tmp` socket path, stale socket cleanup, fork detection fix
- **MCP SAFE_MODE guards** — `serverLock`, `serverGuard`, `serverSecure` now enforce `isSafeMode()` for destructive operations
- **Fix backup directory** — rollback remote backup path resolution bug fixed (BUG-01)
- **fileWrite + systemctl handlers** — shell metachar bypass prevention for programmatic fix handlers

### Changed
- **TOCTOU elimination** — replaced `existsSync` checks with direct operation + ENOENT handling across fix engine and core modules
- **KASTELL_DIR consolidation** — unified `CONFIG_DIR` imports to `KASTELL_DIR` from `paths.ts`, eliminated deprecated re-exports
- **severityChalk utility** — centralized severity-to-chalk color mapping, replaces inline switch statements
- **9,871 tests** across 219 suites (up from 9,611 / 215 in v1.16)

### Security
- **Tier promotion system** — dangerous fixes (sysctl, hosts.deny, reboot) automatically promoted from SAFE to GUARDED, requiring explicit `--guarded` flag
- **MCP fail-closed SAFE_MODE** — MCP server defaults to safe mode, blocking destructive operations unless explicitly disabled

## [1.16.0] - 2026-03-29

### Added
- **AES-256-GCM token encryption** — tokens.json and notify-secrets.json encrypted at rest when OS keychain is unavailable. Per-installation random salt, cross-platform machine key derivation (Linux/macOS/Windows), transparent plaintext auto-migration
- **Fix rollback & history** — `kastell fix --rollback <id>` restores from backup, `kastell fix --history` shows fix log
- **Fix prioritization** — `kastell fix --top N` applies highest-impact fixes, `kastell fix --target 80` fixes until score reaches target
- **Programmatic fix handlers** — 4 dedicated handlers (sysctl, file-append, package-install, chmod/chown) replace shell redirect/pipe for SAFE tier fixes
- **Fix profiles** — `kastell fix --profile web-server|database|mail-server` applies server-type-specific fix sets
- **Fix diff preview** — `kastell fix --diff` shows per-fix before/after changes
- **Fix report** — `kastell fix --report` generates markdown fix report with score change and compliance info
- **WAF audit deep checks** — 5 new WAF pipeline checks (IP ACL, rate limiting, input sanitization, bot detection headers, data masking) expanding nginx category to 14 checks
- **Dependabot config** — `.github/dependabot.yml` for automated GitHub Actions SHA updates
- 10 project-specific security audit custom checks (SSH injection, SAFE_MODE bypass, token leak, MCP validation, subprocess env, SSH host key, API sanitization, error disclosure, npm lifecycle)

### Fixed
- **getServers() fail-closed** — corrupt servers.json now throws instead of silently returning empty array
- **fileAppend handler shell injection** — single-quote escape via shellEscape() on forward path (rollback already escaped)
- **Encryption key hardening** — per-installation random salt replaces hardcoded "kastell-v1", persistent random UUID fallback replaces low-entropy hostname

### Security
- All 13 GitHub Actions references SHA-pinned across 5 workflow files (zero floating tags)
- SECFIX-01 through SECFIX-09 addressed: token encryption, supply chain hardening, fail-closed config, 5 already-closed findings verified
- Security audit: 29 findings (down from 39), 0 critical, 1 high (deferred to v2.0 by design)
- `/review` skill added to release security gate

### Changed
- Test count: 5,522 → 9,611 (4,089 new tests including 3,623 mutation killers)
- Test suites: 207 → 215
- Test helpers: 4 → 5 factory files (encryption-factories.ts added)
- Mutation score: 44.65% → 59.06% nominal / 78.6% effective (Dalga 1-3 complete)

## [1.15.1] - 2026-03-28

### Added
- **`kastell changelog` command** — Parse and display CHANGELOG.md in terminal (`kastell changelog`, `kastell changelog v1.14.0`, `kastell changelog --all`)
- **"Why Kastell?" manifesto** in README (EN + TR) — problem statement, approach, AI-native positioning
- **Kastell vs Alternatives comparison table** in README (EN + TR) — Kastell vs Lynis vs OpenSCAP across 12 dimensions
- **Zero Telemetry badge** in README (EN + TR) — trust signal, no data collection
- **CI profile stats dispatch** — `.github` org profile auto-updates on every main push (test/check/category/MCP counts)
- Interactive menu: "View changelog" entry in Configuration section
- CHANGELOG.md included in npm package files

### Fixed
- **sshExec SSH banner handling** — servers with login banners caused non-zero exit codes on Windows, breaking health checks, audit scores (42→11 false drop), and doctor cache writes. Now checks stdout content when stderr is banner-only
- **3 incorrect fix commands** — `grub2-mkpasswd-pbkdf2` → `grub-mkpasswd-pbkdf2` (Ubuntu), `dc3dd` → `sleuthkit` (available in repos), `vector` → `rsyslog` (no 3rd party repo needed)
- **Backup fix command** — `kastell backup create` (local CLI, not available on server) → server-side `tar` command
- **audit-watch test timeout** — Windows CI fake timer slowness (jest.setTimeout 15s + extra microtick flushes)
- **CI dispatch format** — JSON body for repository_dispatch (was form-encoded)

### Security
- 10 security audit remediation items applied: SHELL_METACHAR validation, bot middleware fail-closed, clearKnownHostKey IP validation, sendTelegram token validation, unhandled rejection handler, npm publish --provenance, staging token scope, debugLog→KASTELL_DEBUG
- Security audit report: `security-audit-report.md` (39 findings, 0 critical)

### Changed
- Test count: 5,506 → 5,522 (16 new tests: 4 SSH banner + 12 changelog)
- Test suites: 206 → 207

## [1.15.0] - 2026-03-27

### Added
- **Edge & WAF Audit (P88):** 9 Nginx config checks + WAF detection, 30th audit category, CIS/PCI-DSS compliance mapping
- **TCP Stack DDoS Hardening (P89):** 8 sysctl DDoS parameter checks, 31st audit category, Docker platform guard
- **kastell fix --safe (P90):** SAFE/GUARDED/FORBIDDEN tier classification for 442+ checks, mandatory backup, dry-run, fix→verify pipeline
- **MCP server_fix (P91):** 14th MCP tool with dryRun:true default, SAFE_MODE guard, TypeScript FORBIDDEN rejection
- **Telegram Bot Notifications (P92):** Guard audit score monitoring, two-tier alerts (warning 5-9pt, critical 10+pt), 24h staleness guard, allowedChatIds CRUD
- **Telegram Bot Commands (P93):** grammy polling bot with /status, /audit, /health, /doctor, /help commands, allowedChatIds middleware, offset persistence
- `kastell bot start` command for foreground Telegram bot
- Interactive menu: "Start Telegram bot" entry in Notifications & Bot section

### Changed
- Audit categories: 29 → 31 (WAF & Reverse Proxy, DDoS Hardening)
- Audit checks: 413 → 442
- Test count: 5468 → 5499 (31 new bot module tests)
- Interactive menu audit description updated to 31 categories

### Fixed
- npm audit vulnerabilities fixed (brace-expansion, handlebars, picomatch)

### Security
- Bot allowedChatIds middleware silently blocks unauthorized users (no response leaked)
- Offset persistence prevents stale command replay on bot restart
- server_fix FORBIDDEN rejection blocks SSH/Firewall/Docker category fixes via MCP
- Fix tier classification: SSH/Firewall changes always FORBIDDEN (never auto-fixed)

## [1.14.0] - 2026-03-24

### Added
- **Snapshot Restore** — `kastell snapshot restore` CLI + MCP `snapshot-restore` action with SAFE_MODE guard, double confirmation, and 4-provider support (Hetzner, DigitalOcean, Vultr, Linode)
- **Cloud ID Lookup** — `findServerByIp()` across all 4 providers; `kastell add` now displays Cloud ID automatically
- **TLS Hardening Audit** — 8 checks (min version, weak ciphers, HSTS with max-age validation, OCSP stapling, cert expiry, DH params, compression, cert chain) with PCI-DSS/CIS/HIPAA compliance mappings
- **HTTP Security Headers Audit** — 6 checks (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CORS wildcard, CSP) with PCI-DSS v4.0 mappings
- **Lock Score Boost** — 4 new lock steps (SSH fine-tuning with 15 directives, login.defs hardening, pam_faillock, sudo logging/requiretty) + 2 extended steps (banners +/etc/motd, cronAccess +at.allow); 24-step orchestrator
- **Interactive menu** — Added snapshot restore, audit --explain/--diff/--fix, doctor --fix options
- **Stryker Mutation Testing** — Baseline 40.74% across 19,726 mutants

### Fixed
- **Lock-audit alignment** — 5 misalignments fixed (AIDE cron path, auditd restart, logrotate install+timer, cronAccess step, Docker mkdir)
- **snapshotId MCP validation** — Added regex validation for defense-in-depth
- **CERT_NOT_FOUND sentinel** — Properly emits when certificate file is missing instead of false CERT_EXPIRING_SOON
- **HTTPS-only audit gap** — HTTP header audit now tries HTTPS before HTTP for HTTPS-only servers
- **CLI snapshotCreate SAFE_MODE** — Added guard for consistency with MCP handler
- **Vultr/Linode snapshotId validation** — Added `assertValidServerId` for defense-in-depth
- **Hetzner findServerByIp pagination** — Changed `per_page` from 50 to 100 for consistency
- **Faillock idempotency** — Each directive independently checked/updated instead of batch
- **fileLock ENOENT** — Ensure parent directory exists before creating lock file

### Changed
- **Test suite** — 4178→5087 tests (909 new), 197 suites, 11 snapshots; branch coverage: global 93.25%, audit 95.96%, providers 91.22%, MCP 90.25%
- **Audit categories** — 27→29 (TLS Hardening + HTTP Security Headers); 421+ total checks
- **CI hardening** — Codecov integration, 4 typed test factory helpers, zero `as any` casts (231→0)
- **CI release gate** — `release.yml` now depends on CI success via `workflow_run` (prevents releasing when CI fails)
- **CI tag support** — CI workflow now runs on tag pushes for release/publish chain
- **TLS weak cipher detection** — Added SEED and IDEA to pattern
- **HSTS validation** — Now checks max-age >= 31536000
- **Compliance mappings** — Added HIPAA for TLS, updated PCI-DSS HDR-005 to v4.0 (6.2.4)
- **Skill consolidation** — 5 global security skills delegated to single `kastell-security-check.md`

### Removed
- **Stryker from CI** — Mutation testing removed from GitHub Actions (exceeds 6h limit); moved to dedicated infrastructure with scheduled nightly incremental runs

### Security
- **Comprehensive v1.14 review** — 5-agent parallel audit (OWASP, token/secret, audit system, code quality, test coverage); 13 findings resolved (3 MEDIUM + 10 LOW)
- **Release workflow injection fix** — Prevented shell injection via `head_branch` interpolation; added strict semver validation before checkout
- **Zero token leakage** — 5-layer sanitization verified across all new code paths

## [1.13.0] - 2026-03-19

### Added
- **Claude Code Plugin** — `kastell-plugin/` marketplace-ready package with `plugin.json` manifest, `.mcp.json`, and `hooks.json`
- **4 Skills** — `kastell-ops` (background server management), `kastell-research` (Explore agent + architecture map), `kastell-careful` (skill-scoped LLM prompt hook), `kastell-scaffold` (4 fork-friendly templates)
- **2 Agents** — `kastell-auditor` (security review) and `kastell-fixer` (bug diagnosis) project-scope agents
- **5 Hooks** — `session-log`, `stop-quality-check`, `session-audit`, `pre-commit-audit-guard`, `destroy-block` with ESM-compatible `.cjs` scripts
- **MCP Discoverability** — `server.instructions`, MCP Logging, `llms.txt`, `SUBMISSIONS.md`, 4 platform setup guides, `mcp-server` keyword
- **Dynamic Content Injection** — `!command` syntax in 4 skill files for live codebase context

### Fixed
- **CLI↔MCP parity** — 3 bugs fixed: logs default service (Dokploy), health host-key-mismatch detection, maintain update validation
- **DO Coolify SSH key loss** — Re-inject SSH public key after platform installer in cloud-init
- **Docker crash after lock** — SSH host key resolution in MCP health checks
- **Plugin hook ESM compatibility** — Renamed `.js` → `.cjs` for ESM project compatibility

### Changed
- **Commands→Core extraction** — `backup`, `status`, `update` business logic moved from commands/ to core/ (thin command pattern)
- **Adapter bypass elimination** — 9 commands now use adapter properties (`port`, `defaultLogService`, `platformPorts`) instead of hardcoded values
- **Shared `createMockAdapter()`** — Test mock factory in `tests/helpers/mockAdapter.ts`; deduplicated across all test files
- **Test coverage** — 4156→4178 tests (adapter contract, core extraction, hook tests)

## [1.12.0] - 2026-03-18

### Added
- **`audit --explain`** — Inline "Why:" + fix explanation for each failing check in CLI and MCP (`--explain` flag, 95%+ coverage)
- **Lock: auditd CIS L2 rules** — Deep audit rules (time-change, network-change, kernel-module) in `50-kastell-deep.rules` with immutability ordering
- **Lock: sysctl deep tuning** — 21 kernel hardening settings (dmesg_restrict, kptr_restrict, bpf_jit_harden, rp_filter, ASLR, core dumps)
- **Lock: pwquality** — CIS L1 password policy (minlen=14, complexity classes, maxrepeat=3), non-fatal with graceful skip
- **Lock: SSH cipher blacklist** — Weak ciphers/MACs/KEX removed via minus-prefix with `sshd -t` validation and automatic rollback
- **Lock: Docker runtime hardening** — daemon.json merge (no-new-privileges, live-restore, log rotation, icc:false) with platform-aware guards and reload-not-restart
- **Lock 19-step hardening** — Expanded from 16 to 19 steps (pwquality + SSH cipher + Docker hardening)
- **Audit 413 checks** — 4 new checks (KRN-BPF-JIT-HARDEN, LOG-AUDIT-TIME-RULES, LOG-AUDIT-NETWORK-RULES, LOG-AUDIT-MODULE-RULES)

### Fixed
- **jq injection prevention** — Docker hardening uses stdin pipe instead of shell interpolation
- **SSH sed tab pattern** — Cipher/MAC/KEX sed patterns now match both space and tab separators
- **Interactive menu** — Lock description updated from 16-step to 19-step

### Changed
- **WEAK_CIPHERS/MACS/KEX constants** — Single source in constants.ts, shared by lock and audit
- **Test coverage** — 4152→4156 tests (SSH cipher builder tests added)

## [1.11.0] - 2026-03-18

### Added
- **MCP tool descriptions** — Updated all 13 MCP tools with 27-category routing hints and accurate check counts
- **Audit display filter** — `audit --filter` for display-only category/severity filtering without re-running SSH
- **Audit fix score delta** — Post-fix score re-audit shows before/after comparison
- **Lock 16-step expansion** — `server lock` expanded from 5 to 16 hardening steps with grouped CLI output and dry-run preview
- **Lock step helpers** — `runLockStep` + 11 command builders for modular hardening (auditd, sysctl, pwquality, AIDE, etc.)
- **SSH host key remediation** — Proactive `removeStaleHostKey` before SSH polling + error output with remediation hints

### Fixed
- **Interactive menu audit filters** — Audit sub-menu now correctly passes filter and fix options
- **FW-05 passed field** — Fixed incorrect variable in firewall IPv6 check (`passed: isActive` → `passed: ipv6Enabled`)
- **MCP check count** — Corrected inflated 488+ count back to accurate 409
- **Audit filter+fix hardening** — Shell metacharacter guard, severity validation, structured error logging
- **CLOUDMETA_CATALOG_INPUT format** — Fixed cloud metadata catalog input format
- **SSH retry error handling** — Added `.catch()` to SSH retry preventing unhandled rejections

### Changed
- **`getErrorMessage` reuse** — Consolidated error message extraction across modules
- **`extractSentinelValue` scoping** — Documented as intentionally local to firewall.ts

## [1.10.1] - 2026-03-17

### Added
- **sshStream stdin support** — SSH batch commands piped via stdin for reliable cross-platform execution
- **Audit batch error reporting** — Structured error details when audit SSH batches fail

### Fixed
- **Windows SSH argument escaping** — Batch commands now use stdin pipe instead of spawn arguments, fixing truncation on Windows
- **Audit sentinel wrappers** — Added sentinel markers for 4 categories (accounts, services, boot, scheduling — 24 checks) fixing parser mismatches
- **Cloud-init SSH lockout** — Fixed DigitalOcean + Coolify SSH lockout caused by ssh.socket/needrestart/UFW ordering
- **Interactive menu back navigation** — Back option now works correctly in nested sub-menus
- **DEBIAN_FRONTEND=noninteractive** — Added to Coolify and Dokploy cloud-init scripts preventing apt prompts
- **Provision reliability** — Orphan cleanup, Vultr boot timeout (135s), SSH hardening safety guards
- **Snapshot Zod schema** — Added 6 P52 optional fields (vpsIrrelevant, connectionError, vpsType, vpsAdjustedCount, skippedCategories, warnings) preventing silent strip on load

## [1.10.0] - 2026-03-16

### Added
- **Audit Pro: 27 categories, 406+ checks** — Expanded from 9 categories / 46 checks to 27 categories / 406+ checks with Lynis-parity coverage
- **New audit categories** — Accounts, Services, Boot, Scheduling, Time, Banners, Crypto, File Integrity, Malware, MAC, Memory, Secrets, Cloud Metadata, Supply Chain, Backup Hygiene, Resource Limits, Incident Readiness, DNS Security
- **Compliance mapping** — CIS Ubuntu L1/L2 (290 mappings), PCI-DSS v4.0 (89 refs), HIPAA §164.312 (41 refs)
- **`audit --list-checks`** — Static catalog of all 406+ checks with severity, description, and compliance refs
- **`audit --profile`** — Filter audit by compliance profile (cis-level1, cis-level2, pci-dss, hipaa)
- **`audit --compliance`** — Framework-grouped compliance report (cis, pci-dss, hipaa)
- **VPS detection** — Auto-detect virtualization type (kvm, vmware, xen, etc.) with VPS-irrelevant check skipping
- **Interactive menu v1.10 options** — Audit sub-menu now includes list-checks, profile filter, compliance report; notify sub-menu includes list/remove

### Changed
- **Weighted category scoring** — Categories now have configurable weights (Secrets, Supply Chain weight=3)
- **Snapshot schema v2** — Added `auditVersion` field, automatic v1→v2 migration, Zod strict validation
- **Version-aware trend detection** — Methodology-change banner when comparing different audit versions
- **Semantic check IDs** — All checks renamed from numeric to `CATEGORY-DESCRIPTION` format (e.g., `SSH-PASSWORD-AUTH`)
- **Named separators + 3-tier batches** — SSH command grouping optimized for audit performance
- **Terminal formatter** — Category grouping (fail expanded / pass collapsed), stats header, VPS banner
- **QuickWins** — Max 7, compliance boost factor 1.5x for compliance-mapped checks
- **Provider boot timeout** — Provider-specific polling: Hetzner 30s, DigitalOcean 60s, Vultr 135s, Linode 120s
- Test count: 3,333 → 3,992 (+659 new tests across 178 suites)

### Fixed
- **Pre-release audit cleanup** — Deduplicated formatter helpers, strengthened secrets regex, fixed compliance mapper edge cases, added NaN guards
- **Boot timeout** — Vultr/Linode provision no longer times out due to fixed 30s polling

## [1.9.1] - 2026-03-15

### Security
- **Socket.dev alert fixes** — Resolved 3 supply-chain alerts on npm:
  - `curl|bash` update commands moved from `constants.ts` into adapter files (eliminates obfuscated code alert)
  - `child_process` import removed from `deploy.ts` — uses `removeStaleHostKey()` utility instead
  - `globalThis["fetch"]` false positive documented in SOCKET_JUSTIFICATION.md

## [1.9.0] - 2026-03-15

### Fixed
- **doctor --fix apt hang** — `DEBIAN_FRONTEND=noninteractive` prefix added to apt fix commands over SSH, preventing interactive prompts on headless servers
- **restore --force bypass** — `--force` flag now auto-selects the latest backup without prompting when `--backup` is not specified
- **README codecov badge** — Replaced broken codecov.io badge URL with shields.io integration for reliable rendering with logo

### Security
- **Notify token keychain migration** — Notification tokens (Telegram/Discord/Slack) moved from plain-text config to OS keychain storage with secure file-backed fallback for headless environments
- **SSH command builder** — New `SshCommand` branded type with `cmd()`/`raw()` builders and POSIX `shellEscape()` — eliminates string concatenation injection risk across 11 core modules

### Changed
- **MCP SDK isolation** — Dynamic `import()` boundary ensures non-MCP commands (`status`, `fleet`, `audit`, etc.) never load MCP SDK's 179 transitive dependencies
- **execSync → spawnSync migration** — Shell invocation eliminated from `ssh.ts` and `doctor.ts`, closing Socket.dev shell alert
- **MCP handler decomposition** — `serverSecure` (10 handlers) and `serverBackup` (6 handlers) extracted to colocated handler modules with 63 new unit tests
- **Quality audit fixes** — 16 code quality findings resolved: layer violations, duplication, naming consistency, constant extraction
- Test count: 3,175 → 3,333 (+158 new tests)

## [1.8.1] - 2026-03-15

### Added
- **Interactive menu complete** — All missing commands added to interactive menu: fleet, audit, lock, evidence, guard, doctor, backup-list, notify, completions with sub-prompts and emoji categories
- **`--force` flag** — Added to 7 CLI commands (backup, secure, lock, domain, update, maintain, evidence) for non-interactive/CI usage
- **`backup list` CLI command** — List all local backups (previously MCP-only)
- **Dokploy domain support** — CLI domain commands (add, remove, list, info) now work with Dokploy servers
- **`platformDefaults()` helper** — Eliminates repeated platform ternaries in domain/restart commands
- **Domain completions** — Added `list` and `info` to domain subcommands in bash/zsh/fish

### Fixed
- **Dokploy backup/restore** — Fixed `-U postgres` → `-U dokploy` (role "postgres" does not exist)
- **Restart message** — Now shows correct platform name and port (Dokploy:3000 vs Coolify:8000)
- **MCP mode detection** — `resolvePlatform()` used in MCP serverInfo (mode now correctly shows "dokploy")
- **MCP serverManage** — Added "dokploy" to mode enum

### Changed
- Interactive doctor prompt: `--check-tokens` → `--fresh`
- Interactive backup prompt: confirm dialog → sub-menu (create/all)
- MCP version metadata added to all tool responses

## [1.8.0] - 2026-03-15

### Added
- **Fleet Visibility** (`kastell fleet`) — Parallel health check across all servers with status table (online/degraded/offline), audit scores, response times. `--json` for structured output
- **Notification Module** (`kastell notify`) — Multi-channel alert dispatch: webhook, Slack, Discord, email (SMTP). `kastell notify add-channel` + `kastell notify test`
- **Guard Notification Integration** — Guard breach alerts automatically dispatched via configured notification channels with severity categorization
- **Doctor --fix** (`kastell doctor --fix`) — Interactive auto-remediation for doctor findings. Per-finding confirm gate, `--force` to skip prompts, `--dry-run` to preview. Whitelisted fix commands only
- **MCP server_fleet tool** — Fleet visibility exposed via MCP (list all servers with health/audit status)
- **Shell completions updated** — fleet, notify, audit, evidence commands and all v1.8 flags added to bash/zsh/fish generators

### Security
- **OWASP review** — 8 security fixes: evidence path traversal (H-01), evidence lines sanitize (H-02), webhook SSRF protection (M-01), guard stale comment fix (M-03), doctor fix whitelist (M-04), metrics file permission (L-03), audit history file permission (L-04), backup restore safe mode guard (I-01)
- 8 code quality improvements: notify DRY (sendHttp), Promise.all optimization, channel validation, guard version tracking, firewall platform messages, secure score DRY, default audit constants, IP validation consolidation

### Changed
- **Architecture**: Layer violation fix — `firewallSetup` and `secureSetup` moved from `commands/` to `core/`
- **Architecture**: Adapter deduplication — `sharedCreateBackup` and `sharedRestoreBackup` extracted to `src/adapters/shared.ts`
- **Architecture**: PostSetup decomposed into `barePostSetup` + `platformPostSetup`
- Platform name capitalized in restore backup step labels (e.g., "coolify" → "Coolify")
- Removed `.planning/` from git tracking (was leaking internal planning files)
- Test count: 3,038 → 3,175 (+137 new tests)
- MCP tools: 12 → 13 (server_fleet added)

## [1.7.0] - 2026-03-14

### Added
- **Server Lock** (`kastell lock`) — One-command production hardening: SSH key-only auth, fail2ban, UFW firewall, sysctl hardening, unattended-upgrades. Shows audit score before/after. `--dry-run` preview, `--force` for already-hardened servers
- **Backup Schedule** (`kastell backup --schedule`) — Cron-based automatic backups via SSH crontab. Supports `--schedule hourly|daily|weekly|custom` with custom cron expressions
- **Guard Daemon** (`kastell guard start|stop|status`) — Autonomous security monitoring via remote cron. Checks disk/RAM/CPU/audit every 5 minutes with threshold breach detection
- **Risk Trend** (`kastell audit --trend`) — Audit score trend analysis over time. `--days N` to control window. Terminal and JSON output formats
- **Doctor (Server Mode)** (`kastell doctor <server>`) — Per-server proactive health analysis: disk trending, high swap, stale packages, fail2ban bans, audit regression, old backups, reclaimable Docker space. `--fresh` for live SSH data, `--json` for structured output
- **3 new MCP tools**: `server_guard` (start/stop/status), `server_doctor` (summary/json), `server_lock` (dry-run/production/force)
- **Shell completions**: guard, lock, doctor flags added for bash/zsh/fish

### Security
- **OWASP review**: 10 security and quality fixes — sanitized error paths, hardened input validation, tightened type guards
- **Dependency fix**: flatted 3.3.3 → 3.4.1 (unbounded recursion DoS)

### Fixed
- CLI `list`/`status` now shows actual platform label (dokploy/coolify/bare) instead of generic "mode"
- `--force` flag added to secure/update CLI commands
- MCP evidence `force` parameter passthrough

### Changed
- Test count: 2,467 → 3,038 (+571 new tests)
- MCP tools: 9 → 12 (server_guard, server_doctor, server_lock added)

## [1.6.0] - 2026-03-11

### Added
- **Audit Snapshots** (`kastell audit --snapshot`) — Persist audit results as timestamped JSON snapshots. `--snapshots` to list saved snapshots
- **Audit Diff** (`kastell audit --diff <id>`, `--compare <id1> <id2>`) — Compare audit results between snapshots. Shows category-level score changes and new/fixed findings
- **Evidence Collection** (`kastell evidence <server>`) — Forensic evidence package: firewall rules, auth.log, listening ports, system logs, Docker info. SHA256 checksums per file. Written to `~/.kastell/evidence/{server}/{date}/`
- **MCP server_evidence tool** — Evidence collection exposed via MCP
- **Adapter contract conformance tests** — Verify PlatformAdapter interface compliance
- **Infrastructure utilities**: `withRetry` (exponential backoff for provider API calls), `withFileLock` (file-based mutex for config writes)
- **Provider retry integration** — All provider GET methods wrapped with `withRetry`
- **Config lock integration** — All config writes protected with `withFileLock`
- **Mode migration** — Automatic `ServerMode` field addition to legacy server records

### Security
- Consolidated IP validation, removed dead code, hardened security paths
- Auth keyring: replaced top-level await with lazy require (fixes non-interactive environments)

### Fixed
- Evidence dynamic section-to-filename mapping prevents index mismatch bug
- Linode test mocks updated to use Error instances for `withProviderErrorHandling`

### Changed
- Deduplicated provider error handling into `withProviderErrorHandling` + `extractApiMessage`
- Test count: 2,266 → 2,467 (+201 new tests)
- MCP tools: 8 → 9 (server_evidence added)

## [1.5.2] - 2026-03-09

### Fixed
- **Phase 2 code review**: 30 bug fixes across critical, high, medium, and low severity (3C+8H+14M+5L) — provider validation, error handling, type safety improvements
- **Phase 1 remaining fixes**: 15 files — provider validation hardening, audit check corrections, backup safety guards

### Changed
- **CI**: Automatic GitHub Release workflow on tag push
- **Docs (TR)**: Security audit section, MCP server_audit, CI pipeline example added to Turkish README

## [1.5.1] - 2026-03-08

### Fixed
- **Dokploy update command**: Install script now called with `update` argument — previously ran fresh-install mode which failed on port 80/443 conflict with running Dokploy instance
- 5 Dokploy integration bugs found during real-server testing (health check port, firewall ports, backup paths, restore commands, version detection)

## [1.5.0] - 2026-03-08

### Added
- **Security audit system**: `kastell audit` command with 9 check categories (SSH, auth, firewall, Docker, kernel, filesystem, network, logging, updates), scoring 0-100, terminal/JSON/summary/badge formatters
- **Audit history**: `kastell audit --history` tracks score trends over time with comparison
- **Audit watch mode**: `kastell audit --watch` monitors security score changes on interval
- **Audit quick wins**: `kastell audit --quick-wins` suggests highest-impact fixes
- **Audit auto-fix**: `kastell audit --fix` applies safe remediations automatically
- **MCP server_audit tool**: Full audit capabilities exposed via MCP (summary/json/score formats)
- **Token buffer**: In-memory token protection with controlled exposure window
- **Platform auto-detection**: SSH-based `detectPlatform()` checks filesystem markers for Dokploy/Coolify/bare

### Changed
- Test count: 2,266 → 2,467 (+201 new tests)
- Test suites: 86 → 112 (+26 new suites)
- MCP tools: 7 → 8 (server_audit added)

## [1.4.0] - 2026-03-08

### Added
- **CLI header**: Gradient ASCII banner with cyan-to-blue color scheme, version info bar, and quick-start command examples on interactive mode launch
- **Shell completions**: `kastell completions bash|zsh|fish` generates shell completion scripts for tab-completion
- **Config validation**: `kastell config validate` checks `servers.yaml` for structural and type errors using Zod strict schemas
- **Version check**: `kastell --version` now notifies if a newer version is available on npm
- **Dry-run support**: Added `--dry-run` flag to `destroy`, `remove`, `backup`, `snapshot`, and `secure` commands
- **Dokploy lifecycle**: Full Dokploy adapter with update, maintain, logs, health, backup, and restore support
- **Platform adapters**: `src/adapters/` architecture — Coolify and Dokploy adapters implement `PlatformAdapter` interface

### Changed
- Interactive menu no longer uses figlet — replaced with custom gradient ASCII art header
- `PROVIDER_REGISTRY` centralized in `src/constants.ts` as single source of truth
- Test count: 2,099 → 2,266 (+167 new tests)
- Test suites: 78 → 86 (+8 new suites)

## [1.3.1] - 2026-03-05

### Changed
- **Metadata update**: Package description, keywords, and homepage updated for Kastell branding
- **Repository references**: All internal references updated from `omrfc/kastell` to `kastelldev/kastell`

## [1.3.0] - 2026-03-05

### Breaking Changes
- **Package renamed**: `quicklify` is now `kastell` on npm. Install with `npm install -g kastell`
- **Binary renamed**: `quicklify` CLI is now `kastell`, `quicklify-mcp` is now `kastell-mcp`
- **License changed**: MIT -> Apache License 2.0 (patent protection added)

### Added
- **Config migration**: Automatic migration from `~/.quicklify` to `~/.kastell` on first run (copies entire directory, `.migrated` flag prevents re-migration)
- **NOTICE file**: Apache 2.0 attribution notice added

### Changed
- **Package identity**: name `kastell`, version `1.3.0`, homepage `https://kastell.dev`
- **Environment variable**: `KASTELL_SAFE_MODE` is now the primary env var for MCP safe mode. `QUICKLIFY_SAFE_MODE` still works with a one-time deprecation warning (backward compat until v2.0)
- **Internal types**: `QuicklifyYamlConfig` -> `KastellYamlConfig`, `QuicklifyConfig` -> `KastellConfig`, `QuicklifyResult` -> `KastellResult`
- **Config directory**: `~/.quicklify/` -> `~/.kastell/` (automatic migration on first run)
- **SSH key prefix**: `quicklify-` -> `kastell-` for auto-generated SSH keys
- **Snapshot prefix**: `quicklify-` -> `kastell-` for new snapshots (existing `quicklify-*` snapshots still recognized via dual-prefix filter)
- **Export filename**: Default export changed from `quicklify-export.json` to `kastell-export.json`
- **Update check**: Now queries `registry.npmjs.org/kastell/latest`
- **All documentation**: README.md, README.tr.md, SECURITY.md, CONTRIBUTING.md, llms.txt updated to Kastell branding
- **Example config**: `quicklify.yml` renamed to `kastell.yml`
- **MCP config**: Server name changed from `quicklify` to `kastell`

### Deprecated
- `quicklify` npm package (will show deprecation notice pointing to `kastell`)
- `QUICKLIFY_SAFE_MODE` env var (use `KASTELL_SAFE_MODE` instead, removed in v2.0)

## [1.2.1] - 2026-03-02

### Security
- **CRITICAL FIX**: `stripSensitiveData()` now sanitizes `error.response.data` and `error.response.headers` — prevents API tokens, rootPass, and other sensitive data from leaking via error cause chains
  - Whitelist-based `sanitizeResponseData()` preserves only known error message fields (Hetzner `error.message`, DigitalOcean `message`, Vultr `error`, Linode `errors[].reason`)
  - Response headers cleared to prevent `set-cookie` and tracking header exposure
  - Linode `root_pass` reflection in error responses now stripped

### Changed
- **Refactoring**: Extracted `init.ts` command logic into `src/core/deploy.ts` (619 → 243 lines)
- **Refactoring**: `PROVIDER_REGISTRY` centralized in `src/constants.ts` — single source of truth for provider metadata
- **Refactoring**: `stripSensitiveData()` consolidated from 4 provider files into `src/providers/base.ts`
- **Security**: SCP path hardening via `assertSafePath()` with shell metacharacter rejection
- **Security**: Token sanitization via `sanitizedEnv()` applied to all remaining child process calls
- Test count: 2,047 → 2,099 (+52 new tests)
- Test suites: 76 → 78 (+2 new suites)

## [1.2.0] - 2026-03-01

### Added
- **Bare Mode** — Generic VPS support without Coolify (`--mode bare` on init/add)
  - `ServerRecord.mode` field: `"coolify"` (default) or `"bare"`
  - `requireCoolifyMode()` guard blocks Coolify-only operations on bare servers
  - `getBareCloudInit()` — hardening-only cloud-init script (UFW + system updates)
  - Bare mode support across all 23 CLI commands and 7 MCP tools
  - 2GB RAM minimum removed for bare mode provisioning
  - Backward compatibility: legacy records without `mode` field default to `"coolify"`
- **Interactive Menu** — Run `quicklify` without arguments for a categorized menu
  - 6 categories: Server Management, Security, Monitoring & Logs, Backup & Snapshots, Maintenance, Configuration
  - Sub-option prompts for each action (mode, template, log source, port, etc.)
  - `← Back` navigation to return to main menu at any point
  - 49 new tests (`interactive.test.ts`)
- **MCP `sizes` action** — `server_info` tool now supports listing available server types with prices per provider/region
- **MCP shared utilities** — `src/mcp/utils.ts` with `resolveServerForMcp`, `mcpSuccess`, `mcpError`
- **SSH host key auto-fix** — `removeStaleHostKey()` helper auto-removes stale known_hosts entries
  - Health command detects host key mismatch and suggests fix
  - SSH retry mechanism after stale key removal
- **UX improvements** (6 enhancements):
  - Better dpkg lock messaging during provisioning
  - Token source display (env var vs prompt)
  - Firewall status shows current rules inline
  - Domain info shows current FQDN
  - Orphan backup cleanup
  - Backup/restore shows provider + IP context

### Security
- **OWASP hardening**: `assertSafePath()` for SCP paths (shell metacharacter check including `<>`)
- **Port validation**: MCP port range restricted to 1-65535
- **Token isolation**: `sanitizedEnv()` applied to all `spawn`/`exec`/`spawnSync` calls including `openBrowser`, `sshKey`, and `removeStaleHostKey`
- **SECURITY.md**: Added OWASP Top 10 compliance table with detailed mitigation descriptions

### Fixed
- Init `--full-setup` crash on bare mode servers
- Domain `--name` flag ignored on bare mode
- Cloud-init completion wait missing
- Bare mode showing incorrect port information
- Health command missing query argument
- Restart bare mode "command not found" message
- MCP SSH path incorrect during provision

### Changed
- Test count: 1,758 → 2,047 (+289 new tests)
- Test suites: 64 → 76 (+12 new suites)
- Banner slogan updated to "Self-hosting, fully managed"
- README interactive menu documentation with example output
- LICENSE name correction: "omrfc" → "Ömer Faruk CAN"
- `.gitignore`: added `servers.json`

## [1.1.0] - 2026-02-27

### Added
- **MCP Server** — Built-in Model Context Protocol server for AI-powered server management with 7 tools:
  - `server_info` — `list`, `status`, `health` (readOnly)
  - `server_logs` — `logs`, `monitor` (readOnly)
  - `server_manage` — `add`, `remove`, `destroy` (destructive, SAFE_MODE on destroy)
  - `server_maintain` — `update`, `restart`, `maintain`
  - `server_secure` — `secure-setup`, `secure-audit`, `firewall-setup`, `firewall-add`, `firewall-remove`, `firewall-status`, `domain-set`, `domain-remove`, `domain-check`, `domain-info`
  - `server_backup` — `backup-create`, `backup-list`, `backup-restore`, `snapshot-create`, `snapshot-list`, `snapshot-delete` (SAFE_MODE on restore/delete)
  - `server_provision` — `create` (destructive, SAFE_MODE — creates billable cloud resources)
  - Structured JSON responses with `suggested_actions` for AI context optimization
  - Tool annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`
  - Rate limiting guidance in tool descriptions
  - SAFE_MODE guards on destructive operations (provision, destroy, restore, snapshot-delete)
- **`src/core/` module** — Pure business logic extracted from CLI commands (no CLI dependencies)
  - `status.ts` — `checkCoolifyHealth`, `getCloudServerStatus`, `checkServerStatus`, `checkAllServersStatus`
  - `tokens.ts` — `getProviderToken`, `collectProviderTokensFromEnv` (non-interactive token resolution)
  - `secure.ts` — SSH hardening + audit (pure functions + async wrappers)
  - `firewall.ts` — UFW management (pure functions + async wrappers)
  - `domain.ts` — FQDN/DNS management (pure functions + async wrappers)
  - `backup.ts` — Backup/restore (20 pure functions + SCP helpers)
  - `snapshot.ts` — Snapshot create/list/delete + cost estimate
  - `provision.ts` — Server provisioning (13-step flow: validate → token → SSH → cloudInit → create → boot → IP → save)
- **`src/mcp/` module** — MCP server implementation
  - `src/mcp/server.ts` — MCP server setup with 7 tool registrations
  - `src/mcp/tools/` — 7 tool handlers (serverInfo, serverLogs, serverManage, serverMaintain, serverSecure, serverBackup, serverProvision)
  - `src/mcp/index.ts` — stdio transport entry point
- `bin/quicklify-mcp` — MCP server binary entry point
- SSRF defense: `assertValidIp()` added to `checkCoolifyHealth` (IP format validation before HTTP request)
- Stack trace sanitization in MCP error responses via `getErrorMessage()`

### Security
- **Path traversal protection**: `backupId` validated with Zod regex (`/^[\w-]+$/`) + `path.resolve()` guard in restore
- **SAFE_MODE enforcement**: Added `isSafeMode()` guards on `restart`, `maintain`, and `snapshot-create` MCP actions
- **IP validation hardened**: `assertValidIp()` now validates octet range (0-255), IP removed from error messages
- **stderr sanitization**: New `sanitizeStderr()` function redacts IPs, home paths, tokens, secrets (200 char limit) — applied to all backup/restore/logs error output
- **Port validation**: MCP `server_secure` port restricted to `z.number().min(1).max(65535)`
- **Provider enum validation**: MCP `server_manage` provider changed from `z.string()` to `z.enum()` (prevents invalid provider injection)
- **Manifest hardening**: `serverIp` field removed from `BackupManifest` type, manifest files written with `mode: 0o600`
- **SCP IP validation**: `assertValidIp()` added to `scpDownload()` and `scpUpload()` before spawning child process
- **Log redaction**: `manage.ts` stderr no longer exposes server IP address
- **SSH key auto-generation**: `provision` now auto-generates SSH key when none exists (instead of skipping)
- `.mcp.json` added to `.gitignore` (contains local absolute paths)

### Changed
- `src/commands/status.ts` refactored to use `src/core/status.ts` (DRY: eliminated duplicate Coolify health check)
- Test count: 1369 → 1758 (+389 new tests across 9 new test suites)
- Test suites: 55 → 64

### Dependencies
- Added `@modelcontextprotocol/sdk` ^1.27.1 (MCP server SDK)
- Added `zod` ^4.3.6 (MCP input schema validation)

## [1.0.5] - 2026-02-26

### Added
- `mapSshError` — 10 SSH error patterns mapped to actionable hints (connection refused, permission denied, host key, timeout, reset, hostname, command not found, disk full, broken pipe)
- `mapFileSystemError` — 4 filesystem error codes mapped to hints (ENOENT, EACCES, EPERM, ENOSPC)
- `getErrorMessage` — DRY helper replacing `error instanceof Error ? error.message : String(error)` across 15 command files

### Changed
- All 53 catch blocks now use appropriate error mappers: Provider API → `mapProviderError`, SSH → `mapSshError`, Filesystem → `mapFileSystemError`
- `mapProviderError` spread to 5 additional files (restart, maintain, status, update, snapshot)
- 3 silent catches in backup.ts now log error messages and provide SSH hints
- Test count: 1334 → 1369 (+35 new error hint integration tests)

## [1.0.4] - 2026-02-25

### Security
- Restore rollback: automatically restart Coolify if restore steps 3-5 fail after Coolify was stopped
- Fail2ban warning: show "partially complete" instead of misleading "complete" when fail2ban fails
- SSH key warnings: stronger guidance to run `quicklify secure setup` when key generation/upload fails

## [1.0.3] - 2026-02-25

### Added
- `doctor --check-tokens` — Validate provider API tokens from environment variables against live APIs (Hetzner, DigitalOcean, Vultr, Linode)
- Update notification — Check npm registry for newer versions (24h cache, non-blocking)
- Auto-open browser — Automatically open Coolify dashboard after successful `init` deployment (platform-aware, `--no-open` to disable)
- Error mapper — Actionable error messages with provider-specific URLs for billing, token management, and troubleshooting

### Changed
- Init onboarding — Improved post-deployment "What's Next?" guide with numbered steps and copy-paste commands
- README slogan updated to "Self-hosting made simple" (platform-agnostic)
- CONTRIBUTING.md completely rewritten to reflect current project state (22 commands, 5 providers, 13 utils)

### Documentation
- `llms.txt` — AI-friendly project documentation with architecture, commands, and workflows

## [1.0.2] - 2026-02-24

### Security
- Sanitize error cause chains to prevent API token leakage in all provider errors
- Mask process title when `--token` flag is used
- Replace `execSync` with `spawnSync` for ssh-keygen (prevent shell injection)
- Add shell-safe assertions to domain FQDN and DNS check commands
- Case-insensitive + nested security key detection in YAML config
- Strip unknown fields from imported server data
- Add IP address format validation to all SSH functions
- Filter sensitive environment variables from child processes
- Add `StrictHostKeyChecking` to interactive SSH connections
- Set file permissions (`0o600`) on export files
- Set directory permissions (`0o700`) on backup directories
- Add Vultr and Linode to default provider validation
- Clear `error.config.data` on Linode API failures (rootPass protection)

## [1.0.1] - 2026-02-24

### Added
- `quicklify snapshot create/list/delete` — VPS snapshot management with cost estimates
- Maintain integration: automatic snapshot offer before maintenance (with cost estimate)
- `sshKey.test.ts` — dedicated tests for SSH key utilities (13 tests)
- Provider snapshot support for Hetzner, DigitalOcean, Vultr, and Linode

### Fixed
- **domain.ts**: SQL escape for FQDN values (defense-in-depth against SQL injection)
- **restore.ts**: Path traversal protection with `basename()` for `--backup` flag
- **yamlConfig.ts**: Expanded security key detection (6 → 21 patterns including password, credential, jwt, bearer, etc.)

## [1.0.0] - 2026-02-23

### Added
- **Vultr provider** (`src/providers/vultr.ts`) - Full Vultr API v2 integration
  - Base64-encoded user_data for cloud-init
  - SSH key upload with HTTP 409 conflict handling
  - OS: Ubuntu 24.04 (os_id: 2284)
  - Power status normalization (running/stopped)
- **Linode (Akamai) provider** (`src/providers/linode.ts`) - Full Linode API v4 integration
  - Auto-generated root_pass via `crypto.randomBytes()`
  - SSH key upload via `/profile/sshkeys`
  - Metadata user_data for cloud-init (base64)
  - Disk size conversion (MB → GB)
- **`quicklify add`** command - Register existing Coolify servers to Quicklify management
  - Interactive flow: provider → token → IP → verify Coolify → save
  - Non-interactive: `--provider`, `--ip`, `--name`, `--skip-verify` flags
  - Coolify verification via SSH (health check or `docker ps`)
  - Duplicate detection by IP address
- **`quicklify maintain [query]`** command - Full maintenance cycle
  - 6-step flow: snapshot warning → status check → Coolify update → health check → reboot → final check
  - `--skip-reboot` to skip the reboot step
  - `--all` to maintain all servers sequentially
  - `--dry-run` to preview maintenance steps
- **`quicklify remove [query]`** command - Remove a server from local config without destroying the cloud server
  - Accepts server name or IP address
  - Confirmation prompt before removal
- **`--all` flag** on `status`, `update`, `backup` commands
  - `status --all`: parallel status check with table output (Promise.all)
  - `update --all`: sequential update with single confirmation prompt
  - `backup --all`: sequential backup across all servers
- **`status --autostart`** flag - Restarts Coolify via SSH if server is running but Coolify is down
  - Uses `docker compose restart coolify` command
  - Waits 5 seconds and verifies Coolify came back up
- **`collectProviderTokens()`** utility - Deduplicates token prompts per unique provider across servers
- `VULTR_TOKEN` and `LINODE_TOKEN` environment variable support
- Vultr and Linode defaults in all 3 templates (starter, production, dev)
- `"vultr"` and `"linode"` in YAML config validation
- 195 new tests across 6 new test files + enhanced existing test files

### Changed
- Provider selection now shows 4 choices: Hetzner Cloud, DigitalOcean, Vultr, Linode (Akamai)
- Provider factory supports `"vultr"` and `"linode"` cases
- Total commands: 19 → 23 (add, maintain, remove + maintain --all)
- Test count: 742 → 937
- Test suites: 40 → 44
- Coverage: 98%+ statements, 91%+ branches, 98%+ functions
- Zero new npm dependencies added

## [0.9.0] - 2026-02-21

### Added
- **`--config <path>`** flag on `quicklify init` - Load deployment parameters from a YAML config file
  - Supports all init options: provider, region, size, name, fullSetup, template, domain
  - Validates config with detailed warnings for invalid values
  - Security: detects and warns about token fields in config files
  - Handles missing files and invalid YAML syntax gracefully
- **`--template <name>`** flag on `quicklify init` - Use predefined server templates
  - `starter` - Minimal setup (cheapest option, no hardening)
  - `production` - Production-ready (larger server, auto firewall + SSH hardening)
  - `dev` - Development/testing (cheap, no hardening)
  - Per-provider defaults: Hetzner and DigitalOcean have optimized region/size pairs
- **Config merge system** with priority: CLI flags > YAML config > template defaults > interactive prompts
- `QuicklifyYamlConfig`, `TemplateName`, `TemplateDefinition` TypeScript interfaces
- `src/utils/templates.ts` - Template definitions with per-provider defaults
- `src/utils/yamlConfig.ts` - YAML config loader with validation and security checks
- `src/utils/configMerge.ts` - Multi-source config merge logic
- 106 new tests across 4 new test files (templates, yamlConfig, configMerge, init-config E2E)

### Changed
- `InitOptions` interface extended with `config` and `template` fields
- `initCommand()` now processes YAML config and template before main flow
- Total commands: 19 (unchanged)
- Test count: 636 → 742
- Test suites: 36 → 40
- Coverage: 98%+ statements, 91%+ branches, 98%+ functions

### Dependencies
- Added `js-yaml` (runtime) + `@types/js-yaml` (dev) - YAML parsing

## [0.8.0] - 2026-02-21

### Added
- **`quicklify backup [query]`** command - Backup Coolify database and config files
  - `pg_dump` + gzip for PostgreSQL database backup
  - Config tarball (`.env`, `docker-compose.yml`, `docker-compose.prod.yml`)
  - SCP download to `~/.quicklify/backups/{server-name}/{timestamp}/`
  - `manifest.json` with server info, Coolify version, file list
  - `--dry-run` flag to preview backup steps
- **`quicklify restore [query]`** command - Restore Coolify from a backup
  - Interactive backup selection from available backups
  - `--backup <timestamp>` flag to skip selection prompt
  - Double confirmation safety (confirm + type server name)
  - Full restore flow: upload → stop Coolify → start DB → restore DB → restore config → start Coolify
  - `--dry-run` flag to preview restore steps
- **`quicklify export [path]`** command - Export server list to JSON file
  - Default path: `./quicklify-export.json`
  - Custom path: `quicklify export /path/to/file.json`
- **`quicklify import <path>`** command - Import servers from JSON file
  - Format validation with field-level checking
  - Duplicate detection by server ID (skips existing)
- **`--full-setup` flag** on `quicklify init` - Auto-configure firewall + SSH hardening after deploy
  - Runs `firewallSetup()` + `secureSetup(force=true)` after Coolify health check
  - Skips interactive confirmations in automated mode
- `BackupManifest` TypeScript interface
- `BACKUPS_DIR` config constant (`~/.quicklify/backups/`)
- `validateServerRecords()` pure function for import validation
- `scpDownload()` and `scpUpload()` SCP helpers using `spawn`
- `loadManifest()` and `listBackups()` backup utility functions
- Pure command builder functions for all backup/restore SSH operations
- 137 new tests across 4 new test files + 6 enhanced test files
- Provider test coverage: uploadSshKey, rebootServer, createServer with sshKeyIds
- Doctor, monitor, restart, status, healthCheck, ssh edge case coverage

### Changed
- `firewallSetup()` now exported from `firewall.ts` (was private)
- `secureSetup()` now exported from `secure.ts` with `force` parameter to skip prompts
- Total commands: 15 → 19 (backup, restore, export, import)
- Test count: 499 → 636
- Test suites: 32 → 36
- Coverage: 98%+ statements, 90%+ branches, 98%+ functions
- Zero new npm dependencies added

## [0.7.2] - 2026-02-21

### Added
- **Auto SSH key upload** during `quicklify init` — detects local SSH key (`~/.ssh/id_ed25519.pub`, `id_rsa.pub`, `id_ecdsa.pub`) and uploads to provider (DigitalOcean/Hetzner) automatically. Eliminates password requirement on first SSH login
- **Auto SSH key generation** — if no SSH key exists, generates ed25519 key pair automatically
- **Local config cleanup on destroy failure** — when `quicklify destroy` fails (server already deleted), prompts to remove from local config

### Fixed
- **Fail2ban heredoc bug** — heredoc delimiter was not recognized when joined with `&&` chain, causing invalid config file and fail2ban crash. Replaced with `printf`
- **Fail2ban systemd backend** — added `python3-systemd` package (required for `backend = systemd` on Ubuntu)

## [0.7.1] - 2026-02-20

### Fixed
- **Domain command rewritten for Coolify v4** - Uses PostgreSQL `instance_settings` table instead of `.env` APP_URL
- Domain add now uses `docker compose -f docker-compose.yml -f docker-compose.prod.yml restart` (fixes compose error)
- Coolify existence check uses `docker ps` container check instead of `.env` file check
- DNS check fallback to `getent ahosts` (works on servers without `dig`/`dnsutils`)
- SSH restart compatibility: fallback `systemctl restart ssh` for Ubuntu/Debian (was `sshd` only)

## [0.7.0] - 2026-02-20

### Added
- **`quicklify firewall [subcommand]`** command - Manage server firewall (UFW)
  - `setup` - Install UFW + configure Coolify ports (80, 443, 8000, 6001, 6002) + SSH (22)
  - `add` - Open a port (`--port`, `--protocol tcp|udp`)
  - `remove` - Close a port (port 22 protected, Coolify ports warn before removal)
  - `list` - Show current firewall rules
  - `status` - Check UFW active/inactive state
- **`quicklify domain [subcommand]`** command - Manage server domain and SSL
  - `add` - Bind domain to Coolify (`--domain`, `--no-ssl` to disable HTTPS)
  - `remove` - Remove domain, revert to IP:8000
  - `check` - Verify DNS A record matches server IP
  - `list` - Show current APP_URL configuration
- **`quicklify secure [subcommand]`** command - SSH hardening and fail2ban
  - `setup` - Disable password auth, set root login to key-only, install fail2ban (requires SSH key check + double confirmation)
  - `status` - Show current SSH security settings
  - `audit` - Detailed security report with score (0-4)
- `--dry-run` flag on all three commands - Preview commands without executing
- Protected port system: port 22 cannot be removed via `firewall remove`
- Coolify port warnings: removing ports 80/443/8000/6001/6002 requires confirmation
- SSH key safety check: `secure setup` refuses to run if no authorized_keys found
- Pure functions for all commands (unit-testable): `isValidPort`, `isProtectedPort`, `buildUfwRuleCommand`, `parseUfwStatus`, `isValidDomain`, `sanitizeDomain`, `buildSetFqdnCommand`, `parseDnsResult`, `parseFqdn`, `parseSshdConfig`, `parseAuditResult`, `buildHardeningCommand`, `buildFail2banCommand`
- `FirewallRule`, `FirewallStatus`, `SshdSetting`, `SecureAuditResult` TypeScript interfaces
- 140 new tests across 3 test files (firewall, domain, secure)

### Changed
- Total commands: 12 → 15
- Test count: 354 → 494
- Test suites: 29 → 32
- Coverage maintained: 97%+ statements, 85%+ branches, 96%+ functions
- Zero new npm dependencies added

## [0.6.0] - 2026-02-20

### Added
- **`quicklify logs [query]`** command - View Coolify, Docker, or system logs via SSH
  - `--lines N` (default 50), `--follow` (real-time streaming), `--service coolify|docker|system`
- **`quicklify monitor [query]`** command - Show CPU, RAM, Disk usage via SSH
  - `--containers` flag to display Docker container list
- **`quicklify health`** command - Bulk health check of all registered servers
  - Parallel HTTP checks with response time measurement and table output
- **`quicklify doctor`** command - Local environment diagnostics
  - Checks Node.js version, npm, SSH client, config directory, registered servers
  - `--check-tokens` flag for future provider token validation
- `sshStream()` SSH helper - Spawns SSH with `stdio: "inherit"` for real-time log streaming
- `parseMetrics()` pure function for parsing `top`/`free`/`df` output
- `buildLogCommand()` pure function for service-to-command mapping
- `checkServerHealth()` function for individual server HTTP health checks
- 43 new tests across 5 test files (doctor, health-command, logs, monitor, ssh-utils)

### Changed
- Test count: 311 → 354
- Test suites: 25 → 29
- Coverage maintained: 97%+ statements, 87%+ branches, 96%+ functions
- Zero new npm dependencies added

## [0.5.0] - 2026-02-20

### Added
- **`quicklify config`** command - Manage default configuration (`set`, `get`, `list`, `reset`)
- **`quicklify ssh [query]`** command - SSH into a registered server (interactive or `--command` mode)
- **`quicklify update [query]`** command - Update Coolify on a registered server via SSH
- **`quicklify restart [query]`** command - Restart a server via provider API (Hetzner + DigitalOcean)
- `rebootServer()` method on `CloudProvider` interface (Hetzner + DigitalOcean implementations)
- Shared `resolveServer()` and `promptApiToken()` utilities (`src/utils/serverSelect.ts`)
- Default config management via `~/.quicklify/config.json` (`src/utils/defaults.ts`)
- SSH helper utilities: `checkSshAvailable()`, `sshConnect()`, `sshExec()` (`src/utils/ssh.ts`)
- `QuicklifyConfig` TypeScript interface
- 65 new tests across 7 new test files
- SSH availability detection for Windows/Linux/macOS

### Changed
- Extracted duplicate `selectServer()` into shared utility (DRY refactor)
- Refactored `status` and `destroy` commands to use shared `resolveServer` + `promptApiToken`
- Test count: 246 → 311
- Coverage maintained: 97%+ statements, 88%+ branches

## [0.4.1] - 2026-02-20

### Security
- **Environment variable token support** - Use `HETZNER_TOKEN` / `DIGITALOCEAN_TOKEN` env vars instead of `--token` flag to avoid shell history and `ps aux` exposure
- Config directory (`~/.quicklify/`) created with `0o700` permissions (owner only)
- Cloud-init install log restricted to `chmod 600` (root read/write only)
- Server name validation strengthened: 3-63 chars, must start with letter, end with letter/number
- SSL/HTTPS setup warnings added to `init` and `status` command output
- Updated `SECURITY.md` with current security measures and DigitalOcean API v2

### Changed
- ESLint upgraded from v9 to v10 (new `preserve-caught-error` rule compliance)
- Updated dependencies: axios 1.13, chalk 5.6, commander 14, ora 9, tsx 4.21, typescript 5.9
- Minimum Node.js version: 20 (ESLint 10 + ora 9 + commander 14 requirement)
- CI matrix: 3 OS x 2 Node versions (dropped Node 18)
- Non-interactive mode now detected by `--provider` flag alone (token can come from env var)
- `--token` option description updated to mention env var alternatives

## [0.4.0] - 2026-02-20

### Added
- **`quicklify list`** command - List all registered servers (no token required)
- **`quicklify status [query]`** command - Check server and Coolify status by IP or name
- **`quicklify destroy [query]`** command - Destroy a server with double confirmation safety
- **Non-interactive mode** for `quicklify init` with `--provider`, `--token`, `--region`, `--size`, `--name` flags
- **Coolify health check polling** - Replaces blind wait with intelligent `http://IP:8000` polling
- **Server record persistence** - Successful deploys saved to `~/.quicklify/servers.json`
- `ServerRecord` and `InitOptions` TypeScript interfaces
- `src/utils/config.ts` - Config module for server record CRUD (`getServers`, `saveServer`, `removeServer`, `findServer`)
- `src/utils/providerFactory.ts` - Provider factory extracted from init.ts for better testability
- `src/utils/healthCheck.ts` - `waitForCoolify()` with configurable polling (min wait + 5s interval + max attempts)
- `destroyServer()` method on `CloudProvider` interface (Hetzner + DigitalOcean implementations)
- 86 new tests: config, list, status, destroy, healthCheck, providerFactory, edge cases, E2E flows
- Edge case test coverage: config corruption, health check retries, non-interactive validation

### Changed
- `initCommand` now accepts `InitOptions` parameter for non-interactive mode
- Init flow uses `waitForCoolify()` instead of fixed `setTimeout` (faster with early exit on success)
- Init flow saves server record to local config after successful deploy
- Success message now includes `quicklify status` and `quicklify list` hints
- Provider creation extracted to `providerFactory.ts` (no behavior change)
- Test count: 145 → 233
- Coverage maintained: 97%+ statements, 89%+ branches, 96%+ functions

### Fixed
- Non-interactive mode properly exits with code 1 on invalid provider or token
- Health check accepts any HTTP response (200, 302, 401, 500) as "Coolify is running"
- `destroy` now removes local config record when server already deleted from provider ("not found")

## [0.3.1] - 2026-02-19

### Fixed
- Hetzner pricing now shows net prices (excl. VAT) matching website display
- Hetzner server types filtered by `/datacenters` API for real availability
- Replaced deprecated Hetzner server types (cpx→cx23/cx33, per Jan 2026 deprecation)
- "Server name already used" error now prompts for a new name instead of crashing
- Location disabled retry now re-prompts for both region and server type
- Back navigation in error retry flows (server type → region)
- Updated static fallback prices to match current Hetzner net pricing

### Changed
- `getLocationConfig` now accepts `exclude` parameter to filter disabled locations

## [0.3.0] - 2026-02-19

### Added
- DigitalOcean provider implementation (full API integration)
- Provider selection UI prompt (Hetzner Cloud / DigitalOcean)
- `getProviderConfig()` prompt function
- DigitalOcean-specific interfaces (`DORegion`, `DOSize`, `DOErrorResponse`)
- Step-based back navigation with `← Back` option in all prompts
- `getServerDetails()` + IP refresh for DigitalOcean delayed IP assignment
- Minimum 2GB RAM + 2 vCPU filter for Coolify requirements
- Network connectivity wait loop in cloud-init (DigitalOcean cloud-init timing fix)
- Installation logging to `/var/log/quicklify-install.log` for troubleshooting
- Troubleshooting info in deployment success message
- Location retry on "server location disabled" error (offers region change)
- 50+ new tests (DigitalOcean integration, provider selection, E2E flows)

### Changed
- `init` command now prompts for provider selection instead of defaulting to Hetzner
- DigitalOcean image changed from Ubuntu 24.04 to 22.04 (stable cloud-init support)
- Hetzner server type filtering now uses `/datacenters` API for real availability
- Replaced deprecated Hetzner server types (cpx→cx23/cx33, per Jan 2026 deprecation)
- Provider-specific deployment timing (Hetzner ~5 min, DigitalOcean ~7 min)
- Cloud-init script now uses `set +e` for resilient execution
- UFW firewall support for DigitalOcean (alongside iptables for Hetzner)
- Updated `typescript-eslint` from 8.55 to 8.56
- Test count: 95 → 143+

### Fixed
- Hetzner deprecated server types (cpx11, cx22 etc.) shown but failing on creation
- DigitalOcean cloud-init failing due to network not ready at script execution time
- Hetzner pricing now shows net prices (excl. VAT) matching website display
- Coverage gaps in Hetzner provider (price null fallback, error.data.error undefined)

## [0.2.8] - 2026-02-16

### Added
- ESLint 9 + typescript-eslint 8 + Prettier setup with npm scripts
- `.prettierrc` and `eslint.config.js` configuration files
- `CHANGELOG.md` with full version history
- `CONTRIBUTING.md` with development guide and PR process
- Proper TypeScript interfaces for Hetzner API responses (`HetznerLocation`, `HetznerServerType`, `HetznerPrice`, `HetznerErrorResponse`)
- `isAxiosError` mock in test helpers

### Changed
- Replaced all `catch (error: any)` with `catch (error: unknown)` + proper type guards
- Replaced `any` type annotations with proper interfaces in Hetzner provider
- Applied Prettier formatting across all source files

## [0.2.7] - 2026-02-16

### Changed
- Updated README with accurate feature descriptions and missing version history
- Fixed inaccurate SECURITY.md claims (token handling, SDK references)
- Added npm keywords for better discoverability (vps, cloud, automation, self-hosted, paas, devops, server)

### Security
- Added server name sanitization in cloud-init script (defense-in-depth)

## [0.2.6] - 2026-02-16

### Changed
- CI: Upgraded Codecov action to v5

## [0.2.5] - 2026-02-16

### Added
- CI: Codecov integration for automatic coverage badge

## [0.2.4] - 2026-02-15

### Changed
- Refactor: Removed recommended label from server type selection
- Excluded failed server types from retry list

## [0.2.3] - 2026-02-15

### Fixed
- Unsupported server type error now triggers retry
- Dynamic deployment summary based on actual server config
- Dynamic recommended server type selection

## [0.2.2] - 2026-02-15

### Added
- Deprecated server type filtering
- Retry mechanism for unavailable server types

## [0.2.1] - 2026-02-14

### Fixed
- URL protocol changed from https to http for initial Coolify setup

## [0.2.0] - 2026-02-14

### Added
- Dynamic server type filtering based on selected location
- Auto firewall configuration (ports 8000, 22, 80, 443)

### Changed
- Improved price formatting

### Removed
- Debug logs

## [0.1.11] - 2026-02-14

### Changed
- Removed tracked Claude Code local settings

### Added
- Firewall rules to cloud-init
- Security notes to README

## [0.1.10] - 2026-02-14

### Fixed
- Updated deploy time estimate from 60 seconds to 4 minutes

## [0.1.9] - 2026-02-14

### Fixed
- Read version from package.json dynamically

## [0.1.8] - 2026-02-14

### Fixed
- Added build step to publish workflow

## [0.1.7] - 2026-02-14

### Fixed
- Added .npmignore to include dist/ in npm package

## [0.1.6] - 2026-02-14

### Fixed
- Added bin wrapper for Windows npx compatibility

## [0.1.5] - 2026-02-14

### Fixed
- Added files field to include dist/ in npm package

## [0.1.4] - 2026-02-14

### Added
- SECURITY.md with security policy
- Socket.dev security badge
- Package.json metadata (repository, bugs, homepage, author)

## [0.1.3] - 2026-02-14

### Added
- Auto npm publish workflow via GitHub Actions
- GitHub stars badge to README

## [0.1.2] - 2026-02-14

### Changed
- Updated deploy time references from 60s to 4 minutes

## [0.1.1] - 2026-02-14

### Fixed
- Corrected bin field in package.json
- Added status badges to README

## [0.1.0] - 2026-02-14

### Added
- Initial release
- Hetzner Cloud integration
- Interactive CLI with Commander.js + Inquirer.js
- Automated Coolify installation via cloud-init
- ARM64 support
- Full test suite (unit, integration, e2e)
