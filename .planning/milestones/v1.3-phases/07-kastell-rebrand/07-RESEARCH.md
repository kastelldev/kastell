# Phase 7: Kastell Rebrand - Research

**Researched:** 2026-03-05
**Domain:** CLI rebrand, npm package migration, license change, config migration
**Confidence:** HIGH

## Summary

Phase 7 is a comprehensive rename from "quicklify" to "kastell" across the entire codebase, including CLI binary names, config paths, environment variables, npm package, license, documentation, and CI. The codebase has **124 occurrences of "quicklify" across 42 source files** and **140 occurrences across 32 test files**. The rebrand is purely mechanical (string replacement) with three areas requiring careful logic: (1) config directory migration from `~/.quicklify` to `~/.kastell`, (2) environment variable backward compatibility for `QUICKLIFY_SAFE_MODE`, and (3) snapshot name prefix change from `quicklify-` to `kastell-` with backward compatibility for Linode's snapshot filter.

The license change from MIT to Apache 2.0 requires replacing the LICENSE file and creating a NOTICE file. The npm publish requires publishing `kastell@1.3.0` and deprecating the old `quicklify` package. The `quicklify.yml` config file name and `quicklify-export.json` default export filename also need renaming.

**Primary recommendation:** Execute the rebrand in waves -- first internal code (types, config paths, env vars), then CLI-facing code (commands, messages, bin scripts), then tests, then documentation and packaging -- with `npm test` validation after each wave.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Config Migration: if `~/.quicklify` exists and `~/.kastell` does not, copy entire contents to `~/.kastell/` (including backups/, ssh keys). Create `.migrated` flag file. Show chalk warn message. Old directory NOT deleted. If `~/.kastell` already exists, skip entirely.
- Environment Variables: `KASTELL_SAFE_MODE` is primary. `QUICKLIFY_SAFE_MODE` continues working with deprecation warning until v2.0. Warning only when old is set AND new is NOT set. If both set, new takes precedence (no warning).
- String Replacement: ALL 124 references in 42 src/ files renamed. Internal types renamed (QuicklifyConfig -> KastellConfig etc). bin/ scripts renamed. Test files updated separately. CHANGELOG historical entries preserved.
- npm Publish: Deprecation message "Moved to kastell -- https://www.npmjs.com/package/kastell". Description: "Autonomous security and maintenance layer for self-hosted infrastructure". Keywords updated. Homepage: https://kastell.dev. Version 1.3.0.
- Provider token env vars (HETZNER_TOKEN, etc.) stay unchanged.
- Repository URL stays as `https://github.com/omrfc/quicklify.git` until post-v1.3 transfer.

### Claude's Discretion
- Exact migration function placement (utils/config.ts or separate utils/migration.ts)
- Order of file-by-file string replacements (bulk vs incremental approach)
- NOTICE file content format for Apache 2.0
- CI workflow update details (artifact names, job names)
- Exact deprecation warning message wording for env vars

