---
phase: 30-guard-daemon
plan: "01"
subsystem: guard-core
tags: [guard, cron, ssh, shell-script, metrics, tdd]
dependency_graph:
  requires: [src/utils/ssh.ts, src/utils/config.ts, src/types/index.ts]
  provides: [src/core/guard.ts, MetricSnapshot type]
  affects: [Phase 32 Doctor (reads MetricSnapshot), Plan 02 CLI wrapper]
tech_stack:
  added: []
  patterns: [SSH heredoc deploy, idempotent cron marker-comment, local JSON state, flock overlap guard]
key_files:
  created:
    - src/core/guard.ts
    - tests/unit/guard.test.ts
  modified:
    - src/types/index.ts
decisions:
  - MetricSnapshot added to shared src/types/index.ts so Phase 32 Doctor can import it
  - Guard shell script uses sshd -T as audit proxy (GUARD-04) — VPS cannot call kastell binary
  - cpuLoad1 truncated to integer via cut -d. -f1 to avoid shell arithmetic type mismatch
  - guardStatus reads real cron state via SSH — local guard-state.json is supplementary only
metrics:
  duration: 238s
  completed_date: "2026-03-14"
  tasks_completed: 1
  files_created: 2
  files_modified: 1
  tests_added: 65
requirements_completed: [GUARD-01, GUARD-02, GUARD-03, GUARD-04, GUARD-05, GUARD-06, GUARD-07, GUARD-08, GUARD-09, GUARD-10]
---

# Phase 30 Plan 01: Guard Core Module Summary

**One-liner:** Guard core module with SSH heredoc script deployment, idempotent cron management, MetricSnapshot JSON write, and flock-protected shell execution via TDD.

## What Was Built

`src/core/guard.ts` is the complete business logic layer for the guard daemon feature. It follows the `backupSchedule.ts` pattern exactly: command builders generate shell strings, orchestrators call `assertValidIp` + `sshExec`, and local state is persisted in `~/.kastell/guard-state.json`.

The guard shell script deployed via `buildDeployGuardScriptCommand()` implements:
- `flock -n 200` overlap protection
- Disk check via `df / --output=pcent` against 80% threshold
- RAM check via `free | awk` against 90% threshold
- CPU load check via `/proc/loadavg` vs `nproc`
- Audit proxy via `sshd -T | grep passwordauthentication` (GUARD-04)
- MetricSnapshot JSON write to `/var/lib/kastell/metrics.json` (GUARD-09)
- `notify()` stub with `KASTELL_NOTIFY_HOOK` sentinel (GUARD-10)
- Structured log to `/var/log/kastell-guard.log` with `[kastell-guard] <TS> <LEVEL>: <msg>` format

`MetricSnapshot` interface added to `src/types/index.ts` for Phase 32 Doctor compatibility.

## Commits

| Hash | Message |
|------|---------|
| 9c63b03 | test(30-01): add failing tests for guard core module |
| c27efee | feat(30-01): implement guard core module |

## Tasks

| Task | Name | Status | Commit |
|------|------|--------|--------|
| 1 | Guard core module — types, command builders, state, orchestrators | Complete | c27efee |

## Test Results

- Guard tests: 79 passed (65 new guard-specific tests)
- Full suite: 2864 passed (0 failures)
- Build: TypeScript compiles cleanly

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/core/guard.ts` — FOUND
- `tests/unit/guard.test.ts` — FOUND
- `src/types/index.ts` updated with MetricSnapshot — FOUND
- Commits 9c63b03 and c27efee — FOUND
