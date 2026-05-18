import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { clearPluginRegistry, getPluginRegistry } from "../../src/plugin/registry.js";

// Mock fs for directory scanning
jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

// Mock secureWrite
jest.mock("../../src/utils/secureWrite.js", () => ({
  secureWriteFileSync: jest.fn(),
  secureMkdirSync: jest.fn(),
}));

// Mock version for validateManifest
jest.mock("../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.2.0",
}));

import { existsSync, readdirSync, readFileSync } from "fs";
import { loadPlugins } from "../../src/plugin/loader.js";
import type { PluginCheck } from "../../src/plugin/sdk/types.js";

function makeManifest(overrides: Partial<{
  name: string;
  checks: PluginCheck[];
  safeToParallel: boolean;
}> = {}): string {
  const checks = overrides.checks ?? [{
    id: "TEST-001",
    name: "Test",
    category: "Test",
    severity: "info" as const,
    description: "Test check",
    checkCommand: "echo test",
  }];
  return JSON.stringify({
    name: overrides.name ?? "kastell-plugin-test",
    version: "1.0.0",
    apiVersion: "1",
    kastell: ">=2.0.0",
    capabilities: ["audit"],
    checkPrefix: "TEST",
    entry: "index.js",
    // safeToParallel omitted when undefined (JSON.stringify ignores undefined)
    ...(overrides.safeToParallel !== undefined && { safeToParallel: overrides.safeToParallel }),
  });
}

