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

const mockedGetServers = getServers as jest.MockedFunction<typeof getServers>;

describe("interactive server-management prompts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetServers.mockReturnValue([]);
  });

  describe("promptInit", () => {
    it("should return argv for coolify mode with starter template and full-setup", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Server mode:", value: "coolify" },
        { name: "Server template:", value: "starter" },
        { fullSetup: true },
      ]);
      const result = await promptInit();
      expect(result).toEqual(["init", "--mode", "coolify", "--template", "starter", "--full-setup"]);
      reset();
    });

    it("should return argv for coolify mode with production template without full-setup", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Server mode:", value: "coolify" },
        { name: "Server template:", value: "production" },
        { fullSetup: false },
      ]);
      const result = await promptInit();
      expect(result).toEqual(["init", "--mode", "coolify", "--template", "production"]);
      reset();
    });

    it("should return argv for dokploy mode with dev template", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Server mode:", value: "dokploy" },
        { name: "Server template:", value: "dev" },
        { fullSetup: true },
      ]);
      const result = await promptInit();
      expect(result).toEqual(["init", "--mode", "dokploy", "--template", "dev", "--full-setup"]);
      reset();
    });

    it("should return argv for bare mode with starter template", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Server mode:", value: "bare" },
        { name: "Server template:", value: "starter" },
        { fullSetup: false },
      ]);
      const result = await promptInit();
      expect(result).toEqual(["init", "--mode", "bare", "--template", "starter"]);
      reset();
    });

    it("should return null when back is chosen on mode prompt", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Server mode:", value: "__BACK__" },
      ]);
      const result = await promptInit();
      expect(result).toBeNull();
      reset();
    });

    it("should return null when back is chosen on template prompt", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Server mode:", value: "coolify" },
        { name: "Server template:", value: "__BACK__" },
      ]);
      const result = await promptInit();
      expect(result).toBeNull();
      reset();
    });
  });

  describe("promptStatus", () => {
    it("should return argv for single server mode", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Status check:", value: "single" },
      ]);
      const result = await promptStatus();
      expect(result).toEqual(["status"]);
      reset();
    });

    it("should return argv for all servers mode", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Status check:", value: "all" },
      ]);
      const result = await promptStatus();
      expect(result).toEqual(["status", "--all"]);
      reset();
    });

    it("should return argv for autostart mode", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Status check:", value: "autostart" },
      ]);
      const result = await promptStatus();
      expect(result).toEqual(["status", "--autostart"]);
      reset();
    });

    it("should return null when back is chosen", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Status check:", value: "__BACK__" },
      ]);
      const result = await promptStatus();
      expect(result).toBeNull();
      reset();
    });
  });

  describe("promptSsh", () => {
    it("should return argv for interactive mode", async () => {
      const { reset } = runInteractiveFlow([
        { name: "SSH mode:", value: "interactive" },
      ]);
      const result = await promptSsh();
      expect(result).toEqual(["ssh"]);
      reset();
    });

    it("should return argv for command mode with command input", async () => {
      const { reset } = runInteractiveFlow([
        { name: "SSH mode:", value: "command" },
        { name: "Command to execute:", value: "uptime" },
      ]);
      const result = await promptSsh();
      expect(result).toEqual(["ssh", "--command", "uptime"]);
      reset();
    });

    it("should return null when back is chosen", async () => {
      const { reset } = runInteractiveFlow([
        { name: "SSH mode:", value: "__BACK__" },
      ]);
      const result = await promptSsh();
      expect(result).toBeNull();
      reset();
    });
  });

  describe("promptFleet", () => {
    it("should return argv for default dashboard mode", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Fleet output:", value: "default" },
      ]);
      const result = await promptFleet();
      expect(result).toEqual(["fleet"]);
      reset();
    });

    it("should return argv for json output mode", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Fleet output:", value: "json" },
      ]);
      const result = await promptFleet();
      expect(result).toEqual(["fleet", "--json"]);
      reset();
    });

    it("should return argv for sort-score mode", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Fleet output:", value: "sort-score" },
      ]);
      const result = await promptFleet();
      expect(result).toEqual(["fleet", "--sort", "score"]);
      reset();
    });

    it("should return argv for sort-provider mode", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Fleet output:", value: "sort-provider" },
      ]);
      const result = await promptFleet();
      expect(result).toEqual(["fleet", "--sort", "provider"]);
      reset();
    });

    it("should return null when back is chosen", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Fleet output:", value: "__BACK__" },
      ]);
      const result = await promptFleet();
      expect(result).toBeNull();
      reset();
    });
  });
});