import { getServers, saveServer, removeServer, findServer } from "../../src/utils/config";
import * as fs from "fs";

jest.mock("fs");
jest.mock("os", () => ({
  homedir: () => "/mock-home",
}));
jest.mock("../../src/utils/fileLock", () => ({
  withFileLock: jest.fn((_path: string, fn: () => any) => fn()),
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

describe("config edge cases", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getServers edge cases", () => {
    it("should throw when readFileSync throws an error (fail-closed)", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      expect(() => getServers()).toThrow("Permission denied");
    });

    it("should throw on null in JSON file (fail-closed)", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue("null");
      expect(() => getServers()).toThrow(/corrupt/);
    });

    it("should throw on number in JSON file (fail-closed)", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue("42");
      expect(() => getServers()).toThrow(/corrupt/);
    });

    it("should throw on empty file (fail-closed)", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue("");
      expect(() => getServers()).toThrow();
    });
  });

  describe("saveServer edge cases", () => {
    it("should not create dir if it already exists", async () => {
      mockedFs.existsSync.mockReturnValue(true); // ensureConfigDir - dir exists
      const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      mockedFs.readFileSync.mockImplementation(() => { throw enoent; }); // getServers - file doesn't exist

      const record = {
        id: "1",
        name: "test",
        provider: "hetzner",
        ip: "1.1.1.1",
        region: "nbg1",
        size: "cax11",
        createdAt: "",
        mode: "coolify" as const,
      };
      await saveServer(record);

      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe("removeServer edge cases", () => {
    it("should handle removing from single-element array", async () => {
      const servers = [
        {
          id: "1",
          name: "a",
          provider: "hetzner",
          ip: "1.1.1.1",
          region: "nbg1",
          size: "cax11",
          createdAt: "",
          mode: "coolify" as const,
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));

      const result = await removeServer("1");

      expect(result).toBe(true);
      const writtenData = JSON.parse((mockedFs.writeFileSync as jest.Mock).mock.calls[0][1]);
      expect(writtenData).toHaveLength(0);
    });

    it("should not modify file when server not found", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify([
          {
            id: "1",
            name: "a",
            provider: "hetzner",
            ip: "1.1.1.1",
            region: "",
            size: "",
            createdAt: "",
            mode: "coolify" as const,
          },
        ]),
      );

      const result = await removeServer("999");

      expect(result).toBe(false);
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe("findServer edge cases", () => {
    it("should handle empty servers array", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue("[]");

      expect(findServer("anything")).toBeUndefined();
    });

    it("should find server by IP when name also matches another", () => {
      const servers = [
        {
          id: "1",
          name: "alpha",
          provider: "hetzner",
          ip: "10.0.0.1",
          region: "nbg1",
          size: "cax11",
          createdAt: "",
          mode: "coolify" as const,
        },
        {
          id: "2",
          name: "10.0.0.1",
          provider: "digitalocean",
          ip: "10.0.0.2",
          region: "nyc1",
          size: "s-2vcpu-2gb",
          createdAt: "",
          mode: "coolify" as const,
        },
      ];
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));

      // IP search takes priority over name search
      const result = findServer("10.0.0.1");
      expect(result?.id).toBe("1");
    });
  });
});
