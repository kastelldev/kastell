---
phase: 29
slug: backup-schedule
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-14
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x |
| **Config file** | jest.config.cjs |
| **Quick run command** | `npm test -- --testPathPattern="backup"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern="backup"`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 29-01-01 | 01 | 1 | BKUP-01 | unit | `npm test -- --testPathPattern="backupSchedule" --passWithNoTests` | TDD RED | pending |
| 29-01-02 | 01 | 1 | BKUP-02 | unit | `npm test -- --testPathPattern="backupSchedule" --passWithNoTests` | TDD RED | pending |
| 29-01-03 | 01 | 1 | BKUP-03 | unit | `npm test -- --testPathPattern="backupSchedule" --passWithNoTests` | TDD RED | pending |
| 29-01-04 | 01 | 1 | BKUP-04 | unit | `npm test -- --testPathPattern="backupSchedule" --passWithNoTests` | TDD RED | pending |
| 29-01-05 | 01 | 1 | BKUP-05 | unit | `npm test -- --testPathPattern="backupSchedule" --passWithNoTests` | TDD RED | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

Both plans (29-01 and 29-02) are `type: tdd`. The TDD RED phase creates test files inline as its first action — no separate Wave 0 plan is needed. The `--passWithNoTests` flag in automated verify commands ensures safe execution during the transition between RED and GREEN phases.

- [x] `src/core/__tests__/backupSchedule.test.ts` — created by Plan 01 TDD RED phase
- [x] `src/commands/__tests__/backupScheduleCmd.test.ts` — created by Plan 02 TDD RED phase
- [x] Test fixtures for SSH mock, crontab mock, flock mock — created inline with TDD RED phase

*Existing jest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cron entry persists after VPS reboot | BKUP-01 | Requires real VPS | SSH into VPS, reboot, verify `crontab -l` |
| Concurrent backup lock prevents corruption | BKUP-05 | Requires real VPS timing | Start backup, immediately trigger second, verify lock |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (TDD RED phases satisfy this)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
