/**
 * kastell-plugin-mock — Plugin API v3 read-only fixture.
 *
 * Used by tests/unit/plugin and tests/integration as a generic v3
 * read-only plugin with two checks.
 */
export const checks = [
  {
    id: "MOCK-TEST-CHECK",
    name: "Mock Test Check",
    category: "Mock Category",
    severity: "info",
    description: "A mock check for testing plugin loader",
    read: {
      cmd: "echo MOCK_PASS",
      passPattern: "MOCK_PASS",
    },
  },
  {
    id: "MOCK-SECOND-CHECK",
    name: "Mock Second Check",
    category: "Mock Category",
    severity: "warning",
    description: "A second mock check",
    read: {
      cmd: "echo MOCK_OK",
      passPattern: "MOCK_OK",
    },
  },
];
