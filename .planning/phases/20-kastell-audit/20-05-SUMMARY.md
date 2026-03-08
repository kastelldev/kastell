---
phase: 20-kastell-audit
plan: 05
subsystem: security
tags: [mcp, audit, watch, ci-cd, github-actions]

requires:
  - phase: 20-kastell-audit/03
    provides: CLI command, formatters, output engine
  - phase: 20-kastell-audit/04
    provides: fix engine, history persistence, quick win calculator

provides:
  - MCP server_audit tool with summary/json/score formats
  - Watch mode for continuous audit monitoring
  - Full CLI integration (fix, history, trend, quick wins, watch, host, threshold)
  - GitHub Actions CI/CD example in README

affects: [guard, mcp, readme]

tech-stack:
  added: []
  patterns: [MCP tool with multi-format output, watch mode with delta display]

key-files:
  created:
    - src/mcp/tools/serverAudit.ts
    - src/core/audit/watch.ts
    - tests/unit/mcp-server-audit.test.ts
    - tests/unit/audit-watch.test.ts
  modified:
    - src/mcp/server.ts
    - src/commands/audit.ts
    - src/core/audit/index.ts
    - tests/unit/audit-command.test.ts
    - README.md

key-decisions:
  - "MCP server_audit uses 3 formats: summary (compact text for AI), json (full result), score (number only)"
  - "Watch mode shows full output on first run, then delta-only with score diff and new issue IDs"
  - "Quick wins calculated in runAudit via calculateQuickWins, included in AuditResult"

patterns-established:
  - "MCP tool with format parameter for multi-output: summary for AI, json for programmatic, score for CI"
  - "Watch mode pattern: setInterval + SIGINT cleanup + delta comparison"

requirements-completed: [AUD-MCP, AUD-WATCH, AUD-HOST, AUD-CI, AUD-README]

duration: 7min
completed: 2026-03-08
---

# Phase 20 Plan 05: MCP + Watch + CI Integration Summary

**MCP server_audit tool with 3 output formats, watch mode with delta display, full CLI wiring, and GitHub Actions CI example in README**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-08T15:27:54Z
- **Completed:** 2026-03-08T15:35:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- MCP server_audit tool registered with summary/json/score formats and readOnly annotations
- Watch mode runs periodic audits showing only score deltas and new failures
- CLI fully wired: --fix, --watch, --host, --threshold, history save, trend detection, quick wins
- runAudit now calculates quick wins via calculateQuickWins
- README updated with Security Audit section, CI/CD Integration with GitHub Actions example
- 2467 tests passing (12 new: 7 MCP + 5 watch)

## Task Commits

Each task was committed atomically:

1. **Task 1: MCP server_audit tool** - `303bd25` (feat)
2. **Task 2: Watch mode + CLI integration + README** - `9606769` (feat)

_Note: TDD tasks — tests written before implementation for both tasks_

## Files Created/Modified
- `src/mcp/tools/serverAudit.ts` - MCP tool with schema and handler (summary/json/score formats)
- `src/mcp/server.ts` - Tool registration with readOnly annotations
- `src/core/audit/watch.ts` - Watch mode with interval, delta display, SIGINT cleanup
- `src/commands/audit.ts` - Full CLI wiring (fix, watch, history, trend, quick wins)
- `src/core/audit/index.ts` - runAudit now includes calculateQuickWins
- `tests/unit/mcp-server-audit.test.ts` - 7 tests for MCP tool
- `tests/unit/audit-watch.test.ts` - 5 tests for watch mode
- `tests/unit/audit-command.test.ts` - Updated mocks for new dependencies
- `README.md` - Security Audit section + CI/CD section + MCP table update

## Decisions Made
- MCP server_audit uses 3 formats: summary (compact text for AI), json (full result), score (number only)
- Watch mode shows full formatter output on first run, then delta-only on subsequent runs
- Quick wins calculated in runAudit itself (not in command) for consistent availability across MCP and CLI

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed audit-command tests breaking from new imports**
- **Found during:** Task 2 (CLI integration)
- **Issue:** Adding history/fix/watch imports to audit.ts caused existing tests to fail — auto-mocked functions returned undefined
- **Fix:** Added jest.mock for history, fix, watch modules and set up proper mock return values
- **Files modified:** tests/unit/audit-command.test.ts
- **Verification:** All 2467 tests pass
- **Committed in:** 9606769 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary fix for test compatibility. No scope creep.

## Issues Encountered
None beyond the test mock fix above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 20 (kastell audit) is complete
- All 5 plans executed: engine, parsers, formatters, fix/history/quickwins, MCP/watch/CI
- Ready for milestone completion (/gsd:complete-milestone)

---
*Phase: 20-kastell-audit*
*Completed: 2026-03-08*
