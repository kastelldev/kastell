# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.2.1 — Refactor + Security Patch

**Shipped:** 2026-03-02
**Phases:** 3 | **Plans:** 6 | **Sessions:** 1

### What Was Built
- PROVIDER_REGISTRY centralization: single source of truth for all 4 provider identities (14 call sites updated)
- stripSensitiveData consolidation: 4 duplicate functions merged into 1 in base.ts
- SCP security hardening: stdin=ignore, BatchMode=yes, 5-minute SIGTERM timeout
- Token sanitization: .trim() + whitespace-only guard at getProviderToken() boundary
- deployServer() extraction: init.ts 612→243 lines, independent unit tests for deployment logic
- OWASP fix: sanitizeResponseData() whitelist for API error responses

### What Worked
- Single-day execution: all 3 phases completed in ~3 hours (09:16→11:51)
- TDD pattern enabled fast, confident refactoring — no regressions across 2099 tests
- Phase parallelism: Phase 4 and 5 ran independently as planned
- Milestone audit before completion caught 0 gaps — requirements were well-scoped
- Small, focused plans (2 per phase) kept execution tight

### What Was Inefficient
- STATE.md accumulated duplicate YAML frontmatter blocks (6 blocks stacked instead of 1)
- Phase 04-01 SUMMARY.md frontmatter missed REF-01 in requirements-completed field (metadata oversight, not functional gap)
- Accomplishments not extracted by CLI `milestone complete` tool (returned empty array — had to be added manually)

### Patterns Established
- `createMockProvider(overrides)` helper pattern for CloudProvider test setup
- `jest.requireMock()` accessor pattern for typed mock access across describe blocks
- Registry-derived constants pattern: define once as `as const`, derive type + array + maps
- Token sanitization at env-read boundary (not at call sites)
- OWASP whitelist approach for API response data sanitization

### Key Lessons
1. Refactor milestones execute fast because the risk is lower — tests catch regressions immediately
2. Centralized constants (PROVIDER_REGISTRY) eliminate drift across files and make Zod validation trivial
3. Extracting functions to core/ makes them independently testable — deploy.ts tests don't need init wizard mocking
4. OWASP audit after implementation catches security gaps that unit tests miss (e.g., response.data leaking sensitive info)

### Cost Observations
- Model mix: 100% opus (all phases)
- Sessions: 1 continuous session
- Notable: 6 plans in 1 session, ~30 min average per plan including verification

---

## Milestone: v1.3 — Kastell Rebrand + Dokploy Adapter

**Shipped:** 2026-03-06
**Phases:** 4 | **Plans:** 8 | **Sessions:** ~3

### What Was Built
- Full rebrand from Quicklify to Kastell: 35 src + 25 test files, types, config paths, env vars, bin scripts, docs
- Auto-migration logic (migrateConfigIfNeeded) with .migrated flag and robustness
- Apache 2.0 license with NOTICE file (patent protection for security tooling)
- PlatformAdapter interface with 4 methods (getCloudInit, healthCheck, createBackup, getStatus)
- CoolifyAdapter extracted from existing code with zero behavior change
- DokployAdapter: cloud-init (Docker Swarm + Dokploy install), health check (port 3000), backup (pg_dump + /etc/dokploy)
- Factory pattern (getAdapter) with resolvePlatform normalization for legacy records
- Platform-aware health verification and mode guard (requireManagedMode)
- Phase 10 gap closure: addServerRecord platform derivation + port-specific health check

### What Worked
- Two-day execution for 4 phases (2026-03-05 -> 2026-03-06), ~60 min total plan execution
- Phase dependency chain (7->8->9->10) executed cleanly without blockers
- Adapter pattern design enabled DokployAdapter implementation in <15 min
- Milestone audit after Phase 9 caught INT-01/INT-02 gaps; Phase 10 closed them same day
- 2191 tests with zero regressions throughout all phases

### What Was Inefficient
- Phase 10 (gap closure) skipped GSD documentation (no PLAN, SUMMARY, VERIFICATION) — created audit blocker
- SUMMARY frontmatter `requirements_completed` never populated in any plan (GSD tooling gap)
- Nyquist validation not executed for any phase (VALIDATION.md created but never filled)
- `milestone complete` CLI returned empty accomplishments array — manual entry needed again

### Patterns Established
- Adapter pattern: implement PlatformAdapter + add factory case = new platform support
- resolvePlatform() for legacy record normalization (mode-based -> platform-based)
- Dual env var support with deprecation warning (KASTELL_ primary, QUICKLIFY_ fallback)
- Platform-derived port selection for health checks (dokploy:3000, coolify:8000)

### Key Lessons
1. Quick fixes should still get minimal GSD documentation (at least VERIFICATION.md) to avoid audit blockers
2. Adapter pattern makes platform extension trivial — Phase 9 (DokployAdapter) was the fastest phase
3. Milestone audit -> gap closure -> re-audit loop works well for catching integration issues
4. Research before planning (Phase 8, 9) reduced plan deviation to zero

### Cost Observations
- Model mix: ~80% opus, ~20% sonnet (integration checker)
- Sessions: ~3 sessions across 2 days
- Notable: Phase 9 (DokployAdapter) fastest at 6 min/plan avg — adapter pattern payoff

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.2.0 | 3 | 3 (12 plans) | First GSD-tracked milestone, established core/ architecture |
| v1.2.1 | 1 | 3 (6 plans) | Refactor-only milestone, single-day completion, OWASP audit added |
| v1.3 | ~3 | 4 (8 plans) | Rebrand + adapter pattern + second platform, audit->gap closure loop |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.2.0 | 1921 -> 2047 | 95%+ | 0 |
| v1.2.1 | 2047 -> 2099 | 95%+ | 0 |
| v1.3 | 2099 -> 2191 | 95%+ | 0 |

### Top Lessons (Verified Across Milestones)

1. TDD catches regressions during refactoring — verified in v1.2.0, v1.2.1, and v1.3 (adapter extraction + DokployAdapter)
2. Small, scoped plans (2-5 tasks each) complete faster and with fewer deviations than large plans
3. Phase-level verification (VERIFICATION.md) before milestone audit reduces audit-time gap discovery
4. Audit -> gap closure -> re-audit loop catches integration issues that phase-level verification misses (v1.3 INT-01/INT-02)
5. Quick fixes still need minimal GSD documentation to avoid process blockers (v1.3 Phase 10 lesson)
