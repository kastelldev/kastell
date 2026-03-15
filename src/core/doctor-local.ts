import { spawnSync } from "child_process";
import { existsSync, accessSync, constants } from "fs";
import axios from "axios";
import { getServers, CONFIG_DIR } from "../utils/config.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { PROVIDER_REGISTRY, DOCTOR_TIMEOUT_MS } from "../constants.js";
import { logger } from "../utils/logger.js";

// ─── Token Validation ────────────────────────────────────────────────────────

// Validation endpoints differ from base API URLs (provider-specific paths)
const DOCTOR_VALIDATE_URLS: Record<string, string> = {
  hetzner: "https://api.hetzner.cloud/v1/servers?per_page=1",
  digitalocean: "https://api.digitalocean.com/v2/account",
  vultr: "https://api.vultr.com/v2/account",
  linode: "https://api.linode.com/v4/profile",
};

async function validateToken(provider: string, token: string): Promise<boolean> {
  const validateUrl = DOCTOR_VALIDATE_URLS[provider];
  if (!validateUrl) {
    return false;
  }

  try {
    await axios.get(validateUrl, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: DOCTOR_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

export async function checkProviderTokens(): Promise<void> {
  const servers = getServers();

  if (servers.length === 0) {
    logger.info("No servers registered. Token check skipped.");
    return;
  }

  // Get unique providers from registered servers
  const providers = [...new Set(servers.map((s) => s.provider))];

  console.log();
  logger.title("Provider Token Validation");

  for (const provider of providers) {
    const registryEntry = PROVIDER_REGISTRY[provider as keyof typeof PROVIDER_REGISTRY];
    if (!registryEntry) {
      logger.warning(`${provider}: Unknown provider, skipping token check`);
      continue;
    }

    const token = process.env[registryEntry.envKey];

    if (!token) {
      logger.warning(`${registryEntry.displayName}: ${registryEntry.envKey} not set in environment`);
      continue;
    }

    const isValid = await validateToken(provider, token);
    if (isValid) {
      logger.success(`${registryEntry.displayName}: Token is valid`);
    } else {
      logger.error(`${registryEntry.displayName}: Token is invalid or expired`);
    }
  }
}

// ─── Local Environment Checks ────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0], 10);
  if (major >= 20) {
    return { name: "Node.js", status: "pass", detail: version };
  }
  return { name: "Node.js", status: "fail", detail: `${version} (requires >= 20)` };
}

function checkNpmVersion(): CheckResult {
  // spawnSync avoids shell invocation — pass binary and args separately
  const result = spawnSync("npm", ["--version"], { stdio: "pipe" });
  if (result.status === 0) {
    const version = result.stdout?.toString().trim() ?? "";
    return { name: "npm", status: "pass", detail: `v${version}` };
  }
  return { name: "npm", status: "fail", detail: "not found" };
}

function checkSsh(): CheckResult {
  if (checkSshAvailable()) {
    return { name: "SSH Client", status: "pass", detail: "available" };
  }
  return {
    name: "SSH Client",
    status: "warn",
    detail: "not found (needed for ssh/logs/monitor/update)",
  };
}

function checkKastellVersion(version?: string): CheckResult {
  if (version) {
    return { name: "kastell", status: "pass", detail: `v${version}` };
  }
  return { name: "kastell", status: "warn", detail: "version unknown" };
}

function checkConfigDir(): CheckResult {
  if (!existsSync(CONFIG_DIR)) {
    return { name: "Config Dir", status: "warn", detail: `${CONFIG_DIR} (not created yet)` };
  }
  try {
    accessSync(CONFIG_DIR, constants.R_OK | constants.W_OK);
    return { name: "Config Dir", status: "pass", detail: CONFIG_DIR };
  } catch {
    return { name: "Config Dir", status: "fail", detail: `${CONFIG_DIR} (not writable)` };
  }
}

function checkRegisteredServers(): CheckResult {
  const servers = getServers();
  if (servers.length === 0) {
    return { name: "Servers", status: "warn", detail: "0 registered (run kastell init)" };
  }
  return { name: "Servers", status: "pass", detail: `${servers.length} registered` };
}

export function runDoctorChecks(version?: string): CheckResult[] {
  return [
    checkNodeVersion(),
    checkNpmVersion(),
    checkSsh(),
    checkKastellVersion(version),
    checkConfigDir(),
    checkRegisteredServers(),
  ];
}
