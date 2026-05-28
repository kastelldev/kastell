import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import * as fs from "fs";

jest.mock("fs");
jest.mock("../../../src/utils/paths.js", () => ({
  KASTELL_DIR: "/home/user/.kastell",
  SERVERS_FILE: "/home/user/.kastell/servers.json",
}));
jest.mock("../../../src/utils/secureWrite.js", () => ({
  secureMkdirSync: jest.fn(),
  secureWriteFileSync: jest.fn(),
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

const asStats = (obj: object) => obj as unknown as import("fs").Stats;
const jsonString = (data: unknown) => JSON.stringify(data) as unknown as string;

describe("getServers cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("cache hit returns same data", async () => {
    await jest.isolateModules(async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue(asStats({ mtimeMs: 1000, dev: 1, isFile: () => true }));
      mockedFs.readFileSync.mockReturnValue(jsonString([{ name: "s1", ip: "1.1.1.1" }]));

      const { getServers, clearServersCache } = await import("../../../src/utils/config.js");
      clearServersCache();

      const r1 = getServers();
      const r2 = getServers();

      expect(r1).toEqual(r2);
      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);
    });
  });

  it("second call reloads when mtime changes", async () => {
    await jest.isolateModules(async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync
        .mockReturnValueOnce(asStats({ mtimeMs: 1000, dev: 1, isFile: () => true }))
        .mockReturnValueOnce(asStats({ mtimeMs: 2000, dev: 1, isFile: () => true }))
        .mockReturnValueOnce(asStats({ mtimeMs: 2000, dev: 1, isFile: () => true }));
      mockedFs.readFileSync
        .mockReturnValueOnce(jsonString([{ name: "old" }]))
        .mockReturnValueOnce(jsonString([{ name: "new" }]));

      const { getServers, clearServersCache } = await import("../../../src/utils/config.js");
      clearServersCache();

      expect(getServers()[0]?.name).toBe("old");
      expect(getServers()[0]?.name).toBe("new");
      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(2);
    });
  });

  it("cache disabled when dev changes", async () => {
    await jest.isolateModules(async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync
        .mockReturnValueOnce(asStats({ mtimeMs: 1000, dev: 1, isFile: () => true }))
        .mockReturnValueOnce(asStats({ mtimeMs: 1000, dev: 2, isFile: () => true }))
        .mockReturnValueOnce(asStats({ mtimeMs: 1000, dev: 2, isFile: () => true }));
      mockedFs.readFileSync
        .mockReturnValueOnce(jsonString([]))
        .mockReturnValueOnce(jsonString([]));

      const { getServers, clearServersCache } = await import("../../../src/utils/config.js");
      clearServersCache();

      getServers();
      getServers();
      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(2);
    });
  });

  it("fresh data after disk write", async () => {
    await jest.isolateModules(async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync
        .mockReturnValueOnce(asStats({ mtimeMs: 1000, dev: 1, isFile: () => true }))
        .mockReturnValueOnce(asStats({ mtimeMs: 2000, dev: 1, isFile: () => true }))
        .mockReturnValueOnce(asStats({ mtimeMs: 2000, dev: 1, isFile: () => true }));
      mockedFs.readFileSync
        .mockReturnValueOnce(jsonString([{ name: "s1" }]))
        .mockReturnValueOnce(jsonString([{ name: "s1" }, { name: "s2" }]));

      const { getServers, clearServersCache } = await import("../../../src/utils/config.js");
      clearServersCache();

      expect(getServers()).toHaveLength(1);
      expect(getServers()).toHaveLength(2);
    });
  });
});