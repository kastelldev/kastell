import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { resolveAuditPair, buildCategorySummary, diffAudits } from "../../core/audit/diff.js";
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

export const serverCompareOutputSchema = z.object({
  result: z.union([
    z.object({
      format: z.literal("category"),
      serverA: z.string(),
      serverB: z.string(),
      categories: z.array(z.object({
        name: z.string(),
        scoreA: z.number(),
        scoreB: z.number(),
        delta: z.number(),
      })),
      overallA: z.number(),
      overallB: z.number(),
      overallDelta: z.number(),
    }),
    z.object({
      format: z.literal("check"),
      serverA: z.string(),
      serverB: z.string(),
      checks: z.array(z.object({
        id: z.string(),
        name: z.string(),
        status: z.enum(["same", "A_better", "B_better", "both_fail", "both_pass"]),
        scoreA: z.number(),
        scoreB: z.number(),
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

    const pairResult = await resolveAuditPair(serverA, serverB, !!params.fresh);
    if (!pairResult.success) return mcpError(pairResult.error ?? "Compare failed");
    const { auditA, auditB } = pairResult.data!;

    if (params.detail) {
      const diff = diffAudits(auditA, auditB, { before: serverA.name, after: serverB.name });
      return mcpSuccess({
        format: "check" as const,
        serverA: serverA.name,
        serverB: serverB.name,
        checks: diff as unknown as Array<{id: string; name: string; status: "same" | "A_better" | "B_better" | "both_fail" | "both_pass"; scoreA: number; scoreB: number}>,
      });
    }

    const summary = buildCategorySummary(auditA, auditB, { before: serverA.name, after: serverB.name });
    return mcpSuccess({
      format: "category" as const,
      serverA: serverA.name,
      serverB: serverB.name,
      categories: summary as unknown as Array<{name: string; scoreA: number; scoreB: number; delta: number}>,
      overallA: auditA.overallScore,
      overallB: auditB.overallScore,
      overallDelta: auditB.overallScore - auditA.overallScore,
    });
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}