import inquirer from "inquirer";
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import { sshCommand } from "../../src/commands/ssh";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify" as const,
};

describe("sshCommand", () => {
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("should show error when SSH not available", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(false);
    await sshCommand();
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("SSH client not found");
  });

  it("should return when no server found", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([]);
    await sshCommand("nonexistent");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Server not found");
  });

  it("should connect interactively", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    mockedSsh.sshConnect.mockResolvedValue(0);

    await sshCommand("1.2.3.4");

    expect(mockedSsh.sshConnect).toHaveBeenCalledWith("1.2.3.4");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Connecting to");
  });

  it("should show warning for non-zero exit code", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    mockedSsh.sshConnect.mockResolvedValue(255);

    await sshCommand("1.2.3.4");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("SSH session ended with code 255");
  });

  it("should not show warning for Ctrl+C exit (code 130)", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    mockedSsh.sshConnect.mockResolvedValue(130);

    await sshCommand("1.2.3.4");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).not.toContain("SSH session ended");
  });

  it("should execute single command with --command", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "CONTAINER ID", stderr: "" });

    await sshCommand("1.2.3.4", { command: "docker ps" });

    expect(mockedSsh.sshExec).toHaveBeenCalledWith("1.2.3.4", "docker ps");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("CONTAINER ID");
  });

  it("should show stderr from command", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "error message" });

    await sshCommand("1.2.3.4", { command: "bad-cmd" });

    const errOutput = consoleErrorSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(errOutput).toContain("error message");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Command exited with code 1");
  });

  it("should prompt for server selection when no query", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedInquirer.prompt.mockResolvedValueOnce({ serverId: "123" });
    mockedSsh.sshConnect.mockResolvedValue(0);

    await sshCommand();
    expect(mockedInquirer.prompt).toHaveBeenCalled();
  });
});
