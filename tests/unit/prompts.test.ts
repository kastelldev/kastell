import inquirer from "inquirer";
import {
  BACK_SIGNAL,
  getProviderConfig,
  getDeploymentConfig,
  getLocationConfig,
  getServerTypeConfig,
  getServerNameConfig,
  confirmDeployment,
} from "../../src/utils/prompts";
import type { CloudProvider } from "../../src/providers/base";

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

const mockProvider: CloudProvider = {
  name: "hetzner",
  displayName: "Hetzner Cloud",
  validateToken: jest.fn(),
  getRegions: () => [
    { id: "nbg1", name: "Nuremberg", location: "Germany" },
    { id: "fsn1", name: "Falkenstein", location: "Germany" },
  ],
  getServerSizes: () => [
    { id: "cax11", name: "CAX11", vcpu: 2, ram: 4, disk: 40, price: "€3.85/mo" },
    { id: "cpx11", name: "CPX11", vcpu: 2, ram: 2, disk: 40, price: "€4.15/mo" },
  ],
  getAvailableLocations: jest.fn().mockResolvedValue([
    { id: "nbg1", name: "Nuremberg", location: "Germany" },
    { id: "fsn1", name: "Falkenstein", location: "Germany" },
  ]),
  getAvailableServerTypes: jest.fn().mockResolvedValue([
    { id: "cax11", name: "CAX11", vcpu: 2, ram: 4, disk: 40, price: "€3.85/mo" },
    { id: "cpx11", name: "CPX11", vcpu: 2, ram: 2, disk: 40, price: "€4.15/mo" },
  ]),
  uploadSshKey: jest.fn(),
  createServer: jest.fn(),
  getServerStatus: jest.fn(),
  getServerDetails: jest.fn(),
  destroyServer: jest.fn(),
  rebootServer: jest.fn(),
  createSnapshot: jest.fn(),
  listSnapshots: jest.fn(),
  deleteSnapshot: jest.fn(),
  restoreSnapshot: jest.fn(),
  getSnapshotCostEstimate: jest.fn(),
  findServerByIp: jest.fn().mockResolvedValue(null),
};

describe("getProviderConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return selected provider", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ provider: "hetzner" });

    const result = await getProviderConfig();

    expect(result.provider).toBe("hetzner");
  });

  it("should return digitalocean when selected", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ provider: "digitalocean" });

    const result = await getProviderConfig();

    expect(result.provider).toBe("digitalocean");
  });

  it("should pass correct prompt config for list input", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ provider: "hetzner" });

    await getProviderConfig();

    const promptConfig = mockedInquirer.prompt.mock.calls[0][0] as unknown as Array<{ validate: (val: string) => string | true; choices: Array<{ value?: unknown; name?: unknown }>; type?: string; name?: string; default?: unknown }>;
    expect(promptConfig[0].type).toBe("list");
    expect(promptConfig[0].name).toBe("provider");
    expect(promptConfig[0].choices).toHaveLength(4);
  });

  it("should have Hetzner, DigitalOcean, Vultr, and Linode as choices", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ provider: "hetzner" });

    await getProviderConfig();

    const promptConfig = mockedInquirer.prompt.mock.calls[0][0] as unknown as Array<{ validate: (val: string) => string | true; choices: Array<{ value?: unknown; name?: unknown }>; type?: string; name?: string; default?: unknown }>;
    const choices = promptConfig[0].choices;
    expect(choices[0].value).toBe("hetzner");
    expect(choices[0].name).toBe("Hetzner Cloud");
    expect(choices[1].value).toBe("digitalocean");
    expect(choices[1].name).toBe("DigitalOcean");
    expect(choices[2].value).toBe("vultr");
    expect(choices[2].name).toBe("Vultr");
    expect(choices[3].value).toBe("linode");
    expect(choices[3].name).toBe("Linode (Akamai)");
  });
});

