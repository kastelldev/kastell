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

// Mock encryption module for predictable test behavior
jest.mock("../../src/utils/encryption.js", () => {
  const mockKey = Buffer.alloc(32, 0xab);
  return {
    encryptData: jest.fn((plaintext: string) => ({
      encrypted: true,
      version: 1,
      iv: "aabbccddee001122334455",
      data: Buffer.from(plaintext).toString("hex"),
      tag: "00112233445566778899aabbccddeeff",
    })),
    decryptData: jest.fn((payload: { data: string }) =>
      Buffer.from(payload.data, "hex").toString("utf8"),
    ),
    getMachineKey: jest.fn(() => mockKey),
    isEncryptedPayload: jest.fn((obj: unknown) => {
      if (obj === null || obj === undefined || typeof obj !== "object") return false;
      return (obj as Record<string, unknown>).encrypted === true;
    }),
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
    it("should write encrypted token to tokens.json", () => {
      mockExistsSync.mockReturnValue(false);

      expect(setToken("hetzner", "my-token")).toBe(true);

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(".kastell"),
        { recursive: true },
      );
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("tokens.json"),
        expect.any(String),
        { mode: 0o600 },
      );
      // Verify the written content is an encrypted payload
      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.encrypted).toBe(true);
      expect(written.version).toBe(1);
    });

    it("should merge with existing tokens", () => {
      // Return an encrypted payload that decrypts to { vultr: "v-token" }
      const encPayload = {
        encrypted: true,
        version: 1,
        iv: "aabbccddee001122334455",
        data: Buffer.from(JSON.stringify({ vultr: "v-token" })).toString("hex"),
        tag: "00112233445566778899aabbccddeeff",
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(encPayload));

      expect(setToken("hetzner", "h-token")).toBe(true);

      // The written content should be encrypted and contain both tokens
      expect(mockWriteFileSync).toHaveBeenCalled();
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
    it("should read token from encrypted tokens.json", () => {
      const encPayload = {
        encrypted: true,
        version: 1,
        iv: "aabbccddee001122334455",
        data: Buffer.from(JSON.stringify({ hetzner: "h-token" })).toString("hex"),
        tag: "00112233445566778899aabbccddeeff",
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(encPayload));

      expect(getToken("hetzner")).toBe("h-token");
    });

    it("should read token from plaintext legacy tokens.json (auto-migration)", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ hetzner: "h-token" }));

      expect(getToken("hetzner")).toBe("h-token");
    });

    it("should return undefined when file does not exist", () => {
      mockExistsSync.mockReturnValue(false);

      expect(getToken("hetzner")).toBeUndefined();
    });

    it("should return undefined for missing provider", () => {
      const encPayload = {
        encrypted: true,
        version: 1,
        iv: "aabbccddee001122334455",
        data: Buffer.from(JSON.stringify({ vultr: "v-token" })).toString("hex"),
        tag: "00112233445566778899aabbccddeeff",
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(encPayload));

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
      const encPayload = {
        encrypted: true,
        version: 1,
        iv: "aabbccddee001122334455",
        data: Buffer.from(JSON.stringify({ hetzner: "h-token", vultr: "v-token" })).toString("hex"),
        tag: "00112233445566778899aabbccddeeff",
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(encPayload));

      expect(removeToken("hetzner")).toBe(true);

      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it("should return false for unknown provider", () => {
      expect(removeToken("aws")).toBe(false);
    });

    it("should succeed even when token was not present", () => {
      mockExistsSync
        .mockReturnValueOnce(false) // readTokensFile: no file
        .mockReturnValueOnce(true); // writeTokensFile: dir exists

      expect(removeToken("hetzner")).toBe(true);
    });
  });

  describe("listStoredProviders", () => {
    it("should list providers from tokens.json", () => {
      const encPayload = {
        encrypted: true,
        version: 1,
        iv: "aabbccddee001122334455",
        data: Buffer.from(JSON.stringify({ hetzner: "h", digitalocean: "d" })).toString("hex"),
        tag: "00112233445566778899aabbccddeeff",
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(encPayload));

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

  describe("decrypt failure handling", () => {
    it("should return empty object and log warning on decrypt failure", () => {
      // Import the mock to make decryptData throw
      const encMock = jest.requireMock("../../src/utils/encryption.js") as {
        decryptData: jest.Mock;
        isEncryptedPayload: jest.Mock;
      };
      encMock.isEncryptedPayload.mockReturnValueOnce(true);
      encMock.decryptData.mockImplementationOnce(() => {
        throw new Error("decryption failed");
      });

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ encrypted: true, version: 1, iv: "bad", data: "bad", tag: "bad" }));

      const stderrSpy = jest.spyOn(process.stderr, "write").mockReturnValue(true);

      expect(getToken("hetzner")).toBeUndefined();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("Token decryption failed"),
      );

      stderrSpy.mockRestore();
    });
  });
});
