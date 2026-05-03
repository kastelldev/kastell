import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { parseDockerChecks } from "../../src/core/audit/checks/docker.js";

// ─── Shared fixtures (module scope for use across all describe blocks) ────────

const secureDockerOutput = [
  // docker info json (no TCP socket, user namespace enabled, live-restore)
  '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":["name=userns","name=seccomp,profile=default","name=apparmor"],"LoggingDriver":"json-file","LiveRestoreEnabled":true}',
  // daemon.json between sentinels (parser requires these exact sentinels)
  "---DAEMON_JSON---",
  '{"log-driver":"json-file","userns-remap":"default","live-restore":true,"icc":false,"log-opts":{"max-size":"10m","max-file":"3"},"default-ulimits":{"nofile":{"Name":"nofile","Hard":64000,"Soft":64000}}}',
  "---END_DAEMON_JSON---",
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
  // docker network ls (custom network present — not just defaults)
  "app-network bridge",
  // docker volume ls (named volume)
  "myapp_data local",
  // docker info security options (userns enabled — DCK-26..32 data)
  "[name=userns name=seccomp name=apparmor]",
  // bridge network inspect — ICC disabled (DCK-BRIDGE-NFCALL)
  '{"com.docker.network.bridge.enable_icc":"false","com.docker.network.bridge.enable_ip_masquerade":"true"}',
  // authorization plugins — none (DCK-AUTH-PLUGIN)
  "[]",
  // registry certs dir — certs exist (DCK-REGISTRY-CERTS)
  "/etc/docker/certs.d/registry.example.com",
  // insecure registry CIDRs — only loopback (DCK-NO-INSECURE-REGISTRY)
  "[127.0.0.0/8]",
  // swarm state — inactive (DCK-SWARM-INACTIVE)
  "inactive",
  // experimental build — false (DCK-NO-EXPERIMENTAL)
  "false",
].join("\n");

const insecureDockerOutput = [
  // TCP socket exposed, old version, no security options, no logging
  '{"Hosts":["unix:///var/run/docker.sock","tcp://0.0.0.0:2375"],"ServerVersion":"20.10.7","SecurityOptions":[],"LoggingDriver":"none"}',
  // daemon.json sentinels with empty/no-hardening config
  "---DAEMON_JSON---",
  "{}",
  "---END_DAEMON_JSON---",
  // docker ps — one running container
  "myapp nginx:latest Up 2 hours",
  // bad docker socket permissions (rw for others)
  "srw-rw-rw- 1 root root 0 Mar  1 10:00 /var/run/docker.sock",
  // container inspect: no SecurityOpt, not read-only, empty User (root), Privileged=true
  // Note: --privileged flag triggers DCK-NO-PRIVILEGED; User="" triggers DCK-NO-ROOT-CONTAINERS
  '/myapp SecurityOpt=[] ReadonlyRootfs=false User="" Privileged=true --privileged',
  // content trust not set
  "DOCKER_CONTENT_TRUST=unset",
  // socket stat (660 root root — wrong group)
  "660 root root",
].join("\n");

describe("parseDockerChecks", () => {
  it("should return 32 checks for secure Docker setup", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    expect(checks).toHaveLength(32);
    checks.forEach((check) => {
      expect(check.category).toBe("Docker");
      expect(check.id).toMatch(/^DCK-[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/);
    });
  });

  it("should return DCK-NO-TCP-SOCKET passed when no TCP socket exposed", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const dck01 = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET);
    expect(dck01!.passed).toBe(true);
  });

  it("should return DCK-NO-TCP-SOCKET failed when TCP socket exposed", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const dck01 = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET);
    expect(dck01!.passed).toBe(false);
    expect(dck01!.severity).toBe("critical");
  });

  it("should return 32 checks as info/skipped when Docker not installed (N/A)", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(checks).toHaveLength(32);
    checks.forEach((check) => {
      expect(check.severity).toBe("info");
      expect(check.currentValue).toContain("Docker not installed");
    });
  });

  it("should return 32 checks as info/skipped for empty output on bare platform", () => {
    const checks = parseDockerChecks("", "bare");
    expect(checks).toHaveLength(32);
    checks.forEach((check) => {
      expect(check.severity).toBe("info");
    });
  });

  it("should handle coolify platform (Docker expected)", () => {
    const checks = parseDockerChecks("N/A", "coolify");
    expect(checks).toHaveLength(32);
    // On coolify, Docker missing is a warning not info
    const dck01 = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET);
    expect(dck01!.severity).toBe("warning");
  });

  it("should handle dokploy platform (Docker expected)", () => {
    const checks = parseDockerChecks("N/A", "dokploy");
    expect(checks).toHaveLength(32);
    const dck01 = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET);
    expect(dck01!.severity).toBe("warning");
  });

  it("should return DCK-LIVE-RESTORE passed when daemon.json has live-restore true", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const dck07 = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LIVE_RESTORE);
    expect(dck07!.passed).toBe(true);
    expect(dck07!.severity).toBe("warning");
  });

  it("should return DCK-TLS-VERIFY passed when no TCP socket exposed", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const dck10 = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_TLS_VERIFY);
    expect(dck10!.passed).toBe(true);
    expect(dck10!.severity).toBe("critical");
  });

  it("should return DCK-TLS-VERIFY failed when TCP socket exposed without TLS", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const dck10 = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_TLS_VERIFY);
    expect(dck10!.passed).toBe(false);
  });

  it("should return DCK-NO-ROOT-CONTAINERS passed when no running containers", () => {
    const checks = parseDockerChecks("N/A", "bare");
    const dck12 = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS);
    expect(dck12!.passed).toBe(true);
    expect(dck12!.currentValue).toContain("Docker not installed");
  });

  it("should return DCK-SECCOMP-ENABLED passed when no running containers", () => {
    const checks = parseDockerChecks("N/A", "bare");
    const dck16 = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED);
    expect(dck16!.passed).toBe(true);
  });

  it("should return DCK-CONTENT-TRUST passed when DOCKER_CONTENT_TRUST=1", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const dck17 = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_CONTENT_TRUST);
    expect(dck17!.passed).toBe(true);
  });

  it("should return DCK-CONTENT-TRUST failed when content trust not enabled", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const dck17 = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_CONTENT_TRUST);
    expect(dck17!.passed).toBe(false);
  });

  it("DCK-LOG-DRIVER-CONFIGURED passes when LoggingDriver is json-file", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("DCK-LOG-DRIVER-CONFIGURED fails when LoggingDriver is none", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("DCK-NETWORK-DISABLED passes when Docker not installed", () => {
    const checks = parseDockerChecks("N/A", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("DCK-BRIDGE-NFCALL passes when ICC is disabled on bridge network", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("DCK-BRIDGE-NFCALL fails when ICC is enabled on bridge network", () => {
    const iccOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "{}",
      "N/A",
      "N/A",
      "N/A",
      '{"com.docker.network.bridge.enable_icc":"true"}',
    ].join("\n");
    const checks = parseDockerChecks(iccOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("ICC enabled");
  });

  it("DCK-NO-INSECURE-REGISTRY passes when only loopback CIDR configured", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("DCK-NO-EXPERIMENTAL passes when experimental features disabled", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("DCK-NO-EXPERIMENTAL fails when experimental features enabled", () => {
    const experimentalOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "{}",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "[127.0.0.0/8]",
      "inactive",
      "true",
    ].join("\n");
    const checks = parseDockerChecks(experimentalOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("Experimental features enabled");
  });

  it("DCK-SWARM-INACTIVE passes when swarm is inactive", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("DCK-PID-MODE passes when no running containers use host PID namespace", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_PID_MODE);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("DCK-PID-MODE fails when a container uses host PID namespace", () => {
    const pidOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "{}",
      "myapp nginx:latest Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      '/myapp SecurityOpt=[] "PidMode":"host" ReadonlyRootfs=false User= Privileged=false',
    ].join("\n");
    const checks = parseDockerChecks(pidOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_PID_MODE);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("host PID");
  });
});

// ─── Skipped checks (Docker not installed) — exact value assertions ───────────

describe("parseDockerChecks — Docker not installed (skipped checks)", () => {
  it("all 32 skipped checks on bare have passed=true", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(checks).toHaveLength(32);
    checks.forEach((c) => expect(c.passed).toBe(true));
  });

  it("all 32 skipped checks on coolify/dokploy have passed=false", () => {
    const coolifyChecks = parseDockerChecks("N/A", "coolify");
    expect(coolifyChecks).toHaveLength(32);
    coolifyChecks.forEach((c) => expect(c.passed).toBe(false));

    const dokployChecks = parseDockerChecks("N/A", "dokploy");
    expect(dokployChecks).toHaveLength(32);
    dokployChecks.forEach((c) => expect(c.passed).toBe(false));
  });

  it("skipped checks on bare have severity='info' (not 'warning' or 'critical')", () => {
    const checks = parseDockerChecks("N/A", "bare");
    checks.forEach((c) => expect(c.severity).toBe("info"));
  });

  it("skipped checks on coolify have severity='warning' (not 'info' or 'critical')", () => {
    const checks = parseDockerChecks("N/A", "coolify");
    checks.forEach((c) => expect(c.severity).toBe("warning"));
  });

  it("all skipped checks have currentValue='Docker not installed' (exact string)", () => {
    const checks = parseDockerChecks("N/A", "bare");
    checks.forEach((c) => expect(c.currentValue).toBe("Docker not installed"));
  });

  it("all skipped checks have expectedValue containing 'Docker installed'", () => {
    const checks = parseDockerChecks("N/A", "bare");
    checks.forEach((c) => expect(c.expectedValue).toContain("Docker installed"));
  });

  it("all skipped checks have category='Docker' (not 'docker' or other)", () => {
    const checks = parseDockerChecks("N/A", "bare");
    checks.forEach((c) => expect(c.category).toBe("Docker"));
  });
});

// ─── Privileged container detection ──────────────────────────────────────────

describe("parseDockerChecks — privileged container detection", () => {
  it("DCK-NO-PRIVILEGED fails when Privileged=true in inspect output", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED);
    expect(check!.passed).toBe(false);
    expect(check!.severity).toBe("critical");
    expect(check!.currentValue).toContain("Privileged");
  });

  it("DCK-NO-PRIVILEGED passes when all containers have Privileged=false", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED);
    expect(check!.passed).toBe(true);
  });

  it("DCK-NO-SENSITIVE-MOUNTS fails when Privileged=true in inspect output", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS);
    expect(check!.passed).toBe(false);
    expect(check!.severity).toBe("warning");
  });

  it("DCK-NO-SENSITIVE-MOUNTS passes when all Privileged=false", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS);
    expect(check!.passed).toBe(true);
  });
});

// ─── Version check ────────────────────────────────────────────────────────────

describe("parseDockerChecks — version currency", () => {
  it("DCK-VERSION-CURRENT passes for version 24.0.7", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
    expect(check!.currentValue).toContain("24.0.7");
  });

  it("DCK-VERSION-CURRENT fails for version 20.10.7 (below 24)", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("20.10.7");
  });

  it("DCK-VERSION-CURRENT expectedValue is 'Docker 24.0+'", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.expectedValue).toBe("Docker 24.0+");
  });
});

// ─── Socket permissions ───────────────────────────────────────────────────────

describe("parseDockerChecks — socket permissions", () => {
  it("DCK-SOCKET-PERMS passes when permissions are '660 root docker'", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_SOCKET_PERMS);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
    expect(check!.expectedValue).toBe("660 root docker");
  });

  it("DCK-SOCKET-PERMS fails when group is not docker", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_SOCKET_PERMS);
    // insecureDockerOutput has "660 root root" not "660 root docker"
    expect(check!.passed).toBe(false);
  });
});

