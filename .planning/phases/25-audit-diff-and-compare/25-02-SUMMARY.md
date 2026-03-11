---
phase: 25-audit-diff-and-compare
plan: 02
subsystem: audit
tags: [diff, snapshot, cli, commander, jest]

# Dependency graph
requires:
  - phase: 25-01
    provides: diffAudits, resolveSnapshotRef, formatDiffTerminal, formatDiffJson engine functions
provides:
  - "--diff <before:after> CLI flag on kastell audit command"
  - "--compare <server1:server2> CLI flag on kastell audit command"
  - "Unit tests covering all --diff and --compare handler paths"
affects: [phase-26, phase-27, mcp-audit-tool]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "--diff early-return pattern: handler placed after --snapshots but before --watch, returns without running live SSH audit"
    - "--compare uses getServers() (non-interactive config read) not resolveServer() (interactive prompt)"
    - "process.exitCode = 1 (not process.exit(1)) for regression signaling — allows cleanup to run"

key-files:
  created:
    - tests/unit/audit-command-diff.test.ts
  modified:
    - src/commands/audit.ts
    - src/index.ts

key-decisions:
  - "--compare flag resolves servers via getServers() (non-interactive) not resolveServer() — compare takes both servers in flag value, no positional arg needed"
  - "process.exitCode = 1 used instead of process.exit(1) to allow graceful return from async function"

patterns-established:
  - "Early-return diff handlers: --diff and --compare placed before --watch, after --snapshots, as self-contained paths that skip live audit"

requirements-completed: [DIFF-01, DIFF-02, DIFF-03, DIFF-04, DIFF-05]

# Metrics
duration: 12min
completed: 2026-03-11
---

# Phase 25 Plan 02: Audit Diff & Compare CLI Wiring Summary

**--diff and --compare CLI flags wired into kastell audit command, routing to diff engine with terminal/JSON output and exit-code-1 on regressions**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-11T07:00:00Z
- **Completed:** 2026-03-11T07:12:00Z
- **Tasks:** 2
- **Files modified:** 3 (2 source, 1 test)

## Accomplishments

- Added `--diff <before:after>` and `--compare <server1:server2>` options to `kastell audit` in `src/index.ts`
- Implemented both handlers in `src/commands/audit.ts`: snapshot resolution, diff computation, terminal/JSON output routing, and exit code 1 on regressions
- 16 unit tests covering all paths: happy path, invalid format, missing snapshots, unknown servers, exit code, JSON output

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire --diff and --compare into audit command** - `7ac125c` (feat)
2. **Task 2: CLI wiring tests with exit code verification** - `d91bfd8` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/index.ts` - Added `--diff` and `--compare` option registrations to audit command
- `src/commands/audit.ts` - Added imports (diff engine, getServers) + two handler blocks before --watch
- `tests/unit/audit-command-diff.test.ts` - 16 unit tests for all --diff and --compare paths

## Decisions Made

- `--compare` uses `getServers()` (non-interactive config read) not `resolveServer()` (interactive prompt with Inquirer) — compare takes both servers in the flag value, no positional server-name argument needed
- `process.exitCode = 1` used instead of `process.exit(1)` so the async function returns gracefully (allows any cleanup in calling context)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 25 complete: diff engine (Plan 01) + CLI wiring (Plan 02) both shipped
- `kastell audit <server> --diff before:after` and `kastell audit --compare serverA:serverB` are fully functional
- Full test suite: 2580 tests, 120 suites, all green
- Ready for Phase 26 (Evidence Collect) or Phase 27 (Rate Limiting)

## Self-Check: PASSED

- FOUND: src/commands/audit.ts
- FOUND: src/index.ts
- FOUND: tests/unit/audit-command-diff.test.ts
- FOUND: .planning/phases/25-audit-diff-and-compare/25-02-SUMMARY.md
- FOUND commit: 7ac125c (feat Task 1)
- FOUND commit: d91bfd8 (test Task 2)

---
*Phase: 25-audit-diff-and-compare*
*Completed: 2026-03-11*
