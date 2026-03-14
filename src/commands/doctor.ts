import { execSync } from "child_process";
import { existsSync, accessSync, constants } from "fs";
import axios from "axios";
import { getServers } from "../utils/config.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { CONFIG_DIR } from "../utils/config.js";
import { PROVIDER_REGISTRY } from "../constants.js";
import { resolveServer } from "../utils/serverSelect.js";
import { runServerDoctor } from "../core/doctor.js";
import type { DoctorFinding, DoctorResult } from "../core/doctor.js";

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
      timeout: 10000,
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
  try {
    const version = execSync("npm --version", { stdio: "pipe" }).toString().trim();
    return { name: "npm", status: "pass", detail: `v${version}` };
  } catch {
    return { name: "npm", status: "fail", detail: "not found" };
  }
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

// ─── Server mode display helpers ──────────────────────────────────────────────

const SEVERITY_LABEL: Record<string, string> = {
  critical: "CRITICAL",
  warning: "WARNING",
  info: "INFO",
};

function displayFindings(result: DoctorResult): void {
  logger.title(`Doctor Report: ${result.serverName} (${result.serverIp})`);

  if (result.findings.length === 0) {
    logger.success("No issues detected");
  } else {
    const bySeverity = {
      critical: result.findings.filter((f) => f.severity === "critical"),
      warning: result.findings.filter((f) => f.severity === "warning"),
      info: result.findings.filter((f) => f.severity === "info"),
    };

    for (const [severity, findings] of Object.entries(bySeverity) as [string, DoctorFinding[]][]) {
      if (findings.length === 0) continue;
      const label = SEVERITY_LABEL[severity] ?? severity.toUpperCase();
      console.log(`\n  ${label} (${findings.length})`);
      for (const finding of findings) {
        logger.warning(`  ${finding.description}`);
        logger.step(`  Run: ${finding.command}`);
      }
    }

    const critical = bySeverity.critical.length;
    const warnings = bySeverity.warning.length;
    const info = bySeverity.info.length;
    const total = result.findings.length;

    const parts: string[] = [];
    if (critical > 0) parts.push(`${critical} critical`);
    if (warnings > 0) parts.push(`${warnings} warnings`);
    if (info > 0) parts.push(`${info} info`);

    console.log();
    logger.info(`${total} finding${total === 1 ? "" : "s"} (${parts.join(", ")})`);
  }

  if (!result.usedFreshData) {
    logger.info("Using cached data. Run with --fresh for live analysis.");
  }
}

// ─── Main command ──────────────────────────────────────────────────────────────

export async function doctorCommand(
  server?: string,
  options?: { checkTokens?: boolean; fresh?: boolean; json?: boolean },
  version?: string,
): Promise<void> {
  // ── Server mode ──────────────────────────────────────────────────────────────
  if (server) {
    const resolved = await resolveServer(server, "Select a server for doctor analysis:");
    if (!resolved) return;

    const spinner = createSpinner(`Running doctor analysis on ${resolved.name}...`);
    spinner.start();

    const result = await runServerDoctor(resolved.ip, resolved.name, { fresh: options?.fresh });

    spinner.stop();

    if (options?.json) {
      if (result.success && result.data) {
        console.log(JSON.stringify(result.data, null, 2));
      } else {
        console.log(JSON.stringify({ error: result.error }, null, 2));
      }
      return;
    }

    if (!result.success) {
      logger.error(result.error ?? "Doctor analysis failed");
      return;
    }

    displayFindings(result.data!);
    return;
  }

  // ── Local mode ───────────────────────────────────────────────────────────────
  logger.title("Kastell Doctor");

  const results = runDoctorChecks(version);

  for (const result of results) {
    const colorFn =
      result.status === "pass"
        ? logger.success
        : result.status === "warn"
          ? logger.warning
          : logger.error;
    colorFn(`${result.name}: ${result.detail}`);
  }

  const failures = results.filter((r) => r.status === "fail");
  const warnings = results.filter((r) => r.status === "warn");

  console.log();
  if (failures.length > 0) {
    logger.error(`${failures.length} check(s) failed. Please fix the issues above.`);
  } else if (warnings.length > 0) {
    logger.warning(`All checks passed with ${warnings.length} warning(s).`);
  } else {
    logger.success("All checks passed! Your environment is ready.");
  }

  if (options?.checkTokens) {
    await checkProviderTokens();
  }
}
