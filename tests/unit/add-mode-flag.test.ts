/**
 * Test for F-002: add --mode flag should be respected even when --skip-verify is set
 */

import * as coreManage from "../../src/core/manage";
import * as serverSelect from "../../src/utils/serverSelect";
import { addCommand } from "../../src/commands/add";
import { createConsoleSpy } from "../helpers/consoleSpy.js";

jest.mock("../../src/core/manage");
jest.mock("../../src/utils/serverSelect");

const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;

const coolifyAddResult = {
  success: true as const,
  server: {
    id: "manual-123",
    name: "coolify-server",
    provider: "hetzner",
    ip: "1.2.3.4",
    region: "unknown",
    size: "unknown",
    createdAt: "2026-01-01T00:00:00.000Z",
    mode: "coolify" as const,
  },
  platformStatus: "skipped" as const,
};

describe("kastell add --mode flag", () => {
  const spy = createConsoleSpy();
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    spy.setup();
    exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    jest.clearAllMocks();
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreManage.addServerRecord.mockResolvedValue(coolifyAddResult);
  });

  afterEach(() => {
    spy.restore();
    exitSpy.mockRestore();
  });

  test("--mode coolify should be passed to addServerRecord even when --skip-verify is true", async () => {
    await addCommand({
      name: "test",
      provider: "hetzner",
      ip: "1.2.3.4",
      mode: "coolify",
      skipVerify: true,
    });

    expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "coolify" }),
    );
  });

  test("--mode dokploy should be passed to addServerRecord even when --skip-verify is true", async () => {
    mockedCoreManage.addServerRecord.mockResolvedValue({
      success: true,
      server: { ...coolifyAddResult.server, name: "dokploy-server", mode: "dokploy" as const },
      platformStatus: "skipped" as const,
    });

    await addCommand({
      name: "test",
      provider: "hetzner",
      ip: "1.2.3.4",
      mode: "dokploy",
      skipVerify: true,
    });

    expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "dokploy" }),
    );
  });

  test("--mode bare should be passed to addServerRecord with --skip-verify", async () => {
    mockedCoreManage.addServerRecord.mockResolvedValue({
      success: true,
      server: { ...coolifyAddResult.server, name: "bare-server", mode: "bare" as const },
      platformStatus: "skipped" as const,
    });

    await addCommand({
      name: "test",
      provider: "hetzner",
      ip: "1.2.3.4",
      mode: "bare",
      skipVerify: true,
    });

    expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "bare" }),
    );
  });
});
