/**
 * Docker security check parser.
 * Parses docker info/ps output into 6 security checks with semantic IDs.
 * Platform-aware: Docker checks adjust for coolify/dokploy vs bare.
 */

import type { AuditCheck, CheckParser } from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

/** Check if Docker is installed based on output */
function isDockerAvailable(output: string): boolean {
  if (!output || output.trim() === "N/A" || output.trim() === "") return false;
  // If output contains JSON-like docker info, Docker is available
  return output.includes("ServerVersion") || output.includes("docker");
}

/**
 * Per-check forbiddenReason for Docker checks (P142 Task 10).
 * Centralized to avoid duplicating the reason text across 32 checks.
 * Each reason describes the specific risk class for its check.
 */
const DOCKER_FORBIDDEN_REASONS: Record<string, string> = {
  DCK_NO_TCP_SOCKET: "Editing daemon.json and restarting docker restarts all running containers — manual workload scheduling required to avoid outage.",
  DCK_NO_PRIVILEGED: "Removing --privileged from running containers destroys container state — manual container redeployment needed.",
  DCK_VERSION_CURRENT: "Upgrading Docker engine restarts all containers; major version bumps may break running platform workloads — manual upgrade window required.",
  DCK_USER_NAMESPACE: "Enabling userns-remap changes UID mapping for all containers; existing volume permissions become invalid and require manual remount.",
  DCK_NO_HOST_NETWORK: "Removing host network mode from running containers breaks services that depend on host interfaces — manual service topology review required.",
  DCK_LOGGING_DRIVER: "Changing log driver requires daemon.json edit + docker restart; all containers lose log output during the restart — manual scheduling required.",
  DCK_LIVE_RESTORE: "Editing live-restore setting in daemon.json and restarting docker disrupts running containers — manual restart window required.",
  DCK_NO_NEW_PRIVILEGES: "Setting no-new-privileges default affects all subsequently created containers; existing containers retain old defaults — manual migration needed.",
  DCK_ICC_DISABLED: "Disabling inter-container communication in daemon.json + restart breaks multi-container apps that rely on docker network — manual service map review.",
  DCK_TLS_VERIFY: "Enabling TLS verify on Docker daemon regenerates certificates; existing clients/scripts must be reconfigured — manual client cert distribution.",
  DCK_SOCKET_PERMS: "Chmod on docker socket changes who can talk to the daemon; CI/CD scripts that use docker.sock may break — manual permission audit needed.",
  DCK_NO_ROOT_CONTAINERS: "Recreating containers as non-root requires image updates; running containers with file permissions tuned for root fail — manual image rebuild required.",
  DCK_READ_ONLY_ROOTFS: "Setting read-only root FS breaks containers that write to /tmp or app dirs; many images assume writable root — manual image audit needed.",
  DCK_LOG_MAX_SIZE: "Adding log size limits to daemon.json may silently truncate active container logs; incidents investigated mid-rotation may lose evidence.",
  DCK_DEFAULT_ULIMITS: "Setting default ulimits affects all containers; services tuned to system defaults may exhaust resources — manual resource budget review.",
  DCK_SECCOMP_ENABLED: "Tightening seccomp profile can break containers whose syscalls are blocked (e.g., mknod, ptrace) — manual application syscall audit required.",
  DCK_CONTENT_TRUST: "Enabling content trust rejects unsigned images; running deployments with unsigned images must be pulled again — manual registry migration.",
  DCK_NO_SENSITIVE_MOUNTS: "Removing sensitive host mounts (e.g., /var/run/docker.sock) breaks containers that legitimately need them — manual mount inventory needed.",
  DCK_APPARMOR_PROFILE: "Applying AppArmor profile blocks syscalls/perms not in profile; containers tuned to default policy may fail — manual profile audit needed.",
  DCK_NO_PRIVILEGED_PORTS: "Containers binding privileged ports (< 1024) must be reconfigured to non-privileged ports — manual port inventory required.",
  DCK_NETWORK_DISABLED: "Switching to custom network disrupts containers attached to default bridge — manual network migration plan required.",
  DCK_LOG_DRIVER_CONFIGURED: "Changing log driver from none to json-file generates log volume; disk may fill on busy hosts — manual logrotate configuration needed.",
  DCK_ROOTLESS_MODE: "Switching to rootless mode requires complete Docker daemon reconfiguration; breaks all running containers — manual migration window required.",
  DCK_NO_HOST_NETWORK_INSPECT: "Removing host network from running containers destroys their network namespace — manual service migration required.",
  DCK_HEALTH_CHECK: "Adding health checks to containers with no existing healthcheck may mark healthy containers as unhealthy if endpoint not ready — manual probe design.",
  DCK_BRIDGE_NFCALL: "Disabling bridge netfilter call tracking breaks Docker DNS for some CNI plugins and container-to-container DNS — manual DNS verification needed.",
  DCK_NO_INSECURE_REGISTRY: "Removing insecure registry entries blocks image pulls from non-TLS registries; CI pipelines pulling from internal HTTP registries break — manual registry migration.",
  DCK_NO_EXPERIMENTAL: "Disabling experimental features may break running containers relying on them (e.g., cgroups v2 features) — manual feature inventory needed.",
  DCK_AUTH_PLUGIN: "Enabling auth plugin requires plugin installation and configuration; existing daemon operations may be denied — manual plugin review required.",
  DCK_REGISTRY_CERTS: "Adding registry TLS certs changes trust anchors for all image pulls; misconfigured CA chain blocks all pulls — manual cert chain validation required.",
  DCK_SWARM_INACTIVE: "Disabling swarm mode on running swarm workers detaches them from cluster; running services lose quorum — manual swarm migration needed.",
  DCK_PID_MODE: "Removing host PID namespace from containers breaks processes that need to inspect host PIDs (debugging, monitoring) — manual container recreation required.",
};

