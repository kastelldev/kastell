import inquirer from "inquirer";
import { promptLogs, promptMonitor, promptDoctor, promptGuard } from "../../../src/commands/interactive/monitoring";
import { runInteractiveFlow } from "../../helpers/interactiveFlow";

jest.mock("../../../src/utils/config");

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

describe("interactive monitoring prompts", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // --- promptLogs ---

  it("should return logs argv with service and lines when all prompts confirmed", async () => {
    const flow = runInteractiveFlow([
      { answer: "coolify" },
      { answer: "100" },
      { follow: false },
    ]);

    const result = await promptLogs();

    expect(result).toEqual(["logs", "--service", "coolify", "--lines", "100"]);
    flow.reset();
  });

  it("should include --follow flag when follow prompt is confirmed", async () => {
    const flow = runInteractiveFlow([
      { answer: "docker" },
      { answer: "50" },
      { follow: true },
    ]);

    const result = await promptLogs();

    expect(result).toEqual(["logs", "--service", "docker", "--lines", "50", "--follow"]);
    flow.reset();
  });

  // --- promptMonitor ---

  it("should return monitor argv with basic mode", async () => {
    const flow = runInteractiveFlow([{ answer: "basic" }]);

    const result = await promptMonitor();

    expect(result).toEqual(["monitor"]);
    flow.reset();
  });

  it("should return monitor argv with --containers flag for containers mode", async () => {
    const flow = runInteractiveFlow([{ answer: "containers" }]);

    const result = await promptMonitor();

    expect(result).toEqual(["monitor", "--containers"]);
    flow.reset();
  });

  // --- promptDoctor ---

  it("should return doctor argv with --fresh flag for fresh mode", async () => {
    const flow = runInteractiveFlow([{ answer: "fresh" }]);

    const result = await promptDoctor();

    expect(result).toEqual(["doctor", "--fresh"]);
    flow.reset();
  });

  it("should return doctor argv with --fix and --dry-run for fix dry-run mode", async () => {
    const flow = runInteractiveFlow([
      { answer: "fix" },
      { answer: "dry-run" },
    ]);

    const result = await promptDoctor();

    expect(result).toEqual(["doctor", "--fix", "--dry-run"]);
    flow.reset();
  });

  it("should return doctor argv with --auto-fix and --force for auto-fix force mode", async () => {
    const flow = runInteractiveFlow([
      { answer: "auto-fix" },
      { answer: "force" },
    ]);

    const result = await promptDoctor();

    expect(result).toEqual(["doctor", "--auto-fix", "--force"]);
    flow.reset();
  });

  it("should return doctor argv with --auto-fix and --dry-run for auto-fix-dry mode", async () => {
    const flow = runInteractiveFlow([{ answer: "auto-fix-dry" }]);

    const result = await promptDoctor();

    expect(result).toEqual(["doctor", "--auto-fix", "--dry-run"]);
    flow.reset();
  });

  it("should return doctor argv with --check-tokens for check-tokens mode", async () => {
    const flow = runInteractiveFlow([{ answer: "check-tokens" }]);

    const result = await promptDoctor();

    expect(result).toEqual(["doctor", "--check-tokens"]);
    flow.reset();
  });

  it("should return doctor argv with --fresh and --json for json mode", async () => {
    const flow = runInteractiveFlow([{ answer: "json" }]);

    const result = await promptDoctor();

    expect(result).toEqual(["doctor", "--fresh", "--json"]);
    flow.reset();
  });

  // --- promptGuard ---

  it("should return guard argv with status subcommand", async () => {
    const flow = runInteractiveFlow([{ answer: "status" }]);

    const result = await promptGuard();

    expect(result).toEqual(["guard", "status"]);
    flow.reset();
  });

  it("should return guard argv with start subcommand", async () => {
    const flow = runInteractiveFlow([{ answer: "start" }]);

    const result = await promptGuard();

    expect(result).toEqual(["guard", "start"]);
    flow.reset();
  });

  it("should return guard argv with stop subcommand", async () => {
    const flow = runInteractiveFlow([{ answer: "stop" }]);

    const result = await promptGuard();

    expect(result).toEqual(["guard", "stop"]);
    flow.reset();
  });

  // --- cancellation ---

  it("should return null when promptDoctor mode selection is cancelled (back choice)", async () => {
    // backChoice value comes from BACK_SIGNAL — when user picks "← Back", answer === BACK_SIGNAL
    const flow = runInteractiveFlow([{ answer: null }]);

    const result = await promptDoctor();

    expect(result).toBeNull();
    flow.reset();
  });

  it("should return null when promptMonitor mode selection is cancelled (back choice)", async () => {
    const flow = runInteractiveFlow([{ answer: null }]);

    const result = await promptMonitor();

    expect(result).toBeNull();
    flow.reset();
  });

  it("should return null when promptGuard action selection is cancelled (back choice)", async () => {
    const flow = runInteractiveFlow([{ answer: null }]);

    const result = await promptGuard();

    expect(result).toBeNull();
    flow.reset();
  });

  it("should return null when promptLogs service selection is cancelled (back choice)", async () => {
    const flow = runInteractiveFlow([{ answer: null }]);

    const result = await promptLogs();

    expect(result).toBeNull();
    flow.reset();
  });
});
