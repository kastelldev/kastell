/**
 * kastell-plugin-auditor — Plugin API v3 example.
 *
 * Demonstrates two shapes:
 *  1. AUD-SSH-CUSTOM-PORT — read-only v3 check (no activeProbe).
 *  2. AUD-TMP-MODE-ACTIVE — combined `read` + `activeProbe` check that
 *     performs a deterministic, session-scoped /tmp file mode round-trip
 *     via the controlled SSH lifecycle surface.
 */
export const checks = [
  {
    id: "AUD-SSH-CUSTOM-PORT",
    name: "SSH custom port",
    category: "Custom Audit",
    severity: "critical",
    description: "Verifies SSH is not running on default port 22",
    read: {
      cmd: "grep '^Port ' /etc/ssh/sshd_config | awk '{print $2}'",
      failPattern: "^22$",
    },
  },
  {
    id: "AUD-TMP-MODE-ACTIVE",
    name: "temporary file mode round-trip",
    category: "Custom Audit",
    severity: "info",
    description:
      "Checks /tmp and verifies a session-scoped mode-0600 file round-trip",
    read: {
      cmd: "test -d /tmp && test -w /tmp && echo ready",
      passPattern: "^ready$",
    },
    activeProbe: {
      handler: "./probes/tmp-mode-round-trip.js",
      risk: "low",
      timeoutMs: 30000,
    },
  },
];

export const commands = [
  {
    name: "analyze",
    description: "Analyze audit results",
    handler: "./commands/analyze.js",
  },
];

export const mcpTools = [
  {
    name: "report",
    description: "Generate audit summary report",
    handler: "./mcp/report.js",
  },
];
