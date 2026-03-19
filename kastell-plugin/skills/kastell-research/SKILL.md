---
name: kastell-research
description: Read-only Kastell codebase exploration. Use when tracing a bug across files, mapping callsites before refactoring, or exploring unfamiliar subsystems. Runs in isolated context with Explore agent.
context: fork
agent: Explore
allowed-tools: Read, Grep, Glob
---

# Kastell Research

## Purpose

Explore the Kastell codebase using read-only tools (Read, Grep, Glob). Runs in a forked Explore agent with Kastell architecture knowledge inlined.

## When to Use

- **Bug investigation:** Trace a bug from CLI command through core logic to adapters/providers. Start at the command file, follow imports to core, check utils and adapters.
- **Feature mapping:** Map all callsites of a function, trace the import chain, understand how subsystems connect before making changes.
- **Architecture question:** Understand how audit categories work, how the adapter dispatch flows, or how lock hardening steps are structured.

## Live Codebase

**Commands:**
!`node -e "import('fs').then(f=>console.log(f.readdirSync('src/commands').filter(x=>x.endsWith('.ts')).map(x=>x.replace('.ts','')).join(', '))).catch(()=>console.log('commands dir not found'))"`
**Provider registry:**
!`node -e "import('fs').then(f=>{const c=f.readFileSync('src/constants.ts','utf8');const m=c.match(/PROVIDER_REGISTRY[\s\S]{0,200}/);console.log(m?m[0].split('\n').slice(0,4).join('\n'):'not found')}).catch(()=>console.log('constants.ts not found'))"`

## Architecture Map

```
src/
  commands/     # 31 thin CLI wrappers (parse args + delegate only)
  core/         # Business logic (ALL computation here)
    audit/      # 27 audit categories, 413+ checks
    lock/       # 19-step server hardening
  providers/    # Cloud API: hetzner, digitalocean, vultr, linode
  adapters/     # Platform abstraction: coolify, dokploy
    factory.ts  # getAdapter(platform) — entry point
  mcp/
    server.ts   # 13 tool registrations
    tools/      # Handler files
  utils/        # ssh, config, cloudInit, modeGuard
  types/        # ServerMode, ServerRecord, Platform
  constants.ts  # PROVIDER_REGISTRY
```

## Layer Flow

Commands (parse args) --> Core (business logic) --> Providers (cloud API) / Adapters (platform ops). MCP tools also delegate to Core.

## Research Workflows

**Bug investigation:**
1. Find the command file (`src/commands/<name>.ts`)
2. Follow the core import (`src/core/<name>.ts`)
3. Check adapter/provider calls
4. Check utils (ssh, config)

**Feature mapping:**
1. Grep for the function name
2. Follow import chain
3. Map all callsites
4. Check test coverage in `__tests__/`

**Architecture question:**
1. Read the Architecture Map above
2. Read `kastell-plugin/skills/kastell-ops/SKILL.md` for full detail (adapter contract, provider registry, layer rules)
3. Trace specific files

## ARGUMENTS

$ARGUMENTS
