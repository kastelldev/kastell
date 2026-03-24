#!/usr/bin/env bash
# scaffold.sh — Generate Kastell component boilerplate from templates.
# Usage: scaffold.sh <type> <name> [--dry-run]
#   type: command | check | provider | mcp-tool
#   name: kebab-case component name (e.g., server-migrate, filesystem-perms)
#
# Ersin criterion: This script runs without an LLM. Deterministic file generation.

set -euo pipefail

# ── Resolve script directory (works in symlink/Git Bash/etc) ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/../templates"
PROJECT_ROOT="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }

# ── Args ──
TYPE="${1:-}"
NAME="${2:-}"
DRY_RUN=false
for arg in "$@"; do [[ "$arg" == "--dry-run" ]] && DRY_RUN=true; done

if [[ -z "$TYPE" || -z "$NAME" ]]; then
  echo "Usage: scaffold.sh <type> <name> [--dry-run]"
  echo "  type: command | check | provider | mcp-tool"
  echo "  name: kebab-case (e.g., server-migrate)"
  exit 1
fi

# Validate type
case "$TYPE" in
  command|check|provider|mcp-tool) ;;
  *) err "Unknown type: $TYPE (valid: command, check, provider, mcp-tool)"; exit 1 ;;
esac

# Validate name (kebab-case or snake_case, lowercase)
if [[ ! "$NAME" =~ ^[a-z][a-z0-9_-]*$ ]]; then
  err "Invalid name: $NAME (must be lowercase kebab-case or snake_case)"
  exit 1
fi

# ── Name transformations ──
to_pascal() {
  echo "$1" | sed 's/[-_]/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1' | tr -d ' '
}

to_camel() {
  local pascal
  pascal=$(to_pascal "$1")
  echo "$(echo "${pascal:0:1}" | tr 'A-Z' 'a-z')${pascal:1}"
}

to_upper() {
  echo "$1" | tr '[:lower:]' '[:upper:]' | tr '-' '_'
}

NAME_PASCAL=$(to_pascal "$NAME")
NAME_CAMEL=$(to_camel "$NAME")
NAME_UPPER=$(to_upper "$NAME")

info "Scaffolding $TYPE: $NAME"
info "  PascalCase: $NAME_PASCAL"
info "  camelCase:  $NAME_CAMEL"
info "  UPPER:      $NAME_UPPER"
echo ""

# ── Template processing ──
process_template() {
  local tpl_file="$1"
  local output_file="$2"

  if [[ ! -f "$tpl_file" ]]; then
    err "Template not found: $tpl_file"
    return 1
  fi

  if [[ -f "$output_file" ]] && [[ "$DRY_RUN" == false ]]; then
    err "File already exists: $output_file (won't overwrite)"
    return 1
  fi

  local content
  content=$(sed \
    -e "s/__NAME__/$NAME/g" \
    -e "s/__NAME_PASCAL__/$NAME_PASCAL/g" \
    -e "s/__NAME_CAMEL__/$NAME_CAMEL/g" \
    -e "s/__NAME_UPPER__/$NAME_UPPER/g" \
    "$tpl_file")

  if [[ "$DRY_RUN" == true ]]; then
    warn "[dry-run] Would create: $output_file"
    echo "$content"
    echo "---"
  else
    mkdir -p "$(dirname "$output_file")"
    echo "$content" > "$output_file"
    ok "Created: $output_file"
  fi
}

# ── File mapping per type ──
CREATED=0

case "$TYPE" in
  command)
    process_template "$TEMPLATE_DIR/command.ts.tpl"      "$PROJECT_ROOT/src/commands/$NAME.ts"         && ((CREATED++)) || true
    process_template "$TEMPLATE_DIR/command-core.ts.tpl"  "$PROJECT_ROOT/src/core/$NAME.ts"             && ((CREATED++)) || true
    process_template "$TEMPLATE_DIR/command-test.ts.tpl"  "$PROJECT_ROOT/src/__tests__/core/$NAME.test.ts" && ((CREATED++)) || true

    echo ""
    warn "Next steps:"
    echo "  1. Register command in src/index.ts"
    echo "  2. Implement core logic in src/core/$NAME.ts"
    echo "  3. Add isSafeMode() check if destructive"
    echo "  4. Run: npm run build && npm test && npm run lint"
    echo "  5. Update README.md command table"
    ;;

  check)
    process_template "$TEMPLATE_DIR/check.ts.tpl"         "$PROJECT_ROOT/src/core/audit/checks/$NAME.ts"         && ((CREATED++)) || true
    process_template "$TEMPLATE_DIR/check-test.ts.tpl"    "$PROJECT_ROOT/src/__tests__/core/audit/checks/$NAME.test.ts" && ((CREATED++)) || true

    echo ""
    warn "Next steps:"
    echo "  1. Add SSH section in src/core/audit/commands.ts:"
    echo "     NAMED_SEP(\"${NAME_UPPER}\") + bash commands"
    echo "  2. Register in src/core/audit/checks/index.ts:"
    echo "     { name: \"$NAME_PASCAL\", sectionName: \"$NAME_UPPER\", parser: parse${NAME_PASCAL}Checks }"
    echo "  3. Add compliance mapping in src/core/audit/compliance/mapper.ts (optional)"
    echo "  4. Run: npm run build && npm test && npm run lint"
    echo "  5. Test: kastell audit --list-checks | grep $NAME_UPPER"
    ;;

  provider)
    process_template "$TEMPLATE_DIR/provider.ts.tpl"      "$PROJECT_ROOT/src/providers/$NAME.ts"         && ((CREATED++)) || true
    process_template "$TEMPLATE_DIR/provider-test.ts.tpl"  "$PROJECT_ROOT/src/__tests__/providers/$NAME.test.ts" && ((CREATED++)) || true

    echo ""
    warn "Next steps:"
    echo "  1. Add to PROVIDER_REGISTRY in src/constants.ts:"
    echo "     $NAME: { name: \"$NAME_PASCAL\", envKey: \"${NAME_UPPER}_TOKEN\", class: ${NAME_PASCAL}Provider }"
    echo "  2. Implement API methods (adjust base URL)"
    echo "  3. Add stripSensitiveData() token cleanup"
    echo "  4. Run: npm run build && npm test && npm run lint"
    echo "  5. Add 'Getting Your API Token' to README.md"
    ;;

  mcp-tool)
    process_template "$TEMPLATE_DIR/mcp-tool.ts.tpl"      "$PROJECT_ROOT/src/mcp/tools/$NAME.ts"         && ((CREATED++)) || true
    process_template "$TEMPLATE_DIR/mcp-tool-test.ts.tpl"  "$PROJECT_ROOT/src/__tests__/mcp/$NAME.test.ts" && ((CREATED++)) || true

    echo ""
    warn "Next steps:"
    echo "  1. Register in src/mcp/server.ts:"
    echo "     registerTool('$NAME', { schema: ${NAME_CAMEL}Schema, handler: handle${NAME_PASCAL} })"
    echo "  2. Define Zod schema (flat object, NOT z.object() wrapper)"
    echo "  3. Handler delegates to core/ (NOT direct SSH/provider)"
    echo "  4. Add SAFE_MODE check if destructive"
    echo "  5. Run: npm run build && npm test && npm run lint"
    echo "  6. Update README.md MCP tools table"
    ;;
esac

echo ""
if [[ "$DRY_RUN" == true ]]; then
  info "[dry-run] No files were created."
else
  ok "Scaffolded $CREATED file(s) for $TYPE: $NAME"
fi
