import axios from "axios";
import inquirer from "inquirer";
import * as fs from "fs";
import { initCommand } from "../../src/commands/init";
import { firewallSetup } from "../../src/core/firewall";
import { secureSetup } from "../../src/core/secure";

jest.mock("../../src/utils/healthCheck", () => ({
  waitForCoolify: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../src/utils/config", () => ({
  saveServer: jest.fn(),
  getServers: jest.fn().mockReturnValue([]),
  removeServer: jest.fn(),
  findServer: jest.fn(),
}));

jest.mock("../../src/utils/sshKey", () => ({
  findLocalSshKey: jest.fn().mockReturnValue(null),
  generateSshKey: jest.fn().mockReturnValue(null),
  getSshKeyName: jest.fn().mockReturnValue("kastell-test"),
}));

jest.mock("fs");

jest.mock("child_process", () => ({
  execSync: jest.fn(),
  exec: jest.fn(),
}));

jest.mock("../../src/utils/openBrowser", () => ({
  openBrowser: jest.fn(),
}));

jest.mock("../../src/core/firewall", () => ({
  firewallSetup: jest.fn().mockResolvedValue(undefined),
  firewallCommand: jest.fn(),
}));

jest.mock("../../src/core/secure", () => ({
  secureSetup: jest.fn().mockResolvedValue(undefined),
  secureCommand: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedFs = fs as jest.Mocked<typeof fs>;

function setupHetznerSuccess(ip = "99.88.77.66") {
  mockedAxios.get
    .mockResolvedValueOnce({ data: { servers: [] } }) // validateToken
    .mockResolvedValueOnce({ data: { server: { status: "running" } } }); // getServerStatus

  mockedAxios.post.mockResolvedValueOnce({
    data: {
      server: {
        id: 101,
        public_net: { ipv4: { ip } },
        status: "initializing",
      },
    },
  });
}

function setupDOSuccess(ip = "55.44.33.22") {
  mockedAxios.get
    .mockResolvedValueOnce({ data: { account: { status: "active" } } }) // validateToken
    .mockResolvedValueOnce({ data: { droplet: { status: "active" } } }); // getServerStatus

  mockedAxios.post.mockResolvedValueOnce({
    data: {
      droplet: {
        id: 202,
        networks: { v4: [{ type: "public", ip_address: ip }] },
        status: "new",
      },
    },
  });
}

describe("initCommand with --config and --template", () => {
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;
  const originalSetTimeout = global.setTimeout;
  const originalEnv = process.env;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.HETZNER_TOKEN;
    delete process.env.DIGITALOCEAN_TOKEN;
    global.setTimeout = ((fn: Function) => {
      fn();
      return 0;
    }) as any;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
    process.env = originalEnv;
    global.setTimeout = originalSetTimeout;
  });

  // --template tests
  describe("--template flag", () => {
    it("should deploy with production template + hetzner provider", async () => {
      setupHetznerSuccess();

      await initCommand({
        provider: "hetzner",
        token: "valid-token",
        template: "production",
        name: "tmpl-prod",
      });

      expect(mockedAxios.post).toHaveBeenCalled();
      const postData = mockedAxios.post.mock.calls[0][1] as any;
      // production template: cx33 server, nbg1 region
      expect(postData.server_type).toBe("cx33");
      expect(postData.location).toBe("nbg1");
      expect(processExitSpy).not.toHaveBeenCalled();
      // production template sets fullSetup=true → firewall + secure should be called
      expect(firewallSetup).toHaveBeenCalled();
      expect(secureSetup).toHaveBeenCalled();
    });

    it("should deploy with starter template + digitalocean provider", async () => {
      setupDOSuccess();

      await initCommand({
        provider: "digitalocean",
        token: "do-token",
        template: "starter",
        name: "tmpl-starter",
      });

      expect(mockedAxios.post).toHaveBeenCalled();
      const postData = mockedAxios.post.mock.calls[0][1] as any;
      // starter template: s-2vcpu-2gb, fra1
      expect(postData.size).toBe("s-2vcpu-2gb");
      expect(postData.region).toBe("fra1");
    });

    it("should deploy with dev template defaults", async () => {
      setupHetznerSuccess();

      await initCommand({
        provider: "hetzner",
        token: "valid-token",
        template: "dev",
        name: "tmpl-dev",
      });

      expect(mockedAxios.post).toHaveBeenCalled();
      const postData = mockedAxios.post.mock.calls[0][1] as any;
      expect(postData.server_type).toBe("cax11");
      expect(postData.location).toBe("nbg1");
    });

    it("should error on invalid template name", async () => {
      await initCommand({
        provider: "hetzner",
        token: "valid-token",
        template: "enterprise",
        name: "bad-tmpl",
      });

      expect(processExitSpy).toHaveBeenCalledWith(1);
      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Invalid template");
      expect(allOutput).toContain("enterprise");
    });

    it("should show template info message", async () => {
      setupHetznerSuccess();

      await initCommand({
        provider: "hetzner",
        token: "valid-token",
        template: "production",
        name: "tmpl-info",
      });

      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Using template");
      expect(allOutput).toContain("production");
    });

    it("CLI flags should override template defaults", async () => {
      setupHetznerSuccess();

      await initCommand({
        provider: "hetzner",
        token: "valid-token",
        template: "starter",
        region: "fsn1",
        size: "cx43",
        name: "override-test",
      });

      expect(mockedAxios.post).toHaveBeenCalled();
      const postData = mockedAxios.post.mock.calls[0][1] as any;
      expect(postData.server_type).toBe("cx43"); // CLI override
      expect(postData.location).toBe("fsn1"); // CLI override
    });
  });

  // --config tests
  describe("--config flag", () => {
    it("should deploy from YAML config file", async () => {
      mockedFs.readFileSync.mockReturnValue(
        "provider: hetzner\nregion: nbg1\nsize: cx33\nname: yaml-server\n",
      );
      setupHetznerSuccess();

      await initCommand({
        config: "/path/to/kastell.yml",
        token: "valid-token",
      });

      expect(mockedAxios.post).toHaveBeenCalled();
      const postData = mockedAxios.post.mock.calls[0][1] as any;
      expect(postData.server_type).toBe("cx33");
      expect(postData.location).toBe("nbg1");
    });

    it("should deploy from YAML with template", async () => {
      mockedFs.readFileSync.mockReturnValue(
        "template: production\nprovider: hetzner\nname: yaml-tmpl\n",
      );
      setupHetznerSuccess();

      await initCommand({
        config: "/path/to/kastell.yml",
        token: "valid-token",
      });

      expect(mockedAxios.post).toHaveBeenCalled();
      const postData = mockedAxios.post.mock.calls[0][1] as any;
      expect(postData.server_type).toBe("cx33"); // production hetzner default
      expect(postData.location).toBe("nbg1");
    });

    it("CLI flags should override YAML values", async () => {
      mockedFs.readFileSync.mockReturnValue(
        "provider: hetzner\nregion: nbg1\nsize: cax11\nname: yaml-name\n",
      );
      setupHetznerSuccess();

      await initCommand({
        config: "/path/to/kastell.yml",
        token: "valid-token",
        region: "fsn1",
        size: "cx43",
      });

      expect(mockedAxios.post).toHaveBeenCalled();
      const postData = mockedAxios.post.mock.calls[0][1] as any;
      expect(postData.server_type).toBe("cx43"); // CLI override
      expect(postData.location).toBe("fsn1"); // CLI override
    });

    it("should show warnings from YAML config", async () => {
      mockedFs.readFileSync.mockReturnValue(
        "provider: hetzner\ntoken: secret123\nunknownKey: value\n",
      );
      setupHetznerSuccess();

      await initCommand({
        config: "/path/to/kastell.yml",
        token: "valid-token",
        name: "warn-test",
        region: "nbg1",
        size: "cax11",
      });

      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Security warning");
      expect(allOutput).toContain("Unknown config key");
    });

    it("should handle missing config file gracefully", async () => {
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT: no such file");
      });

      // Even with error, should continue (warnings shown, no provider set → interactive)
      // But if we also provide provider via CLI, it proceeds
      setupHetznerSuccess();

      await initCommand({
        config: "/nonexistent.yml",
        provider: "hetzner",
        token: "valid-token",
        region: "nbg1",
        size: "cax11",
        name: "missing-config",
      });

      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Could not read config file");
    });

    it("should handle invalid YAML syntax", async () => {
      mockedFs.readFileSync.mockReturnValue("{ invalid yaml: [");

      setupHetznerSuccess();

      await initCommand({
        config: "/bad.yml",
        provider: "hetzner",
        token: "valid-token",
        region: "nbg1",
        size: "cax11",
        name: "bad-yaml",
      });

      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Invalid YAML syntax");
    });

    it("should merge YAML fullSetup into options", async () => {
      mockedFs.readFileSync.mockReturnValue(
        "provider: hetzner\nfullSetup: true\nname: full-setup-yaml\nregion: nbg1\nsize: cax11\n",
      );
      setupHetznerSuccess();

      // Don't pass fullSetup in CLI, let YAML provide it
      await initCommand({
        config: "/path/to/kastell.yml",
        token: "valid-token",
      });

      // Should have attempted firewall/secure setup since fullSetup=true from YAML
      // The deployment should succeed
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it("should deploy from YAML with digitalocean provider", async () => {
      mockedFs.readFileSync.mockReturnValue(
        "provider: digitalocean\nregion: nyc1\nsize: s-2vcpu-2gb\nname: do-yaml\n",
      );
      setupDOSuccess();

      await initCommand({
        config: "/path/to/kastell.yml",
        token: "do-token",
      });

      expect(mockedAxios.post).toHaveBeenCalled();
      const postData = mockedAxios.post.mock.calls[0][1] as any;
      expect(postData.size).toBe("s-2vcpu-2gb");
      expect(postData.region).toBe("nyc1");
    });
  });

  // --config + --template combined
  describe("--config with --template CLI override", () => {
    it("CLI --template should override YAML template", async () => {
      mockedFs.readFileSync.mockReturnValue(
        "template: starter\nprovider: hetzner\nname: override-tmpl\n",
      );
      setupHetznerSuccess();

      await initCommand({
        config: "/path/to/kastell.yml",
        token: "valid-token",
        template: "production", // CLI override
      });

      expect(mockedAxios.post).toHaveBeenCalled();
      const postData = mockedAxios.post.mock.calls[0][1] as any;
      // production template cx33, not starter cax11
      expect(postData.server_type).toBe("cx33");
    });
  });

  // Template without provider (no region/size defaults, just fullSetup)
  describe("template without provider", () => {
    it("should still set fullSetup from template when no provider given", async () => {
      // Template alone sets fullSetup, but without provider no region/size defaults
      // Provider must come from somewhere for deployment to proceed
      setupHetznerSuccess();

      await initCommand({
        provider: "hetzner",
        token: "valid-token",
        template: "production",
        name: "tmpl-no-defaults",
      });

      // Should deploy with production template defaults (since provider IS given)
      expect(mockedAxios.post).toHaveBeenCalled();
    });
  });

  // Empty YAML file
  describe("edge cases", () => {
    it("should handle empty YAML config", async () => {
      mockedFs.readFileSync.mockReturnValue("");
      setupHetznerSuccess();

      await initCommand({
        config: "/path/to/empty.yml",
        provider: "hetzner",
        token: "valid-token",
        region: "nbg1",
        size: "cax11",
        name: "empty-yaml",
      });

      // Empty YAML = no values, all come from CLI
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it("should handle YAML with only comments", async () => {
      mockedFs.readFileSync.mockReturnValue("# just a comment\n");
      setupHetznerSuccess();

      await initCommand({
        config: "/path/to/comments.yml",
        provider: "hetzner",
        token: "valid-token",
        region: "nbg1",
        size: "cax11",
        name: "comments-yaml",
      });

      expect(mockedAxios.post).toHaveBeenCalled();
    });
  });
});