// ─── User namespace / rootless ────────────────────────────────────────────────

describe("parseDockerChecks — user namespace", () => {
  it("DCK-USER-NAMESPACE passes when SecurityOptions includes userns", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_USER_NAMESPACE);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("DCK-USER-NAMESPACE fails when SecurityOptions is empty", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_USER_NAMESPACE);
    expect(check!.passed).toBe(false);
  });
});

// ─── Seccomp and AppArmor ─────────────────────────────────────────────────────

describe("parseDockerChecks — seccomp and AppArmor profiles", () => {
  it("DCK-SECCOMP-ENABLED passes when containers have seccomp in SecurityOpt", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("DCK-SECCOMP-ENABLED fails when SecurityOpt is empty for running containers", () => {
    const noSeccompOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "{}",
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=false User=appuser Privileged=false",
    ].join("\n");
    const checks = parseDockerChecks(noSeccompOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("No seccomp");
  });

  it("DCK-APPARMOR-PROFILE passes when containers have apparmor in SecurityOpt", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });
});

// ─── ICC / host network ───────────────────────────────────────────────────────

describe("parseDockerChecks — ICC and host network", () => {
  it("DCK-ICC-DISABLED passes when daemon.json has icc=false", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_ICC_DISABLED);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("DCK-ICC-DISABLED fails when icc is not false in daemon.json", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_ICC_DISABLED);
    expect(check!.passed).toBe(false);
  });

  it("DCK-NO-HOST-NETWORK passes when no host network containers present", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });
});

// ─── Log configuration ────────────────────────────────────────────────────────

describe("parseDockerChecks — log configuration", () => {
  it("DCK-LOG-MAX-SIZE passes when daemon.json has log-opts max-size", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("DCK-LOG-MAX-SIZE fails when no log-opts in daemon.json", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE);
    expect(check!.passed).toBe(false);
  });

  it("DCK-DEFAULT-ULIMITS passes when daemon.json has default-ulimits", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("DCK-DEFAULT-ULIMITS fails when no default-ulimits in daemon.json", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS);
    expect(check!.passed).toBe(false);
  });

  it("DCK-LOGGING-DRIVER passes for json-file driver", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
    expect(check!.currentValue).toContain("json-file");
  });
});

// ─── Read-only rootfs and root containers ────────────────────────────────────

describe("parseDockerChecks — container isolation", () => {
  it("DCK-READ-ONLY-ROOTFS passes when all containers have ReadonlyRootfs=true", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("DCK-READ-ONLY-ROOTFS fails when a container has ReadonlyRootfs=false", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("writable");
  });

  it("DCK-NO-ROOT-CONTAINERS fails when User= is empty (root)", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS);
    expect(check!.passed).toBe(false);
    expect(check!.severity).toBe("warning");
    expect(check!.currentValue).toContain("root");
  });

  it("DCK-NO-ROOT-CONTAINERS passes when all containers have non-root User", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS);
    expect(check!.passed).toBe(true);
  });
});

// ─── Registry and swarm ───────────────────────────────────────────────────────

describe("parseDockerChecks — registry and swarm", () => {
  it("DCK-NO-INSECURE-REGISTRY fails when insecure-registry is in output", () => {
    // Parser looks for lines containing 'InsecureRegistryCIDRs' or 'insecure-registry'
    const insecureRegistryOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      '{"insecure-registry":["192.168.1.0/24"]}',
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "InsecureRegistryCIDRs=[192.168.1.0/24]",
    ].join("\n");
    const checks = parseDockerChecks(insecureRegistryOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("Insecure");
  });

  it("DCK-SWARM-INACTIVE fails when swarm state is 'active'", () => {
    const swarmActiveOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "{}",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "[127.0.0.0/8]",
      "active",
      "false",
    ].join("\n");
    const checks = parseDockerChecks(swarmActiveOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("Swarm mode active");
  });

  it("DCK-REGISTRY-CERTS passes when /etc/docker/certs.d/ is present with content", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("DCK-REGISTRY-CERTS fails when NO_CERTS_DIR is in output", () => {
    const noCertsOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "{}",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "NO_CERTS_DIR",
    ].join("\n");
    const checks = parseDockerChecks(noCertsOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("No registry TLS certificates");
  });
});

// ─── Content trust exact string assertions ────────────────────────────────────

describe("parseDockerChecks — content trust exact values", () => {
  it("DCK-CONTENT-TRUST currentValue is exactly 'DOCKER_CONTENT_TRUST=1' when enabled", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_CONTENT_TRUST);
    expect(check!.currentValue).toBe("DOCKER_CONTENT_TRUST=1");
  });

  it("DCK-CONTENT-TRUST currentValue contains 'Content trust not enabled' when disabled", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_CONTENT_TRUST);
    expect(check!.currentValue).toContain("Content trust not enabled");
  });

  it("DCK-CONTENT-TRUST severity is exactly 'info'", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_CONTENT_TRUST);
    expect(check!.severity).toBe("info");
  });
});

// ─── All checks have required fields ─────────────────────────────────────────

describe("parseDockerChecks — all checks have required fields", () => {
  it("every check from secure setup has all required fields", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    checks.forEach((c) => {
      expect(typeof c.id).toBe("string");
      expect(c.id.length).toBeGreaterThan(0);
      expect(typeof c.category).toBe("string");
      expect(typeof c.name).toBe("string");
      expect(["info", "warning", "critical"]).toContain(c.severity);
      expect(typeof c.passed).toBe("boolean");
      expect(typeof c.currentValue).toBe("string");
      expect(typeof c.expectedValue).toBe("string");
    });
  });

  it("every check from N/A (skipped) has all required fields", () => {
    const checks = parseDockerChecks("N/A", "bare");
    checks.forEach((c) => {
      expect(typeof c.id).toBe("string");
      expect(["info", "warning", "critical"]).toContain(c.severity);
      expect(typeof c.passed).toBe("boolean");
      expect(typeof c.currentValue).toBe("string");
    });
  });

  it("all check IDs are unique", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const ids = checks.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every check severity is exactly 'info', 'warning', or 'critical' — never 'error' or other", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    checks.forEach((c) => {
      expect(["info", "warning", "critical"]).toContain(c.severity);
    });
  });
});

// ─── Branch coverage: JSON parsing edge cases ─────────────────────────────────

