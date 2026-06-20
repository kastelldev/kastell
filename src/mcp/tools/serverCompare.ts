import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { resolveAuditPair, buildCategorySummary, diffAuditsFlat } from "../../core/audit/diff.js";
import {
  mcpSuccess,
  mcpError,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";

export const serverCompareSchema = {
  serverA: z.string().describe("First server name or IP."),
  serverB: z.string().describe("Second server name or IP."),
  fresh: z.boolean().default(false).describe("Force live audit instead of using snapshots. Default: false."),
  detail: z.boolean().default(false).describe("Return check-level diff instead of category summary. Default: false."),
};

const serverCompareBaseFields = {
  serverA: z.string(),
  serverB: z.string(),
};

export const serverCompareOutputSchema = z.object({
  result: z.discriminatedUnion("format", [
    z.object({
      format: z.literal("category"),
      ...serverCompareBaseFields,
      categories: z.array(z.object({
        category: z.string(),
        scoreBefore: z.number(),
        scoreAfter: z.number(),
        delta: z.number(),
      })),
      overallA: z.number(),
      overallB: z.number(),
      overallDelta: z.number(),
    }),
    z.object({
      format: z.literal("check"),
      ...serverCompareBaseFields,
      // Public compatibility:
      // A_skip = after side is skipped
      // B_skip = before side is skipped
      checks: z.array(z.object({
        id: z.string(),
        name: z.string(),
        status: z.enum(["A_better", "B_better", "both_pass", "both_fail", "A_skip", "B_skip", "both_skip"]),
        before: z.enum(["passed", "failed", "skipped"]).nullable(),
        after: z.enum(["passed", "failed", "skipped"]).nullable(),
      })),
    }),
  ]),
});

export async function handleServerCompare(params: {
  serverA: string;
  serverB: string;
  fresh?: boolean;
  detail?: boolean;
}): Promise<McpResponse> {
  try {
    const servers = getServers();
    if (servers.length === 0) {
      return mcpError("No servers found", undefined, [
        { command: "kastell add", reason: "Add a server first" },
      ]);
    }

    const serverA = servers.find((s) => s.name === params.serverA || s.ip === params.serverA);
    const serverB = servers.find((s) => s.name === params.serverB || s.ip === params.serverB);

    if (!serverA) {
      return mcpError(
        `Server not found: ${params.serverA}`,
        `Available servers: ${servers.map((s) => s.name).join(", ")}`,
      );
    }
    if (!serverB) {
      return mcpError(
        `Server not found: ${params.serverB}`,
        `Available servers: ${servers.map((s) => s.name).join(", ")}`,
      );
    }

    if (serverA.name === serverB.name || serverA.ip === serverB.ip) {
      return mcpError(
        "Servers must be different",
        "Provide two different server names or IPs to compare",
      );
    }

    const pairResult = await resolveAuditPair(serverA, serverB, !!params.fresh);
    if (!pairResult.success) return mcpError(pairResult.error ?? "Compare failed");
    const { auditA, auditB } = pairResult.data!;

    if (params.detail) {
      const diff = diffAuditsFlat(auditA, auditB, { before: serverA.name, after: serverB.name });
      return mcpSuccess({
        format: "check" as const,
        serverA: serverA.name,
        serverB: serverB.name,
        checks: diff.checks,
      });
    }

    const summary = buildCategorySummary(auditA, auditB, { before: serverA.name, after: serverB.name });
    return mcpSuccess({
      format: "category" as const,
      serverA: serverA.name,
      serverB: serverB.name,
      categories: summary.categories,
      overallA: auditA.overallScore,
      overallB: auditB.overallScore,
      overallDelta: auditB.overallScore - auditA.overallScore,
    });
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}
