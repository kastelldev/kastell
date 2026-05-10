jest.mock("../../../src/utils/ssh.js", () => ({
  sshExec: jest.fn(),
}));

import { sshExec } from "../../../src/utils/ssh.js";
import { executePluginChecks } from "../../../src/core/audit/pluginAudit.js";
import type { PluginCheck } from "../../../src/plugin/sdk/types.js";

const mockSshExec = sshExec as jest.MockedFunction<typeof sshExec>;

describe("executePluginChecks", () => {
  const checks: PluginCheck[] = [
    {
      id: "WP-UPDATES",
      name: "WordPress Updates",
      category: "WordPress",
      severity: "warning",
      description: "Check WP updates",
      checkCommand: "wp core check-update --format=json 2>/dev/null | head -1",
      passPattern: "^\\[\\]$",
    },
    {
      id: "WP-PERMISSIONS",
      name: "File Permissions",
      category: "WordPress",
      severity: "critical",
      description: "Check wp-config perms",
      checkCommand: "stat -c %a /var/www/html/wp-config.php 2>/dev/null",
      passPattern: "^[46]00$",
      failPattern: "^777$",
    },
  ];

  beforeEach(() => jest.clearAllMocks());

  it("returns AuditCategory with passing checks", async () => {
    mockSshExec.mockResolvedValue({ stdout: "[]", code: 0, stderr: "" });
    const result = await executePluginChecks("1.2.3.4", "WordPress", "WP", checks);
    expect(result.name).toBe("WordPress");
    expect(result.checks).toHaveLength(2);
    expect(result.checks[0].passed).toBe(true);
    expect(result.checks[0].currentValue).toBe("[]");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.maxScore).toBe(20);
  });

  it("marks check as fail when failPattern matches", async () => {
    mockSshExec.mockResolvedValue({ stdout: "777", code: 0, stderr: "" });
    const result = await executePluginChecks("1.2.3.4", "WordPress", "WP", checks);
    const permCheck = result.checks.find((c) => c.id === "WP-PERMISSIONS");
    expect(permCheck?.passed).toBe(false);
  });

  it("marks check as fail when passPattern does not match", async () => {
    mockSshExec.mockResolvedValue({ stdout: "updates available", code: 0, stderr: "" });
    const result = await executePluginChecks("1.2.3.4", "WordPress", "WP", checks);
    const updateCheck = result.checks.find((c) => c.id === "WP-UPDATES");
    expect(updateCheck?.passed).toBe(false);
  });

  it("marks check as fail when SSH fails", async () => {
    mockSshExec.mockRejectedValue(new Error("Connection refused"));
    const result = await executePluginChecks("1.2.3.4", "WordPress", "WP", checks);
    expect(result.checks[0].passed).toBe(false);
    expect(result.checks[0].currentValue).toBe("SSH error");
  });

  it("returns empty category when no checks provided", async () => {
    const result = await executePluginChecks("1.2.3.4", "Empty", "EMP", []);
    expect(result.checks).toHaveLength(0);
  });

  it("groups checks by category", async () => {
    mockSshExec.mockResolvedValue({ stdout: "[]", code: 0, stderr: "" });
    const mixedChecks: PluginCheck[] = [
      { ...checks[0], category: "WordPress" },
      { ...checks[1], id: "WP-SSL", category: "WordPress SSL", checkCommand: "echo ok", passPattern: "ok" },
    ];
    const results = await executePluginChecks("1.2.3.4", "WordPress", "WP", mixedChecks);
    expect(results.checks).toHaveLength(2);
  });
});
