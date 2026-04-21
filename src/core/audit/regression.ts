import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { secureMkdirSync, secureWriteFileSync } from "../../utils/secureWrite.js";
import { KASTELL_DIR } from "../../utils/paths.js";
import type { AuditResult, RegressionBaseline, RegressionResult } from "./types.js";

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

function extractPassedCheckIds(audit: AuditResult): string[] {
  const ids: string[] = [];
  for (const category of audit.categories) {
    for (const check of category.checks) {
      if (check.passed) ids.push(check.id);
    }
  }
  return ids.sort();
}

export function saveBaseline(audit: AuditResult): void {
  const existing = loadBaseline(audit.serverIp);
  const passedChecks = extractPassedCheckIds(audit);
  const bestScore = existing
    ? Math.max(existing.bestScore, audit.overallScore)
    : audit.overallScore;

  const baseline: RegressionBaseline = {
    version: 1,
    serverIp: audit.serverIp,
    lastUpdated: new Date().toISOString(),
    bestScore,
    passedChecks,
  };

  if (!existsSync(REGRESSION_DIR)) {
    secureMkdirSync(REGRESSION_DIR, { recursive: true });
  }
  secureWriteFileSync(getBaselinePath(audit.serverIp), JSON.stringify(baseline, null, 2));
}

export function checkRegression(
  baseline: RegressionBaseline,
  audit: AuditResult,
): RegressionResult {
  const currentPassed = new Set(extractPassedCheckIds(audit));
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
