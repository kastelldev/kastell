# Phase 68: Agents - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Create two Claude Code agents for the Kastell ecosystem: `kastell-auditor` (persistent-memory parallel audit analyzer in `kastell-plugin/agents/`) and `kastell-fixer` (isolated security fix agent in `.claude/agents/` with worktree isolation). No new CLI features, MCP tools, or modifications to existing code.

</domain>

<decisions>
## Implementation Decisions

### kastell-auditor — Parallel Audit Analyzer
- Lives in `kastell-plugin/agents/kastell-auditor.md`
- Frontmatter: `memory: user`, `skills: [kastell-ops]`
- 27 audit categories split into 5 parallel analysis buckets:
  1. Network + Firewall + DNS Security
  2. SSH + Auth + Crypto + Accounts
  3. Docker + Services + Boot + Scheduling
  4. Filesystem + Logging + Kernel + Memory
  5. Remaining (File Integrity, Malware, MAC, Secrets, Cloud Metadata, Supply Chain, Backup Hygiene, Resource Limits, Incident Readiness, Banners, Time)
- Parallelism via prompt instruction (bucket definitions in agent prompt) — agent analyzes sequentially or spawns internally, no sub-agent tooling required
- Output format: categorized summary per bucket (score + top 3 critical findings + quick-win recommendation), overall score at the end
- Memory tracks: previous audit scores per server + prior findings — enables regression/improvement reporting ("Last time 72, now 68 — 3 new failures")
- MCP tools allowed: `server_audit`, `server_doctor`, `server_fleet` (read-only, safe)
- Invocation: manual only via `/agent:kastell-auditor` — no auto-trigger

### kastell-fixer — Isolated Security Fix Agent
- Lives in `.claude/agents/kastell-fixer.md` (project scope, NOT plugin agents/)
- Reason: plugin agents silently ignore `isolation` frontmatter — worktree isolation requires project-scope agent
- Frontmatter: `isolation: worktree`, `skills: [kastell-ops]`
- Fix scope: audit quick-wins only (sysctl tuning, UFW rules, SSH config, fail2ban settings) — not full hardening or lock-level changes
- Workflow: analyze audit findings → apply fix in worktree → show diff + ask user confirmation → commit if approved
- MCP tools allowed: `server_audit`, `server_lock`, `server_secure` (read + targeted fix capability)

### Agent Prompt Design
- Prompt depth: compact ~50-100 lines each — role, workflow steps, rules. Domain knowledge inherited via `skills: [kastell-ops]`
- Language: English prompts (marketplace compatibility). Output language follows user's session language setting
- No `disable-model-invocation` on either agent — both are manually invoked

### Claude's Discretion
- Exact wording and section ordering within each agent .md file
- How to phrase the auditor's bucket analysis instructions for optimal parallel processing
- Fixer's diff presentation format and confirmation prompt wording
- Whether auditor should include a "trend" section when memory has prior data

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Plugin Agent Structure
- `kastell-plugin/.claude-plugin/plugin.json` — Plugin manifest, agent component declaration
- `kastell-plugin/skills/kastell-ops/SKILL.md` — Domain knowledge skill both agents inherit via `skills: [kastell-ops]`

### Agent System Constraints
- `.planning/research/PITFALLS.md` — Plugin agent restrictions (isolation/hooks/mcpServers silently ignored)
- `.planning/research/STACK.md` — Agent frontmatter fields, memory types, isolation modes
- `.planning/research/SUMMARY.md` — Architecture approach, kastell-fixer must be in .claude/agents/

### Audit Domain Knowledge
- `src/core/audit/` — Audit check implementations, 27 categories, 413 checks
- `src/core/audit/catalog.ts` — Static audit catalog with category definitions

### Prior Phase Decisions
- `.planning/phases/66-kastell-ops-skill/66-CONTEXT.md` — Skill format, progressive disclosure, frontmatter choices
- `.planning/phases/67-remaining-skills/67-CONTEXT.md` — Skill design patterns, plugin component placement

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `kastell-plugin/agents/.gitkeep` — Directory exists, ready for kastell-auditor.md
- `kastell-plugin/skills/kastell-ops/SKILL.md` — Reference for `skills: [kastell-ops]` inheritance pattern
- `src/core/audit/catalog.ts` — Category list for auditor bucket definitions

### Established Patterns
- Plugin skills use YAML frontmatter + Markdown body
- Agent .md files follow same format: YAML frontmatter + system prompt body
- `memory: user` enables cross-session state persistence
- `isolation: worktree` creates disposable git branch per invocation

### Integration Points
- Auditor agent: `kastell-plugin/agents/kastell-auditor.md` — auto-discovered by Claude Code plugin system
- Fixer agent: `.claude/agents/kastell-fixer.md` — auto-discovered by Claude Code project scope
- Both agents reference `kastell-ops` skill for domain knowledge
- `plugin.json` may need update to declare auditor agent component

</code_context>

<specifics>
## Specific Ideas

- Auditor's 5-bucket grouping follows security domain logic: network perimeter, authentication, runtime services, system internals, and compliance/hygiene
- Fixer is intentionally limited to quick-wins — full hardening belongs to `kastell lock` command, not an autonomous agent
- Memory-based trend tracking gives auditor unique value — no competitor MCP plugin does cross-session audit regression analysis

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 68-agents*
*Context gathered: 2026-03-19*
