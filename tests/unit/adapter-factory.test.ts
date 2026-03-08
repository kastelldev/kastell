import { getAdapter, resolvePlatform, detectPlatform } from "../../src/adapters/factory";
import type { ServerRecord } from "../../src/types/index";
import type { Platform } from "../../src/types/index";

jest.mock("../../src/utils/ssh", () => ({
  assertValidIp: jest.fn(),
  sshExec: jest.fn(),
}));

import { assertValidIp, sshExec } from "../../src/utils/ssh";

const mockAssertValidIp = assertValidIp as jest.MockedFunction<typeof assertValidIp>;
const mockSshExec = sshExec as jest.MockedFunction<typeof sshExec>;

const makeRecord = (overrides: Partial<ServerRecord> = {}): ServerRecord => ({
  id: "1",
  name: "test-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("detectPlatform", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 'dokploy' when /etc/dokploy exists on server", async () => {
    mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "dokploy\n", stderr: "" });
    const result = await detectPlatform("1.2.3.4");
    expect(result).toBe("dokploy");
  });

  it("should return 'coolify' when /data/coolify/source exists on server", async () => {
    // Dokploy check returns "no"
    mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "no\n", stderr: "" });
    // Coolify check returns "coolify"
    mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "coolify\n", stderr: "" });
    const result = await detectPlatform("1.2.3.4");
    expect(result).toBe("coolify");
  });

  it("should return 'bare' when neither platform marker exists", async () => {
    mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "no\n", stderr: "" });
    mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "no\n", stderr: "" });
    const result = await detectPlatform("1.2.3.4");
    expect(result).toBe("bare");
  });

  it("should return 'dokploy' when both exist (Dokploy checked first)", async () => {
    mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "dokploy\n", stderr: "" });
    const result = await detectPlatform("1.2.3.4");
    expect(result).toBe("dokploy");
    // Only one SSH call needed since Dokploy matched first
    expect(mockSshExec).toHaveBeenCalledTimes(1);
  });

  it("should call assertValidIp before SSH", async () => {
    mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "no\n", stderr: "" });
    mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "no\n", stderr: "" });
    await detectPlatform("1.2.3.4");
    expect(mockAssertValidIp).toHaveBeenCalledWith("1.2.3.4");
    // assertValidIp called before sshExec
    const assertOrder = mockAssertValidIp.mock.invocationCallOrder[0];
    const sshOrder = mockSshExec.mock.invocationCallOrder[0];
    expect(assertOrder).toBeLessThan(sshOrder);
  });

  it("should return 'bare' on SSH connection error", async () => {
    mockSshExec.mockRejectedValueOnce(new Error("Connection refused"));
    const result = await detectPlatform("1.2.3.4");
    expect(result).toBe("bare");
  });
});

describe("Platform type", () => {
  it("should accept 'coolify' as a valid Platform", () => {
    const p: Platform = "coolify";
    expect(p).toBe("coolify");
  });

  it("should accept 'dokploy' as a valid Platform", () => {
    const p: Platform = "dokploy";
    expect(p).toBe("dokploy");
  });
});

describe("ServerRecord platform field", () => {
  it("should accept optional platform field with value 'coolify'", () => {
    const record = makeRecord({ platform: "coolify" });
    expect(record.platform).toBe("coolify");
  });

  it("should accept optional platform field with value 'dokploy'", () => {
    const record = makeRecord({ platform: "dokploy" });
    expect(record.platform).toBe("dokploy");
  });

  it("should accept record without platform field", () => {
    const record = makeRecord();
    expect(record.platform).toBeUndefined();
  });
});

describe("getAdapter", () => {
  it("should return an adapter with name 'coolify' for platform 'coolify'", () => {
    const adapter = getAdapter("coolify");
    expect(adapter.name).toBe("coolify");
  });

  it("should return an adapter with name 'dokploy' for platform 'dokploy'", () => {
    const adapter = getAdapter("dokploy");
    expect(adapter.name).toBe("dokploy");
  });

  it("should throw for unknown platform", () => {
    expect(() => getAdapter("unknown" as any)).toThrow("Unknown platform: unknown");
  });
});

describe("resolvePlatform", () => {
  it("should return 'coolify' when platform is 'coolify'", () => {
    const record = makeRecord({ platform: "coolify" });
    expect(resolvePlatform(record)).toBe("coolify");
  });

  it("should return 'dokploy' when platform is 'dokploy'", () => {
    const record = makeRecord({ platform: "dokploy" });
    expect(resolvePlatform(record)).toBe("dokploy");
  });

  it("should return undefined for mode='bare' (no platform)", () => {
    const record = makeRecord({ mode: "bare" });
    expect(resolvePlatform(record)).toBeUndefined();
  });

  it("should return 'coolify' for mode='coolify' (legacy compat)", () => {
    const record = makeRecord({ mode: "coolify" });
    expect(resolvePlatform(record)).toBe("coolify");
  });

  it("should return 'coolify' for legacy records with no mode/platform", () => {
    const record = makeRecord();
    expect(resolvePlatform(record)).toBe("coolify");
  });

  it("should prioritize platform over mode", () => {
    const record = makeRecord({ mode: "bare", platform: "coolify" });
    expect(resolvePlatform(record)).toBe("coolify");
  });
});
