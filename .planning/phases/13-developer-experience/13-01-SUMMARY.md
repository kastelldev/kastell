---
phase: 13-developer-experience
plan: 01
subsystem: cli
tags: [dry-run, version-check, commander, dx]

requires: []
provides:
  - "--dry-run support for destroy, update, restart, remove commands"
  - "--version inline update notification"
affects: [14-tui, 15-documentation]

tech-stack:
  added: []
  patterns: ["showDryRun() per-command function following maintain.ts pattern"]

key-files:
  created: []
  modified:
    - src/commands/destroy.ts
    - src/commands/update.ts
    - src/commands/restart.ts
    - src/commands/remove.ts
    - src/index.ts
    - tests/unit/destroy.test.ts
    - tests/unit/update.test.ts
    - tests/unit/restart.test.ts
    - tests/unit/remove.test.ts

key-decisions:
  - "showDryRun() as local function per command, matching maintain.ts pattern"
  - "--version intercept before Commander to await checkForUpdate instead of fire-and-forget"

patterns-established:
  - "Dry-run pattern: showDryRun() after resolveServer, before confirm prompts, returning early"

requirements-completed: [DX-01, DX-04]

duration: 10min
completed: 2026-03-07
---

# Phase 13 Plan 01: Dry-Run + Version Check Summary

**--dry-run flag on destroy/update/restart/remove commands with showDryRun() pattern, plus --version inline update check**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-07T10:02:08Z
- **Completed:** 2026-03-07T10:12:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- All 4 remaining destructive commands now support --dry-run for safe preview
- --version now awaits update check instead of fire-and-forget
- 10 new test cases covering dry-run behavior for all commands
- TDD flow: RED (failing tests) -> GREEN (implementation) -> all 86 related tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add failing dry-run tests** - `cebe28b` (test)
2. **Task 1 GREEN: Implement --dry-run on destroy, update, restart, remove** - `671f679` (feat)
3. **Task 2: Make --version show inline update notification** - `72d1dc4` (feat)

## Files Created/Modified
- `src/commands/destroy.ts` - Added showDryRun() + dryRun option parameter
- `src/commands/update.ts` - Added showDryRun() + dryRun in UpdateOptions + --all dry-run
- `src/commands/restart.ts` - Added showDryRun() + dryRun option parameter
- `src/commands/remove.ts` - Added showDryRun() + dryRun option parameter
- `src/index.ts` - Registered --dry-run options + --version intercept with await
- `tests/unit/destroy.test.ts` - 2 dry-run test cases
- `tests/unit/update.test.ts` - 3 dry-run test cases (single + --all)
- `tests/unit/restart.test.ts` - 2 dry-run test cases
- `tests/unit/remove.test.ts` - 2 dry-run test cases

## Decisions Made
- showDryRun() implemented as local function per command file, following maintain.ts established pattern
- --version intercept placed before Commander's parseAsync to ensure async checkForUpdate completes before exit
- Dry-run check placed after resolveServer but before any confirm prompts or side effects

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DX-01 (dry-run) and DX-04 (version check) complete
- Ready for Phase 13 Plan 02 (shell completions) and Plan 03 (config validation)

---
*Phase: 13-developer-experience*
*Completed: 2026-03-07*
