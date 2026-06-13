# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in Kastell:

1. **DO NOT** open a public issue
2. Email: hello@omrfc.dev
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

Response time: Within 48 hours

## Security Architecture

### Token Handling (A2 — Sensitive Data Exposure)
- Token resolution chain: OS keychain (primary) -> environment variable (fallback) -> undefined
- Supported env vars: `HETZNER_TOKEN`, `DIGITALOCEAN_TOKEN`, `VULTR_TOKEN`, `LINODE_TOKEN`
- `kastell auth set <provider>` stores tokens in OS keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- Tokens are never written to disk in plaintext
- API tokens collected via interactive secure prompts (masked input) when neither keychain nor env var is available
- `sanitizedEnv()` strips all keys containing TOKEN, SECRET, PASSWORD, CREDENTIAL from child process environments before every `spawn`/`spawnSync`/`exec` call
- Provider errors sanitized via `stripSensitiveData()` — removes Authorization headers, request data, response headers, and non-whitelisted response body fields from axios errors before they propagate via error cause chains

### Input Validation (A1 — Injection)
- All shell execution uses `spawn`/`spawnSync` with array arguments (never string interpolation into shell commands)
- `assertValidIp()` — IPv4 format and octet range (0-255) validation applied before every SSH/SCP connection and before ssh-keygen calls (defense-in-depth)
- `assertSafePath()` — rejects remote SCP paths containing shell metacharacters (`;`, `|`, `&`, `$`, `` ` ``, `(`, `)`, `<`, `>`, newlines, spaces)
- Server name validation: 3-63 chars, lowercase alphanumeric + hyphens, must start with letter
- `buildHardeningCommand()` — SSH port option validated as integer in range 1-65535 before interpolation into sed command
- `buildDockerHardeningCommand()` — JSON settings passed to jq via stdin pipe (`printf '%s' | jq -s`), never via shell string interpolation
- `buildSshCipherCommand()` — sshd_config validated with `sshd -t` before restart; automatic rollback on failure
- YAML config: 22+ security key patterns detected and warned
- MCP tools: Zod schema validation on all inputs (port ranges, provider enums, backup ID regex)

### SSH & Network Security
- `StrictHostKeyChecking=accept-new` for initial connections (first connect accepts key, subsequent connections verify)
- `BatchMode=yes` on non-interactive SSH (prevents stdin hijacking — critical for MCP mode)
- `ConnectTimeout=10` and 30s exec timeout prevent hanging connections
- Stale host key auto-removal with IP re-validation before `ssh-keygen -R` calls
- SSRF defense: `assertValidIp()` on all Coolify health check targets

### File System Security (A5 — Security Misconfiguration)
- Config directory (`~/.kastell/`) created with `0o700` permissions (owner only)
- Server config file written with `0o600` permissions (owner read/write only)
- Backup directories created with `0o700` permissions
- Backup manifest files written with `0o600` permissions
- Export files written with `0o600` permissions
- Cloud-init install log restricted to `chmod 600` (root only)

### Error Handling & Data Exposure
- `getErrorMessage()` returns only `error.message` — never exposes stack traces to users
- `sanitizeStderr()` redacts home directory paths, IP addresses, `password=`, `token=`, `secret=` patterns from SSH stderr output (200 char limit)
- MCP error responses use `getErrorMessage()` — no stack trace disclosure

### Path Traversal Protection (A5)
- Backup restore: `backupId` regex validation + `path.resolve()` guard ensures backup path stays within the server's backup directory
- Remote SCP paths validated by `assertSafePath()` before use

### Access Control (A3 — Broken Access Control)
- **SAFE_MODE** (`KASTELL_SAFE_MODE=true`, default enabled for MCP) blocks destructive operations: `destroy`, `restore`, `snapshot-delete`, `provision`, `restart`, `maintain`, `snapshot-create`
- Mode guard (`requireCoolifyMode()`) prevents Coolify-specific operations on bare servers

### Claude Code Plugin Security
- Plugin hooks run in the Claude Code process — no separate daemon or elevated privileges
- `destroy-block` hook prevents accidental `kastell destroy` without explicit `--force` flag
- `pre-commit-audit-guard` hook compares audit scores before/after — blocks commit if score drops
- `session-audit` hook runs `kastell audit --silent` at session start — informational only, never blocks
- Plugin agents (`kastell-auditor`) use `memory: user` scope — audit data stays in user's Claude context
- `kastell-fixer` uses `isolation: worktree` — runs in a separate git worktree, cannot modify the working tree directly
- All hooks use Node.js (not shell scripts) for Windows cross-platform compatibility

### Import/Export Security
- Sensitive field stripping on import
- Strict file permissions on export
- Format validation with field-level checking
- Duplicate detection by server ID

## OWASP Top 10 Compliance Summary

| Category | Status | Implementation |
|----------|--------|----------------|
| A1 - Injection | Mitigated | `spawn` array args, `assertValidIp`, `assertSafePath`, port integer validation |
| A2 - Sensitive Data Exposure | Mitigated | `sanitizedEnv()` on all child processes, `stripSensitiveData()` on provider errors, tokens never on disk |
| A3 - Broken Access Control | Mitigated | SAFE_MODE blocks destructive ops, mode guard on Coolify-only ops |
| A4 - Insecure Design | N/A | CLI tool, minimal attack surface |
| A5 - Security Misconfiguration | Mitigated | Restrictive file permissions (0o600/0o700), timeout limits, buffer caps |
| A6 - Vulnerable Components | See below | Production: 0 vulnerabilities |
| A7 - XSS | N/A | CLI tool, no web UI |
| A8 - Insecure Deserialization | Mitigated | JSON.parse wrapped in try/catch with safe defaults |
| A9 - Logging & Monitoring | Mitigated | `sanitizeStderr()` prevents sensitive data in logs, MCP structured logging via `sendLoggingMessage()` |
| A10 - SSRF | Mitigated | `assertValidIp()` on all outbound SSH/HTTP targets |

## Dependency Security

### Production Dependencies (0 known vulnerabilities)
```
npm audit --omit=dev → found 0 vulnerabilities
```

All production dependencies use audited, versioned packages:
- Hetzner Cloud API v1 (via Axios, HTTPS)
- DigitalOcean API v2 (via Axios, HTTPS)
- Vultr API v2 (via Axios, HTTPS)
- Linode API v4 (via Axios, HTTPS)
- Model Context Protocol SDK (`@modelcontextprotocol/sdk`) for MCP server
- Zod for runtime input validation
- Coolify installed via download-then-execute pattern: `curl -fsSL URL -o /tmp/install.sh && bash /tmp/install.sh` (prevents partial execution on network failure)

### Dev Dependencies
No known vulnerabilities (minimatch pinned to ^10.2.4 via npm overrides).

Security scan: https://socket.dev/npm/package/kastell

## Token Security

### OS Keychain Integration

Kastell stores provider API tokens in the OS keychain using `@napi-rs/keyring`:

- **Windows:** Windows Credential Manager
- **macOS:** Keychain
- **Linux:** Secret Service (GNOME Keyring, KWallet)

Use `kastell auth set <provider>` to store tokens securely. Use `kastell auth list` to see which providers have stored tokens (token values are never displayed). Use `kastell auth remove <provider>` to delete a stored token.

In CI/headless environments where no keychain is available, Kastell automatically falls back to environment variables.

### Subprocess Security

All child processes spawned by Kastell use `sanitizedEnv()` which strips TOKEN, SECRET, PASSWORD, and CREDENTIAL environment variables. This prevents accidental token leakage to SSH sessions and other subprocesses.

### Disabling Core Dumps (Recommended for MCP/Long-Running Mode)

Core dumps can expose in-memory tokens. Disable on production servers:

**Linux:**
- `ulimit -c 0` (current session)
- `echo "* hard core 0" >> /etc/security/limits.conf` (permanent)

**macOS:**
- `launchctl limit core 0 0`

### Swap Encryption (Recommended)

Unencrypted swap can expose in-memory tokens when pages are swapped to disk.

- **Linux:** Use encrypted swap (`cryptsetup` or `dm-crypt`)
- **macOS:** Encrypted by default with FileVault
- **Windows:** BitLocker encrypts the entire volume including pagefile

## Known Limitations & Accepted Risks

### 1. SSH Trust-On-First-Use (TOFU)

All SSH connections use `StrictHostKeyChecking=accept-new`. This automatically trusts the host key on first connection. A MITM attack during the very first SSH connection to a newly provisioned server would succeed silently.

**Why accepted:** Newly provisioned servers have unknown host keys — there is no known-good key to verify against. This is inherent to any server provisioning tool. Subsequent connections verify the stored key, so only the first connection is vulnerable.

**Mitigation:**
- Servers are provisioned via authenticated cloud provider APIs (HTTPS + API token), reducing the likelihood of a MITM during the narrow window between provision and first SSH connection.
- Set `KASTELL_STRICT_HOST_KEY=true` to reject unknown host keys entirely. This requires manual host key management but eliminates TOFU risk.

### 2. Health Checks Over HTTP

Coolify (`http://IP:8000`) and Dokploy (`http://IP:3000`) health checks use unencrypted HTTP. No sensitive data is sent — only an HTTP status code is checked.

**Why accepted:** Fresh Coolify/Dokploy installations only listen on HTTP. HTTPS requires a domain + SSL certificate, which is configured after initial setup via `kastell domain-set --ssl`.

**Mitigation:** When a domain is configured via `kastell domain add --domain example.com`, health checks automatically try HTTPS first, falling back to HTTP only if HTTPS fails. The domain is stored in the server record for persistent HTTPS health checks.

**Recommendation:** Always configure a domain with SSL for production access: `kastell domain add <server> --domain example.com`

### 3. API Token In-Memory Exposure

Provider API tokens are held as class properties in memory for the lifetime of the process.

**CLI mode (low risk):** Process runs for seconds, then exits. Token is freed with the process.

**MCP mode (elevated risk):** MCP server runs for hours. Token stays in memory and could theoretically be exposed via heap dump, core dump, or debugger attachment.

**Why accepted:** Node.js strings are immutable and managed by V8's garbage collector — there is no reliable way to zero a string in memory. Alternative approaches (Buffer-based token storage) would require changing all axios header construction and provide marginal benefit since `process.env` also holds the token in memory.

**Mitigations in place:**
- `sanitizedEnv()` strips tokens from all child process environments
- `stripSensitiveData()` removes Authorization headers from error objects
- Provider instances are not cached across MCP tool calls — each call creates a fresh instance, allowing GC to collect the previous one
- Tokens are never written to disk

**Future consideration:** Getter pattern that reads from `process.env` on each API call instead of storing as class property — reduces in-memory copies but does not eliminate the underlying exposure since `process.env` itself holds the value.

### 4. Remote Install Scripts

Coolify and Dokploy are installed via remote shell scripts downloaded over HTTPS. A compromised CDN or DNS hijack could serve a malicious install script.

**Why accepted:** This is the official installation method provided by both Coolify and Dokploy upstream projects. There are no published checksums to verify against.

**Mitigations in place:**
- HTTPS transport security (TLS certificate validation)
- Download-then-execute pattern (prevents partial execution on network interruption)
- **Script validation before execution:** Downloaded scripts are verified to start with a shebang (`#!`) and have a minimum size (>100 bytes) before being executed. A truncated, empty, or non-script response will be rejected.
- Install scripts are downloaded to `/tmp/` and cleaned up after execution

## v2.3.1 local hardening

The contracts below are shipped in v2.3.1 and apply to the local Kastell process (CLI and MCP server). They are operator-facing — refer to the CHANGELOG for the full list of code-level changes.

- **`KASTELL_STRICT_HOST_KEY=true` (SSH TOFU behavior)** — by default, Kastell uses `StrictHostKeyChecking=accept-new` and emits a one-time TOFU warning on the first connection to a new host. Setting `KASTELL_STRICT_HOST_KEY=true` rejects unknown host keys outright. Operators who need zero TOFU exposure should pin this in their shell profile or CI environment.
- **Non-TTY destructive command guard** — destructive CLI commands invoked without an attached TTY (CI, cron, automation) must be paired with an explicit `--force` flag, or with the command's documented opt-in (e.g. `--unsafe-skip-reboot`). Commands that do not receive an explicit opt-in exit with a non-zero status. This protects against accidental destructive execution from unattended scripts.
- **Structured skipped checks (audit)** — checks that are not executed (VPS-irrelevant, platform-mismatch, missing prerequisite) are reported as a neutral, visible result in the audit output. Operators can see the full universe of checks and the reason for each skip; nothing is silently dropped from the audit trail.
- **Windows secret file ACLs** — on Windows, secret-bearing files written by Kastell (e.g. token cache, fix history, audit snapshots) are created with restrictive ACLs that grant access only to the current user. POSIX `0o600` remains the source of truth on Linux/macOS; Windows uses the equivalent DACL via `icacls`.
- **QuickWin JSON contract** — `kastell audit --json` QuickWin entries now include `id` (check ID) and `severity` in addition to the human-readable description. This makes QuickWins directly consumable by automation without re-parsing the description field. MCP `server_audit` responses include the same shape.
- **FORBIDDEN preview reasons** — `--dry-run` output (CLI) and `server_fix` dry-run responses (MCP) now include a `forbiddenReason` for each FORBIDDEN-tier fix, explaining the risk (e.g. "requires reboot", "disrupts active SSH sessions", "can lock out remote operators"). Operators see why a fix is FORBIDDEN, not just that it is.
