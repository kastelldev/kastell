import { readFileSync, existsSync, mkdirSync } from "fs";
import { spawnSync } from "child_process";
import { findLocalSshKey, generateSshKey, getSshKeyName } from "../../src/utils/sshKey";

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));
jest.mock("child_process", () => ({
  spawnSync: jest.fn(),
}));
jest.mock("os", () => ({
  homedir: jest.fn().mockReturnValue("/home/testuser"),
}));

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;
const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

describe("sshKey", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("findLocalSshKey", () => {
    it("should find ed25519 key", () => {
      mockedExistsSync.mockImplementation((p) => String(p).includes("id_ed25519.pub"));
      mockedReadFileSync.mockReturnValue("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 user@host");
      expect(findLocalSshKey()).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 user@host");
    });

    it("should find rsa key when ed25519 not present", () => {
      mockedExistsSync.mockImplementation((p) => String(p).includes("id_rsa.pub"));
      mockedReadFileSync.mockReturnValue("ssh-rsa AAAAB3NzaC1yc2E user@host");
      expect(findLocalSshKey()).toBe("ssh-rsa AAAAB3NzaC1yc2E user@host");
    });

    it("should find ecdsa key when others not present", () => {
      mockedExistsSync.mockImplementation((p) => String(p).includes("id_ecdsa.pub"));
      mockedReadFileSync.mockReturnValue("ssh-ecdsa AAAAE2VjZHNh user@host");
      expect(findLocalSshKey()).toBe("ssh-ecdsa AAAAE2VjZHNh user@host");
    });

    it("should return null when no keys exist", () => {
      mockedExistsSync.mockReturnValue(false);
      expect(findLocalSshKey()).toBeNull();
    });

    it("should skip key with invalid content (no ssh- prefix)", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue("not-a-valid-key-format");
      expect(findLocalSshKey()).toBeNull();
    });

    it("should continue on read error", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("permission denied");
      });
      expect(findLocalSshKey()).toBeNull();
    });
  });

  describe("generateSshKey", () => {
    it("should generate key successfully with spawnSync", () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // sshDir exists
        .mockReturnValueOnce(true); // pubkey exists
      mockedReadFileSync.mockReturnValue("ssh-ed25519 AAAAC3Nz kastell");
      const result = generateSshKey();
      expect(result).toBe("ssh-ed25519 AAAAC3Nz kastell");
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        "ssh-keygen",
        ["-t", "ed25519", "-f", expect.stringContaining("id_ed25519"), "-N", "", "-C", "kastell"],
        expect.objectContaining({ stdio: "pipe" }),
      );
    });

    it("should create .ssh directory if not exists", () => {
      mockedExistsSync
        .mockReturnValueOnce(false) // sshDir doesn't exist
        .mockReturnValueOnce(true); // pubkey exists
      mockedReadFileSync.mockReturnValue("ssh-ed25519 AAAAC3Nz kastell");
      generateSshKey();
      expect(mockedMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(".ssh"),
        expect.objectContaining({ mode: 0o700, recursive: true }),
      );
    });

    it("should return null when spawnSync fails", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedSpawnSync.mockImplementation(() => {
        throw new Error("ssh-keygen not found");
      });
      expect(generateSshKey()).toBeNull();
    });

    it("should return null when pubkey file not found after generation", () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // sshDir exists
        .mockReturnValueOnce(false); // pubkey doesn't exist
      expect(generateSshKey()).toBeNull();
    });

    it("should use argument array instead of string interpolation", () => {
      mockedExistsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      mockedReadFileSync.mockReturnValue("ssh-ed25519 AAAAC3Nz kastell");
      generateSshKey();
      // Verify spawnSync is called with array args (not string command)
      const args = mockedSpawnSync.mock.calls[0];
      expect(args[0]).toBe("ssh-keygen");
      expect(Array.isArray(args[1])).toBe(true);
    });
  });

  describe("getSshKeyName", () => {
    it("should start with kastell- prefix", () => {
      const name = getSshKeyName();
      expect(name).toMatch(/^kastell-/);
    });

    it("should contain a numeric timestamp", () => {
      const name = getSshKeyName();
      const timestamp = name.replace("kastell-", "");
      expect(Number(timestamp)).toBeGreaterThan(0);
    });

    it("should match the expected format", () => {
      const name = getSshKeyName();
      expect(name).toMatch(/^kastell-\d+$/);
    });
  });
});
