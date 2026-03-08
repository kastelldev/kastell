import { getBareCloudInit } from "../../src/utils/cloudInit";

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
