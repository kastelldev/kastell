import * as prompts from "../../src/utils/prompts";
import { initCommand } from "../../src/commands/init";

jest.mock("../../src/utils/providerFactory", () => ({
  createProvider: jest.fn(() => ({
    displayName: "Hetzner",
    getRegions: jest.fn(() => [{ id: "nbg1", name: "Nuremberg", location: "Germany" }]),
    getServerSizes: jest.fn(() => []),
  })),
  createProviderWithToken: jest.fn(() => ({
    displayName: "Hetzner",
    validateToken: jest.fn().mockResolvedValue(true),
    getRegions: jest.fn(() => [{ id: "nbg1", name: "Nuremberg", location: "Germany" }]),
    getServerSizes: jest.fn(() => []),
  })),
}));

jest.mock("../../src/utils/logger", () => ({
  logger: { info: jest.fn(), warning: jest.fn(), error: jest.fn(), success: jest.fn(), title: jest.fn() },
  createSpinner: jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
  })),
}));

jest.mock("../../src/utils/yamlConfig", () => ({
  loadYamlConfig: jest.fn(() => ({})),
}));

jest.mock("../../src/utils/configMerge", () => ({
  mergeConfig: jest.fn((a: Record<string, unknown>) => a),
}));

jest.mock("../../src/utils/templates", () => ({
  getTemplate: jest.fn(),
  getTemplateDefaults: jest.fn(() => ({ region: "nbg1", size: "cax11" })),
  VALID_TEMPLATE_NAMES: ["starter", "production", "dev"],
}));

jest.mock("../../src/utils/config", () => ({
  loadConfig: jest.fn(() => ({ servers: {} })),
}));

jest.mock("../../src/utils/prompts", () => ({
  BACK_SIGNAL: "__BACK__",
  getProviderConfig: jest.fn(),
  getDeploymentConfig: jest.fn(),
  getLocationConfig: jest.fn(),
  getServerTypeConfig: jest.fn(),
  getServerNameConfig: jest.fn(),
  confirmDeployment: jest.fn(),
}));

jest.mock("../../src/core/deploy", () => ({
  deploy: jest.fn(),
  deployServer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/core/manage", () => ({
  addServerRecord: jest.fn(),
  validateIpAddress: jest.fn().mockReturnValue(null),
}));

jest.mock("inquirer", () => {
  const mockPrompt = jest.fn().mockResolvedValue({ wizardPath: "provision" });
  return {
    default: { prompt: mockPrompt, createPromptModule: () => mockPrompt },
    __esModule: true,
  };
});

const BACK = prompts.BACK_SIGNAL;

describe("init wizard back-navigation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the inquirer prompt mock to default wizard -> provision
    const inquirer = jest.requireMock("inquirer") as { default: { prompt: jest.Mock } };
    inquirer.default.prompt.mockResolvedValue({ wizardPath: "provision" });
    // Default happy path
    (prompts.getProviderConfig as jest.Mock).mockResolvedValue({ provider: "hetzner" });
    (prompts.getDeploymentConfig as jest.Mock).mockResolvedValue({ apiToken: "test-token" });
    (prompts.getLocationConfig as jest.Mock).mockResolvedValue("nbg1");
    (prompts.getServerTypeConfig as jest.Mock).mockResolvedValue("cax11");
    (prompts.getServerNameConfig as jest.Mock).mockResolvedValue("test-server");
    (prompts.confirmDeployment as jest.Mock).mockResolvedValue(true);
  });

  it("should go back from step 5 (server type) to step 4 (region)", async () => {
    (prompts.getServerTypeConfig as jest.Mock)
      .mockResolvedValueOnce(BACK)
      .mockResolvedValueOnce("cax11");
    (prompts.getLocationConfig as jest.Mock)
      .mockResolvedValueOnce("nbg1")
      .mockResolvedValueOnce("fsn1");

    await initCommand({});

    expect(prompts.getLocationConfig).toHaveBeenCalledTimes(2);
    expect(prompts.getServerTypeConfig).toHaveBeenCalledTimes(2);
  });

  it("should go back from step 6 (server name) to step 5 (server type)", async () => {
    (prompts.getServerNameConfig as jest.Mock)
      .mockResolvedValueOnce(BACK)
      .mockResolvedValueOnce("my-server");
    (prompts.getServerTypeConfig as jest.Mock)
      .mockResolvedValueOnce("cax11")
      .mockResolvedValueOnce("cax11");

    await initCommand({});

    expect(prompts.getServerTypeConfig).toHaveBeenCalledTimes(2);
    expect(prompts.getServerNameConfig).toHaveBeenCalledTimes(2);
  });

  it("should go back from step 7 (confirm) to step 6 (server name)", async () => {
    (prompts.confirmDeployment as jest.Mock)
      .mockResolvedValueOnce(BACK)
      .mockResolvedValueOnce(true);
    (prompts.getServerNameConfig as jest.Mock)
      .mockResolvedValueOnce("first-name")
      .mockResolvedValueOnce("second-name");

    await initCommand({});

    expect(prompts.getServerNameConfig).toHaveBeenCalledTimes(2);
    expect(prompts.confirmDeployment).toHaveBeenCalledTimes(2);
  });

  it("should cancel deployment when confirm returns false", async () => {
    (prompts.confirmDeployment as jest.Mock).mockResolvedValue(false);
    const { logger } = jest.requireMock("../../src/utils/logger") as {
      logger: { warning: jest.Mock };
    };

    await initCommand({});

    expect(logger.warning).toHaveBeenCalledWith("Deployment cancelled");
  });
});
