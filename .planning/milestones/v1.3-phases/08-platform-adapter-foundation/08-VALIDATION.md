---
phase: 8
slug: platform-adapter-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.x (CJS config) |
| **Config file** | `jest.config.cjs` |
| **Quick run command** | `npx jest --config jest.config.cjs --silent` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --config jest.config.cjs --silent`
- **After every plan wave:** Run `npm test && npm run build && npm run lint`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | ADAPT-01 | unit | `npx jest tests/unit/adapter-interface.test.ts -x` | W0 | pending |
| 08-01-02 | 01 | 1 | ADAPT-03 | unit | `npx jest tests/unit/adapter-factory.test.ts -x` | W0 | pending |
| 08-01-03 | 01 | 1 | ADAPT-04 | unit | `npx jest tests/unit/adapter-factory.test.ts -x` | W0 | pending |
| 08-02-01 | 02 | 2 | ADAPT-02 | unit | `npx jest tests/unit/coolify-adapter.test.ts -x` | W0 | pending |
| 08-02-02 | 02 | 2 | ADAPT-05 | unit | `npx jest src/__tests__/core-*.test.ts -x` | existing | pending |
| 08-02-03 | 02 | 2 | ADAPT-06 | unit | `npx jest src/__tests__/modeGuard.test.ts -x` | existing | pending |
| 08-03-01 | 03 | 3 | ADAPT-07 | full suite | `npm test` | existing | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/adapter-interface.test.ts` -- stubs for ADAPT-01 (interface type tests)
- [ ] `tests/unit/coolify-adapter.test.ts` -- stubs for ADAPT-02 (CoolifyAdapter unit tests)
- [ ] `tests/unit/adapter-factory.test.ts` -- stubs for ADAPT-03, ADAPT-04 (factory + resolvePlatform tests)

*Existing test files for modeGuard.test.ts, core-status.test.ts, core-backup.test.ts, core-deploy.test.ts will need updates but already exist.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| *None* | — | — | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
