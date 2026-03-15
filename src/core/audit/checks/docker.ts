/**
 * Docker security check parser.
 * Parses docker info/ps output into 6 security checks with semantic IDs.
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
    { id: "DCK-NO-TCP-SOCKET", name: "No TCP Socket Exposed" },
    { id: "DCK-NO-PRIVILEGED", name: "No Privileged Containers" },
    { id: "DCK-VERSION-CURRENT", name: "Docker Version Current" },
    { id: "DCK-USER-NAMESPACE", name: "User Namespace Enabled" },
    { id: "DCK-NO-HOST-NETWORK", name: "No Host Network Containers" },
    { id: "DCK-LOGGING-DRIVER", name: "Logging Driver Configured" },
    { id: "DCK-LIVE-RESTORE", name: "Live Restore Enabled" },
    { id: "DCK-NO-NEW-PRIVILEGES", name: "No New Privileges Default" },
    { id: "DCK-ICC-DISABLED", name: "Inter-Container Communication Disabled" },
    { id: "DCK-TLS-VERIFY", name: "TLS Verification Enabled" },
    { id: "DCK-SOCKET-PERMS", name: "Docker Socket Permissions" },
    { id: "DCK-NO-ROOT-CONTAINERS", name: "No Root Containers" },
    { id: "DCK-READ-ONLY-ROOTFS", name: "Read-Only Root Filesystem" },
    { id: "DCK-LOG-MAX-SIZE", name: "Log Max Size Configured" },
    { id: "DCK-DEFAULT-ULIMITS", name: "Default Ulimits Configured" },
    { id: "DCK-SECCOMP-ENABLED", name: "Seccomp Profile Applied" },
    { id: "DCK-CONTENT-TRUST", name: "Docker Content Trust Enabled" },
    { id: "DCK-NO-SENSITIVE-MOUNTS", name: "No Sensitive Mounts" },
    { id: "DCK-APPARMOR-PROFILE", name: "AppArmor Profile Applied" },
    { id: "DCK-NO-PRIVILEGED-PORTS", name: "No Privileged Port Bindings" },
    { id: "DCK-NETWORK-DISABLED", name: "Custom Network Configured" },
    { id: "DCK-LOG-DRIVER-CONFIGURED", name: "Log Driver Not None" },
    { id: "DCK-ROOTLESS-MODE", name: "Rootless Docker Mode" },
    { id: "DCK-NO-HOST-NETWORK-INSPECT", name: "No Host Network Mode (Inspect)" },
    { id: "DCK-HEALTH-CHECK", name: "Container Health Checks Configured" },
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
  let dockerInfo: { Hosts?: string[]; ServerVersion?: string; SecurityOptions?: string[]; LoggingDriver?: string; LiveRestoreEnabled?: boolean } = {};
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

  // DCK-NO-TCP-SOCKET: No TCP socket exposed
  const hosts = dockerInfo.Hosts ?? [];
  const hasTcpSocket = hosts.some((h: string) => h.startsWith("tcp://"));
  const dck01: AuditCheck = {
    id: "DCK-NO-TCP-SOCKET",
    category: "Docker",
    name: "No TCP Socket Exposed",
    severity: "critical",
    passed: !hasTcpSocket,
    currentValue: hasTcpSocket ? `TCP socket found: ${hosts.filter((h: string) => h.startsWith("tcp://")).join(", ")}` : "Unix socket only",
    expectedValue: "No TCP socket (unix:// only)",
    fixCommand: 'Edit /etc/docker/daemon.json to remove "hosts" TCP entries && systemctl restart docker',
    explain: "Exposing Docker daemon via TCP allows remote unauthenticated access to the host.",
  };

  // DCK-NO-PRIVILEGED: No privileged containers
  const hasPrivileged = /--privileged/i.test(sectionOutput) || /"Privileged":\s*true/i.test(sectionOutput);
  const dck02: AuditCheck = {
    id: "DCK-NO-PRIVILEGED",
    category: "Docker",
    name: "No Privileged Containers",
    severity: "critical",
    passed: !hasPrivileged,
    currentValue: hasPrivileged ? "Privileged container(s) detected" : "No privileged containers",
    expectedValue: "No privileged containers",
    fixCommand: "docker ps --format '{{.Names}}' | xargs -I{} docker inspect {} --format '{{.HostConfig.Privileged}}'",
    explain: "Privileged containers have full host access, defeating container isolation.",
  };

  // DCK-VERSION-CURRENT: Docker version currency
  const version = dockerInfo.ServerVersion ?? "unknown";
  const versionMajor = parseInt(version.split(".")[0], 10);
  const isCurrentVersion = !isNaN(versionMajor) && versionMajor >= 24;
  const dck03: AuditCheck = {
    id: "DCK-VERSION-CURRENT",
    category: "Docker",
    name: "Docker Version Current",
    severity: "warning",
    passed: isCurrentVersion,
    currentValue: `Docker ${version}`,
    expectedValue: "Docker 24.0+",
    fixCommand: "curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh && rm -f /tmp/get-docker.sh",
    explain: "Older Docker versions may have unpatched security vulnerabilities.",
  };

  // DCK-USER-NAMESPACE: User namespace / rootless
  const securityOpts = dockerInfo.SecurityOptions ?? [];
  const hasUserns = securityOpts.some((opt: string) => opt.includes("userns")) ||
    sectionOutput.includes("userns-remap");
  const dck04: AuditCheck = {
    id: "DCK-USER-NAMESPACE",
    category: "Docker",
    name: "User Namespace Enabled",
    severity: "warning",
    passed: hasUserns,
    currentValue: hasUserns ? "User namespace remapping enabled" : "User namespace not configured",
    expectedValue: "User namespace remapping or rootless mode",
    fixCommand: 'echo \'{"userns-remap":"default"}\' > /etc/docker/daemon.json && systemctl restart docker',
    explain: "User namespace remapping prevents container root from being host root.",
  };

  // DCK-NO-HOST-NETWORK: No host network containers
  const hasHostNetwork = /--network\s*host/i.test(sectionOutput) || /"NetworkMode":\s*"host"/i.test(sectionOutput);
  const dck05: AuditCheck = {
    id: "DCK-NO-HOST-NETWORK",
    category: "Docker",
    name: "No Host Network Containers",
    severity: "warning",
    passed: !hasHostNetwork,
    currentValue: hasHostNetwork ? "Host network container(s) detected" : "No host network containers",
    expectedValue: "No containers using host network",
    fixCommand: "Review containers using host network: docker ps --format '{{.Names}} {{.Networks}}'",
    explain: "Host network mode bypasses Docker network isolation.",
  };

  // DCK-LOGGING-DRIVER: Logging driver configured
  const loggingDriver = dockerInfo.LoggingDriver ?? "unknown";
  const hasLogging = loggingDriver !== "none" && loggingDriver !== "unknown";
  const dck06: AuditCheck = {
    id: "DCK-LOGGING-DRIVER",
    category: "Docker",
    name: "Logging Driver Configured",
    severity: "info",
    passed: hasLogging,
    currentValue: `Logging driver: ${loggingDriver}`,
    expectedValue: "Logging driver configured (not none)",
    fixCommand: 'echo \'{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}\' > /etc/docker/daemon.json && systemctl restart docker',
    explain: "Container logs are essential for incident investigation and monitoring.",
  };


  // Split lines once for all subsequent checks
  const allLines = sectionOutput.split("\n");

  // Parse daemon.json if present in output
  let daemonJson: Record<string, unknown> = {};
  try {
    for (const line of allLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{") && trimmed.includes(":") && trimmed !== "{}") {
        try { daemonJson = JSON.parse(trimmed); if (Object.keys(daemonJson).length > 0) break; } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  // Check for running containers (from docker inspect output in sectionOutput)
  const hasRunningContainers = sectionOutput.includes("SecurityOpt=") && !(/SecurityOpt=N\/A/.test(sectionOutput));
  const noContainersMsg = "No running containers";

  // DCK-07: live-restore enabled
  const liveRestoreEnabled = daemonJson["live-restore"] === true || dockerInfo.LiveRestoreEnabled === true;
  const dck07: AuditCheck = {
    id: "DCK-LIVE-RESTORE",
    category: "Docker",
    name: "Live Restore Enabled",
    severity: "warning",
    passed: liveRestoreEnabled,
    currentValue: liveRestoreEnabled ? "live-restore: true" : "live-restore not configured",
    expectedValue: "live-restore: true in daemon.json",
    fixCommand: "jq '. + {\"live-restore\":true}' /etc/docker/daemon.json > /tmp/d.json && mv /tmp/d.json /etc/docker/daemon.json && systemctl reload docker",
    explain: "Live restore keeps containers running during Docker daemon restarts, reducing service disruption.",
  };

  // DCK-08: no-new-privileges default
  const securityOpts2 = dockerInfo.SecurityOptions ?? [];
  const noNewPrivilegesDefault = securityOpts2.some((o: string) => o.includes("no-new-privileges")) ||
    (Array.isArray(daemonJson["default-security-opt"]) &&
      (daemonJson["default-security-opt"] as string[]).some((o) => o.includes("no-new-privileges")));
  const dck08: AuditCheck = {
    id: "DCK-NO-NEW-PRIVILEGES",
    category: "Docker",
    name: "No New Privileges Default",
    severity: "warning",
    passed: noNewPrivilegesDefault,
    currentValue: noNewPrivilegesDefault ? "no-new-privileges configured" : "no-new-privileges not set as default",
    expectedValue: "no-new-privileges in SecurityOptions or default-security-opt",
    fixCommand: "jq '. + {\"default-security-opt\":[\"no-new-privileges\"]}' /etc/docker/daemon.json > /tmp/d.json && mv /tmp/d.json /etc/docker/daemon.json && systemctl restart docker",
    explain: "Preventing privilege escalation by default stops containers from gaining elevated host privileges.",
  };

  // DCK-09: ICC disabled
  const iccDisabled = daemonJson["icc"] === false ||
    sectionOutput.includes('"BridgeNfIcc":false') ||
    sectionOutput.includes('"BridgeNfIcc": false');
  const dck09: AuditCheck = {
    id: "DCK-ICC-DISABLED",
    category: "Docker",
    name: "Inter-Container Communication Disabled",
    severity: "warning",
    passed: iccDisabled,
    currentValue: iccDisabled ? "ICC disabled" : "ICC not disabled (containers can communicate freely)",
    expectedValue: "icc: false in daemon.json",
    fixCommand: "jq '. + {\"icc\":false}' /etc/docker/daemon.json > /tmp/d.json && mv /tmp/d.json /etc/docker/daemon.json && systemctl restart docker",
    explain: "Disabling ICC enforces network isolation between containers, limiting lateral movement if one is compromised.",
  };

  // DCK-10: TLS verify (critical if TCP socket exposed)
  const tcpHosts = hosts.filter((h: string) => h.startsWith("tcp://"));
  const hasTcpExposed = tcpHosts.length > 0;
  const tlsVerifyEnabled = sectionOutput.includes('"tls":true') || sectionOutput.includes('"tlsverify":true');
  const dck10: AuditCheck = {
    id: "DCK-TLS-VERIFY",
    category: "Docker",
    name: "TLS Verification Enabled",
    severity: "critical",
    passed: !hasTcpExposed || tlsVerifyEnabled,
    currentValue: hasTcpExposed
      ? (tlsVerifyEnabled ? "TLS verify enabled on TCP socket" : "TCP socket exposed without TLS verification")
      : "No TCP socket exposed",
    expectedValue: "No TCP socket, or TLS verification enabled",
    fixCommand: 'Edit /etc/docker/daemon.json: add "tls":true,"tlsverify":true with cert paths && systemctl restart docker',
    explain: "Docker TCP socket without TLS allows unauthenticated remote access with full host control.",
  };

  // DCK-11: docker.sock permissions are 660 root:docker
  const sockStatLine = allLines.find((l) => /^\d{3}\s+\w+\s+\w+/.test(l.trim())) ?? "";
  const sockPermOk = /^660\s+root\s+docker/.test(sockStatLine.trim());
  const dck11: AuditCheck = {
    id: "DCK-SOCKET-PERMS",
    category: "Docker",
    name: "Docker Socket Permissions",
    severity: "warning",
    passed: sockPermOk,
    currentValue: sockStatLine.trim() || "Socket stat not available",
    expectedValue: "660 root docker",
    fixCommand: "chown root:docker /var/run/docker.sock && chmod 660 /var/run/docker.sock",
    explain: "Incorrect docker.sock permissions may allow unauthorized users to control Docker.",
  };

  // DCK-12: No root containers
  const containerUserLines = allLines.filter((l) => l.includes("User="));
  const hasRootContainers = hasRunningContainers &&
    containerUserLines.some((l) => /User=$/.test(l.trim()) || /User=""/.test(l));
  const dck12: AuditCheck = {
    id: "DCK-NO-ROOT-CONTAINERS",
    category: "Docker",
    name: "No Root Containers",
    severity: "warning",
    passed: !hasRunningContainers || !hasRootContainers,
    currentValue: !hasRunningContainers
      ? noContainersMsg
      : hasRootContainers
        ? "Container(s) running as root (empty User field)"
        : "Containers running as non-root",
    expectedValue: "No running containers using root user",
    fixCommand: "Add USER <non-root-user> to your Dockerfile",
    explain: "Containers running as root can escalate to host root if container isolation breaks.",
  };

  // DCK-13: Read-only root filesystem
  const readonlyLines = allLines.filter((l) => l.includes("ReadonlyRootfs="));
  const allReadOnly = hasRunningContainers && readonlyLines.length > 0 &&
    readonlyLines.every((l) => l.includes("ReadonlyRootfs=true"));
  const dck13: AuditCheck = {
    id: "DCK-READ-ONLY-ROOTFS",
    category: "Docker",
    name: "Read-Only Root Filesystem",
    severity: "info",
    passed: !hasRunningContainers || allReadOnly,
    currentValue: !hasRunningContainers
      ? noContainersMsg
      : allReadOnly
        ? "Containers use read-only root filesystem"
        : "Some containers have writable root filesystem",
    expectedValue: "Containers using read-only root filesystem",
    fixCommand: "docker run --read-only ... (or in compose: read_only: true)",
    explain: "Read-only root filesystem prevents attackers from writing malicious files to container storage.",
  };

  // DCK-14: Log max-size configured
  const logOpts = daemonJson["log-opts"];
  const logMaxSize = sectionOutput.includes("max-size") ||
    (typeof logOpts === "object" && logOpts !== null && "max-size" in (logOpts as Record<string, unknown>));
  const dck14: AuditCheck = {
    id: "DCK-LOG-MAX-SIZE",
    category: "Docker",
    name: "Log Max Size Configured",
    severity: "info",
    passed: logMaxSize,
    currentValue: logMaxSize ? "log max-size configured" : "No log max-size configured",
    expectedValue: "log-opts max-size set to prevent disk exhaustion",
    fixCommand: "jq '. + {\"log-driver\":\"json-file\",\"log-opts\":{\"max-size\":\"10m\",\"max-file\":\"3\"}}' /etc/docker/daemon.json > /tmp/d.json && mv /tmp/d.json /etc/docker/daemon.json && systemctl restart docker",
    explain: "Unbounded container logs can fill disk space and cause denial of service.",
  };

  // DCK-15: Default ulimits configured
  const hasDefaultUlimits = "default-ulimits" in daemonJson;
  const dck15: AuditCheck = {
    id: "DCK-DEFAULT-ULIMITS",
    category: "Docker",
    name: "Default Ulimits Configured",
    severity: "info",
    passed: hasDefaultUlimits,
    currentValue: hasDefaultUlimits ? "default-ulimits configured" : "No default ulimits in daemon.json",
    expectedValue: "default-ulimits set in daemon.json",
    fixCommand: "jq '. + {\"default-ulimits\":{\"nofile\":{\"Name\":\"nofile\",\"Hard\":64000,\"Soft\":64000}}}' /etc/docker/daemon.json > /tmp/d.json && mv /tmp/d.json /etc/docker/daemon.json && systemctl restart docker",
    explain: "Default ulimits protect the host from container resource exhaustion attacks.",
  };

  // DCK-16: seccomp profile applied
  const seccompLines = allLines.filter((l) => l.includes("SecurityOpt="));
  const hasSeccomp = !hasRunningContainers ||
    (seccompLines.length > 0 && seccompLines.some((l) => l.includes("seccomp")));
  const dck16: AuditCheck = {
    id: "DCK-SECCOMP-ENABLED",
    category: "Docker",
    name: "Seccomp Profile Applied",
    severity: "warning",
    passed: !hasRunningContainers || hasSeccomp,
    currentValue: !hasRunningContainers
      ? noContainersMsg
      : hasSeccomp
        ? "seccomp profile applied"
        : "No seccomp profile in container SecurityOpt",
    expectedValue: "seccomp profile applied to running containers",
    fixCommand: "docker run --security-opt seccomp=/etc/docker/seccomp-profile.json ...",
    explain: "seccomp profiles restrict system calls available to containers, reducing the attack surface.",
  };

  // DCK-17: Docker content trust
  const contentTrustEnabled = sectionOutput.includes("DOCKER_CONTENT_TRUST=1");
  const dck17: AuditCheck = {
    id: "DCK-CONTENT-TRUST",
    category: "Docker",
    name: "Docker Content Trust Enabled",
    severity: "info",
    passed: contentTrustEnabled,
    currentValue: contentTrustEnabled ? "DOCKER_CONTENT_TRUST=1" : "Content trust not enabled",
    expectedValue: "DOCKER_CONTENT_TRUST=1 environment variable set",
    fixCommand: "export DOCKER_CONTENT_TRUST=1 (add to /etc/environment or shell profile)",
    explain: "Content trust ensures only signed images are pulled, preventing supply chain attacks.",
  };

  // DCK-18: No sensitive mounts (checks Privileged=true in inspect output)
  const privilegedInspectLines = allLines.filter((l) => l.includes("Privileged="));
  const hasPrivilegedFromInspect = hasRunningContainers &&
    privilegedInspectLines.some((l) => l.includes("Privileged=true"));
  const dck18: AuditCheck = {
    id: "DCK-NO-SENSITIVE-MOUNTS",
    category: "Docker",
    name: "No Sensitive Mounts",
    severity: "warning",
    passed: !hasRunningContainers || !hasPrivilegedFromInspect,
    currentValue: !hasRunningContainers
      ? noContainersMsg
      : hasPrivilegedFromInspect
        ? "Container(s) with Privileged=true (sensitive host mounts possible)"
        : "No privileged containers detected",
    expectedValue: "No containers with Privileged=true",
    fixCommand: "Remove --privileged flag from container run configuration",
    explain: "Privileged containers have access to all host devices and can mount sensitive filesystems.",
  };

  // DCK-19: AppArmor profile applied
  const hasApparmor = !hasRunningContainers ||
    (seccompLines.length > 0 && seccompLines.some((l) => l.includes("apparmor")));
  const dck19: AuditCheck = {
    id: "DCK-APPARMOR-PROFILE",
    category: "Docker",
    name: "AppArmor Profile Applied",
    severity: "warning",
    passed: !hasRunningContainers || hasApparmor,
    currentValue: !hasRunningContainers
      ? noContainersMsg
      : hasApparmor
        ? "AppArmor profile applied"
        : "No AppArmor profile in container SecurityOpt",
    expectedValue: "AppArmor profile applied to running containers",
    fixCommand: "docker run --security-opt apparmor=docker-default ...",
    explain: "AppArmor profiles restrict container file system access and capabilities via MAC enforcement.",
  };

  // DCK-20: No privileged port bindings (informational)
  const privilegedPorts = allLines
    .filter((l) => /0\.0\.0\.0:\d+->/.test(l))
    .flatMap((l) => {
      const matches = l.match(/0\.0\.0\.0:(\d+)->/g) ?? [];
      return matches.map((m) => parseInt(m.replace("0.0.0.0:", "").replace("->", ""), 10));
    })
    .filter((p) => !isNaN(p) && p < 1024 && p !== 80 && p !== 443);
  const dck20: AuditCheck = {
    id: "DCK-NO-PRIVILEGED-PORTS",
    category: "Docker",
    name: "No Privileged Port Bindings",
    severity: "info",
    passed: !hasRunningContainers || privilegedPorts.length === 0,
    currentValue: !hasRunningContainers
      ? noContainersMsg
      : privilegedPorts.length === 0
        ? "No privileged port bindings"
        : `Containers binding privileged ports: ${privilegedPorts.join(", ")}`,
    expectedValue: "No containers binding ports < 1024 (except 80/443)",
    fixCommand: "Use ports >= 1024 and configure a reverse proxy for standard ports",
    explain: "Containers binding privileged ports may require extra capabilities, increasing attack surface.",
  };


  // DCK-21: Custom Docker network configured (not only defaults)
  // Parse docker network ls output: "bridge bridge", "host host", "none null" are defaults
  const dockerNetworkLines = sectionOutput.split("\n").filter((l) => {
    const trimmed = l.trim();
    return trimmed.length > 0 && /\S+\s+\S+/.test(trimmed);
  });
  const defaultNetworks = new Set(["bridge bridge", "host host", "none null"]);
  const hasCustomNetwork = dockerNetworkLines.some((l) => {
    const norm = l.trim().replace(/\s+/g, " ");
    return !defaultNetworks.has(norm) && !l.includes("NETWORK") && !l.includes("NAME");
  });
  const dck21: AuditCheck = {
    id: "DCK-NETWORK-DISABLED",
    category: "Docker",
    name: "Custom Docker Network Configured",
    severity: "info",
    passed: !isDockerAvailable(sectionOutput) ? true : hasCustomNetwork,
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : hasCustomNetwork
        ? "Custom user-defined network(s) found"
        : "Only default networks (bridge/host/none) detected",
    expectedValue: "At least one user-defined network configured",
    fixCommand: "docker network create app-network  # Create a user-defined network for containers",
    explain:
      "Default bridge network provides no isolation between containers; user-defined networks enable proper segmentation.",
  };

  // DCK-22: Log driver not 'none'
  const dck22LogDriver = dockerInfo.LoggingDriver ?? "unknown";
  const dck22: AuditCheck = {
    id: "DCK-LOG-DRIVER-CONFIGURED",
    category: "Docker",
    name: "Logging Driver Not None",
    severity: "warning",
    passed: !isDockerAvailable(sectionOutput) ? true : dck22LogDriver !== "none",
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : `Logging driver: ${dck22LogDriver}`,
    expectedValue: "LoggingDriver is not 'none'",
    fixCommand: "jq '. + {\"log-driver\":\"json-file\"}' /etc/docker/daemon.json > /tmp/d.json && mv /tmp/d.json /etc/docker/daemon.json && systemctl restart docker",
    explain:
      "Disabling container logging prevents forensic analysis and audit trail of container activity.",
  };

  // DCK-23: Rootless mode
  const dck23SecOpts = dockerInfo.SecurityOptions ?? [];
  const isRootless = dck23SecOpts.some((o: string) => o.toLowerCase().includes("rootless"));
  const dck23: AuditCheck = {
    id: "DCK-ROOTLESS-MODE",
    category: "Docker",
    name: "Docker Rootless Mode",
    severity: "info",
    passed: !isDockerAvailable(sectionOutput) ? true : isRootless,
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : isRootless
        ? "Rootless Docker mode detected"
        : "Docker running as root daemon",
    expectedValue: "Rootless Docker mode (optional enhancement)",
    fixCommand: "# See: https://docs.docker.com/engine/security/rootless/ — dockerd-rootless-setuptool.sh install",
    explain:
      "Rootless Docker eliminates the daemon running as root, significantly reducing the blast radius of container escapes.",
  };

  // DCK-24: No containers using host network mode (inspect JSON path)
  const hasHostNetworkMode = /"NetworkMode":\s*"host"/i.test(sectionOutput);
  const dck24: AuditCheck = {
    id: "DCK-NO-HOST-NETWORK-INSPECT",
    category: "Docker",
    name: "No Host Network Mode (Inspect)",
    severity: "warning",
    passed: !isDockerAvailable(sectionOutput) ? true : !hasRunningContainers || !hasHostNetworkMode,
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : !hasRunningContainers
        ? "No running containers"
        : hasHostNetworkMode
          ? "Container(s) using host network mode detected"
          : "No containers using host network mode",
    expectedValue: "No running containers with NetworkMode=host",
    fixCommand: "Review containers: docker ps --format '{{.Names}} {{.Networks}}'",
    explain:
      "Host network mode bypasses Docker network isolation, exposing all host ports to the container.",
  };

  // DCK-25: Container health checks
  const healthCheckLines = allLines.filter((l) => l.includes("Health") || l.includes("healthy") || l.includes("unhealthy"));
  const hasHealthChecks = !hasRunningContainers || healthCheckLines.length > 0;
  const dck25: AuditCheck = {
    id: "DCK-HEALTH-CHECK",
    category: "Docker",
    name: "Container Health Checks Configured",
    severity: "info",
    passed: !isDockerAvailable(sectionOutput) ? true : !hasRunningContainers || hasHealthChecks,
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : !hasRunningContainers
        ? "No running containers"
        : hasHealthChecks
          ? "Health check configuration detected"
          : "No health checks found in running containers",
    expectedValue: "Running containers have HEALTHCHECK defined",
    fixCommand: "# Add HEALTHCHECK to Dockerfile: HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost/ || exit 1",
    explain:
      "Health checks enable automatic container restart on failure, improving service availability and security posture.",
  };

  return [dck01, dck02, dck03, dck04, dck05, dck06, dck07, dck08, dck09, dck10, dck11, dck12, dck13, dck14, dck15, dck16, dck17, dck18, dck19, dck20, dck21, dck22, dck23, dck24, dck25];
};