### Deferred Ideas (OUT OF SCOPE)
- GitHub repo transfer (omrfc/quicklify -> kastelldev/kastell) -- post-v1.3
- kastell.dev website content -- v1.5
- Provider token env var namespacing (KASTELL_HETZNER_TOKEN) -- rejected, unnecessary complexity
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BRAND-01 | CLI command runs as `kastell` | Requires package.json `bin` rename, `src/index.ts` `.name("kastell")`, bin/ script rename, process.title change |
| BRAND-02 | Config path `~/.kastell`, auto-migrate from `~/.quicklify` | Three CONFIG_DIR definitions (config.ts, defaults.ts, updateCheck.ts) + new migration function with `.migrated` flag + chalk warning |
| BRAND-03 | All src/ "quicklify" refs -> "kastell" | 124 occurrences in 42 files; includes types, MCP descriptions, cloud-init scripts, error messages, snapshot prefixes |
| BRAND-04 | Test files "quicklify" refs -> "kastell" | 140 occurrences in 32 test files; mock values, assertions, env var references, path expectations |
| BRAND-05 | LICENSE MIT -> Apache 2.0, NOTICE file | Replace LICENSE content, create NOTICE file with copyright attribution |
| BRAND-06 | Update README, README.tr, CHANGELOG, SECURITY, CONTRIBUTING, llms.txt | All docs contain "quicklify" branding, badges, URLs, usage examples |
| BRAND-07 | GitHub Actions workflows updated | ci.yml and publish.yml -- minimal quicklify references but job names/comments may reference it |
| BRAND-08 | MCP server name "kastell" | server.ts uses `pkg.name` from package.json (auto-updates). 7 tool descriptions contain "Quicklify" text |
| BRAND-09 | Env vars `KASTELL_*` prefix, old `QUICKLIFY_*` with warning | `isSafeMode()` in manage.ts needs dual-check logic. MCP tool descriptions reference `QUICKLIFY_SAFE_MODE` |
| BRAND-10 | npm publish `kastell@1.3.0`, deprecate `quicklify` | package.json full update + `npm deprecate quicklify` command + publish workflow adjusts |
</phase_requirements>

## Architecture Patterns

### Recommended Approach: Staged Rename

The rebrand should follow this structure to minimize risk:

```
Wave 1: Foundation (types, config, env vars)
  src/types/index.ts          # QuicklifyYamlConfig -> KastellYamlConfig, etc.
  src/utils/config.ts          # CONFIG_DIR + migration logic
  src/utils/defaults.ts        # CONFIG_DIR
  src/utils/updateCheck.ts     # CONFIG_DIR + npm registry URL
  src/core/manage.ts           # isSafeMode() dual env var

Wave 2: Core + Utils (internal references)
  src/utils/cloudInit.ts       # log file names, echo messages
  src/utils/sshKey.ts          # SSH key comment + name prefix
  src/utils/errorMapper.ts     # CLI command references in messages
  src/utils/serverSelect.ts    # "quicklify init" message
  src/utils/yamlConfig.ts      # type imports
  src/utils/configMerge.ts     # type imports
  src/core/deploy.ts           # 19 CLI command references in messages
  src/core/snapshot.ts         # snapshot name prefix
  src/providers/linode.ts      # snapshot filter prefix

Wave 3: Commands (user-facing strings)
  src/index.ts                 # program name, description, option help
  src/commands/*.ts            # all 23 command files with messages
  src/mcp/server.ts            # 7 tool descriptions
  src/mcp/index.ts             # startup log message
  src/mcp/tools/*.ts           # command suggestions in responses

Wave 4: Tests
  tests/unit/*.test.ts         # mock values, assertions, paths
  tests/integration/*.test.ts  # snapshot names in test data
  tests/e2e/*.test.ts          # mock values, expected outputs

Wave 5: Packaging + Docs
  package.json                 # name, bin, description, keywords, homepage, license
  bin/quicklify -> bin/kastell
  bin/quicklify-mcp -> bin/kastell-mcp
  LICENSE                      # Apache 2.0 text
  NOTICE                       # new file
  README.md, README.tr.md      # full rebrand
  CHANGELOG.md                 # v1.3 entry only
  SECURITY.md, CONTRIBUTING.md, llms.txt
  quicklify.yml -> kastell.yml
  .mcp.json                    # server name + bin path
  CLAUDE.md                    # project instructions
  .claude/skills/*.md          # skill references
```

### Pattern: Config Migration Function

**Recommendation:** Create a separate `src/utils/migration.ts` file. This keeps migration logic isolated and easy to remove in a future version.

