---
phase: 35-adapter-deduplication
plan: 01
subsystem: adapters
tags: [typescript, refactoring, adapters, backup, composition]

requires:
  - phase: 34-layer-violation-fix
    provides: clean core/ layer without commands/ imports in core logic

provides:
  - sharedCreateBackup function in adapters/shared.ts
  - sharedRestoreBackup function in adapters/shared.ts
  - AdapterBackupConfig interface
  - AdapterRestoreConfig interface
  - CoolifyAdapter delegating to shared helpers (thin wrapper)
  - DokployAdapter delegating to shared helpers (thin wrapper)

affects:
  - future adapter additions (new adapters follow same backupConfig/restoreConfig pattern)
  - 36-notify-module
  - 37-doctor-fix
  - 38-fleet

tech-stack:
  added: []
  patterns:
    - "Config-object composition: shared functions receive platform-specific values as AdapterBackupConfig/AdapterRestoreConfig objects"
    - "Adapter delegation: adapter class holds no control-flow logic; builds config and delegates to shared.*"

key-files:
  created: []
  modified:
    - src/adapters/shared.ts
    - src/adapters/coolify.ts
    - src/adapters/dokploy.ts

key-decisions:
  - "Config-object composition over inheritance — two adapters, composition is simpler and avoids fragile hierarchy (existing project lesson)"
  - "AdapterRestoreConfig.tryRestartCmd string field replaces private tryRestartDokploy() method and tryRestartCoolify() import — uniform pattern across adapters"
  - "platformLabel capitalized in step names (Stop Coolify / Stop Dokploy) for backward-compatible UX output"
  - "sharedCreateBackup writes coolifyVersion field unconditionally — preserves backward compat for legacy manifests"

patterns-established:
  - "Adapter config builders: private backupConfig() and restoreConfig() methods return typed config objects — no inline literals in public methods"

requirements-completed:
  - DEBT-01

duration: 20min
completed: 2026-03-14
---

# Phase 35 Plan 01: Adapter Deduplication Summary

**Config-object composition extraction of ~210 lines of duplicate backup/restore logic from CoolifyAdapter and DokployAdapter into two shared helper functions in adapters/shared.ts**

## Performance

- **Duration:** 20 min
- **Started:** 2026-03-14T17:00:00Z
- **Completed:** 2026-03-14T17:20:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Extracted `sharedCreateBackup` and `sharedRestoreBackup` into `src/adapters/shared.ts` with typed `AdapterBackupConfig` and `AdapterRestoreConfig` interfaces
- Reduced CoolifyAdapter and DokployAdapter backup/restore methods to thin wrappers: each method is now 1 line (call to shared function) plus private config builders
- Removed ~430 lines of near-duplicate control flow across the two adapters (~215 from coolify.ts, ~215 from dokploy.ts)
- All 3038 tests pass, zero test file modifications, build and lint clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Add sharedCreateBackup and sharedRestoreBackup to shared.ts** - `2088d29` (feat)
2. **Task 2: Refactor coolify.ts and dokploy.ts to delegate to shared helpers** - `c582bc6` (refactor)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `src/adapters/shared.ts` - Added AdapterBackupConfig, AdapterRestoreConfig interfaces + sharedCreateBackup + sharedRestoreBackup functions; added imports for fs, path, core/backup, types/index
- `src/adapters/coolify.ts` - Replaced createBackup/restoreBackup bodies with 1-line delegation; added private backupConfig() and restoreConfig() methods; removed all stale imports (mkdirSync, writeFileSync, join, build*Command, tryRestartCoolify)
- `src/adapters/dokploy.ts` - Same delegation pattern; removed stale imports; deleted private tryRestartDokploy() method and individual build*Command methods

## Decisions Made

- Config-object composition over inheritance — two adapters, composition is cleaner per existing project lesson
- `tryRestartCmd` as a string field in `AdapterRestoreConfig` replaces the private `tryRestartDokploy()` method in DokployAdapter and the `tryRestartCoolify` import in CoolifyAdapter — uniform restart pattern
- Platform name is capitalized in step names (`Stop Coolify`, `Start Dokploy`) using `charAt(0).toUpperCase()` for UX consistency with original behavior
- `coolifyVersion` field in `BackupManifest` written unconditionally regardless of platform — backward compatibility for existing manifests

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DEBT-01 satisfied: adapter backup/restore duplication eliminated
- Phase 36 (Notify Module) is ready to start — no adapter concerns blocking it
- Future adapters follow the established pattern: implement `backupConfig()` and `restoreConfig()` returning typed config objects, delegate to shared helpers

---
*Phase: 35-adapter-deduplication*
*Completed: 2026-03-14*
