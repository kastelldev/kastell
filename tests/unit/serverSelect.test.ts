import inquirer from "inquirer";
import * as config from "../../src/utils/config";
import {
  selectServer,
  resolveServer,
  promptApiToken,
  collectProviderTokens,
} from "../../src/utils/serverSelect";
import type { ServerRecord } from "../../src/types/index";

jest.mock("../../src/utils/config");

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedConfig = config as jest.Mocked<typeof config>;

const sampleServer: ServerRecord = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify" as const,
};

describe("serverSelect", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("selectServer", () => {
    it("should return undefined when no servers exist", async () => {
      mockedConfig.getServers.mockReturnValue([]);
      const result = await selectServer();
      expect(result).toBeUndefined();
    });

    it("should prompt user to select a server", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ serverId: "123" });

      const result = await selectServer();
      expect(result).toEqual(sampleServer);
      expect(mockedInquirer.prompt).toHaveBeenCalledTimes(1);
    });

    it("should use custom prompt message", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ serverId: "123" });

      await selectServer("Pick one:");
      const promptArgs = mockedInquirer.prompt.mock.calls[0][0] as any[];
      expect(promptArgs[0].message).toBe("Pick one:");
    });

    it("should return undefined when selected server not found in list", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ serverId: "nonexistent" });

      const result = await selectServer();
      expect(result).toBeUndefined();
    });
  });

  describe("resolveServer", () => {
    it("should find server by query", async () => {
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      const result = await resolveServer("1.2.3.4");
      expect(result).toEqual(sampleServer);
    });

    it("should return undefined when query not found", async () => {
      mockedConfig.findServers.mockReturnValue([]);
      const result = await resolveServer("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should prompt when multiple servers match query", async () => {
      const server2: ServerRecord = { ...sampleServer, id: "456", ip: "5.6.7.8" };
      mockedConfig.findServers.mockReturnValue([sampleServer, server2]);
      mockedInquirer.prompt.mockResolvedValueOnce({ serverId: "456" });

      const result = await resolveServer("coolify-test");
      expect(result).toEqual(server2);
      expect(mockedInquirer.prompt).toHaveBeenCalledTimes(1);
    });

    it("should fall back to selectServer when no query", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ serverId: "123" });

      const result = await resolveServer();
      expect(result).toEqual(sampleServer);
    });

    it("should pass promptMessage to selectServer", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ serverId: "123" });

      await resolveServer(undefined, "Custom message:");
      const promptArgs = mockedInquirer.prompt.mock.calls[0][0] as any[];
      expect(promptArgs[0].message).toBe("Custom message:");
    });
  });

  describe("promptApiToken", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should use HETZNER_TOKEN env var", async () => {
      process.env.HETZNER_TOKEN = "env-token";
      const token = await promptApiToken("hetzner");
      expect(token).toBe("env-token");
      expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    });

    it("should use DIGITALOCEAN_TOKEN env var", async () => {
      process.env.DIGITALOCEAN_TOKEN = "do-token";
      const token = await promptApiToken("digitalocean");
      expect(token).toBe("do-token");
      expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    });

    it("should use VULTR_TOKEN env var", async () => {
      process.env.VULTR_TOKEN = "vultr-token";
      const token = await promptApiToken("vultr");
      expect(token).toBe("vultr-token");
      expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    });

    it("should use LINODE_TOKEN env var", async () => {
      process.env.LINODE_TOKEN = "linode-token";
      const token = await promptApiToken("linode");
      expect(token).toBe("linode-token");
      expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    });

    it("should prompt when env var not set", async () => {
      delete process.env.HETZNER_TOKEN;
      mockedInquirer.prompt.mockResolvedValueOnce({ apiToken: "  user-token  " });

      const token = await promptApiToken("hetzner");
      expect(token).toBe("user-token");
    });

    it("should prompt for unknown provider (no env key mapping)", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ apiToken: "manual-token" });

      const token = await promptApiToken("unknown-provider");
      expect(token).toBe("manual-token");
      expect(mockedInquirer.prompt).toHaveBeenCalledTimes(1);
    });
  });

  describe("collectProviderTokens", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should return empty map for empty server list", async () => {
      const result = await collectProviderTokens([]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it("should collect token for a single provider", async () => {
      process.env.HETZNER_TOKEN = "h-token";

      const result = await collectProviderTokens([sampleServer]);

      expect(result.size).toBe(1);
      expect(result.get("hetzner")).toBe("h-token");
    });

    it("should collect tokens for multiple unique providers", async () => {
      process.env.HETZNER_TOKEN = "h-token";
      process.env.DIGITALOCEAN_TOKEN = "do-token";

      const doServer: ServerRecord = {
        id: "456",
        name: "coolify-prod",
        provider: "digitalocean",
        ip: "5.6.7.8",
        region: "nyc1",
        size: "s-2vcpu-4gb",
        createdAt: "2026-02-21T00:00:00Z",
        mode: "coolify" as const,
      };

      const result = await collectProviderTokens([sampleServer, doServer]);

      expect(result.size).toBe(2);
      expect(result.get("hetzner")).toBe("h-token");
      expect(result.get("digitalocean")).toBe("do-token");
    });

    it("should ask for token only once per provider", async () => {
      process.env.HETZNER_TOKEN = "h-token";

      const server2: ServerRecord = {
        ...sampleServer,
        id: "789",
        name: "coolify-staging",
      };

      const result = await collectProviderTokens([sampleServer, server2]);

      // Both servers are hetzner, so only one token in the map
      expect(result.size).toBe(1);
      expect(result.get("hetzner")).toBe("h-token");
      // promptApiToken should only be called once (env var used, no inquirer prompt)
      expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    });

    it("should prompt for token when env var not set", async () => {
      delete process.env.HETZNER_TOKEN;
      mockedInquirer.prompt.mockResolvedValueOnce({ apiToken: "prompted-token" });

      const result = await collectProviderTokens([sampleServer]);

      expect(result.size).toBe(1);
      expect(result.get("hetzner")).toBe("prompted-token");
      expect(mockedInquirer.prompt).toHaveBeenCalledTimes(1);
    });

    it("should deduplicate providers across many servers", async () => {
      process.env.HETZNER_TOKEN = "h-token";
      process.env.DIGITALOCEAN_TOKEN = "do-token";

      const servers: ServerRecord[] = [
        sampleServer,
        { ...sampleServer, id: "2", name: "s2" },
        {
          ...sampleServer,
          id: "3",
          name: "s3",
          provider: "digitalocean",
        },
        {
          ...sampleServer,
          id: "4",
          name: "s4",
          provider: "digitalocean",
        },
        { ...sampleServer, id: "5", name: "s5" },
      ];

      const result = await collectProviderTokens(servers);

      // 5 servers but only 2 unique providers
      expect(result.size).toBe(2);
      expect(result.get("hetzner")).toBe("h-token");
      expect(result.get("digitalocean")).toBe("do-token");
    });

    it("should skip manual servers when collecting tokens", async () => {
      process.env.HETZNER_TOKEN = "h-token";

      const manualServer: ServerRecord = {
        ...sampleServer,
        id: "manual-123",
        name: "manual-test",
      };

      const result = await collectProviderTokens([sampleServer, manualServer]);

      // Only 1 token (hetzner), manual server skipped
      expect(result.size).toBe(1);
      expect(result.get("hetzner")).toBe("h-token");
    });
  });
});
