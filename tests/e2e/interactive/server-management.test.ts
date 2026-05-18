import inquirer from "inquirer";
import { runInteractiveFlow } from "../../helpers/interactiveFlow.js";

jest.mock("inquirer");

jest.mock("../../../src/utils/config", () => ({
  getServers: jest.fn(),
}));

import { getServers } from "../../../src/utils/config.js";
import {
  promptInit,
  promptStatus,
  promptSsh,
  promptFleet,
} from "../../../src/commands/interactive/server-management.js";

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedGetServers = getServers as jest.MockedFunction<typeof getServers>;

describe("interactive server-management prompts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetServers.mockReturnValue([]);
  });

  describe("promptInit", () => {
    it("should return argv for coolify mode with starter template and full-setup", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ answer: "coolify" })
        .mockResolvedValueOnce({ answer: "starter" })
        .mockResolvedValueOnce({ fullSetup: true });

      const result = await promptInit();
      expect(result).toEqual(["init", "--mode", "coolify", "--template", "starter", "--full-setup"]);
    });

    it("should return argv for coolify mode with production template without full-setup", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ answer: "coolify" })
        .mockResolvedValueOnce({ answer: "production" })
        .mockResolvedValueOnce({ fullSetup: false });

      const result = await promptInit();
      expect(result).toEqual(["init", "--mode", "coolify", "--template", "production"]);
    });

    it("should return argv for dokploy mode with dev template", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ answer: "dokploy" })
        .mockResolvedValueOnce({ answer: "dev" })
        .mockResolvedValueOnce({ fullSetup: true });

      const result = await promptInit();
      expect(result).toEqual(["init", "--mode", "dokploy", "--template", "dev", "--full-setup"]);
    });

    it("should return argv for bare mode with starter template", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ answer: "bare" })
        .mockResolvedValueOnce({ answer: "starter" })
        .mockResolvedValueOnce({ fullSetup: false });

      const result = await promptInit();
      expect(result).toEqual(["init", "--mode", "bare", "--template", "starter"]);
    });

    it("should return null when back is chosen on mode prompt", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "__BACK__" });

      const result = await promptInit();
      expect(result).toBeNull();
    });

    it("should return null when back is chosen on template prompt", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ answer: "coolify" })
        .mockResolvedValueOnce({ answer: "__BACK__" });

      const result = await promptInit();
      expect(result).toBeNull();
    });
  });

  describe("promptStatus", () => {
    it("should return argv for single server mode", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "single" });

      const result = await promptStatus();
      expect(result).toEqual(["status"]);
    });

    it("should return argv for all servers mode", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "all" });

      const result = await promptStatus();
      expect(result).toEqual(["status", "--all"]);
    });

    it("should return argv for autostart mode", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "autostart" });

      const result = await promptStatus();
      expect(result).toEqual(["status", "--autostart"]);
    });

    it("should return null when back is chosen", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "__BACK__" });

      const result = await promptStatus();
      expect(result).toBeNull();
    });
  });

  describe("promptSsh", () => {
    it("should return argv for interactive mode", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "interactive" });

      const result = await promptSsh();
      expect(result).toEqual(["ssh"]);
    });

    it("should return argv for command mode with command input", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ answer: "command" })
        .mockResolvedValueOnce({ command: "uptime" });

      const result = await promptSsh();
      expect(result).toEqual(["ssh", "--command", "uptime"]);
    });

    it("should return null when back is chosen", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "__BACK__" });

      const result = await promptSsh();
      expect(result).toBeNull();
    });
  });

  describe("promptFleet", () => {
    it("should return argv for default dashboard mode", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "default" });

      const result = await promptFleet();
      expect(result).toEqual(["fleet"]);
    });

    it("should return argv for json output mode", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "json" });

      const result = await promptFleet();
      expect(result).toEqual(["fleet", "--json"]);
    });

    it("should return argv for sort-score mode", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "sort-score" });

      const result = await promptFleet();
      expect(result).toEqual(["fleet", "--sort", "score"]);
    });

    it("should return argv for sort-provider mode", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "sort-provider" });

      const result = await promptFleet();
      expect(result).toEqual(["fleet", "--sort", "provider"]);
    });

    it("should return null when back is chosen", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "__BACK__" });

      const result = await promptFleet();
      expect(result).toBeNull();
    });
  });
});