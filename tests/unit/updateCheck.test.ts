import { isNewerVersion, checkForUpdate, UPDATE_CHECK_FILE } from "../../src/utils/updateCheck";
import * as fs from "fs";
import * as os from "os";
import axios from "axios";

jest.mock("fs");
jest.mock("os", () => ({
  homedir: () => "/mock-home",
}));
jest.mock("axios");

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock logger to capture messages
const mockLoggerInfo = jest.fn();
jest.mock("../../src/utils/logger", () => ({
  logger: {
    info: (msg: string) => mockLoggerInfo(msg),
  },
}));

describe("updateCheck", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-02-25T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("isNewerVersion", () => {
    it("should return true when latest is newer (patch)", () => {
      expect(isNewerVersion("1.0.2", "1.0.3")).toBe(true);
    });

    it("should return false when versions are equal", () => {
      expect(isNewerVersion("1.0.2", "1.0.2")).toBe(false);
    });

    it("should return false when current is newer", () => {
      expect(isNewerVersion("1.0.3", "1.0.2")).toBe(false);
    });

    it("should return true when latest has newer minor", () => {
      expect(isNewerVersion("1.0.9", "1.1.0")).toBe(true);
    });

    it("should return true when latest has newer major", () => {
      expect(isNewerVersion("1.9.9", "2.0.0")).toBe(true);
    });

    it("should handle v prefix on current", () => {
      expect(isNewerVersion("v1.0.2", "1.0.3")).toBe(true);
    });

    it("should handle v prefix on latest", () => {
      expect(isNewerVersion("1.0.2", "v1.0.3")).toBe(true);
    });

    it("should handle v prefix on both", () => {
      expect(isNewerVersion("v1.0.2", "v1.0.3")).toBe(true);
    });

    it("should handle versions with different lengths", () => {
      expect(isNewerVersion("1.0", "1.0.1")).toBe(true);
      expect(isNewerVersion("1.0.1", "1.0")).toBe(false);
    });
  });

  describe("checkForUpdate", () => {
    it("should show message when newer version available (fresh fetch)", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedAxios.get.mockResolvedValue({ data: { version: "2.0.0" } });

      await checkForUpdate("1.0.2");

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Update available: 1.0.2 → 2.0.0 — Run: npm i -g kastell",
      );
    });

    it("should be silent when current is latest", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedAxios.get.mockResolvedValue({ data: { version: "1.0.2" } });

      await checkForUpdate("1.0.2");

      expect(mockLoggerInfo).not.toHaveBeenCalled();
    });

    it("should be silent when current is newer than latest", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedAxios.get.mockResolvedValue({ data: { version: "1.0.1" } });

      await checkForUpdate("1.0.2");

      expect(mockLoggerInfo).not.toHaveBeenCalled();
    });

    it("should use cache when less than 24h old", async () => {
      const cache = {
        lastCheck: Date.now() - 12 * 60 * 60 * 1000, // 12 hours ago
        latestVersion: "2.0.0",
      };
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(cache));

      await checkForUpdate("1.0.2");

      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Update available: 1.0.2 → 2.0.0 — Run: npm i -g kastell",
      );
    });

    it("should fetch registry when cache is stale (>24h)", async () => {
      const cache = {
        lastCheck: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        latestVersion: "1.0.3",
      };
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(cache));
      mockedAxios.get.mockResolvedValue({ data: { version: "2.0.0" } });

      await checkForUpdate("1.0.2");

      expect(mockedAxios.get).toHaveBeenCalledWith("https://registry.npmjs.org/kastell/latest", {
        timeout: 3000,
      });
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Update available: 1.0.2 → 2.0.0 — Run: npm i -g kastell",
      );
    });

    it("should handle network error silently", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedAxios.get.mockRejectedValue(new Error("Network error"));

      await expect(checkForUpdate("1.0.2")).resolves.toBeUndefined();
      expect(mockLoggerInfo).not.toHaveBeenCalled();
    });

    it("should handle corrupt cache silently", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue("not-valid-json{{{");
      mockedAxios.get.mockResolvedValue({ data: { version: "2.0.0" } });

      await checkForUpdate("1.0.2");

      expect(mockedAxios.get).toHaveBeenCalled();
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Update available: 1.0.2 → 2.0.0 — Run: npm i -g kastell",
      );
    });

    it("should handle missing cache directory", async () => {
      mockedFs.existsSync
        .mockReturnValueOnce(false) // UPDATE_CHECK_FILE
        .mockReturnValueOnce(false); // CONFIG_DIR in writeCache
      mockedAxios.get.mockResolvedValue({ data: { version: "2.0.0" } });

      await checkForUpdate("1.0.2");

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining(".kastell"), {
        recursive: true,
        mode: 0o700,
      });
    });

    it("should write cache after successful check", async () => {
      mockedFs.existsSync.mockReturnValue(true); // CONFIG_DIR exists
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error("File not found");
      });
      mockedAxios.get.mockResolvedValue({ data: { version: "2.0.0" } });

      await checkForUpdate("1.0.2");

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining(".update-check"),
        expect.stringContaining('"latestVersion":"2.0.0"'),
        { mode: 0o600 },
      );
    });

    it("should handle invalid response data silently", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedAxios.get.mockResolvedValue({ data: { invalid: "response" } });

      await expect(checkForUpdate("1.0.2")).resolves.toBeUndefined();
      expect(mockLoggerInfo).not.toHaveBeenCalled();
    });

    it("should reject non-semver version from registry (ANSI injection)", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedAxios.get.mockResolvedValue({
        data: { version: "\u001b[31mRun evil command\u001b[0m" },
      });

      await checkForUpdate("1.0.2");

      expect(mockLoggerInfo).not.toHaveBeenCalled();
    });

    it("should reject malicious version in cache file", async () => {
      const cache = {
        lastCheck: Date.now() - 1000,
        latestVersion: "evil;rm -rf /",
      };
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(cache));
      mockedAxios.get.mockResolvedValue({ data: { version: "2.0.0" } });

      await checkForUpdate("1.0.2");

      // Should treat cache as invalid and fetch from registry
      expect(mockedAxios.get).toHaveBeenCalled();
    });

    it("should handle cache with invalid structure", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('{"lastCheck": "not-a-number"}');
      mockedAxios.get.mockResolvedValue({ data: { version: "2.0.0" } });

      await checkForUpdate("1.0.2");

      expect(mockedAxios.get).toHaveBeenCalled();
    });
  });

  describe("UPDATE_CHECK_FILE", () => {
    it("should have correct path", () => {
      expect(UPDATE_CHECK_FILE).toContain(".kastell");
      expect(UPDATE_CHECK_FILE).toContain(".update-check");
    });
  });
});
