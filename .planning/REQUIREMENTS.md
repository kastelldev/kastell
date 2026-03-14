# Requirements: Kastell v1.7 Guard Core

**Defined:** 2026-03-14
**Core Value:** Autonomous server security and maintenance across multiple cloud providers

## v1.7 Requirements

### Lock

- [x] **LOCK-01**: User can harden a server with one command (`kastell lock <server> --production`)
- [x] **LOCK-02**: Lock applies SSH key-only auth, fail2ban, UFW, sysctl hardening, unattended-upgrades
- [x] **LOCK-03**: Lock is idempotent — running twice is safe, skips already-applied steps
- [x] **LOCK-04**: Lock is platform-aware (Coolify:8000, Dokploy:3000 port exceptions in UFW)
- [x] **LOCK-05**: Lock supports `--dry-run` to preview changes without applying
- [x] **LOCK-06**: Lock shows audit score before/after hardening

### Guard

- [x] **GUARD-01**: User can start guard daemon on a server (`kastell guard start <server>`)
- [x] **GUARD-02**: Guard installs as remote cron on VPS (shell script + crontab entry), not local daemon
- [x] **GUARD-03**: Guard checks disk, RAM, CPU thresholds and logs breaches
- [x] **GUARD-04**: Guard runs scheduled re-audit and logs score regressions
- [x] **GUARD-05**: User can stop guard daemon (`kastell guard stop <server>`)
- [x] **GUARD-06**: User can check guard status (`kastell guard status <server>`)
- [x] **GUARD-07**: Guard is idempotent — `start` twice replaces crontab entry, no duplicates
- [x] **GUARD-08**: Guard logs to `/var/log/kastell-guard.log` on the VPS
- [x] **GUARD-09**: Guard writes MetricSnapshot on each run (feeds doctor)
- [x] **GUARD-10**: Guard has notification hook point — ready to wire when v1.8 notification module lands

### Backup Schedule

- [x] **BKUP-01**: User can schedule backups via remote cron (`kastell backup <server> --schedule "cron-expr"`)
- [x] **BKUP-02**: User can list scheduled backup cron entry (`--schedule list`)
- [x] **BKUP-03**: User can remove scheduled backup cron entry (`--schedule remove`)
- [x] **BKUP-04**: Schedule is idempotent — calling twice replaces entry, no duplicates
- [x] **BKUP-05**: Overlap protection — lock file prevents concurrent backup runs

### Risk Trend

- [x] **TREND-01**: User can view audit score trend (`kastell audit <server> --trend`)
- [x] **TREND-02**: Each trend data point shows score, delta, and cause list (which checks changed)
- [x] **TREND-03**: Trend supports `--days N` for time-bounded view
- [x] **TREND-04**: Trend supports `--json` for machine-readable output
- [x] **TREND-05**: Graceful fallback when snapshots missing — show score without cause

### Doctor

- [x] **DOC-01**: User can run proactive analysis (`kastell doctor <server>`)
- [x] **DOC-02**: Doctor detects disk trending full (linear extrapolation from 2+ data points)
- [x] **DOC-03**: Doctor detects high swap usage, stale packages, high fail2ban ban rate
- [x] **DOC-04**: Doctor detects audit regression streaks and old backups
- [x] **DOC-05**: Doctor detects reclaimable Docker disk space
- [x] **DOC-06**: Each finding has severity (critical/warning/info), description, and recommended command

### MCP Integration

- [x] **MCP-01**: MCP tools added for guard (start/stop/status)
- [x] **MCP-02**: MCP tools added for doctor, lock
- [x] **MCP-03**: Shell completions updated for new commands

## v1.8 Requirements (Deferred)

### Notifications (Full)
- **NOTIF-01**: User can configure Telegram notification channel (bot token + chat ID)
- **NOTIF-02**: User can configure Discord notification channel (webhook URL)
- **NOTIF-03**: User can configure Slack notification channel (webhook URL)
- **NOTIF-04**: User can configure Email notification channel (SMTP host, from, to via nodemailer)
- **NOTIF-05**: User can test notification delivery per channel (`kastell notify test <channel>`)
- **NOTIF-06**: Guard/doctor sends alerts via all configured channels with graceful per-channel failure
- **NOTIF-07**: Notification rate limiting — max 1 alert per finding type per 30 min per server

### Fleet (Full)
- **FLEET-01**: User can see all servers with status + audit score in one table (`kastell fleet`)
- **FLEET-02**: Fleet uses parallel execution with concurrency cap and per-server timeout
- **FLEET-03**: Fleet handles partial failure gracefully — offline servers show "OFFLINE" row
- **FLEET-04**: Fleet supports `--json` for scripting
- **FLEET-05**: `--sort` and `--filter` flags for fleet table

### Doctor Enhancements
- **DOC-07**: `kastell doctor --fix` — auto-remediation prompts per finding

## Out of Scope

| Feature | Reason |
|---------|--------|
| AI/ML anomaly detection | PROJECT.md: deterministic thresholds only |
| Local daemon (PM2/systemd) | Guard runs as remote cron, not local process |
| Web dashboard for fleet | v3.0 territory |
| Notification queue/persistence | Fire-and-forget with single retry sufficient at indie scale |
| Auto-remediation without confirmation | Trust barrier — guard alerts + suggests, user acts |
| Slack/Discord bot commands | One-way push only |
| Fleet centralized metrics server | Pull-based (SSH at query time), no hosted backend |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LOCK-01 | Phase 28 | Complete |
| LOCK-02 | Phase 28 | Complete |
| LOCK-03 | Phase 28 | Complete |
| LOCK-04 | Phase 28 | Complete |
| LOCK-05 | Phase 28 | Complete |
| LOCK-06 | Phase 28 | Complete |
| BKUP-01 | Phase 29 | Complete |
| BKUP-02 | Phase 29 | Complete |
| BKUP-03 | Phase 29 | Complete |
| BKUP-04 | Phase 29 | Complete |
| BKUP-05 | Phase 29 | Complete |
| GUARD-01 | Phase 30 | Complete |
| GUARD-02 | Phase 30 | Complete |
| GUARD-03 | Phase 30 | Complete |
| GUARD-04 | Phase 30 | Complete |
| GUARD-05 | Phase 30 | Complete |
| GUARD-06 | Phase 30 | Complete |
| GUARD-07 | Phase 30 | Complete |
| GUARD-08 | Phase 30 | Complete |
| GUARD-09 | Phase 30 | Complete |
| GUARD-10 | Phase 30 | Complete |
| TREND-01 | Phase 31 | Complete |
| TREND-02 | Phase 31 | Complete |
| TREND-03 | Phase 31 | Complete |
| TREND-04 | Phase 31 | Complete |
| TREND-05 | Phase 31 | Complete |
| DOC-01 | Phase 32 | Complete |
| DOC-02 | Phase 32 | Complete |
| DOC-03 | Phase 32 | Complete |
| DOC-04 | Phase 32 | Complete |
| DOC-05 | Phase 32 | Complete |
| DOC-06 | Phase 32 | Complete |
| MCP-01 | Phase 33 | Complete |
| MCP-02 | Phase 33 | Complete |
| MCP-03 | Phase 33 | Complete |

**Coverage:**
- v1.7 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-14 — Traceability filled (phases 28-33), 35/35 mapped*
