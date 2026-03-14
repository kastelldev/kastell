---
phase: 37-doctor-fix
plan: 01
subsystem: cli
tags: [doctor, fix, ssh, interactive, inquirer, tdd]

# Dependency graph
requires:
  - phase: 36-notification-module
    provides: notify module (phase independent but sequential)
provides:
  - runDoctorFix orchestration function (src/core/doctor-fix.ts)
  - DoctorFinding.fixCommand optional field for SSH-executable fixes
  - kastell doctor --fix interactive per-finding SSH remediation
  - kastell doctor --fix --force CI-friendly non-interactive mode
  - kastell doctor --fix --dry-run preview without execution
affects:
  - phase 39-guard-notify (guard may need doctor-fix integration)
  - phase 40-shell-completions (new --fix --force --dry-run flags need completion entries)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "dry-run wins over force (safety > convenience)"
    - "per-finding confirm gate in async SSH loop (continue on decline)"
    - "async function assertValidIp: rejects.toThrow not toThrow"
    - "inline mock for assertValidIp avoids jest.requireActual crash on Node v24"

key-files:
  created:
    - src/core/doctor-fix.ts
    - tests/unit/doctor-fix.test.ts
  modified:
    - src/core/doctor.ts
    - src/commands/doctor.ts
    - src/index.ts
    - tests/unit/doctor.test.ts

key-decisions:
  - "async function + assertValidIp: rejects.toThrow required (not toThrow) — async wraps sync throw in rejected Promise"
  - "dryRun always wins even when force also set — safety rule enforced at runDoctorFix level"
  - "--fix auto-forces fresh=true to ensure current server state before remediation"
  - "assertValidIp mocked inline (not jest.requireActual) to prevent Node v24 process crash in jest worker init"

patterns-established:
  - "runDoctorFix: dry-run short-circuits immediately, adds all findings to skipped"
  - "findings without fixCommand auto-skipped (no prompt), findings with fixCommand prompt in interactive mode"
  - "SSH failure recorded in failed[], loop continues to next finding"

requirements-completed: [DFIX-01, DFIX-02, DFIX-03]

# Metrics
duration: 35min
completed: 2026-03-14
---

# Phase 37 Plan 01: Doctor Fix Summary

**Interactive SSH remediation for doctor findings via `kastell doctor --fix` with per-finding confirmation, --force CI mode, and --dry-run preview**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-03-14T18:40:00Z
- **Completed:** 2026-03-14T19:18:25Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `DoctorFinding.fixCommand?: string` added — STALE_PACKAGES and DOCKER_DISK populate it with non-interactive SSH commands
- `runDoctorFix` in `src/core/doctor-fix.ts` handles all three modes: dry-run (all skipped), force (no prompt), interactive (inquirer confirm per finding)
- `kastell doctor <server> --fix` forces fresh=true, then interactively remediates fixable findings
- 13 core unit tests + 6 command-layer tests = 19 new tests (3111 total, all green)

## Task Commits

Each task was committed atomically:

1. **Task 1: Core doctor-fix module with fixCommand field and tests** - `8383ed6` (feat)
2. **Task 2: Wire --fix/--force/--dry-run into command layer and index.ts** - `69223fb` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/core/doctor-fix.ts` - runDoctorFix orchestration with dry-run/force/interactive modes
- `src/core/doctor.ts` - DoctorFinding.fixCommand added; checkStalePackages and checkDockerDisk updated
- `src/commands/doctor.ts` - --fix guard, fresh=true enforcement, fix result display
- `src/index.ts` - --fix, --force, --dry-run options registered on doctor command
- `tests/unit/doctor-fix.test.ts` - 13 unit tests for runDoctorFix
- `tests/unit/doctor.test.ts` - 6 new tests for --fix command-layer behavior

## Decisions Made
- `dryRun` wins over `force` — safety rule enforced at `runDoctorFix` level, not caller. Both flags together = dry-run.
- `--fix` forces `fresh: true` automatically — stale cached data risks wrong remediation decisions.
- `assertValidIp` mocked inline in tests (not `jest.requireActual`) — `jest.requireActual` causes process crash in Node v24 jest workers because the returned function reference triggers synchronous evaluation in some paths.
- Async function + sync-throwing assertValidIp: must use `.rejects.toThrow()` not `.toThrow()` — async functions wrap synchronous throws into rejected Promises.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test mock approach for assertValidIp to prevent Node v24 crash**
- **Found during:** Task 1 (RED phase test writing)
- **Issue:** `jest.requireActual("../../src/utils/ssh").assertValidIp` in mock factory caused jest worker process to crash before tests ran on Node v24. Full process crash with no Jest output.
- **Fix:** Replaced `jest.requireActual` with an inline jest.fn() mock for ssh module. Invalid-IP test uses `mockImplementation` with `.rejects.toThrow()` to handle async function behavior.
- **Files modified:** tests/unit/doctor-fix.test.ts
- **Verification:** All 13 tests pass, no process crash
- **Committed in:** 8383ed6 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Required test pattern adjustment for Node v24 compatibility. No scope creep. All must-have behaviors covered.

## Issues Encountered
- Node.js v24 + Jest: `jest.requireActual` inside mock factory causes process crash when the actual module has functions that could throw. Inline mock is the safe pattern for this project.
- Async functions wrapping synchronous throws: `assertValidIp` throws synchronously but since `runDoctorFix` is `async`, callers receive a rejected Promise. Test must use `.rejects.toThrow()`.

## Next Phase Readiness
- Doctor --fix fully implemented and tested (DFIX-01, DFIX-02, DFIX-03 satisfied)
- Ready for Phase 38: Fleet
- Phase 40 (Shell Completions) will need --fix, --force, --dry-run added to doctor completions

---
*Phase: 37-doctor-fix*
*Completed: 2026-03-14*
