---
name: kastell-scaffold
description: Generate new Kastell components from templates. Creates boilerplate for CLI commands, audit checks, providers, and MCP tools following current architecture (commands thin, core fat, adapters dispatch).
context: fork
disable-model-invocation: true
effort: medium
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
argument-hint: "[check|command|provider|mcp-tool] [name]"
---

# Kastell Scaffold

## Purpose

Generate boilerplate files for new Kastell components. Each template follows the post-P63/P64 architecture: commands are thin wrappers, business logic lives in core/, providers handle cloud API, adapters abstract platform ops.

## Usage

```
/kastell:scaffold command server-migrate     # creates command + core + test files
/kastell:scaffold check filesystem-perms     # creates audit check + catalog update
/kastell:scaffold provider ovhcloud          # creates provider + registry entry + test
/kastell:scaffold mcp-tool server_migrate    # creates MCP tool + registration + test
```

`$ARGUMENTS[0]` is the component type. `$ARGUMENTS[1]` is the component name.

## Architecture Rules

These rules apply in every generated file. The forked subagent does not automatically have kastell-ops context — enforce these rules explicitly.

| Layer    | Path              | Rule                                                         |
|----------|-------------------|--------------------------------------------------------------|
| Commands | src/commands/     | Parse args + delegate. ZERO business logic.                  |
| Core     | src/core/         | ALL business logic. No chalk/ora/UI imports.                 |
| Providers| src/providers/    | Cloud API per provider. Extends BaseProvider.                |
| Adapters | src/adapters/     | Platform ops via PlatformAdapter. Access via getAdapter().   |
| MCP      | src/mcp/tools/    | Zod schema + handler. Delegates to core.                     |

**Critical:** Never import CoolifyAdapter or DokployAdapter directly. Always use `getAdapter(platform)` from `src/adapters/factory.ts`.

**ESM:** `"type": "module"` — use `import`, not `require`. All imports use `.js` extension.

## Existing Components

**Commands:**
!`node -e "import('fs').then(f=>console.log(f.readdirSync('src/commands').filter(x=>x.endsWith('.ts')).map(x=>x.replace('.ts','')).join(', '))).catch(()=>console.log('commands dir not found'))"`
**Providers:**
!`node -e "import('fs').then(f=>console.log(f.readdirSync('src/providers').filter(x=>x.endsWith('.ts')&&x!=='base.ts').map(x=>x.replace('.ts','')).join(', '))).catch(()=>console.log('providers dir not found'))"`
**MCP tools:**
!`node -e "import('fs').then(f=>console.log(f.readdirSync('src/mcp/tools').filter(x=>x.endsWith('.ts')).map(x=>x.replace('.ts','')).join(', '))).catch(()=>console.log('mcp/tools dir not found'))"`
**Audit categories:**
!`node -e "import('fs').then(f=>console.log(f.readdirSync('src/core/audit',{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name).join(', '))).catch(()=>console.log('audit dir not found'))"`

## Script (Deterministic)

Run the scaffold script to generate boilerplate files:

```bash
bash scripts/scaffold.sh $ARGUMENTS[0] $ARGUMENTS[1]
```

The script reads `.tpl` templates from `templates/`, replaces `__NAME__`/`__NAME_PASCAL__`/`__NAME_CAMEL__`/`__NAME_UPPER__` placeholders, and creates files in the project. Add `--dry-run` to preview without writing.

**Files generated per type:**
- `command` → 3 files: `src/commands/`, `src/core/`, `src/__tests__/core/`
- `check` → 2 files: `src/core/audit/checks/`, `src/__tests__/core/audit/checks/`
- `provider` → 2 files: `src/providers/`, `src/__tests__/providers/`
- `mcp-tool` → 2 files: `src/mcp/tools/`, `src/__tests__/mcp/`

## Template Reference (Context for LLM)

After running the script, read the matching reference for registration details:

| Type       | Reference File                                 |
|------------|------------------------------------------------|
| `command`  | references/template-command.md                 |
| `check`    | references/template-audit-check.md             |
| `provider` | references/template-provider.md                |
| `mcp-tool` | references/template-mcp-tool.md                |

## After Generation

Perform these steps after creating the boilerplate files:

- [ ] Write tests first (TDD preferred — test core, not command)
- [ ] Register the component:
  - Commands: add import in `src/index.ts`
  - MCP tools: `registerTool()` in `src/mcp/server.ts`
  - Providers: add to `PROVIDER_REGISTRY` in `src/constants.ts`
  - Audit checks: add entry to `src/core/audit/catalog.ts`
- [ ] Run `npm run build && npm test && npm run lint`
- [ ] Update README.md

## Skill/Agent Oluşturma Kuralları (Yeni skill/agent scaffold ediliyorsa)

Yeni skill veya agent oluşturulurken aşağıdaki koşullar ZORUNLU:
- [ ] **Ersin kriteri:** scripts/ klasörü oluştur — deterministik iş LLM'e bırakılmayacak
- [ ] **Progressive disclosure:** SKILL.md < 500 satır, detaylar references/ klasöründe
- [ ] **Frontmatter:** `effort` + `allowed-tools` ekle (minimum zorunlu)
- [ ] **Yan etki varsa:** `disable-model-invocation: true` ekle
- [ ] **Agent ise:** `maxTurns` belirle, `memory` scope tanımla
- [ ] **Script dili:** Shell (sh/bash) tercih et — Node.js ekosistemiyle uyumlu
- [ ] **Evaluation:** Gerçek task'ta test et, struggle noktalarını gözlemle