describe("plugin loader blacklist", () => {
  beforeEach(() => {
    clearPluginRegistry();
    jest.clearAllMocks();
  });

  // These commands should be REJECTED at load time
  const FORBIDDEN: Array<{ cmd: string; label: string }> = [
    { cmd: "rm -rf /tmp/cache", label: "rm -rf" },
    { cmd: "echo x > /etc/hosts", label: "output redirection" },
    { cmd: "echo x >> /etc/hosts", label: "append redirection" },
    { cmd: "echo x | tee /etc/file", label: "tee pipeline" },
    { cmd: "chmod 600 /etc/file", label: "chmod" },
    { cmd: "chown root:root /etc", label: "chown" },
    { cmd: "sed -i 's/a/b/' /etc/file", label: "sed -i" },
    { cmd: "systemctl restart sshd", label: "systemctl restart" },
    { cmd: "systemctl stop ssh", label: "systemctl stop" },
    { cmd: "apt install foo", label: "apt install" },
    { cmd: "dnf install foo", label: "dnf install" },
    { cmd: "yum install foo", label: "yum install" },
    { cmd: "dd if=/dev/zero of=/file", label: "dd" },
    { cmd: "mv /etc/a /etc/b", label: "mv" },
    { cmd: "cp -f /src /dst", label: "cp -f" },
    { cmd: "truncate -s 0 /file", label: "truncate" },
    { cmd: "mount /dev/sda1 /mnt", label: "mount" },
    { cmd: "umount /mnt", label: "umount" },
    { cmd: "mkfs.ext4 /dev/sda", label: "mkfs" },
    { cmd: "service ssh restart", label: "service restart" },
  ];

  FORBIDDEN.forEach(({ cmd, label }) => {
    it(`rejects plugin with forbidden checkCommand: ${label}`, async () => {
      (existsSync as jest.Mock).mockReturnValue(true);
      (readdirSync as jest.Mock).mockReturnValue([
        { name: "kastell-plugin-forbidden", isDirectory: () => true },
      ]);
      (readFileSync as jest.Mock).mockReturnValue(
        makeManifest({ name: "kastell-plugin-forbidden", checks: [{
          id: "TEST-001",
          name: "Forbidden",
          category: "Test",
          severity: "info" as const,
          description: "x",
          checkCommand: cmd,
        }]})
      );

      const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
      mockImporter.mockResolvedValue({
        checks: [{
          id: "TEST-001",
          name: "Forbidden",
          category: "Test",
          severity: "info" as const,
          description: "x",
          checkCommand: cmd,
        }],
      });

      const result = await loadPlugins({ importer: mockImporter });
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/forbidden|blacklist|mutating/i);
    });
  });

  // These should be ALLOWED
  const SAFE: Array<{ cmd: string; label: string }> = [
    { cmd: "cat /etc/hosts", label: "cat read" },
    { cmd: "systemctl is-active sshd", label: "systemctl is-active" },
    { cmd: "sshd -T", label: "sshd test mode" },
    { cmd: "grep root /etc/passwd", label: "grep" },
    { cmd: "awk '/root/ { print }' /etc/passwd", label: "awk" },
    { cmd: "test -f /etc/file", label: "test -f" },
    { cmd: "stat /etc/hosts", label: "stat" },
    { cmd: "ls -la /etc", label: "ls" },
    { cmd: "find /etc -name '*.conf'", label: "find" },
  ];

  SAFE.forEach(({ cmd, label }) => {
    it(`accepts read-only command: ${label}`, async () => {
      (existsSync as jest.Mock).mockReturnValue(true);
      (readdirSync as jest.Mock).mockReturnValue([
        { name: "kastell-plugin-safe", isDirectory: () => true },
      ]);
      (readFileSync as jest.Mock).mockReturnValue(
        makeManifest({ name: "kastell-plugin-safe", checks: [{
          id: "TEST-001",
          name: "Safe",
          category: "Test",
          severity: "info" as const,
          description: "x",
          checkCommand: cmd,
        }]})
      );

      const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
      mockImporter.mockResolvedValue({
        checks: [{
          id: "TEST-001",
          name: "Safe",
          category: "Test",
          severity: "info" as const,
          description: "x",
          checkCommand: cmd,
        }],
      });

      const result = await loadPlugins({ importer: mockImporter });
      expect(result.loaded).toContain("kastell-plugin-safe");
      expect(result.errors).toHaveLength(0);
    });
  });

  it("accepts safeToParallel: false override for mutating commands", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readdirSync as jest.Mock).mockReturnValue([
      { name: "kastell-plugin-mutating", isDirectory: () => true },
    ]);
    (readFileSync as jest.Mock).mockReturnValue(
      makeManifest({
        name: "kastell-plugin-mutating",
        safeToParallel: false,
        checks: [{
          id: "TEST-001",
          name: "Mutating",
          category: "Test",
          severity: "info" as const,
          description: "x",
          checkCommand: "rm -rf /tmp/cache",
        }],
      })
    );

    const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
    mockImporter.mockResolvedValue({
      checks: [{
        id: "TEST-001",
        name: "Mutating",
        category: "Test",
        severity: "info" as const,
        description: "x",
        checkCommand: "rm -rf /tmp/cache",
      }],
    });

    const result = await loadPlugins({ importer: mockImporter });
    expect(result.loaded).toContain("kastell-plugin-mutating");
    expect(result.errors).toHaveLength(0);
  });

  it("rejects checkCommand with forbidden token when safeToParallel is not set", async () => {
    // Default: safeToParallel is undefined (treated as true), so blacklist applies
    (existsSync as jest.Mock).mockReturnValue(true);
    (readdirSync as jest.Mock).mockReturnValue([
      { name: "kastell-plugin-no-override", isDirectory: () => true },
    ]);
    (readFileSync as jest.Mock).mockReturnValue(
      makeManifest({
        name: "kastell-plugin-no-override",
        safeToParallel: undefined,
        checks: [{
          id: "TEST-001",
          name: "Mutating",
          category: "Test",
          severity: "info" as const,
          description: "x",
          checkCommand: "rm -rf /tmp/cache",
        }],
      })
    );

    const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
    mockImporter.mockResolvedValue({
      checks: [{
        id: "TEST-001",
        name: "Mutating",
        category: "Test",
        severity: "info" as const,
        description: "x",
        checkCommand: "rm -rf /tmp/cache",
      }],
    });

    const result = await loadPlugins({ importer: mockImporter });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/forbidden|blacklist|mutating/i);
  });
});