# Requirements: Kastell v1.8

**Defined:** 2026-03-14
**Core Value:** Autonomous server security and maintenance across multiple cloud providers

## v1.8 Requirements

### Fleet Visibility

- [ ] **FLEET-01**: User can see all servers' health and cached audit score in a single table
- [ ] **FLEET-02**: User can get fleet data as JSON output (--json)
- [ ] **FLEET-03**: User can sort fleet table by score/name/provider (--sort)
- [ ] **FLEET-04**: Fleet handles unreachable servers gracefully (OFFLINE row, no crash)
- [ ] **FLEET-05**: MCP server_fleet tool provides fleet data to Claude

### Notifications

- [ ] **NOTF-01**: User can configure Telegram notifications (botToken + chatId in config.yaml)
- [ ] **NOTF-02**: User can configure Discord notifications (webhookUrl in config.yaml)
- [ ] **NOTF-03**: User can configure Slack notifications (webhookUrl in config.yaml)
- [ ] **NOTF-04**: User can test notification config with `kastell notify test <channel>`
- [ ] **NOTF-05**: Notifications fan-out to all configured channels simultaneously
- [ ] **NOTF-06**: Alert cooldown prevents duplicate alerts (30min per server per finding type)
- [ ] **NOTF-07**: Guard daemon sends breach alerts via configured notification channels

### Doctor Fix

- [ ] **DFIX-01**: User can run `kastell doctor --fix` with per-finding interactive confirmation
- [ ] **DFIX-02**: `--fix --force` skips confirmation prompts for CI/scripting
- [ ] **DFIX-03**: `--fix --dry-run` shows fix commands without executing

### Tech Debt

- [x] **DEBT-01**: Adapter backup/restore duplication eliminated (shared utilities)
- [x] **DEBT-02**: Layer violation fixed (core/deploy.ts no longer imports from commands/)
- [ ] **DEBT-03**: Shell completions updated (audit, evidence + missing flags)
- [ ] **DEBT-04**: postSetup decomposed into bare/platform functions

## Future Requirements

### Notifications (v1.8.x+)

- **NOTF-08**: User can configure Email/SMTP notifications (nodemailer)
- **NOTF-09**: Doctor critical findings trigger automatic notification

### Fleet (v1.8.x+)

- **FLEET-06**: Fleet --filter flag (provider, platform, score range)
- **FLEET-07**: Fleet --watch live refresh

## Out of Scope

| Feature | Reason |
|---------|--------|
| Fleet web dashboard | v3.0 territory — requires auth, hosting, reverse proxy |
| Slack/Discord interactive bot | Bot infrastructure (listener, command parsing, auth) is v2.0+ |
| Notification retry queue / persistence DB | Over-engineering for indie-hacker scale; fire-and-forget + 1 retry sufficient |
| Auto-fix without confirmation (--fix --all) | Dangerous in production; per-finding review is Kastell's safety principle |
| Apprise/notification aggregator | Adds external dependency; Kastell sends directly |
| AI/ML-based alert correlation | Simple thresholds + cron; deterministic > magical |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FLEET-01 | Phase 38 | Pending |
| FLEET-02 | Phase 38 | Pending |
| FLEET-03 | Phase 38 | Pending |
| FLEET-04 | Phase 38 | Pending |
| FLEET-05 | Phase 38 | Pending |
| NOTF-01 | Phase 36 | Pending |
| NOTF-02 | Phase 36 | Pending |
| NOTF-03 | Phase 36 | Pending |
| NOTF-04 | Phase 36 | Pending |
| NOTF-05 | Phase 36 | Pending |
| NOTF-06 | Phase 36 | Pending |
| NOTF-07 | Phase 39 | Pending |
| DFIX-01 | Phase 37 | Pending |
| DFIX-02 | Phase 37 | Pending |
| DFIX-03 | Phase 37 | Pending |
| DEBT-01 | Phase 35 | Complete |
| DEBT-02 | Phase 34 | Complete |
| DEBT-03 | Phase 40 | Pending |
| DEBT-04 | Phase 40 | Pending |

**Coverage:**
- v1.8 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-14 — traceability mapped after roadmap creation*
