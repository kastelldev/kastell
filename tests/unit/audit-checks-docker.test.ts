import { parseDockerChecks } from "../../src/core/audit/checks/docker.js";

describe("parseDockerChecks", () => {
  const secureDockerOutput = [
    // docker info json (no TCP socket, user namespace enabled)
    '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":["name=userns"],"LoggingDriver":"json-file"}',
    // daemon.json
    '{"log-driver":"json-file","userns-remap":"default"}',
    // docker ps output (no privileged, no host network)
    "myapp nginx:latest Up 2 hours",
    "db postgres:15 Up 2 hours",
    // docker socket permissions
    "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
  ].join("\n");

  const insecureDockerOutput = [
    '{"Hosts":["unix:///var/run/docker.sock","tcp://0.0.0.0:2375"],"ServerVersion":"20.10.7","SecurityOptions":[],"LoggingDriver":"none"}',
    "N/A",
    "myapp nginx:latest Up 2 hours",
    "srw-rw-rw- 1 root root 0 Mar  1 10:00 /var/run/docker.sock",
  ].join("\n");

  it("should return 6 checks for secure Docker setup", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    expect(checks).toHaveLength(6);
    checks.forEach((check) => {
      expect(check.category).toBe("Docker");
      expect(check.id).toMatch(/^DCK-0[1-6]$/);
    });
  });

  it("should return DCK-01 passed when no TCP socket exposed", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const dck01 = checks.find((c) => c.id === "DCK-01");
    expect(dck01!.passed).toBe(true);
  });

  it("should return DCK-01 failed when TCP socket exposed", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const dck01 = checks.find((c) => c.id === "DCK-01");
    expect(dck01!.passed).toBe(false);
    expect(dck01!.severity).toBe("critical");
  });

  it("should return all checks as info/skipped when Docker not installed (N/A)", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(checks).toHaveLength(6);
    checks.forEach((check) => {
      expect(check.severity).toBe("info");
      expect(check.currentValue).toContain("Docker not installed");
    });
  });

  it("should return all checks as info/skipped for empty output on bare platform", () => {
    const checks = parseDockerChecks("", "bare");
    expect(checks).toHaveLength(6);
    checks.forEach((check) => {
      expect(check.severity).toBe("info");
    });
  });

  it("should handle coolify platform (Docker expected)", () => {
    const checks = parseDockerChecks("N/A", "coolify");
    expect(checks).toHaveLength(6);
    // On coolify, Docker missing is a warning not info
    const dck01 = checks.find((c) => c.id === "DCK-01");
    expect(dck01!.severity).toBe("warning");
  });

  it("should handle dokploy platform (Docker expected)", () => {
    const checks = parseDockerChecks("N/A", "dokploy");
    expect(checks).toHaveLength(6);
    const dck01 = checks.find((c) => c.id === "DCK-01");
    expect(dck01!.severity).toBe("warning");
  });
});
