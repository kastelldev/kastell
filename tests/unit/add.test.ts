import inquirer from "inquirer";
import * as coreManage from "../../src/core/manage";
import * as serverSelect from "../../src/utils/serverSelect";
import { addCommand } from "../../src/commands/add";

jest.mock("../../src/core/manage");
jest.mock("../../src/utils/serverSelect");

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;

const baseAddResult = {
  success: true,
  server: {
    id: "manual-123",
    name: "my-server",
    provider: "hetzner",
    ip: "1.2.3.4",
    region: "unknown",
    size: "unknown",
    createdAt: "2026-01-01T00:00:00.000Z",
    mode: "coolify" as const,
  },
  platformStatus: "skipped" as const,
};

describe("addCommand", () => {
  let consoleSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    jest.clearAllMocks();

    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreManage.addServerRecord.mockResolvedValue(baseAddResult);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  describe("non-interactive mode", () => {
    it("should add server with all options provided", async () => {
      await addCommand({ provider: "hetzner", ip: "1.2.3.4", name: "my-server", skipVerify: true });

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "hetzner",
          ip: "1.2.3.4",
          name: "my-server",
          skipVerify: true,
          apiToken: "test-token",
        }),
      );
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Server added successfully");
    });

    it("should exit on invalid token (core returns error)", async () => {
      mockedCoreManage.addServerRecord.mockResolvedValue({
        success: false,
        error: "Invalid API token for hetzner",
      });

      await addCommand({ provider: "hetzner", ip: "1.2.3.4", name: "test", skipVerify: true });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("should exit on invalid provider", async () => {
      await addCommand({ provider: "aws", ip: "1.2.3.4", name: "test" });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockedCoreManage.addServerRecord).not.toHaveBeenCalled();
    });

    it("should accept all valid providers", async () => {
      for (const p of ["hetzner", "digitalocean", "vultr", "linode"]) {
        jest.clearAllMocks();
        mockedServerSelect.promptApiToken.mockResolvedValue("token");
        mockedCoreManage.addServerRecord.mockResolvedValue({
          ...baseAddResult,
          server: { ...baseAddResult.server, provider: p },
        });

        await addCommand({ provider: p, ip: "1.2.3.4", name: "test", skipVerify: true });

        expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
          expect.objectContaining({ provider: p }),
        );
      }
    });
  });

  describe("duplicate detection", () => {
    it("should reject duplicate IP (core returns error)", async () => {
      mockedCoreManage.addServerRecord.mockResolvedValue({
        success: false,
        error: "Server with IP 1.2.3.4 already exists: existing",
      });

      await addCommand({ provider: "hetzner", ip: "1.2.3.4", name: "test", skipVerify: true });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("Coolify verification", () => {
    it("should show running status when Coolify running", async () => {
      mockedCoreManage.addServerRecord.mockResolvedValue({
        ...baseAddResult,
        platformStatus: "running",
      });

      await addCommand({ provider: "hetzner", ip: "1.2.3.4", name: "test" });

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalled();
    });

    it("should show containers_detected status when docker found", async () => {
      mockedCoreManage.addServerRecord.mockResolvedValue({
        ...baseAddResult,
        platformStatus: "containers_detected",
      });

      await addCommand({ provider: "hetzner", ip: "1.2.3.4", name: "test" });

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalled();
    });

    it("should add server even when verification fails (not_detected)", async () => {
      mockedCoreManage.addServerRecord.mockResolvedValue({
        ...baseAddResult,
        platformStatus: "not_detected",
      });

      await addCommand({ provider: "hetzner", ip: "1.2.3.4", name: "test" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Server added successfully");
    });

    it("should skip verification with --skip-verify", async () => {
      mockedCoreManage.addServerRecord.mockResolvedValue({
        ...baseAddResult,
        platformStatus: "skipped",
      });

      await addCommand({ provider: "hetzner", ip: "1.2.3.4", name: "test", skipVerify: true });

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
        expect.objectContaining({ skipVerify: true }),
      );
    });

    it("should exit when SSH not available", async () => {
      mockedCoreManage.addServerRecord.mockResolvedValue({
        success: true,
        server: baseAddResult.server,
        platformStatus: "ssh_unavailable",
      });

      await addCommand({ provider: "hetzner", ip: "1.2.3.4", name: "test" });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("interactive mode", () => {
    it("should prompt for provider when not given", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "digitalocean" }) // provider
        .mockResolvedValueOnce({ ip: "5.6.7.8" }) // ip
        .mockResolvedValueOnce({ name: "my-do-server" }); // name
      mockedCoreManage.addServerRecord.mockResolvedValue({
        ...baseAddResult,
        server: { ...baseAddResult.server, provider: "digitalocean", ip: "5.6.7.8", name: "my-do-server" },
      });

      await addCommand({});

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "digitalocean",
          ip: "5.6.7.8",
          name: "my-do-server",
        }),
      );
    });

    it("should prompt for IP when not given", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ ip: "10.0.0.1" }) // ip
        .mockResolvedValueOnce({ name: "test-server" }); // name
      mockedCoreManage.addServerRecord.mockResolvedValue({
        ...baseAddResult,
        server: { ...baseAddResult.server, ip: "10.0.0.1" },
      });

      await addCommand({ provider: "hetzner" });

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
        expect.objectContaining({ ip: "10.0.0.1" }),
      );
    });

    it("should prompt for name when not given", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ name: "custom-name" });
      mockedCoreManage.addServerRecord.mockResolvedValue({
        ...baseAddResult,
        server: { ...baseAddResult.server, name: "custom-name" },
      });

      await addCommand({ provider: "hetzner", ip: "1.2.3.4" });

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
        expect.objectContaining({ name: "custom-name" }),
      );
    });
  });

  describe("prompt validators", () => {
    it("should validate IP address format", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ ip: "10.0.0.1" })
        .mockResolvedValueOnce({ name: "test" });

      await addCommand({ provider: "hetzner" });

      // Extract IP prompt validate function
      const ipPromptCall = mockedInquirer.prompt.mock.calls[0][0] as any[];
      const ipValidator = ipPromptCall[0].validate;

      expect(ipValidator("")).toBe("IP address is required");
      expect(ipValidator("   ")).toBe("IP address is required");
      expect(ipValidator("not-an-ip")).toBe("Invalid IP address format");
      expect(ipValidator("999.999.999.999")).toBe("Invalid IP address (octets must be 0-255)");
      expect(ipValidator("256.1.1.1")).toBe("Invalid IP address (octets must be 0-255)");
      expect(ipValidator("1.2.3.4")).toBe(true);
      expect(ipValidator("0.0.0.0")).toBe(true);
      expect(ipValidator("255.255.255.255")).toBe(true);
    });

    it("should validate server name", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ ip: "10.0.0.1" })
        .mockResolvedValueOnce({ name: "test" });

      await addCommand({ provider: "hetzner" });

      // Extract name prompt validate function
      const namePromptCall = mockedInquirer.prompt.mock.calls[1][0] as any[];
      const nameValidator = namePromptCall[0].validate;

      expect(nameValidator("")).toBe("Server name is required");
      expect(nameValidator("ab")).toBe("Server name must be 3-63 characters");
      expect(nameValidator("a".repeat(64))).toBe("Server name must be 3-63 characters");
      expect(nameValidator("UPPERCASE")).toBe(
        "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens",
      );
      expect(nameValidator("-starts-dash")).toBe(
        "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens",
      );
      expect(nameValidator("ends-dash-")).toBe(
        "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens",
      );
      expect(nameValidator("valid-name")).toBe(true);
      expect(nameValidator("my-server-01")).toBe(true);
    });
  });

  describe("server output", () => {
    it("should display success message with server details", async () => {
      await addCommand({ provider: "hetzner", ip: "1.2.3.4", name: "test", skipVerify: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("1.2.3.4");
      expect(output).toContain("my-server");
    });

    it("should pass apiToken from promptApiToken to addServerRecord", async () => {
      mockedServerSelect.promptApiToken.mockResolvedValue("my-secret-token");

      await addCommand({ provider: "hetzner", ip: "1.2.3.4", name: "test", skipVerify: true });

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
        expect.objectContaining({ apiToken: "my-secret-token" }),
      );
    });
  });
});
