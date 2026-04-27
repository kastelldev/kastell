import inquirer from "inquirer";
import * as deploy from "../../../src/core/deploy.js";
import * as manage from "../../../src/core/manage.js";
import * as defaults from "../../../src/core/defaults.js";
import * as providerFactory from "../../../src/utils/providerFactory.js";
import * as prompts from "../../../src/utils/prompts.js";
import * as yamlConfig from "../../../src/utils/yamlConfig.js";
import * as configMerge from "../../../src/utils/configMerge.js";
import * as templates from "../../../src/utils/templates.js";
import * as configModule from "../../../src/utils/config.js";
import * as loggerModule from "../../../src/utils/logger.js";
import { initCommand } from "../../../src/commands/init.js";

const mockSpinner = {
  start: jest.fn(),
  succeed: jest.fn(),
  fail: jest.fn(),
  warn: jest.fn(),
};

jest.mock("inquirer");
jest.mock("../../../src/core/deploy.js");
jest.mock("../../../src/core/manage.js");
jest.mock("../../../src/core/defaults.js");
jest.mock("../../../src/utils/providerFactory.js");
jest.mock("../../../src/utils/prompts.js");
jest.mock("../../../src/utils/logger.js", () => ({
  logger: {
    title: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
  },
  createSpinner: jest.fn(() => mockSpinner),
}));
jest.mock("../../../src/utils/yamlConfig.js", () => ({
  loadYamlConfig: jest.fn().mockReturnValue({ config: {}, warnings: [] }),
}));
jest.mock("../../../src/utils/configMerge.js", () => ({
  mergeConfig: jest.fn().mockReturnValue({}),
}));
jest.mock("../../../src/utils/templates.js", () => ({
  getTemplate: jest.fn(),
  getTemplateDefaults: jest.fn().mockReturnValue({}),
  VALID_TEMPLATE_NAMES: ["starter", "production", "dev"],
}));
jest.mock("../../../src/utils/serverSelect.js");
jest.mock("../../../src/utils/config.js");
jest.mock("../../../src/constants.js", () => ({
  SUPPORTED_PROVIDERS: ["hetzner", "digitalocean", "vultr", "linode"],
  PROVIDER_ENV_KEYS: {},
  PROVIDER_DISPLAY_NAMES: {
    hetzner: "Hetzner Cloud",
    digitalocean: "DigitalOcean",
    vultr: "Vultr",
    linode: "Linode",
  },
  invalidProviderError: jest.fn().mockReturnValue("Invalid provider"),
}));

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedDeploy = deploy as jest.Mocked<typeof deploy>;
const mockedManage = manage as jest.Mocked<typeof manage>;
const mockedDefaults = defaults as jest.Mocked<typeof defaults>;
const mockedPrompts = prompts as jest.Mocked<typeof prompts>;
const mockedConfig = configModule as jest.Mocked<typeof configModule>;

beforeEach(() => {
  jest.resetAllMocks();
  jest.restoreAllMocks();
  mockSpinner.start.mockClear();
  mockSpinner.succeed.mockClear();
  mockSpinner.fail.mockClear();
  mockSpinner.warn.mockClear();
  jest.spyOn(loggerModule, "createSpinner").mockReturnValue(mockSpinner as never);
});

describe("initCommand — 3-way wizard", () => {
  describe("wizard path selection", () => {
    it("should show 3 choices in interactive mode", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ wizardPath: "provision" })
        .mockResolvedValueOnce({ provider: "hetzner" });

      mockedPrompts.getProviderConfig.mockResolvedValue({ provider: "hetzner" });

      const mockProvider = {
        name: "hetzner",
        displayName: "Hetzner Cloud",
        validateToken: jest.fn().mockResolvedValue(true),
        getAvailableLocations: jest.fn().mockResolvedValue([]),
        getAvailableServerTypes: jest.fn().mockResolvedValue([]),
        getRegions: jest.fn().mockReturnValue([]),
        getServerSizes: jest.fn().mockReturnValue([]),
      };
      (providerFactory.createProvider as jest.Mock).mockReturnValue(mockProvider);
      (providerFactory.createProviderWithToken as jest.Mock).mockReturnValue(mockProvider);

      mockedPrompts.getDeploymentConfig.mockResolvedValue({
        provider: "hetzner",
        apiToken: "test-token",
        region: "",
        serverSize: "",
        serverName: "",
      });

      mockedPrompts.getLocationConfig.mockResolvedValue("__BACK__");

      await initCommand();

      expect(mockedInquirer.prompt).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: "wizardPath",
            type: "list",
          }),
        ]),
      );
    });

    it("should skip wizard in non-interactive mode (--provider given)", async () => {
      const mockProvider = {
        name: "hetzner",
        displayName: "Hetzner Cloud",
        validateToken: jest.fn().mockResolvedValue(true),
        getAvailableLocations: jest.fn().mockResolvedValue([]),
        getAvailableServerTypes: jest.fn().mockResolvedValue([]),
        getRegions: jest.fn().mockReturnValue([]),
        getServerSizes: jest.fn().mockReturnValue([]),
      };
      (providerFactory.createProvider as jest.Mock).mockReturnValue(mockProvider);
      (providerFactory.createProviderWithToken as jest.Mock).mockReturnValue(mockProvider);

      mockedPrompts.getDeploymentConfig.mockResolvedValue({
        provider: "hetzner",
        apiToken: "test-token",
        region: "",
        serverSize: "",
        serverName: "",
      });

      mockedDeploy.deployServer.mockResolvedValue({ success: true, data: {} } as never);
      mockedPrompts.getServerTypeConfig.mockResolvedValue("cax11");
      mockedPrompts.getServerNameConfig.mockResolvedValue("my-server");

      await initCommand({
        provider: "hetzner",
        region: "nbg1",
        size: "cax11",
        name: "my-server",
      });

      expect(mockedInquirer.prompt).not.toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "wizardPath" }),
        ]),
      );
    });
  });

  describe("register path", () => {
    it("should call addServerRecord and offer audit prompt", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ wizardPath: "register" })
        .mockResolvedValueOnce({ provider: "hetzner" })
        .mockResolvedValueOnce({ apiToken: "test-token" })
        .mockResolvedValueOnce({ ip: "1.2.3.4" })
        .mockResolvedValueOnce({ name: "my-server" })
        .mockResolvedValueOnce({ mode: "coolify" })
        .mockResolvedValueOnce({ runAudit: false });

      mockedManage.addServerRecord.mockResolvedValue({
        success: true,
        server: {
          id: "manual-123",
          name: "my-server",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "",
          size: "",
          createdAt: "2026-04-26T00:00:00.000Z",
          mode: "coolify",
        },
        platformStatus: "running",
      });

      mockedManage.validateIpAddress.mockReturnValue(null);

      await initCommand();

      expect(mockedManage.addServerRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "hetzner",
          ip: "1.2.3.4",
          name: "my-server",
          mode: "coolify",
        }),
      );
    });
  });

  describe("configure path", () => {
    it("should save defaults.json with threshold and framework", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ wizardPath: "configure" })
        .mockResolvedValueOnce({ framework: "cis-level1" })
        .mockResolvedValueOnce({ threshold: "70" });

      mockedDefaults.saveDefaults.mockImplementation(() => {});
      mockedConfig.getServers.mockReturnValue([]);

      await initCommand();

      expect(mockedDefaults.saveDefaults).toHaveBeenCalledWith({
        framework: "cis-level1",
        threshold: 70,
      });
    });
  });
});
