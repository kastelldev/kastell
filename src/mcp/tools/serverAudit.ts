import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { runAudit } from "../../core/audit/index.js";
import { filterAuditResult } from "../../core/audit/filter.js";
import { resolveSnapshotRef, diffAudits, formatDiffJson } from "../../core/audit/diff.js";
import { saveSnapshot } from "../../core/audit/snapshot.js";
import type { AuditFilter } from "../../core/audit/filter.js";
import {
  resolveServerForMcp,
  mcpSuccess,
  mcpError,
  mcpLog,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";
import { calculateComplianceDetail } from "../../core/audit/compliance/scoring.js";
import { FRAMEWORK_KEY_MAP } from "../../core/audit/compliance/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { filterChecksByProfile, isValidProfile, listAllProfileNames } from "../../core/audit/profiles.js";
import { saveBaseline, loadBaseline, checkRegression } from "../../core/audit/regression.js";


export const serverAuditSchema = {
  server: z.string().optional().describe("Server name or IP. Auto-selected if only one server exists."),
  format: z.enum(["summary", "json", "score"]).default("summary")
    .describe("Output format: summary (default), json (full result), score (number only)"),
  framework: z.enum(["cis-level1", "cis-level2", "pci-dss", "hipaa"]).optional()
    .describe("Compliance framework filter. Returns per-control pass/fail summary alongside audit results."),
  explain: z.boolean().optional().describe(
    "When true, include why + fix explanation for each failing check in summary format output. Capped at 10 checks."
  ),
  category: z.string().optional().describe("Filter results to a specific category (e.g. 'SSH', 'Firewall', 'Docker')."),
  severity: z.enum(["critical", "warning", "info"]).optional().describe("Filter checks by severity level."),
  snapshot: z.union([z.boolean(), z.string()]).optional()
    .describe("Save audit snapshot. true for auto-name, string for custom name."),
  compare: z.string().optional().describe("Compare two snapshots: format before:after (e.g. pre-upgrade:latest)"),
  threshold: z.number().int().min(1).max(100).optional()
    .describe("Minimum passing score (1-100). Returns error if score is below threshold."),
  profile: z.string().optional().describe("Server profile filter (web-server, database, mail-server)."),
};

export async function handleServerAudit(params: {
  server?: string;
  format?: "summary" | "json" | "score";
  framework?: "cis-level1" | "cis-level2" | "pci-dss" | "hipaa";
  explain?: boolean;
  category?: string;
  severity?: "critical" | "warning" | "info";
  snapshot?: boolean | string;
  compare?: string;
  threshold?: number;
  profile?: string;
}, mcpServer?: McpServer): Promise<McpResponse> {
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
        "Multiple servers found. Specify which server to audit.",
        `Available: ${servers.map((s) => s.name).join(", ")}`,
      );
    }

    // Compare mode: early return with diff of two snapshots
    if (params.compare !== undefined) {
      const parts = params.compare.split(":");
      if (parts.length !== 2) {
        return mcpError(
          "--compare requires format: before:after",
          "Example: server_audit { server: 'my-server', compare: 'pre-upgrade:latest' }",
        );
      }
      const [beforeRef, afterRef] = parts;
      const beforeSnap = await resolveSnapshotRef(server.ip, beforeRef);
      if (!beforeSnap) {
        return mcpError(`Snapshot not found: '${beforeRef}'`, "Use server_audit with snapshot:true to create one");
      }
      const afterSnap = await resolveSnapshotRef(server.ip, afterRef);
      if (!afterSnap) {
        return mcpError(`Snapshot not found: '${afterRef}'`, "Use server_audit with snapshot:true to create one");
      }
      const diff = diffAudits(beforeSnap.audit, afterSnap.audit, { before: beforeRef, after: afterRef });
      const format = params.format ?? "summary";
      if (format === "json") {
        return mcpSuccess(diff as unknown as Record<string, unknown>);
      }
      return mcpSuccess({ summary: formatDiffJson(diff), scoreDelta: diff.scoreDelta });
    }

    await mcpLog(mcpServer, `Starting 457-check audit on ${server.name}`);

    const platform = server.platform ?? server.mode ?? "bare";
    const result = await runAudit(server.ip, server.name, platform);

    if (!result.success || !result.data) {
      return mcpError(
        result.error ?? "Audit failed",
        result.hint,
      );
    }

    const auditResult = result.data;
    await mcpLog(mcpServer, `Audit complete, score: ${auditResult.overallScore}`);

    // Regression baseline — load before save so regression compares against previous state
    const baseline = loadBaseline(auditResult.serverIp);
    await saveBaseline(auditResult).catch(() => {});

    // Apply category/severity filter if provided
    let filteredResult = auditResult;
    if (params.category || params.severity) {
      const filter: AuditFilter = {};
      if (params.category) filter.category = params.category;
      if (params.severity) filter.severity = params.severity;
      filteredResult = filterAuditResult(auditResult, filter);
    }

    // Apply profile filter after category/severity filter
    if (params.profile !== undefined) {
      if (!isValidProfile(params.profile)) {
        return mcpError(
        `Invalid profile: ${params.profile}`,
        `Available profiles: ${listAllProfileNames().join(", ")}`,
        );
      }
      filteredResult = {
        ...filteredResult,
        categories: filteredResult.categories
          .map((cat) => ({
            ...cat,
            checks: filterChecksByProfile(cat.checks, params.profile!),
          }))
          .filter((cat) => cat.checks.length > 0),
      };
    }

    // Threshold check (uses unfiltered auditResult.overallScore)
    if (params.threshold !== undefined && auditResult.overallScore < params.threshold) {
      return mcpError(
        `Score ${auditResult.overallScore} is below threshold ${params.threshold}`,
        "Run server_fix to improve the score",
        [{ command: "server_fix { server: '" + server.name + "', dryRun: true }", reason: "Preview available fixes" }],
      );
    }

    const format = params.format ?? "summary";

    if (format === "json") {
      const jsonResult: Record<string, unknown> = { ...filteredResult };
      if (params.framework) {
        const fw = FRAMEWORK_KEY_MAP[params.framework];
        const detail = calculateComplianceDetail(filteredResult.categories);
        jsonResult.complianceDetail = detail.filter((d) => d.framework === fw);
      }
      if (baseline) {
        const regression = checkRegression(baseline, auditResult);
        jsonResult.baselineRegression = {
          regressions: regression.regressions,
          newPasses: regression.newPasses,
          baselineScore: regression.baselineScore,
          currentScore: regression.currentScore,
        };
      }
      return mcpSuccess(jsonResult, { largeResult: true });
    }

    if (format === "score") {
      return mcpSuccess({ score: auditResult.overallScore });
    }

    // summary format: compact text for AI consumption
    const categoryLines = filteredResult.categories.map(
      (c) => `  ${c.name}: ${c.score}/${c.maxScore}`,
    );

    const quickWinLines = filteredResult.quickWins.slice(0, 3).map(
      (qw) => `  - ${qw.description} (${qw.currentScore} -> ${qw.projectedScore})`,
    );

    const summaryParts = [
      `Server: ${filteredResult.serverName} (${filteredResult.serverIp})`,
      `Platform: ${filteredResult.platform}`,
      `Overall Score: ${auditResult.overallScore}/100`,
      "",
      "Categories:",
      ...categoryLines,
    ];

    if (quickWinLines.length > 0) {
      summaryParts.push("", "Top Quick Wins:", ...quickWinLines);
    }

    // Add compliance summary when framework param provided
    if (params.framework) {
      const fw = FRAMEWORK_KEY_MAP[params.framework];
      const detail = calculateComplianceDetail(filteredResult.categories);
      const fwScore = detail.find((d) => d.framework === fw);
      if (fwScore) {
        summaryParts.push(
          "",
          `Compliance (${fwScore.version}):`,
          `  Pass Rate: ${fwScore.passedControls}/${fwScore.totalControls} (${fwScore.passRate}%)`,
          `  Failing: ${fwScore.controls.filter((c) => !c.passed).length} controls`,
        );
      }
    }

    // Explain: append failing check details when explain param is set (summary format only)
    if (params.explain) {
      const failingChecks = filteredResult.categories
        .flatMap((c) => c.checks)
        .filter((ch) => !ch.passed && ch.explain);
      if (failingChecks.length > 0) {
        summaryParts.push("", "Failing Checks (with explanations):");
        const maxDisplay = 10;
        for (const ch of failingChecks.slice(0, maxDisplay)) {
          summaryParts.push(`  [${ch.severity}] ${ch.id}: ${ch.name}`);
          summaryParts.push(`    Why: ${ch.explain}`);
        }
        if (failingChecks.length > maxDisplay) {
          summaryParts.push(`  ... and ${failingChecks.length - maxDisplay} more failing checks`);
        }
      }
    }

    // Baseline regression info
    if (baseline) {
      const regression = checkRegression(baseline, auditResult);
      if (regression.regressions.length > 0) {
        summaryParts.push(
          "",
          `Regression: ${regression.regressions.length} check(s) regressed: ${regression.regressions.join(", ")}`,
        );
      }
      if (regression.newPasses.length > 0) {
        summaryParts.push(`New passes: ${regression.newPasses.length}: ${regression.newPasses.join(", ")}`);
      }
      summaryParts.push(`Best score: ${regression.baselineScore}`);
    }

    summaryParts.push(
      "",
      `Timestamp: ${filteredResult.timestamp}`,
    );

    const responseData: Record<string, unknown> = {
      summary: summaryParts.join("\n"),
      overallScore: auditResult.overallScore,
      suggested_actions: [
        { command: `server_audit { server: '${server.name}', format: 'json' }`, reason: "Get full audit details" },
      ],
    };

    if (filteredResult.skippedCategories && filteredResult.skippedCategories.length > 0) {
      responseData.skippedCategories = filteredResult.skippedCategories;
    }

    // Save snapshot if requested (uses unfiltered auditResult)
    if (params.snapshot !== undefined) {
      const snapshotName = typeof params.snapshot === "string" ? params.snapshot : undefined;
      await saveSnapshot(auditResult, snapshotName);
    }

    return mcpSuccess(responseData, { largeResult: true });
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}
