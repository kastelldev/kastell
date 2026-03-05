import { execSync } from "child_process";
import { existsSync, accessSync } from "fs";
import axios from "axios";

jest.mock("child_process", () => ({
  execSync: jest.fn(),
}));

jest.mock("fs", () => ({
  existsSync: jest.fn(),
  accessSync: jest.fn(),
  readFileSync: jest.fn(() => "[]"),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  constants: { R_OK: 4, W_OK: 2 },
}));

jest.mock("os", () => ({
  homedir: () => "/home/test",
}));

jest.mock("../../src/utils/ssh", () => ({
  checkSshAvailable: jest.fn(),
}));

jest.mock("axios");

import { checkSshAvailable } from "../../src/utils/ssh";
import { runDoctorChecks, doctorCommand, checkProviderTokens } from "../../src/commands/doctor";

const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedAccessSync = accessSync as jest.MockedFunction<typeof accessSync>;
const mockedCheckSsh = checkSshAvailable as jest.MockedFunction<typeof checkSshAvailable>;

describe("doctorCommand", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should pass Node.js check when version >= 20", () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const nodeCheck = results.find((r) => r.name === "Node.js");
    expect(nodeCheck?.status).toBe("pass");
    expect(nodeCheck?.detail).toContain(process.version);
  });

  it("should pass npm check when npm is available", () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const npmCheck = results.find((r) => r.name === "npm");
    expect(npmCheck?.status).toBe("pass");
    expect(npmCheck?.detail).toContain("v10.0.0");
  });

  it("should fail npm check when npm is not found", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const npmCheck = results.find((r) => r.name === "npm");
    expect(npmCheck?.status).toBe("fail");
    expect(npmCheck?.detail).toBe("not found");
  });

  it("should pass SSH check when available", () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const sshCheck = results.find((r) => r.name === "SSH Client");
    expect(sshCheck?.status).toBe("pass");
  });

  it("should warn SSH check when not available", () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(false);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const sshCheck = results.find((r) => r.name === "SSH Client");
    expect(sshCheck?.status).toBe("warn");
  });

  it("should show kastell version when provided", () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const versionCheck = results.find((r) => r.name === "kastell");
    expect(versionCheck?.status).toBe("pass");
    expect(versionCheck?.detail).toBe("v0.6.0");
  });

  it("should warn kastell version when not provided", () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks();
    const versionCheck = results.find((r) => r.name === "kastell");
    expect(versionCheck?.status).toBe("warn");
    expect(versionCheck?.detail).toBe("version unknown");
  });

  it("should warn when config dir does not exist", () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(false);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const configCheck = results.find((r) => r.name === "Config Dir");
    expect(configCheck?.status).toBe("warn");
  });

  it("should fail when config dir is not writable", () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    const results = runDoctorChecks("0.6.0");
    const configCheck = results.find((r) => r.name === "Config Dir");
    expect(configCheck?.status).toBe("fail");
  });

  it("should display all checks and summary", async () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    await doctorCommand(undefined, "0.6.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Kastell Doctor");
    expect(output).toContain("Node.js");
    expect(output).toContain("npm");
  });

  it("should show info message with --check-tokens when no servers", async () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    await doctorCommand({ checkTokens: true }, "0.6.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("No servers registered");
  });

  it("should fail Node.js check when version < 20", () => {
    const original = process.version;
    Object.defineProperty(process, "version", { value: "v18.0.0", configurable: true });

    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const nodeCheck = results.find((r) => r.name === "Node.js");
    expect(nodeCheck?.status).toBe("fail");
    expect(nodeCheck?.detail).toContain("requires >= 20");

    Object.defineProperty(process, "version", { value: original, configurable: true });
  });

  it("should pass servers check when servers registered", () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const fs = require("fs");
    fs.readFileSync.mockReturnValueOnce(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
        },
      ]),
    );

    const results = runDoctorChecks("0.6.0");
    const serversCheck = results.find((r) => r.name === "Servers");
    expect(serversCheck?.status).toBe("pass");
    expect(serversCheck?.detail).toContain("1 registered");
  });

  it("should show error summary when failures exist", async () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    await doctorCommand(undefined, "0.6.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("check(s) failed");
  });

  it("should show all-pass message when no failures and no warnings", async () => {
    mockedExecSync.mockReturnValue(Buffer.from("10.0.0"));
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const fs = require("fs");
    fs.readFileSync.mockReturnValueOnce(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
        },
      ]),
    );

    await doctorCommand(undefined, "0.6.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("All checks passed!");
  });
});