```typescript
// src/utils/migration.ts
import { existsSync, mkdirSync, cpSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import chalk from "chalk";

const OLD_CONFIG_DIR = join(homedir(), ".quicklify");
const NEW_CONFIG_DIR = join(homedir(), ".kastell");
const MIGRATED_FLAG = join(NEW_CONFIG_DIR, ".migrated");

export function migrateConfigIfNeeded(): void {
  // Skip if new dir already exists (user already migrated or fresh install)
  if (existsSync(NEW_CONFIG_DIR)) return;

  // Skip if old dir doesn't exist (fresh install)
  if (!existsSync(OLD_CONFIG_DIR)) return;

  // Copy entire old directory to new location
  mkdirSync(NEW_CONFIG_DIR, { recursive: true, mode: 0o700 });
  cpSync(OLD_CONFIG_DIR, NEW_CONFIG_DIR, { recursive: true });

  // Create migration flag
  writeFileSync(MIGRATED_FLAG, new Date().toISOString(), { mode: 0o600 });

  // Warn user
  console.warn(
    chalk.yellow(
      "Migrated config from ~/.quicklify to ~/.kastell. You can safely remove ~/.quicklify."
    )
  );
}
```

**Call site:** Early in `src/index.ts` before any config access, and in `src/mcp/index.ts` before MCP server starts.

### Pattern: Dual Environment Variable Check

```typescript
// src/core/manage.ts
export function isSafeMode(): boolean {
  const kastell = process.env.KASTELL_SAFE_MODE;
  const quicklify = process.env.QUICKLIFY_SAFE_MODE;

  // New var takes precedence
  if (kastell !== undefined) {
    return kastell === "true";
  }

  // Old var with deprecation warning
  if (quicklify !== undefined) {
    console.warn(
      chalk.yellow(
        "QUICKLIFY_SAFE_MODE is deprecated. Use KASTELL_SAFE_MODE instead. " +
        "Support will be removed in v2.0."
      )
    );
    return quicklify === "true";
  }

  return false;
}
```

**Important:** The deprecation warning should only print once per process. Use a module-level flag to prevent repeated warnings.

### Pattern: Snapshot Prefix Backward Compatibility

The Linode provider filters snapshots by `quicklify-` prefix. After rename, new snapshots will be `kastell-*` but existing snapshots remain `quicklify-*`. The filter must accept both prefixes:

```typescript
// src/providers/linode.ts - listSnapshots
img.type === "manual" && img.label &&
  (img.label.startsWith("kastell-") || img.label.startsWith("quicklify-"))
```

### Anti-Patterns to Avoid

- **Bulk find-and-replace without audit:** Some "quicklify" references are in different contexts (log file paths on remote servers, snapshot names in cloud APIs, npm registry URLs). Each context needs specific handling.
- **Breaking the CHANGELOG:** Historical entries must remain as "quicklify" -- only the v1.3 entry references the rename.
- **Forgetting the default export filename:** `quicklify-export.json` in `transfer.ts` should become `kastell-export.json`.
- **Missing the `process.title` assignment:** `src/commands/init.ts` sets `process.title = "quicklify"`.
- **Cloud-init log path change:** The cloud-init scripts log to `/var/log/quicklify-install.log` on remote servers. Changing this to `kastell-install.log` affects new deployments only. Existing servers keep the old log path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Directory copy | Manual recursive file copy | `fs.cpSync(src, dest, { recursive: true })` | Node 16.7+ built-in, handles symlinks and permissions |
| Apache 2.0 license text | Custom license wording | Official text from apache.org/licenses/LICENSE-2.0.txt | Must be verbatim, legal implications |
| npm deprecation | Custom deprecation notice | `npm deprecate quicklify "message"` | Standard npm CLI command |
| Snapshot prefix compat | Complex migration | Dual-prefix filter (`startsWith("kastell-") \|\| startsWith("quicklify-")`) | Simple, zero-risk |

## Common Pitfalls

