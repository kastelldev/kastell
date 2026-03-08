import { parseNetworkChecks } from "../../src/core/audit/checks/network.js";

describe("parseNetworkChecks", () => {
  const secureOutput = [
    // ss -tlnp output (listening ports)
    [
      "State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process",
      "LISTEN  0       128     0.0.0.0:22           0.0.0.0:*          users:((\"sshd\",pid=1234))",
      "LISTEN  0       128     0.0.0.0:80           0.0.0.0:*          users:((\"nginx\",pid=5678))",
      "LISTEN  0       128     0.0.0.0:443          0.0.0.0:*          users:((\"nginx\",pid=5678))",
    ].join("\n"),
    // ss -ulnp output (UDP)
    "State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process",
    // IP forwarding
    "net.ipv4.ip_forward = 0",
    // DNS resolver
    "nameserver 1.1.1.1",
  ].join("\n");

  const insecureOutput = [
    // Many unnecessary ports open
    [
      "State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process",
      "LISTEN  0       128     0.0.0.0:22           0.0.0.0:*          users:((\"sshd\"))",
      "LISTEN  0       128     0.0.0.0:3306         0.0.0.0:*          users:((\"mysql\"))",
      "LISTEN  0       128     0.0.0.0:6379         0.0.0.0:*          users:((\"redis\"))",
      "LISTEN  0       128     0.0.0.0:27017        0.0.0.0:*          users:((\"mongod\"))",
    ].join("\n"),
    "N/A",
    "net.ipv4.ip_forward = 1",
    "nameserver 1.1.1.1",
  ].join("\n");

  it("should return 5 checks", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    expect(checks).toHaveLength(5);
    checks.forEach((check) => {
      expect(check.category).toBe("Network");
      expect(check.id).toMatch(/^NET-0[1-5]$/);
    });
  });

  it("should return NET-01 passed for reasonable listening ports", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const net01 = checks.find((c) => c.id === "NET-01");
    expect(net01!.passed).toBe(true);
  });

  it("should return NET-01 failed for database ports exposed", () => {
    const checks = parseNetworkChecks(insecureOutput, "bare");
    const net01 = checks.find((c) => c.id === "NET-01");
    expect(net01!.passed).toBe(false);
    expect(net01!.severity).toBe("warning");
  });

  it("should return NET-04 passed when IP forwarding is disabled", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const net04 = checks.find((c) => c.id === "NET-04");
    expect(net04!.passed).toBe(true);
  });

  it("should return NET-04 failed when IP forwarding is enabled on bare", () => {
    const checks = parseNetworkChecks(insecureOutput, "bare");
    const net04 = checks.find((c) => c.id === "NET-04");
    expect(net04!.passed).toBe(false);
  });

  it("should allow IP forwarding on docker platforms", () => {
    const checks = parseNetworkChecks(insecureOutput, "coolify");
    const net04 = checks.find((c) => c.id === "NET-04");
    expect(net04!.passed).toBe(true);
  });

  it("should return NET-05 (SYN cookies) passed when tcp_syncookies=1", () => {
    const outputWithSyncookies = secureOutput + "\nnet.ipv4.tcp_syncookies = 1";
    const checks = parseNetworkChecks(outputWithSyncookies, "bare");
    const net05 = checks.find((c) => c.id === "NET-05");
    expect(net05!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseNetworkChecks("N/A", "bare");
    expect(checks).toHaveLength(5);
  });
});
