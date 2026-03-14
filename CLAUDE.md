# Kastell (formerly Quicklify)

CLI toolkit for provisioning, securing, and managing self-hosted servers.

## Tech Stack

TypeScript (ES2022, strict), Commander.js, Inquirer.js, Axios, Zod, Chalk, Ora, js-yaml, @modelcontextprotocol/sdk, Jest, ESLint 10 + Prettier, CI: GitHub Actions (3 OS x 2 Node = 6 matrix)

## Skill Routing

| Durum | Oku |
|-------|-----|
| Yeni CLI komutu | `.claude/skills/cli-command.md` |
| MCP tool ekleme | `.claude/skills/mcp-tool.md` |
| Yeni provider | `.claude/skills/provider.md` |
| Release / npm publish | `.claude/skills/release.md` (`/release patch\|minor\|major`) |
| Test yazma | `.claude/skills/testing.md` |

## Commands

```bash
npm run build    # tsc && chmod +x dist/index.js
npm test         # jest --config jest.config.cjs
npm run lint     # eslint src/
npm run dev      # tsx src/index.ts
```

## Architecture

```
src/
  commands/    # 23 CLI komut (thin wrappers)
  core/        # Business logic
  providers/   # hetzner, digitalocean, vultr, linode
  adapters/    # coolify, dokploy [v1.3+]
  mcp/         # MCP server + 12 tools
  utils/       # ssh, config, cloudInit, modeGuard, migration
  types/       # ServerMode, ServerRecord
  constants.ts # PROVIDER_REGISTRY
  index.ts     # CLI entry point
```

Commands (thin) -> Core (logic) -> Providers (API) / Adapters (platform)

## Key Conventions

- ESM project (`"type": "module"`) -- `import`, not `require`
- Commands thin, core fat -- business logic `core/` altinda
- `PROVIDER_REGISTRY` in `constants.ts` = single source of truth
- `KASTELL_SAFE_MODE` + `isSafeMode()` = destructive op guard
- `assertValidIp()` before SSH, `sanitizedEnv` for subprocess
- `sanitizeResponseData()` whitelist approach for API errors
- `__tests__/` alongside source, `.test.ts` suffix
- Config dir: `~/.kastell/` (auto-migrated from `~/.quicklify/`)

## Lessons

-> `LESSONS.md` (tek kaynak — tum proje dersleri burada konsolide)
