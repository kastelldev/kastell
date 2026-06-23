/**
 * kastell-plugin-v2-rawfix-bad — invalid v2 raw fixCommand fixture.
 *
 * Declares apiVersion "2" with a check-level raw `fixCommand`, which
 * Plugin API v2 rejects with migration guidance (see
 * docs/plugin-sdk-migration-v3.md). The loader is expected to mark
 * the plugin as failed in the registry and surface a
 * "migrate to v3" error.
 */
export const checks = [
  {
    id: "RF-BAD",
    category: "X",
    name: "n",
    severity: "info",
    checkCommand: { kind: "read", cmd: "echo x" },
    fixCommand: "rm -rf /",
  },
];
