import { parseDockerChecks } from "../../src/core/audit/checks/docker.js";

describe("parseDockerChecks", () => {
  const secureDockerOutput = [
    // docker info json (no TCP socket, user namespace enabled, live-restore)
    '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":["name=userns","name=seccomp,profile=default","name=apparmor"],"LoggingDriver":"json-file","LiveRestoreEnabled":true}',
    // daemon.json with full hardening
    '{"log-driver":"json-file","userns-remap":"default","live-restore":true,"icc":false,"log-opts":{"max-size":"10m","max-file":"3"},"default-ulimits":{"nofile":{"Name":"nofile","Hard":64000,"Soft":64000}}}',
    // docker ps output (no privileged, no host network)
    "myapp nginx:latest Up 2 hours",
    "db postgres:15 Up 2 hours",
    // docker socket permissions
    "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
    // container inspect output (SecurityOpt=seccomp apparmor, ReadonlyRootfs=true, User=appuser, Privileged=false)
    "/myapp SecurityOpt=[seccomp:default apparmor:docker-default] ReadonlyRootfs=true User=appuser Privileged=false",
    "/db SecurityOpt=[seccomp:default apparmor:docker-default] ReadonlyRootfs=true User=postgres Privileged=false",
    // DOCKER_CONTENT_TRUST
    "DOCKER_CONTENT_TRUST=1",
    // docker.sock stat (660 root docker)
    "660 root docker",
  ].join("\n");

  const insecureDockerOutput = [
    '{"Hosts":["unix:///var/run/docker.sock","tcp://0.0.0.0:2375"],"ServerVersion":"20.10.7","SecurityOptions":[],"LoggingDriver":"none"}',
    "N/A",
    "myapp nginx:latest Up 2 hours",
    "srw-rw-rw- 1 root root 0 Mar  1 10:00 /var/run/docker.sock",
    "/myapp SecurityOpt=[] ReadonlyRootfs=false User= Privileged=true",
    "DOCKER_CONTENT_TRUST=unset",
    "660 root root",
  ].join("\n");

  it("should return 20 checks for secure Docker setup", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    expect(checks).toHaveLength(20);
    checks.forEach((check) => {
      expect(check.category).toBe("Docker");
      expect(check.id).toMatch(/^DCK-[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/);
    });
  });

  it("should return DCK-NO-TCP-SOCKET passed when no TCP socket exposed", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const dck01 = checks.find((c) => c.id === "DCK-NO-TCP-SOCKET");
    expect(dck01!.passed).toBe(true);
  });

  it("should return DCK-NO-TCP-SOCKET failed when TCP socket exposed", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const dck01 = checks.find((c) => c.id === "DCK-NO-TCP-SOCKET");
    expect(dck01!.passed).toBe(false);
    expect(dck01!.severity).toBe("critical");
  });

  it("should return 20 checks as info/skipped when Docker not installed (N/A)", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(checks).toHaveLength(20);
    checks.forEach((check) => {
      expect(check.severity).toBe("info");
      expect(check.currentValue).toContain("Docker not installed");
    });
  });

  it("should return 20 checks as info/skipped for empty output on bare platform", () => {
    const checks = parseDockerChecks("", "bare");
    expect(checks).toHaveLength(20);
    checks.forEach((check) => {
      expect(check.severity).toBe("info");
    });
  });

  it("should handle coolify platform (Docker expected)", () => {
    const checks = parseDockerChecks("N/A", "coolify");
    expect(checks).toHaveLength(20);
    // On coolify, Docker missing is a warning not info
    const dck01 = checks.find((c) => c.id === "DCK-NO-TCP-SOCKET");
    expect(dck01!.severity).toBe("warning");
  });

  it("should handle dokploy platform (Docker expected)", () => {
    const checks = parseDockerChecks("N/A", "dokploy");
    expect(checks).toHaveLength(20);
    const dck01 = checks.find((c) => c.id === "DCK-NO-TCP-SOCKET");
    expect(dck01!.severity).toBe("warning");
  });

  it("should return DCK-LIVE-RESTORE passed when daemon.json has live-restore true", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const dck07 = checks.find((c) => c.id === "DCK-LIVE-RESTORE");
    expect(dck07!.passed).toBe(true);
    expect(dck07!.severity).toBe("warning");
  });

  it("should return DCK-TLS-VERIFY passed when no TCP socket exposed", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const dck10 = checks.find((c) => c.id === "DCK-TLS-VERIFY");
    expect(dck10!.passed).toBe(true);
    expect(dck10!.severity).toBe("critical");
  });

  it("should return DCK-TLS-VERIFY failed when TCP socket exposed without TLS", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const dck10 = checks.find((c) => c.id === "DCK-TLS-VERIFY");
    expect(dck10!.passed).toBe(false);
  });

  it("should return DCK-NO-ROOT-CONTAINERS passed when no running containers", () => {
    const checks = parseDockerChecks("N/A", "bare");
    const dck12 = checks.find((c) => c.id === "DCK-NO-ROOT-CONTAINERS");
    expect(dck12!.passed).toBe(true);
    expect(dck12!.currentValue).toContain("Docker not installed");
  });

  it("should return DCK-SECCOMP-ENABLED passed when no running containers", () => {
    const checks = parseDockerChecks("N/A", "bare");
    const dck16 = checks.find((c) => c.id === "DCK-SECCOMP-ENABLED");
    expect(dck16!.passed).toBe(true);
  });

  it("should return DCK-CONTENT-TRUST passed when DOCKER_CONTENT_TRUST=1", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const dck17 = checks.find((c) => c.id === "DCK-CONTENT-TRUST");
    expect(dck17!.passed).toBe(true);
  });

  it("should return DCK-CONTENT-TRUST failed when content trust not enabled", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const dck17 = checks.find((c) => c.id === "DCK-CONTENT-TRUST");
    expect(dck17!.passed).toBe(false);
  });
});
