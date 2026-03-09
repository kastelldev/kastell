/**
 * Docker security check parser.
 * Parses docker info/ps output into 6 security checks (DCK-01 through DCK-06).
 * Platform-aware: Docker checks adjust for coolify/dokploy vs bare.
 */

import type { AuditCheck, CheckParser } from "../types.js";

/** Check if Docker is installed based on output */
function isDockerAvailable(output: string): boolean {
  if (!output || output.trim() === "N/A" || output.trim() === "") return false;
  // If output contains JSON-like docker info, Docker is available
  return output.includes("ServerVersion") || output.includes("docker");
}

function makeDockerSkippedChecks(severity: "info" | "warning"): AuditCheck[] {
  const message = "Docker not installed";
  const ids = [
    { id: "DCK-01", name: "No TCP Socket Exposed" },
    { id: "DCK-02", name: "No Privileged Containers" },
    { id: "DCK-03", name: "Docker Version Current" },
    { id: "DCK-04", name: "User Namespace Enabled" },
    { id: "DCK-05", name: "No Host Network Containers" },
    { id: "DCK-06", name: "Logging Driver Configured" },
  ];

  return ids.map((def) => ({
    id: def.id,
    category: "Docker",
    name: def.name,
    severity,
    passed: severity === "info", // info = skip (ok for bare), warning = fail (bad for platform)
    currentValue: message,
    expectedValue: "Docker installed and configured securely",
    fixCommand: "curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh && rm -f /tmp/get-docker.sh",
    explain: severity === "info"
      ? "Docker is not installed on this server. Checks skipped."
      : "Docker is expected on this platform but was not found.",
  }));
}

export const parseDockerChecks: CheckParser = (sectionOutput: string, platform: string): AuditCheck[] => {
  const isPlatform = platform === "coolify" || platform === "dokploy";

  if (!isDockerAvailable(sectionOutput)) {
    return makeDockerSkippedChecks(isPlatform ? "warning" : "info");
  }

  // Try to extract JSON docker info (full JSON object from `docker info --format '{{json .}}'`)
  let dockerInfo: { Hosts?: string[]; ServerVersion?: string; SecurityOptions?: string[]; LoggingDriver?: string } = {};
  try {
    const jsonStart = sectionOutput.indexOf("{");
    if (jsonStart !== -1) {
      // Find matching closing brace for the top-level object
      let depth = 0;
      let jsonEnd = -1;
      for (let i = jsonStart; i < sectionOutput.length; i++) {
        if (sectionOutput[i] === "{") depth++;
        else if (sectionOutput[i] === "}") { depth--; if (depth === 0) { jsonEnd = i; break; } }
      }
      if (jsonEnd !== -1) {
        dockerInfo = JSON.parse(sectionOutput.slice(jsonStart, jsonEnd + 1));
      }
    }
  } catch {
    // Continue with empty info
  }

  // DCK-01: No TCP socket exposed
  const hosts = dockerInfo.Hosts ?? [];
  const hasTcpSocket = hosts.some((h: string) => h.startsWith("tcp://"));
  const dck01: AuditCheck = {
    id: "DCK-01",
    category: "Docker",
    name: "No TCP Socket Exposed",
    severity: "critical",
    passed: !hasTcpSocket,
    currentValue: hasTcpSocket ? `TCP socket found: ${hosts.filter((h: string) => h.startsWith("tcp://")).join(", ")}` : "Unix socket only",
    expectedValue: "No TCP socket (unix:// only)",
    fixCommand: 'Edit /etc/docker/daemon.json to remove "hosts" TCP entries && systemctl restart docker',
    explain: "Exposing Docker daemon via TCP allows remote unauthenticated access to the host.",
  };

  // DCK-02: No privileged containers
  const hasPrivileged = /--privileged/i.test(sectionOutput) || /"Privileged":\s*true/i.test(sectionOutput);
  const dck02: AuditCheck = {
    id: "DCK-02",
    category: "Docker",
    name: "No Privileged Containers",
    severity: "critical",
    passed: !hasPrivileged,
    currentValue: hasPrivileged ? "Privileged container(s) detected" : "No privileged containers",
    expectedValue: "No privileged containers",
    fixCommand: "docker ps --format '{{.Names}}' | xargs -I{} docker inspect {} --format '{{.HostConfig.Privileged}}'",
    explain: "Privileged containers have full host access, defeating container isolation.",
  };

  // DCK-03: Docker version currency
  const version = dockerInfo.ServerVersion ?? "unknown";
  const versionMajor = parseInt(version.split(".")[0], 10);
  const isCurrentVersion = !isNaN(versionMajor) && versionMajor >= 24;
  const dck03: AuditCheck = {
    id: "DCK-03",
    category: "Docker",
    name: "Docker Version Current",
    severity: "warning",
    passed: isCurrentVersion,
    currentValue: `Docker ${version}`,
    expectedValue: "Docker 24.0+",
    fixCommand: "curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh && rm -f /tmp/get-docker.sh",
    explain: "Older Docker versions may have unpatched security vulnerabilities.",
  };

  // DCK-04: User namespace / rootless
  const securityOpts = dockerInfo.SecurityOptions ?? [];
  const hasUserns = securityOpts.some((opt: string) => opt.includes("userns")) ||
    sectionOutput.includes("userns-remap");
  const dck04: AuditCheck = {
    id: "DCK-04",
    category: "Docker",
    name: "User Namespace Enabled",
    severity: "warning",
    passed: hasUserns,
    currentValue: hasUserns ? "User namespace remapping enabled" : "User namespace not configured",
    expectedValue: "User namespace remapping or rootless mode",
    fixCommand: 'echo \'{"userns-remap":"default"}\' > /etc/docker/daemon.json && systemctl restart docker',
    explain: "User namespace remapping prevents container root from being host root.",
  };

  // DCK-05: No host network containers
  const hasHostNetwork = /--network\s*host/i.test(sectionOutput) || /"NetworkMode":\s*"host"/i.test(sectionOutput);
  const dck05: AuditCheck = {
    id: "DCK-05",
    category: "Docker",
    name: "No Host Network Containers",
    severity: "warning",
    passed: !hasHostNetwork,
    currentValue: hasHostNetwork ? "Host network container(s) detected" : "No host network containers",
    expectedValue: "No containers using host network",
    fixCommand: "Review containers using host network: docker ps --format '{{.Names}} {{.Networks}}'",
    explain: "Host network mode bypasses Docker network isolation.",
  };

  // DCK-06: Logging driver configured
  const loggingDriver = dockerInfo.LoggingDriver ?? "unknown";
  const hasLogging = loggingDriver !== "none" && loggingDriver !== "unknown";
  const dck06: AuditCheck = {
    id: "DCK-06",
    category: "Docker",
    name: "Logging Driver Configured",
    severity: "info",
    passed: hasLogging,
    currentValue: `Logging driver: ${loggingDriver}`,
    expectedValue: "Logging driver configured (not none)",
    fixCommand: 'echo \'{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}\' > /etc/docker/daemon.json && systemctl restart docker',
    explain: "Container logs are essential for incident investigation and monitoring.",
  };

  return [dck01, dck02, dck03, dck04, dck05, dck06];
};
