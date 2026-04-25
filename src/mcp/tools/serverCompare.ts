import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { runAudit } from "../../core/audit/index.js";
import { resolveSnapshotRef, buildCategorySummary, diffAudits } from "../../core/audit/diff.js";
import { assertValidIp } from "../../utils/ssh.js";
import type { AuditResult } from "../../core/audit/types.js";
import type { KastellResult } from "../../types/index.js";
import {
  mcpSuccess,
  mcpError,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage } from "../../utils/errorMapper.js";

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

    let auditA: AuditResult;
    let auditB: AuditResult;

    if (params.fresh) {
      assertValidIp(serverA.ip);
      assertValidIp(serverB.ip);
      const [resultA, resultB] = await Promise.all([
        runAudit(serverA.ip, serverA.name, serverA.mode ?? "bare"),
        runAudit(serverB.ip, serverB.name, serverB.mode ?? "bare"),
      ]);
      if (!resultA.success) return mcpError(`Audit failed for ${serverA.name}: ${resultA.error}`);
      if (!resultB.success) return mcpError(`Audit failed for ${serverB.name}: ${resultB.error}`);
      auditA = resultA.data!;
      auditB = resultB.data!;
    } else {
      const snapA = await resolveSnapshotRef(serverA.ip, "latest");
      const snapB = await resolveSnapshotRef(serverB.ip, "latest");

      if (snapA && snapB) {
        auditA = snapA.audit;
        auditB = snapB.audit;
      } else {
        const needLiveA = !snapA;
        const needLiveB = !snapB;

        if (needLiveA) assertValidIp(serverA.ip);
        if (needLiveB) assertValidIp(serverB.ip);

        const livePromises: Promise<KastellResult<AuditResult>>[] = [];
        if (needLiveA) livePromises.push(runAudit(serverA.ip, serverA.name, serverA.mode ?? "bare"));
        if (needLiveB) livePromises.push(runAudit(serverB.ip, serverB.name, serverB.mode ?? "bare"));

        const liveResults = await Promise.all(livePromises);

        let liveIdx = 0;
        if (needLiveA) {
          const res = liveResults[liveIdx++];
          if (!res.success) return mcpError(`Audit failed for ${serverA.name}: ${res.error}`);
          auditA = res.data!;
        } else {
          auditA = snapA!.audit;
        }
        if (needLiveB) {
          const res = liveResults[liveIdx];
          if (!res.success) return mcpError(`Audit failed for ${serverB.name}: ${res.error}`);
          auditB = res.data!;
        } else {
          auditB = snapB!.audit;
        }
      }
    }

    if (params.detail) {
      const diff = diffAudits(auditA, auditB, { before: serverA.name, after: serverB.name });
      return mcpSuccess(diff as unknown as Record<string, unknown>);
    }

    const summary = buildCategorySummary(auditA, auditB, { before: serverA.name, after: serverB.name });
    return mcpSuccess(summary as unknown as Record<string, unknown>);
  } catch (error: unknown) {
    return mcpError(getErrorMessage(error));
  }
}