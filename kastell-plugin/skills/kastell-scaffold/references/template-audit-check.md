# Template: Audit Check — $1

## Files to Create/Modify

1. `src/core/audit/checks/$1.ts` — check definitions + parser
2. `src/core/audit/commands.ts` — SSH batch section
3. `src/core/audit/checks/index.ts` — registry entry
4. `src/core/audit/compliance/mapper.ts` — compliance mapping (optional)
5. `src/__tests__/core/audit/checks/$1.test.ts` — test file

## Step 1: Check File

```typescript
// src/core/audit/checks/$1.ts
import type { AuditCheck, CheckParser } from "../../types.js";

interface $1CheckDef {
  id: string;           // "CATEGORY-CHECK-NAME" (uppercase, hyphen-separated)
  name: string;         // Human-readable description
  severity: "critical" | "warning" | "info";
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const $1_CHECKS: $1CheckDef[] = [
  {
    id: "CAT-CHECK-ONE",
    name: "Check description",
    severity: "warning",
    check: (output) => {
      const match = output.includes("SENTINEL_PASS");
      return { passed: match, currentValue: match ? "configured" : "not found" };
    },
    expectedValue: "configured",
    fixCommand: "command to fix",
    explain: "Why this matters and what the fix does.",
  },
];

export const parse$1Checks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  // Conditional category: return [] if not applicable (excluded from score)
  if (!sectionOutput || sectionOutput.includes("SKIP_MARKER")) {
    return [];
  }

  return $1_CHECKS.map((def) => {
    const { passed, currentValue } = def.check(sectionOutput);
    return {
      id: def.id,
      category: "Category Name",  // MUST match CHECK_REGISTRY.name exactly
      name: def.name,
      severity: def.severity,
      passed,
      currentValue,
      expectedValue: def.expectedValue,
      fixCommand: def.fixCommand,
      explain: def.explain,
    };
  });
};
```

## Step 2: SSH Batch Section

`src/core/audit/commands.ts` — add bash commands that run on the server.

```typescript
function new$1Section(): string {
  return [
    NAMED_SEP("$1UPPER"),  // MUST match CHECK_REGISTRY.sectionName exactly
    `command1 || echo 'N/A'`,
    `command2 || echo 'N/A'`,
  ].join("\n");
}
```

Add to the correct batch array:
- `BATCH_FAST` — fast commands (<1s)
- `BATCH_MEDIUM` — medium commands (1-5s)
- `BATCH_SLOW` — slow commands (5s+, e.g., `nginx -T`)

**Sentinel matching is critical:** `NAMED_SEP("FOO")` produces `---SECTION:FOO---`. This string MUST match `CHECK_REGISTRY.sectionName` exactly.

For conditional categories, add a skip marker as first command:
```bash
command -v nginx >/dev/null 2>&1 || echo 'NGINX_NOT_INSTALLED'
```

## Step 3: Registry

```typescript
// src/core/audit/checks/index.ts
import { parse$1Checks } from "./$1.js";

export const CHECK_REGISTRY: CategoryEntry[] = [
  // ... existing categories ...
  { name: "Category Name", sectionName: "$1UPPER", parser: parse$1Checks },
];
```

**Triple-check:**
- [ ] `sectionName` === `NAMED_SEP()` parameter
- [ ] `name` === check file's `category` string
- [ ] Import path has `.js` extension (ESM)

## Step 4: Compliance Mapping (Optional)

```typescript
// src/core/audit/compliance/mapper.ts
export const COMPLIANCE_MAP: Record<string, ComplianceRef[]> = {
  // ─── $1 ────────────────────────────────────────
  "CAT-CHECK-ONE": [
    cis("5.x.x", "Control description", "full"),
    pci("x.x.x", "PCI control", "partial"),
  ],
};
```

Helpers: `cis()`, `pci()`, `hipaa()`. Coverage: `"full"` or `"partial"`.

## Severity Guide

| Severity | When | Score weight |
|----------|------|-------------|
| `critical` | Exploitable, immediate fix required | 3x |
| `warning` | Risk exists but not urgent | 2x |
| `info` | Best practice, informational | 1x |

## Anti-Patterns

- **DON'T:** Typo in sentinel strings — parser silently returns empty array, no error
- **DON'T:** Throw exceptions in `check()` — no try/catch wrapper, entire category breaks
- **DON'T:** Reuse check ID across categories — compliance mapping will conflict
- **DON'T:** Multi-step scripts in `fixCommand` — keep it one-line, reference `kastell` command if needed
- **DON'T:** Forget `|| echo 'N/A'` fallback in SSH commands — parser breaks if command missing

## Next Steps

- [ ] Choose correct audit category (29 categories exist)
- [ ] Assign unique check key: `<CATEGORY>-NN` pattern
- [ ] Verify `passed` logic matches `currentValue` evaluation
- [ ] Add SSH command to category batch (avoid extra SSH round-trips)
- [ ] Write test: mock SSH output, verify correct passed/failed
- [ ] Run: `npm test -- --testPathPattern=audit`
- [ ] Verify check count: `kastell audit --json | jq '.summary.totalChecks'`
