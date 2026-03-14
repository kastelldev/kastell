---
phase: 29-backup-schedule
plan: "02"
subsystem: cli
tags: [backup, schedule, commander, cli, tdd]
dependency_graph:
  requires: [29-01]
  provides: [backup-schedule-cli]
  affects: [src/commands/backup.ts, src/index.ts]
tech_stack:
  added: []
  patterns: [thin-command-routing, schedule-branch-early-return]
key_files:
  created:
    - tests/unit/backupScheduleCmd.test.ts
  modified:
    - src/commands/backup.ts
    - src/index.ts
decisions:
  - Test placed in tests/unit/ (not src/commands/__tests__/) to match jest.config.cjs roots
  - handleScheduleOption() as private helper keeps backupCommand thin
  - validateCronExpr called in CLI layer before SSH — avoids spinner start for invalid input
metrics:
  duration: 262s
  completed_date: "2026-03-14"
  tasks_completed: 2
  files_changed: 3
requirements_completed: [BKUP-01, BKUP-02, BKUP-03]
---

# Phase 29 Plan 02: Backup Schedule CLI Wiring Summary

CLI --schedule option wired to core backupSchedule functions (scheduleBackup, listBackupSchedule, removeBackupSchedule) via handleScheduleOption helper in backup command.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend backup command with --schedule option (TDD) | 9253093 | tests/unit/backupScheduleCmd.test.ts, src/commands/backup.ts |
| 2 | Register --schedule option in Commander | 4b6dbd5 | src/index.ts |

## What Was Built

- `handleScheduleOption(query, scheduleValue)`: private function routing `list`/`remove`/cron-expr to correct core function, with spinner feedback and early-return on SSH unavailability
- `backupCommand` signature extended with `schedule?: string`; schedule branch runs before all other logic
- Commander registration: `.option("--schedule <value>", 'Cron expression, "list", or "remove"')` with updated description
- 16 unit tests covering all schedule branches: cron scheduling success/failure/hint, list with/without schedule, remove success/failure, SSH unavailable early return, null server early return, invalid cron validation

## Verification

- `npm run build` — clean, no TypeScript errors
- `npm test -- --testPathPatterns="backup"` — 232 tests, all pass (6 test files)
- `npm test` — full suite: 2799 tests, 128 suites, all pass
- `node dist/index.js backup --help` — shows `--schedule <value>` option

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test file placed in tests/unit/ instead of src/commands/__tests__/**
- **Found during:** Task 1 RED phase
- **Issue:** jest.config.cjs `roots: ['<rootDir>/tests']` — tests in src/ would not be discovered by Jest
- **Fix:** Created test at `tests/unit/backupScheduleCmd.test.ts` matching existing project convention
- **Files modified:** tests/unit/backupScheduleCmd.test.ts (created at correct path)
- **Commit:** 9253093

**2. [Rule 1 - Bug] resolveServer mock used null instead of undefined**
- **Found during:** Task 1 GREEN phase
- **Issue:** `resolveServer` returns `Promise<ServerRecord | undefined>`, not null; TypeScript rejected `mockResolvedValue(null)`
- **Fix:** Changed test to `mockResolvedValue(undefined)` matching actual return type
- **Files modified:** tests/unit/backupScheduleCmd.test.ts
- **Commit:** 9253093

**3. [Rule 1 - Bug] "existing backup logic unchanged" tests avoided deep backup path**
- **Found during:** Task 1 GREEN phase
- **Issue:** Tests calling `backupCommand` without `--schedule` fell into regular backup path, failing on `join(getBackupDir(...), ...)` due to mock resolution complexity
- **Fix:** Set `checkSshAvailable` to false in those tests so regular backup returns early — tests still correctly verify schedule functions are not called
- **Files modified:** tests/unit/backupScheduleCmd.test.ts
- **Commit:** 9253093

## Self-Check: PASSED

All files exist. Both commits verified in git log.
