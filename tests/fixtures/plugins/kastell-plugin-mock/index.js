export const checks = [
  {
    id: "MOCK-TEST-CHECK",
    name: "Mock Test Check",
    category: "Mock Category",
    severity: "info",
    description: "A mock check for testing plugin loader",
    checkCommand: "echo MOCK_PASS",
    passPattern: "MOCK_PASS",
  },
  {
    id: "MOCK-SECOND-CHECK",
    name: "Mock Second Check",
    category: "Mock Category",
    severity: "warning",
    description: "A second mock check",
    checkCommand: "echo MOCK_OK",
    passPattern: "MOCK_OK",
  },
];