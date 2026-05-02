/**
 * Fix engine for audit checks.
 * Provides --fix (interactive) and --fix --dry-run (preview) modes.
 */

import type { AuditResult, AuditCheck, Severity, FixTier, FixExecutionLogEntry } from "./types.js";
import { SEVERITY_WEIGHTS, CATEGORY_WEIGHTS, DEFAULT_CATEGORY_WEIGHT, buildImpactContext, calculateCategoryScore, calculateOverallScore } from "./scoring.js";
import type { ImpactContext } from "./scoring.js";
import { sshExec, sshMasterOpen, sshMasterClose } from "../../utils/ssh.js";
import { raw } from "../../utils/sshCommand.js";
import { logger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/errorMapper.js";
import { tryHandlerDispatch } from "./handlers/index.js";
import { truncateExecutionLog } from "./fix-history.js";
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
  "grub-mkpasswd-pbkdf2", "uname", "df ",
  // TLS & certs
  "certbot", "ssl_protocols",
  // Kastell & instructional
  "kastell", "Add ", "Remove ", "Edit ", "Create ", "Configure ",
  "Ensure ", "Review ", "Verify ", "See ", "Update ", "Use ", "# ",
  "DEBIAN_FRONTEND", "curl",
];

/** Shell metacharacter guard — rejects commands with injection-prone characters */
const SHELL_METACHAR = /[;&|`$()><\n\r\0]/;

/** Check if a fix command passes whitelist + metachar validation */
export function isFixCommandAllowed(command: string): boolean {
  const isKnown = KNOWN_AUDIT_FIX_PREFIXES.some((p) => command.startsWith(p));
  return isKnown && !SHELL_METACHAR.test(command);
}

/** Categories where auto-fix is NEVER allowed regardless of check-level tier (D-02) */
export const FORBIDDEN_CATEGORIES = new Set(["SSH", "Firewall", "Docker"]);

/** All sysctl fix commands are auto-promoted to GUARDED to prevent SSH breakage (D-21) */
const SYSCTL_FIX_PATTERN = /sysctl\s+-w\s+/;

/** Commands that terminate the SSH session — must never run mid-fix-loop (D-22) */
const SESSION_KILLING_COMMANDS = ["reboot", "shutdown", "poweroff", "halt", "init 0", "init 6"];

/**
 * Resolve the effective fix tier for a check.
 * Category-level FORBIDDEN override trumps check-level field (D-02).
 * All sysctl fixes are promoted SAFE→GUARDED to prevent SSH breakage (D-21).
 * Reboot/shutdown commands are promoted SAFE→GUARDED to prevent mid-fix session loss (D-22).
 * Undefined safeToAutoFix defaults to GUARDED (D-04 safety net).
 */
export function resolveTier(check: AuditCheck, categoryName: string): FixTier {
  if (FORBIDDEN_CATEGORIES.has(categoryName)) return "FORBIDDEN";
  const tier = check.safeToAutoFix ?? "GUARDED";
  if (tier !== "SAFE" || !check.fixCommand) return tier;
  // D-21: sysctl changes can cumulatively break SSH connectivity
  if (SYSCTL_FIX_PATTERN.test(check.fixCommand)) return "GUARDED";
  // D-22: reboot/shutdown kills SSH session mid-fix
  if (SESSION_KILLING_COMMANDS.some((c) => check.fixCommand!.trim() === c)) return "GUARDED";
  return tier;
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

export interface FixPreview {
  checkId: string;
  command: string;
  tier: "SAFE" | "GUARDED" | "FORBIDDEN";
}

/** Result of running fixes */
export interface FixResult {
  applied: string[];
  skipped: string[];
  errors: string[];
  preview?: FixPlan;
  executionLog?: FixExecutionLogEntry[];
}

/** Severity ordering for display (critical first) */
const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

/** Severity rank for tie-breaking in impact sort (lower = higher priority) */
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

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
export function previewSafeFixes(result: AuditResult, options?: { includeForbidden?: boolean }): {
  safePlan: FixPlan;
  guardedCount: number;
  forbiddenCount: number;
  guardedIds: string[];
  forbiddenFixes?: FixPreview[];
} {
  const safeChecks: FixCheck[] = [];
  let guardedCount = 0;
  let forbiddenCount = 0;
  const guardedIds: string[] = [];
  const forbiddenFixes: FixPreview[] = [];

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
          if (options?.includeForbidden) {
            forbiddenFixes.push({ checkId: check.id, command: check.fixCommand, tier: "FORBIDDEN" });
          }
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

  return { safePlan: { groups }, guardedCount, forbiddenCount, guardedIds, forbiddenFixes: forbiddenFixes.length > 0 ? forbiddenFixes : undefined };
}

/**
 * Calculate estimated score impact if a single check is fixed.
 * Preserves fractional precision (no rounding) for accurate impact-based sorting.
 */
export function calculateCheckImpact(check: FixCheck, ctx: ImpactContext): number {
  if (ctx.totalOverallWeight === 0) return 0;
  const totalCategoryWeight = ctx.catWeightMap.get(check.category) ?? 0;
  if (totalCategoryWeight === 0) return 0;
  const checkWeight = SEVERITY_WEIGHTS[check.severity];
  const categoryImpact = (checkWeight / totalCategoryWeight) * 100;
  const catWeight = CATEGORY_WEIGHTS[check.category] ?? DEFAULT_CATEGORY_WEIGHT;
  return (categoryImpact * catWeight) / ctx.totalOverallWeight;
}

/**
 * Calculate estimated score impact if all checks in a group are fixed.
 * Delegates to calculateCheckImpact per check, then rounds the total.
 */
function calculateGroupImpact(
  checks: FixCheck[],
  ctx: ImpactContext,
): number {
  return Math.round(checks.reduce((sum, c) => sum + calculateCheckImpact(c, ctx), 0));
}

/** A FixCheck annotated with its estimated score impact */
export type ScoredFixCheck = FixCheck & { impact: number };

/**
 * Sort checks by impact descending, severity as tie-breaker (critical first).
 * Returns a new array with an `impact` property added to each element.
 */
export function sortChecksByImpact(checks: FixCheck[], ctx: ImpactContext): ScoredFixCheck[] {
  return checks
    .map((c) => ({ ...c, impact: calculateCheckImpact(c, ctx) }))
    .sort((a, b) => b.impact - a.impact || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Select top N checks from a pre-sorted array. Returns at most N elements. */
export function selectChecksForTop(sorted: ScoredFixCheck[], n: number): ScoredFixCheck[] {
  return sorted.slice(0, n);
}

/**
 * Select checks from sorted array until estimated score reaches target.
 * Returns empty array if currentScore is already >= target.
 * If target is unreachable, returns all checks.
 */
export function selectChecksForTarget(
  sorted: ScoredFixCheck[],
  currentScore: number,
  target: number,
): ScoredFixCheck[] {
  if (currentScore >= target) return [];
  const selected: ScoredFixCheck[] = [];
  let est = currentScore;
  for (const check of sorted) {
    selected.push(check);
    est += check.impact;
    if (est >= target) break;
  }
  return selected;
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

  // Open SSH master connection to prevent MaxStartups exhaustion (D-23)
  await sshMasterOpen(ip);

  const applied: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const executionLog: FixExecutionLogEntry[] = [];

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
          const startMs = Date.now();
          const preCheck = await sshExec(ip, raw(check.preCondition));
          const durationMs = Date.now() - startMs;
          executionLog.push({
            checkId: check.id,
            command: check.preCondition,
            stdout: preCheck.stdout,
            stderr: preCheck.stderr,
            durationMs,
            success: preCheck.code === 0,
          });
          if (preCheck.code !== 0) {
            errors.push(`${check.id}: pre-condition failed — ${check.preCondition}`);
            continue;
          }
        }
        // Handler dispatch — bypasses shell metachar guard (D-05, D-06)
        const dispatch = await tryHandlerDispatch(ip, check, applied, errors);
        if (dispatch.handled) continue;
        // Validate fixCommand against known safe prefixes + reject shell metacharacters
        if (!isFixCommandAllowed(check.fixCommand)) {
          errors.push(`${check.id}: fix command rejected — ${check.fixCommand.slice(0, 60)}`);
          continue;
        }
        const startMs = Date.now();
        const fixResult = await sshExec(ip, raw(check.fixCommand));
        const durationMs = Date.now() - startMs;
        executionLog.push({
          checkId: check.id,
          command: check.fixCommand,
          stdout: fixResult.stdout,
          stderr: fixResult.stderr,
          durationMs,
          success: fixResult.code === 0,
        });
        if (fixResult.code !== 0) {
          errors.push(`${check.id}: command failed (exit ${fixResult.code})${fixResult.stderr ? ` — ${fixResult.stderr}` : ""}`);
        } else {
          applied.push(check.id);
        }
      } catch (err) {
        errors.push(`${check.id}: ${getErrorMessage(err)}`);
      }
    }
  }

  // Close SSH master connection (D-23)
  sshMasterClose(ip);

  return { applied, skipped, errors, executionLog: truncateExecutionLog(executionLog) };
}

/**
 * Extract { checkId, fixCommand } pairs from a flat check array.
 * Used by CLI and MCP to pass to backupFilesBeforeFix.
 */
export function fixCommandsFromChecks(
  checks: FixCheck[],
): Array<{ checkId: string; fixCommand: string }> {
  return checks.map((c) => ({ checkId: c.id, fixCommand: c.fixCommand }));
}

export function extractAffectedCategories(
  appliedCheckIds: string[],
  categories: AuditResult["categories"],
): string[] {
  return [
    ...new Set(
      appliedCheckIds
        .map((checkId) => {
          for (const cat of categories) {
            if (cat.checks.some((ch) => ch.id === checkId)) return cat.name;
          }
          return undefined;
        })
        .filter((name): name is string => name !== undefined),
    ),
  ];
}

/**
 * Run a post-fix re-audit on affected categories and return the merged AuditResult.
 * Returns null on failure or when nothing to check.
 */
export async function runPostFixReAudit(
  ip: string,
  platform: string,
  originalResult: AuditResult,
  affectedCategories: string[],
): Promise<AuditResult | null> {
  if (affectedCategories.length === 0) return null;

  try {
    const batches = buildAuditBatchCommands(platform);
    const batchOutputs: string[] = [];

    for (const batch of batches) {
      const result = await sshExec(ip, raw(batch.command), {
        timeoutMs: BATCH_TIMEOUTS[batch.tier],
        useStdin: true,
      });
      batchOutputs.push(result.stdout);
    }

    const freshCategories = parseAllChecks(batchOutputs, platform);

    const mergedCategories = originalResult.categories.map((original) => {
      if (!affectedCategories.includes(original.name)) return original;
      const fresh = freshCategories.find((c) => c.name === original.name);
      if (!fresh) return original;
      const { score, maxScore } = calculateCategoryScore(fresh.checks);
      return { ...fresh, score, maxScore };
    });

    const overallScore = calculateOverallScore(mergedCategories);

    return {
      ...originalResult,
      categories: mergedCategories,
      overallScore,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    logger.warning(`Post-fix re-audit failed: ${getErrorMessage(err)}`);
    return null;
  }
}
