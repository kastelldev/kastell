import { getToken } from "../../src/core/auth";
import { getProviderToken, collectProviderTokensFromEnv } from "../../src/core/tokens";
import { clearAllTokens } from "../../src/core/tokenBuffer";

jest.mock("../../src/core/auth");
jest.mock("../../src/core/tokenBuffer", () => ({
  storeToken: jest.fn(),
  readToken: jest.fn().mockReturnValue(undefined),
  clearAllTokens: jest.fn(),
  registerCleanupHandlers: jest.fn(),
}));
const mockGetToken = getToken as jest.MockedFunction<typeof getToken>;

describe("getProviderToken", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockGetToken.mockReturnValue(undefined);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should return token from HETZNER_TOKEN env var", () => {
    process.env.HETZNER_TOKEN = "hetzner-test-token";
    expect(getProviderToken("hetzner")).toBe("hetzner-test-token");
  });

  it("should return token from DIGITALOCEAN_TOKEN env var", () => {
    process.env.DIGITALOCEAN_TOKEN = "do-test-token";
    expect(getProviderToken("digitalocean")).toBe("do-test-token");
  });

  it("should return token from VULTR_TOKEN env var", () => {
    process.env.VULTR_TOKEN = "vultr-test-token";
    expect(getProviderToken("vultr")).toBe("vultr-test-token");
  });

  it("should return token from LINODE_TOKEN env var", () => {
    process.env.LINODE_TOKEN = "linode-test-token";
    expect(getProviderToken("linode")).toBe("linode-test-token");
  });

  it("should return undefined when env var is not set", () => {
    delete process.env.HETZNER_TOKEN;
    expect(getProviderToken("hetzner")).toBeUndefined();
  });

  it("should return undefined for unknown provider", () => {
    expect(getProviderToken("aws")).toBeUndefined();
  });

  it("should return undefined when env var is whitespace-only (spaces)", () => {
    process.env.HETZNER_TOKEN = "   ";
    expect(getProviderToken("hetzner")).toBeUndefined();
  });

  it("should return undefined when env var is whitespace-only (tab + newline)", () => {
    process.env.HETZNER_TOKEN = "\t\n";
    expect(getProviderToken("hetzner")).toBeUndefined();
  });

  it("should return trimmed token when env var has leading whitespace", () => {
    process.env.HETZNER_TOKEN = "  actual-token";
    expect(getProviderToken("hetzner")).toBe("actual-token");
  });

  it("should return trimmed token when env var has trailing whitespace", () => {
    process.env.HETZNER_TOKEN = "actual-token  ";
    expect(getProviderToken("hetzner")).toBe("actual-token");
  });

  it("should return trimmed token when env var has surrounding whitespace", () => {
    process.env.HETZNER_TOKEN = "  actual-token\n";
    expect(getProviderToken("hetzner")).toBe("actual-token");
  });
});

describe("collectProviderTokensFromEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should collect tokens for all providers with env vars", () => {
    process.env.HETZNER_TOKEN = "h-token";
    process.env.DIGITALOCEAN_TOKEN = "do-token";

    const servers = [
      { id: "1", name: "s1", provider: "hetzner", ip: "1.1.1.1", region: "nbg1", size: "cx11", createdAt: "" , mode: "coolify" as const },
      { id: "2", name: "s2", provider: "digitalocean", ip: "2.2.2.2", region: "nyc1", size: "s-1", createdAt: "" , mode: "coolify" as const },
    ];

    const tokenMap = collectProviderTokensFromEnv(servers);

    expect(tokenMap.get("hetzner")).toBe("h-token");
    expect(tokenMap.get("digitalocean")).toBe("do-token");
    expect(tokenMap.size).toBe(2);
  });

  it("should skip providers without env vars", () => {
    process.env.HETZNER_TOKEN = "h-token";
    delete process.env.DIGITALOCEAN_TOKEN;

    const servers = [
      { id: "1", name: "s1", provider: "hetzner", ip: "1.1.1.1", region: "nbg1", size: "cx11", createdAt: "" , mode: "coolify" as const },
      { id: "2", name: "s2", provider: "digitalocean", ip: "2.2.2.2", region: "nyc1", size: "s-1", createdAt: "" , mode: "coolify" as const },
    ];

    const tokenMap = collectProviderTokensFromEnv(servers);

    expect(tokenMap.get("hetzner")).toBe("h-token");
    expect(tokenMap.has("digitalocean")).toBe(false);
    expect(tokenMap.size).toBe(1);
  });

  it("should skip manual servers", () => {
    process.env.HETZNER_TOKEN = "h-token";

    const servers = [
      { id: "manual-abc", name: "s1", provider: "hetzner", ip: "1.1.1.1", region: "nbg1", size: "cx11", createdAt: "" , mode: "coolify" as const },
    ];

    const tokenMap = collectProviderTokensFromEnv(servers);

    expect(tokenMap.size).toBe(0);
  });

  it("should deduplicate providers", () => {
    process.env.HETZNER_TOKEN = "h-token";

    const servers = [
      { id: "1", name: "s1", provider: "hetzner", ip: "1.1.1.1", region: "nbg1", size: "cx11", createdAt: "" , mode: "coolify" as const },
      { id: "2", name: "s2", provider: "hetzner", ip: "2.2.2.2", region: "fsn1", size: "cx21", createdAt: "" , mode: "coolify" as const },
    ];

    const tokenMap = collectProviderTokensFromEnv(servers);

    expect(tokenMap.size).toBe(1);
    expect(tokenMap.get("hetzner")).toBe("h-token");
  });

  it("should return empty map for empty server list", () => {
    const tokenMap = collectProviderTokensFromEnv([]);
    expect(tokenMap.size).toBe(0);
  });
});

describe("keychain resolution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockGetToken.mockReturnValue(undefined);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should return keychain token when available", () => {
    mockGetToken.mockReturnValue("keychain-token");
    expect(getProviderToken("hetzner")).toBe("keychain-token");
  });

  it("should fall back to env var when keychain returns undefined", () => {
    mockGetToken.mockReturnValue(undefined);
    process.env.HETZNER_TOKEN = "env-token";
    expect(getProviderToken("hetzner")).toBe("env-token");
  });

  it("should prefer keychain over env var when both exist", () => {
    mockGetToken.mockReturnValue("keychain-token");
    process.env.HETZNER_TOKEN = "env-token";
    expect(getProviderToken("hetzner")).toBe("keychain-token");
  });

  it("should return undefined when neither keychain nor env var has token", () => {
    mockGetToken.mockReturnValue(undefined);
    delete process.env.HETZNER_TOKEN;
    expect(getProviderToken("hetzner")).toBeUndefined();
  });
});
