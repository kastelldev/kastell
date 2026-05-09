import { getServers } from "../../utils/config.js";
import { loadAuditHistory } from "../../core/audit/history.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

export function readServerList(): ReadResourceResult {
  const servers = getServers();
  const list = servers.map((s) => ({
    name: s.name,
    ip: s.ip,
    provider: s.provider,
    mode: s.mode,
  }));

  return {
    contents: [{
      uri: "kastell://servers",
      mimeType: "application/json",
      text: JSON.stringify({ servers: list, totalCount: list.length }),
    }],
  };
}

export function readServerAudit(serverName: string): ReadResourceResult {
  const servers = getServers();
  const server = servers.find((s) => s.name === serverName);

  if (!server) {
    return {
      contents: [{
        uri: `kastell://servers/${serverName}/audit`,
        mimeType: "application/json",
        text: JSON.stringify({ error: `Server not found: ${serverName}` }),
      }],
    };
  }

  const history = loadAuditHistory(server.ip);

  if (history.length === 0) {
    return {
      contents: [{
        uri: `kastell://servers/${serverName}/audit`,
        mimeType: "application/json",
        text: JSON.stringify({
          serverName,
          latestScore: null,
          message: "No audit run yet. Use server_audit to run a security scan.",
        }),
      }],
    };
  }

  const latest = history[history.length - 1];

  return {
    contents: [{
      uri: `kastell://servers/${serverName}/audit`,
      mimeType: "application/json",
      text: JSON.stringify({
        serverName,
        latestScore: latest.overallScore,
        latestTimestamp: latest.timestamp,
        categoryScores: latest.categoryScores,
        historyCount: history.length,
      }),
    }],
  };
}
