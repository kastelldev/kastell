import { randomBytes } from "crypto";

// Mock child_process and os for platform-specific getMachineKey tests
jest.mock("child_process", () => ({
  execSync: jest.fn(),
}));

jest.mock("os", () => {
  const actual = jest.requireActual<typeof import("os")>("os");
  return {
    ...actual,
    platform: jest.fn(() => actual.platform()),
    hostname: jest.fn(() => "test-host"),
    arch: jest.fn(() => "x64"),
  };
});

// Partial fs mock — only readFileSync for /etc/machine-id
const actualFs = jest.requireActual<typeof import("fs")>("fs");
jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    readFileSync: jest.fn((...args: unknown[]) =>
      (actual.readFileSync as Function)(...args),
    ),
  };
});

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { platform } from "os";

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedPlatform = platform as jest.MockedFunction<typeof platform>;

// Reset module cache between tests to clear cached key
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  // Restore default: delegate readFileSync to actual
  mockedReadFileSync.mockImplementation((...args: unknown[]) =>
    (actualFs.readFileSync as Function)(...args),
  );
});

async function loadModule() {
  // Re-mock after resetModules
  jest.mock("child_process", () => ({ execSync: mockedExecSync }));
  jest.mock("os", () => {
    const actual = jest.requireActual<typeof import("os")>("os");
    return { ...actual, platform: mockedPlatform, hostname: jest.fn(() => "test-host"), arch: jest.fn(() => "x64") };
  });
  jest.mock("fs", () => ({ ...actualFs, readFileSync: mockedReadFileSync }));
  return await import("../../src/utils/encryption");
}

// ─── encryptData + decryptData ───────────────────────────────────────────────

describe("encryptData + decryptData", () => {
  it("round-trip: encrypt then decrypt returns original string", async () => {
    const { encryptData, decryptData } = await loadModule();
    const key = randomBytes(32);
    const plaintext = "hello world secret token";

    const encrypted = encryptData(plaintext, key);
    const decrypted = decryptData(encrypted, key);

    expect(decrypted).toBe(plaintext);
  });

  it("round-trip with empty string", async () => {
    const { encryptData, decryptData } = await loadModule();
    const key = randomBytes(32);

    const encrypted = encryptData("", key);
    const decrypted = decryptData(encrypted, key);

    expect(decrypted).toBe("");
  });

  it("round-trip with unicode content", async () => {
    const { encryptData, decryptData } = await loadModule();
    const key = randomBytes(32);
    const plaintext = '{"hetzner":"tok-123","comment":"türkçe içerik"}';

    const encrypted = encryptData(plaintext, key);
    const decrypted = decryptData(encrypted, key);

    expect(decrypted).toBe(plaintext);
  });

  it("produces valid EncryptedPayload shape", async () => {
    const { encryptData } = await loadModule();
    const key = randomBytes(32);

    const payload = encryptData("test", key);

    expect(payload.encrypted).toBe(true);
    expect(payload.version).toBe(1);
    expect(typeof payload.iv).toBe("string");
    expect(typeof payload.data).toBe("string");
    expect(typeof payload.tag).toBe("string");
    // IV: 12 bytes = 24 hex chars
    expect(payload.iv).toMatch(/^[0-9a-f]{24}$/);
    // Tag: 16 bytes = 32 hex chars
    expect(payload.tag).toMatch(/^[0-9a-f]{32}$/);
  });

  it("decryptData with wrong key throws", async () => {
    const { encryptData, decryptData } = await loadModule();
    const key1 = randomBytes(32);
    const key2 = randomBytes(32);

    const encrypted = encryptData("secret", key1);

    expect(() => decryptData(encrypted, key2)).toThrow(/decryption failed/i);
  });

  it("decryptData with tampered ciphertext throws", async () => {
    const { encryptData, decryptData } = await loadModule();
    const key = randomBytes(32);

    const encrypted = encryptData("secret", key);
    const tampered = { ...encrypted, data: "ff" + encrypted.data.slice(2) };

    expect(() => decryptData(tampered, key)).toThrow(/decryption failed/i);
  });

  it("two encryptions of same plaintext produce different IVs", async () => {
    const { encryptData } = await loadModule();
    const key = randomBytes(32);

    const enc1 = encryptData("same text", key);
    const enc2 = encryptData("same text", key);

    expect(enc1.iv).not.toBe(enc2.iv);
  });
});

