/**
 * kastell-plugin-v2-readonly — Plugin API v2 read-only fixture.
 *
 * v2 read-only plugins are still accepted by Kastell v2.3. This fixture
 * exercises that compatibility path:
 *   - apiVersion: "2"
 *   - checkCommand: { kind: "read", cmd: ... }
 *   - passPattern at check level (not inside a nested `read` object)
 *   - no fixCommand (raw fix was removed)
 *   - no activeProbe
 *
 * Used by tests/unit/plugin/example-plugins.test.ts.
 */
export const checks = [
  {
    id: "VROR-LEGACY-CHECK",
    name: "V2 legacy read check",
    category: "V2 Compat",
    severity: "info",
    description: "A read-only v2 plugin check used to verify v2 compatibility",
    checkCommand: { kind: "read", cmd: "echo V2RO_PASS" },
    passPattern: "V2RO_PASS",
  },
];