describe("getDeploymentConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return deployment config with apiToken", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({
      apiToken: "my-token",
    });

    const config = await getDeploymentConfig(mockProvider);

    expect(config.provider).toBe("hetzner");
    expect(config.apiToken).toBe("my-token");
  });

  it("should trim apiToken whitespace", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({
      apiToken: "  token-with-spaces  ",
    });

    const config = await getDeploymentConfig(mockProvider);
    expect(config.apiToken).toBe("token-with-spaces");
  });

  it("should pass correct prompt config for password input", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({
      apiToken: "token",
    });

    await getDeploymentConfig(mockProvider);

    const promptConfig = mockedInquirer.prompt.mock.calls[0][0] as unknown as Array<{ validate: (val: string) => string | true; choices: Array<{ value?: unknown; name?: unknown }>; type?: string; name?: string; default?: unknown }>;
    expect(promptConfig[0].type).toBe("password");
    expect(promptConfig[0].name).toBe("apiToken");
  });

  describe("apiToken validator", () => {
    let validateToken: (input: string) => string | true;

    beforeEach(async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ apiToken: "x" });
      await getDeploymentConfig(mockProvider);
      const promptConfig = mockedInquirer.prompt.mock.calls[0][0] as unknown as Array<{ validate: (val: string) => string | true; choices: Array<{ value?: unknown; name?: unknown }>; type?: string; name?: string; default?: unknown }>;
      validateToken = promptConfig[0].validate;
    });

    it("should accept valid token", () => {
      expect(validateToken("valid-api-token")).toBe(true);
    });

    it("should reject empty string", () => {
      expect(validateToken("")).toBe("API token is required");
    });

    it("should reject whitespace-only string", () => {
      expect(validateToken("   ")).toBe("API token is required");
    });
  });
});

describe("getLocationConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch locations from provider and return selected region", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ region: "nbg1" });

    const region = await getLocationConfig(mockProvider);

    expect(mockProvider.getAvailableLocations).toHaveBeenCalled();
    expect(region).toBe("nbg1");
  });

  it("should pass location choices to prompt", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ region: "fsn1" });

    await getLocationConfig(mockProvider);

    const promptConfig = mockedInquirer.prompt.mock.calls[0][0] as unknown as Array<{ validate: (val: string) => string | true; choices: Array<{ value?: unknown; name?: unknown }>; type?: string; name?: string; default?: unknown }>;
    expect(promptConfig[0].type).toBe("list");
    // Separator + 2 locations + Separator + Back = 5 choices
    expect(promptConfig[0].choices).toHaveLength(5);
    expect(promptConfig[0].choices[1].name).toContain("Nuremberg");
  });
});

describe("getServerTypeConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch server types for location and return selected size", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ size: "cax11" });

    const size = await getServerTypeConfig(mockProvider, "nbg1");

    expect(mockProvider.getAvailableServerTypes).toHaveBeenCalledWith("nbg1", undefined);
    expect(size).toBe("cax11");
  });

  it("should include disk size in choice labels", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ size: "cax11" });

    await getServerTypeConfig(mockProvider, "nbg1");

    const promptConfig = mockedInquirer.prompt.mock.calls[0][0] as unknown as Array<{ validate: (val: string) => string | true; choices: Array<{ value?: unknown; name?: unknown }>; type?: string; name?: string; default?: unknown }>;
    const choices = promptConfig[0].choices;
    // choices[0] is Separator, choices[1] is first server type
    expect(choices[1].name).toContain("40GB");
  });
});

describe("getServerNameConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return trimmed server name", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ serverName: "  my-server  " });

    const name = await getServerNameConfig();
    expect(name).toBe("my-server");
  });

  it("should return BACK_SIGNAL when server name is empty", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ serverName: "" });

    const name = await getServerNameConfig();
    expect(name).toBe(BACK_SIGNAL);
  });

  it("should return BACK_SIGNAL when server name is whitespace", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ serverName: "   " });

    const name = await getServerNameConfig();
    expect(name).toBe(BACK_SIGNAL);
  });

  it("should have default value coolify-server", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ serverName: "coolify-server" });

    await getServerNameConfig();

    const promptConfig = mockedInquirer.prompt.mock.calls[0][0] as unknown as Array<{ validate: (val: string) => string | true; choices: Array<{ value?: unknown; name?: unknown }>; type?: string; name?: string; default?: unknown }>;
    expect(promptConfig[0].default).toBe("coolify-server");
  });

  describe("serverName validator", () => {
    let validateName: (input: string) => string | true;

    beforeEach(async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ serverName: "s" });
      await getServerNameConfig();
      const promptConfig = mockedInquirer.prompt.mock.calls[0][0] as unknown as Array<{ validate: (val: string) => string | true; choices: Array<{ value?: unknown; name?: unknown }>; type?: string; name?: string; default?: unknown }>;
      validateName = promptConfig[0].validate;
    });

    it("should accept valid lowercase name", () => {
      expect(validateName("coolify-server")).toBe(true);
    });

    it("should accept name with numbers", () => {
      expect(validateName("server-01")).toBe(true);
    });

    it("should accept empty string (back signal)", () => {
      expect(validateName("")).toBe(true);
    });

    it("should accept whitespace-only string (back signal)", () => {
      expect(validateName("   ")).toBe(true);
    });

    it("should accept minimum valid length (3 chars)", () => {
      expect(validateName("abc")).toBe(true);
    });

    it("should accept maximum valid length (63 chars)", () => {
      expect(validateName("a" + "b".repeat(61) + "c")).toBe(true);
    });

    it("should reject too short name (2 chars)", () => {
      expect(validateName("ab")).toBe("Server name must be 3-63 characters");
    });

    it("should reject single character name", () => {
      expect(validateName("a")).toBe("Server name must be 3-63 characters");
    });

    it("should reject too long name (64+ chars)", () => {
      expect(validateName("a".repeat(64))).toBe("Server name must be 3-63 characters");
    });

    it("should reject name starting with hyphen", () => {
      expect(validateName("-my-server")).toBe(
        "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens",
      );
    });

    it("should reject name ending with hyphen", () => {
      expect(validateName("my-server-")).toBe(
        "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens",
      );
    });

    it("should reject name starting with number", () => {
      expect(validateName("1server")).toBe(
        "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens",
      );
    });

    it("should reject uppercase letters", () => {
      expect(validateName("MyServer")).toBe(
        "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens",
      );
    });

    it("should reject underscores", () => {
      expect(validateName("my_server")).toBe(
        "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens",
      );
    });

    it("should reject dots", () => {
      expect(validateName("server.com")).toBe(
        "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens",
      );
    });

    it("should reject spaces", () => {
      expect(validateName("my server")).toBe(
        "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens",
      );
    });
  });
});

