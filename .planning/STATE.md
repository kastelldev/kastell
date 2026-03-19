---
gsd_state_version: 1.0
milestone: v1.13
milestone_name: Foundation + Housekeeping
status: completed
stopped_at: Phase 68 context gathered
last_updated: "2026-03-19T11:15:28.545Z"
last_activity: 2026-03-19 — Roadmap created (8 phases, P72-P79, 25/25 requirements mapped)
progress:
  total_phases: 12
  completed_phases: 6
  total_plans: 9
  completed_plans: 22
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-19)

**Brand:** Kastell (kastell.dev | npm: kastell | GitHub: kastelldev)
**Core value:** Autonomous server security and maintenance across multiple cloud providers
**Current focus:** Phase 67 — remaining-skills

## Current Position

Phase: 67 (remaining-skills) — EXECUTING
Plan: 2 of 2

## Accumulated Context

### Decisions

- [v1.13 scope]: 4 skill + 2 agent + Claude Code plugin paketi + Anthropic marketplace + Backlog Grup 2 (4 hook) + teknik borç (3+9 command) + dokuman + dis kesfedilebilirlik
- [v1.13 Research]: DEBT-01/02 are hard prerequisites — kastell-ops skill must describe correct post-refactor architecture
- [v1.13 Research]: kastell-fixer MUST be in .claude/agents/ NOT kastell-plugin/agents/ — isolation:worktree silently ignored in plugin agents
- [v1.13 Research]: SKILL.md must stay under 500 lines — use references/ subdirectory for progressive disclosure
- [v1.13 Research]: Plugin components belong at kastell-plugin root — .claude-plugin/ holds ONLY plugin.json
- [Phase 63-01]: updateServer() core function takes (server, apiToken, platform) — no UI deps, returns UpdateServerResult
- [Phase 63-01]: restartCoolify() core function handles SSH restart + POLL_DELAY_MS wait + health check — no UI deps, returns RestartCoolifyResult
- [Phase 63-01]: Command tests mock core module instead of low-level deps (providerFactory/sshExec)
- [Phase 63-02]: backupServer() in core/backup.ts consolidates bare/managed dispatch; command and MCP handler both delegate to core
- [Phase 64-01]: platformPorts defined inline in each adapter (not imported from core/firewall.ts) to avoid architectural dependency inversion
- [Phase 64-01]: adapterDisplayName accepts minimal { name: string } shape — avoids circular typing, usable with any adapter-like object
- [Phase 64-02]: Command layer uses adapter properties (port/defaultLogService/platformPorts) instead of platform string conditionals
- [Phase 65-01]: Scoped gitignore /.mcp.json to repo root only so kastell-plugin/.mcp.json can be committed as plugin distribution content
- [Phase 65-01]: hooks.json PreToolUse destroy-block uses Node.js (not bash) for Windows cross-platform compatibility
- [Phase 66]: SKILL.md kept to 113 lines by delegating all detail to reference files (progressive disclosure)
- [Phase 66]: user-invocable: false chosen so skill auto-loads as background context without appearing in slash menu
- [Phase 67-01]: kastell-careful uses type: prompt hook (not command hook) for LLM semantic understanding of destroy/restore
- [Phase 67-01]: kastell-research inlines architecture map in body instead of skills: field (not supported in SKILL.md frontmatter)
- [Phase 67-01]: kastell-research has no disable-model-invocation: true so Claude can auto-delegate exploration queries
- [Phase 67-02]: context: fork + disable-model-invocation: true for kastell-scaffold — manual invocation only, isolated subagent execution
- [Phase 67-02]: Architecture Rules inlined in kastell-scaffold SKILL.md body (forked subagent does not inherit kastell-ops context)

### Pending Todos

None.

### Blockers/Concerns

- Hook inventory must be reverified at Phase 69 execution with `/hooks` — research snapshot may be stale by then
- kastell-fixer worktree isolation behavior should be live-tested before writing agent content (Phase 68)
- Marketplace review timeline unknown — do not block v1.13 milestone close on approval

## v1.14 Test Excellence (Planning)

Phase: Not started (roadmap defined 2026-03-19)
Status: Roadmap complete — awaiting v1.13 completion before execution
Last activity: 2026-03-19 — Roadmap created (8 phases, P72-P79, 25/25 requirements mapped)

### v1.14 Phase Structure

| Phase | Name | Requirements |
|-------|------|--------------|
| 72 | Stryker Setup + Baseline | MUT-01, MUT-02 |
| 73 | Coverage Gap — Formatters + SSH | COV-01, COV-02, COV-04 |
| 74 | Coverage Gap — Bare Mode + Threshold | COV-03, COV-05 |
| 75 | MCP Tool Testing | MCP-01, MCP-02, MCP-03 |
| 76 | Integration Testing | INT-01, INT-02, INT-03, INT-04 |
| 77 | Contract Testing | CTR-01, CTR-02, CTR-03 |
| 78 | Snapshot Testing | SNP-01, SNP-02, SNP-03 |
| 79 | CI Hardening + Mutation Gate | INF-01, INF-02, INF-03, MUT-03, MUT-04, MUT-05, MUT-06 |

### v1.14 Decisions

- Stryker: kademeli gate (önce rapor P72, sonra CI gate P79)
- Integration: mock-based CI (her zaman) + staging sunucu (manual trigger / haftalık)
- Sequencing: baseline measurement first (P72) → coverage gaps (P73-74) → test deepening (P75-77) → snapshot (P78) → CI hardening + gate (P79)
- P79 groups all CI and mutation gate requirements — these only make sense after all tests are written
- Planlama v1.13 ile paralel yapıldı

## Session Continuity

Last session: 2026-03-19T11:15:28.534Z
Stopped at: Phase 68 context gathered
Resume file: .planning/phases/68-agents/68-CONTEXT.md
