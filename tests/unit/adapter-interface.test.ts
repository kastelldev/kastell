import type {
  PlatformAdapter,
  HealthResult,
  PlatformStatusResult,
  PlatformBackupResult,
  UpdateResult,
} from "../../src/adapters/interface";

describe("PlatformAdapter interface", () => {
  // Type-level test: verify a mock implementation satisfies the interface
  const mockAdapter: PlatformAdapter = {
    name: "test-platform",
    port: 8000,
    defaultLogService: "test-platform",
    platformPorts: [80, 443, 8000],
    getCloudInit(serverName: string): string {
      return `#!/bin/bash\necho ${serverName}`;
    },
    async healthCheck(_ip: string): Promise<HealthResult> {
      return { status: "running" };
    },
    async createBackup(
      _ip: string,
      _serverName: string,
      _provider: string,
    ): Promise<PlatformBackupResult> {
      return { success: true };
    },
    async getStatus(_ip: string): Promise<PlatformStatusResult> {
      return { platformVersion: "1.0.0", status: "running" };
    },
    async update(_ip: string): Promise<UpdateResult> {
      return { success: true, output: "updated" };
    },
  };

  it("should have a name property", () => {
    expect(mockAdapter.name).toBe("test-platform");
  });

  it("should have a getCloudInit method returning a string", () => {
    const result = mockAdapter.getCloudInit("my-server");
    expect(typeof result).toBe("string");
    expect(result).toContain("my-server");
  });

  it("should have a healthCheck method returning HealthResult", async () => {
    const result = await mockAdapter.healthCheck("1.2.3.4");
    expect(result.status).toBe("running");
  });

  it("should have a createBackup method returning PlatformBackupResult", async () => {
    const result = await mockAdapter.createBackup("1.2.3.4", "server1", "hetzner");
    expect(result.success).toBe(true);
  });

  it("should have a getStatus method returning PlatformStatusResult", async () => {
    const result = await mockAdapter.getStatus("1.2.3.4");
    expect(result.platformVersion).toBe("1.0.0");
    expect(result.status).toBe("running");
  });

  it("should allow HealthResult status to be 'not reachable'", async () => {
    const unreachable: HealthResult = { status: "not reachable" };
    expect(unreachable.status).toBe("not reachable");
  });

  it("should allow PlatformBackupResult with optional fields", () => {
    const result: PlatformBackupResult = {
      success: false,
      error: "backup failed",
      hint: "check SSH",
    };
    expect(result.success).toBe(false);
    expect(result.error).toBe("backup failed");
    expect(result.hint).toBe("check SSH");
  });

  it("should allow PlatformBackupResult with manifest", () => {
    const result: PlatformBackupResult = {
      success: true,
      backupPath: "/tmp/backup",
      manifest: {
        serverName: "test",
        provider: "hetzner",
        timestamp: "2026-01-01",
        coolifyVersion: "4.0.0",
        files: ["db.sql.gz"],
      },
    };
    expect(result.manifest?.serverName).toBe("test");
  });

  it("should have an update method returning UpdateResult", async () => {
    const result = await mockAdapter.update("1.2.3.4");
    expect(result.success).toBe(true);
    expect(result.output).toBe("updated");
  });

});
