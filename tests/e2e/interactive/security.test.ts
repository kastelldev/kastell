import * as config from "../../../src/utils/config";
import * as firewall from "../../../src/core/firewall";
import * as profiles from "../../../src/core/audit/profiles";
import { runInteractiveFlow } from "../../helpers/interactiveFlow";

jest.mock("../../../src/utils/config");
jest.mock("../../../src/core/firewall");
jest.mock("../../../src/core/audit/profiles");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedFirewall = firewall as jest.Mocked<typeof firewall>;
const mockedProfiles = profiles as jest.Mocked<typeof profiles>;

describe("interactive/security E2E — prompt functions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedConfig.getServers.mockReturnValue([]);
  });

  describe("promptFirewall", () => {
    it("should return firewall add argv with valid port and TCP protocol", async () => {
      const { promptFirewall } = await import("../../../src/commands/interactive/security");
      mockedFirewall.isValidPort.mockReturnValue(true);

      const flow = runInteractiveFlow([
        { answer: "add" },
        { port: "8080" },
        { answer: "tcp" },
      ]);

      const result = await promptFirewall();
      expect(result).toEqual(["firewall", "add", "--port", "8080", "--protocol", "tcp"]);
      expect(flow.unconsumed()).toBe(0);
    });

    it("should re-prompt when user enters invalid port", async () => {
      const { promptFirewall } = await import("../../../src/commands/interactive/security");
      mockedFirewall.isValidPort
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const flow = runInteractiveFlow([
        { answer: "add" },
        // Validation fails for first "99999" entry → re-prompt with same question
        (_promptName: string) => ({ port: "8080" }),
        { answer: "tcp" },
      ]);

      const result = await promptFirewall();
      expect(result).toEqual(["firewall", "add", "--port", "8080", "--protocol", "tcp"]);
    });
  });

  describe("promptSecure", () => {
    it("should return secure setup argv", async () => {
      const { promptSecure } = await import("../../../src/commands/interactive/security");

      const flow = runInteractiveFlow([
        { answer: "setup" },
      ]);

      const result = await promptSecure();
      expect(result).toEqual(["secure", "setup"]);
      expect(flow.unconsumed()).toBe(0);
    });
  });

  describe("promptDomain", () => {
    it("should return domain add argv with SSL enabled by default", async () => {
      const { promptDomain } = await import("../../../src/commands/interactive/security");

      const flow = runInteractiveFlow([
        { answer: "add" },
        { domain: "example.com" },
        { ssl: true },
      ]);

      const result = await promptDomain();
      // ssl=true → no --no-ssl flag
      expect(result).toEqual(["domain", "add", "--domain", "example.com"]);
      expect(flow.unconsumed()).toBe(0);
    });
  });

  describe("promptAuth", () => {
    it("should return auth set argv with hetzner provider", async () => {
      const { promptAuth } = await import("../../../src/commands/interactive/security");

      const flow = runInteractiveFlow([
        { answer: "set" },
        { answer: "hetzner" },
      ]);

      const result = await promptAuth();
      expect(result).toEqual(["auth", "set", "hetzner"]);
      expect(flow.unconsumed()).toBe(0);
    });
  });

  describe("promptAudit", () => {
    it("should return audit argv with profile and summary format", async () => {
      const { promptAudit } = await import("../../../src/commands/interactive/security");
      mockedProfiles.listAllProfileNames.mockReturnValue(["cis-level1", "cis-level2", "pci-dss", "hipaa"]);

      const flow = runInteractiveFlow([
        { answer: "profile" },
        { answer: "cis-level1" },
        { answer: "summary" },
      ]);

      const result = await promptAudit();
      expect(result).toEqual(["audit", "--profile", "cis-level1", "--summary"]);
      expect(flow.unconsumed()).toBe(0);
    });
  });

  describe("promptLock", () => {
    it("should return lock argv with --production flag", async () => {
      const { promptLock } = await import("../../../src/commands/interactive/security");

      const flow = runInteractiveFlow([
        { answer: "production" },
      ]);

      const result = await promptLock();
      expect(result).toEqual(["lock", "--production"]);
      expect(flow.unconsumed()).toBe(0);
    });
  });

  describe("promptFix", () => {
    it("should return fix apply argv with --safe flag", async () => {
      const { promptFix } = await import("../../../src/commands/interactive/security");
      mockedProfiles.listAllProfileNames.mockReturnValue(["cis-level1", "cis-level2", "pci-dss", "hipaa"]);

      const flow = runInteractiveFlow([
        { answer: "apply" },
        { answer: "apply" },
      ]);

      const result = await promptFix();
      expect(result).toEqual(["fix", "--safe"]);
      expect(flow.unconsumed()).toBe(0);
    });
  });

  describe("promptEvidence", () => {
    it("should return evidence argv with custom label and no-docker option", async () => {
      const { promptEvidence } = await import("../../../src/commands/interactive/security");

      const flow = runInteractiveFlow([
        { answer: "custom" },
        { name: "weekly-check" },
        { answer: "no-docker" },
        { answer: "500" },
      ]);

      const result = await promptEvidence();
      expect(result).toEqual(["evidence", "--name", "weekly-check", "--no-docker"]);
      expect(flow.unconsumed()).toBe(0);
    });
  });
});