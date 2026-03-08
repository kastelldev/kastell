---
phase: 20-kastell-audit
plan: 02
subsystem: security
tags: [audit, ssh-parsing, security-checks, sysctl, ufw, docker]

requires:
  - phase: 20-kastell-audit plan 01
    provides: AuditCheck/CheckParser types, SECTION_INDICES, scoring engine, audit runner
provides:
  - 9 category check parsers (46 checks total) with severity, fixCommand, explain
  - Check registry mapping section indices to parser functions
  - parseAllChecks() function for batch output routing
  - Full AuditResult production with all 9 categories populated
affects: [20-03 (output formatters), 20-04 (CLI command), 20-05 (MCP tool)]

tech-stack:
  added: []
  patterns: [CheckParser interface pattern, defensive parsing with N/A handling, platform-aware check logic]

key-files:
  created:
    - src/core/audit/checks/ssh.ts
    - src/core/audit/checks/firewall.ts
    - src/core/audit/checks/updates.ts
    - src/core/audit/checks/docker.ts
    - src/core/audit/checks/network.ts
    - src/core/audit/checks/filesystem.ts
    - src/core/audit/checks/auth.ts
    - src/core/audit/checks/logging.ts
    - src/core/audit/checks/kernel.ts
    - src/core/audit/checks/index.ts
  modified:
    - src/core/audit/index.ts

key-decisions:
  - "Each parser is a pure function (sectionOutput, platform) => AuditCheck[] with no side effects"
  - "Docker checks return info severity on bare (skip), warning severity on platforms (Docker expected)"
  - "IP forwarding check auto-passes on coolify/dokploy since Docker requires it"
  - "Auth parser uses pattern matching to distinguish usernames from config lines in concatenated output"

patterns-established:
  - "CheckParser pattern: const parseXxxChecks: CheckParser = (sectionOutput, platform) => AuditCheck[]"
  - "Defensive parsing: isNA check at top, N/A/empty returns checks with passed=false and 'Unable to determine'"
  - "Platform-aware checks: isPlatform flag adjusts severity and pass/fail logic"

requirements-completed: [AUD-CHECKS, AUD-PLATFORM]

duration: 11min
completed: 2026-03-08
---

# Phase 20 Plan 02: Check Parsers Summary

**46 security checks across 9 categories (SSH, Firewall, Updates, Docker, Network, Filesystem, Auth, Logging, Kernel) with platform-aware parsing and defensive N/A handling**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-08T15:02:02Z
- **Completed:** 2026-03-08T15:13:00Z
- **Tasks:** 2
- **Files modified:** 21

## Accomplishments
- Implemented all 9 category check parsers totaling 46 security checks
- Each check includes id, severity, passed/failed, currentValue, expectedValue, fixCommand, explain
- Check registry routes batched SSH output sections to correct parsers via parseAllChecks()
- Platform-aware: Docker/Network checks adjust for coolify/dokploy vs bare
- Audit runner now produces full AuditResult with all 9 categories populated
- 91 total audit tests (68 new + 23 existing), all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Check parsers batch 1 (SSH, Firewall, Updates, Docker, Network)** - `70cad45` (feat)
2. **Task 2: Check parsers batch 2 (Filesystem, Auth, Logging, Kernel) + registry** - `31cdfd0` (feat)

_Note: TDD tasks - tests written first (RED), then implementation (GREEN)._

## Files Created/Modified
- `src/core/audit/checks/ssh.ts` - 6 SSH hardening checks (SSH-01 to SSH-06)
- `src/core/audit/checks/firewall.ts` - 5 Firewall checks (FW-01 to FW-05)
- `src/core/audit/checks/updates.ts` - 4 System Updates checks (UPD-01 to UPD-04)
- `src/core/audit/checks/docker.ts` - 6 Docker security checks (DCK-01 to DCK-06)
- `src/core/audit/checks/network.ts` - 5 Network checks (NET-01 to NET-05)
- `src/core/audit/checks/filesystem.ts` - 5 Filesystem checks (FS-01 to FS-05)
- `src/core/audit/checks/auth.ts` - 5 Auth checks (AUTH-01 to AUTH-05)
- `src/core/audit/checks/logging.ts` - 5 Logging checks (LOG-01 to LOG-05)
- `src/core/audit/checks/kernel.ts` - 5 Kernel checks (KRN-01 to KRN-05)
- `src/core/audit/checks/index.ts` - Check registry with parseAllChecks()
- `src/core/audit/index.ts` - Updated runner to use real parsers instead of noop stubs

## Decisions Made
- Each parser is a pure function with no side effects, following CheckParser type contract
- Docker checks return info severity on bare (skip gracefully), warning on coolify/dokploy
- IP forwarding check auto-passes on Docker platforms since forwarding is required
- Auth parser uses pattern matching to distinguish usernames from config lines in concatenated output
- Kernel version check is info severity (presence check only, not age comparison)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed logging parser "inactive" substring matching**
- **Found during:** Task 2 (Logging parser)
- **Issue:** "inactive" contains "active" as substring, causing false positive
- **Fix:** Changed to exact string matching with `lines.some(l => l === "active")`
- **Files modified:** src/core/audit/checks/logging.ts
- **Verification:** LOG-01 test passes for both active and inactive cases
- **Committed in:** 31cdfd0 (Task 2 commit)

**2. [Rule 1 - Bug] Fixed filesystem parser world-writable vs SUID path confusion**
- **Found during:** Task 2 (Filesystem parser)
- **Issue:** SUID binary paths (/usr/bin/) matched world-writable file filter
- **Fix:** Excluded /usr/bin/ and /usr/sbin/ paths from world-writable detection
- **Files modified:** src/core/audit/checks/filesystem.ts
- **Verification:** FS-02 test passes for both secure and insecure cases
- **Committed in:** 31cdfd0 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both were parsing logic bugs caught by TDD tests. No scope creep.

## Issues Encountered
- Test path pattern `--testPathPattern` flag deprecated in current Jest version, switched to positional arguments
- Tests are in `tests/unit/` (project convention) not `src/core/audit/__tests__/checks/` (plan convention)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 46 checks implemented and tested, ready for output formatting (Plan 03)
- parseAllChecks() and AuditCategory arrays ready for report rendering
- Quick wins population deferred to Plan 03+

---
*Phase: 20-kastell-audit*
*Completed: 2026-03-08*
