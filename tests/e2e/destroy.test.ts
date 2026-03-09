import inquirer from "inquirer";
import { destroyCommand } from "../../src/commands/destroy";
import * as coreManage from "../../src/core/manage";
import * as serverSelect from "../../src/utils/serverSelect";

jest.mock("../../src/core/manage");
jest.mock("../../src/utils/serverSelect");

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "coolify" as const,
};

const doServer = {
  id: "555",
  name: "do-server",
  provider: "digitalocean",
  ip: "10.20.30.40",
  region: "nyc1",
  size: "s-2vcpu-4gb",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "coolify" as const,
};

describe("destroyCommand E2E", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should complete full destroy flow with Hetzner", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue({
      success: true,
      server: sampleServer,
      cloudDeleted: true,
      localRemoved: true,
    });

    await destroyCommand("1.2.3.4");

    expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalledWith("coolify-test");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("removed from your cloud provider");
  });

  it("should complete full destroy flow with DigitalOcean", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(doServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "do-server" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue({
      success: true,
      server: doServer,
      cloudDeleted: true,
      localRemoved: true,
    });

    await destroyCommand("10.20.30.40");

    expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalledWith("do-server");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("removed from your cloud provider");
  });

  it("should abort on first confirmation decline", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: false });

    await destroyCommand("coolify-test");

    expect(mockedCoreManage.destroyCloudServer).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("cancelled");
  });

  it("should abort when typed name does not match", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "wrong" });

    await destroyCommand("1.2.3.4");

    expect(mockedCoreManage.destroyCloudServer).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("does not match");
  });

  it("should handle API error on destroy", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" })
      .mockResolvedValueOnce({ removeLocal: false });
    mockedCoreManage.destroyCloudServer.mockResolvedValue({
      success: false,
      server: sampleServer,
      cloudDeleted: false,
      localRemoved: false,
      error: "quota exceeded",
    });

    await destroyCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    // logger.error("quota exceeded") is captured via console.log
    expect(output).toContain("quota exceeded");
  });

  it("should remove from local config when server already deleted from provider", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue({
      success: true,
      server: sampleServer,
      cloudDeleted: false,
      localRemoved: true,
      hint: "Server not found on hetzner (may have been deleted manually). Removed from local config.",
    });

    await destroyCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Removed from local config");
  });

  it("should find server by name via resolveServer", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue({
      success: true,
      server: sampleServer,
      cloudDeleted: true,
      localRemoved: true,
    });

    await destroyCommand("coolify-test");

    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith(
      "coolify-test",
      "Select a server to destroy:",
    );
    expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalled();
  });
});
