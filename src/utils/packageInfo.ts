import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

interface KastellPackageJson {
  version: string;
  dependencies?: Record<string, string>;
}

export function findPackageJson(): string | null {
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

export function readKastellPackageJson(): KastellPackageJson | null {
  try {
    const pkgPath = findPackageJson();
    if (!pkgPath) return null;
    return JSON.parse(readFileSync(pkgPath, "utf-8")) as KastellPackageJson;
  } catch {
    return null;
  }
}

let cachedPackageMetadata: KastellPackageJson | null | undefined;

export function clearPackageMetadataCache(): void {
  cachedPackageMetadata = undefined;
}

export function getPackageMetadata(): {
  version: string;
  mcpSdkVersion: string;
  buildIdentity?: string;
} {
  if (cachedPackageMetadata === undefined) {
    cachedPackageMetadata = readKastellPackageJson();
  }
  const pkg = cachedPackageMetadata;
  return {
    version: pkg?.version ?? "0.0.0",
    mcpSdkVersion: pkg?.dependencies?.["@modelcontextprotocol/sdk"] ?? "unknown",
    ...(process.env.KASTELL_BUILD_ID ? { buildIdentity: process.env.KASTELL_BUILD_ID } : {}),
  };
}
