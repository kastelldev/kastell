/**
 * Fix engine for audit checks.
 * Provides --fix (interactive) and --fix --dry-run (preview) modes.
 */

import type { AuditResult, AuditCheck, Severity, FixTier } from "./types.js";
import { SEVERITY_WEIGHTS, CATEGORY_WEIGHTS, DEFAULT_CATEGORY_WEIGHT, buildImpactContext, calculateCategoryScore, calculateOverallScore } from "./scoring.js";
import type { ImpactContext } from "./scoring.js";
import { sshExec } from "../../utils/ssh.js";
import { raw } from "../../utils/sshCommand.js";
import { logger } from "../../utils/logger.js";
import inquirer from "inquirer";
import { buildAuditBatchCommands, BATCH_TIMEOUTS } from "./commands.js";
import { parseAllChecks } from "./checks/index.js";

/** Whitelist of known safe fix command prefixes from audit check definitions */
export const KNOWN_AUDIT_FIX_PREFIXES = [
  // System administration
  "chmod", "chown", "sed ", "systemctl", "apt ", "apt-get", "dpkg",
  "sysctl", "passwd", "useradd", "gpasswd", "visudo", "reboot",
  // Firewall & networking
  "ufw ", "iptables", "ip6tables", "ip ", "ss ",
  // File operations
  "echo ", "find ", "touch", "mkdir", "rm ", "ls ", "grep ",
  "jq ", "awk ", "openssl", "export ",
  // Security tools
  "aide", "aideinit", "rkhunter", "aa-enforce", "aa-genprof",
  "auditctl", "mokutil", "setenforce", "cryptsetup", "ssh-keygen",
  // Services & time
  "docker", "logrotate", "chronyc", "hwclock", "timedatectl",
  // Boot & kernel
  "grub2-mkpasswd-pbkdf2", "uname", "df ",
  // TLS & certs
  "certbot", "ssl_protocols",
  // Kastell & instructional
  "kastell", "Add ", "Remove ", "Edit ", "Create ", "Configure ",
  "Ensure ", "Review ", "Verify ", "See ", "Update ", "Use ", "# ",
  "DEBIAN_FRONTEND", "curl",
];

