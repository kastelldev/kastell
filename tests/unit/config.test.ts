import {
  getServers,
  saveServer,
  removeServer,
  findServer,
  SERVERS_FILE,
  CONFIG_DIR,
} from "../../src/utils/config";
import * as fs from "fs";

jest.mock("fs");
jest.mock("os", () => ({
  homedir: () => "/mock-home",
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

describe("config", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getServers", () => {
    it("should return empty array when file does not exist", () => {
      mockedFs.existsSync.mockReturnValue(false);
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

    it("should return empty array when file contains invalid JSON", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue("not-json{{{");
      expect(getServers()).toEqual([]);
    });

    it("should return empty array when file contains non-array JSON", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('{"not": "array"}');
      expect(getServers()).toEqual([]);
    });
  });

  describe("saveServer", () => {
    it("should create config dir and write server", () => {
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
      };
      saveServer(record);

      expect(mockedFs.mkdirSync).toHaveBeenCalled();
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("servers.json"),
        expect.stringContaining('"1.2.3.4"'),
        expect.objectContaining({ mode: 0o600 }),
      );
    });

    it("should append to existing servers", () => {
      const existing = [
        {
          id: "1",
          name: "old",
          provider: "hetzner",
          ip: "1.1.1.1",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01T00:00:00Z",
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
      };
      saveServer(record);

      const writtenData = JSON.parse((mockedFs.writeFileSync as jest.Mock).mock.calls[0][1]);
      expect(writtenData).toHaveLength(2);
      expect(writtenData[1].ip).toBe("2.2.2.2");
    });
  });

  describe("removeServer", () => {
    it("should remove server by id and return true", () => {
      const servers = [
        {
          id: "1",
          name: "a",
          provider: "hetzner",
          ip: "1.1.1.1",
          region: "nbg1",
          size: "cax11",
          createdAt: "",
        },
        {
          id: "2",
          name: "b",
          provider: "hetzner",
          ip: "2.2.2.2",
          region: "fsn1",
          size: "cx23",
          createdAt: "",
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));

      const result = removeServer("1");

      expect(result).toBe(true);
      const writtenData = JSON.parse((mockedFs.writeFileSync as jest.Mock).mock.calls[0][1]);
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].id).toBe("2");
    });

    it("should return false when server not found", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue("[]");

      const result = removeServer("nonexistent");
      expect(result).toBe(false);
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
      expect(CONFIG_DIR).toContain(".kastell");
      expect(SERVERS_FILE).toContain("servers.json");
    });
  });
});