describe("confirmDeployment", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should return true when user confirms", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: "yes" });

    const result = await confirmDeployment(
      {
        provider: "hetzner",
        apiToken: "x",
        region: "nbg1",
        serverSize: "cax11",
        serverName: "server",
      },
      mockProvider,
    );

    expect(result).toBe(true);
  });

  it("should return false when user declines", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: "no" });

    const result = await confirmDeployment(
      {
        provider: "hetzner",
        apiToken: "x",
        region: "nbg1",
        serverSize: "cax11",
        serverName: "server",
      },
      mockProvider,
    );

    expect(result).toBe(false);
  });

  it("should return BACK_SIGNAL when user selects back", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: "__BACK__" });

    const result = await confirmDeployment(
      {
        provider: "hetzner",
        apiToken: "x",
        region: "nbg1",
        serverSize: "cax11",
        serverName: "server",
      },
      mockProvider,
    );

    expect(result).toBe(BACK_SIGNAL);
  });

  it("should print deployment summary with correct details", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: "yes" });

    await confirmDeployment(
      {
        provider: "hetzner",
        apiToken: "x",
        region: "nbg1",
        serverSize: "cax11",
        serverName: "my-server",
      },
      mockProvider,
    );

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Hetzner Cloud");
    expect(output).toContain("Nuremberg");
    expect(output).toContain("CAX11");
    expect(output).toContain("€3.85/mo");
    expect(output).toContain("my-server");
  });

  it("should fallback to static data when dynamic lookup returns no match", async () => {
    // Provider returns empty arrays from dynamic methods, forcing fallback to static getRegions/getServerSizes
    const fallbackProvider: CloudProvider = {
      ...mockProvider,
      getAvailableLocations: jest.fn().mockResolvedValue([]),
      getAvailableServerTypes: jest.fn().mockResolvedValue([]),
      getServerDetails: jest.fn(),
    };

    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: "yes" });

    const result = await confirmDeployment(
      {
        provider: "hetzner",
        apiToken: "x",
        region: "nbg1",
        serverSize: "cax11",
        serverName: "my-server",
      },
      fallbackProvider,
    );

    expect(result).toBe(true);

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    // Should fallback to static getRegions() data
    expect(output).toContain("Nuremberg");
    // Should fallback to static getServerSizes() data
    expect(output).toContain("CAX11");
  });

  it("should show raw config values when region and size not found anywhere", async () => {
    const noMatchProvider: CloudProvider = {
      ...mockProvider,
      getAvailableLocations: jest.fn().mockResolvedValue([]),
      getAvailableServerTypes: jest.fn().mockResolvedValue([]),
      getRegions: () => [],
      getServerSizes: () => [],
      getServerDetails: jest.fn(),
    };

    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: "yes" });

    await confirmDeployment(
      {
        provider: "hetzner",
        apiToken: "x",
        region: "unknown-region",
        serverSize: "unknown-size",
        serverName: "test",
      },
      noMatchProvider,
    );

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("unknown-region");
    expect(output).toContain("unknown-size");
    expect(output).toContain("?");
    expect(output).toContain("N/A");
  });
});