// ─── isEncryptedPayload ──────────────────────────────────────────────────────

describe("isEncryptedPayload", () => {
  it("returns true for valid payload", async () => {
    const { encryptData, isEncryptedPayload } = await loadModule();
    const key = randomBytes(32);
    const payload = encryptData("test", key);

    expect(isEncryptedPayload(payload)).toBe(true);
  });

  it("returns false for plain objects", async () => {
    const { isEncryptedPayload } = await loadModule();

    expect(isEncryptedPayload({ hetzner: "tok-123" })).toBe(false);
    expect(isEncryptedPayload({ encrypted: false })).toBe(false);
    expect(isEncryptedPayload({})).toBe(false);
  });

  it("returns false for null/undefined", async () => {
    const { isEncryptedPayload } = await loadModule();

    expect(isEncryptedPayload(null)).toBe(false);
    expect(isEncryptedPayload(undefined)).toBe(false);
  });

  it("returns false for non-objects", async () => {
    const { isEncryptedPayload } = await loadModule();

    expect(isEncryptedPayload("string")).toBe(false);
    expect(isEncryptedPayload(42)).toBe(false);
    expect(isEncryptedPayload(true)).toBe(false);
  });
});

// ─── getMachineKey ───────────────────────────────────────────────────────────

describe("getMachineKey", () => {
  it("returns 32-byte Buffer", async () => {
    mockedPlatform.mockReturnValue("win32" as NodeJS.Platform);
    mockedExecSync.mockReturnValue(
      "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    TEST-GUID-1234\r\n\r\n",
    );

    const { getMachineKey } = await loadModule();
    const key = getMachineKey();

    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it("returns same Buffer on repeated calls (caching)", async () => {
    mockedPlatform.mockReturnValue("win32" as NodeJS.Platform);
    mockedExecSync.mockReturnValue(
      "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    TEST-GUID-1234\r\n\r\n",
    );

    const { getMachineKey } = await loadModule();
    const key1 = getMachineKey();
    const key2 = getMachineKey();

    expect(key1).toBe(key2); // Same reference (cached)
  });

  it("works on linux (reads /etc/machine-id)", async () => {
    mockedPlatform.mockReturnValue("linux" as NodeJS.Platform);
    mockedReadFileSync.mockImplementation(((path: string, encoding?: string) => {
      if (path === "/etc/machine-id") return "linux-machine-id-abc\n";
      return (actualFs.readFileSync as Function)(path, encoding);
    }) as typeof readFileSync);

    const { getMachineKey } = await loadModule();
    const key = getMachineKey();

    expect(key.length).toBe(32);
    expect(mockedReadFileSync).toHaveBeenCalledWith("/etc/machine-id", "utf8");
  });

  it("works on darwin (parses IOPlatformUUID)", async () => {
    mockedPlatform.mockReturnValue("darwin" as NodeJS.Platform);
    mockedExecSync.mockReturnValue(
      '  | "IOPlatformUUID" = "DARWIN-UUID-1234-5678"\n',
    );

    const { getMachineKey } = await loadModule();
    const key = getMachineKey();

    expect(key.length).toBe(32);
    expect(mockedExecSync).toHaveBeenCalledWith(
      "ioreg -rd1 -c IOPlatformExpertDevice",
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("works on win32 (parses MachineGuid from registry)", async () => {
    mockedPlatform.mockReturnValue("win32" as NodeJS.Platform);
    mockedExecSync.mockReturnValue(
      "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    WIN-GUID-1234\r\n\r\n",
    );

    const { getMachineKey } = await loadModule();
    const key = getMachineKey();

    expect(key.length).toBe(32);
    expect(mockedExecSync).toHaveBeenCalledWith(
      "cmd /c reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid",
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("falls back to hostname+platform+arch when platform ID fails", async () => {
    mockedPlatform.mockReturnValue("freebsd" as NodeJS.Platform);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockedExecSync.mockImplementation(() => {
      throw new Error("command not found");
    });

    const { getMachineKey } = await loadModule();
    const key = getMachineKey();

    expect(key.length).toBe(32);
  });
});
