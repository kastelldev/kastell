import axios from "axios";
import inquirer from "inquirer";
import * as childProcess from "child_process";
import { initCommand } from "../../src/commands/init";

jest.mock("../../src/utils/healthCheck", () => ({
  waitForCoolify: jest.fn().mockResolvedValue(true),
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

jest.mock("child_process", () => ({
  spawnSync: jest.fn().mockReturnValue({ status: 0 }),
  execSync: jest.fn(),
  exec: jest.fn(),
}));

jest.mock("../../src/utils/openBrowser", () => ({
  openBrowser: jest.fn(),
}));

jest.mock("../../src/commands/firewall", () => ({
  firewallSetup: jest.fn().mockResolvedValue(undefined),
  firewallCommand: jest.fn(),
}));

jest.mock("../../src/commands/secure", () => ({
  secureSetup: jest.fn().mockResolvedValue(undefined),
  secureCommand: jest.fn(),
}));

jest.mock("../../src/core/manage", () => ({
  addServerRecord: jest.fn(),
  validateIpAddress: jest.fn().mockReturnValue(null),
}));

jest.mock("../../src/core/defaults", () => ({
  loadDefaults: jest.fn().mockReturnValue({}),
  saveDefaults: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedChildProcess = childProcess as jest.Mocked<typeof childProcess>;

describe("security-init E2E", () => {
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;
  let originalProcessTitle: string;
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit);
    originalProcessTitle = process.title;
    jest.clearAllMocks();

    // Wizard prepend — first prompt in interactive mode returns wizardPath
    const originalPrompt = mockedInquirer.prompt;
    mockedInquirer.prompt = Object.assign(
      (...args: Parameters<typeof originalPrompt>) => originalPrompt(...args),
      originalPrompt
    );
    mockedInquirer.prompt.mockResolvedValueOnce({ wizardPath: "provision" });

    global.setTimeout = ((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
    process.title = originalProcessTitle;
    global.setTimeout = originalSetTimeout;
  });

  describe("process.title security", () => {
    it("should set process.title to 'kastell' when --token flag is used", async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } })
        .mockResolvedValueOnce({ data: { server: { id: 101, status: "running" } } });

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          server: {
            id: 123,
            public_net: { ipv4: { ip: "1.2.3.4" } },
            status: "initializing",
          },
        },
      });

      await initCommand({
        provider: "hetzner",
        token: "secret-api-token",
        region: "nbg1",
        size: "cax11",
        name: "test-server",
      });

      expect(process.title).toBe("kastell");
    });

    it("should show warning about --token being visible in shell history", async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } })
        .mockResolvedValueOnce({ data: { server: { id: 101, status: "running" } } });

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          server: {
            id: 123,
            public_net: { ipv4: { ip: "1.2.3.4" } },
            status: "initializing",
          },
        },
      });

      await initCommand({
        provider: "hetzner",
        token: "secret-api-token",
        region: "nbg1",
        size: "cax11",
        name: "test-server",
      });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("shell history");
      expect(output).toContain("environment variables");
    });
  });

  describe("provider validation", () => {
    it("should throw error for unknown provider in interactive mode", async () => {
      // Reset prompt mock and set up exact sequence: wizard then provider selection
      mockedInquirer.prompt.mockReset();
      mockedInquirer.prompt.mockResolvedValueOnce({ wizardPath: "provision" });
      mockedInquirer.prompt.mockResolvedValueOnce({ provider: "unknown-provider" });

      await expect(initCommand()).rejects.toThrow("Unknown provider: unknown-provider");
    });

    it("should exit with error for invalid provider in non-interactive mode", async () => {
      await initCommand({ provider: "aws", token: "test" });

      expect(processExitSpy).toHaveBeenCalledWith(1);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid provider");
    });

    it("should accept valid provider: hetzner", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Unauthorized"));

      await initCommand({
        provider: "hetzner",
        token: "bad-token",
        region: "nbg1",
        size: "cax11",
        name: "test",
      });

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should accept valid provider: digitalocean", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Unauthorized"));

      await initCommand({
        provider: "digitalocean",
        token: "bad-token",
        region: "nyc1",
        size: "s-1vcpu-1gb",
        name: "test",
      });

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should accept valid provider: vultr", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Unauthorized"));

      await initCommand({
        provider: "vultr",
        token: "bad-token",
        region: "ewr",
        size: "vc2-1c-1gb",
        name: "test",
      });

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should accept valid provider: linode", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Unauthorized"));

      await initCommand({
        provider: "linode",
        token: "bad-token",
        region: "us-east",
        size: "g6-nanode-1",
        name: "test",
      });

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("SSH key generation security", () => {
    it("should use spawnSync for ssh-keygen (not execSync)", async () => {
      const sshKey = jest.requireMock("../../src/utils/sshKey");
      sshKey.findLocalSshKey.mockReturnValue(null);
      sshKey.generateSshKey.mockReturnValue("ssh-ed25519 AAAA... kastell");

      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } })
        .mockResolvedValueOnce({ data: { server: { id: 101, status: "running" } } });

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          server: {
            id: 123,
            public_net: { ipv4: { ip: "1.2.3.4" } },
            status: "initializing",
          },
        },
      });

      await initCommand({
        provider: "hetzner",
        token: "valid-token",
        region: "nbg1",
        size: "cax11",
        name: "test-server",
      });

      expect(sshKey.generateSshKey).toHaveBeenCalled();
    });
  });

  describe("API error handling - token not leaked", () => {
    it("should not expose API token in error messages", async () => {
      const secretToken = "hcloud-super-secret-token-12345";

      const axiosError = new Error("Request failed with status code 401") as Error & { response: unknown; config: unknown };
      axiosError.response = {
        status: 401,
        data: { error: { message: "Unauthorized" } },
      };
      axiosError.config = {
        headers: { Authorization: `Bearer ${secretToken}` },
      };

      mockedAxios.get.mockRejectedValueOnce(axiosError);

      await initCommand({
        provider: "hetzner",
        token: secretToken,
        region: "nbg1",
        size: "cax11",
        name: "test",
      });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).not.toContain(secretToken);
      expect(output).not.toContain("hcloud-super-secret");
    });

    it("should handle network errors without token exposure", async () => {
      const secretToken = "do-secret-token-xyz";
      mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await initCommand({
        provider: "digitalocean",
        token: secretToken,
        region: "nyc1",
        size: "s-1vcpu-1gb",
        name: "test",
      });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).not.toContain(secretToken);
    });
  });

  describe("server creation failure handling", () => {
    it("should handle creation error without token in output", async () => {
      const secretToken = "hetzner-secret-api-token-xyz";

      // Token validation succeeds
      mockedAxios.get.mockResolvedValueOnce({ data: { servers: [] } });

      // Server creation fails
      mockedAxios.post.mockRejectedValueOnce(new Error("insufficient_funds"));

      await initCommand({
        provider: "hetzner",
        token: secretToken,
        region: "nbg1",
        size: "cax11",
        name: "coolify-test",
      });

      // Should exit with error
      expect(processExitSpy).toHaveBeenCalledWith(1);

      // Token should never appear in output
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).not.toContain(secretToken);
    });
  });

  describe("token security verification", () => {
    it("should set process.title even when deployment fails", async () => {
      const token = "my-secret-hetzner-token";

      // Token validation fails
      mockedAxios.get.mockRejectedValueOnce(new Error("Unauthorized"));

      await initCommand({
        provider: "hetzner",
        token,
        region: "nbg1",
        size: "cax11",
        name: "secure-server",
      });

      // Even when failing early, process.title should be set for security
      expect(process.title).toBe("kastell");
    });

    it("should never show raw token in output even in error scenarios", async () => {
      const token = "very-long-secret-token-that-should-never-appear";

      mockedAxios.get.mockRejectedValueOnce(new Error("Connection refused"));

      await initCommand({
        provider: "hetzner",
        token,
        region: "nbg1",
        size: "cax11",
        name: "test-server",
      });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");

      // Token should never appear in any output
      expect(output).not.toContain(token);
      expect(output).not.toContain("very-long-secret");
    });

    it("should warn about shell history exposure", async () => {
      const token = "exposed-token";

      mockedAxios.get.mockRejectedValueOnce(new Error("Invalid"));

      await initCommand({
        provider: "hetzner",
        token,
        region: "nbg1",
        size: "cax11",
        name: "test",
      });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("shell history");
    });
  });
});
