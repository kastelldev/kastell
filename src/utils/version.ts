import { readFileSync } from "fs";
import { findPackageJson, clearPackageMetadataCache, getPackageMetadata } from "./packageInfo.js";

let cachedVersion: string | null = null;

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
  clearPackageMetadataCache();
}

export { getPackageMetadata, clearPackageMetadataCache };
