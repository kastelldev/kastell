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
      return mcpSuccess(diff as unknown as Record<string, unknown>);
    }

    const summary = buildCategorySummary(auditA, auditB, { before: serverA.name, after: serverB.name });
    return mcpSuccess(summary as unknown as Record<string, unknown>);
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}