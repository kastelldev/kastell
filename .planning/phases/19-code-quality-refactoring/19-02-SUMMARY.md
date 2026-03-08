---
phase: 19-code-quality-refactoring
plan: 02
subsystem: core
tags: [refactoring, maintain, DRY, command-pattern]

requires:
  - phase: 17-dokploy-tamamlama
    provides: "adapter-based maintain pipeline in core/maintain.ts"
provides:
  - "Single-source maintain pipeline in core/maintain.ts"
  - "Thin command wrapper for maintain (no business logic)"
affects: [mcp-tools, commands]

tech-stack:
  added: []
  patterns: [command-delegates-to-core, StepResult-rendering]

key-files:
  created: []
  modified:
    - src/commands/maintain.ts
    - tests/unit/maintain.test.ts
    - tests/unit/mcp-server-maintain.test.ts

key-decisions:
  - "Step 0 (snapshot prompt) stays in command as UI logic, steps 1-5 delegated to core"
  - "showReport() renders StepResult[] with label mapping instead of boolean fields"
  - "runMaintain() replaces maintainSingleServer() — renders spinner output post-hoc from core results"

patterns-established:
  - "Maintain command follows command-thin/core-fat pattern: UI in command, logic in core"
  - "StepResult[] rendering via formatStepStatus() label mapping"

requirements-completed: [REFACTOR-MAINTAIN-DRY]

duration: 9min
completed: 2026-03-08
---

# Phase 19 Plan 02: Maintain DRY Summary

**Consolidated 190-line maintain pipeline from commands/maintain.ts into core/maintain.ts, making command a thin delegate**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-08T12:41:00Z
- **Completed:** 2026-03-08T12:50:31Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Removed entire `maintainSingleServer()` function (~190 lines) from commands/maintain.ts
- Removed local `MaintainResult` interface definition (was conflicting with core's)
- Command now delegates to `core/maintain.ts#maintainServer()` for all 5 pipeline steps
- Updated `showReport()` to render `StepResult[]` from core instead of old boolean-based result
- Updated 6 tests to verify core delegation behavior instead of internal implementation details

## Task Commits

Each task was committed atomically:

1. **Task 1: Ensure core/maintain.ts has full pipeline** - No commit (verified: core already complete, no changes needed)
2. **Task 2: Refactor commands/maintain.ts to delegate to core** - `91ad12f` (refactor)

## Files Created/Modified
- `src/commands/maintain.ts` - Thin command wrapper; removed maintainSingleServer(), added runMaintain() that delegates to core, updated showReport() for StepResult[]
- `tests/unit/maintain.test.ts` - Updated 6 test assertions to match core-delegated behavior
- `tests/unit/mcp-server-maintain.test.ts` - Removed obsolete getLogCommand from mock adapters

## Decisions Made
- Step 0 (snapshot with inquirer prompt) stays in command as UI logic; core should never have UI prompts
- showReport() uses a label mapping function (formatStepStatus) to convert StepResult names to short labels (e.g., "Coolify Update" -> "update OK")
- Tests updated to verify report output (status labels) rather than raw error messages, since errors are now handled internally by core

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed obsolete getLogCommand from mcp-server-maintain.test.ts mock**
- **Found during:** Task 2
- **Issue:** Test mock included getLogCommand which was removed from PlatformAdapter interface (from Plan 19-01 changes)
- **Fix:** Removed getLogCommand from mock adapter in mcp-server-maintain.test.ts
- **Files modified:** tests/unit/mcp-server-maintain.test.ts
- **Verification:** All maintain tests pass (65/65)
- **Committed in:** 91ad12f (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Fix was necessary to compile tests. No scope creep.

## Issues Encountered
- Pre-existing test failures in 3 unrelated suites (interactive.test.ts, mcp-server-manage.test.ts, mcp-server-info.test.ts) from Plan 19-01 changes that removed logo.ts and getLogCommand. These are out of scope for this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Maintain pipeline is now single-source in core/maintain.ts
- All 65 maintain-related tests pass
- Pre-existing test failures from 19-01 should be addressed in the remaining 19-01 plan or a follow-up

---
*Phase: 19-code-quality-refactoring*
*Completed: 2026-03-08*
