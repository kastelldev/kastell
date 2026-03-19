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

## Paralel Session Kuralı

Birden fazla Claude Code session'ı aynı anda çalıştırılabilir.
Tercih edilen yöntem: git worktree (izole çalışma dizini).

```bash
git worktree add ../kastell-<konu> feature/<konu>
# Bitince:
git checkout main && git merge feature/<konu>
git worktree remove ../kastell-<konu>
git branch -d feature/<konu>
```

Basit, kısa işlerde branch da yeterli:
`git checkout -b session/<konu>`

Kurallar:
- Aynı dosyaya iki session aynı anda dokunmamalı
- Session/feature branch'leri ASLA push edilmez
- İş bitince main'e merge et, branch'i sil, sadece main push edilir

## Session Sonu Protokolü

Kullanıcı session'ı kapatacağını belirttiğinde (`gidiyorum`, `kapatıyorum`, `bu kadar`, vb.) aşağıdaki review'ı yap:

1. **Yapılanlar** — O session'da tamamlanan işlerin 2-3 satırlık özeti
2. **Gözlem** — Tekrar eden pattern, süreç kalitesi, iyi/kötü giden şeyler
3. **Sonraki session önerisi** — Kaldığı yerden devam için somut ilk adım
4. **Hata/uyarı** — Session'da yapılan hata, tutarsızlık veya risk (varsa dürüstçe söyle, yoksa atlayabilirsin)
5. **Hafıza** — Session'dan kalıcı bilgi varsa hafızaya yaz (MEMORY.md veya lessons)
6. **CLAUDE.md review** — Session'da tekrar eden bir düzeltme, yeni kural veya güncelliğini yitirmiş bilgi varsa CLAUDE.md güncellemesi öner

## Lessons

-> `LESSONS.md` (tek kaynak — tum proje dersleri burada konsolide)
