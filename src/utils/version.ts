import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

let cachedVersion: string | null = null;

function findPackageJson(): string | null {
  let dir = fileURLToPath(new URL(".", import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

interface KastellPackageJson {
  version: string;
  dependencies?: Record<string, string>;
}

function readKastellPackageJson(): KastellPackageJson | null {
  try {
    const pkgPath = findPackageJson();
    if (!pkgPath) return null;
    return JSON.parse(readFileSync(pkgPath, "utf-8")) as KastellPackageJson;
  } catch {
    return null;
  }
}

export function getKastellVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const pkgPath = findPackageJson();
    if (!pkgPath) return "0.0.0";
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
    cachedVersion = pkg.version;
    return cachedVersion;
  } catch {
    return "0.0.0";
  }
}

export const KASTELL_VERSION = getKastellVersion();

export function clearVersionCache(): void {
  cachedVersion = null;
}

export function getPackageMetadata(): {
  version: string;
  mcpSdkVersion: string;
  buildIdentity?: string;
} {
  const pkg = readKastellPackageJson();
  return {
    version: pkg?.version ?? "0.0.0",
    mcpSdkVersion: pkg?.dependencies?.["@modelcontextprotocol/sdk"] ?? "unknown",
    ...(process.env.KASTELL_BUILD_ID
      ? { buildIdentity: process.env.KASTELL_BUILD_ID }
      : {}),
  };
}
