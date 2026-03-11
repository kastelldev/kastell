/**
 * MCP tool: server_evidence
 * Collects forensic evidence package from a server and returns the manifest.
 */

import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { collectEvidence } from "../../core/evidence.js";
import {
  resolveServerForMcp,
  mcpSuccess,
  mcpError,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage } from "../../utils/errorMapper.js";

export const serverEvidenceSchema = {
  server: z
    .string()
    .optional()
    .describe("Server name or IP. Auto-selected if only one server exists."),
  name: z
    .string()
    .optional()
    .describe("Label for the evidence directory (e.g. 'pre-incident')."),
  lines: z
    .number()
    .default(500)
    .describe("Number of log lines to collect per file (default: 500)."),
  no_docker: z
    .boolean()
    .default(false)
    .describe("Skip Docker data collection."),
  no_sysinfo: z
    .boolean()
    .default(false)
    .describe("Skip system information collection."),
};

export async function handleServerEvidence(params: {
  server?: string;
  name?: string;
  lines?: number;
  no_docker?: boolean;
  no_sysinfo?: boolean;
}): Promise<McpResponse> {
  try {
    const servers = getServers();
    if (servers.length === 0) {
      return mcpError("No servers found");
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
        "Multiple servers found. Specify which server to collect evidence from.",
        `Available: ${servers.map((s) => s.name).join(", ")}`,
      );
    }

    const platform = server.platform ?? server.mode ?? "bare";

    const result = await collectEvidence(server.name, server.ip, platform, {
      name: params.name,
      lines: params.lines ?? 500,
      noDocker: params.no_docker ?? false,
      noSysinfo: params.no_sysinfo ?? false,
      force: false,
      json: false,
      quiet: true,
    });

    if (!result.success || !result.data) {
      return mcpError(result.error ?? "Evidence collection failed");
    }

    const { evidenceDir, serverName, serverIp, totalFiles, skippedFiles, collectedAt, manifestPath } =
      result.data;

    return mcpSuccess({
      evidenceDir,
      serverName,
      serverIp,
      platform,
      collectedAt,
      totalFiles,
      skippedFiles,
      manifestPath,
    });
  } catch (error: unknown) {
    return mcpError(getErrorMessage(error));
  }
}
