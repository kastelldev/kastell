# CodeQL Alerts Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 18 CodeQL security alerts across 6 files in `.github/workflows/` and `src/` directories.

**Architecture:** 
- Critical: Fix workflow_run-triggered workflows using untrusted branch refs — switch to commit SHA validation
- High: Add input sanitization to shell commands in report.ts, sysctl.ts, network.ts, filesystem.ts; confirm logger.ts false positives
- Medium: Add explicit `permissions` blocks to workflow files

**Tech Stack:** GitHub Actions, TypeScript, shell escaping

---

## Pre-flight: Read alert details

**Files to verify current state:**
- Modify: `.github/workflows/publish.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/staging.yml`
- Modify: `.github/workflows/mutation.yml`
- Modify: `src/utils/logger.ts`
- Modify: `src/core/formatters/report.ts`
- Modify: `src/core/shared/sysctl.ts`
- Modify: `src/core/checks/network.ts`
- Modify: `src/core/checks/filesystem.ts`

---

## Phase 1: CRITICAL — Workflow Untrusted Code Checkout (4 alerts)

### Task 1: Fix publish.yml — use SHA instead of branch ref

**File:** `.github/workflows/publish.yml`

- [ ] **Step 1: Read current publish.yml to confirm alert locations**
  
  Read: `.github/workflows/publish.yml`
  Alert locations: lines 29, 31, 33 — all the `actions/checkout` step using `ref: ${{ github.event.workflow_run.head_branch }}`

- [ ] **Step 2: Replace branch ref with SHA-based ref**
  
  The `workflow_run` event provides `github.event.workflow_run.head_sha` — use this instead of branch name.
  
  Edit `.github/workflows/publish.yml`:
  ```yaml
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
  ```
  
  Change line 20 from:
  ```yaml
          ref: ${{ github.event.workflow_run.head_branch }}
  ```
  To:
  ```yaml
          ref: ${{ github.event.workflow_run.head_sha }}
  ```

- [ ] **Step 3: Verify no other references to `head_branch` remain**
  
  Run: `grep -n "head_branch" .github/workflows/publish.yml`
  Expected: 0 matches

- [ ] **Step 4: Commit**
  
  ```bash
  git add .github/workflows/publish.yml
  git commit -m "fix(security): use SHA instead of branch ref in publish workflow"
  ```

---

### Task 2: Fix release.yml — use SHA and add validation

**File:** `.github/workflows/release.yml`

- [ ] **Step 1: Read current release.yml to confirm alert locations**
  
  Read: `.github/workflows/release.yml`
  Alert location: line 29 — `actions/checkout` with `ref: ${{ steps.tag.outputs.name }}`

- [ ] **Step 2: The tag output is already SHA-validated — verify checkout is safe**
  
  The workflow already validates the tag format (semver) at line 23-26 before checkout. The `steps.tag.outputs.name` is the validated tag name (e.g., `v1.0.0`), not a raw branch name. So this alert may be a **false positive**.
  
  However, to be safe and satisfy CodeQL, add explicit SHA checkout:
  
  The `workflow_run` event provides `github.event.workflow_run.head_sha`. Modify the checkout step:
  
  Edit `.github/workflows/release.yml` line 29-31:
  ```yaml
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
  ```
  
  Note: The `steps.tag.outputs.name` is used later for release creation (correct), but checkout should use SHA for security.

- [ ] **Step 3: Verify no remaining untrusted refs**
  
  Run: `grep -n "head_branch\|head_sha" .github/workflows/release.yml`
  Expected: Only `head_sha` references (safe)

- [ ] **Step 4: Commit**
  
  ```bash
  git add .github/workflows/release.yml
  git commit -m "fix(security): use SHA for checkout in release workflow"
  ```

---

## Phase 2: MEDIUM — Missing Workflow Permissions (4 alerts)

