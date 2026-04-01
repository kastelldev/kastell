import chalk from "chalk";

let _safeModeWarningShown = false;

const TRUTHY = new Set(["true", "1", "yes", "on"]);
const FALSY = new Set(["false", "0", "no", "off"]);

function parseBoolEnv(value: string, varName: string): boolean {
  const lower = value.toLowerCase();
  if (TRUTHY.has(lower)) return true;
  if (FALSY.has(lower)) return false;
  process.stderr.write(
    `Warning: ${varName}="${value}" is not a recognized boolean. Use "true" or "false". Defaulting to safe mode.\n`,
  );
  return true;
}

export function isSafeMode(): boolean {
  // KASTELL_SAFE_MODE takes precedence — no deprecation warning
  const kastell = process.env.KASTELL_SAFE_MODE;
  if (kastell !== undefined) {
    return parseBoolEnv(kastell, "KASTELL_SAFE_MODE");
  }

  // Backward compat: QUICKLIFY_SAFE_MODE with one-time deprecation warning
  const quicklify = process.env.QUICKLIFY_SAFE_MODE;
  if (quicklify !== undefined) {
    if (!_safeModeWarningShown) {
      _safeModeWarningShown = true;
      process.stderr.write(
        chalk.yellow(
          "QUICKLIFY_SAFE_MODE is deprecated. Use KASTELL_SAFE_MODE instead.\n",
        ),
      );
    }
    return parseBoolEnv(quicklify, "QUICKLIFY_SAFE_MODE");
  }

  // Default: safe mode OFF for CLI (interactive confirmations protect CLI users).
  // MCP server sets KASTELL_SAFE_MODE=true explicitly in mcp/index.ts.
  return false;
}
