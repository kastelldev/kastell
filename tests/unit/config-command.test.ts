import { configCommand } from "../../src/commands/config";
import * as defaults from "../../src/utils/providerConfig";
import * as yamlConfig from "../../src/utils/yamlConfig";
import { createConsoleSpy } from "../helpers/consoleSpy.js";

jest.mock("../../src/utils/providerConfig");
jest.mock("../../src/utils/yamlConfig");

// @ts-ignore - inquirer mock with dynamic control via proxy
jest.mock("inquirer", () => {
  // Use a proxy so the factory captures the proxy, not the mutable state
  // The proxy forwards gets to a mutable object that tests can update
  const state = { inquirerVal: {} };
  const handler = {
    get(_t: unknown, prop: string) {
      if (prop === "default") {
        return {
          prompt: () => Promise.resolve(state.inquirerVal),
        };
      }
      if (prop === "_inquirerState") return state;
      return undefined;
    },
  };
  return new Proxy({}, handler);
});

// Shared state for repair tests — state object reference is captured by the proxy
const _inquirerState = (require("inquirer") as unknown as { _inquirerState: { inquirerVal: unknown } })._inquirerState;

let _diagnoseResult = {
  status: "healthy" as "healthy" | "degraded" | "corrupt" | "missing",
  issues: [] as { type: string; message: string; index?: number }[],
  validCount: 0, invalidCount: 0, autoFixableCount: 0, totalCount: 0,
};
let _repairResult = { backupPath: "", recoveredCount: 0, droppedCount: 0, autoFixedCount: 0 };
let _repairCalled = false;

jest.mock("../../src/core/configRepair", () => ({
  diagnoseConfig: () => _diagnoseResult,
  repairConfig: () => {
    _repairCalled = true;
    return _repairResult;
  },
}));
jest.mock("../../src/utils/paths", () => ({
  KASTELL_DIR: "/mock/kastell",
}));

const mockedDefaults = defaults as jest.Mocked<typeof defaults>;
const mockedYamlConfig = yamlConfig as jest.Mocked<typeof yamlConfig>;

describe("configCommand", () => {
  const spy = createConsoleSpy();
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    spy.setup();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    // Reset module-level repair mock state
    _diagnoseResult = {
      status: "healthy",
      issues: [],
      validCount: 0,
      invalidCount: 0,
      autoFixableCount: 0,
      totalCount: 0,
    };
    _repairResult = { backupPath: "", recoveredCount: 0, droppedCount: 0, autoFixedCount: 0 };
    _repairCalled = false;
    _inquirerState.inquirerVal = {};
    // Mock VALID_KEYS as a real value
    Object.defineProperty(mockedDefaults, "VALID_KEYS", {
      value: ["provider", "region", "size", "name"],
      writable: false,
    });
  });

  afterEach(() => {
    spy.restore();
  });

  describe("set subcommand", () => {
    it("should set a config value", async () => {
      await configCommand("set", ["provider", "hetzner"]);
      expect(mockedDefaults.setDefault).toHaveBeenCalledWith("provider", "hetzner");
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Set provider = hetzner");
    });

    it("should show error for missing args", async () => {
      await configCommand("set", []);
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
    });

    it("should show error for single arg", async () => {
      await configCommand("set", ["provider"]);
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
    });

    it("should handle setDefault error", async () => {
      mockedDefaults.setDefault.mockImplementation(() => {
        throw new Error("Invalid config key: foo");
      });
      await configCommand("set", ["foo", "bar"]);
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid config key");
    });
  });

  describe("get subcommand", () => {
    it("should show existing value", async () => {
      mockedDefaults.getDefault.mockReturnValue("hetzner");
      await configCommand("get", ["provider"]);
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("provider = hetzner");
    });

    it("should show not set message", async () => {
      mockedDefaults.getDefault.mockReturnValue(undefined);
      await configCommand("get", ["provider"]);
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("is not set");
    });

    it("should show error for missing key arg", async () => {
      await configCommand("get", []);
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
    });
  });

  describe("list subcommand", () => {
    it("should show all config values", async () => {
      mockedDefaults.getDefaults.mockReturnValue({ provider: "hetzner", region: "nbg1" });
      await configCommand("list");
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("hetzner");
      expect(output).toContain("nbg1");
    });

    it("should show message when no config set", async () => {
      mockedDefaults.getDefaults.mockReturnValue({});
      await configCommand("list");
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No default config set");
    });
  });

  describe("reset subcommand", () => {
    it("should reset config", async () => {
      await configCommand("reset");
      expect(mockedDefaults.resetDefaults).toHaveBeenCalled();
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
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
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
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
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Validation errors");
      expect(output).toContain("Invalid provider");
    });

    it("should show usage error when no path provided", async () => {
      await configCommand("validate", []);
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
      expect(output).toContain("validate");
    });

    it("should show usage error when args is undefined", async () => {
      await configCommand("validate");
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
    });
  });

  describe("no subcommand", () => {
    it("should show usage with validate option", async () => {
      await configCommand();
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
      expect(output).toContain("validate");
    });

    it("should show usage for unknown subcommand", async () => {
      await configCommand("unknown");
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Usage");
    });
  });

  describe("repair subcommand", () => {
    it("should show info message when servers.json is missing", async () => {
      _diagnoseResult = {
        status: "missing",
        issues: [],
        validCount: 0,
        invalidCount: 0,
        autoFixableCount: 0,
        totalCount: 0,
      };

      await configCommand("repair");

      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No servers.json found");
    });

    it("should show healthy status and return early", async () => {
      _diagnoseResult = {
        status: "healthy",
        issues: [],
        validCount: 3,
        invalidCount: 0,
        autoFixableCount: 0,
        totalCount: 3,
      };

      await configCommand("repair");

      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("healthy");
      expect(output).toContain("3 servers");
    });

    it("should show degraded status and cancel when user refuses", async () => {
      _diagnoseResult = {
        status: "degraded",
        issues: [{ type: "unknown_provider", message: "Unknown provider", index: 0 }],
        validCount: 5,
        invalidCount: 1,
        autoFixableCount: 1,
        totalCount: 6,
      };
      _inquirerState.inquirerVal = { proceed: false };

      await configCommand("repair");

      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("degraded");
      expect(output).toContain("cancelled");
    });

    it("should run repair and report when user confirms", async () => {
      _diagnoseResult = {
        status: "degraded",
        issues: [{ type: "unknown_provider", message: "Unknown provider", index: 0 }],
        validCount: 5,
        invalidCount: 1,
        autoFixableCount: 2,
        totalCount: 6,
      };
      _inquirerState.inquirerVal = { proceed: true };
      _repairResult = {
        backupPath: "/mock/kastell/backups/servers.bak",
        recoveredCount: 1,
        droppedCount: 1,
        autoFixedCount: 2,
      };

      await configCommand("repair");

      expect(_repairCalled).toBe(true);
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Repair complete");
      expect(output).toContain("recovered");
      expect(output).toContain("auto-fixed");
      expect(output).toContain("dropped");
      expect(output).toContain("Backup saved");
    });
  });
});
