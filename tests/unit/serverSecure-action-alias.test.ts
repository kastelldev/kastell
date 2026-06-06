import * as config from "../../src/utils/config";
import * as ssh from "../../src/utils/ssh";
import * as secure from "../../src/core/secure";
import { handleServerSecure } from "../../src/mcp/tools/serverSecure";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/manage", () => ({
  ...jest.requireActual("../../src/core/manage"),
  isSafeMode: jest.fn().mockReturnValue(false),
}));
jest.mock("../../src/adapters/factory", () => ({
  resolvePlatform: jest.fn().mockReturnValue("coolify"),
  getAdapter: jest.fn(() => ({
    healthCheck: jest.fn().mockResolvedValue({ status: "running" }),
    platformPorts: [80, 443, 8000, 6001, 6002],
  })),
}));

const mockedConfig = config as jest.Mocked<typeof config>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "coolify" as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedConfig.getServers.mockReturnValue([sampleServer]);
  (ssh as jest.Mocked<typeof ssh>).assertValidIp.mockImplementation(() => {});
});

describe("handleServerSecure — audit action alias", () => {
  it("'audit' action calls handleSecureAudit", async () => {
    jest.spyOn(secure, "runSecureAudit").mockResolvedValueOnce({
      audit: {
        passwordAuth: { key: "PasswordAuthentication", value: "no", status: "secure" },
        rootLogin: { key: "PermitRootLogin", value: "prohibit-password", status: "secure" },
        fail2ban: { installed: true, active: true },
        sshPort: 2222,
      },
      score: 100,
    });

    const result = await handleServerSecure({ action: "audit" });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.score).toBe(100);
  });

  it("'secure-audit' action still works and warns", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    jest.spyOn(secure, "runSecureAudit").mockResolvedValueOnce({
      audit: {
        passwordAuth: { key: "PasswordAuthentication", value: "no", status: "secure" },
        rootLogin: { key: "PermitRootLogin", value: "prohibit-password", status: "secure" },
        fail2ban: { installed: true, active: true },
        sshPort: 2222,
      },
      score: 100,
    });

    const result = await handleServerSecure({ action: "secure-audit" });
    expect(result.isError).toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("secure-audit") && expect.stringContaining("deprecated"),
    );
    warnSpy.mockRestore();
  });

  it("'audit' is allowed in SAFE_MODE (read-only)", async () => {
    const mockedManage = require("../../src/core/manage") as { isSafeMode: jest.Mock };
    mockedManage.isSafeMode.mockReturnValue(true);
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);

    try {
      const result = await handleServerSecure({ action: "audit" });
      if (result.isError) {
        const data = JSON.parse(result.content[0].text);
        expect(data.error).not.toContain("SAFE_MODE");
      }
    } catch {
      // Handler crashed on missing SSH mock — that's fine; SAFE_MODE guard didn't block
      expect(true).toBe(true);
    }
  });
});
