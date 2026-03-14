---
phase: 33-mcp-completions
plan: "02"
subsystem: cli
tags: [completions, bash, zsh, fish, guard, lock, doctor]

requires:
  - phase: 30-guard-daemon
    provides: guard command with start/stop/status subcommands
  - phase: 28-lock
    provides: lock command with --production/--dry-run/--force flags
  - phase: 32-doctor
    provides: doctor command with --fresh/--json flags

provides:
  - Shell completions (bash/zsh/fish) for guard, lock commands and updated doctor flags
  - 26-command ALL_COMMANDS reference in test file

affects: []

tech-stack:
  added: []
  patterns:
    - "Shell completion generators are static hardcoded strings — no runtime Commander introspection"
    - "Test assertions match exact string patterns in generated output for maximum specificity"

key-files:
  created: []
  modified:
    - src/core/completions.ts
    - tests/unit/completions.test.ts

key-decisions:
  - "guard subcommand completions use prev-based case matching in bash (same as firewall/config) — consistent with existing pattern"
  - "ALL_COMMANDS count updated from 24 to 26 to include guard and lock"

patterns-established:
  - "New commands with subcommands get both a prev-based case block (for subcommand listing) and a COMP_WORDS[1]-based case block (for flag completion) in bash"

requirements-completed:
  - MCP-03

duration: 2min
completed: "2026-03-14"
---

# Phase 33 Plan 02: MCP + Completions (Shell Completions) Summary

**Shell completions updated for bash, zsh, and fish to cover all v1.7 commands: guard (start/stop/status), lock (--production/--dry-run/--force), and doctor (--fresh/--json)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-14T10:53:33Z
- **Completed:** 2026-03-14T10:55:44Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added guard and lock as top-level completable commands in all three shells
- Added guard start/stop/status subcommand completions in bash (prev-based), zsh (subcommands array), and fish (using_subcommand predicate)
- Added lock --production, --dry-run, --force flag completions in all three shells
- Extended doctor completions with --fresh and --json in all three shells
- Updated ALL_COMMANDS to 26 entries and test suite from baseline to 31 tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Update completion generators and tests for guard/lock/doctor** - `68f5b5d` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `src/core/completions.ts` - Updated bash/zsh/fish generators with guard, lock, doctor flag additions
- `tests/unit/completions.test.ts` - Updated ALL_COMMANDS to 26, added 7 new test assertions

## Decisions Made
- guard subcommand completions in bash use the existing `prev` case block (like firewall, config, domain) — no new pattern needed
- guard options case block (--force) added under `COMP_WORDS[1]` section for when user types flags after selecting a guard subcommand

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 33 Plan 02 complete — all v1.7 shell completions are updated
- Phase 33 (MCP + Completions) is fully done with both plans complete
- Ready to tag v1.7.0 release after final integration verification

---
*Phase: 33-mcp-completions*
*Completed: 2026-03-14*
