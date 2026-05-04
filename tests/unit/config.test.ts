import {
  getServers,
  saveServer,
  updateServer,
  removeServer,
  findServer,
  SERVERS_FILE,
} from "../../src/utils/config";
import { KASTELL_DIR } from "../../src/utils/paths";
import * as fs from "fs";
import * as secureWriteModule from "../../src/utils/secureWrite";

jest.mock("fs");
jest.mock("os", () => ({
  homedir: () => "/mock-home",
  userInfo: () => ({ username: "testuser", uid: 1000, gid: 1000, shell: "/bin/bash", homedir: "/mock-home" }),
}));
jest.mock("../../src/utils/fileLock", () => ({
  withFileLock: jest.fn((_path: string, fn: () => any) => fn()),
}));
jest.mock("../../src/utils/secureWrite", () => {
  const actual = jest.requireActual("../../src/utils/secureWrite") as typeof import("../../src/utils/secureWrite");
  return {
    __esModule: true,
    secureWriteFileSync: jest.fn(actual.secureWriteFileSync),
    secureMkdirSync: jest.fn(actual.secureMkdirSync),
  };
});

const mockedFs = fs as jest.Mocked<typeof fs>;
const { secureWriteFileSync } = secureWriteModule;

describe("config", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getServers", () => {
    it("should return empty array when file does not exist", () => {
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      mockedFs.readFileSync.mockImplementation(() => { throw err; });
      expect(getServers()).toEqual([]);
    });

    it("should return parsed servers from file", () => {
      const servers = [
        {
          id: "123",
          name: "test",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));
      // mode defaults to 'coolify' for records without mode field
      expect(getServers()).toEqual([{ ...servers[0], mode: "coolify" }]);
    });

    it("should default mode to 'coolify' for records without mode field", () => {
      const servers = [
        {
          id: "1",
          name: "legacy",
          provider: "hetzner",
          ip: "1.1.1.1",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01T00:00:00Z",
          // no mode field
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));
      const result = getServers();
      expect(result[0].mode).toBe("coolify");
    });

    it("should preserve mode='coolify' for servers that already have it", () => {
      const servers = [
        {
          id: "2",
          name: "explicit-coolify",
          provider: "digitalocean",
          ip: "2.2.2.2",
          region: "nyc1",
          size: "s-2vcpu-2gb",
          createdAt: "2026-01-01T00:00:00Z",
          mode: "coolify",
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));
      const result = getServers();
      expect(result[0].mode).toBe("coolify");
    });

    it("should preserve mode='bare' for bare servers", () => {
      const servers = [
        {
          id: "3",
          name: "bare-server",
          provider: "hetzner",
          ip: "3.3.3.3",
          region: "fsn1",
          size: "cax11",
          createdAt: "2026-01-01T00:00:00Z",
          mode: "bare",
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));
      const result = getServers();
      expect(result[0].mode).toBe("bare");
    });

    it("should throw on corrupt/invalid JSON in servers.json", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue("not-json{{{");
      expect(() => getServers()).toThrow();
    });

    it("should throw with 'corrupt' message when file contains non-array JSON", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('{"not": "array"}');
      expect(() => getServers()).toThrow(/corrupt/);
    });

    it("should apply mode default in-memory without writing to disk", () => {
      const servers = [
        {
          id: "1",
          name: "legacy",
          provider: "hetzner",
          ip: "1.1.1.1",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));
      const result = getServers();
      expect(result[0].mode).toBe("coolify");
      expect(secureWriteFileSync).not.toHaveBeenCalled();
      expect(mockedFs.renameSync).not.toHaveBeenCalled();
    });
  });

  describe("saveServer", () => {
    it("should create config dir and write server", async () => {
      mockedFs.existsSync
        .mockReturnValueOnce(false) // ensureConfigDir
        .mockReturnValueOnce(false); // getServers: file doesn't exist
      mockedFs.readFileSync.mockReturnValue("[]");

      const record = {
        id: "1",
        name: "srv",
        provider: "hetzner",
        ip: "1.2.3.4",
        region: "nbg1",
        size: "cax11",
        createdAt: "2026-01-01T00:00:00Z",
        mode: "coolify" as const,
      };
      await saveServer(record);

      expect(mockedFs.mkdirSync).toHaveBeenCalled();
      expect(secureWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("servers.json"),
        expect.stringContaining('"1.2.3.4"'),
      );
    });

    it("should append to existing servers", async () => {
      const existing = [
        {
          id: "1",
          name: "old",
          provider: "hetzner",
          ip: "1.1.1.1",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01T00:00:00Z",
          mode: "coolify",
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));

      const record = {
        id: "2",
        name: "new",
        provider: "digitalocean",
        ip: "2.2.2.2",
        region: "nyc1",
        size: "s-2vcpu-2gb",
        createdAt: "2026-02-01T00:00:00Z",
        mode: "coolify" as const,
      };
      await saveServer(record);

      const writtenData = JSON.parse((secureWriteFileSync as jest.Mock).mock.calls[0][1]);
      expect(writtenData).toHaveLength(2);
      expect(writtenData[1].ip).toBe("2.2.2.2");
    });
  });

  describe("updateServer", () => {
    it("should update server and return true", async () => {
      const servers = [
        {
          id: "1",
          name: "test-srv",
          provider: "hetzner",
          ip: "1.1.1.1",
          region: "nbg1",
          size: "cax11",
          createdAt: "",
          mode: "coolify",
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));

      const result = await updateServer("test-srv", { domain: "example.com" });
      expect(result).toBe(true);
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
    });

    it("should return false when server not found", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue("[]");

      const result = await updateServer("nonexistent", { domain: "example.com" });
      expect(result).toBe(false);
    });
  });

  describe("removeServer", () => {
    it("should remove server by id and return true", async () => {
      const servers = [
        {
          id: "1",
          name: "a",
          provider: "hetzner",
          ip: "1.1.1.1",
          region: "nbg1",
          size: "cax11",
          createdAt: "",
          mode: "coolify",
        },
        {
          id: "2",
          name: "b",
          provider: "hetzner",
          ip: "2.2.2.2",
          region: "fsn1",
          size: "cx23",
          createdAt: "",
          mode: "coolify",
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));

      const result = await removeServer("1");

      expect(result).toBe(true);
      const writtenData = JSON.parse((secureWriteFileSync as jest.Mock).mock.calls[0][1]);
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].id).toBe("2");
    });

    it("should return false when server not found", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue("[]");

      const result = await removeServer("nonexistent");
      expect(result).toBe(false);
    });

    it("should use atomic write (renameSync) instead of raw writeFileSync", async () => {
      const servers = [
        {
          id: "1",
          name: "to-remove",
          provider: "hetzner",
          ip: "1.1.1.1",
          region: "nbg1",
          size: "cax11",
          createdAt: "",
          mode: "coolify",
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));

      await removeServer("1");

      // Should use atomic write: write to .tmp then rename
      expect(secureWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("servers.json.tmp"),
        expect.any(String),
      );
      expect(mockedFs.renameSync).toHaveBeenCalledWith(
        expect.stringContaining("servers.json.tmp"),
        expect.stringContaining("servers.json"),
      );
    });
  });

  describe("findServer", () => {
    const servers = [
      {
        id: "1",
        name: "alpha",
        provider: "hetzner",
        ip: "10.0.0.1",
        region: "nbg1",
        size: "cax11",
        createdAt: "",
      },
      {
        id: "2",
        name: "beta",
        provider: "digitalocean",
        ip: "10.0.0.2",
        region: "nyc1",
        size: "s-2vcpu-2gb",
        createdAt: "",
      },
    ];

    beforeEach(() => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));
    });

    it("should find by IP", () => {
      const result = findServer("10.0.0.1");
      expect(result?.name).toBe("alpha");
    });

    it("should find by name", () => {
      const result = findServer("beta");
      expect(result?.ip).toBe("10.0.0.2");
    });

    it("should return undefined when not found", () => {
      const result = findServer("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should prefer IP match over name match", () => {
      // If somehow an IP is also a name (unlikely), IP takes priority
      const result = findServer("10.0.0.2");
      expect(result?.name).toBe("beta");
    });
  });

  describe("constants", () => {
    it("should have correct config paths", () => {
      expect(KASTELL_DIR).toContain(".kastell");
      expect(SERVERS_FILE).toContain("servers.json");
    });
  });
});
