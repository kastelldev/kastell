/**
 * SSH batch command builder for evidence collection.
 * Produces a single batched command with ---SEPARATOR--- delimiters between sections.
 * Section order is deterministic — parsers index into split output by EVIDENCE_SECTION_INDICES.
 */

/** Deterministic section indices for parsers to locate their output */
export const EVIDENCE_SECTION_INDICES = {
  FIREWALL: 0,
  AUTH_LOG: 1,
  PORTS: 2,
  SYSLOG: 3,
  SYSINFO: 4,
  DOCKER_PS: 5,
  DOCKER_LOGS: 6,
} as const;

const SEPARATOR = "echo '---SEPARATOR---'";

/** Sanitize lines parameter to prevent injection via NaN/Infinity/negative values */
function sanitizeLines(lines: number): number {
  const n = Math.floor(lines);
  if (!Number.isFinite(n) || n < 1) return 500;
  return Math.min(n, 10000);
}

function firewallSection(): string {
  return [
    `command -v ufw >/dev/null 2>&1 && ufw status verbose 2>/dev/null || echo 'N/A'`,
    `command -v iptables >/dev/null 2>&1 && iptables -L -n 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function authLogSection(lines: number): string {
  return (
    `if [ -f /var/log/auth.log ]; then` +
    ` tail -n ${lines} /var/log/auth.log 2>/dev/null || echo 'N/A';` +
    ` elif [ -f /var/log/secure ]; then` +
    ` tail -n ${lines} /var/log/secure 2>/dev/null || echo 'N/A';` +
    ` else echo 'N/A'; fi`
  );
}

function portsSection(): string {
  return `ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo 'N/A'`;
}

function syslogSection(lines: number): string {
  return (
    `if command -v journalctl >/dev/null 2>&1; then` +
    ` journalctl -n ${lines} --no-pager 2>/dev/null || echo 'N/A';` +
    ` elif [ -f /var/log/syslog ]; then` +
    ` tail -n ${lines} /var/log/syslog 2>/dev/null || echo 'N/A';` +
    ` elif [ -f /var/log/messages ]; then` +
    ` tail -n ${lines} /var/log/messages 2>/dev/null || echo 'N/A';` +
    ` else echo 'N/A'; fi`
  );
}

function sysinfoSection(): string {
  return [
    `crontab -l 2>/dev/null || echo 'N/A'`,
    `getent passwd 2>/dev/null || cat /etc/passwd 2>/dev/null || echo 'N/A'`,
    `ps aux 2>/dev/null || echo 'N/A'`,
    `df -h 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function dockerPsSection(): string {
  return `command -v docker >/dev/null 2>&1 && docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null || echo 'N/A'`;
}

function dockerLogsSection(platform: string, lines: number): string {
  const filter = platform === "coolify" ? "coolify" : "dokploy";
  return (
    `command -v docker >/dev/null 2>&1 &&` +
    ` docker ps --filter 'name=${filter}' --format '{{.Names}}' 2>/dev/null |` +
    ` head -5 | xargs -I{} sh -c 'echo "=== {} ===" && docker logs --tail ${lines} {} 2>&1' || echo 'N/A'`
  );
}

/** Options controlling which evidence sections to include */
export interface EvidenceBuildOptions {
  noDocker?: boolean;
  noSysinfo?: boolean;
}

/**
 * Return the ordered list of output filenames matching the sections
 * that buildEvidenceBatchCommand will produce for the same arguments.
 * Callers use this instead of static EVIDENCE_SECTION_INDICES to map
 * split output positions to filenames.
 */
export function getEvidenceSectionFilenames(
  platform: string,
  options?: EvidenceBuildOptions,
): string[] {
  const noDocker = options?.noDocker ?? false;
  const noSysinfo = options?.noSysinfo ?? false;
  const includeDocker = !noDocker && (platform === "coolify" || platform === "dokploy");

  const filenames: string[] = [
    "firewall-rules.txt",
    "auth-log.txt",
    "listening-ports.txt",
    "syslog.txt",
  ];

  if (!noSysinfo) {
    filenames.push("system-info.txt");
  }

  if (includeDocker) {
    filenames.push("docker-containers.txt");
    filenames.push("docker-logs.txt");
  }

  return filenames;
}

/**
 * Build a single batched SSH command for evidence collection.
 *
 * Sections are separated by `---SEPARATOR---`.
 * Use getEvidenceSectionFilenames() with the same arguments to map
 * split output positions to filenames.
 *
 * Base sections (always included unless opted out):
 *   FIREWALL (0), AUTH_LOG (1), PORTS (2), SYSLOG (3), SYSINFO (4)
 *
 * Docker sections (only for coolify/dokploy platforms, unless noDocker):
 *   DOCKER_PS (5), DOCKER_LOGS (6)
 */
export function buildEvidenceBatchCommand(
  platform: string,
  lines: number,
  options?: EvidenceBuildOptions,
): string {
  const noDocker = options?.noDocker ?? false;
  const noSysinfo = options?.noSysinfo ?? false;
  const includeDocker = !noDocker && (platform === "coolify" || platform === "dokploy");

  const safeLines = sanitizeLines(lines);

  const sections: string[] = [
    firewallSection(),
    authLogSection(safeLines),
    portsSection(),
    syslogSection(safeLines),
  ];

  if (!noSysinfo) {
    sections.push(sysinfoSection());
  }

  if (includeDocker) {
    sections.push(dockerPsSection());
    sections.push(dockerLogsSection(platform, safeLines));
  }

  return sections.join(`\n${SEPARATOR}\n`);
}
