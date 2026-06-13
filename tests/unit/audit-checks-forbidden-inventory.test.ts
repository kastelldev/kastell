import { parseSSHChecks } from "../../src/core/audit/checks/ssh.js";
import { parseFirewallChecks } from "../../src/core/audit/checks/firewall.js";
import { parseDockerChecks } from "../../src/core/audit/checks/docker.js";
import type { AuditCheck } from "../../src/core/audit/types.js";

describe("FORBIDDEN inventory invariant (P142 Task 10)", () => {
  it("SSH+Firewall+Docker parsers produce exactly 52 FORBIDDEN checks total (SSH: 2, Firewall: 17, Docker: 33)", () => {
    const sshChecks = parseSSHChecks("N/A", "bare");
    const fwChecks = parseFirewallChecks("N/A", "bare");
    const dockerChecks = parseDockerChecks("N/A", "coolify");

    const sshForbidden = sshChecks.filter((c) => c.safeToAutoFix === "FORBIDDEN");
    const fwForbidden = fwChecks.filter((c) => c.safeToAutoFix === "FORBIDDEN");
    const dockerForbidden = dockerChecks.filter((c) => c.safeToAutoFix === "FORBIDDEN");

    const counts = {
      SSH: sshForbidden.length,
      Firewall: fwForbidden.length,
      Docker: dockerForbidden.length,
    };

    expect(counts).toEqual({ SSH: 2, Firewall: 17, Docker: 33 });
    expect(sshForbidden.length + fwForbidden.length + dockerForbidden.length).toBe(52);
  });

  it("every FORBIDDEN check has a non-empty forbiddenReason", () => {
    const sshChecks = parseSSHChecks("N/A", "bare");
    const fwChecks = parseFirewallChecks("N/A", "bare");
    const dockerChecks = parseDockerChecks("N/A", "coolify");

    const all: AuditCheck[] = [
      ...sshChecks.filter((c) => c.safeToAutoFix === "FORBIDDEN"),
      ...fwChecks.filter((c) => c.safeToAutoFix === "FORBIDDEN"),
      ...dockerChecks.filter((c) => c.safeToAutoFix === "FORBIDDEN"),
    ];

    expect(all.length).toBe(52);
    for (const check of all) {
      expect(check.forbiddenReason).toBeDefined();
      expect(typeof check.forbiddenReason).toBe("string");
      expect((check.forbiddenReason as string).length).toBeGreaterThan(0);
    }
  });
});
