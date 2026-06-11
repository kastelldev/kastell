import {
  getServers,
  getServersRaw,
  clearServersCache,
  saveServer,
  updateServer,
  removeServer,
  findServer,
  findServers,
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
const asStats = (obj: object) => obj as unknown as import("fs").Stats;

describe("config", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearServersCache();
    // memoizeOnStat calls statSync on every invocation to check mtime/dev.
    // Default to a valid stat so the existing tests' setup (readFileSync mock)
    // continues to drive the cache miss path. Tests that need ENOENT override
    // with mockReturnValueOnce/mockImplementationOnce.
    mockedFs.statSync.mockReturnValue(asStats({ mtimeMs: 1704067200000, dev: 1 }));
  });

  describe("getServersRaw", () => {
    it("should throw 'servers.json corrupt' when JSON.parse returns non-array", () => {
      // Covers config.ts L17-19: parsed !== Array guard
      mockedFs.readFileSync.mockReturnValue('"not an array"');
      expect(() => getServersRaw()).toThrow("servers.json corrupt");
    });
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

    it("should warn and filter out servers with unknown provider", () => {
      // Covers config.ts L62-64: unknown provider path → stderr warning + filter
      const servers = [
        {
          id: "1",
          name: "valid-hetzner",
          provider: "hetzner",
          ip: "1.1.1.1",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "2",
          name: "bogus-cloud",
          provider: "fake-cloud",
          ip: "2.2.2.2",
          region: "nowhere",
          size: "huge",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));
      const stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);

      const result = getServers();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("valid-hetzner");
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('skipping server "bogus-cloud"'),
      );
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown provider "fake-cloud"'),
      );
      stderrSpy.mockRestore();
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

    it("invalidates cache when file mtime changes", () => {
      const servers1 = [
        {
          id: "1",
          name: "old",
          provider: "hetzner",
          ip: "1.1.1.1",
          region: "nbg1",
          size: "cax11",
          createdAt: "",
        },
      ];
      const servers2 = [
        {
          id: "2",
          name: "new",
          provider: "hetzner",
          ip: "2.2.2.2",
          region: "nbg1",
          size: "cax11",
          createdAt: "",
        },
      ];

      // First call: mtime 1000, returns servers1
      mockedFs.statSync.mockReturnValueOnce(asStats({ mtimeMs: 1000, dev: 1 }));
      mockedFs.readFileSync.mockReturnValueOnce(JSON.stringify(servers1));
      expect(getServers()).toEqual([{ ...servers1[0], mode: "coolify" }]);

      // Second call: mtime changed to 2000, returns servers2
      mockedFs.statSync.mockReturnValueOnce(asStats({ mtimeMs: 2000, dev: 1 }));
      mockedFs.readFileSync.mockReturnValueOnce(JSON.stringify(servers2));
      expect(getServers()).toEqual([{ ...servers2[0], mode: "coolify" }]);

      // readFileSync was called twice — cache was invalidated by mtime change
      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(2);
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
        expect.stringContaining("servers.json.tmp"),
        expect.stringContaining('"1.2.3.4"'),
        expect.any(Object),
      );
    });

    it.each([
      {
        label: "name",
        existingName: "dup-name",
        existingIp: "1.1.1.1",
        conflictName: "dup-name",
        conflictIp: "9.9.9.9",
        expected: /name "dup-name"/,
      },
      {
        label: "IP",
        existingName: "alpha",
        existingIp: "1.1.1.1",
        conflictName: "beta",
        conflictIp: "1.1.1.1",
        expected: /IP 1\.1\.1\.1/,
      },
    ])(
      "should reject adding a server whose $label already exists (L77-80)",
      async ({ existingName, existingIp, conflictName, conflictIp, expected }) => {
        const existing = [
          {
            id: "1",
            name: existingName,
            provider: "hetzner",
            ip: existingIp,
            region: "nbg1",
            size: "cax11",
            createdAt: "2026-01-01T00:00:00Z",
            mode: "coolify",
          },
        ];
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));

        const conflict = {
          id: "2",
          name: conflictName,
          provider: "digitalocean",
          ip: conflictIp,
          region: "nyc1",
          size: "s-2vcpu-2gb",
          createdAt: "2026-02-01T00:00:00Z",
          mode: "coolify" as const,
        };

        await expect(saveServer(conflict)).rejects.toThrow(expected);
        // Rejected record must not hit disk
        expect(secureWriteFileSync).not.toHaveBeenCalled();
      },
    );

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

    it.each(["pending", "0.0.0.0", ""])(
      "should accept multiple servers with sentinel IP %j (not treated as duplicate)",
      async (ip) => {
        const [prefix] = ip === "" ? ["empty"] : ip === "0.0.0.0" ? ["zero"] : ["pending"];
        // First save: file is empty
        mockedFs.existsSync.mockReturnValue(false);
        mockedFs.readFileSync.mockReturnValueOnce("[]");
        await saveServer({
          id: "1",
          name: `${prefix}-one`,
          provider: "hetzner",
          ip,
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01T00:00:00Z",
          mode: "coolify" as const,
        });

        // Second save: cache invalidates (mtime bumped), file now has one entry
        mockedFs.statSync.mockReturnValueOnce(asStats({ mtimeMs: 1704067300000, dev: 1 }));
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValueOnce(
          JSON.stringify([
            {
              id: "1",
              name: `${prefix}-one`,
              provider: "hetzner",
              ip,
              region: "nbg1",
              size: "cax11",
              createdAt: "2026-01-01T00:00:00Z",
              mode: "coolify",
            },
          ]),
        );
        await saveServer({
          id: "2",
          name: `${prefix}-two`,
          provider: "hetzner",
          ip,
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01T00:00:00Z",
          mode: "coolify" as const,
        });

        const writes = (secureWriteFileSync as jest.Mock).mock.calls;
        const lastWrite = JSON.parse(writes[writes.length - 1][1]);
        expect(lastWrite).toHaveLength(2);
        expect(lastWrite.map((r: { name: string }) => r.name).sort()).toEqual([
          `${prefix}-one`,
          `${prefix}-two`,
        ]);
      },
    );

    it("should still reject concrete IP collisions (203.0.113.10)", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify([
          {
            id: "1",
            name: "one",
            provider: "hetzner",
            ip: "203.0.113.10",
            region: "nbg1",
            size: "cax11",
            createdAt: "2026-01-01T00:00:00Z",
            mode: "coolify",
          },
        ]),
      );

      await expect(
        saveServer({
          id: "2",
          name: "two",
          provider: "hetzner",
          ip: "203.0.113.10",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01T00:00:00Z",
          mode: "coolify" as const,
        }),
      ).rejects.toThrow(/IP 203\.0\.113\.10/);
      expect(secureWriteFileSync).not.toHaveBeenCalled();
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
        expect.any(Object),
      );
      expect(mockedFs.renameSync).toHaveBeenCalledWith(
        expect.stringContaining("servers.json.tmp"),
        expect.stringContaining("servers.json"),
      );
    });

    it("should fall back to copy and unlink when servers.json rename hits transient EPERM", async () => {
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
      const err = Object.assign(new Error("EPERM"), { code: "EPERM" });
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));
      mockedFs.renameSync
        .mockImplementationOnce(() => {
          throw err;
        })
        .mockImplementationOnce(() => {
          throw err;
        })
        .mockImplementationOnce(() => {
          throw err;
        });

      await removeServer("1");

      expect(mockedFs.copyFileSync).toHaveBeenCalledWith(
        expect.stringContaining("servers.json.tmp"),
        SERVERS_FILE,
      );
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining("servers.json.tmp"),
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

  describe("findServers", () => {
    // Covers config.ts L117-122: byIp match branch + name fallback
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
      {
        id: "3",
        name: "gamma",
        provider: "hetzner",
        ip: "10.0.0.3",
        region: "fsn1",
        size: "cx23",
        createdAt: "",
      },
    ];

    beforeEach(() => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));
    });

    it("should return all servers matching the IP query (L117-120 branch)", () => {
      // Multiple servers could in theory share an IP (e.g. NAT'd). byIp
      // branch returns the full filtered set instead of taking the first.
      const sharedIpServers = [
        { ...servers[0], ip: "10.0.0.1" },
        { ...servers[1], ip: "10.0.0.1" },
        { ...servers[2], ip: "10.0.0.2" },
      ];
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(sharedIpServers));

      const result = findServers("10.0.0.1");
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
    });

    it("should fall back to name search when no IP match (L121-122 branch)", () => {
      const result = findServers("beta");
      expect(result).toHaveLength(1);
      expect(result[0].ip).toBe("10.0.0.2");
    });

    it("should return empty array when neither IP nor name matches", () => {
      const result = findServers("nonexistent");
      expect(result).toEqual([]);
    });
  });

  describe("constants", () => {
    it("should have correct config paths", () => {
      expect(KASTELL_DIR).toContain(".kastell");
      expect(SERVERS_FILE).toContain("servers.json");
    });
  });
});
