import { readFileSync, writeFileSync } from "fs";
import * as config from "../../src/utils/config";
import { exportCommand, importCommand } from "../../src/commands/transfer";

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  existsSync: jest.fn(),
}));
jest.mock("../../src/utils/config");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify" as const,
};

const sampleServer2 = {
  id: "456",
  name: "coolify-prod",
  provider: "digitalocean",
  ip: "5.6.7.8",
  region: "fra1",
  size: "s-2vcpu-4gb",
  createdAt: "2026-02-01T00:00:00.000Z",
  mode: "coolify" as const,
};

describe("security-transfer E2E", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("export security", () => {
    it("should create export file with mode 0o600 (owner read/write only)", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);

      await exportCommand();

      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ mode: 0o600 }),
      );
    });

    it("should show security warning message about storing file securely", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);

      await exportCommand();

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Store it securely");
    });

    it("should export only required fields, no extra data", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);

      await exportCommand();

      const [, jsonContent] = mockedWriteFileSync.mock.calls[0] as [string, string, object];
      const exported = JSON.parse(jsonContent);

      expect(exported).toHaveLength(2);
      for (const server of exported) {
        const keys = Object.keys(server);
        expect(keys).toEqual(
          expect.arrayContaining(["id", "name", "provider", "ip", "region", "size", "createdAt", "mode"]),
        );
        expect(keys.length).toBe(8);
      }
    });
  });

  describe("import security - field stripping", () => {
    it("should strip unknown/extra fields from imported servers", async () => {
      const serverWithExtras = {
        ...sampleServer,
        extraField: "should-be-removed",
        unknownProperty: "also-removed",
      };
      mockedReadFileSync.mockReturnValue(JSON.stringify([serverWithExtras]));
      mockedConfig.getServers.mockReturnValue([]);

      await importCommand("/tmp/export.json");

      expect(mockedConfig.saveServer).toHaveBeenCalledTimes(1);
      const savedServer = mockedConfig.saveServer.mock.calls[0][0];
      expect(savedServer).not.toHaveProperty("extraField");
      expect(savedServer).not.toHaveProperty("unknownProperty");
      expect(Object.keys(savedServer)).toEqual(
        expect.arrayContaining(["id", "name", "provider", "ip", "region", "size", "createdAt"]),
      );
    });

    it("should strip malicious apiToken field from imported servers", async () => {
      const serverWithToken = {
        ...sampleServer,
        apiToken: "stolen-api-token-should-not-be-saved",
      };
      mockedReadFileSync.mockReturnValue(JSON.stringify([serverWithToken]));
      mockedConfig.getServers.mockReturnValue([]);

      await importCommand("/tmp/export.json");

      const savedServer = mockedConfig.saveServer.mock.calls[0][0];
      expect(savedServer).not.toHaveProperty("apiToken");
    });

    it("should strip malicious password field from imported servers", async () => {
      const serverWithPassword = {
        ...sampleServer,
        password: "leaked-password",
      };
      mockedReadFileSync.mockReturnValue(JSON.stringify([serverWithPassword]));
      mockedConfig.getServers.mockReturnValue([]);

      await importCommand("/tmp/export.json");

      const savedServer = mockedConfig.saveServer.mock.calls[0][0];
      expect(savedServer).not.toHaveProperty("password");
    });

    it("should not include prototype pollution fields in saved server", async () => {
      // Simulate JSON with __proto__ field (which JSON.parse handles safely)
      const jsonWithProto = `[{
        "id": "123",
        "name": "coolify-test",
        "provider": "hetzner",
        "ip": "1.2.3.4",
        "region": "nbg1",
        "size": "cax11",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "__proto__": {"isAdmin": true},
        "isAdmin": true
      }]`;
      mockedReadFileSync.mockReturnValue(jsonWithProto);
      mockedConfig.getServers.mockReturnValue([]);

      await importCommand("/tmp/export.json");

      const savedServer = mockedConfig.saveServer.mock.calls[0][0];
      // The sanitized object should only have the allowed fields
      expect(Object.keys(savedServer).sort()).toEqual(
        ["createdAt", "id", "ip", "mode", "name", "provider", "region", "size"].sort(),
      );
      expect(savedServer).not.toHaveProperty("isAdmin");
    });

    it("should strip constructor field (prototype pollution attempt)", async () => {
      const serverWithConstructor = {
        ...sampleServer,
        constructor: { prototype: { isAdmin: true } },
      };
      mockedReadFileSync.mockReturnValue(JSON.stringify([serverWithConstructor]));
      mockedConfig.getServers.mockReturnValue([]);

      await importCommand("/tmp/export.json");

      const savedServer = mockedConfig.saveServer.mock.calls[0][0];
      expect(savedServer.constructor).toBe(Object);
      expect(Object.keys(savedServer)).toHaveLength(8);
    });

    it("should only keep allowed fields: id, name, provider, ip, region, size, createdAt", async () => {
      const serverWithManyExtras = {
        id: "999",
        name: "test-server",
        provider: "hetzner",
        ip: "9.9.9.9",
        region: "fsn1",
        size: "cx21",
        createdAt: "2026-03-01T00:00:00.000Z",
        mode: "coolify" as const,
        apiToken: "secret",
        password: "pass123",
        secretKey: "key",
        adminAccess: true,
        rootPassword: "root",
        sshKey: "private-key-content",
      };
      mockedReadFileSync.mockReturnValue(JSON.stringify([serverWithManyExtras]));
      mockedConfig.getServers.mockReturnValue([]);

      await importCommand("/tmp/export.json");

      const savedServer = mockedConfig.saveServer.mock.calls[0][0];
      expect(Object.keys(savedServer).sort()).toEqual(
        ["createdAt", "id", "ip", "mode", "name", "provider", "region", "size"].sort(),
      );
    });
  });

  describe("import security - duplicate handling", () => {
    it("should skip duplicate servers by ID", async () => {
      mockedReadFileSync.mockReturnValue(JSON.stringify([sampleServer, sampleServer2]));
      mockedConfig.getServers.mockReturnValue([sampleServer]);

      await importCommand("/tmp/export.json");

      expect(mockedConfig.saveServer).toHaveBeenCalledTimes(1);
      expect(mockedConfig.saveServer).toHaveBeenCalledWith(
        expect.objectContaining({ id: sampleServer2.id }),
      );
    });

    it("should not import any servers if all are duplicates", async () => {
      mockedReadFileSync.mockReturnValue(JSON.stringify([sampleServer]));
      mockedConfig.getServers.mockReturnValue([sampleServer]);

      await importCommand("/tmp/export.json");

      expect(mockedConfig.saveServer).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Imported 0");
      expect(output).toContain("skipped 1");
    });
  });

  describe("export-import round trip - data integrity", () => {
    it("should preserve data integrity through export-import cycle", async () => {
      const originalServers = [sampleServer, sampleServer2];
      mockedConfig.getServers.mockReturnValue(originalServers);

      await exportCommand("/tmp/roundtrip.json");

      const [, exportedJson] = mockedWriteFileSync.mock.calls[0] as [string, string, object];

      mockedReadFileSync.mockReturnValue(exportedJson);
      mockedConfig.getServers.mockReturnValue([]);

      await importCommand("/tmp/roundtrip.json");

      expect(mockedConfig.saveServer).toHaveBeenCalledTimes(2);

      const savedServers = mockedConfig.saveServer.mock.calls.map((call) => call[0]);
      expect(savedServers[0]).toEqual(sampleServer);
      expect(savedServers[1]).toEqual(sampleServer2);
    });

    it("should handle empty export gracefully", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      await exportCommand();

      expect(mockedWriteFileSync).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No servers to export");
    });
  });

  describe("import validation - malformed data rejection", () => {
    it("should reject non-array JSON data", async () => {
      mockedReadFileSync.mockReturnValue(JSON.stringify({ server: sampleServer }));

      await importCommand("/tmp/bad.json");

      expect(mockedConfig.saveServer).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid server data");
    });

    it("should reject servers with missing required fields", async () => {
      const incompleteServer = {
        id: "123",
        name: "incomplete",
        // missing: provider, ip, region, size, createdAt
      };
      mockedReadFileSync.mockReturnValue(JSON.stringify([incompleteServer]));

      await importCommand("/tmp/incomplete.json");

      expect(mockedConfig.saveServer).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid server data");
    });

    it("should reject servers with non-string field values", async () => {
      const badTypeServer = {
        ...sampleServer,
        id: 123, // should be string
      };
      mockedReadFileSync.mockReturnValue(JSON.stringify([badTypeServer]));

      await importCommand("/tmp/badtype.json");

      expect(mockedConfig.saveServer).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid server data");
    });
  });
});