/** Shell metacharacter guard — rejects commands with injection-prone characters */
const SHELL_METACHAR = /[;&|`$()><]/;

/** Check if a fix command passes whitelist + metachar validation */
export function isFixCommandAllowed(command: string): boolean {
  const isKnown = KNOWN_AUDIT_FIX_PREFIXES.some((p) => command.startsWith(p));
  return isKnown && !SHELL_METACHAR.test(command);
}

/** Categories where auto-fix is NEVER allowed regardless of check-level tier (D-02) */
export const FORBIDDEN_CATEGORIES = new Set(["SSH", "Firewall", "Docker"]);

/**
 * Resolve the effective fix tier for a check.
 * Category-level FORBIDDEN override trumps check-level field (D-02).
 * Undefined safeToAutoFix defaults to GUARDED (D-04 safety net).
 */
export function resolveTier(check: AuditCheck, categoryName: string): FixTier {
  if (FORBIDDEN_CATEGORIES.has(categoryName)) return "FORBIDDEN";
  return check.safeToAutoFix ?? "GUARDED";
}

/** A check with pre-condition info for safe fixing */
export interface FixCheck {
  id: string;
  category: string;
  name: string;
  severity: Severity;
  fixCommand: string;
  preCondition?: string;
}

/** A group of fixes at the same severity level */
export interface FixGroup {
  severity: Severity;
  checks: FixCheck[];
  estimatedImpact: number;
}

/** Plan of all fixes grouped by severity */
export interface FixPlan {
  groups: FixGroup[];
}

/** Result of running fixes */
export interface FixResult {
  applied: string[];
  skipped: string[];
  errors: string[];
  preview?: FixPlan;
}

/** Severity ordering for display (critical first) */
const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

/**
 * Determine pre-condition check for dangerous fixes.
 * Prevents lockout scenarios (e.g., disabling password auth without SSH keys).
 */
function getPreCondition(check: AuditCheck): string | undefined {
  // SSH password auth disable requires SSH keys to be present
  if (
    check.category === "SSH" &&
    check.name.toLowerCase().includes("password") &&
    check.fixCommand?.includes("PasswordAuthentication")
  ) {
    return "test -f ~/.ssh/authorized_keys && test -s ~/.ssh/authorized_keys";
  }

  // Firewall changes require SSH port to be allowed
  if (
    check.category === "Firewall" &&
    check.fixCommand?.includes("ufw")
  ) {
    return "ufw status | grep -q '22\\|ssh'";
  }

  return undefined;
}

/**
 * Preview all available fixes without executing.
 * Groups by severity (critical first), calculates estimated score impact.
 */
export function previewFixes(result: AuditResult): FixPlan {
  // Collect all failed checks with fixCommand
  const fixableChecks: FixCheck[] = [];

  for (const category of result.categories) {
    for (const check of category.checks) {
      if (!check.passed && check.fixCommand) {
        fixableChecks.push({
          id: check.id,
          category: check.category,
          name: check.name,
          severity: check.severity,
          fixCommand: check.fixCommand,
          preCondition: getPreCondition(check),
        });
      }
    }
  }

  // Group by severity
  const ctx = buildImpactContext(result.categories);
  const groups: FixGroup[] = [];

  for (const severity of SEVERITY_ORDER) {
    const checks = fixableChecks.filter((c) => c.severity === severity);
    if (checks.length === 0) continue;

    const estimatedImpact = calculateGroupImpact(checks, ctx);
    groups.push({ severity, checks, estimatedImpact });
  }

  return { groups };
}

/**
 * Preview only SAFE tier fixes (no service restarts, no SSH/FW/Docker).
 * Returns a FixPlan with only SAFE checks, plus counts of GUARDED and FORBIDDEN.
 */
export function previewSafeFixes(result: AuditResult): {
  safePlan: FixPlan;
  guardedCount: number;
  forbiddenCount: number;
  guardedIds: string[];
} {
  const safeChecks: FixCheck[] = [];
  let guardedCount = 0;
  let forbiddenCount = 0;
  const guardedIds: string[] = [];

  for (const category of result.categories) {
    for (const check of category.checks) {
      if (!check.passed && check.fixCommand) {
        const tier = resolveTier(check, category.name);
        if (tier === "SAFE") {
          safeChecks.push({
            id: check.id,
            category: check.category,
            name: check.name,
            severity: check.severity,
            fixCommand: check.fixCommand,
            preCondition: getPreCondition(check),
          });
        } else if (tier === "GUARDED") {
          guardedCount++;
          guardedIds.push(check.id);
        } else {
          forbiddenCount++;
        }
      }
    }
  }

  const ctx = buildImpactContext(result.categories);
  const groups: FixGroup[] = [];
  for (const severity of SEVERITY_ORDER) {
    const checks = safeChecks.filter((c) => c.severity === severity);
    if (checks.length === 0) continue;
    const estimatedImpact = calculateGroupImpact(checks, ctx);
    groups.push({ severity, checks, estimatedImpact });
  }

  return { safePlan: { groups }, guardedCount, forbiddenCount, guardedIds };
}

/**
 * Calculate estimated score impact if all checks in a group are fixed.
 * Uses the same severity and category weighting as the scoring engine.
 */
function calculateGroupImpact(
  checks: FixCheck[],
  ctx: ImpactContext,
): number {
  if (ctx.totalOverallWeight === 0) return 0;

  let totalImpact = 0;

  for (const check of checks) {
    const totalCategoryWeight = ctx.catWeightMap.get(check.category) ?? 0;
    if (totalCategoryWeight === 0) continue;

    const checkWeight = SEVERITY_WEIGHTS[check.severity];
    const categoryImpact = (checkWeight / totalCategoryWeight) * 100;
    const catWeight = CATEGORY_WEIGHTS[check.category] ?? DEFAULT_CATEGORY_WEIGHT;
    totalImpact += (categoryImpact * catWeight) / ctx.totalOverallWeight;
  }

  return Math.round(totalImpact);
}

/**
 * Run fixes interactively or preview in dry-run mode.
 *
 * - dryRun: Preview without executing, return FixPlan
 * - Interactive: Prompt per severity group, execute confirmed fixes via SSH
 */
export async function runFix(
  ip: string,
  result: AuditResult,
  options: { dryRun: boolean },
): Promise<FixResult> {
  const plan = previewFixes(result);

  if (options.dryRun) {
    return {
      applied: [],
      skipped: [],
      errors: [],
      preview: plan,
    };
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const group of plan.groups) {
    const checkIds = group.checks.map((c) => c.id).join(", ");
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `Fix ${group.checks.length} ${group.severity} issue(s)? [${checkIds}]`,
        default: false,
      },
    ]);

    if (!confirm) {
      skipped.push(...group.checks.map((c) => c.id));
      continue;
    }

    // Execute fixes for this group
    for (const check of group.checks) {
      try {
        // Check pre-condition before applying fix (prevents lockout scenarios)
        if (check.preCondition) {
          // preCondition is a hardcoded string from audit check definitions
          const preCheck = await sshExec(ip, raw(check.preCondition));
          if (preCheck.code !== 0) {
            errors.push(`${check.id}: pre-condition failed — ${check.preCondition}`);
            continue;
          }
        }
        // Validate fixCommand against known safe prefixes + reject shell metacharacters
        if (!isFixCommandAllowed(check.fixCommand)) {
          errors.push(`${check.id}: fix command rejected — ${check.fixCommand.slice(0, 60)}`);
          continue;
        }
        const fixResult = await sshExec(ip, raw(check.fixCommand));
        if (fixResult.code !== 0) {
          errors.push(`${check.id}: command failed (exit ${fixResult.code})${fixResult.stderr ? ` — ${fixResult.stderr}` : ""}`);
        } else {
          applied.push(check.id);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${check.id}: ${message}`);
      }
    }
  }

  return { applied, skipped, errors };
}

/**
 * Lightweight post-fix re-audit.
 * Re-runs all SSH batches, but only replaces scores for affected categories.
 * Returns new overall score, or null on failure or when nothing to check.
 */
export async function runScoreCheck(
  ip: string,
  platform: string,
  originalResult: AuditResult,
  affectedCategories: string[],
): Promise<number | null> {
  if (affectedCategories.length === 0) return null;

  try {
    const batches = buildAuditBatchCommands(platform);
    const batchOutputs: string[] = [];

    for (const batch of batches) {
      const result = await sshExec(ip, batch.command, {
        timeoutMs: BATCH_TIMEOUTS[batch.tier],
        useStdin: true,
      });
      batchOutputs.push(result.stdout);
    }

    const freshCategories = parseAllChecks(batchOutputs, platform);

    // Merge: replace only affected categories, keep others from original
    const mergedCategories = originalResult.categories.map((original) => {
      if (!affectedCategories.includes(original.name)) return original;
      const fresh = freshCategories.find((c) => c.name === original.name);
      if (!fresh) return original;
      const { score, maxScore } = calculateCategoryScore(fresh.checks);
      return { ...fresh, score, maxScore };
    });

    return calculateOverallScore(mergedCategories);
  } catch (err) {
    logger.warning(`Score re-audit failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