### Pitfall 1: False Positive String Replacement
**What goes wrong:** Blindly replacing "quicklify" catches unintended matches (e.g., inside URLs, variable names that shouldn't change).
**Why it happens:** Some references are in different contexts requiring different replacement strings.
**How to avoid:** Categorize each reference by context before replacing:
- Type names: `Quicklify` -> `Kastell` (PascalCase)
- Config paths: `.quicklify` -> `.kastell` (lowercase)
- CLI binary: `quicklify` -> `kastell` (lowercase)
- npm package: `quicklify` -> `kastell` (lowercase)
- Log file names: `quicklify-install.log` -> `kastell-install.log`
- Snapshot prefixes: `quicklify-` -> `kastell-` (but keep backward compat filter)
- SSH key comment: `quicklify` -> `kastell`
**Warning signs:** Tests failing with unexpected path/name mismatches.

### Pitfall 2: Config Migration Race Condition
**What goes wrong:** Migration runs while another process is reading config.
**Why it happens:** Multiple CLI invocations or MCP + CLI running simultaneously.
**How to avoid:** The `.migrated` flag check at the start prevents re-migration. The "skip if `~/.kastell` exists" guard prevents overwriting. `cpSync` is synchronous so no partial state.

### Pitfall 3: Forgetting MCP Tool Descriptions
**What goes wrong:** MCP tools still reference "Quicklify" in their descriptions, confusing AI agents.
**Why it happens:** 7 tools have verbose descriptions with multiple "Quicklify" references.
**How to avoid:** Grep `src/mcp/server.ts` specifically -- it has 7 tool descriptions with "Quicklify-managed", "Quicklify servers", "QUICKLIFY_SAFE_MODE" references. Each needs updating.
**Warning signs:** MCP clients showing "Quicklify" in tool descriptions.

### Pitfall 4: Update Check Points to Wrong npm Package
**What goes wrong:** After rename, `checkForUpdate()` still checks `quicklify` on npm registry.
**Why it happens:** `updateCheck.ts` hardcodes `https://registry.npmjs.org/quicklify/latest`.
**How to avoid:** Change to `https://registry.npmjs.org/kastell/latest` and update the install message from `npm i -g quicklify` to `npm i -g kastell`.

### Pitfall 5: Linode Snapshot Filter Breaks Existing Snapshots
**What goes wrong:** Users with existing `quicklify-*` snapshots on Linode can no longer see them via `kastell snapshot list`.
**Why it happens:** `linode.ts` filters snapshots by `img.label.startsWith("quicklify-")`.
**How to avoid:** Change filter to accept both prefixes: `startsWith("kastell-") || startsWith("quicklify-")`.
**Warning signs:** Linode users reporting missing snapshots after upgrade.

### Pitfall 6: bin/ Script Rename Breaks npm Installation
**What goes wrong:** After changing package.json `bin` entries, old `bin/quicklify` files remain and cause confusion.
**Why it happens:** Git tracks old filenames; npm links binary names from package.json.
**How to avoid:** Create new `bin/kastell` and `bin/kastell-mcp` files, delete old `bin/quicklify` and `bin/quicklify-mcp`, update package.json bin entries. Ensure `package.json.files` includes `bin/`.

### Pitfall 7: YAML Config File Reference
**What goes wrong:** `--config` help text still says "quicklify.yml" and the example file is still named `quicklify.yml`.
**Why it happens:** Easily overlooked references in help text and example files.
**How to avoid:** Rename `quicklify.yml` to `kastell.yml`, update `--config` option help text in `src/index.ts`.

## Code Examples

### Config Migration Implementation

```typescript
// Source: Verified against Node.js fs.cpSync docs and project patterns
import { existsSync, mkdirSync, cpSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import chalk from "chalk";

const OLD_CONFIG_DIR = join(homedir(), ".quicklify");
const NEW_CONFIG_DIR = join(homedir(), ".kastell");
const MIGRATED_FLAG = join(NEW_CONFIG_DIR, ".migrated");

export function migrateConfigIfNeeded(): void {
  if (existsSync(NEW_CONFIG_DIR)) return;
  if (!existsSync(OLD_CONFIG_DIR)) return;

  mkdirSync(NEW_CONFIG_DIR, { recursive: true, mode: 0o700 });
  cpSync(OLD_CONFIG_DIR, NEW_CONFIG_DIR, { recursive: true });
  writeFileSync(MIGRATED_FLAG, new Date().toISOString(), { mode: 0o600 });

  console.warn(
    chalk.yellow(
      "Migrated config from ~/.quicklify to ~/.kastell. You can safely remove ~/.quicklify."
    )
  );
}
```

### Dual Environment Variable with One-Time Warning

```typescript
// Source: Project pattern from manage.ts + CONTEXT.md decisions
let _safeModWarningShown = false;

export function isSafeMode(): boolean {
  const kastell = process.env.KASTELL_SAFE_MODE;
  const quicklify = process.env.QUICKLIFY_SAFE_MODE;

  if (kastell !== undefined) {
    return kastell === "true";
  }

  if (quicklify !== undefined) {
    if (!_safeModWarningShown) {
      _safeModWarningShown = true;
      process.stderr.write(
        chalk.yellow(
          "Warning: QUICKLIFY_SAFE_MODE is deprecated. Use KASTELL_SAFE_MODE instead. " +
          "Support will be removed in v2.0.\n"
        )
      );
    }
    return quicklify === "true";
  }

  return false;
}
```

### Apache 2.0 NOTICE File

```
Kastell
Copyright 2026 Omer Faruk CAN

This product includes software developed by
Omer Faruk CAN (https://omrfc.dev).
```

### package.json Changes

```json
{
  "name": "kastell",
  "version": "1.3.0",
  "description": "Autonomous security and maintenance layer for self-hosted infrastructure",
  "license": "Apache-2.0",
  "bin": {
    "kastell": "bin/kastell",
    "kastell-mcp": "bin/kastell-mcp"
  },
  "homepage": "https://kastell.dev",
  "keywords": [
    "kastell",
    "coolify",
    "deployment",
    "hetzner",
    "digitalocean",
    "vultr",
    "linode",
    "cli",
    "vps",
    "cloud",
    "automation",
    "self-hosted",
    "server-security",
    "server-maintenance",
    "infrastructure",
    "devops",
    "server"
  ]
}
```

## Detailed File-by-File Change Audit

### Source Files (42 files, 124 occurrences)

**High-risk files (complex changes):**

| File | Count | Change Type | Notes |
|------|-------|-------------|-------|
| `src/mcp/server.ts` | 7 | Tool descriptions | Long strings, "Quicklify-managed", "QUICKLIFY_SAFE_MODE" |
| `src/core/deploy.ts` | 19 | CLI command refs in messages | `quicklify status`, `quicklify firewall`, etc. |
| `src/mcp/tools/serverInfo.ts` | 9 | CLI command suggestions | `quicklify init`, `quicklify status` etc. |
| `src/utils/cloudInit.ts` | 8 | Remote server log paths + banners | `quicklify-install.log`, "Quicklify Auto-Installer" |
| `src/commands/doctor.ts` | 6 | Function name + output | `checkQuicklifyVersion` -> `checkKastellVersion`, "Quicklify Doctor" |
| `src/mcp/tools/serverBackup.ts` | 4 | SAFE_MODE refs | "QUICKLIFY_SAFE_MODE=false" |
| `src/mcp/tools/serverManage.ts` | 4 | SAFE_MODE + command refs | Mixed context |

**Medium-risk files (type/path changes):**

| File | Count | Change Type | Notes |
|------|-------|-------------|-------|
| `src/types/index.ts` | 3 | Type names | `QuicklifyYamlConfig`, `QuicklifyConfig`, `QuicklifyResult` |
| `src/utils/updateCheck.ts` | 4 | npm URL + install msg + config path | Registry URL change critical |
| `src/utils/defaults.ts` | 4 | Type import + config path | `QuicklifyConfig` import + CONFIG_DIR |
| `src/utils/config.ts` | 1 | Config path | CONFIG_DIR definition |
| `src/core/manage.ts` | 1 | Env var name | `QUICKLIFY_SAFE_MODE` -> dual check |
| `src/index.ts` | 4 | Program name + help text | `.name("quicklify")`, config path |
| `src/providers/linode.ts` | 1 | Snapshot filter | Needs dual-prefix backward compat |

**Low-risk files (simple string replacement):**

Remaining 28 files with 1-3 occurrences each -- mostly CLI command references in user-facing messages (e.g., "Deploy one with: quicklify init"). These are straightforward `quicklify` -> `kastell` replacements.

### Test Files (32 files, 140 occurrences)

Test changes mirror source changes. Key categories:
- **Mock values:** `getSshKeyName: jest.fn().mockReturnValue("quicklify-test")` -> `"kastell-test"`
- **Path assertions:** `expect(CONFIG_DIR).toContain(".quicklify")` -> `.kastell`
- **Env var references:** `process.env.QUICKLIFY_SAFE_MODE` -> `KASTELL_SAFE_MODE` (but tests should also verify backward compat)
- **Output assertions:** `expect(output).toContain("quicklify init")` -> `"kastell init"`
- **Snapshot names in test data:** `"quicklify-test"` -> `"kastell-test"`
- **Type imports:** `QuicklifyYamlConfig` -> `KastellYamlConfig`

### Non-Source Files

| File | Action | Notes |
|------|--------|-------|
| `package.json` | Full update | name, version, bin, description, keywords, homepage, license |
| `bin/quicklify` | Rename to `bin/kastell` | Content unchanged (imports dist/index.js) |
| `bin/quicklify-mcp` | Rename to `bin/kastell-mcp` | Update error message from "quicklify-mcp" to "kastell-mcp" |
| `LICENSE` | Replace entirely | MIT -> Apache 2.0 full text |
| `NOTICE` | Create new | Apache 2.0 attribution notice |
| `README.md` | Full rebrand | Title, badges, URLs, examples, all "quicklify" refs |
| `README.tr.md` | Full rebrand | Same as README.md (Turkish) |
| `CHANGELOG.md` | Add v1.3 entry only | Historical entries preserved |
| `SECURITY.md` | Update "Quicklify" refs | Title, description |
| `CONTRIBUTING.md` | Update "Quicklify" refs | Title, clone URL, description |
| `llms.txt` | Full rebrand | Title, descriptions, examples |
| `quicklify.yml` | Rename to `kastell.yml` | Update comments inside |
| `.mcp.json` | Update server name + bin path | `quicklify` -> `kastell` key, bin path |
| `CLAUDE.md` | Update project name refs | Already partially updated but has some quicklify refs |
| `.claude/skills/*.md` | Update command references | Various skill files |
| `jest.config.cjs` | No change needed | No quicklify references |
| `tsconfig.json` | No change needed | No quicklify references |
| `.github/workflows/ci.yml` | No change needed | No quicklify references |
| `.github/workflows/publish.yml` | No change needed | No quicklify references (publishes whatever `package.json` says) |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `fs.copyFileSync` + manual recursion | `fs.cpSync(src, dest, { recursive: true })` | Node 16.7+ | Built-in recursive directory copy |
| `npm deprecate` requires auth | `npm deprecate` uses `NODE_AUTH_TOKEN` or `npm login` | npm 7+ | CI/CD can automate deprecation |
| MIT license | Apache 2.0 + NOTICE | User decision | Patent protection, NOTICE file required |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.2.0 with ts-jest 29.4.6 |
| Config file | `jest.config.cjs` |
| Quick run command | `npm test` |
| Full suite command | `npm run test:coverage` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BRAND-01 | CLI binary name is `kastell` | unit | `npx jest tests/unit/doctor.test.ts -x` (checks version name) | Needs update |
| BRAND-02 | Config path migration | unit | `npx jest tests/unit/config.test.ts -x` | Needs update + new migration tests |
| BRAND-03 | No quicklify in src/ | smoke | `grep -ri "quicklify" src/ \| grep -v CHANGELOG` | Manual / CI script |
| BRAND-04 | No quicklify in tests/ | smoke | `grep -ri "quicklify" tests/` | Manual / CI script |
| BRAND-05 | License is Apache 2.0 | manual-only | Visual inspection of LICENSE + NOTICE | N/A |
| BRAND-06 | Docs updated | manual-only | Visual inspection | N/A |
| BRAND-07 | CI workflows work | integration | `gh run list` after push | Existing CI |
| BRAND-08 | MCP server name | unit | `npx jest tests/unit/mcp-server-info.test.ts -x` | Needs update |
| BRAND-09 | Env var backward compat | unit | `npx jest tests/unit/mcp-server-manage.test.ts tests/unit/restore-safemode.test.ts -x` | Needs update + new backward compat tests |
| BRAND-10 | npm package published | manual-only | `npm info kastell version` after publish | N/A |

### Sampling Rate
- **Per task commit:** `npm test` (full suite, ~2099 tests)
- **Per wave merge:** `npm run build && npm test && npm run lint`
- **Phase gate:** Full suite green + `grep -ri "quicklify" src/` returns 0 hits

### Wave 0 Gaps
- [ ] `tests/unit/migration.test.ts` -- covers BRAND-02 config migration logic
- [ ] Update existing env var tests to cover dual `KASTELL_SAFE_MODE` / `QUICKLIFY_SAFE_MODE` -- covers BRAND-09
- [ ] Grep verification script (or test) for BRAND-03 and BRAND-04 zero-hit validation

## Open Questions

1. **`fs.cpSync` on Node 20 stability**
   - What we know: `cpSync` has been stable since Node 16.7, well within the project's Node 20+ requirement
   - What's unclear: Edge cases with symlinks inside `~/.quicklify` (SSH key symlinks?)
   - Recommendation: Use `cpSync` with `{ recursive: true }` -- it handles symlinks by default. Add a try-catch with informative error message.

2. **Snapshot backward compatibility timeline**
   - What we know: Linode filters snapshots by `quicklify-` prefix. After rename, new snapshots use `kastell-` prefix.
   - What's unclear: How long to keep the dual-prefix filter in Linode provider.
   - Recommendation: Keep dual-prefix filter indefinitely (no cost, no complexity). Document in code comment.

3. **`quicklify-export.json` default filename**
   - What we know: `transfer.ts` defaults to `quicklify-export.json` when no path is provided.
   - What's unclear: Should the import command also accept old format files?
   - Recommendation: Change default to `kastell-export.json`. Import accepts any JSON file path (already does), so no backward compat issue.

## Sources

### Primary (HIGH confidence)
- **Codebase audit:** Direct grep of all 42 src files and 32 test files -- complete enumeration of all "quicklify" references
- **package.json:** Current package configuration verified
- **Node.js fs.cpSync:** Built-in since Node 16.7, stable for recursive directory copy
- [Apache License 2.0 text](https://www.apache.org/licenses/LICENSE-2.0.txt) -- official license text
- [Apache NOTICE file guide](https://infra.apache.org/licensing-howto.html) -- format and requirements

### Secondary (MEDIUM confidence)
- npm deprecate command behavior -- standard npm CLI feature, well-documented

### Tertiary (LOW confidence)
- None -- all findings verified against codebase and official sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries needed, all changes use existing dependencies (chalk, fs)
- Architecture: HIGH -- migration pattern is well-understood, all files enumerated
- Pitfalls: HIGH -- complete codebase audit identifies all edge cases (Linode prefix, cloud-init paths, etc.)

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable -- no external dependencies changing)
