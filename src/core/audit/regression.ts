import { readFileSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { secureMkdirSync, secureWriteFileSync } from "../../utils/secureWrite.js";
import { KASTELL_DIR } from "../../utils/paths.js";
import { withFileLock } from "../../utils/fileLock.js";
import type { AuditResult, RegressionBaseline, RegressionResult, RegressionLine } from "./types.js";

const REGRESSION_DIR = join(KASTELL_DIR, "regression");

export function getBaselinePath(serverIp: string): string {
  const safeIp = serverIp.replace(/\./g, "-");
  return join(REGRESSION_DIR, `${safeIp}.json`);
}

export function loadBaseline(serverIp: string): RegressionBaseline | null {
  const filePath = getBaselinePath(serverIp);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as RegressionBaseline;
    if (parsed.version !== 1 || !Array.isArray(parsed.passedChecks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractPassedCheckIds(audit: AuditResult): string[] {
  const ids: string[] = [];
  for (const category of audit.categories) {
    for (const check of category.checks) {
      if (check.passed) ids.push(check.id);
    }
  }
  return ids.sort();
}

export async function saveBaseline(
  audit: AuditResult,
  existing?: RegressionBaseline | null,
  passedCheckIds?: string[],
): Promise<void> {
  const filePath = getBaselinePath(audit.serverIp);
  await withFileLock(filePath, () => {
    const prev = existing ?? loadBaseline(audit.serverIp);
    const passedChecks = passedCheckIds ?? extractPassedCheckIds(audit);
    const bestScore = prev
      ? Math.max(prev.bestScore, audit.overallScore)
      : audit.overallScore;

    const baseline: RegressionBaseline = {
      version: 1,
      serverIp: audit.serverIp,
      lastUpdated: new Date().toISOString(),
      bestScore,
      passedChecks,
    };

    secureMkdirSync(REGRESSION_DIR, { recursive: true });
    const tmpFile = filePath + ".tmp";
    secureWriteFileSync(tmpFile, JSON.stringify(baseline, null, 2), { encoding: "utf-8" });
    renameSync(tmpFile, filePath);
  });
}

export async function saveBaselineSafe(
  audit: AuditResult,
  existing?: RegressionBaseline | null,
  passedCheckIds?: string[],
): Promise<void> {
  await saveBaseline(audit, existing, passedCheckIds).catch(() => {});
}

export function checkRegression(
  baseline: RegressionBaseline,
  audit: AuditResult,
  passedCheckIds?: string[],
): RegressionResult {
  const currentPassed = new Set(passedCheckIds ?? extractPassedCheckIds(audit));
  const baselinePassed = new Set(baseline.passedChecks);

  const regressions: string[] = [];
  for (const id of baselinePassed) {
    if (!currentPassed.has(id)) regressions.push(id);
  }

  const newPasses: string[] = [];
  for (const id of currentPassed) {
    if (!baselinePassed.has(id)) newPasses.push(id);
  }

  return {
    regressions: regressions.sort(),
    newPasses: newPasses.sort(),
    baselineScore: baseline.bestScore,
    currentScore: audit.overallScore,
  };
}

export function formatRegressionSummary(result: RegressionResult): RegressionLine[] {
  const lines: RegressionLine[] = [];
  if (result.regressions.length > 0) {
    lines.push({
      severity: "warn",
      text: `Regression: ${result.regressions.length} check(s) regressed: ${result.regressions.join(", ")}`,
    });
  }
  if (result.newPasses.length > 0) {
    lines.push({
      severity: "info",
      text: `New passes: ${result.newPasses.length} check(s) now passing: ${result.newPasses.join(", ")}`,
    });
  }
  lines.push({ severity: "info", text: `Best score: ${result.baselineScore}` });
  return lines;
}
