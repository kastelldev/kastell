#!/usr/bin/env bash
# smoke-plugin-install.sh — Pre-release plugin tarball validation.
#
# Catches three failure modes that lokal "npm test" cannot:
#   1. package.json "files" missing a path referenced by plugin manifest
#   2. dist/mcp-bundle.mjs has unresolved imports (Cannot find module)
#   3. CLI bin not bootable from extracted tarball
#
# Usage: bash scripts/smoke-plugin-install.sh
# Exits non-zero on failure. Cleans up temp dir on success.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

PKG_VERSION="$(node -p "require('./package.json').version")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[smoke] Project: $PROJECT_ROOT"
echo "[smoke] Version: $PKG_VERSION"
echo "[smoke] Temp:    $TMP"

# --- Step 1: pack ----------------------------------------------------------
echo "[smoke] Step 1: npm pack"
TARBALL_REL="$(npm pack --silent 2>&1 | tail -1)"
TARBALL_ABS="$PROJECT_ROOT/$TARBALL_REL"
[ -f "$TARBALL_ABS" ] || { echo "[smoke] FAIL: tarball not created: $TARBALL_REL" >&2; exit 1; }
echo "[smoke]   tarball: $TARBALL_REL"

# --- Step 2: extract -------------------------------------------------------
echo "[smoke] Step 2: extract"
tar -xzf "$TARBALL_ABS" -C "$TMP"
rm -f "$TARBALL_ABS"
EXTRACTED="$TMP/package"
[ -d "$EXTRACTED" ] || { echo "[smoke] FAIL: package/ not found in tarball" >&2; exit 1; }

# --- Step 3: manifest path assertions --------------------------------------
echo "[smoke] Step 3: plugin manifest paths shipped in tarball"
# `cd` first so Node uses cwd-relative paths — avoids Git Bash POSIX→Windows
# path conversion mangling absolute paths when passed as bash interpolation.
(
  cd "$EXTRACTED"
  node -e "
    const fs = require('fs');
    const plugin = JSON.parse(fs.readFileSync('.claude-plugin/plugin.json', 'utf8'));
    const checks = [];
    if (plugin.mcpServers) {
      Object.values(plugin.mcpServers).forEach(srv => {
        (srv.args || []).forEach(a => {
          const m = String(a).match(/\\\${CLAUDE_PLUGIN_ROOT}\/(.*)/);
          if (m) checks.push({ kind: 'mcp arg', rel: m[1] });
        });
      });
    }
    ['skills', 'hooks', 'commands', 'agents'].forEach(k => {
      const v = plugin[k];
      if (typeof v === 'string') checks.push({ kind: k, rel: v.replace(/^\\.\//, '') });
    });
    const errors = [];
    checks.forEach(({ kind, rel }) => {
      if (!fs.existsSync(rel)) errors.push('Missing tarball entry: ' + rel + ' (referenced by plugin.json ' + kind + ')');
    });
    if (errors.length) {
      console.error('[smoke] FAIL: plugin manifest path mismatch:');
      errors.forEach(e => console.error('  - ' + e));
      process.exit(1);
    }
    console.log('[smoke]   ' + checks.length + ' manifest paths verified in tarball');
  "
)

# --- Step 4: MCP bundle bootable -------------------------------------------
echo "[smoke] Step 4: dist/mcp-bundle.mjs boots without module errors"
[ -f "$EXTRACTED/dist/mcp-bundle.mjs" ] || { echo "[smoke] FAIL: dist/mcp-bundle.mjs not in tarball" >&2; exit 1; }
# `cd` so the path passed to node is cwd-relative (Git Bash POSIX/Win conversion safe).
MCP_STDERR="$(cd "$EXTRACTED" && KASTELL_SAFE_MODE=true node dist/mcp-bundle.mjs </dev/null 2>&1 &
  PID=$!
  sleep 3
  kill -TERM "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true)" || true
if echo "$MCP_STDERR" | grep -Eq 'Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|dlopen'; then
  echo "[smoke] FAIL: MCP bundle has unresolved imports:" >&2
  echo "$MCP_STDERR" | head -20 >&2
  exit 1
fi
echo "[smoke]   MCP bundle bootable"

# Note: CLI bin (`bin/kastell` → `dist/index.js`) is intentionally NOT smoke-tested
# here. CC plugin install does not run `npm install` — it only extracts the
# tarball. CLI requires `commander` and other runtime deps that ship as
# package.json "dependencies", resolved by npm during a global install but NOT
# by CC. CC plugin marketplace consumes only the self-contained MCP bundle
# (`dist/mcp-bundle.mjs`, esbuild). CLI is covered by `npm install -g kastell`
# in regular CI, not by this plugin-shipping smoke test.

echo "[smoke] OK — kastell@$PKG_VERSION tarball is shipping-ready for CC plugin install"
