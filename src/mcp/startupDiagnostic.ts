import { getPackageMetadata } from "../utils/version.js";

export function formatMcpStartupDiagnostic(
  safeMode: string,
  metadata = getPackageMetadata(),
): string {
  const build = metadata.buildIdentity ? `, build=${metadata.buildIdentity}` : "";
  return (
    `kastell-mcp v${metadata.version} started ` +
    `(sdk=${metadata.mcpSdkVersion}${build}, SAFE_MODE=${safeMode})`
  );
}
