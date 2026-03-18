# Phase 56: Lock Expansion - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Expand `kastell lock` from 5 to 16 hardening steps. New steps: login banners, auditd, resource limits, service disabling, APT validation, log retention, cloud metadata block, account locking, AIDE file integrity, backup permissions, DNS security. Audit score target: 53→75-85. All steps use `runLockStep()` helper for maintainability.

</domain>

<decisions>
## Implementation Decisions

### DNS Security Step
- **Default-on with rollback**: Apply DNSSEC + DNSOverTLS via systemd-resolved drop-in, then verify connectivity
- **Rollback flow**: Backup existing resolved.conf → write new config → restart systemd-resolved → `dig google.com` with 5s timeout → if fails, restore backup and restart
- **On rollback**: `steps.dns = false` + actionable hint: "DNS rollback yapıldı — resolved config'inizi kontrol edin"
- **On success**: `steps.dns = true`, no extra messaging needed

### AIDE File Integrity Step
- **Fire-and-forget**: Install AIDE package, start `aide --init` in background (`nohup ... &`), add daily cron check
- **Cron schedule**: Daily at 05:00 (CIS benchmark recommendation)
- **Hint message**: `steps.aide = true` + hint: "AIDE db init arka planda çalışıyor, 2-6dk içinde hazır olacak"
- **Lock does NOT wait** for AIDE init to complete — no timeout risk

### Lock Output Organization
- **4 grouped sections** in execution order:
  1. **SSH & Auth**: SSH hardening, Fail2ban, Login banners, Account locking
  2. **Firewall & Network**: UFW firewall, Cloud metadata block, DNS security
  3. **System**: Sysctl hardening, Unattended upgrades, APT validation, Resource limits, Service disabling, Backup permissions
  4. **Monitoring**: Auditd, Log retention, AIDE integrity
- **Dry-run**: Same grouped format with `○` markers ("would apply")
- **Failed steps**: `✗ + reason` (e.g., "✗ DNS security (rollback: connectivity test failed)")

### Execution Order & Dependencies
- **Logical grouping**: Execution order matches output groups (SSH/Auth → Firewall/Network → System → Monitoring)
- **Existing 5 steps reordered** to fit group structure (no backward compat risk — lock is atomic, step order invisible to user)
- **Cloud metadata depends on UFW**: If UFW step failed, skip cloud metadata with hint: "UFW gerekli — önce firewall adımını düzelt"
- **Package install timeout**: 60s per step (auditd, aide, rsync are small packages)
- **Service disabling**: Fixed list (bluetooth, avahi-daemon, cups, rpcbind) with `systemctl list-unit-files` existence check before disable — skip silently if not installed

### Non-Fatal Pattern (LOCK-12)
- Every new step is non-fatal — individual failure does not abort lock
- Each step wrapped in try/catch, sets `steps.X = true/false`
- Consistent with existing 5-step pattern

### Claude's Discretion
- `runLockStep()` helper implementation details (signature, error capture, logging)
- LockStepResult interface field naming for 11 new booleans
- auditd baseline rules selection (specific syscalls to watch)
- Resource limits values (nproc, nofile thresholds)
- Account locking UID threshold (which UIDs to protect)
- Backup directory permissions specifics
- APT validation config file location and content
- Log retention rsyslog/logrotate specifics
- Login banner text content

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Lock Implementation
- `src/core/lock.ts` — Current 5-step lock implementation, LockStepResult interface, applyLock() orchestrator
- `src/core/secure.ts` — buildHardeningCommand(), buildFail2banCommand() — SSH/fail2ban command builders
- `src/core/firewall.ts` — buildFirewallSetupCommand() — UFW setup with platform awareness

### Audit Integration
- `src/core/audit/index.ts` — runAudit() used for pre/post score comparison
- `src/core/audit/checks/` — Audit check catalog (409 checks, 27 categories) — lock steps should improve scores in relevant categories

### Types & Constants
- `src/types/index.ts` — Platform type, ServerMode
- `src/constants.ts` — LOCK_FIREWALL_TIMEOUT_MS, LOCK_UPGRADES_TIMEOUT_MS

### MCP
- `src/mcp/tools/server_lock.ts` — MCP tool wrapper for lock command (description update needed per LOCK-15)

### Requirements
- `.planning/REQUIREMENTS.md` — LOCK-01 through LOCK-15 acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sshExec()` from `src/utils/ssh.ts` — SSH command execution with timeout support
- `raw()` from `src/utils/sshCommand.ts` — Raw SSH command builder for multi-line scripts
- `buildHardeningCommand()`, `buildFail2banCommand()` — Existing command builder pattern to follow
- `buildFirewallSetupCommand(platform)` — Platform-aware command builder example
- `assertValidIp()` — IP validation before SSH

### Established Patterns
- **Command builder pattern**: `buildXCommand()` returns `SshCommand`, called via `sshExec(ip, cmd, opts)`
- **Non-fatal try/catch**: Each step in its own try/catch, sets boolean on success
- **Timeout constants**: Defined in `constants.ts` (LOCK_FIREWALL_TIMEOUT_MS = 60s, LOCK_UPGRADES_TIMEOUT_MS = 120s)
- **Pre/post audit**: Score comparison before and after lock

### Integration Points
- `LockStepResult` interface: Needs 11 new boolean fields
- `applyLock()` orchestrator: Add 11 new step blocks + reorder existing 5
- MCP `server_lock` tool: Description update for 16 steps
- CLI `lock` command: Output formatting (grouped sections)

</code_context>

<specifics>
## Specific Ideas

- DNS rollback pattern is unique among lock steps — only step with active rollback logic
- AIDE is only async step — hint pattern communicates this clearly
- Output grouping should match execution order for mental model consistency
- Failure messages should be actionable, not just status flags (learned from DNS discussion)
- "Hint mesajı" pattern established: steps.X = false + human-readable explanation of what happened and what to do

</specifics>

<deferred>
## Deferred Ideas

- Docker runtime hardening (user namespace, no-new-privileges) — v1.12 (platform-dependent)
- SSH cipher whitelist / TLS config — v1.12 (crypto hardening)
- Boot security (GRUB password) — excluded, 9/11 checks irrelevant for VPS
- `--level basic|full` parameter — not needed, always full
- Platform-aware service lists (Coolify/Dokploy specific) — v1.12 if needed

</deferred>

---

*Phase: 56-lock-expansion*
*Context gathered: 2026-03-18*