### Task 3: Add permissions blocks to ci.yml, staging.yml, mutation.yml

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/staging.yml`
- Modify: `.github/workflows/mutation.yml`

- [ ] **Step 1: Read ci.yml and identify where to add permissions**
  
  Read: `.github/workflows/ci.yml`
  Alert locations: lines 12 (test job), 54 (notify-profile job)
  
  The `test` job needs no special permissions (default).
  The `notify-profile` job needs `contents: write` for the API dispatch.
  
  Add at job level:
  ```yaml
    permissions:
      contents: read
  ```
  
  Edit `.github/workflows/ci.yml` — add after `runs-on: ubuntu-latest` in `notify-profile` job (line 57):
  ```yaml
    permissions:
      contents: read
    steps:
  ```

- [ ] **Step 2: Add permissions to staging.yml**
  
  Read: `.github/workflows/staging.yml`
  Alert location: line 11 (job start)
  
  Add `permissions: contents: read` at job level.

- [ ] **Step 3: Add permissions to mutation.yml**
  
  Read: `.github/workflows/mutation.yml`
  Alert location: line 35
  
  Add `permissions: contents: read` at job level.

- [ ] **Step 4: Commit all three**
  
  ```bash
  git add .github/workflows/ci.yml .github/workflows/staging.yml .github/workflows/mutation.yml
  git commit -m "fix(security): add explicit permissions blocks to workflows"
  ```

---

## Phase 3: HIGH — String Escaping in Shell Commands (5 files)

### Task 4: Analyze string escaping alerts — determine false positive vs real

**Files to read:**
- Read: `src/core/formatters/report.ts`
- Read: `src/core/shared/sysctl.ts`
- Read: `src/core/checks/network.ts`
- Read: `src/core/checks/filesystem.ts`

- [ ] **Step 1: Check each file for shell command patterns**
  
  For each file, look for:
  - Template literals used in shell commands (backticks with `$`)
  - String concatenation in `exec()`, `spawn()`, shell strings
  - User-controlled input passed to shell without escaping
  
  Common patterns that trigger this alert:
  ```typescript
  // BAD — unescaped user input
  exec(`grep ${userInput} file`);
  
  // GOOD — proper escaping
  exec(`grep ${escape(userInput)} file`);
  ```

- [ ] **Step 2: For each file, determine fix or false-positive justification**
  
  If real vulnerability: apply proper escaping using `escapeShellArg()` or equivalent.
  If false positive: add CodeQL suppression comment:
  ```typescript
  // CodeQL suppression: intentional shell usage, input is validated
  ```

- [ ] **Step 3: Commit per-file fixes**
  
  Each file gets its own commit with clear message: `fix(security): escape user input in <file>` or `fix(security): suppress false-positive CodeQL alert in <file>`

---

### Task 5: Confirm logger.ts is false positive

**File:** `src/utils/logger.ts`

- [ ] **Step 1: Read logger.ts and verify redaction logic**
  
  Already read: lines 39-53 show `REDACT_PATTERNS` and `redactArg` function.
  
  The `debugLog` function (line 51-53) already calls `redactArg` on all arguments:
  ```typescript
  export const debugLog = process.env.KASTELL_DEBUG
    ? (...args: unknown[]) => console.error("[debug]", ...args.map(redactArg))
    : undefined;
  ```
  
  The `logger` methods (lines 5-29) log user-facing messages, not sensitive data.

- [ ] **Step 2: This is confirmed false positive — add suppression**
  
  Add at top of file:
  ```typescript
  // CodeQL suppression: logger methods display user-facing messages only;
  // sensitive data is redacted via REDACT_PATTERNS in debugLog
  ```

- [ ] **Step 3: Commit**
  
  ```bash
  git add src/utils/logger.ts
  git commit -m "fix(security): suppress false-positive CodeQL alert in logger.ts"
  ```

---

## Verification

- [ ] **Step 1: Run CodeQL locally (or wait for GitHub to re-scan)**
  
  Push to a branch and check the Security tab for alert status.
  
- [ ] **Step 2: Verify all 18 alerts are addressed**
  
  Go to: https://github.com/kastelldev/kastell/security/code-scanning
  Expected: Critical and Medium alerts resolved; High alerts require per-file analysis in Task 4.

---

## Rollback Plan

If any change breaks CI:
```bash
git revert <commit-hash>
```

---

## Success Criteria

- [ ] 4 Critical alerts: RESOLVED (publish.yml and release.yml use SHA)
- [ ] 4 Medium alerts: RESOLVED (permissions blocks added)
- [ ] 3 High logger.ts alerts: RESOLVED (false positive suppressed)
- [ ] 7 High string-escaping alerts: ANALYZED and either fixed or suppressed with justification
- [ ] CI green on all changes
