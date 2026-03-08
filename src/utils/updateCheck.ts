import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import axios from "axios";
import { logger } from "./logger.js";

const CONFIG_DIR = join(homedir(), ".kastell");
export const UPDATE_CHECK_FILE = join(CONFIG_DIR, ".update-check");

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REQUEST_TIMEOUT_MS = 3000; // 3 seconds

interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
}

/**
 * Compare two semver-like version strings.
 * Returns true if latest > current.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  // Strip leading 'v' if present
  const cleanCurrent = current.replace(/^v/, "");
  const cleanLatest = latest.replace(/^v/, "");

  const currentParts = cleanCurrent.split(".").map(Number);
  const latestParts = cleanLatest.split(".").map(Number);

  // Compare major, minor, patch
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;

    if (latestPart > currentPart) {
      return true;
    }
    if (latestPart < currentPart) {
      return false;
    }
  }

  return false;
}

function readCache(): UpdateCache | null {
  try {
    if (!existsSync(UPDATE_CHECK_FILE)) {
      return null;
    }
    const content = readFileSync(UPDATE_CHECK_FILE, "utf-8");
    const cache = JSON.parse(content) as UpdateCache;
    if (
      typeof cache.lastCheck !== "number" ||
      typeof cache.latestVersion !== "string" ||
      !/^\d+\.\d+\.\d+/.test(cache.latestVersion)
    ) {
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    writeFileSync(UPDATE_CHECK_FILE, JSON.stringify(cache), { mode: 0o600 });
  } catch {
    // Silently ignore write errors
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await axios.get("https://registry.npmjs.org/kastell/latest", {
      timeout: REQUEST_TIMEOUT_MS,
    });
    const version = response.data?.version;
    if (typeof version === "string" && /^\d+\.\d+\.\d+/.test(version)) {
      return version;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check for updates and display a message if a newer version is available.
 * This function never throws - all errors are silently caught.
 */
export async function checkForUpdate(currentVersion: string): Promise<void> {
  try {
    const cache = readCache();
    const now = Date.now();

    // Use cached version if it's fresh (less than 24 hours old)
    if (cache && now - cache.lastCheck < CHECK_INTERVAL_MS) {
      if (isNewerVersion(currentVersion, cache.latestVersion)) {
        logger.info(
          `Update available: ${currentVersion} → ${cache.latestVersion} — Run: npm i -g kastell`,
        );
      }
      return;
    }

    // Fetch latest version from npm registry
    const latestVersion = await fetchLatestVersion();
    if (!latestVersion) {
      return;
    }

    // Save to cache
    writeCache({ lastCheck: now, latestVersion });

    // Display update message if newer version available
    if (isNewerVersion(currentVersion, latestVersion)) {
      logger.info(
        `Update available: ${currentVersion} → ${latestVersion} — Run: npm i -g kastell`,
      );
    }
  } catch {
    // Silently ignore all errors - update check is non-blocking
  }
}