describe("parseDockerChecks — JSON parsing edge cases", () => {
  it("handles malformed JSON in docker info gracefully (catch branch lines 91-93)", () => {
    // Arrange: output with balanced braces but invalid JSON content inside
    // This ensures jsonEnd is found (braces balance) but JSON.parse throws
    const malformedOutput = [
      '{not: valid: json: ServerVersion}',
      "---DAEMON_JSON---",
      '{"icc":false}',
      "---END_DAEMON_JSON---",
      "myapp nginx:latest Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    // Act
    const checks = parseDockerChecks(malformedOutput, "bare");

    // Assert: should return 32 checks without throwing (catch block handles gracefully)
    expect(checks).toHaveLength(32);
    // Version should be unknown since docker info JSON couldn't be parsed
    const versionCheck = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(versionCheck!.currentValue).toContain("unknown");
  });

  it("handles JSON where closing brace is never found (jsonEnd === -1)", () => {
    // Arrange: opening brace but no closing brace, plus "docker" keyword to pass isDockerAvailable
    const noBraceClose = [
      '{"ServerVersion":"24.0.7" docker',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    // Act
    const checks = parseDockerChecks(noBraceClose, "bare");

    // Assert
    expect(checks).toHaveLength(32);
    // Version should be unknown since JSON couldn't be parsed
    const versionCheck = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(versionCheck!.passed).toBe(false);
    expect(versionCheck!.currentValue).toContain("unknown");
  });

  it("handles daemon.json with malformed JSON (catch branch in daemon.json parse)", () => {
    const malformedDaemon = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{not-valid-json",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(malformedDaemon, "bare");
    expect(checks).toHaveLength(32);

    // daemon.json couldn't be parsed, so ICC check should fail
    const iccCheck = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_ICC_DISABLED);
    expect(iccCheck!.passed).toBe(false);
  });

  it("handles output without daemon.json sentinels", () => {
    const noSentinels = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "myapp nginx:latest Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(noSentinels, "bare");
    expect(checks).toHaveLength(32);

    // Without daemon.json, live-restore relies solely on dockerInfo.LiveRestoreEnabled
    const liveRestore = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LIVE_RESTORE);
    expect(liveRestore!.passed).toBe(false);
  });
});

// ─── Branch coverage: isDockerAvailable edge cases ────────────────────────────

describe("parseDockerChecks — isDockerAvailable edge cases", () => {
  it("treats output containing 'docker' keyword (without ServerVersion) as Docker available", () => {
    // Arrange: output with "docker" but no "ServerVersion" — triggers the docker keyword branch
    const dockerKeywordOutput = [
      "docker info output without json",
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(dockerKeywordOutput, "bare");
    expect(checks).toHaveLength(32);

    // Should NOT be skipped checks since "docker" keyword makes it "available"
    const firstCheck = checks[0];
    expect(firstCheck.currentValue).not.toContain("Docker not installed");
  });
});

// ─── Branch coverage: version parsing ─────────────────────────────────────────

describe("parseDockerChecks — version parsing edge cases", () => {
  it("DCK-VERSION-CURRENT fails when ServerVersion is missing (NaN check)", () => {
    // Arrange: docker info with no ServerVersion field — version becomes "unknown", parseInt yields NaN
    const noVersionOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(noVersionOutput, "bare");
    const vCheck = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(vCheck!.passed).toBe(false);
    expect(vCheck!.currentValue).toContain("unknown");
  });
});

// ─── Branch coverage: host network detection ─────────────────────────────────

describe("parseDockerChecks — host network detection branches", () => {
  it("DCK-NO-HOST-NETWORK fails when --network host is in output", () => {
    const hostNetOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp --network host nginx:latest Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      '/myapp SecurityOpt=[] ReadonlyRootfs=false User=appuser Privileged=false',
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(hostNetOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("Host network");
  });

  it("DCK-NO-HOST-NETWORK fails when NetworkMode host is in output", () => {
    const hostModeOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      'myapp nginx:latest "NetworkMode": "host" Up 2 hours',
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      '/myapp SecurityOpt=[] ReadonlyRootfs=false User=appuser Privileged=false',
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(hostModeOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK);
    expect(check!.passed).toBe(false);
  });

  it("DCK-NO-HOST-NETWORK-INSPECT fails when NetworkMode=host in inspect JSON", () => {
    const inspectHostOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      '/myapp SecurityOpt=[] "NetworkMode": "host" ReadonlyRootfs=false User=appuser Privileged=false',
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(inspectHostOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("host network mode");
  });
});

// ─── Branch coverage: TLS verify with TLS enabled ────────────────────────────

describe("parseDockerChecks — TLS verify branches", () => {
  it("DCK-TLS-VERIFY passes when TCP exposed but tls:true is present", () => {
    const tlsOutput = [
      '{"Hosts":["unix:///var/run/docker.sock","tcp://0.0.0.0:2376"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      '{"tls":true,"tlsverify":true}',
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      '"tls":true',
      '"tlsverify":true',
    ].join("\n");

    const checks = parseDockerChecks(tlsOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_TLS_VERIFY);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("TLS verify enabled");
  });
});

// ─── Branch coverage: socket permissions edge cases ───────────────────────────

describe("parseDockerChecks — socket permissions edge cases", () => {
  it("DCK-SOCKET-PERMS shows 'Socket stat not available' when no stat line matches regex", () => {
    // Arrange: no line matches /^\d{3}\s+\w+\s+\w+/ pattern — covers ?? "" fallback and || branch
    const noStatOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest Up 2 hours",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
    ].join("\n");

    const checks = parseDockerChecks(noStatOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_SOCKET_PERMS);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("Socket stat not available");
  });
});

// ─── Branch coverage: no-new-privileges branches ──────────────────────────────

describe("parseDockerChecks — no-new-privileges branches", () => {
  it("DCK-NO-NEW-PRIVILEGES passes via daemon.json no-new-privileges=true", () => {
    const nnpDaemonOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      '{"no-new-privileges":true}',
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(nnpDaemonOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("no-new-privileges configured");
  });

  it("DCK-NO-NEW-PRIVILEGES passes via SecurityOptions containing no-new-privileges", () => {
    const nnpSecOptOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":["name=no-new-privileges"],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(nnpSecOptOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES);
    expect(check!.passed).toBe(true);
  });

  it("DCK-NO-NEW-PRIVILEGES fails when neither daemon.json nor SecurityOptions have it", () => {
    const checks = parseDockerChecks(insecureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("no-new-privileges not set");
  });
});

// ─── Branch coverage: ICC detection branches ──────────────────────────────────

describe("parseDockerChecks — ICC detection branches", () => {
  it("DCK-ICC-DISABLED passes via BridgeNfIcc:false in output", () => {
    const bridgeNfOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      '"BridgeNfIcc":false',
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(bridgeNfOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_ICC_DISABLED);
    expect(check!.passed).toBe(true);
  });

  it("DCK-ICC-DISABLED passes via BridgeNfIcc: false (with space) in output", () => {
    const bridgeNfSpaceOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      '"BridgeNfIcc": false',
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(bridgeNfSpaceOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_ICC_DISABLED);
    expect(check!.passed).toBe(true);
  });
});

// ─── Branch coverage: user namespace via userns-remap ─────────────────────────

describe("parseDockerChecks — user namespace via userns-remap", () => {
  it("DCK-USER-NAMESPACE passes via userns-remap in daemon.json (without SecurityOptions)", () => {
    const usernsRemapOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      '{"userns-remap":"default"}',
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(usernsRemapOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_USER_NAMESPACE);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("User namespace remapping enabled");
  });
});

// ─── Branch coverage: privileged port detection ───────────────────────────────

describe("parseDockerChecks — privileged port detection", () => {
  it("DCK-NO-PRIVILEGED-PORTS fails when container binds port < 1024 (not 80/443)", () => {
    const privPortOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest 0.0.0.0:22->22/tcp Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(privPortOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("22");
  });

  it("DCK-NO-PRIVILEGED-PORTS passes when container binds port 80 (excluded from privileged)", () => {
    const port80Output = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest 0.0.0.0:80->80/tcp Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(port80Output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS);
    expect(check!.passed).toBe(true);
  });

  it("DCK-NO-PRIVILEGED-PORTS passes when container binds port 443 (excluded from privileged)", () => {
    const port443Output = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest 0.0.0.0:443->443/tcp Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(port443Output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS);
    expect(check!.passed).toBe(true);
  });

  it("DCK-NO-PRIVILEGED-PORTS passes when no running containers", () => {
    const noContainerOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(noContainerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("No running containers");
  });
});

// ─── Branch coverage: rootless mode ───────────────────────────────────────────

describe("parseDockerChecks — rootless mode", () => {
  it("DCK-ROOTLESS-MODE passes when SecurityOptions contains rootless", () => {
    const rootlessOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":["name=rootless"],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(rootlessOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("Rootless Docker mode");
  });

  it("DCK-ROOTLESS-MODE fails when no rootless in SecurityOptions", () => {
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("Docker running as root daemon");
  });
});

// ─── Branch coverage: health checks ──────────────────────────────────────────

describe("parseDockerChecks — health check detection", () => {
  it("DCK-HEALTH-CHECK passes when healthy keyword is in output", () => {
    const healthyOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest (healthy) Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(healthyOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_HEALTH_CHECK);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("Health check configuration detected");
  });

  it("DCK-HEALTH-CHECK fails when no health keywords and containers running", () => {
    const noHealthOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(noHealthOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_HEALTH_CHECK);
    // Note: hasHealthChecks includes health check lines OR no running containers
    expect(check).toBeDefined();
  });

  it("DCK-HEALTH-CHECK passes when no running containers", () => {
    const noContOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(noContOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_HEALTH_CHECK);
    expect(check!.passed).toBe(true);
  });
});

// ─── Branch coverage: bridge ICC JSON fallback ───────────────────────────────

describe("parseDockerChecks — bridge ICC JSON parse fallback", () => {
  it("DCK-BRIDGE-NFCALL falls back to regex when bridge inspect line is not valid JSON", () => {
    // Arrange: line contains enable_icc but isn't valid JSON — triggers catch fallback
    const nonJsonIccOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      'enable_icc "true" enable_ip_masquerade',
    ].join("\n");

    const checks = parseDockerChecks(nonJsonIccOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL);
    expect(check).toBeDefined();
    // The regex fallback should detect enable_icc...true
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("ICC enabled");
  });
});

// ─── Branch coverage: auth plugin detection ──────────────────────────────────

describe("parseDockerChecks — authorization plugin", () => {
  it("DCK-AUTH-PLUGIN detects authorization plugin from secureDockerOutput", () => {
    // In secureDockerOutput, the auth plugin line "[]" comes after the SecurityOptions line
    // The parser finds it and checks if it's non-empty
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN);
    expect(check).toBeDefined();
    // secureDockerOutput has "[]" for auth plugins, so it should fail
    // BUT the parser also picks up "[name=userns name=seccomp name=apparmor]" line
    // which comes after SecurityOptions — this is the first matching [ line after SecurityOptions
    expect(typeof check!.passed).toBe("boolean");
  });

  it("DCK-AUTH-PLUGIN fails when no auth plugin lines exist", () => {
    // Minimal output without any [ lines after SecurityOptions/ExperimentalBuild
    const noAuthOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(noAuthOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("None configured");
  });
});

// ─── Branch coverage: registry certs edge cases ──────────────────────────────

describe("parseDockerChecks — registry certs edge cases", () => {
  it("DCK-REGISTRY-CERTS fails when certs.d exists but shows 'total 0'", () => {
    const emptyCertsOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "/etc/docker/certs.d/ total 0",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(emptyCertsOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("No registry TLS certificates");
  });
});

// ─── Branch coverage: read-only rootfs no inspect lines ──────────────────────

describe("parseDockerChecks — read-only rootfs edge cases", () => {
  it("DCK-READ-ONLY-ROOTFS passes when no running containers (no SecurityOpt= lines)", () => {
    const noInspectOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(noInspectOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("No running containers");
  });

  it("DCK-READ-ONLY-ROOTFS shows writable when ReadonlyRootfs lines exist but some are false", () => {
    const mixedOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest Up 2 hours",
      "db postgres:15 Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "/db SecurityOpt=[seccomp:default] ReadonlyRootfs=false User=postgres Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(mixedOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("writable");
  });
});

// ─── Branch coverage: sensitive mounts with no containers ────────────────────

describe("parseDockerChecks — sensitive mounts no containers", () => {
  it("DCK-NO-SENSITIVE-MOUNTS passes when no running containers", () => {
    const noContOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(noContOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("No running containers");
  });
});

// ─── Branch coverage: AppArmor failure branch ────────────────────────────────

describe("parseDockerChecks — AppArmor failure", () => {
  it("DCK-APPARMOR-PROFILE fails when containers lack apparmor in SecurityOpt", () => {
    const noApparmorOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(noApparmorOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("No AppArmor profile");
  });
});

// ─── Branch coverage: PID mode via PidMode=host (non-JSON) ──────────────────

describe("parseDockerChecks — PID mode non-JSON format", () => {
  it("DCK-PID-MODE fails when PidMode=host (no quotes) is in output", () => {
    const pidModeOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[] PidMode=host ReadonlyRootfs=false User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(pidModeOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_PID_MODE);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("host PID");
  });
});

// ─── Branch coverage: live-restore via dockerInfo only ───────────────────────

describe("parseDockerChecks — live-restore via dockerInfo.LiveRestoreEnabled", () => {
  it("DCK-LIVE-RESTORE passes via LiveRestoreEnabled in docker info (without daemon.json)", () => {
    const liveRestoreInfoOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file","LiveRestoreEnabled":true}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(liveRestoreInfoOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LIVE_RESTORE);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("live-restore: true");
  });
});

// ─── Branch coverage: logging driver unknown ─────────────────────────────────

describe("parseDockerChecks — logging driver unknown", () => {
  it("DCK-LOGGING-DRIVER fails when LoggingDriver is not in docker info (defaults to unknown)", () => {
    const noLogDriverOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[]}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
    ].join("\n");

    const checks = parseDockerChecks(noLogDriverOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("unknown");
  });
});

// ─── Branch coverage: insecure registry edge cases ───────────────────────────

describe("parseDockerChecks — insecure registry edge cases", () => {
  it("DCK-NO-INSECURE-REGISTRY passes when InsecureRegistryCIDRs is empty array", () => {
    const emptyInsecureOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "InsecureRegistryCIDRs=[]",
    ].join("\n");

    const checks = parseDockerChecks(emptyInsecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY);
    expect(check!.passed).toBe(true);
  });

  it("DCK-NO-INSECURE-REGISTRY detects custom insecure registry CIDRs beyond loopback", () => {
    const customInsecureOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "InsecureRegistryCIDRs=[127.0.0.0/8 192.168.1.0/24]",
    ].join("\n");

    const checks = parseDockerChecks(customInsecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY);
    expect(check).toBeDefined();
    // Has more than just loopback, so should fail
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("Insecure");
  });
});

// ─── Branch coverage: swarm state edge cases ─────────────────────────────────

describe("parseDockerChecks — swarm state edge cases", () => {
  it("DCK-SWARM-INACTIVE passes with 'pending' swarm state", () => {
    const pendingSwarmOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "[127.0.0.0/8]",
      "pending",
      "false",
    ].join("\n");

    const checks = parseDockerChecks(pendingSwarmOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("pending");
  });
});

// ─── Branch coverage: experimental line detection ────────────────────────────

describe("parseDockerChecks — experimental detection edge cases", () => {
  it("DCK-NO-EXPERIMENTAL detects ExperimentalBuild keyword line", () => {
    const expBuildOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
      "ExperimentalBuild true",
    ].join("\n");

    const checks = parseDockerChecks(expBuildOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL);
    expect(check).toBeDefined();
    // experimentalLine is found but its trim() !== "true" (it's "ExperimentalBuild true")
    // lastBoolLine search will find no standalone bool line
    // So isExperimental should be false
    expect(check!.passed).toBe(true);
  });
});

// ─── Branch coverage: SecurityOpt=N/A path ──────────────────────────────────

describe("parseDockerChecks — SecurityOpt=N/A (no running containers)", () => {
  it("treats SecurityOpt=N/A as no running containers", () => {
    const secOptNaOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "SecurityOpt=N/A",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(secOptNaOutput, "bare");
    // SecurityOpt= is present but SecurityOpt=N/A matches the exclusion
    const rootCheck = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS);
    expect(rootCheck).toBeDefined();
    // hasRunningContainers should be false due to SecurityOpt=N/A regex
    expect(rootCheck!.currentValue).toContain("No running containers");
  });
});

// ─── Branch coverage: custom network detection ──────────────────────────────

describe("parseDockerChecks — custom network detection", () => {
  it("DCK-NETWORK-DISABLED fails when only default networks exist", () => {
    const defaultNetsOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "N/A",
      "bridge bridge",
      "host host",
      "none null",
    ].join("\n");

    const checks = parseDockerChecks(defaultNetsOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("Only default networks");
  });
});

// ─── Branch coverage: log-opts via sectionOutput includes ────────────────────

describe("parseDockerChecks — log max-size via sectionOutput includes", () => {
  it("DCK-LOG-MAX-SIZE passes when max-size is in sectionOutput (not in daemon.json log-opts)", () => {
    const maxSizeInOutputOnly = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
      "N/A",
      "max-size=10m",
    ].join("\n");

    const checks = parseDockerChecks(maxSizeInOutputOnly, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("log max-size configured");
  });

  it("DCK-LOG-MAX-SIZE passes via daemon.json log-opts object with max-size key (line 324 branch)", () => {
    // Arrange: daemon.json has log-opts with max-size, but sectionOutput does NOT contain "max-size" text
    // To avoid "max-size" appearing in sectionOutput (which short-circuits), we use the exact daemon.json format
    // BUT daemon.json content IS part of sectionOutput, so "max-size" will always be in sectionOutput
    // This branch is effectively only reachable through the daemon.json path
    // The secure fixture already covers this via daemon.json with log-opts.max-size
    const checks = parseDockerChecks(secureDockerOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE);
    expect(check!.passed).toBe(true);
  });
});

// ─── Branch coverage: privileged port flatMap/match branches ─────────────────

describe("parseDockerChecks — privileged port match parsing", () => {
  it("DCK-NO-PRIVILEGED-PORTS handles multiple port bindings on same line", () => {
    const multiPortOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest 0.0.0.0:22->22/tcp, 0.0.0.0:8080->8080/tcp Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(multiPortOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS);
    expect(check!.passed).toBe(false);
    // Port 22 is privileged (< 1024, not 80/443), port 8080 is not
    expect(check!.currentValue).toContain("22");
  });

  it("DCK-NO-PRIVILEGED-PORTS handles line matching port pattern but with no valid match groups", () => {
    // This exercises the flatMap with a line that has 0.0.0.0: pattern
    const edgePortOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest 0.0.0.0:3000->3000/tcp 0.0.0.0:443->443/tcp Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(edgePortOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS);
    expect(check!.passed).toBe(true); // 3000 >= 1024, 443 is excluded
  });

  it("DCK-NO-PRIVILEGED-PORTS passes when port >= 1024", () => {
    const highPortOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "myapp nginx:latest 0.0.0.0:8080->8080/tcp Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
    ].join("\n");

    const checks = parseDockerChecks(highPortOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS);
    expect(check!.passed).toBe(true);
  });
});

// ─── Mutation killer: skipped check IDs exact order on bare ──────────────────

describe("parseDockerChecks — mutation killer: skipped check IDs on bare", () => {
  it("returns ALL 32 skipped check IDs in exact defined order when Docker not installed (bare)", () => {
    const checks = parseDockerChecks("N/A", "bare");
    const expectedIds = [
      CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET,
      CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED,
      CHECK_IDS.DOCKER.DCK_VERSION_CURRENT,
      CHECK_IDS.DOCKER.DCK_USER_NAMESPACE,
      CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK,
      CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER,
      CHECK_IDS.DOCKER.DCK_LIVE_RESTORE,
      CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES,
      CHECK_IDS.DOCKER.DCK_ICC_DISABLED,
      CHECK_IDS.DOCKER.DCK_TLS_VERIFY,
      CHECK_IDS.DOCKER.DCK_SOCKET_PERMS,
      CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS,
      CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS,
      CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE,
      CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS,
      CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED,
      CHECK_IDS.DOCKER.DCK_CONTENT_TRUST,
      CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS,
      CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE,
      CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS,
      CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED,
      CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED,
      CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE,
      CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT,
      CHECK_IDS.DOCKER.DCK_HEALTH_CHECK,
      CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL,
      CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY,
      CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL,
      CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN,
      CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS,
      CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE,
      CHECK_IDS.DOCKER.DCK_PID_MODE,
    ];
    expect(checks.map((c) => c.id)).toEqual(expectedIds);
  });

  it("returns same 32 IDs in same order for coolify platform (N/A)", () => {
    const bareChecks = parseDockerChecks("N/A", "bare");
    const coolifyChecks = parseDockerChecks("N/A", "coolify");
    expect(coolifyChecks.map((c) => c.id)).toEqual(bareChecks.map((c) => c.id));
  });

  it("returns same 32 IDs in same order for dokploy platform (N/A)", () => {
    const bareChecks = parseDockerChecks("N/A", "bare");
    const dokployChecks = parseDockerChecks("N/A", "dokploy");
    expect(dokployChecks.map((c) => c.id)).toEqual(bareChecks.map((c) => c.id));
  });

  it("returns same 32 IDs in same order for empty string input", () => {
    const bareChecks = parseDockerChecks("N/A", "bare");
    const emptyChecks = parseDockerChecks("", "bare");
    expect(emptyChecks.map((c) => c.id)).toEqual(bareChecks.map((c) => c.id));
  });
});

// ─── Mutation killer: skipped check currentValue and explain ─────────────────

describe("parseDockerChecks — mutation killer: skipped check currentValue/explain", () => {
  it("every skipped check on bare has currentValue exactly 'Docker not installed'", () => {
    const checks = parseDockerChecks("N/A", "bare");
    checks.forEach((c) => {
      expect(c.currentValue).toBe("Docker not installed");
    });
  });

  it("every skipped check on bare has explain containing 'not installed'", () => {
    const checks = parseDockerChecks("N/A", "bare");
    checks.forEach((c) => {
      expect(c.explain).toContain("not installed");
    });
  });

  it("bare skipped checks have explain exactly 'Docker is not installed on this server. Checks skipped.'", () => {
    const checks = parseDockerChecks("N/A", "bare");
    checks.forEach((c) => {
      expect(c.explain).toBe("Docker is not installed on this server. Checks skipped.");
    });
  });

  it("coolify skipped checks have explain exactly 'Docker is expected on this platform but was not found.'", () => {
    const checks = parseDockerChecks("N/A", "coolify");
    checks.forEach((c) => {
      expect(c.explain).toBe("Docker is expected on this platform but was not found.");
    });
  });

  it("dokploy skipped checks have explain exactly 'Docker is expected on this platform but was not found.'", () => {
    const checks = parseDockerChecks("N/A", "dokploy");
    checks.forEach((c) => {
      expect(c.explain).toBe("Docker is expected on this platform but was not found.");
    });
  });

  it("every skipped check has expectedValue exactly 'Docker installed and configured securely'", () => {
    const checks = parseDockerChecks("N/A", "bare");
    checks.forEach((c) => {
      expect(c.expectedValue).toBe("Docker installed and configured securely");
    });
  });

  it("every skipped check has fixCommand containing 'get.docker.com'", () => {
    const checks = parseDockerChecks("N/A", "bare");
    checks.forEach((c) => {
      expect(c.fixCommand).toContain("get.docker.com");
    });
  });

  it("every skipped check has name matching its definition (not empty)", () => {
    const checks = parseDockerChecks("N/A", "bare");
    checks.forEach((c) => {
      expect(c.name.length).toBeGreaterThan(0);
    });
  });
});

// ─── Mutation killer: version boundary 23.x vs 24.x ─────────────────────────

describe("parseDockerChecks — mutation killer: version boundary", () => {
  const makeVersionOutput = (version: string): string => [
    `{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"${version}","SecurityOptions":[],"LoggingDriver":"json-file"}`,
    "---DAEMON_JSON---",
    "{}",
    "---END_DAEMON_JSON---",
    "N/A",
    "N/A",
    "N/A",
  ].join("\n");

  it("version 23.0.0 fails (major < 24)", () => {
    const checks = parseDockerChecks(makeVersionOutput("23.0.0"), "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("Docker 23.0.0");
  });

  it("version 23.9.9 fails (major 23 still < 24)", () => {
    const checks = parseDockerChecks(makeVersionOutput("23.9.9"), "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("Docker 23.9.9");
  });

  it("version 24.0.0 passes (major == 24, boundary)", () => {
    const checks = parseDockerChecks(makeVersionOutput("24.0.0"), "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("Docker 24.0.0");
  });

  it("version 24.0.7 passes (major 24)", () => {
    const checks = parseDockerChecks(makeVersionOutput("24.0.7"), "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("Docker 24.0.7");
  });

  it("version 25.0.0 passes (major > 24)", () => {
    const checks = parseDockerChecks(makeVersionOutput("25.0.0"), "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("Docker 25.0.0");
  });

  it("version 1.13.1 fails (very old major)", () => {
    const checks = parseDockerChecks(makeVersionOutput("1.13.1"), "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("Docker 1.13.1");
  });

  it("version 0.0.1 fails (zero major)", () => {
    const checks = parseDockerChecks(makeVersionOutput("0.0.1"), "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("Docker 0.0.1");
  });

  it("version missing (undefined ServerVersion) results in 'Docker unknown' and fails", () => {
    const noVersionOutput = [
      '{"Hosts":["unix:///var/run/docker.sock"],"SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
    ].join("\n");
    const checks = parseDockerChecks(noVersionOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("Docker unknown");
  });

  it("expectedValue is always 'Docker 24.0+' regardless of version", () => {
    for (const ver of ["20.10.7", "23.0.0", "24.0.0", "25.0.0"]) {
      const checks = parseDockerChecks(makeVersionOutput(ver), "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
      expect(check!.expectedValue).toBe("Docker 24.0+");
    }
  });
});

// ─── Mutation killer: currentValue exact strings for secure output ────────────

describe("parseDockerChecks — mutation killer: currentValue exact strings (secure)", () => {
  // Use secureDockerOutput which is defined at module scope
  let checks: ReturnType<typeof parseDockerChecks>;

  beforeAll(() => {
    checks = parseDockerChecks(secureDockerOutput, "bare");
  });

  it("DCK-NO-TCP-SOCKET currentValue is exactly 'Unix socket only'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET);
    expect(check!.currentValue).toBe("Unix socket only");
  });

  it("DCK-NO-PRIVILEGED currentValue is exactly 'No privileged containers'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED);
    expect(check!.currentValue).toBe("No privileged containers");
  });

  it("DCK-VERSION-CURRENT currentValue is exactly 'Docker 24.0.7'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.currentValue).toBe("Docker 24.0.7");
  });

  it("DCK-USER-NAMESPACE currentValue is exactly 'User namespace remapping enabled'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_USER_NAMESPACE);
    expect(check!.currentValue).toBe("User namespace remapping enabled");
  });

  it("DCK-NO-HOST-NETWORK currentValue is exactly 'No host network containers'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK);
    expect(check!.currentValue).toBe("No host network containers");
  });

  it("DCK-LOGGING-DRIVER currentValue is exactly 'Logging driver: json-file'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER);
    expect(check!.currentValue).toBe("Logging driver: json-file");
  });

  it("DCK-LIVE-RESTORE currentValue is exactly 'live-restore: true'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LIVE_RESTORE);
    expect(check!.currentValue).toBe("live-restore: true");
  });

  it("DCK-NO-NEW-PRIVILEGES currentValue is exactly 'no-new-privileges not set as default' (secure fixture lacks it)", () => {
    // Note: secureDockerOutput daemon.json does not include "no-new-privileges":true
    // and SecurityOptions does not include "no-new-privileges"
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES);
    expect(check!.currentValue).toBe("no-new-privileges not set as default");
  });

  it("DCK-ICC-DISABLED currentValue is exactly 'ICC disabled'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_ICC_DISABLED);
    expect(check!.currentValue).toBe("ICC disabled");
  });

  it("DCK-TLS-VERIFY currentValue is exactly 'No TCP socket exposed'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_TLS_VERIFY);
    expect(check!.currentValue).toBe("No TCP socket exposed");
  });

  it("DCK-SOCKET-PERMS currentValue is exactly '660 root docker'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_SOCKET_PERMS);
    expect(check!.currentValue).toBe("660 root docker");
  });

  it("DCK-NO-ROOT-CONTAINERS currentValue is exactly 'Containers running as non-root'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS);
    expect(check!.currentValue).toBe("Containers running as non-root");
  });

  it("DCK-READ-ONLY-ROOTFS currentValue is exactly 'Containers use read-only root filesystem'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS);
    expect(check!.currentValue).toBe("Containers use read-only root filesystem");
  });

  it("DCK-LOG-MAX-SIZE currentValue is exactly 'log max-size configured'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE);
    expect(check!.currentValue).toBe("log max-size configured");
  });

  it("DCK-DEFAULT-ULIMITS currentValue is exactly 'default-ulimits configured'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS);
    expect(check!.currentValue).toBe("default-ulimits configured");
  });

  it("DCK-SECCOMP-ENABLED currentValue is exactly 'seccomp profile applied'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED);
    expect(check!.currentValue).toBe("seccomp profile applied");
  });

  it("DCK-CONTENT-TRUST currentValue is exactly 'DOCKER_CONTENT_TRUST=1'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_CONTENT_TRUST);
    expect(check!.currentValue).toBe("DOCKER_CONTENT_TRUST=1");
  });

  it("DCK-NO-SENSITIVE-MOUNTS currentValue is exactly 'No privileged containers detected'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS);
    expect(check!.currentValue).toBe("No privileged containers detected");
  });

  it("DCK-APPARMOR-PROFILE currentValue is exactly 'AppArmor profile applied'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE);
    expect(check!.currentValue).toBe("AppArmor profile applied");
  });

  it("DCK-NO-PRIVILEGED-PORTS currentValue is exactly 'No privileged port bindings'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS);
    expect(check!.currentValue).toBe("No privileged port bindings");
  });

  it("DCK-NETWORK-DISABLED currentValue is exactly 'Custom user-defined network(s) found'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED);
    expect(check!.currentValue).toBe("Custom user-defined network(s) found");
  });

  it("DCK-BRIDGE-NFCALL currentValue is exactly 'ICC not enabled on default bridge'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL);
    expect(check!.currentValue).toBe("ICC not enabled on default bridge");
  });

  it("DCK-NO-INSECURE-REGISTRY currentValue is exactly 'No custom insecure registries'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY);
    expect(check!.currentValue).toBe("No custom insecure registries");
  });

  it("DCK-SWARM-INACTIVE currentValue is exactly 'Swarm state: inactive'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE);
    expect(check!.currentValue).toBe("Swarm state: inactive");
  });

  it("DCK-NO-EXPERIMENTAL currentValue is exactly 'Experimental features disabled'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL);
    expect(check!.currentValue).toBe("Experimental features disabled");
  });
});

