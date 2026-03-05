import axios from "axios";
import { initCommand } from "../../src/commands/init";
import * as firewallModule from "../../src/commands/firewall";
import * as secureModule from "../../src/commands/secure";

jest.mock("../../src/utils/healthCheck", () => ({
  waitForCoolify: jest.fn(),
}));

jest.mock("../../src/utils/config", () => ({
  saveServer: jest.fn(),
  getServers: jest.fn().mockReturnValue([]),
  removeServer: jest.fn(),
  findServer: jest.fn(),
}));

jest.mock("../../src/utils/sshKey", () => ({
  findLocalSshKey: jest.fn().mockReturnValue(null),
  generateSshKey: jest.fn().mockReturnValue(null),
  getSshKeyName: jest.fn().mockReturnValue("kastell-test"),
}));

jest.mock("../../src/commands/firewall", () => ({
  ...jest.requireActual("../../src/commands/firewall"),
  firewallSetup: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/commands/secure", () => ({
  ...jest.requireActual("../../src/commands/secure"),
  secureSetup: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/utils/openBrowser", () => ({
  openBrowser: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFirewallSetup = firewallModule.firewallSetup as jest.MockedFunction<
  typeof firewallModule.firewallSetup
>;
const mockedSecureSetup = secureModule.secureSetup as jest.MockedFunction<
  typeof secureModule.secureSetup
>;

const { waitForCoolify } = jest.requireMock("../../src/utils/healthCheck") as {
  waitForCoolify: jest.Mock;
};

function setupHetznerMocks() {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes("/servers/") && !url.includes("server_types")) {
      // getServerStatus / getServerDetails
      return Promise.resolve({
        data: { server: { id: 999, status: "running", public_net: { ipv4: { ip: "10.0.0.1" } } } },
      });
    }
    if (url.includes("locations")) {
      return Promise.resolve({
        data: { locations: [{ name: "nbg1", city: "Nuremberg", country: "Germany" }] },
      });
    }
    if (url.includes("server_types")) {
      return Promise.resolve({
        data: {
          server_types: [
            {
              name: "cax11",
              cores: 2,
              memory: 4,
              disk: 40,
              prices: [{ location: "nbg1", price_monthly: { gross: "3.85" } }],
            },
          ],
        },
      });
    }
    // validateToken (GET /servers)
    return Promise.resolve({ data: { servers: [] } });
  });
  mockedAxios.post.mockResolvedValue({
    data: { server: { id: 999, public_net: { ipv4: { ip: "10.0.0.1" } }, status: "running" } },
  });
}

describe("init --full-setup", () => {
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    jest.clearAllMocks();
    setupHetznerMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("should call firewallSetup and secureSetup when --full-setup and Coolify ready", async () => {
    waitForCoolify.mockResolvedValue(true);

    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "test-server",
      fullSetup: true,
    });

    expect(mockedFirewallSetup).toHaveBeenCalledWith("10.0.0.1", "test-server", false);
    expect(mockedSecureSetup).toHaveBeenCalledWith(
      "10.0.0.1",
      "test-server",
      undefined,
      false,
      true,
    );
  });

  it("should skip full setup when Coolify not ready", async () => {
    waitForCoolify.mockResolvedValue(false);

    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "test-server",
      fullSetup: true,
    });

    expect(mockedFirewallSetup).not.toHaveBeenCalled();
    expect(mockedSecureSetup).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Skipping full setup");
  });

  it("should not call fullSetup when flag is not set", async () => {
    waitForCoolify.mockResolvedValue(true);

    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "test-server",
    });

    expect(mockedFirewallSetup).not.toHaveBeenCalled();
    expect(mockedSecureSetup).not.toHaveBeenCalled();
  });

  it("should handle firewallSetup failure gracefully", async () => {
    waitForCoolify.mockResolvedValue(true);
    mockedFirewallSetup.mockRejectedValue(new Error("SSH timeout"));

    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "test-server",
      fullSetup: true,
    });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Firewall setup failed");
    expect(mockedSecureSetup).toHaveBeenCalled();
  });

  it("should handle secureSetup failure gracefully", async () => {
    waitForCoolify.mockResolvedValue(true);
    mockedSecureSetup.mockRejectedValue(new Error("Connection refused"));

    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "test-server",
      fullSetup: true,
    });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Security setup failed");
    expect(output).toContain("Deployment Successful");
  });

  it("should show domain warning only when fullSetup is not used", async () => {
    waitForCoolify.mockResolvedValue(true);

    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "test-server",
      fullSetup: true,
    });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).not.toContain("Set up a domain");
  });
});
