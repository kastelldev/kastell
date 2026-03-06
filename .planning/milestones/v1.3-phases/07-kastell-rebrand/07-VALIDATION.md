---
phase: 7
slug: kastell-rebrand
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-05
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.2.0 with ts-jest 29.4.6 |
| **Config file** | `jest.config.cjs` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm run build && npm test && npm run lint` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm run build && npm test && npm run lint`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | BRAND-01 | unit | `npx jest tests/unit/doctor.test.ts -x` | Needs update | pending |
| 07-01-02 | 01 | 1 | BRAND-02 | unit | `npx jest tests/unit/config.test.ts -x` | Needs update + new migration tests | pending |
| 07-01-03 | 01 | 1 | BRAND-09 | unit | `npx jest tests/unit/mcp-server-manage.test.ts tests/unit/restore-safemode.test.ts -x` | Needs update + backward compat | pending |
| 07-02-01 | 02 | 2 | BRAND-03 | smoke | `grep -ri "quicklify" src/ \| grep -v CHANGELOG` | Manual / CI | pending |
| 07-02-02 | 02 | 2 | BRAND-04 | smoke | `grep -ri "quicklify" tests/` | Manual / CI | pending |
| 07-02-03 | 02 | 2 | BRAND-08 | unit | `npx jest tests/unit/mcp-server-info.test.ts -x` | Needs update | pending |
| 07-03-01 | 03 | 3 | BRAND-05 | manual-only | Visual inspection of LICENSE + NOTICE | N/A | pending |
| 07-03-02 | 03 | 3 | BRAND-06 | manual-only | Visual inspection of docs | N/A | pending |
| 07-03-03 | 03 | 3 | BRAND-07 | integration | `gh run list` after push | Existing CI | pending |
| 07-03-04 | 03 | 3 | BRAND-10 | manual-only | `npm info kastell version` after publish | N/A | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/migration.test.ts` — stubs for BRAND-02 (config migration logic)
- [ ] Update existing env var tests for dual `KASTELL_SAFE_MODE` / `QUICKLIFY_SAFE_MODE` — BRAND-09
- [ ] Grep verification script for BRAND-03 and BRAND-04 zero-hit validation

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LICENSE contains Apache 2.0 text | BRAND-05 | Legal document, visual check | Compare LICENSE against official Apache 2.0 text |
| NOTICE file exists with attribution | BRAND-05 | Legal document, visual check | Verify copyright holder and year |
| README/docs reflect Kastell brand | BRAND-06 | Content review, not code | Grep docs for "quicklify" references |
| npm publish succeeds | BRAND-10 | Requires npm credentials + publish | Run `npm info kastell version` after publish |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