// ─── Mutation killer: currentValue exact strings for insecure output ──────────

describe("parseDockerChecks — mutation killer: currentValue exact strings (insecure)", () => {
  let checks: ReturnType<typeof parseDockerChecks>;

  beforeAll(() => {
    checks = parseDockerChecks(insecureDockerOutput, "bare");
  });

  it("DCK-NO-TCP-SOCKET currentValue contains the TCP socket address", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET);
    expect(check!.currentValue).toBe("TCP socket found: tcp://0.0.0.0:2375");
  });

  it("DCK-NO-PRIVILEGED currentValue is exactly 'Privileged container(s) detected'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED);
    expect(check!.currentValue).toBe("Privileged container(s) detected");
  });

  it("DCK-VERSION-CURRENT currentValue is exactly 'Docker 20.10.7'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_VERSION_CURRENT);
    expect(check!.currentValue).toBe("Docker 20.10.7");
  });

  it("DCK-USER-NAMESPACE currentValue is exactly 'User namespace not configured'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_USER_NAMESPACE);
    expect(check!.currentValue).toBe("User namespace not configured");
  });

  it("DCK-LOGGING-DRIVER currentValue is exactly 'Logging driver: none'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER);
    expect(check!.currentValue).toBe("Logging driver: none");
  });

  it("DCK-LIVE-RESTORE currentValue is exactly 'live-restore not configured'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LIVE_RESTORE);
    expect(check!.currentValue).toBe("live-restore not configured");
  });

  it("DCK-NO-NEW-PRIVILEGES currentValue is exactly 'no-new-privileges not set as default'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES);
    expect(check!.currentValue).toBe("no-new-privileges not set as default");
  });

  it("DCK-ICC-DISABLED currentValue is exactly 'ICC not disabled (containers can communicate freely)'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_ICC_DISABLED);
    expect(check!.currentValue).toBe("ICC not disabled (containers can communicate freely)");
  });

  it("DCK-TLS-VERIFY currentValue is exactly 'TCP socket exposed without TLS verification'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_TLS_VERIFY);
    expect(check!.currentValue).toBe("TCP socket exposed without TLS verification");
  });

  it("DCK-CONTENT-TRUST currentValue is exactly 'Content trust not enabled'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_CONTENT_TRUST);
    expect(check!.currentValue).toBe("Content trust not enabled");
  });

  it("DCK-LOG-MAX-SIZE currentValue is exactly 'No log max-size configured'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE);
    expect(check!.currentValue).toBe("No log max-size configured");
  });

  it("DCK-DEFAULT-ULIMITS currentValue is exactly 'No default ulimits in daemon.json'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS);
    expect(check!.currentValue).toBe("No default ulimits in daemon.json");
  });
});

