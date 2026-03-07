import { configCommand } from "../../src/commands/config";
import * as defaults from "../../src/utils/defaults";
import * as yamlConfig from "../../src/utils/yamlConfig";

jest.mock("../../src/utils/defaults");
jest.mock("../../src/utils/yamlConfig");

const mockedDefaults = defaults as jest.Mocked<typeof defaults>;
const mockedYamlConfig = yamlConfig as jest.Mocked<typeof yamlConfig>;

describe("configCommand", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    // Mock VALID_KEYS as a real value
    Object.defineProperty(mockedDefaults, "VALID_KEYS", {
      value: ["provider", "region", "size", "name"],
      writable: false,
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("set subcommand", () => {
    it("should set a config value", async () => {
      await configCommand("set", ["provider", "hetzner"]);
      expect(mockedDefaults.setDefault).toHaveBeenCalledWith("provider", "hetzner");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Set provider = hetzner");
    });

    it("should show error for missing args", async () => {
      await configCommand("set", []);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
    });

    it("should show error for single arg", async () => {
      await configCommand("set", ["provider"]);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
    });

    it("should handle setDefault error", async () => {
      mockedDefaults.setDefault.mockImplementation(() => {
        throw new Error("Invalid config key: foo");
      });
      await configCommand("set", ["foo", "bar"]);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid config key");
    });
  });

  describe("get subcommand", () => {
    it("should show existing value", async () => {
      mockedDefaults.getDefault.mockReturnValue("hetzner");
      await configCommand("get", ["provider"]);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("provider = hetzner");
    });

    it("should show not set message", async () => {
      mockedDefaults.getDefault.mockReturnValue(undefined);
      await configCommand("get", ["provider"]);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("is not set");
    });

    it("should show error for missing key arg", async () => {
      await configCommand("get", []);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
    });
  });

  describe("list subcommand", () => {
    it("should show all config values", async () => {
      mockedDefaults.getDefaults.mockReturnValue({ provider: "hetzner", region: "nbg1" });
      await configCommand("list");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("hetzner");
      expect(output).toContain("nbg1");
    });

    it("should show message when no config set", async () => {
      mockedDefaults.getDefaults.mockReturnValue({});
      await configCommand("list");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No default config set");
    });
  });

  describe("reset subcommand", () => {
    it("should reset config", async () => {
      await configCommand("reset");
      expect(mockedDefaults.resetDefaults).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("reset");
    });
  });

  describe("validate subcommand", () => {
    it("should show valid message for valid YAML", async () => {
      mockedYamlConfig.loadYamlConfig.mockReturnValue({
        config: { provider: "hetzner", region: "nbg1" },
        warnings: [],
      });
      await configCommand("validate", ["kastell.yml"]);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("is valid");
      expect(output).toContain("provider");
      expect(output).toContain("hetzner");
    });

    it("should show warnings for invalid YAML", async () => {
      mockedYamlConfig.loadYamlConfig.mockReturnValue({
        config: {},
        warnings: ['Invalid provider: "aws"'],
      });
      await configCommand("validate", ["bad.yml"]);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Validation errors");
      expect(output).toContain("Invalid provider");
    });

    it("should show usage error when no path provided", async () => {
      await configCommand("validate", []);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
      expect(output).toContain("validate");
    });

    it("should show usage error when args is undefined", async () => {
      await configCommand("validate");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
    });
  });

  describe("no subcommand", () => {
    it("should show usage with validate option", async () => {
      await configCommand();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
      expect(output).toContain("validate");
    });

    it("should show usage for unknown subcommand", async () => {
      await configCommand("unknown");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
    });
  });
});