describe("checkProviderTokens", () => {
  let consoleSpy: jest.SpyInstance;
  const originalEnv = process.env;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.env = originalEnv;
  });

  it("should show info message when no servers registered", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue("[]");

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("No servers registered");
    expect(output).toContain("Token check skipped");
  });

  it("should show warning when token is not set in environment", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
        },
      ]),
    );
    delete process.env.HETZNER_TOKEN;

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("HETZNER_TOKEN not set");
  });

  it("should show success when token is valid", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
        },
      ]),
    );
    process.env.HETZNER_TOKEN = "valid-token";
    mockedAxios.get.mockResolvedValueOnce({ data: { servers: [] } });

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Hetzner");
    expect(output).toContain("Token is valid");
  });

  it("should show error when token is invalid", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "digitalocean",
          ip: "1.2.3.4",
          region: "nyc1",
          size: "s-1vcpu-1gb",
          createdAt: "2026-01-01",
        },
      ]),
    );
    process.env.DIGITALOCEAN_TOKEN = "invalid-token";
    mockedAxios.get.mockRejectedValueOnce(new Error("Unauthorized"));

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("DigitalOcean");
    expect(output).toContain("Token is invalid");
  });

  it("should check multiple providers when servers from different providers exist", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test1",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
        },
        {
          id: "2",
          name: "test2",
          provider: "vultr",
          ip: "5.6.7.8",
          region: "ewr",
          size: "vc2-1c-1gb",
          createdAt: "2026-01-01",
        },
      ]),
    );
    process.env.HETZNER_TOKEN = "valid-hetzner";
    process.env.VULTR_TOKEN = "valid-vultr";
    mockedAxios.get.mockResolvedValue({ data: {} });

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Hetzner");
    expect(output).toContain("Vultr");
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it("should handle network error gracefully", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "linode",
          ip: "1.2.3.4",
          region: "us-east",
          size: "g6-nanode-1",
          createdAt: "2026-01-01",
        },
      ]),
    );
    process.env.LINODE_TOKEN = "some-token";
    mockedAxios.get.mockRejectedValueOnce(new Error("Network Error"));

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Linode");
    expect(output).toContain("Token is invalid");
  });

  it("should skip unknown providers with warning", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "unknown-provider",
          ip: "1.2.3.4",
          region: "region1",
          size: "size1",
          createdAt: "2026-01-01",
        },
      ]),
    );

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Unknown provider");
  });

  it("should deduplicate providers when multiple servers use same provider", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test1",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
        },
        {
          id: "2",
          name: "test2",
          provider: "hetzner",
          ip: "5.6.7.8",
          region: "fsn1",
          size: "cax21",
          createdAt: "2026-01-01",
        },
      ]),
    );
    process.env.HETZNER_TOKEN = "valid-token";
    mockedAxios.get.mockResolvedValue({ data: {} });

    await checkProviderTokens();

    // Should only call API once for hetzner, not twice
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it("should use correct API endpoint for each provider", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "digitalocean",
          ip: "1.2.3.4",
          region: "nyc1",
          size: "s-1vcpu-1gb",
          createdAt: "2026-01-01",
        },
      ]),
    );
    process.env.DIGITALOCEAN_TOKEN = "test-token";
    mockedAxios.get.mockResolvedValueOnce({ data: {} });

    await checkProviderTokens();

    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://api.digitalocean.com/v2/account",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
      }),
    );
  });

  it("should show title for provider token validation section", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
        },
      ]),
    );
    delete process.env.HETZNER_TOKEN;

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Provider Token Validation");
  });
});