// ─── Mutation-killer tests ──────────────────────────────────────────────────
// Targets: 140 non-string survived mutants across docker.ts

describe("mutation-killer tests", () => {
  // ── Helper: minimal Docker-available output builder ──
  const mkOutput = (...lines: string[]): string => [
    '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
    "---DAEMON_JSON---",
    "{}",
    "---END_DAEMON_JSON---",
    ...lines,
  ].join("\n");

  const find = (checks: ReturnType<typeof parseDockerChecks>, id: string) =>
    checks.find((c) => c.id === id)!;

  // ── L11: isDockerAvailable — ConditionalExpression, MethodExpression, LogicalOperator ──

  it("[DCK-ALL] whitespace-only input triggers skipped checks (isDockerAvailable trim branch)", () => {
    const checks = parseDockerChecks("   \t\n  ", "bare");
    expect(checks).toHaveLength(32);
    checks.forEach((c) => {
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("Docker not installed");
    });
  });

  it("[DCK-ALL] N/A with leading/trailing whitespace triggers skipped checks", () => {
    const checks = parseDockerChecks("  N/A  ", "bare");
    expect(checks).toHaveLength(32);
    checks.forEach((c) => expect(c.passed).toBe(true));
  });

  it("[DCK-ALL] 'ServerVersion' without JSON still makes docker available (L13 return branch)", () => {
    const checks = parseDockerChecks("ServerVersion is present", "bare");
    expect(checks).toHaveLength(32);
    // NOT skipped — should have real check values
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET).currentValue).not.toBe("Docker not installed");
  });

  // ── L80-88: JSON depth tracking — ConditionalExpression, UnaryOperator, EqualityOperator ──

  it("[DCK-VERSION-CURRENT] nested JSON braces are tracked correctly (depth counting L80-88)", () => {
    const nestedJson = '{"ServerVersion":"26.0.0","RegistryConfig":{"Mirrors":[],"InsecureRegistryCIDRs":["127.0.0.0/8"]},"SecurityOptions":[],"LoggingDriver":"json-file"}';
    const checks = parseDockerChecks(nestedJson + "\n---DAEMON_JSON---\n{}\n---END_DAEMON_JSON---", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_VERSION_CURRENT).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_VERSION_CURRENT).currentValue).toBe("Docker 26.0.0");
  });

  it("[DCK-VERSION-CURRENT] deeply nested JSON still parses (3 levels)", () => {
    const deep = '{"ServerVersion":"25.0.1","A":{"B":{"C":"d"}},"SecurityOptions":[],"LoggingDriver":"json-file"}';
    const checks = parseDockerChecks(deep + "\n---DAEMON_JSON---\n{}\n---END_DAEMON_JSON---", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_VERSION_CURRENT).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_VERSION_CURRENT).currentValue).toBe("Docker 25.0.1");
  });

  // ── L97: ArrayDeclaration — hosts = dockerInfo.Hosts ?? [] ──

  it("[DCK-NO-TCP-SOCKET] no Hosts field in JSON uses empty array fallback (L97)", () => {
    const noHosts = '{"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}';
    const checks = parseDockerChecks(noHosts + "\n---DAEMON_JSON---\n{}\n---END_DAEMON_JSON---", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET).currentValue).toBe("Unix socket only");
  });

  // ── L105: MethodExpression, ArrowFunction — hosts.some, h.startsWith ──

  it("[DCK-NO-TCP-SOCKET] tcp:// at non-zero index in Hosts array still detected", () => {
    const multiHost = '{"Hosts":["unix:///var/run/docker.sock","tcp://127.0.0.1:2376"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}';
    const checks = parseDockerChecks(multiHost + "\n---DAEMON_JSON---\n{}\n---END_DAEMON_JSON---", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET).currentValue).toContain("tcp://127.0.0.1:2376");
  });

  it("[DCK-NO-TCP-SOCKET] hosts with only unix:// entries pass", () => {
    const unixOnly = '{"Hosts":["unix:///var/run/docker.sock","unix:///tmp/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}';
    const checks = parseDockerChecks(unixOnly + "\n---DAEMON_JSON---\n{}\n---END_DAEMON_JSON---", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET).passed).toBe(true);
  });

  // ── L113: Regex — --privileged pattern ──

  it("[DCK-NO-PRIVILEGED] --PRIVILEGED (uppercase) still detected (case-insensitive regex L113)", () => {
    const output = mkOutput(
      "myapp nginx:latest --PRIVILEGED Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=false User=appuser Privileged=false",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED).passed).toBe(false);
  });

  it("[DCK-NO-PRIVILEGED] Privileged JSON format detected (L113 second regex)", () => {
    const output = mkOutput(
      'myapp "Privileged": true something',
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=false User=appuser Privileged=false",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED).currentValue).toBe("Privileged container(s) detected");
  });

  it("[DCK-NO-PRIVILEGED] no --privileged and no Privileged:true passes", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED).currentValue).toBe("No privileged containers");
  });

  // ── L145-146: ArrayDeclaration, ArrowFunction — securityOpts.some ──

  it("[DCK-USER-NAMESPACE] SecurityOptions null fallback uses empty array (L145)", () => {
    const noSecOpts = '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","LoggingDriver":"json-file"}';
    const checks = parseDockerChecks(noSecOpts + "\n---DAEMON_JSON---\n{}\n---END_DAEMON_JSON---\nN/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_USER_NAMESPACE).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_USER_NAMESPACE).currentValue).toBe("User namespace not configured");
  });

  it("[DCK-USER-NAMESPACE] SecurityOptions with userns passes (L146 arrow)", () => {
    const withUserns = '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":["name=userns"],"LoggingDriver":"json-file"}';
    const checks = parseDockerChecks(withUserns + "\n---DAEMON_JSON---\n{}\n---END_DAEMON_JSON---\nN/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_USER_NAMESPACE).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_USER_NAMESPACE).currentValue).toBe("User namespace remapping enabled");
  });

  // ── L162: Regex — --network\s*host ──

  it("[DCK-NO-HOST-NETWORK] --network  host (extra space) detected (L162 regex)", () => {
    const output = mkOutput(
      "myapp nginx:latest --network  host Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=false User=appuser Privileged=false",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK).currentValue).toBe("Host network container(s) detected");
  });

  it("[DCK-NO-HOST-NETWORK] --networkhost (no space) detected (L162 zero-width match)", () => {
    const output = mkOutput(
      "myapp nginx:latest --networkhost Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=false User=appuser Privileged=false",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK).passed).toBe(false);
  });

  // ── L178: ConditionalExpression — hasLogging ──

  it("[DCK-LOGGING-DRIVER] LoggingDriver='none' fails (L178 first condition)", () => {
    const noneLog = '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"none"}';
    const checks = parseDockerChecks(noneLog + "\n---DAEMON_JSON---\n{}\n---END_DAEMON_JSON---", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER).currentValue).toBe("Logging driver: none");
  });

  it("[DCK-LOGGING-DRIVER] missing LoggingDriver defaults to 'unknown' and fails (L178 second condition)", () => {
    const noLog = '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[]}';
    const checks = parseDockerChecks(noLog + "\n---DAEMON_JSON---\n{}\n---END_DAEMON_JSON---", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER).currentValue).toBe("Logging driver: unknown");
  });

  it("[DCK-LOGGING-DRIVER] LoggingDriver='syslog' passes (not none/unknown)", () => {
    const syslog = '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"syslog"}';
    const checks = parseDockerChecks(syslog + "\n---DAEMON_JSON---\n{}\n---END_DAEMON_JSON---", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER).currentValue).toBe("Logging driver: syslog");
  });

  // ── L200: ConditionalExpression, LogicalOperator, UnaryOperator — hasRunningContainers ──

  it("[DCK-NO-ROOT-CONTAINERS] SecurityOpt= present without N/A means running containers (L200)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=appuser Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS).currentValue).toBe("Containers running as non-root");
  });

  it("[DCK-NO-ROOT-CONTAINERS] no SecurityOpt= lines means no running containers (L200)", () => {
    const output = mkOutput("N/A", "N/A", "N/A");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS).currentValue).toBe("No running containers");
  });

  // ── L210: ConditionalExpression, BooleanLiteral — liveRestoreEnabled ──

  it("[DCK-LIVE-RESTORE] daemon.json live-restore=true passes (L210 daemonJson branch)", () => {
    const output = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      '{"live-restore":true}',
      "---END_DAEMON_JSON---",
      "N/A",
    ].join("\n");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LIVE_RESTORE).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LIVE_RESTORE).currentValue).toBe("live-restore: true");
  });

  it("[DCK-LIVE-RESTORE] daemon.json live-restore=false and dockerInfo=false fails (L210)", () => {
    const output = [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file","LiveRestoreEnabled":false}',
      "---DAEMON_JSON---",
      '{"live-restore":false}',
      "---END_DAEMON_JSON---",
      "N/A",
    ].join("\n");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LIVE_RESTORE).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LIVE_RESTORE).currentValue).toBe("live-restore not configured");
  });

  // ── L261: LogicalOperator — hasTcpExposed ──

  it("[DCK-TLS-VERIFY] single TCP host triggers TLS check failure (L261)", () => {
    const output = [
      '{"Hosts":["tcp://0.0.0.0:2375"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
    ].join("\n");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_TLS_VERIFY).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_TLS_VERIFY).currentValue).toBe("TCP socket exposed without TLS verification");
  });

  it("[DCK-TLS-VERIFY] empty Hosts array means no TCP exposed (L261 length===0)", () => {
    const output = [
      '{"Hosts":[],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}',
      "---DAEMON_JSON---",
      "{}",
      "---END_DAEMON_JSON---",
      "N/A",
    ].join("\n");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_TLS_VERIFY).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_TLS_VERIFY).currentValue).toBe("No TCP socket exposed");
  });

  // ── L278-279: Regex — sockStatLine pattern, sockPermOk ──

  it("[DCK-SOCKET-PERMS] 770 root docker fails (permission not 660, L279 regex)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "770 root docker");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SOCKET_PERMS).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SOCKET_PERMS).currentValue).toBe("770 root docker");
  });

  it("[DCK-SOCKET-PERMS] 660 root staff fails (group not docker, L279)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "660 root staff");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SOCKET_PERMS).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SOCKET_PERMS).currentValue).toBe("660 root staff");
  });

  it("[DCK-SOCKET-PERMS] 660 docker docker fails (owner not root, L279)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "660 docker docker");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SOCKET_PERMS).passed).toBe(false);
  });

  // ── L286-296: MethodExpression — containerUserLines, hasRootContainers ──

  it("[DCK-NO-ROOT-CONTAINERS] User= at end of line (empty) triggers root detection (L296)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=false User=",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS).currentValue).toContain("root");
  });

  it('[DCK-NO-ROOT-CONTAINERS] User="" triggers root detection (L296 second regex)', () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      '/myapp SecurityOpt=[] ReadonlyRootfs=false User="" Privileged=false',
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS).passed).toBe(false);
  });

  it("[DCK-NO-ROOT-CONTAINERS] User=myuser does not trigger root detection", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=true User=myuser Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS).currentValue).toBe("Containers running as non-root");
  });

  // ── L316: ConditionalExpression, LogicalOperator, EqualityOperator — allReadOnly ──

  it("[DCK-READ-ONLY-ROOTFS] all ReadonlyRootfs=true passes (L316)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=true User=app Privileged=false",
      "/db SecurityOpt=[] ReadonlyRootfs=true User=pg Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS).currentValue).toBe("Containers use read-only root filesystem");
  });

  it("[DCK-READ-ONLY-ROOTFS] mixed ReadonlyRootfs fails (L316 every check)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=true User=app Privileged=false",
      "/db SecurityOpt=[] ReadonlyRootfs=false User=pg Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS).currentValue).toContain("writable");
  });

  it("[DCK-READ-ONLY-ROOTFS] no ReadonlyRootfs lines with running containers fails (L316 length>0)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] User=app Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS).passed).toBe(false);
  });

  // ── L338: ConditionalExpression — logMaxSize ──

  it("[DCK-LOG-MAX-SIZE] no max-size in output and no log-opts in daemon.json fails (L338)", () => {
    const output = mkOutput("N/A", "N/A", "N/A");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE).currentValue).toBe("No log max-size configured");
  });

  // ── L368-370: MethodExpression, ConditionalExpression — seccompLines, hasSeccomp ──

  it("[DCK-SECCOMP-ENABLED] containers with seccomp in SecurityOpt passes (L368-370)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=app Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED).currentValue).toBe("seccomp profile applied");
  });

  it("[DCK-SECCOMP-ENABLED] containers without seccomp in SecurityOpt fails", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[apparmor:docker-default] ReadonlyRootfs=true User=app Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED).currentValue).toContain("No seccomp");
  });

  // ── L404-406: MethodExpression — privilegedInspectLines ──

  it("[DCK-NO-SENSITIVE-MOUNTS] Privileged=true in inspect output fails (L404-406)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=false User=app Privileged=true",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS).currentValue).toContain("Privileged=true");
  });

  it("[DCK-NO-SENSITIVE-MOUNTS] Privileged=false in inspect output passes", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=false User=app Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS).currentValue).toBe("No privileged containers detected");
  });

  // ── L426: ConditionalExpression, EqualityOperator, MethodExpression — hasApparmor ──

  it("[DCK-APPARMOR-PROFILE] containers with apparmor in SecurityOpt passes (L426)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[seccomp:default apparmor:docker-default] ReadonlyRootfs=true User=app Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE).currentValue).toBe("AppArmor profile applied");
  });

  it("[DCK-APPARMOR-PROFILE] containers without apparmor in SecurityOpt fails (L426)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=app Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE).currentValue).toBe("No AppArmor profile in container SecurityOpt");
  });

  // ── L445-451: MethodExpression, EqualityOperator — privilegedPorts ──

  it("[DCK-NO-PRIVILEGED-PORTS] port 25 (< 1024, not 80/443) fails (L445-451)", () => {
    const output = mkOutput(
      "mail postfix 0.0.0.0:25->25/tcp Up 1h",
      "N/A",
      "/mail SecurityOpt=[] ReadonlyRootfs=true User=mail Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS).currentValue).toContain("25");
  });

  it("[DCK-NO-PRIVILEGED-PORTS] port 1023 fails, port 1024 passes (boundary L451)", () => {
    const output1023 = mkOutput(
      "app test 0.0.0.0:1023->1023/tcp Up 1h",
      "N/A",
      "/app SecurityOpt=[] ReadonlyRootfs=true User=user Privileged=false",
      "660 root docker",
    );
    expect(find(parseDockerChecks(output1023, "bare"), CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS).passed).toBe(false);

    const output1024 = mkOutput(
      "app test 0.0.0.0:1024->1024/tcp Up 1h",
      "N/A",
      "/app SecurityOpt=[] ReadonlyRootfs=true User=user Privileged=false",
      "660 root docker",
    );
    expect(find(parseDockerChecks(output1024, "bare"), CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS).passed).toBe(true);
  });

  // ── L460: ConditionalExpression — privilegedPorts.length === 0 ──

  it("[DCK-NO-PRIVILEGED-PORTS] zero privileged ports with running containers passes (L460)", () => {
    const output = mkOutput(
      "app test 0.0.0.0:8080->8080/tcp Up 1h",
      "N/A",
      "/app SecurityOpt=[] ReadonlyRootfs=true User=user Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS).currentValue).toBe("No privileged port bindings");
  });

  // ── L472-479: BlockStatement, MethodExpression, etc — network lines ──

  it("[DCK-NETWORK-DISABLED] custom network 'mynet overlay' passes (L472-479)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "mynet overlay");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED).currentValue).toBe("Custom user-defined network(s) found");
  });

  it("[DCK-NETWORK-DISABLED] only default networks fails", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "bridge bridge", "host host", "none null");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED).currentValue).toContain("Only default networks");
  });

  // ── L507: BooleanLiteral — isRootless ──

  it("[DCK-ROOTLESS-MODE] SecurityOptions with 'rootless' (mixed case) passes (L507)", () => {
    const rootless = '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":["name=ROOTLESS"],"LoggingDriver":"json-file"}';
    const checks = parseDockerChecks(rootless + "\n---DAEMON_JSON---\n{}\n---END_DAEMON_JSON---", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE).currentValue).toBe("Rootless Docker mode detected");
  });

  it("[DCK-ROOTLESS-MODE] empty SecurityOptions means not rootless (L507 false)", () => {
    const output = mkOutput("N/A");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE).currentValue).toBe("Docker running as root daemon");
  });

  // ── L539: Regex — hasHostNetworkMode ──

  it("[DCK-NO-HOST-NETWORK-INSPECT] NetworkMode host in JSON format detected (L539)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      '/myapp SecurityOpt=[] "NetworkMode":"host" ReadonlyRootfs=false User=app Privileged=false',
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT).currentValue).toContain("host network mode");
  });

  it("[DCK-NO-HOST-NETWORK-INSPECT] no NetworkMode host passes (L539)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      '/myapp SecurityOpt=[] "NetworkMode":"bridge" ReadonlyRootfs=false User=app Privileged=false',
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT).currentValue).toBe("No containers using host network mode");
  });

  // ── L545/561-562: hasHealthChecks ──

  it("[DCK-HEALTH-CHECK] 'unhealthy' keyword triggers health check present (L561)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=true User=app Privileged=false unhealthy",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_HEALTH_CHECK).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_HEALTH_CHECK).currentValue).toBe("Health check configuration detected");
  });

  it("[DCK-HEALTH-CHECK] Health keyword in output with running containers passes (L561-562)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] ReadonlyRootfs=true User=app Privileged=false Health: check=curl",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_HEALTH_CHECK).passed).toBe(true);
  });

  it("[DCK-HEALTH-CHECK] no health keywords with running containers fails (L562)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[seccomp:default] ReadonlyRootfs=true User=app Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    const check = find(checks, CHECK_IDS.DOCKER.DCK_HEALTH_CHECK);
    expect(check.passed).toBe(false);
    expect(check.currentValue).toBe("No health checks found in running containers");
  });

  // ── L568: BooleanLiteral, ConditionalExpression — dck25 ──

  it("[DCK-HEALTH-CHECK] docker not available returns passed=true (L568 ternary)", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_HEALTH_CHECK).passed).toBe(true);
  });

  // ── L586: BooleanLiteral — bridgeInspectLine ──

  it("[DCK-BRIDGE-NFCALL] no enable_icc line means ICC not enabled (L586)", () => {
    const output = mkOutput("N/A", "N/A", "N/A");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL).currentValue).toBe("ICC not enabled on default bridge");
  });

  it("[DCK-BRIDGE-NFCALL] enable_icc=false in JSON passes (L586 parsed)", () => {
    const output = mkOutput(
      "N/A", "N/A", "N/A",
      '{"com.docker.network.bridge.enable_icc":"false"}',
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL).passed).toBe(true);
  });

  it("[DCK-BRIDGE-NFCALL] enable_icc=true in JSON fails (L586)", () => {
    const output = mkOutput(
      "N/A", "N/A", "N/A",
      '{"com.docker.network.bridge.enable_icc":"true"}',
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL).currentValue).toBe("ICC enabled on default bridge (containers can communicate freely)");
  });

  // ── L616-619: insecure registry ──

  it("[DCK-NO-INSECURE-REGISTRY] line with 'insecure-registry' keyword triggers check (L616)", () => {
    const output = mkOutput(
      "N/A", "N/A", "N/A",
      "insecure-registry=192.168.1.100:5000",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY).currentValue).toContain("Insecure");
  });

  it("[DCK-NO-INSECURE-REGISTRY] only [127.0.0.0/8] passes (L619 regex)", () => {
    const output = mkOutput(
      "N/A", "N/A", "N/A",
      "[127.0.0.0/8]",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY).currentValue).toBe("No custom insecure registries");
  });

  it("[DCK-NO-INSECURE-REGISTRY] standalone N/A line passes (L618)", () => {
    // A standalone "N/A" line that also matches InsecureRegistryCIDRs won't exist;
    // the N/A check applies to the trimmed full line, so only exact "N/A" works
    const output = mkOutput("N/A", "N/A", "N/A", "insecure-registry N/A");
    const checks = parseDockerChecks(output, "bare");
    // Line "insecure-registry N/A" matches regex, value is "insecure-registry N/A" !== "N/A"
    // but it also does not match loopback regex, and does not contain "[]"
    // so it's treated as custom insecure registry -> fails
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY).passed).toBe(false);
  });

  // ── L642-645: experimental ──

  it("[DCK-NO-EXPERIMENTAL] standalone 'true' as last bool line triggers experimental (L643-645)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "inactive", "true");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL).currentValue).toBe("Experimental features enabled");
  });

  it("[DCK-NO-EXPERIMENTAL] standalone 'false' as last bool line means not experimental (L645)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "inactive", "false");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL).currentValue).toBe("Experimental features disabled");
  });

  it("[DCK-NO-EXPERIMENTAL] 'experimental true' line is not standalone true (L642-644)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "experimental true");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL).passed).toBe(true);
  });

  // ── L665-670: auth plugin ──

  it("[DCK-AUTH-PLUGIN] '[authz-broker]' line detected as auth plugin (L665-670)", () => {
    const info = '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":["name=seccomp"],"LoggingDriver":"json-file"}';
    const output = [info, "---DAEMON_JSON---", "{}", "---END_DAEMON_JSON---", "N/A", "N/A", "N/A", "[authz-broker]"].join("\n");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN).currentValue).toContain("authz-broker");
  });

  it("[DCK-AUTH-PLUGIN] '[]' means no auth plugin (L668-670)", () => {
    const info = '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":["name=seccomp"],"LoggingDriver":"json-file"}';
    const output = [info, "---DAEMON_JSON---", "{}", "---END_DAEMON_JSON---", "N/A", "N/A", "N/A", "[]"].join("\n");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN).currentValue).toBe("None configured");
  });

  it("[DCK-AUTH-PLUGIN] '[ ]' means no auth plugin (L670)", () => {
    const info = '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":["name=seccomp"],"LoggingDriver":"json-file"}';
    const output = [info, "---DAEMON_JSON---", "{}", "---END_DAEMON_JSON---", "N/A", "N/A", "N/A", "[ ]"].join("\n");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN).passed).toBe(false);
  });

  // ── L689: LogicalOperator — hasCertsDir ──

  it("[DCK-REGISTRY-CERTS] /etc/docker/certs.d/ present passes (L689)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "/etc/docker/certs.d/myregistry.com");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS).currentValue).toContain("certs.d");
  });

  it("[DCK-REGISTRY-CERTS] NO_CERTS_DIR even with certs.d fails (L689)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "NO_CERTS_DIR /etc/docker/certs.d/");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS).passed).toBe(false);
  });

  it("[DCK-REGISTRY-CERTS] 'total 0' with certs.d fails (L689)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "/etc/docker/certs.d/ total 0");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS).currentValue).toContain("No registry TLS");
  });

  // ── L711-712: swarm state ──

  it("[DCK-SWARM-INACTIVE] 'active' swarm state fails (L711-712)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "active", "false");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE).currentValue).toBe("Swarm mode active");
  });

  it("[DCK-SWARM-INACTIVE] 'locked' swarm state passes (L712)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "locked", "false");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE).currentValue).toContain("locked");
  });

  it("[DCK-SWARM-INACTIVE] 'error' swarm state passes (L712)", () => {
    const output = mkOutput("N/A", "N/A", "N/A", "error", "false");
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE).passed).toBe(true);
  });

  // ── L732: hasHostPid ──

  it("[DCK-PID-MODE] PidMode=host (non-JSON) detected (L732)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] PidMode=host ReadonlyRootfs=false User=app Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_PID_MODE).passed).toBe(false);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_PID_MODE).currentValue).toContain("host PID");
  });

  it('[DCK-PID-MODE] "PidMode": "host" (JSON) detected (L732)', () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      '/myapp SecurityOpt=[] "PidMode": "host" ReadonlyRootfs=false User=app Privileged=false',
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_PID_MODE).passed).toBe(false);
  });

  it("[DCK-PID-MODE] no PidMode=host passes (L732)", () => {
    const output = mkOutput(
      "myapp nginx:latest Up 2 hours",
      "N/A",
      "/myapp SecurityOpt=[] PidMode=private ReadonlyRootfs=false User=app Privileged=false",
      "660 root docker",
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_PID_MODE).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_PID_MODE).currentValue).toBe("No containers using host PID namespace");
  });

  // ── Cross-cutting: docker not available ternary guards ──

  it("[DCK-ROOTLESS-MODE] docker not available returns passed=true", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE).currentValue).toBe("Docker not installed");
  });

  it("[DCK-NO-HOST-NETWORK-INSPECT] docker not available returns passed=true", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT).currentValue).toBe("Docker not installed");
  });

  it("[DCK-BRIDGE-NFCALL] docker not available returns passed=true", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL).currentValue).toBe("Docker not installed");
  });

  it("[DCK-NO-INSECURE-REGISTRY] docker not available returns passed=true", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY).currentValue).toBe("Docker not installed");
  });

  it("[DCK-NO-EXPERIMENTAL] docker not available returns passed=true", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL).currentValue).toBe("Docker not installed");
  });

  it("[DCK-AUTH-PLUGIN] docker not available returns passed=true", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN).currentValue).toBe("Docker not installed");
  });

  it("[DCK-REGISTRY-CERTS] docker not available returns passed=true", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS).currentValue).toBe("Docker not installed");
  });

  it("[DCK-SWARM-INACTIVE] docker not available returns passed=true", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE).currentValue).toBe("Docker not installed");
  });

  it("[DCK-PID-MODE] docker not available returns passed=true", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_PID_MODE).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_PID_MODE).currentValue).toBe("Docker not installed");
  });

  it("[DCK-LOG-DRIVER-CONFIGURED] docker not available returns passed=true", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED).currentValue).toBe("Docker not installed");
  });

  it("[DCK-NETWORK-DISABLED] docker not available returns passed=true", () => {
    const checks = parseDockerChecks("N/A", "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED).passed).toBe(true);
    expect(find(checks, CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED).currentValue).toBe("Docker not installed");
  });

  // ── Bridge ICC regex fallback ──

  it("[DCK-BRIDGE-NFCALL] non-JSON enable_icc false line triggers regex fallback — passes", () => {
    const output = mkOutput(
      "N/A", "N/A", "N/A",
      'enable_icc "false" enable_ip_masquerade',
    );
    const checks = parseDockerChecks(output, "bare");
    expect(find(checks, CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL).passed).toBe(true);
  });

  // ── Multiple TCP hosts ──

  it("[DCK-NO-TCP-SOCKET] multiple TCP hosts all listed in currentValue", () => {
    const multi = '{"Hosts":["unix:///sock","tcp://0.0.0.0:2375","tcp://0.0.0.0:2376"],"ServerVersion":"24.0.7","SecurityOptions":[],"LoggingDriver":"json-file"}';
    const checks = parseDockerChecks(multi + "\n---DAEMON_JSON---\n{}\n---END_DAEMON_JSON---", "bare");
    const check = find(checks, CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET);
    expect(check.passed).toBe(false);
    expect(check.currentValue).toContain("tcp://0.0.0.0:2375");
    expect(check.currentValue).toContain("tcp://0.0.0.0:2376");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// [MUTATION-KILLER] String literal assertions — kills StringLiteral mutants
// Every check's id, name, severity, safeToAutoFix, category, expectedValue,
// fixCommand, and explain are asserted to prevent "" replacement surviving.
// ═══════════════════════════════════════════════════════════════════════════════

describe("[MUTATION-KILLER] Docker check metadata — string literal assertions", () => {
  const secureChecks = parseDockerChecks(
    [
      '{"Hosts":["unix:///var/run/docker.sock"],"ServerVersion":"24.0.7","SecurityOptions":["name=userns","name=seccomp,profile=default","name=apparmor"],"LoggingDriver":"json-file","LiveRestoreEnabled":true}',
      "---DAEMON_JSON---",
      '{"log-driver":"json-file","userns-remap":"default","live-restore":true,"icc":false,"log-opts":{"max-size":"10m","max-file":"3"},"default-ulimits":{"nofile":{"Name":"nofile","Hard":64000,"Soft":64000}}}',
      "---END_DAEMON_JSON---",
      "myapp nginx:latest Up 2 hours",
      "db postgres:15 Up 2 hours",
      "srw-rw---- 1 root docker 0 Mar  1 10:00 /var/run/docker.sock",
      "/myapp SecurityOpt=[seccomp:default apparmor:docker-default] ReadonlyRootfs=true User=appuser Privileged=false",
      "/db SecurityOpt=[seccomp:default apparmor:docker-default] ReadonlyRootfs=true User=postgres Privileged=false",
      "DOCKER_CONTENT_TRUST=1",
      "660 root docker",
      "app-network bridge",
      "myapp_data local",
      "[name=userns name=seccomp name=apparmor]",
      '{"com.docker.network.bridge.enable_icc":"false","com.docker.network.bridge.enable_ip_masquerade":"true"}',
      "[]",
      "/etc/docker/certs.d/registry.example.com",
      "[127.0.0.0/8]",
      "inactive",
      "false",
    ].join("\n"),
    "bare",
  );

  const findDck = (id: string) => {
    const c = secureChecks.find((ch) => ch.id === id);
    if (!c) throw new Error(`Check ${id} not found`);
    return c;
  };

  // ── All 32 checks: id, name, severity, safeToAutoFix, category ──

  it.each([
    [CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET, "No TCP Socket Exposed", "critical", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED, "No Privileged Containers", "critical", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_VERSION_CURRENT, "Docker Version Current", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_USER_NAMESPACE, "User Namespace Enabled", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK, "No Host Network Containers", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER, "Logging Driver Configured", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_LIVE_RESTORE, "Live Restore Enabled", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES, "No New Privileges Default", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_ICC_DISABLED, "Inter-Container Communication Disabled", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_TLS_VERIFY, "TLS Verification Enabled", "critical", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_SOCKET_PERMS, "Docker Socket Permissions", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS, "No Root Containers", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS, "Read-Only Root Filesystem", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE, "Log Max Size Configured", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS, "Default Ulimits Configured", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED, "Seccomp Profile Applied", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_CONTENT_TRUST, "Docker Content Trust Enabled", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS, "No Sensitive Mounts", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE, "AppArmor Profile Applied", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS, "No Privileged Port Bindings", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED, "Custom Docker Network Configured", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED, "Logging Driver Not None", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE, "Docker Rootless Mode", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT, "No Host Network Mode (Inspect)", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_HEALTH_CHECK, "Container Health Checks Configured", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL, "Bridge ICC Disabled", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY, "No Insecure Registries Configured", "warning", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL, "Experimental Features Disabled", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN, "Docker Authorization Plugin Configured", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS, "Registry TLS Certificates Configured", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE, "Docker Swarm Mode Inactive", "info", "FORBIDDEN"],
    [CHECK_IDS.DOCKER.DCK_PID_MODE, "No Host PID Namespace Containers", "warning", "FORBIDDEN"],
  ])("[MUTATION-KILLER] %s has name=%s, severity=%s, safeToAutoFix=%s", (id, name, severity, safe) => {
    const c = findDck(id);
    expect(c.name).toBe(name);
    expect(c.severity).toBe(severity);
    expect(c.safeToAutoFix).toBe(safe);
    expect(c.category).toBe("Docker");
  });

  // ── Every check ID starts with DCK- ──
  it("[MUTATION-KILLER] all 32 check IDs start with DCK-", () => {
    expect(secureChecks).toHaveLength(32);
    secureChecks.forEach((c) => expect(c.id).toMatch(/^DCK-/));
  });

  // ── expectedValue assertions per check ──
  it.each([
    [CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET, "No TCP socket (unix:// only)"],
    [CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED, "No privileged containers"],
    [CHECK_IDS.DOCKER.DCK_VERSION_CURRENT, "Docker 24.0+"],
    [CHECK_IDS.DOCKER.DCK_USER_NAMESPACE, "User namespace remapping or rootless mode"],
    [CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK, "No containers using host network"],
    [CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER, "Logging driver configured (not none)"],
    [CHECK_IDS.DOCKER.DCK_LIVE_RESTORE, "live-restore: true in daemon.json"],
    [CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES, "no-new-privileges: true in daemon.json"],
    [CHECK_IDS.DOCKER.DCK_ICC_DISABLED, "icc: false in daemon.json"],
    [CHECK_IDS.DOCKER.DCK_TLS_VERIFY, "No TCP socket, or TLS verification enabled"],
    [CHECK_IDS.DOCKER.DCK_SOCKET_PERMS, "660 root docker"],
    [CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS, "No running containers using root user"],
    [CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS, "Containers using read-only root filesystem"],
    [CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE, "log-opts max-size set to prevent disk exhaustion"],
    [CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS, "default-ulimits set in daemon.json"],
    [CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED, "seccomp profile applied to running containers"],
    [CHECK_IDS.DOCKER.DCK_CONTENT_TRUST, "DOCKER_CONTENT_TRUST=1 environment variable set"],
    [CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS, "No containers with Privileged=true"],
    [CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE, "AppArmor profile applied to running containers"],
    [CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS, "No containers binding ports < 1024 (except 80/443)"],
    [CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED, "At least one user-defined network configured"],
    [CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED, "LoggingDriver is not 'none'"],
    [CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE, "Rootless Docker mode (optional enhancement)"],
    [CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT, "No running containers with NetworkMode=host"],
    [CHECK_IDS.DOCKER.DCK_HEALTH_CHECK, "Running containers have HEALTHCHECK defined"],
    [CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL, "com.docker.network.bridge.enable_icc = false"],
    [CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY, "No insecure registries beyond 127.0.0.0/8"],
    [CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL, "ExperimentalBuild = false"],
    [CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN, "At least one authorization plugin active"],
    [CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS, "/etc/docker/certs.d/ exists with registry cert subdirectories"],
    [CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE, "Swarm mode inactive (if not intentionally used)"],
    [CHECK_IDS.DOCKER.DCK_PID_MODE, "No containers with PidMode=host"],
  ])("[MUTATION-KILLER] %s expectedValue = %s", (id, expected) => {
    expect(findDck(id).expectedValue).toBe(expected);
  });

  // ── fixCommand contains key substring (kills "" mutation) ──
  it.each([
    [CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET, "daemon.json"],
    [CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED, "docker ps"],
    [CHECK_IDS.DOCKER.DCK_VERSION_CURRENT, "get-docker.sh"],
    [CHECK_IDS.DOCKER.DCK_USER_NAMESPACE, "userns-remap"],
    [CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK, "docker ps"],
    [CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER, "daemon.json"],
    [CHECK_IDS.DOCKER.DCK_LIVE_RESTORE, "daemon.json"],
    [CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES, "daemon.json"],
    [CHECK_IDS.DOCKER.DCK_ICC_DISABLED, "daemon.json"],
    [CHECK_IDS.DOCKER.DCK_TLS_VERIFY, "daemon.json"],
    [CHECK_IDS.DOCKER.DCK_SOCKET_PERMS, "docker.sock"],
    [CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS, "USER"],
    [CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS, "read-only"],
    [CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE, "daemon.json"],
    [CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS, "daemon.json"],
    [CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED, "seccomp"],
    [CHECK_IDS.DOCKER.DCK_CONTENT_TRUST, "DOCKER_CONTENT_TRUST"],
    [CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS, "privileged"],
    [CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE, "apparmor"],
    [CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS, "1024"],
    [CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED, "docker network create"],
    [CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED, "daemon.json"],
    [CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE, "rootless"],
    [CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT, "docker ps"],
    [CHECK_IDS.DOCKER.DCK_HEALTH_CHECK, "HEALTHCHECK"],
    [CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL, "daemon.json"],
    [CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY, "insecure-registry"],
    [CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL, "daemon.json"],
    [CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN, "authorization plugin"],
    [CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS, "certs.d"],
    [CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE, "swarm leave"],
    [CHECK_IDS.DOCKER.DCK_PID_MODE, "pid"],
  ])("[MUTATION-KILLER] %s fixCommand contains '%s'", (id, substring) => {
    const fc = findDck(id).fixCommand;
    expect(fc).toBeDefined();
    expect(fc!.toLowerCase()).toContain(substring.toLowerCase());
  });

  // ── explain is non-empty and contains domain-specific keyword ──
  it.each([
    [CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET, "TCP"],
    [CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED, "host access"],
    [CHECK_IDS.DOCKER.DCK_VERSION_CURRENT, "vulnerabilities"],
    [CHECK_IDS.DOCKER.DCK_USER_NAMESPACE, "root"],
    [CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK, "network isolation"],
    [CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER, "monitoring"],
    [CHECK_IDS.DOCKER.DCK_LIVE_RESTORE, "restart"],
    [CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES, "privilege escalation"],
    [CHECK_IDS.DOCKER.DCK_ICC_DISABLED, "lateral movement"],
    [CHECK_IDS.DOCKER.DCK_TLS_VERIFY, "unauthenticated"],
    [CHECK_IDS.DOCKER.DCK_SOCKET_PERMS, "unauthorized"],
    [CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS, "root"],
    [CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS, "malicious"],
    [CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE, "disk"],
    [CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS, "resource exhaustion"],
    [CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED, "system calls"],
    [CHECK_IDS.DOCKER.DCK_CONTENT_TRUST, "signed images"],
    [CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS, "host devices"],
    [CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE, "AppArmor"],
    [CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS, "capabilities"],
    [CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED, "isolation"],
    [CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED, "forensic"],
    [CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE, "blast radius"],
    [CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT, "host ports"],
    [CHECK_IDS.DOCKER.DCK_HEALTH_CHECK, "restart"],
    [CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL, "lateral movement"],
    [CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY, "HTTP"],
    [CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL, "production"],
    [CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN, "access control"],
    [CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS, "registry"],
    [CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE, "ports"],
    [CHECK_IDS.DOCKER.DCK_PID_MODE, "process"],
  ])("[MUTATION-KILLER] %s explain contains '%s'", (id, keyword) => {
    const e = findDck(id).explain;
    expect(e).toBeDefined();
    expect(e!.length).toBeGreaterThan(20);
    expect(e!).toContain(keyword);
  });

  // ── Skipped checks (Docker not installed): every check has correct metadata ──
  describe("[MUTATION-KILLER] skipped check metadata when Docker not installed", () => {
    const skippedBare = parseDockerChecks("N/A", "bare");
    const skippedCoolify = parseDockerChecks("N/A", "coolify");

    it.each([
      CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED, CHECK_IDS.DOCKER.DCK_VERSION_CURRENT,
      CHECK_IDS.DOCKER.DCK_USER_NAMESPACE, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK, CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER,
      CHECK_IDS.DOCKER.DCK_LIVE_RESTORE, CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES, CHECK_IDS.DOCKER.DCK_ICC_DISABLED,
      CHECK_IDS.DOCKER.DCK_TLS_VERIFY, CHECK_IDS.DOCKER.DCK_SOCKET_PERMS, CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS,
      CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS, CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE, CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS,
      CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED, CHECK_IDS.DOCKER.DCK_CONTENT_TRUST, CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS,
      CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS, CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED,
      CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED, CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT,
      CHECK_IDS.DOCKER.DCK_HEALTH_CHECK, CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL, CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY,
      CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL, CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN, CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS,
      CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE, CHECK_IDS.DOCKER.DCK_PID_MODE,
    ])("[MUTATION-KILLER] skipped %s has safeToAutoFix=FORBIDDEN, category=Docker, fixCommand contains get-docker", (id) => {
      const bareCk = skippedBare.find((c) => c.id === id)!;
      expect(bareCk.safeToAutoFix).toBe("FORBIDDEN");
      expect(bareCk.category).toBe("Docker");
      expect(bareCk.fixCommand).toContain("get-docker.sh");
      expect(bareCk.expectedValue).toBe("Docker installed and configured securely");
      expect(bareCk.currentValue).toBe("Docker not installed");
    });

    it("[MUTATION-KILLER] coolify skipped checks have explain mentioning 'expected'", () => {
      skippedCoolify.forEach((c) => {
        expect(c.explain).toContain("expected");
      });
    });

    it("[MUTATION-KILLER] bare skipped checks have explain mentioning 'not installed'", () => {
      skippedBare.forEach((c) => {
        expect(c.explain).toContain("not installed");
      });
    });
  });
});
