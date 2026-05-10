import { sshExec } from "../../utils/ssh.js";
import { raw } from "../../utils/sshCommand.js";
import { debugLog } from "../../utils/logger.js";
import type { PluginCheck, PluginFix } from "../../plugin/sdk/types.js";
import type { AuditCategory, AuditCheck, Severity, FixTier, ComplianceRef } from "./types.js";

export function mapPluginComplianceRefs(refs?: Array<{ framework: string; ref: string }>): ComplianceRef[] {
  if (!refs || refs.length === 0) return [];
  return refs.map((r) => ({
    framework: r.framework,
    controlId: r.ref,
    version: "1.0",
    description: r.ref,
    coverage: "partial" as const,
  }));
}

export async function executePluginChecks(
  ip: string,
  categoryName: string,
  checks: PluginCheck[],
  pluginName?: string,
  fixes?: PluginFix[],
): Promise<AuditCategory> {
  const auditChecks: AuditCheck[] = [];

  for (const check of checks) {
    try {
      const { stdout } = await sshExec(ip, raw(check.checkCommand), { timeoutMs: 15000 });
      const output = stdout.trim();
      const passed = evaluateCheck(output, check);
      auditChecks.push({
        id: check.id,
        category: check.category,
        name: check.name,
        severity: check.severity as Severity,
        passed,
        currentValue: output,
        expectedValue: check.passPattern ?? "pass",
        fixCommand: check.fixCommand,
        safeToAutoFix: check.safeToAutoFix as FixTier | undefined,
        explain: check.explain,
        complianceRefs: mapPluginComplianceRefs(check.complianceRefs),
      });
      // Fix metadata injection — override from manifest fixes
      if (!passed && fixes && pluginName) {
        const fixDef = fixes.find((f) => f.checkId === check.id);
        if (fixDef) {
          const auditCheck = auditChecks[auditChecks.length - 1];
          auditCheck.safeToAutoFix = fixDef.tier as FixTier;
          auditCheck.fixCommand = `plugin:${pluginName}:${fixDef.handler}`;
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (debugLog) console.log(`Plugin check ${check.id} failed: ${msg}`);
      auditChecks.push({
        id: check.id,
        category: check.category,
        name: check.name,
        severity: check.severity as Severity,
        passed: false,
        currentValue: "SSH error",
        expectedValue: check.passPattern ?? "pass",
        fixCommand: check.fixCommand,
        safeToAutoFix: check.safeToAutoFix as FixTier | undefined,
      });
      // Fix metadata injection — override from manifest fixes
      if (fixes && pluginName) {
        const fixDef = fixes.find((f) => f.checkId === check.id);
        if (fixDef) {
          const auditCheck = auditChecks[auditChecks.length - 1];
          auditCheck.safeToAutoFix = fixDef.tier as FixTier;
          auditCheck.fixCommand = `plugin:${pluginName}:${fixDef.handler}`;
        }
      }
    }
  }

  // Score placeholder — runAudit recalculates via scoring.ts (severity-weighted)
  return {
    name: categoryName,
    checks: auditChecks,
    score: 0,
    maxScore: 0,
  };
}

function evaluateCheck(output: string, check: PluginCheck): boolean {
  if (check.failPattern && new RegExp(check.failPattern).test(output)) return false;
  if (check.passPattern) return new RegExp(check.passPattern).test(output);
  return true;
}
