import { sshExec } from "../utils/ssh.js";
import { getErrorMessage, mapSshError, sanitizeStderr } from "../utils/errorMapper.js";

export type LogService = "coolify" | "dokploy" | "docker" | "system";

export interface SystemMetrics {
  cpu: string;
  ramUsed: string;
  ramTotal: string;
  diskUsed: string;
  diskTotal: string;
  diskPercent: string;
}

export interface LogResult {
  logs: string;
  service: LogService;
  lines: number;
  error?: string;
  hint?: string;
}

export interface MetricsResult {
  metrics: SystemMetrics;
  containers?: string;
  error?: string;
  hint?: string;
}

const EMPTY_METRICS: SystemMetrics = {
  cpu: "N/A",
  ramUsed: "N/A",
  ramTotal: "N/A",
  diskUsed: "N/A",
  diskTotal: "N/A",
  diskPercent: "N/A",
};

export function buildLogCommand(service: LogService, lines: number, follow: boolean = false): string {
  const safeLines = Math.max(1, Math.min(500, Math.floor(lines)));
  switch (service) {
    case "coolify":
      return `docker logs coolify --tail ${safeLines}${follow ? " --follow" : ""}`;
    case "dokploy":
      return `docker service logs dokploy_dokploy --tail ${safeLines}${follow ? " --follow" : ""}`;
    case "docker":
      return `journalctl -u docker --no-pager -n ${safeLines}${follow ? " -f" : ""}`;
    case "system":
      return `journalctl --no-pager -n ${safeLines}${follow ? " -f" : ""}`;
  }
}

export function buildMonitorCommand(includeContainers: boolean): string {
  let command =
    "LANG=C LC_ALL=C top -bn1 | head -5 && echo '---SEPARATOR---' && LANG=C LC_ALL=C free -h && echo '---SEPARATOR---' && LANG=C LC_ALL=C df -h --total | grep -E '(Filesystem|total)'";
  if (includeContainers) {
    command +=
      " && echo '---SEPARATOR---' && (docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo 'Docker not installed')";
  }
  return command;
}

export function parseMetrics(stdout: string): SystemMetrics {
  const lines = stdout.split("\n");

  let cpu = "N/A";
  for (const line of lines) {
    if (line.includes("Cpu") || line.includes("cpu")) {
      const idleMatch = line.match(/([\d.]+)\s*(?:%?\s*)?id/);
      if (idleMatch) {
        const idle = parseFloat(idleMatch[1]);
        cpu = `${(100 - idle).toFixed(1)}%`;
      }
      break;
    }
  }

  let ramUsed = "N/A";
  let ramTotal = "N/A";
  for (const line of lines) {
    if (line.startsWith("Mem:")) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        ramTotal = parts[1];
        ramUsed = parts[2];
      }
      break;
    }
  }

  let diskUsed = "N/A";
  let diskTotal = "N/A";
  let diskPercent = "N/A";
  for (const line of lines) {
    if (line.startsWith("total") || line.includes("/dev/")) {
      const parts = line.split(/\s+/);
      if (parts.length >= 5) {
        diskTotal = parts[1];
        diskUsed = parts[2];
        diskPercent = parts[4];
      }
      if (line.startsWith("total")) break;
    }
  }

  return { cpu, ramUsed, ramTotal, diskUsed, diskTotal, diskPercent };
}

export async function fetchServerLogs(
  ip: string,
  service: LogService,
  lines: number,
): Promise<LogResult> {
  try {
    const command = buildLogCommand(service, lines, false);
    const result = await sshExec(ip, command);

    if (result.code !== 0) {
      const hint = mapSshError(new Error(result.stderr || "SSH command failed"), ip);
      return {
        logs: result.stdout || "",
        service,
        lines,
        error: sanitizeStderr(result.stderr) || `Exit code ${result.code}`,
        ...(hint ? { hint } : {}),
      };
    }

    return { logs: result.stdout, service, lines };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      logs: "",
      service,
      lines,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

export async function fetchServerMetrics(
  ip: string,
  includeContainers: boolean,
): Promise<MetricsResult> {
  try {
    const command = buildMonitorCommand(includeContainers);
    const result = await sshExec(ip, command);

    if (result.code !== 0) {
      const hint = mapSshError(new Error(result.stderr || "SSH command failed"), ip);
      return {
        metrics: { ...EMPTY_METRICS },
        error: sanitizeStderr(result.stderr) || `Exit code ${result.code}`,
        ...(hint ? { hint } : {}),
      };
    }

    const metrics = parseMetrics(result.stdout);

    let containers: string | undefined;
    if (includeContainers) {
      const sections = result.stdout.split("---SEPARATOR---");
      if (sections.length >= 4) {
        containers = sections[3].trim();
      }
    }

    return { metrics, ...(containers ? { containers } : {}) };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      metrics: { ...EMPTY_METRICS },
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}
