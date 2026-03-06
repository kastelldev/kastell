---
phase: 07-kastell-rebrand
plan: 01
subsystem: infra
tags: [typescript, config, migration, env-vars, rebrand]

requires:
  - phase: none
    provides: "First plan in v1.3 milestone"
provides:
  - "KastellYamlConfig, KastellConfig, KastellResult type definitions"
  - "~/.kastell config directory with automatic migration from ~/.quicklify"
  - "KASTELL_SAFE_MODE env var (primary) with QUICKLIFY_SAFE_MODE backward compat"
  - "migrateConfigIfNeeded() utility wired into CLI and MCP entry points"
  - "Update check targets kastell npm package"
affects: [07-02, 07-03, 08-platform-adapter, 09-dokploy]

tech-stack:
  added: []
  patterns:
    - "Dual env var support with deprecation warning (one-time per process)"
    - "Config directory migration with .migrated flag and try-catch robustness"

key-files:
  created:
    - src/utils/migration.ts
    - tests/unit/migration.test.ts
    - tests/unit/manage-safemode.test.ts
  modified:
    - src/types/index.ts
    - src/utils/config.ts
    - src/utils/defaults.ts
    - src/utils/updateCheck.ts
    - src/core/manage.ts
    - src/index.ts
    - src/mcp/index.ts
    - src/utils/yamlConfig.ts
    - src/utils/configMerge.ts

key-decisions:
  - "isSafeMode() checks KASTELL_SAFE_MODE first; falls back to QUICKLIFY_SAFE_MODE with stderr deprecation warning"
  - "Migration copies entire directory rather than individual files for forward-compat with future config additions"
  - "Deprecation warning uses process.stderr.write to avoid MCP stdout pollution"

patterns-established:
  - "Dual env var pattern: check new var first, fall back to old with one-time deprecation warning"
  - "Config migration pattern: existsSync guard, cpSync recursive, .migrated flag file"

requirements-completed: [BRAND-02, BRAND-09, BRAND-03]

duration: 11min
completed: 2026-03-05
---

# Phase 7 Plan 01: Internal Foundation Rebrand Summary

**Renamed internal types to Kastell*, migrated config path to ~/.kastell with auto-migration, added dual KASTELL_SAFE_MODE/QUICKLIFY_SAFE_MODE env var support, and updated npm registry check to kastell package**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-05T10:11:52Z
- **Completed:** 2026-03-05T10:23:01Z
- **Tasks:** 2 (Task 1 = TDD with RED+GREEN phases)
- **Files modified:** 21

## Accomplishments
- All internal type names changed from Quicklify* to Kastell* (KastellYamlConfig, KastellConfig, KastellResult)
- Config directory changed from ~/.quicklify to ~/.kastell across config.ts, defaults.ts, updateCheck.ts
- New migration utility (src/utils/migration.ts) copies ~/.quicklify to ~/.kastell on first run
- isSafeMode() dual env var support: KASTELL_SAFE_MODE primary, QUICKLIFY_SAFE_MODE backward compat with one-time deprecation warning
- Update check now queries registry.npmjs.org/kastell/latest and suggests npm i -g kastell
- All 2115 tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests** - `6b17127` (test)
2. **Task 1 (GREEN): Implementation** - `3abac00` (feat)
3. **Task 2: Update existing tests** - `a933f55` (test)

_Note: Task 1 was TDD with RED and GREEN commits._

## Files Created/Modified
- `src/utils/migration.ts` - New: migrateConfigIfNeeded() for ~/.quicklify -> ~/.kastell migration
- `src/types/index.ts` - Renamed QuicklifyYamlConfig/Config/Result to Kastell*
- `src/utils/config.ts` - CONFIG_DIR changed to .kastell
- `src/utils/defaults.ts` - CONFIG_DIR changed to .kastell, type import renamed
- `src/utils/updateCheck.ts` - CONFIG_DIR, npm registry URL, install message updated
- `src/core/manage.ts` - isSafeMode() rewritten with dual env var support + chalk import
- `src/index.ts` - Added migrateConfigIfNeeded() call before Commander parse
- `src/mcp/index.ts` - Added migrateConfigIfNeeded() call before MCP server start
- `src/utils/yamlConfig.ts` - Type import renamed to KastellYamlConfig
- `src/utils/configMerge.ts` - Type import renamed to KastellYamlConfig
- `tests/unit/migration.test.ts` - New: 5 tests for migration scenarios
- `tests/unit/manage-safemode.test.ts` - New: 9 tests for dual env var behavior
- 10 existing test files updated for renamed types, paths, and env vars

## Decisions Made
- isSafeMode() uses process.stderr.write instead of console.warn for deprecation warning to avoid MCP stdout pollution
- Migration copies entire directory recursively (not file-by-file) for forward-compat with future config additions
- Deprecation warning flag is module-level (resets on process restart, persists across function calls)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- chalk ESM mock required `__esModule: true` flag in jest.mock for correct CJS interop - fixed by using proper ESM-compatible mock pattern

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Internal identity fully established as "kastell" -- types, config paths, env vars, update check
- Ready for Plan 02 (user-facing string replacements) against consistent foundation
- User-facing strings in MCP tools and commands still reference QUICKLIFY_SAFE_MODE (intentional, covered by Plan 02)

## Self-Check: PASSED

- All key files verified: migration.ts, migration.test.ts, manage-safemode.test.ts
- All commits verified: 6b17127, 3abac00, a933f55
- Build: success
- Tests: 2115/2115 passed

---
*Phase: 07-kastell-rebrand*
*Completed: 2026-03-05*