function makeDockerSkippedChecks(severity: "info" | "warning"): AuditCheck[] {
  const message = "Docker not installed";
  const ids = [
    { id: CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET, name: "No TCP Socket Exposed" },
    { id: CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED, name: "No Privileged Containers" },
    { id: CHECK_IDS.DOCKER.DCK_VERSION_CURRENT, name: "Docker Version Current" },
    { id: CHECK_IDS.DOCKER.DCK_USER_NAMESPACE, name: "User Namespace Enabled" },
    { id: CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK, name: "No Host Network Containers" },
    { id: CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER, name: "Logging Driver Configured" },
    { id: CHECK_IDS.DOCKER.DCK_LIVE_RESTORE, name: "Live Restore Enabled" },
    { id: CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES, name: "No New Privileges Default" },
    { id: CHECK_IDS.DOCKER.DCK_ICC_DISABLED, name: "Inter-Container Communication Disabled" },
    { id: CHECK_IDS.DOCKER.DCK_TLS_VERIFY, name: "TLS Verification Enabled" },
    { id: CHECK_IDS.DOCKER.DCK_SOCKET_PERMS, name: "Docker Socket Permissions" },
    { id: CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS, name: "No Root Containers" },
    { id: CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS, name: "Read-Only Root Filesystem" },
    { id: CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE, name: "Log Max Size Configured" },
    { id: CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS, name: "Default Ulimits Configured" },
    { id: CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED, name: "Seccomp Profile Applied" },
    { id: CHECK_IDS.DOCKER.DCK_CONTENT_TRUST, name: "Docker Content Trust Enabled" },
    { id: CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS, name: "No Sensitive Mounts" },
    { id: CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE, name: "AppArmor Profile Applied" },
    { id: CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS, name: "No Privileged Port Bindings" },
    { id: CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED, name: "Custom Network Configured" },
    { id: CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED, name: "Log Driver Not None" },
    { id: CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE, name: "Rootless Docker Mode" },
    { id: CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT, name: "No Host Network Mode (Inspect)" },
    { id: CHECK_IDS.DOCKER.DCK_HEALTH_CHECK, name: "Container Health Checks Configured" },
    { id: CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL, name: "Bridge ICC Disabled" },
    { id: CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY, name: "No Insecure Registries Configured" },
    { id: CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL, name: "Experimental Features Disabled" },
    { id: CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN, name: "Docker Authorization Plugin Configured" },
    { id: CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS, name: "Registry TLS Certificates Configured" },
    { id: CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE, name: "Docker Swarm Mode Inactive" },
    { id: CHECK_IDS.DOCKER.DCK_PID_MODE, name: "No Host PID Namespace Containers" },
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
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_PID_MODE ?? "Installing Docker impacts platform workloads; manual review of platform stack required.",
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
    id: CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET,
    category: "Docker",
    name: "No TCP Socket Exposed",
    severity: "critical",
    passed: !hasTcpSocket,
    currentValue: hasTcpSocket ? `TCP socket found: ${hosts.filter((h: string) => h.startsWith("tcp://")).join(", ")}` : "Unix socket only",
    expectedValue: "No TCP socket (unix:// only)",
    fixCommand: 'Edit /etc/docker/daemon.json to remove "hosts" TCP entries && systemctl restart docker',
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_NO_TCP_SOCKET,
    explain: "Exposing Docker daemon via TCP allows remote unauthenticated access to the host.",
  };

  // DCK-NO-PRIVILEGED: No privileged containers
  const hasPrivileged = /--privileged/i.test(sectionOutput) || /"Privileged":\s*true/i.test(sectionOutput);
  const dck02: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED,
    category: "Docker",
    name: "No Privileged Containers",
    severity: "critical",
    passed: !hasPrivileged,
    currentValue: hasPrivileged ? "Privileged container(s) detected" : "No privileged containers",
    expectedValue: "No privileged containers",
    fixCommand: "docker ps --format '{{.Names}}' | xargs -I{} docker inspect {} --format '{{.HostConfig.Privileged}}'",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_NO_PRIVILEGED,
    explain: "Privileged containers have full host access, defeating container isolation.",
  };

  // DCK-VERSION-CURRENT: Docker version currency
  const version = dockerInfo.ServerVersion ?? "unknown";
  const versionMajor = parseInt(version.split(".")[0], 10);
  const isCurrentVersion = !isNaN(versionMajor) && versionMajor >= 24;
  const dck03: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_VERSION_CURRENT,
    category: "Docker",
    name: "Docker Version Current",
    severity: "warning",
    passed: isCurrentVersion,
    currentValue: `Docker ${version}`,
    expectedValue: "Docker 24.0+",
    fixCommand: "curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh && rm -f /tmp/get-docker.sh",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_VERSION_CURRENT,
    explain: "Older Docker versions may have unpatched security vulnerabilities.",
  };

  // DCK-USER-NAMESPACE: User namespace / rootless
  const securityOpts = dockerInfo.SecurityOptions ?? [];
  const hasUserns = securityOpts.some((opt: string) => opt.includes("userns")) ||
    sectionOutput.includes("userns-remap");
  const dck04: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_USER_NAMESPACE,
    category: "Docker",
    name: "User Namespace Enabled",
    severity: "warning",
    passed: hasUserns,
    currentValue: hasUserns ? "User namespace remapping enabled" : "User namespace not configured",
    expectedValue: "User namespace remapping or rootless mode",
    fixCommand: 'echo \'{"userns-remap":"default"}\' > /etc/docker/daemon.json && systemctl restart docker',
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_USER_NAMESPACE,
    explain: "User namespace remapping prevents container root from being host root.",
  };

  // DCK-NO-HOST-NETWORK: No host network containers
  const hasHostNetwork = /--network\s*host/i.test(sectionOutput) || /"NetworkMode":\s*"host"/i.test(sectionOutput);
  const dck05: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK,
    category: "Docker",
    name: "No Host Network Containers",
    severity: "warning",
    passed: !hasHostNetwork,
    currentValue: hasHostNetwork ? "Host network container(s) detected" : "No host network containers",
    expectedValue: "No containers using host network",
    fixCommand: "Review containers using host network: docker ps --format '{{.Names}} {{.Networks}}'",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_NO_HOST_NETWORK,
    explain: "Host network mode bypasses Docker network isolation.",
  };

  // DCK-LOGGING-DRIVER: Logging driver configured
  const loggingDriver = dockerInfo.LoggingDriver ?? "unknown";
  const hasLogging = loggingDriver !== "none" && loggingDriver !== "unknown";
  const dck06: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER,
    category: "Docker",
    name: "Logging Driver Configured",
    severity: "info",
    passed: hasLogging,
    currentValue: `Logging driver: ${loggingDriver}`,
    expectedValue: "Logging driver configured (not none)",
    fixCommand: 'echo \'{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}\' > /etc/docker/daemon.json && systemctl restart docker',
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_LOGGING_DRIVER,
    explain: "Container logs are essential for incident investigation and monitoring.",
  };


  // Split lines once for all subsequent checks
  const allLines = sectionOutput.split("\n");

  // Parse daemon.json between sentinels
  let daemonJson: Record<string, unknown> = {};
  const djStart = sectionOutput.indexOf("---DAEMON_JSON---");
  const djEnd = sectionOutput.indexOf("---END_DAEMON_JSON---");
  if (djStart !== -1 && djEnd !== -1) {
    const djContent = sectionOutput.slice(djStart + "---DAEMON_JSON---".length, djEnd).trim();
    try { daemonJson = JSON.parse(djContent); } catch { /* skip */ }
  }

  // Check for running containers (from docker inspect output in sectionOutput)
  const hasRunningContainers = sectionOutput.includes("SecurityOpt=") && !(/SecurityOpt=N\/A/.test(sectionOutput));
  const noContainersMsg = "No running containers";

  // DCK-07: live-restore enabled
  const liveRestoreEnabled = daemonJson["live-restore"] === true || dockerInfo.LiveRestoreEnabled === true;
  const dck07: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_LIVE_RESTORE,
    category: "Docker",
    name: "Live Restore Enabled",
    severity: "warning",
    passed: liveRestoreEnabled,
    currentValue: liveRestoreEnabled ? "live-restore: true" : "live-restore not configured",
    expectedValue: "live-restore: true in daemon.json",
    fixCommand: "jq '. + {\"live-restore\":true}' /etc/docker/daemon.json > /tmp/d.json && mv /tmp/d.json /etc/docker/daemon.json && systemctl reload docker",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_LIVE_RESTORE,
    explain: "Live restore keeps containers running during Docker daemon restarts, reducing service disruption.",
  };

  // DCK-08: no-new-privileges default
  const securityOpts2 = dockerInfo.SecurityOptions ?? [];
  const noNewPrivilegesDefault = securityOpts2.some((o: string) => o.includes("no-new-privileges")) ||
    daemonJson["no-new-privileges"] === true;
  const dck08: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES,
    category: "Docker",
    name: "No New Privileges Default",
    severity: "warning",
    passed: noNewPrivilegesDefault,
    currentValue: noNewPrivilegesDefault ? "no-new-privileges configured" : "no-new-privileges not set as default",
    expectedValue: "no-new-privileges: true in daemon.json",
    fixCommand: "jq '. + {\"no-new-privileges\":true}' /etc/docker/daemon.json > /tmp/d.json && mv /tmp/d.json /etc/docker/daemon.json && systemctl restart docker",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_NO_NEW_PRIVILEGES,
    explain: "Preventing privilege escalation by default stops containers from gaining elevated host privileges.",
  };

  // DCK-09: ICC disabled
  const iccDisabled = daemonJson["icc"] === false ||
    sectionOutput.includes('"BridgeNfIcc":false') ||
    sectionOutput.includes('"BridgeNfIcc": false');
  const dck09: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_ICC_DISABLED,
    category: "Docker",
    name: "Inter-Container Communication Disabled",
    severity: "warning",
    passed: iccDisabled,
    currentValue: iccDisabled ? "ICC disabled" : "ICC not disabled (containers can communicate freely)",
    expectedValue: "icc: false in daemon.json",
    fixCommand: "jq '. + {\"icc\":false}' /etc/docker/daemon.json > /tmp/d.json && mv /tmp/d.json /etc/docker/daemon.json && systemctl restart docker",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_ICC_DISABLED,
    explain: "Disabling ICC enforces network isolation between containers, limiting lateral movement if one is compromised.",
  };

  // DCK-10: TLS verify (critical if TCP socket exposed)
  const tcpHosts = hosts.filter((h: string) => h.startsWith("tcp://"));
  const hasTcpExposed = tcpHosts.length > 0;
  const tlsVerifyEnabled = sectionOutput.includes('"tls":true') || sectionOutput.includes('"tlsverify":true');
  const dck10: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_TLS_VERIFY,
    category: "Docker",
    name: "TLS Verification Enabled",
    severity: "critical",
    passed: !hasTcpExposed || tlsVerifyEnabled,
    currentValue: hasTcpExposed
      ? (tlsVerifyEnabled ? "TLS verify enabled on TCP socket" : "TCP socket exposed without TLS verification")
      : "No TCP socket exposed",
    expectedValue: "No TCP socket, or TLS verification enabled",
    fixCommand: 'Edit /etc/docker/daemon.json: add "tls":true,"tlsverify":true with cert paths && systemctl restart docker',
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_TLS_VERIFY,
    explain: "Docker TCP socket without TLS allows unauthenticated remote access with full host control.",
  };

  // DCK-11: docker.sock permissions are 660 root:docker
  const sockStatLine = allLines.find((l) => /^\d{3}\s+\w+\s+\w+/.test(l.trim())) ?? "";
  const sockPermOk = /^660\s+root\s+docker/.test(sockStatLine.trim());
  const dck11: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_SOCKET_PERMS,
    category: "Docker",
    name: "Docker Socket Permissions",
    severity: "warning",
    passed: sockPermOk,
    currentValue: sockStatLine.trim() || "Socket stat not available",
    expectedValue: "660 root docker",
    fixCommand: "chown root:docker /var/run/docker.sock && chmod 660 /var/run/docker.sock",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_SOCKET_PERMS,
    explain: "Incorrect docker.sock permissions may allow unauthorized users to control Docker.",
  };

  // DCK-12: No root containers
  const containerUserLines = allLines.filter((l) => l.includes("User="));
  const hasRootContainers = hasRunningContainers &&
    containerUserLines.some((l) => /User=$/.test(l.trim()) || /User=""/.test(l));
  const dck12: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS,
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
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_NO_ROOT_CONTAINERS,
    explain: "Containers running as root can escalate to host root if container isolation breaks.",
  };

  // DCK-13: Read-only root filesystem
  const readonlyLines = allLines.filter((l) => l.includes("ReadonlyRootfs="));
  const allReadOnly = hasRunningContainers && readonlyLines.length > 0 &&
    readonlyLines.every((l) => l.includes("ReadonlyRootfs=true"));
  const dck13: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS,
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
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_READ_ONLY_ROOTFS,
    explain: "Read-only root filesystem prevents attackers from writing malicious files to container storage.",
  };

  // DCK-14: Log max-size configured
  const logOpts = daemonJson["log-opts"];
  const logMaxSize = sectionOutput.includes("max-size") ||
    (typeof logOpts === "object" && logOpts !== null && "max-size" in (logOpts as Record<string, unknown>));
  const dck14: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE,
    category: "Docker",
    name: "Log Max Size Configured",
    severity: "info",
    passed: logMaxSize,
    currentValue: logMaxSize ? "log max-size configured" : "No log max-size configured",
    expectedValue: "log-opts max-size set to prevent disk exhaustion",
    fixCommand: "jq '. + {\"log-driver\":\"json-file\",\"log-opts\":{\"max-size\":\"10m\",\"max-file\":\"3\"}}' /etc/docker/daemon.json > /tmp/d.json && mv /tmp/d.json /etc/docker/daemon.json && systemctl restart docker",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_LOG_MAX_SIZE,
    explain: "Unbounded container logs can fill disk space and cause denial of service.",
  };

  // DCK-15: Default ulimits configured
  const hasDefaultUlimits = "default-ulimits" in daemonJson;
  const dck15: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS,
    category: "Docker",
    name: "Default Ulimits Configured",
    severity: "info",
    passed: hasDefaultUlimits,
    currentValue: hasDefaultUlimits ? "default-ulimits configured" : "No default ulimits in daemon.json",
    expectedValue: "default-ulimits set in daemon.json",
    fixCommand: "jq '. + {\"default-ulimits\":{\"nofile\":{\"Name\":\"nofile\",\"Hard\":64000,\"Soft\":64000}}}' /etc/docker/daemon.json > /tmp/d.json && mv /tmp/d.json /etc/docker/daemon.json && systemctl restart docker",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_DEFAULT_ULIMITS,
    explain: "Default ulimits protect the host from container resource exhaustion attacks.",
  };

  // DCK-16: seccomp profile applied
  const seccompLines = allLines.filter((l) => l.includes("SecurityOpt="));
  const hasSeccomp = !hasRunningContainers ||
    (seccompLines.length > 0 && seccompLines.some((l) => l.includes("seccomp")));
  const dck16: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED,
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
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_SECCOMP_ENABLED,
    explain: "seccomp profiles restrict system calls available to containers, reducing the attack surface.",
  };

  // DCK-17: Docker content trust
  const contentTrustEnabled = sectionOutput.includes("DOCKER_CONTENT_TRUST=1");
  const dck17: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_CONTENT_TRUST,
    category: "Docker",
    name: "Docker Content Trust Enabled",
    severity: "info",
    passed: contentTrustEnabled,
    currentValue: contentTrustEnabled ? "DOCKER_CONTENT_TRUST=1" : "Content trust not enabled",
    expectedValue: "DOCKER_CONTENT_TRUST=1 environment variable set",
    fixCommand: "export DOCKER_CONTENT_TRUST=1 (add to /etc/environment or shell profile)",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_CONTENT_TRUST,
    explain: "Content trust ensures only signed images are pulled, preventing supply chain attacks.",
  };

  // DCK-18: No sensitive mounts (checks Privileged=true in inspect output)
  const privilegedInspectLines = allLines.filter((l) => l.includes("Privileged="));
  const hasPrivilegedFromInspect = hasRunningContainers &&
    privilegedInspectLines.some((l) => l.includes("Privileged=true"));
  const dck18: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS,
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
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_NO_SENSITIVE_MOUNTS,
    explain: "Privileged containers have access to all host devices and can mount sensitive filesystems.",
  };

  // DCK-19: AppArmor profile applied
  const hasApparmor = !hasRunningContainers ||
    (seccompLines.length > 0 && seccompLines.some((l) => l.includes("apparmor")));
  const dck19: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE,
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
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_NO_EXPERIMENTAL,
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
    id: CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS,
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
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_NO_PRIVILEGED_PORTS,
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
    id: CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED,
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
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_NETWORK_DISABLED,
    explain:
      "Default bridge network provides no isolation between containers; user-defined networks enable proper segmentation.",
  };

  // DCK-22: Log driver not 'none'
  const dck22LogDriver = dockerInfo.LoggingDriver ?? "unknown";
  const dck22: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED,
    category: "Docker",
    name: "Logging Driver Not None",
    severity: "warning",
    passed: !isDockerAvailable(sectionOutput) ? true : dck22LogDriver !== "none",
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : `Logging driver: ${dck22LogDriver}`,
    expectedValue: "LoggingDriver is not 'none'",
    fixCommand: "jq '. + {\"log-driver\":\"json-file\"}' /etc/docker/daemon.json > /tmp/d.json && mv /tmp/d.json /etc/docker/daemon.json && systemctl restart docker",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_LOG_DRIVER_CONFIGURED,
    explain:
      "Disabling container logging prevents forensic analysis and audit trail of container activity.",
  };

  // DCK-23: Rootless mode
  const dck23SecOpts = dockerInfo.SecurityOptions ?? [];
  const isRootless = dck23SecOpts.some((o: string) => o.toLowerCase().includes("rootless"));
  const dck23: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE,
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
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_ROOTLESS_MODE,
    explain:
      "Rootless Docker eliminates the daemon running as root, significantly reducing the blast radius of container escapes.",
  };

  // DCK-24: No containers using host network mode (inspect JSON path)
  const hasHostNetworkMode = /"NetworkMode":\s*"host"/i.test(sectionOutput);
  const dck24: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT,
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
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_NO_HOST_NETWORK_INSPECT,
    explain:
      "Host network mode bypasses Docker network isolation, exposing all host ports to the container.",
  };

  // DCK-25: Container health checks
  const healthCheckLines = allLines.filter((l) => l.includes("Health") || l.includes("healthy") || l.includes("unhealthy"));
  const hasHealthChecks = !hasRunningContainers || healthCheckLines.length > 0;
  const dck25: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_HEALTH_CHECK,
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
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_HEALTH_CHECK,
    explain:
      "Health checks enable automatic container restart on failure, improving service availability and security posture.",
  };

  // DCK-26: Bridge ICC (Inter-Container Communication on default bridge)
  // Parse docker network inspect bridge JSON for com.docker.network.bridge.enable_icc
  const bridgeInspectLine = allLines.find((l) => l.includes("enable_icc") || l.includes("enable_ip_masquerade"));
  let iccEnabled = false;
  if (bridgeInspectLine) {
    try {
      // Line may be JSON like {"com.docker.network.bridge.enable_icc":"true",...}
      const parsed = JSON.parse(bridgeInspectLine.trim()) as Record<string, string>;
      iccEnabled = parsed["com.docker.network.bridge.enable_icc"] === "true";
    } catch {
      iccEnabled = /enable_icc["\s:]+true/.test(bridgeInspectLine);
    }
  }
  const dck26: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL,
    category: "Docker",
    name: "Bridge ICC Disabled",
    severity: "warning",
    passed: !isDockerAvailable(sectionOutput) ? true : !iccEnabled,
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : iccEnabled
        ? "ICC enabled on default bridge (containers can communicate freely)"
        : "ICC not enabled on default bridge",
    expectedValue: "com.docker.network.bridge.enable_icc = false",
    fixCommand: "echo '{\"icc\": false}' > /etc/docker/daemon.json && systemctl restart docker",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_BRIDGE_NFCALL,
    explain: "Inter-container communication on the default bridge allows any container to communicate with any other, enabling lateral movement.",
  };

  // DCK-27: No insecure registries
  // Parse docker info insecure registry CIDRs — only 127.0.0.0/8 is acceptable
  const insecureRegistryLine = allLines.find((l) => /InsecureRegistryCIDRs|insecure-registry/i.test(l));
  const insecureRegistryValue = insecureRegistryLine?.trim() ?? "";
  const hasCustomInsecureRegistry = insecureRegistryValue.length > 0
    && insecureRegistryValue !== "N/A"
    && !/^\[127\.0\.0\.0\/8\]$/.test(insecureRegistryValue.replace(/\s/g, ""))
    && !insecureRegistryValue.includes("[]");
  const dck27: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY,
    category: "Docker",
    name: "No Insecure Registries Configured",
    severity: "warning",
    passed: !isDockerAvailable(sectionOutput) ? true : !hasCustomInsecureRegistry,
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : hasCustomInsecureRegistry
        ? `Insecure registry configured: ${insecureRegistryValue}`
        : "No custom insecure registries",
    expectedValue: "No insecure registries beyond 127.0.0.0/8",
    fixCommand: "Remove --insecure-registry from /etc/docker/daemon.json and restart docker",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_NO_INSECURE_REGISTRY,
    explain: "Insecure registries allow image pulls over unencrypted HTTP, enabling man-in-the-middle image tampering.",
  };

  // DCK-28: No experimental build features
  // The experimental flag section emits a standalone "true" or "false" line.
  // It is the last section in the output, following the swarm state line.
  // We detect it by finding the last standalone boolean line.
  const experimentalLine = allLines.find((l) => /ExperimentalBuild|experimental/i.test(l) && !/^#/.test(l));
  const lastBoolLine = [...allLines].reverse().find((l) => /^(true|false)$/.test(l.trim()));
  const isExperimental = (experimentalLine !== undefined && experimentalLine.trim() === "true")
    || (lastBoolLine?.trim() === "true");
  const dck28: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL,
    category: "Docker",
    name: "Experimental Features Disabled",
    severity: "info",
    passed: !isDockerAvailable(sectionOutput) ? true : !isExperimental,
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : isExperimental
        ? "Experimental features enabled"
        : "Experimental features disabled",
    expectedValue: "ExperimentalBuild = false",
    fixCommand: 'Remove "experimental": true from /etc/docker/daemon.json',
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_NO_EXPERIMENTAL,
    explain: "Experimental features are not production-hardened and may contain unpatched vulnerabilities.",
  };

  // DCK-29: Authorization plugin configured
  // Parse docker info Authorization plugins — line from `docker info --format '{{.Plugins.Authorization}}'`
  const authPluginLine = allLines.find((l) => l.trim().startsWith("[") && allLines.indexOf(l) > allLines.findIndex((x) => /SecurityOptions|ExperimentalBuild/.test(x)));
  const authPluginValue = authPluginLine?.trim() ?? "";
  const hasAuthPlugin = authPluginValue.length > 0
    && authPluginValue !== "N/A"
    && authPluginValue !== "[]"
    && authPluginValue !== "[ ]";
  const dck29: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN,
    category: "Docker",
    name: "Docker Authorization Plugin Configured",
    severity: "info",
    passed: !isDockerAvailable(sectionOutput) ? true : hasAuthPlugin,
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : hasAuthPlugin
        ? `Authorization plugin(s): ${authPluginValue}`
        : "None configured",
    expectedValue: "At least one authorization plugin active",
    fixCommand: "Configure an authorization plugin in /etc/docker/daemon.json (e.g., open-policy-agent)",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_AUTH_PLUGIN,
    explain: "Docker authorization plugins enforce fine-grained access control on API requests, preventing unauthorized container operations.",
  };

  // DCK-30: Registry TLS certificates exist
  const hasCertsDir = !sectionOutput.includes("NO_CERTS_DIR")
    && sectionOutput.includes("/etc/docker/certs.d/")
    && !sectionOutput.includes("total 0");
  const dck30: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS,
    category: "Docker",
    name: "Registry TLS Certificates Configured",
    severity: "info",
    passed: !isDockerAvailable(sectionOutput) ? true : hasCertsDir,
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : hasCertsDir
        ? "/etc/docker/certs.d/ exists with registry cert subdirectories"
        : "No registry TLS certificates configured",
    expectedValue: "/etc/docker/certs.d/ exists with registry cert subdirectories",
    fixCommand: "mkdir -p /etc/docker/certs.d/registry.example.com && cp ca.crt /etc/docker/certs.d/registry.example.com/",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_REGISTRY_CERTS,
    explain: "Registry TLS certificates enable verification of private registry identity, preventing image pulls from impersonated registries.",
  };

  // DCK-31: Swarm mode inactive (unless intentionally used)
  // Parse `docker system info --format '{{.Swarm.LocalNodeState}}'` — should not be "active"
  const swarmStateLine = allLines.find((l) => /^(active|inactive|pending|error|locked)$/.test(l.trim()));
  const swarmState = swarmStateLine?.trim() ?? "inactive";
  const swarmActive = swarmState === "active";
  const dck31: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE,
    category: "Docker",
    name: "Docker Swarm Mode Inactive",
    severity: "info",
    passed: !isDockerAvailable(sectionOutput) ? true : !swarmActive,
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : swarmActive
        ? "Swarm mode active"
        : `Swarm state: ${swarmState}`,
    expectedValue: "Swarm mode inactive (if not intentionally used)",
    fixCommand: "docker swarm leave --force (if swarm not intentionally used)",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_BRIDGE_NFCALL,
    explain: "Docker Swarm mode opens additional network ports and management APIs; disable if not actively used.",
  };

  // DCK-32: No containers using host PID namespace
  const hasHostPid = /"PidMode":\s*"host"/i.test(sectionOutput)
    || /PidMode=host/.test(sectionOutput);
  const dck32: AuditCheck = {
    id: CHECK_IDS.DOCKER.DCK_PID_MODE,
    category: "Docker",
    name: "No Host PID Namespace Containers",
    severity: "warning",
    passed: !isDockerAvailable(sectionOutput) ? true : !hasRunningContainers || !hasHostPid,
    currentValue: !isDockerAvailable(sectionOutput)
      ? "Docker not installed"
      : !hasRunningContainers
        ? "No running containers"
        : hasHostPid
          ? "Container(s) using host PID namespace detected"
          : "No containers using host PID namespace",
    expectedValue: "No containers with PidMode=host",
    fixCommand: "docker run --pid=private ... (do not use --pid=host)",
    safeToAutoFix: "FORBIDDEN",
    forbiddenReason: DOCKER_FORBIDDEN_REASONS.DCK_PID_MODE,
    explain: "Sharing the host PID namespace gives containers visibility into all host processes, enabling process injection and credential theft.",
  };

  return [dck01, dck02, dck03, dck04, dck05, dck06, dck07, dck08, dck09, dck10, dck11, dck12, dck13, dck14, dck15, dck16, dck17, dck18, dck19, dck20, dck21, dck22, dck23, dck24, dck25, dck26, dck27, dck28, dck29, dck30, dck31, dck32];
};
