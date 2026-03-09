import { readFileSync, writeFileSync } from "fs";
import * as config from "../../src/utils/config";
import { validateServerRecords, exportCommand, importCommand } from "../../src/commands/transfer";

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

describe("transfer", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("validateServerRecords", () => {
    it("should validate valid array", () => {
      const result = validateServerRecords([sampleServer]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject non-array data", () => {
      const result = validateServerRecords({ not: "array" });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("JSON array");
    });

    it("should reject null data", () => {
      const result = validateServerRecords(null);
      expect(result.valid).toBe(false);
    });

    it("should reject non-object items", () => {
      const result = validateServerRecords(["not-an-object"]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("must be an object");
    });

    it("should reject items with missing fields", () => {
      const result = validateServerRecords([{ id: "1", name: "test" }]);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject items with non-string fields", () => {
      const result = validateServerRecords([{ ...sampleServer, id: 123 }]);
      expect(result.valid).toBe(false);
    });

    it("should validate empty array", () => {
      const result = validateServerRecords([]);
      expect(result.valid).toBe(true);
    });

    it("should reject null items in array", () => {
      const result = validateServerRecords([null]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("must be an object");
    });
  });

  describe("exportCommand", () => {
    it("should export servers to default path", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);

      await exportCommand();

      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("kastell-export.json"),
        JSON.stringify([sampleServer], null, 2),
        { encoding: "utf-8", mode: 0o600 },
      );
    });

    it("should export servers to custom path", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);

      await exportCommand("/tmp/my-export.json");

      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("my-export.json"),
        expect.any(String),
        { encoding: "utf-8", mode: 0o600 },
      );
    });

    it("should show info when no servers to export", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      await exportCommand();

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No servers to export");
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it("should handle write error", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedWriteFileSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      await exportCommand();

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Failed to write");
    });

    it("should show filesystem hint on write EACCES error", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      const err = new Error("write failed") as NodeJS.ErrnoException;
      err.code = "EACCES";
      mockedWriteFileSync.mockImplementation(() => {
        throw err;
      });

      await exportCommand();

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Permission denied");
    });

    it("should show security warning after export", async () => {
      mockedWriteFileSync.mockReset();
      mockedConfig.getServers.mockReturnValue([sampleServer]);

      await exportCommand();

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Store it securely");
    });
  });

  describe("importCommand", () => {
    it("should import servers from file", async () => {
      mockedReadFileSync.mockReturnValue(JSON.stringify([sampleServer]));
      mockedConfig.getServers.mockReturnValue([]);

      await importCommand("/tmp/export.json");

      // saveServer should be called with sanitized fields only
      expect(mockedConfig.saveServer).toHaveBeenCalledWith({
        id: sampleServer.id,
        name: sampleServer.name,
        provider: sampleServer.provider,
        ip: sampleServer.ip,
        region: sampleServer.region,
        size: sampleServer.size,
        createdAt: sampleServer.createdAt,
        mode: "coolify" as const,
      });
    });

    it("should skip duplicate servers by ID", async () => {
      mockedReadFileSync.mockReturnValue(JSON.stringify([sampleServer, sampleServer2]));
      mockedConfig.getServers.mockReturnValue([sampleServer]);

      await importCommand("/tmp/export.json");

      expect(mockedConfig.saveServer).toHaveBeenCalledTimes(1);
      // saveServer should be called with sanitized fields only
      expect(mockedConfig.saveServer).toHaveBeenCalledWith({
        id: sampleServer2.id,
        name: sampleServer2.name,
        provider: sampleServer2.provider,
        ip: sampleServer2.ip,
        region: sampleServer2.region,
        size: sampleServer2.size,
        createdAt: sampleServer2.createdAt,
        mode: "coolify" as const,
      });
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Imported 1");
      expect(output).toContain("skipped 1");
    });

    it("should show error for missing path", async () => {
      await importCommand("");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
    });

    it("should handle file read error", async () => {
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      await importCommand("/tmp/nonexistent.json");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Failed to read");
    });

    it("should show filesystem hint on read ENOENT error", async () => {
      const err = new Error("no such file") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      mockedReadFileSync.mockImplementation(() => {
        throw err;
      });

      await importCommand("/tmp/missing.json");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("File or directory not found");
    });

    it("should handle invalid JSON", async () => {
      mockedReadFileSync.mockReturnValue("not json{{{");

      await importCommand("/tmp/bad.json");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("not valid JSON");
    });

    it("should handle invalid server data", async () => {
      mockedReadFileSync.mockReturnValue(JSON.stringify({ not: "array" }));

      await importCommand("/tmp/bad.json");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid server data");
    });

    it("should skip all duplicates when all exist", async () => {
      mockedReadFileSync.mockReturnValue(JSON.stringify([sampleServer]));
      mockedConfig.getServers.mockReturnValue([sampleServer]);

      await importCommand("/tmp/export.json");

      expect(mockedConfig.saveServer).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Imported 0");
      expect(output).toContain("skipped 1");
    });

    it("should strip extra fields from imported servers", async () => {
      const serverWithExtras = {
        ...sampleServer,
        extraField: "should-be-removed",
        apiToken: "secret-token",
      };
      mockedReadFileSync.mockReturnValue(JSON.stringify([serverWithExtras]));
      mockedConfig.getServers.mockReturnValue([]);

      await importCommand("/tmp/export.json");

      const savedServer = mockedConfig.saveServer.mock.calls[0][0];
      expect(savedServer).not.toHaveProperty("extraField");
      expect(savedServer).not.toHaveProperty("apiToken");
      expect(savedServer).toHaveProperty("id", sampleServer.id);
      expect(savedServer).toHaveProperty("name", sampleServer.name);
    });
  });
});
