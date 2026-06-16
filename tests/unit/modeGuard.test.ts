import { getServerMode, getServerModeLabel, isBareServer, requireManagedMode } from "../../src/utils/modeGuard";
import type { ServerRecord } from "../../src/types/index";
import type { Platform } from "../../src/types/index";

const makeRecord = (overrides: Partial<ServerRecord> = {}): ServerRecord => ({
  id: "1",
  name: "test-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00Z",
  mode: "coolify" as const,
  ...overrides,
});

describe("getServerMode", () => {
  it("should return 'bare' for a server with mode='bare'", () => {
    const record = makeRecord({ mode: "bare" });
    expect(getServerMode(record)).toBe("bare");
  });

  it("should return 'coolify' for a server with mode='coolify'", () => {
    const record = makeRecord({ mode: "coolify" });
    expect(getServerMode(record)).toBe("coolify");
  });

  it("should return 'coolify' for a server with no mode field", () => {
    const record = makeRecord(); // no mode
    expect(getServerMode(record)).toBe("coolify");
  });
});

describe("isBareServer", () => {
  it("should return true for a server with mode='bare'", () => {
    const record = makeRecord({ mode: "bare" });
    expect(isBareServer(record)).toBe(true);
  });

  it("should return false for a server with mode='coolify'", () => {
    const record = makeRecord({ mode: "coolify" });
    expect(isBareServer(record)).toBe(false);
  });

  it("should return false for a server with no mode field", () => {
    const record = makeRecord(); // no mode
    expect(isBareServer(record)).toBe(false);
  });

  it("should return false for a server with platform='coolify'", () => {
    const record = makeRecord({ platform: "coolify" });
    expect(isBareServer(record)).toBe(false);
  });

  it("should return false for a server with platform='dokploy'", () => {
    const record = makeRecord({ platform: "dokploy" });
    expect(isBareServer(record)).toBe(false);
  });
});

describe("requireManagedMode", () => {
  it("should return error string for bare server (mode='bare')", () => {
    const record = makeRecord({ mode: "bare" });
    const result = requireManagedMode(record, "update");
    expect(result).not.toBeNull();
    expect(result).toContain("update");
    expect(result).toContain("bare servers");
  });

  it("should return null for mode='coolify'", () => {
    const record = makeRecord({ mode: "coolify" });
    const result = requireManagedMode(record, "update");
    expect(result).toBeNull();
  });

  it("should return null for platform='coolify'", () => {
    const record = makeRecord({ platform: "coolify" });
    const result = requireManagedMode(record, "update");
    expect(result).toBeNull();
  });

  it("should return null for platform='dokploy'", () => {
    const record = makeRecord({ platform: "dokploy" });
    const result = requireManagedMode(record, "update");
    expect(result).toBeNull();
  });

  it("should return null for server with no mode/platform (defaults to coolify)", () => {
    const record = makeRecord();
    const result = requireManagedMode(record, "maintain");
    expect(result).toBeNull();
  });

  it("should mention managed platform in error message", () => {
    const record = makeRecord({ mode: "bare" });
    const result = requireManagedMode(record, "domain");
    expect(result).toContain("managed platform");
    expect(result).toContain("Coolify");
    expect(result).toContain("Dokploy");
  });

});

describe("getServerModeLabel", () => {
  it("should return 'bare' for a server with mode='bare'", () => {
    const record = makeRecord({ mode: "bare" });
    expect(getServerModeLabel(record)).toBe("bare");
  });

  it("should return 'coolify' for a server with mode='coolify'", () => {
    const record = makeRecord({ mode: "coolify" });
    expect(getServerModeLabel(record)).toBe("coolify");
  });

  it("should return 'coolify' as fallback when server has no mode/platform", () => {
    const record = makeRecord();
    expect(getServerModeLabel(record)).toBe("coolify");
  });

  it("should return 'dokploy' for a server with platform='dokploy'", () => {
    const record = makeRecord({ platform: "dokploy" });
    expect(getServerModeLabel(record)).toBe("dokploy");
  });

  it("should return 'coolify' for a server with platform='coolify'", () => {
    const record = makeRecord({ platform: "coolify" });
    expect(getServerModeLabel(record)).toBe("coolify");
  });
});
