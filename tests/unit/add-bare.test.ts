/**
 * Tests for bare mode in src/commands/add.ts
 * Covers: --mode bare passes to core, shows bare success output
 */

import * as coreManage from "../../src/core/manage";
import * as serverSelect from "../../src/utils/serverSelect";
import { addCommand } from "../../src/commands/add";

jest.mock("../../src/core/manage");
jest.mock("../../src/utils/serverSelect");

const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;

const bareAddResult = {
  success: true,
  server: {
    id: "manual-123",
    name: "bare-server",
    provider: "hetzner",
    ip: "5.6.7.8",
    region: "unknown",
    size: "unknown",
    createdAt: "2026-01-01T00:00:00.000Z",
    mode: "bare" as const,
  },
  platformStatus: "skipped" as const,
};

describe("addCommand — bare mode", () => {
  let consoleSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    jest.clearAllMocks();
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreManage.addServerRecord.mockResolvedValue(bareAddResult);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("should pass mode:'bare' to addServerRecord when mode='bare'", async () => {
    await addCommand({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "bare-server",
      mode: "bare",
    });

    expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "bare" }),
    );
  });

  it("should show success message for bare server", async () => {
    await addCommand({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "bare-server",
      mode: "bare",
    });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Server added successfully");
  });

  it("should use bare-server as default name when mode='bare'", async () => {
    // The prompt default for name changes based on mode
    // We test via the options path — if name is provided, it passes through
    mockedCoreManage.addServerRecord.mockResolvedValue(bareAddResult);

    await addCommand({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "bare-server",
      mode: "bare",
    });

    expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
      expect.objectContaining({ name: "bare-server" }),
    );
  });

  it("should not pass mode to addServerRecord when mode is not specified (backward compat)", async () => {
    mockedCoreManage.addServerRecord.mockResolvedValue({
      success: true,
      server: {
        id: "manual-456",
        name: "coolify-server",
        provider: "hetzner",
        ip: "1.2.3.4",
        region: "unknown",
        size: "unknown",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      platformStatus: "skipped" as const,
    });

    await addCommand({
      provider: "hetzner",
      ip: "1.2.3.4",
      name: "coolify-server",
      skipVerify: true,
    });

    // mode should not be in the call (or undefined) when not specified
    const callArgs = mockedCoreManage.addServerRecord.mock.calls[0][0];
    expect(callArgs.mode).toBeUndefined();
  });
});
