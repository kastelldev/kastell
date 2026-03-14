---
phase: 39-guard-notification-integration
plan: 01
subsystem: notifications
tags: [guard, notify, telegram, discord, slack, cooldown, dispatch]

# Dependency graph
requires:
  - phase: 36-notification-module
    provides: dispatchWithCooldown with composite key cooldown deduplication
  - phase: 38-fleet-visibility
    provides: pattern for core function extraction and command wiring
provides:
  - dispatchGuardBreaches function in core/guard.ts
  - categorizeBreach private helper (disk/ram/cpu/regression/unknown)
  - Guard status command wires notifications on breach detection
affects: [mcp-server-guard, future guard enhancements, v1.9-audit-expansion]

# Tech tracking
tech-stack:
  added: []
  patterns: [sequential for...of dispatch to avoid cooldown write races, indirect behavior testing via observable side-effects]

key-files:
  created: []
  modified:
    - src/core/guard.ts
    - src/commands/guard.ts
    - tests/unit/guard.test.ts
    - tests/unit/guard-command.test.ts

key-decisions:
  - "Sequential for...of in dispatchGuardBreaches (not Promise.all) — avoids concurrent cooldown JSON write races"
  - "categorizeBreach is private (not exported) — tested indirectly via dispatchGuardBreaches by asserting findingType arg passed to mocked dispatchWithCooldown"
  - "Dispatch nests inside existing breach display if-block in commands/guard.ts — single conditional, cleaner than second if-block"
  - "guard-command tests mock both core/guard (auto-mock) and core/notify (transitive dep) — dispatchGuardBreaches cast as jest.Mock since module is fully auto-mocked"

patterns-established:
  - "Private categorizer helpers: non-exported helper tested indirectly through exported consumer"
  - "Notification wiring in command layer: dispatch called after display, inside same guard condition"

requirements-completed: [NOTF-07]

# Metrics
duration: 20min
completed: 2026-03-14
---

# Phase 39 Plan 01: Guard Notification Integration Summary

**Guard breach detections now dispatch real-time Telegram/Discord/Slack notifications via dispatchWithCooldown with 30-minute cooldown deduplication — client-side only, no VPS credential exposure**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-03-14T20:10:00Z
- **Completed:** 2026-03-14T20:30:00Z
- **Tasks:** 2 (TDD: 3 commits total)
- **Files modified:** 4

## Accomplishments

- `categorizeBreach()` private helper maps disk/ram/cpu/regression/unknown breach strings to stable findingType keys via regex
- `dispatchGuardBreaches()` exported from `core/guard.ts` — sequential for...of over breaches, calls `dispatchWithCooldown` per breach
- `commands/guard.ts` status branch wired — dispatch fires after breach display, inside existing `if (result.breaches.length > 0)` block
- 13 new tests added (8 in guard.test.ts + 5 in guard-command.test.ts), all 3153 tests pass

## Task Commits

Each task was committed atomically via TDD:

1. **Task 1: RED** - `3b5e030` (test: add failing tests for dispatchGuardBreaches)
2. **Task 1: GREEN** - `828fa9d` (feat: add categorizeBreach and dispatchGuardBreaches to core/guard.ts)
3. **Task 2: feat** - `1bf1ae4` (feat: wire dispatchGuardBreaches into guard status command)

_Note: Task 2 was consolidated into a single commit as the RED tests passed with zero implementation differences — no separate RED commit needed since the new tests naturally fail before wiring._

## Files Created/Modified

- `src/core/guard.ts` - Added import dispatchWithCooldown, private categorizeBreach, exported dispatchGuardBreaches
- `src/commands/guard.ts` - Added import dispatchGuardBreaches, wired dispatch call in status branch
- `tests/unit/guard.test.ts` - Added jest.mock for notify, added 8 dispatchGuardBreaches tests
- `tests/unit/guard-command.test.ts` - Added jest.mock for notify, added import + mock setup for dispatchGuardBreaches, added 5 dispatch behavior tests

## Decisions Made

- Sequential `for...of` in `dispatchGuardBreaches` — prevents concurrent writes to the cooldown JSON file that `dispatchWithCooldown` maintains
- `categorizeBreach` private — no value in exposing internals, tested indirectly by asserting findingType argument passed to mocked `dispatchWithCooldown`
- Dispatch nested inside existing breach display `if` block — avoids duplicate condition, DRY

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Notifications only trigger if user has previously configured channels via `kastell notify add`.

## Next Phase Readiness

- NOTF-07 fully satisfied — guard breach alerts wire through configured notification channels
- Phase 40 (Shell Completions) is next — all command signatures finalized
- v1.8 milestone nearly complete — Phase 40 is the final phase

---
*Phase: 39-guard-notification-integration*
*Completed: 2026-03-14*
