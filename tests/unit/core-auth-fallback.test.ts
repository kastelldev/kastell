// Tests for file-based token fallback when keyring is unavailable
// (Termux/Android or native module missing)

jest.mock("@napi-rs/keyring", () => {
  throw new Error("Native module not available");
});

jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
  };
});

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import {
  setToken,
  getToken,
  removeToken,
  listStoredProviders,
  isKeychainAvailable,
} from "../../src/core/auth";

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("file-based fallback (no keyring)", () => {
  describe("setToken", () => {
    it("should write token to tokens.json", () => {
      mockExistsSync.mockReturnValue(false);

      expect(setToken("hetzner", "my-token")).toBe(true);

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(".kastell"),
        { recursive: true },
      );
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("tokens.json"),
        expect.stringContaining('"hetzner": "my-token"'),
        { mode: 0o600 },
      );
    });

    it("should merge with existing tokens", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ vultr: "v-token" }));

      expect(setToken("hetzner", "h-token")).toBe(true);

      const written = JSON.parse(
        (mockWriteFileSync.mock.calls[0][1] as string),
      );
      expect(written).toEqual({ vultr: "v-token", hetzner: "h-token" });
    });

    it("should return false for unknown provider", () => {
      expect(setToken("aws", "token")).toBe(false);
    });

    it("should return false when write fails", () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockImplementation(() => {
        throw new Error("permission denied");
      });

      expect(setToken("hetzner", "token")).toBe(false);
    });
  });

  describe("getToken", () => {
    it("should read token from tokens.json", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ hetzner: "h-token" }));

      expect(getToken("hetzner")).toBe("h-token");
    });

    it("should return undefined when file does not exist", () => {
      mockExistsSync.mockReturnValue(false);

      expect(getToken("hetzner")).toBeUndefined();
    });

    it("should return undefined for missing provider", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ vultr: "v-token" }));

      expect(getToken("hetzner")).toBeUndefined();
    });

    it("should return undefined when file is corrupted", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("not json!!!");

      expect(getToken("hetzner")).toBeUndefined();
    });
  });

  describe("removeToken", () => {
    it("should remove token from tokens.json", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ hetzner: "h-token", vultr: "v-token" }),
      );

      expect(removeToken("hetzner")).toBe(true);

      const written = JSON.parse(
        (mockWriteFileSync.mock.calls[0][1] as string),
      );
      expect(written).toEqual({ vultr: "v-token" });
    });

    it("should return false for unknown provider", () => {
      expect(removeToken("aws")).toBe(false);
    });

    it("should succeed even when token was not present", () => {
      // First call: existsSync(TOKENS_FILE) → false (readTokensFile returns {})
      // Second call: existsSync(KASTELL_DIR) → true (dir exists)
      mockExistsSync
        .mockReturnValueOnce(false) // readTokensFile: no file
        .mockReturnValueOnce(true); // writeTokensFile: dir exists

      expect(removeToken("hetzner")).toBe(true);
    });
  });

  describe("listStoredProviders", () => {
    it("should list providers from tokens.json", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ hetzner: "h", digitalocean: "d" }),
      );

      const providers = listStoredProviders();
      expect(providers).toContain("hetzner");
      expect(providers).toContain("digitalocean");
      expect(providers).not.toContain("vultr");
    });

    it("should return empty when no file", () => {
      mockExistsSync.mockReturnValue(false);

      expect(listStoredProviders()).toEqual([]);
    });
  });

  describe("isKeychainAvailable", () => {
    it("should return false when keyring is not available", () => {
      expect(isKeychainAvailable()).toBe(false);
    });
  });
});
