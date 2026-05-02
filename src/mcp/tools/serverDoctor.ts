import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { runServerDoctor } from "../../core/doctor.js";
import { runDoctorFix } from "../../core/doctor-fix.js";
import { isSafeMode } from "../../core/manage.js";
import type { DoctorFinding } from "../../core/doctor.js";
import {
  resolveServerForMcp,
  mcpSuccess,
  mcpError,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";

export const serverDoctorSchema = {
  server: z.string().optional().describe("Server name or IP. Auto-selected if only one server exists."),
  fresh: z.boolean().default(false).describe("Fetch live data via SSH instead of using cached metrics. Default: false (reads cache only)."),
  format: z.enum(["summary", "json"]).default("summary").describe("Output format: summary (grouped findings with counts), json (full DoctorResult)."),
  autoFix: z.boolean().default(false).describe("Run diagnose->fix chain automatically. Default: false (read-only)."),
  dryRun: z.boolean().default(false).describe("Show what fixes would be applied without executing SSH. Requires autoFix: true."),
  force: z.boolean().default(false).describe("Skip per-finding confirmation prompts (CI-safe). Requires autoFix: true."),
};

export async function handleServerDoctor(params: {
  server?: string;
  fresh?: boolean;
  format?: "summary" | "json";
  autoFix?: boolean;
  dryRun?: boolean;
  force?: boolean;
}): Promise<McpResponse> {
  try {
    const servers = getServers();
    if (servers.length === 0) {
      return mcpError("No servers found", undefined, [
        { command: "kastell add", reason: "Add a server first" },
      ]);
    }

    const server = resolveServerForMcp(params, servers);
    if (!server) {
      if (params.server) {
        return mcpError(
          `Server not found: ${params.server}`,
          `Available servers: ${servers.map((s) => s.name).join(", ")}`,
        );
      }
      return mcpError(
        "Multiple servers found. Specify which server to use.",
        `Available: ${servers.map((s) => s.name).join(", ")}`,
      );
    }

    const fresh = params.fresh ?? false;
    const result = await runServerDoctor(server.ip, server.name, { fresh });

    if (!result.success || !result.data) {
      return mcpError(result.error ?? "Doctor analysis failed", result.hint);
    }

    const doctorResult = result.data;

    if (params.autoFix) {
      const findings = doctorResult.findings;
      const fixable = findings.filter((f: DoctorFinding) => f.fixCommand);

      if (fixable.length === 0) {
        return mcpSuccess({
          server: doctorResult.serverName,
          message: "No auto-fixable findings detected",
          total: findings.length,
        });
      }

      // Safe mode forces dryRun (mirrors serverFix pattern)
      const effectiveDryRun = (params.dryRun ?? false) || isSafeMode();
      const safeModeForcedDryRun = !params.dryRun && isSafeMode() ? true : undefined;

      const fixResult = await runDoctorFix(server.ip, findings, {
        dryRun: effectiveDryRun,
        force: params.force ?? false,
      }, doctorResult.serverName);

      return mcpSuccess({
        server: doctorResult.serverName,
        mode: effectiveDryRun ? "dry-run" : "applied",
        safeModeForcedDryRun,
        total: findings.length,
        fixable: fixable.length,
        manual: findings.length - fixable.length,
        applied: fixResult.applied.length,
        skipped: fixResult.skipped.length,
        failed: fixResult.failed.length,
        failedDetails: fixResult.failed,
      });
    }

    const format = params.format ?? "summary";

    if (format === "json") {
      return mcpSuccess(doctorResult as unknown as Record<string, unknown>, { largeResult: true });
    }

    // summary format: group findings by severity
    const bySeverity = {
      critical: doctorResult.findings.filter((f) => f.severity === "critical"),
      warning: doctorResult.findings.filter((f) => f.severity === "warning"),
      info: doctorResult.findings.filter((f) => f.severity === "info"),
    };

    const findingLines: string[] = [];
    for (const [severity, findings] of Object.entries(bySeverity)) {
      for (const f of findings) {
        findingLines.push(`  [${severity.toUpperCase()}] ${f.description} (fix: ${f.command})`);
      }
    }

    return mcpSuccess({
      server: doctorResult.serverName,
      total: doctorResult.findings.length,
      critical: bySeverity.critical.length,
      warning: bySeverity.warning.length,
      info: bySeverity.info.length,
      score: doctorResult.score,
      ranAt: doctorResult.ranAt,
      usedFreshData: doctorResult.usedFreshData,
      findings: findingLines,
    });
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}
