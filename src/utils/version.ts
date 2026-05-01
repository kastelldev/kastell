import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

let cachedVersion: string | null = null;

export function getKastellVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const __dirname = fileURLToPath(new URL(".", import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8")) as { version: string };
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
