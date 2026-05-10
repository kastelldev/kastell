jest.mock("../../../src/utils/ssh.js", () => ({
  sshExec: jest.fn(),
}));

import { sshExec } from "../../../src/utils/ssh.js";
import { executePluginChecks } from "../../../src/core/audit/pluginAudit.js";
import type { PluginCheck, PluginFix } from "../../../src/plugin/sdk/types.js";

const mockSshExec = sshExec as jest.MockedFunction<typeof sshExec>;

describe("kastell-plugin-auditor fix capability demo", () => {
  it("injects fix metadata from manifest into failed audit checks", async () => {
    const checks: PluginCheck[] = [{
      id: "AUDT-SAMPLE-FIX",
      name: "Sample Fix Check",
      category: "auditor",
      severity: "warning",
      description: "Demo fix check",
      checkCommand: "cat /etc/kastell-test.conf",
      passPattern: "^fixed$",
      fixCommand: "echo fix",
    }];

    const fixes: PluginFix[] = [{
      checkId: "AUDT-SAMPLE-FIX",
      tier: "SAFE",
      handler: "./fixes/sample-fix.js",
      backupPaths: ["/etc/kastell-test.conf"],
    }];

    mockSshExec.mockResolvedValue({ stdout: "not-fixed", stderr: "", code: 0 });

    const result = await executePluginChecks(
      "1.2.3.4", "Plugin:auditor", checks,
      "kastell-plugin-auditor", fixes,
    );

    expect(result.checks).toHaveLength(1);
    const check = result.checks[0];
    expect(check.passed).toBe(false);
    expect(check.safeToAutoFix).toBe("SAFE");
    expect(check.fixCommand).toBe("plugin:kastell-plugin-auditor:./fixes/sample-fix.js");
  });

  it("does not override fix metadata for passed checks", async () => {
    const checks: PluginCheck[] = [{
      id: "AUDT-SAMPLE-FIX",
      name: "Sample Fix Check",
      category: "auditor",
      severity: "warning",
      description: "Demo fix check",
      checkCommand: "cat /etc/kastell-test.conf",
      passPattern: "^fixed$",
      fixCommand: "echo fix",
    }];

    const fixes: PluginFix[] = [{
      checkId: "AUDT-SAMPLE-FIX",
      tier: "SAFE",
      handler: "./fixes/sample-fix.js",
    }];

    mockSshExec.mockResolvedValue({ stdout: "fixed", stderr: "", code: 0 });

    const result = await executePluginChecks(
      "1.2.3.4", "Plugin:auditor", checks,
      "kastell-plugin-auditor", fixes,
    );

    const check = result.checks[0];
    expect(check.passed).toBe(true);
    expect(check.fixCommand).toBe("echo fix");
  });
});
