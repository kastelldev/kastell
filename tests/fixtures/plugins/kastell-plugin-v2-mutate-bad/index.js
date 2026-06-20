/**
 * kastell-plugin-v2-mutate-bad — invalid v2 mutating check fixture.
 *
 * Declares apiVersion "2" with a check whose checkCommand.kind is
 * "mutate-local", which Plugin API v2 rejects with migration guidance
 * (see docs/plugin-sdk-migration-v3.md). The loader is expected to
 * mark the plugin as failed in the registry and surface a
 * "migrate to v3" error.
 */
export const checks = [
  {
    id: "MUT-BAD",
    category: "X",
    name: "n",
    severity: "info",
    checkCommand: { kind: "mutate-local", cmd: "echo x" },
  },
];
