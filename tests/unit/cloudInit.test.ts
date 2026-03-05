import { getCoolifyCloudInit, getBareCloudInit } from "../../src/utils/cloudInit";

describe("getCoolifyCloudInit", () => {
  it("should return a bash script starting with shebang", () => {
    const script = getCoolifyCloudInit("test-server");
    expect(script.startsWith("#!/bin/bash")).toBe(true);
  });

  it("should include set +e for resilient execution", () => {
    const script = getCoolifyCloudInit("test-server");
    expect(script).toContain("set +e");
  });

  it("should include the server name in the output", () => {
    const script = getCoolifyCloudInit("my-coolify");
    expect(script).toContain("my-coolify");
  });

  it("should include Coolify install command", () => {
    const script = getCoolifyCloudInit("test");
    expect(script).toContain("curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash");
  });

  it("should include system update step", () => {
    const script = getCoolifyCloudInit("test");
    expect(script).toContain("apt-get update -y");
  });

  it("should include service wait step", () => {
    const script = getCoolifyCloudInit("test");
    expect(script).toContain("sleep 30");
  });

  it("should handle different server names correctly", () => {
    const script1 = getCoolifyCloudInit("server-alpha");
    const script2 = getCoolifyCloudInit("production-01");

    expect(script1).toContain("server-alpha");
    expect(script1).not.toContain("production-01");
    expect(script2).toContain("production-01");
    expect(script2).not.toContain("server-alpha");
  });

  it("should include completion message", () => {
    const script = getCoolifyCloudInit("test");
    expect(script).toContain("Coolify installation completed");
  });

  it("should mention port 8000 for access", () => {
    const script = getCoolifyCloudInit("test");
    expect(script).toContain("8000");
  });

  it("should include logging to kastell-install.log", () => {
    const script = getCoolifyCloudInit("test");
    expect(script).toContain("kastell-install.log");
    expect(script).toContain("exec > >(tee /var/log/kastell-install.log) 2>&1");
  });

  it("should include network wait loop", () => {
    const script = getCoolifyCloudInit("test");
    expect(script).toContain("Waiting for network connectivity...");
    expect(script).toContain("MAX_ATTEMPTS=30");
    expect(script).toContain("Network is ready!");
  });
});

describe("getBareCloudInit", () => {
  it("should return a bash script starting with shebang", () => {
    const script = getBareCloudInit("my-server");
    expect(script.startsWith("#!/bin/bash")).toBe(true);
  });

  it("should include fail2ban installation", () => {
    const script = getBareCloudInit("my-server");
    expect(script).toContain("fail2ban");
  });

  it("should include ufw setup with port 22", () => {
    const script = getBareCloudInit("my-server");
    expect(script).toContain("ufw allow 22/tcp");
  });

  it("should include ufw setup with port 80", () => {
    const script = getBareCloudInit("my-server");
    expect(script).toContain("ufw allow 80/tcp");
  });

  it("should include ufw setup with port 443", () => {
    const script = getBareCloudInit("my-server");
    expect(script).toContain("ufw allow 443/tcp");
  });

  it("should include unattended-upgrades", () => {
    const script = getBareCloudInit("my-server");
    expect(script).toContain("unattended-upgrades");
  });

  it("should NOT contain coolify references", () => {
    const script = getBareCloudInit("my-server");
    expect(script.toLowerCase()).not.toContain("coolify");
    expect(script.toLowerCase()).not.toContain("coollabs");
  });

  it("should sanitize server name by stripping unsafe chars", () => {
    const script = getBareCloudInit("my server! @#$");
    expect(script).toContain("myserver");
    expect(script).not.toContain("my server!");
  });

  it("should include set +e for resilient execution", () => {
    const script = getBareCloudInit("my-server");
    expect(script).toContain("set +e");
  });

  it("should log to kastell-install.log", () => {
    const script = getBareCloudInit("my-server");
    expect(script).toContain("kastell-install.log");
  });

  it("should include apt-get update", () => {
    const script = getBareCloudInit("my-server");
    expect(script).toContain("apt-get update -y");
  });

  it("should include the sanitized server name in output", () => {
    const script = getBareCloudInit("bare-test-01");
    expect(script).toContain("bare-test-01");
  });
});
