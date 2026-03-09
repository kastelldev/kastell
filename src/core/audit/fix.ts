/**
 * Fix engine for audit checks.
 * Provides --fix (interactive) and --fix --dry-run (preview) modes.
 */

import type { AuditResult, AuditCheck, Severity } from "./types.js";
import { sshExec } from "../../utils/ssh.js";
import inquirer from "inquirer";

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

/** Severity weights matching scoring.ts */
const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

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
  const groups: FixGroup[] = [];

  for (const severity of SEVERITY_ORDER) {
    const checks = fixableChecks.filter((c) => c.severity === severity);
    if (checks.length === 0) continue;

    const estimatedImpact = calculateGroupImpact(checks, result);
    groups.push({ severity, checks, estimatedImpact });
  }

  return { groups };
}

/**
 * Calculate estimated score impact if all checks in a group are fixed.
 * Uses the same severity weighting as the scoring engine.
 */
function calculateGroupImpact(
  checks: FixCheck[],
  result: AuditResult,
): number {
  const numCategories = result.categories.length || 1;
  let totalImpact = 0;

  for (const check of checks) {
    // Find which category this check belongs to
    const category = result.categories.find((c) => c.name === check.category);
    if (!category) continue;

    const totalCategoryWeight = category.checks.reduce(
      (sum, c) => sum + SEVERITY_WEIGHTS[c.severity],
      0,
    );
    if (totalCategoryWeight === 0) continue;

    const checkWeight = SEVERITY_WEIGHTS[check.severity];
    const categoryImpact = (checkWeight / totalCategoryWeight) * 100;
    totalImpact += categoryImpact / numCategories;
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
          const preCheck = await sshExec(ip, check.preCondition);
          if (preCheck.code !== 0) {
            errors.push(`${check.id}: pre-condition failed — ${check.preCondition}`);
            continue;
          }
        }
        const fixResult = await sshExec(ip, check.fixCommand);
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
