# Changelog

All notable changes to this project will be documented in this file.

## [1.8.2] - 2026-03-15

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
