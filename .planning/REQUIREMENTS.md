# Requirements: Kastell v1.6

**Defined:** 2026-03-09
**Core Value:** Autonomous server security and maintenance across multiple cloud providers

## v1.6 Requirements

Requirements for v1.6 Audit Expand + Evidence + Infrastructure. Each maps to roadmap phases.

### Audit Snapshot

- [x] **SNAP-01**: User can save full audit results as a dated JSON snapshot
- [x] **SNAP-02**: User can list available snapshots for a server with dates and scores
- [x] **SNAP-03**: User can name snapshots for easy reference (e.g., "pre-upgrade")
- [x] **SNAP-04**: Snapshots include schema version for forward compatibility

### Audit Diff

- [x] **DIFF-01**: User can compare two snapshots and see check-by-check changes
- [x] **DIFF-02**: User can compare two servers' audit results side-by-side
- [x] **DIFF-03**: Diff output is color-coded (green=improved, red=regressed)
- [x] **DIFF-04**: Diff supports JSON output for CI integration
- [x] **DIFF-05**: Diff exits with code 1 if any check regressed (CI-friendly)

### Evidence Collection

- [x] **EVID-01**: User can collect forensic evidence package with single command
- [x] **EVID-02**: Evidence includes firewall rules, auth.log, listening ports, system logs
- [x] **EVID-03**: Evidence manifest includes SHA256 checksums per file
- [x] **EVID-04**: Evidence collection uses single SSH connection (batch pattern)

### Infrastructure

- [x] **INFRA-01**: File locking prevents concurrent writes to servers.json
- [x] **INFRA-02**: Rate limit backoff retries 429 responses with exponential delay
- [x] **INFRA-03**: ServerRecord.mode field is required (auto-migrated from optional)
- [x] **INFRA-04**: Rate limit retry respects Retry-After header when present

### Documentation

- [ ] **DOCS-01**: PlatformAdapter interface contract is documented
- [ ] **DOCS-02**: Adapter contract has test fixtures that validate implementations

## Future Requirements

Deferred to v1.7+. Tracked but not in current roadmap.

### Guard Core (v1.7)

- **GUARD-01**: kastell guard daemon for autonomous security monitoring
- **GUARD-02**: kastell lock for one-command server hardening
- **GUARD-03**: kastell fleet for multi-server visibility
- **GUARD-04**: kastell doctor for proactive operations intelligence
- **GUARD-05**: Multi-channel notifications (Telegram/Discord/Slack/Email)
- **GUARD-06**: Backup scheduling (backup --schedule)
- **GUARD-07**: Risk trend with cause analysis

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| AI-powered audit analysis | PROJECT.md: "No AI/ML" — deterministic thresholds only |
| Evidence auto-submission to providers | Legally risky — user submits manually |
| Audit check plugin system | Only 46 checks, not enough demand to justify plugin arch |
| Snapshot cloud storage/sync | Local-first tool — no cloud dependency |
| Continuous monitoring daemon | v1.7 kastell guard territory |
| Full disk forensics / memory dump | DFIR territory, beyond CLI security tool scope |
| tar.gz evidence bundling | Defer until user demand — directory + manifest sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SNAP-01 | Phase 24 | Complete |
| SNAP-02 | Phase 24 | Complete |
| SNAP-03 | Phase 24 | Complete |
| SNAP-04 | Phase 24 | Complete |
| DIFF-01 | Phase 25 | Complete |
| DIFF-02 | Phase 25 | Complete |
| DIFF-03 | Phase 25 | Complete |
| DIFF-04 | Phase 25 | Complete |
| DIFF-05 | Phase 25 | Complete |
| EVID-01 | Phase 26 | Complete |
| EVID-02 | Phase 26 | Complete |
| EVID-03 | Phase 26 | Complete |
| EVID-04 | Phase 26 | Complete |
| INFRA-01 | Phase 23 | Complete |
| INFRA-02 | Phase 23 | Complete |
| INFRA-03 | Phase 23 | Complete |
| INFRA-04 | Phase 23 | Complete |
| DOCS-01 | Phase 27 | Pending |
| DOCS-02 | Phase 27 | Pending |

**Coverage:**
- v1.6 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2026-03-09*
*Last updated: 2026-03-09 after roadmap creation — all 19 requirements mapped to phases 23-27*
