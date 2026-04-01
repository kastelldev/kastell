import { sshExec, isHostKeyMismatch } from "../utils/ssh.js";
import { raw } from "../utils/sshCommand.js";
import { isBareServer } from "../utils/modeGuard.js";
import { getAdapter, resolvePlatform } from "../adapters/factory.js";
import type { ServerRecord } from "../types/index.js";

export interface ServerHealthResult {
  server: ServerRecord;
  status: "healthy" | "unhealthy" | "unreachable" | "host-key-mismatch";
  responseTime: number;
}

export async function checkServerHealth(server: ServerRecord): Promise<ServerHealthResult> {
  const start = Date.now();

  if (isBareServer(server)) {
    try {
      const result = await sshExec(server.ip, raw("echo ok"));
      const responseTime = Date.now() - start;
      if (result.code === 0) {
        return { server, status: "healthy", responseTime };
      }
      if (isHostKeyMismatch(result.stderr)) {
        return { server, status: "host-key-mismatch", responseTime };
      }
      return { server, status: "unreachable", responseTime };
    } catch {
      const responseTime = Date.now() - start;
      return { server, status: "unreachable", responseTime };
    }
  }

  // Platform servers: use adapter health check
  try {
    const platform = resolvePlatform(server);
    if (!platform) {
      const responseTime = Date.now() - start;
      return { server, status: "unreachable", responseTime };
    }
    const adapter = getAdapter(platform);
    const healthResult = await adapter.healthCheck(server.ip, server.domain);
    const responseTime = Date.now() - start;
    const status = healthResult.status === "running" ? "healthy" : "unreachable";
    return { server, status, responseTime };
  } catch {
    const responseTime = Date.now() - start;
    return { server, status: "unreachable", responseTime };
  }
}
