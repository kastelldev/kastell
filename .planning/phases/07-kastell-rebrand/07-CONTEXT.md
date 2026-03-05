# Phase 7: Kastell Rebrand - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Full rebrand from quicklify to kastell across CLI, packages, config paths, environment variables, documentation, CI workflows, and MCP server. License switch from MIT to Apache 2.0. npm publish under new name with old package deprecated. GitHub repo transfer is OUT OF SCOPE (deferred to post-v1.3).

</domain>

<decisions>
## Implementation Decisions

### Config Migration Strategy
- First run: if `~/.quicklify` exists and `~/.kastell` does not, copy entire `~/.quicklify/` contents to `~/.kastell/` (including backups/, ssh keys, everything)
- After migration: create `~/.kastell/.migrated` flag file to prevent re-migration on subsequent runs
- Show chalk warn message: "Migrated config from ~/.quicklify to ~/.kastell. You can safely remove ~/.quicklify."
- Old `~/.quicklify` is NOT deleted — user removes it manually if desired
- If `~/.kastell` already exists, skip migration entirely (no overwrite risk)

### Environment Variable Backward Compat
- `QUICKLIFY_SAFE_MODE` renamed to `KASTELL_SAFE_MODE` as primary
- `QUICKLIFY_SAFE_MODE` continues working with deprecation warning until v2.0
- Warning shown only when `QUICKLIFY_SAFE_MODE` is set AND `KASTELL_SAFE_MODE` is NOT set
- If both are set, `KASTELL_SAFE_MODE` takes precedence (no warning)
- Provider tokens (HETZNER_TOKEN, DIGITALOCEAN_TOKEN, etc.) stay unchanged — no quicklify prefix, no rename needed

### String Replacement Scope
- ALL 124 "quicklify" references in 42 src/ files renamed to "kastell"
- Internal types: `QuicklifyConfig` -> `KastellConfig` (full internal rename)
- bin/ scripts: `bin/quicklify` -> `bin/kastell`, `bin/quicklify-mcp` -> `bin/kastell-mcp`
- Test files (`__tests__/`): all "quicklify" references updated to "kastell", scanned separately from src/
- CHANGELOG.md: historical "quicklify" entries preserved as-is, only v1.3 entry mentions the rename
- Success criteria: `grep -ri "quicklify" src/` = 0 hits (excluding CHANGELOG historical entries), `grep -ri "quicklify" src/__tests__/` = 0 hits

### npm Publish & Deprecation
- Deprecation message: "Moved to kastell -- https://www.npmjs.com/package/kastell"
- package.json description: "Autonomous security and maintenance layer for self-hosted infrastructure"
- Keywords updated: add kastell, server-security, server-maintenance, infrastructure; remove paas; keep coolify
- homepage: `https://kastell.dev`
- repository: `https://github.com/omrfc/quicklify.git` (stays until repo transfer post-v1.3)
- Version: 1.3.0 published as `kastell`, `quicklify` deprecated via `npm deprecate`

### Claude's Discretion
- Exact migration function placement (utils/config.ts or separate utils/migration.ts)
- Order of file-by-file string replacements (bulk vs incremental approach)
- NOTICE file content format for Apache 2.0
- CI workflow update details (artifact names, job names)
- Exact deprecation warning message wording for env vars

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/config.ts`: CONFIG_DIR constant (`~/.quicklify`) — central config path, migration logic connects here
- `src/utils/defaults.ts`: Separate CONFIG_DIR + DEFAULTS_FILE — also needs path update
- `src/core/manage.ts`: `isSafeMode()` reads `QUICKLIFY_SAFE_MODE` — env var rename point
- `src/types/index.ts`: `QuicklifyConfig` type definition — type rename point
- `chalk` already imported across codebase — migration warning can use existing chalk dependency

### Established Patterns
- Config path defined as const at top of file (`const CONFIG_DIR = join(homedir(), ".quicklify")`)
- Both `config.ts` and `defaults.ts` define their own CONFIG_DIR — needs coordinated update
- Env var read via `process.env.QUICKLIFY_SAFE_MODE` — single check point in manage.ts, multiple MCP tool references in error messages
- bin/ scripts are thin shell wrappers calling dist/index.js

### Integration Points
- `package.json`: name, bin entries, description, keywords, homepage, license
- `bin/quicklify` + `bin/quicklify-mcp`: entry point scripts
- `.github/workflows/`: CI pipeline references
- `src/mcp/server.ts`: MCP server name registration (7 references)
- `.mcp.json` + `~/.claude/settings.json`: MCP server configuration (dev environment)
- `CLAUDE.md`: project instructions referencing quicklify

</code_context>

<specifics>
## Specific Ideas

- STATE.md'de concern belirtilmis: "String replacement false positives risk — need file-by-file audit before bulk replace"
- CHANGELOG tarihsel kayitlari korunacak — sadece v1.3 entry'si rename'i belgeleyecek
- Migration tek seferlik: `.migrated` flag ile tekrarlanmaz
- Env var deprecation v2.0'a kadar — kullanicilara gec suresi

</specifics>

<deferred>
## Deferred Ideas

- GitHub repo transfer (omrfc/quicklify -> kastelldev/kastell) — post-v1.3
- kastell.dev website icerigi — v1.5
- Provider token env var namespace'leme (KASTELL_HETZNER_TOKEN) — rejected, unnecessary complexity

</deferred>

---

*Phase: 07-kastell-rebrand*
*Context gathered: 2026-03-05*
