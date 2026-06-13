import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { runAudit } from "../../core/audit/index.js";
import { filterAuditResult } from "../../core/audit/filter.js";
import { resolveSnapshotRef, diffAudits, formatDiffJson } from "../../core/audit/diff.js";
import { saveSnapshot } from "../../core/audit/snapshot.js";
import type { AuditFilter } from "../../core/audit/filter.js";
import type { Severity } from "../../types/severity.js";
import { isFailedCheck } from "../../core/audit/types.js";
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
import { saveBaselineSafe, loadBaseline, checkRegression, formatRegressionSummary, extractPassedCheckIds, shouldUpdateBaseline } from "../../core/audit/regression.js";
import { AuditCategorySchema, AuditCheckSchema, ComplianceControlSchema } from "../schemas/index.js";
import type { AuditCategory } from "../schemas/audit.js";

const auditSummarySchema = z.object({
  format: z.literal("summary"),
  server: z.string(),
  ip: z.string(),
  overallScore: z.number(),
  skippedCategories: z.array(z.string()).optional(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })).optional(),
});

const auditJsonSchema = z.object({
  format: z.literal("json"),
  server: z.string(),
  ip: z.string(),
  overallScore: z.number(),
  categories: z.array(AuditCategorySchema),
  checks: z.array(AuditCheckSchema).optional(),
  quickWins: z.array(z.object({
    id: z.string(),
    severity: z.enum(["critical", "warning", "info"]),
    commands: z.array(z.string()),
    currentScore: z.number(),
    projectedScore: z.number(),
    description: z.string(),
  })).optional(),
  complianceDetail: z.array(z.object({
    framework: z.string(),
    passedControls: z.number(),
    totalControls: z.number(),
    passRate: z.number(),
    controls: z.array(ComplianceControlSchema),
  })).optional(),
  skippedCategories: z.array(z.string()).optional(),
  baselineRegression: z.record(z.string(), z.unknown()).optional(),
});

const auditScoreSchema = z.object({
  format: z.literal("score"),
  server: z.string(),
  ip: z.string(),
  overallScore: z.number(),
});

// Schema exported for MCP output typing
export const serverAuditOutputSchema = z.object({
  result: z.discriminatedUnion("format", [
    auditSummarySchema,
    auditJsonSchema,
    auditScoreSchema,
  ]),
});

export type ServerAuditOutput = z.infer<typeof serverAuditOutputSchema>;


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
  severity?: Severity;
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

    const baseline = loadBaseline(auditResult.serverIp);
    const passedIds = extractPassedCheckIds(auditResult);
    const regression = baseline ? checkRegression(baseline, auditResult, passedIds) : null;

    if (shouldUpdateBaseline(regression, false)) {
      await saveBaselineSafe(auditResult, baseline, passedIds);
    }

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
      if (regression) {
        jsonResult.baselineRegression = regression;
      }
      const data = {
        format: "json" as const,
        server: auditResult.serverName,
        ip: auditResult.serverIp,
        overallScore: auditResult.overallScore,
        categories: filteredResult.categories as unknown as AuditCategory[],
        quickWins: filteredResult.quickWins,
        complianceDetail: jsonResult.complianceDetail,
        skippedCategories: filteredResult.skippedCategories,
        baselineRegression: jsonResult.baselineRegression,
      };
      return mcpSuccess(data, { largeResult: true });
    }

    if (format === "score") {
      const data = {
        format: "score" as const,
        server: auditResult.serverName,
        ip: auditResult.serverIp,
        overallScore: auditResult.overallScore,
      };
      return mcpSuccess(data);
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
        .filter((ch) => isFailedCheck(ch) && ch.explain);
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
    if (regression) {
      const regressionLines = formatRegressionSummary(regression);
      summaryParts.push("", ...regressionLines.map(l => l.text));
    }

    summaryParts.push(
      "",
      `Timestamp: ${filteredResult.timestamp}`,
    );

    const responseData = {
      format: "summary" as const,
      server: auditResult.serverName,
      ip: auditResult.serverIp,
      overallScore: auditResult.overallScore,
      summary: summaryParts.join("\n"),
      suggested_actions: [
        { command: `server_audit { server: '${server.name}', format: 'json' }`, reason: "Get full audit details" },
      ],
      skippedCategories: filteredResult.skippedCategories,
    };

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
