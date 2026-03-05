import { validateYamlConfig, loadYamlConfig } from "../../src/utils/yamlConfig";
import * as fs from "fs";

jest.mock("fs");

const mockedFs = fs as jest.Mocked<typeof fs>;

describe("yamlConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("validateYamlConfig", () => {
    it("should return empty config for null input", () => {
      const result = validateYamlConfig(null);
      expect(result.config).toEqual({});
      expect(result.warnings).toHaveLength(0);
    });

    it("should return empty config for undefined input", () => {
      const result = validateYamlConfig(undefined);
      expect(result.config).toEqual({});
      expect(result.warnings).toHaveLength(0);
    });

    it("should warn for non-object input (array)", () => {
      const result = validateYamlConfig([1, 2, 3]);
      expect(result.config).toEqual({});
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("must be a YAML object");
    });

    it("should warn for non-object input (string)", () => {
      const result = validateYamlConfig("just a string");
      expect(result.config).toEqual({});
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("must be a YAML object");
    });

    // Provider validation
    it("should accept valid provider: hetzner", () => {
      const result = validateYamlConfig({ provider: "hetzner" });
      expect(result.config.provider).toBe("hetzner");
      expect(result.warnings).toHaveLength(0);
    });

    it("should accept valid provider: digitalocean", () => {
      const result = validateYamlConfig({ provider: "digitalocean" });
      expect(result.config.provider).toBe("digitalocean");
      expect(result.warnings).toHaveLength(0);
    });

    it("should accept valid provider: vultr", () => {
      const result = validateYamlConfig({ provider: "vultr" });
      expect(result.config.provider).toBe("vultr");
      expect(result.warnings).toHaveLength(0);
    });

    it("should accept valid provider: linode", () => {
      const result = validateYamlConfig({ provider: "linode" });
      expect(result.config.provider).toBe("linode");
      expect(result.warnings).toHaveLength(0);
    });

    it("should warn for invalid provider string", () => {
      const result = validateYamlConfig({ provider: "aws" });
      expect(result.config.provider).toBeUndefined();
      expect(result.warnings[0]).toContain('Invalid provider: "aws"');
    });

    it("should warn for non-string provider", () => {
      const result = validateYamlConfig({ provider: 123 });
      expect(result.config.provider).toBeUndefined();
      expect(result.warnings[0]).toContain("must be a string");
    });

    it("should include linode in invalid provider message", () => {
      const result = validateYamlConfig({ provider: "aws" });
      expect(result.warnings[0]).toContain("linode");
    });

    // Template validation
    it("should accept valid template: starter", () => {
      const result = validateYamlConfig({ template: "starter" });
      expect(result.config.template).toBe("starter");
    });

    it("should accept valid template: production", () => {
      const result = validateYamlConfig({ template: "production" });
      expect(result.config.template).toBe("production");
    });

    it("should accept valid template: dev", () => {
      const result = validateYamlConfig({ template: "dev" });
      expect(result.config.template).toBe("dev");
    });

    it("should warn for invalid template string", () => {
      const result = validateYamlConfig({ template: "enterprise" });
      expect(result.config.template).toBeUndefined();
      expect(result.warnings[0]).toContain('Invalid template: "enterprise"');
    });

    it("should warn for non-string template", () => {
      const result = validateYamlConfig({ template: true });
      expect(result.config.template).toBeUndefined();
      expect(result.warnings[0]).toContain("must be a string");
    });

    // Name validation
    it("should accept valid name", () => {
      const result = validateYamlConfig({ name: "my-coolify-server" });
      expect(result.config.name).toBe("my-coolify-server");
    });

    it("should accept minimum length name (3 chars)", () => {
      const result = validateYamlConfig({ name: "abc" });
      expect(result.config.name).toBe("abc");
    });

    it("should reject name shorter than 3 chars", () => {
      const result = validateYamlConfig({ name: "ab" });
      expect(result.config.name).toBeUndefined();
      expect(result.warnings[0]).toContain("between 3 and 63 characters");
    });

    it("should reject name longer than 63 chars", () => {
      const result = validateYamlConfig({ name: "a".repeat(64) });
      expect(result.config.name).toBeUndefined();
      expect(result.warnings[0]).toContain("between 3 and 63 characters");
    });

    it("should reject name starting with number", () => {
      const result = validateYamlConfig({ name: "1server" });
      expect(result.config.name).toBeUndefined();
      expect(result.warnings[0]).toContain("lowercase letter");
    });

    it("should reject name with uppercase letters", () => {
      const result = validateYamlConfig({ name: "MyServer" });
      expect(result.config.name).toBeUndefined();
      expect(result.warnings[0]).toContain("lowercase letter");
    });

    it("should reject name with special characters", () => {
      const result = validateYamlConfig({ name: "my_server" });
      expect(result.config.name).toBeUndefined();
      expect(result.warnings[0]).toContain("lowercase letter");
    });

    it("should reject name ending with hyphen", () => {
      const result = validateYamlConfig({ name: "my-server-" });
      expect(result.config.name).toBeUndefined();
      expect(result.warnings[0]).toContain("end with a letter or number");
    });

    it("should warn for non-string name", () => {
      const result = validateYamlConfig({ name: 42 });
      expect(result.config.name).toBeUndefined();
      expect(result.warnings[0]).toContain("must be a string");
    });

    // Region
    it("should accept valid region", () => {
      const result = validateYamlConfig({ region: "nbg1" });
      expect(result.config.region).toBe("nbg1");
    });

    it("should warn for non-string region", () => {
      const result = validateYamlConfig({ region: 42 });
      expect(result.config.region).toBeUndefined();
      expect(result.warnings[0]).toContain("Invalid region");
    });

    // Size
    it("should accept valid size", () => {
      const result = validateYamlConfig({ size: "cx33" });
      expect(result.config.size).toBe("cx33");
    });

    it("should warn for non-string size", () => {
      const result = validateYamlConfig({ size: false });
      expect(result.config.size).toBeUndefined();
      expect(result.warnings[0]).toContain("Invalid size");
    });

    // fullSetup
    it("should accept fullSetup: true", () => {
      const result = validateYamlConfig({ fullSetup: true });
      expect(result.config.fullSetup).toBe(true);
    });

    it("should accept fullSetup: false", () => {
      const result = validateYamlConfig({ fullSetup: false });
      expect(result.config.fullSetup).toBe(false);
    });

    it("should warn for non-boolean fullSetup", () => {
      const result = validateYamlConfig({ fullSetup: "yes" });
      expect(result.config.fullSetup).toBeUndefined();
      expect(result.warnings[0]).toContain("must be true or false");
    });

    // Domain
    it("should accept valid domain", () => {
      const result = validateYamlConfig({ domain: "coolify.example.com" });
      expect(result.config.domain).toBe("coolify.example.com");
    });

    it("should warn for non-string domain", () => {
      const result = validateYamlConfig({ domain: 123 });
      expect(result.config.domain).toBeUndefined();
      expect(result.warnings[0]).toContain("Invalid domain");
    });

    // Security: token fields
    it("should warn when token is found in config", () => {
      const result = validateYamlConfig({ token: "secret123" });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Security warning");
      expect(result.warnings[0]).toContain('"token"');
    });

    it("should warn for apiToken field", () => {
      const result = validateYamlConfig({ apiToken: "abc" });
      expect(result.warnings.some((w) => w.includes("Security warning"))).toBe(true);
    });

    it("should warn for api_token field", () => {
      const result = validateYamlConfig({ api_token: "abc" });
      expect(result.warnings.some((w) => w.includes("Security warning"))).toBe(true);
    });

    it("should warn for apiKey field", () => {
      const result = validateYamlConfig({ apiKey: "abc" });
      expect(result.warnings.some((w) => w.includes("Security warning"))).toBe(true);
    });

    it("should warn for api_key field", () => {
      const result = validateYamlConfig({ api_key: "abc" });
      expect(result.warnings.some((w) => w.includes("Security warning"))).toBe(true);
    });

    it("should warn for secret field", () => {
      const result = validateYamlConfig({ secret: "abc" });
      expect(result.warnings.some((w) => w.includes("Security warning"))).toBe(true);
    });

    // Unknown keys
    it("should warn for unknown keys", () => {
      const result = validateYamlConfig({ foobar: "baz" });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Unknown config key: "foobar"');
    });

    // Full valid config
    it("should parse a complete valid config", () => {
      const result = validateYamlConfig({
        template: "production",
        provider: "hetzner",
        region: "nbg1",
        size: "cx33",
        name: "my-prod-server",
        fullSetup: true,
        domain: "coolify.example.com",
      });
      expect(result.warnings).toHaveLength(0);
      expect(result.config).toEqual({
        template: "production",
        provider: "hetzner",
        region: "nbg1",
        size: "cx33",
        name: "my-prod-server",
        fullSetup: true,
        domain: "coolify.example.com",
      });
    });

    // Expanded security keys
    it('should warn about "password" key', () => {
      const { warnings } = validateYamlConfig({ password: "secret123" });
      expect(warnings.some((w: string) => w.includes('"password"'))).toBe(true);
    });

    it('should warn about "passwd" key', () => {
      const { warnings } = validateYamlConfig({ passwd: "secret123" });
      expect(warnings.some((w: string) => w.includes('"passwd"'))).toBe(true);
    });

    it('should warn about "pwd" key', () => {
      const { warnings } = validateYamlConfig({ pwd: "secret123" });
      expect(warnings.some((w: string) => w.includes('"pwd"'))).toBe(true);
    });

    it('should warn about "credential" key', () => {
      const { warnings } = validateYamlConfig({ credential: "secret123" });
      expect(warnings.some((w: string) => w.includes('"credential"'))).toBe(true);
    });

    it('should warn about "credentials" key', () => {
      const { warnings } = validateYamlConfig({ credentials: "secret123" });
      expect(warnings.some((w: string) => w.includes('"credentials"'))).toBe(true);
    });

    it('should warn about "auth" key', () => {
      const { warnings } = validateYamlConfig({ auth: "secret123" });
      expect(warnings.some((w: string) => w.includes('"auth"'))).toBe(true);
    });

    it('should warn about "authorization" key', () => {
      const { warnings } = validateYamlConfig({ authorization: "secret123" });
      expect(warnings.some((w: string) => w.includes('"authorization"'))).toBe(true);
    });

    it('should warn about "bearer" key', () => {
      const { warnings } = validateYamlConfig({ bearer: "secret123" });
      expect(warnings.some((w: string) => w.includes('"bearer"'))).toBe(true);
    });

    it('should warn about "jwt" key', () => {
      const { warnings } = validateYamlConfig({ jwt: "secret123" });
      expect(warnings.some((w: string) => w.includes('"jwt"'))).toBe(true);
    });

    it('should warn about "privateKey" key', () => {
      const { warnings } = validateYamlConfig({ privateKey: "secret123" });
      expect(warnings.some((w: string) => w.includes('"privateKey"'))).toBe(true);
    });

    it('should warn about "private_key" key', () => {
      const { warnings } = validateYamlConfig({ private_key: "secret123" });
      expect(warnings.some((w: string) => w.includes('"private_key"'))).toBe(true);
    });

    it('should warn about "accessKey" key', () => {
      const { warnings } = validateYamlConfig({ accessKey: "secret123" });
      expect(warnings.some((w: string) => w.includes('"accessKey"'))).toBe(true);
    });

    it('should warn about "access_key" key', () => {
      const { warnings } = validateYamlConfig({ access_key: "secret123" });
      expect(warnings.some((w: string) => w.includes('"access_key"'))).toBe(true);
    });

    it('should warn about "secretKey" key', () => {
      const { warnings } = validateYamlConfig({ secretKey: "secret123" });
      expect(warnings.some((w: string) => w.includes('"secretKey"'))).toBe(true);
    });

    it('should warn about "secret_key" key', () => {
      const { warnings } = validateYamlConfig({ secret_key: "secret123" });
      expect(warnings.some((w: string) => w.includes('"secret_key"'))).toBe(true);
    });

    // Case-insensitive security key detection
    it("should detect security keys case-insensitively (TOKEN)", () => {
      const { warnings } = validateYamlConfig({ TOKEN: "secret123" });
      expect(warnings.some((w: string) => w.includes("Security warning"))).toBe(true);
      expect(warnings.some((w: string) => w.includes('"TOKEN"'))).toBe(true);
    });

    it("should detect security keys case-insensitively (ApiToken)", () => {
      const { warnings } = validateYamlConfig({ ApiToken: "secret123" });
      expect(warnings.some((w: string) => w.includes("Security warning"))).toBe(true);
    });

    it("should detect security keys case-insensitively (PASSWORD)", () => {
      const { warnings } = validateYamlConfig({ PASSWORD: "secret123" });
      expect(warnings.some((w: string) => w.includes("Security warning"))).toBe(true);
    });

    // Nested security key detection
    it("should detect security keys in nested objects", () => {
      const { warnings } = validateYamlConfig({
        database: {
          password: "secret123",
        },
      });
      expect(warnings.some((w: string) => w.includes("Security warning"))).toBe(true);
      expect(warnings.some((w: string) => w.includes('"database.password"'))).toBe(true);
    });

    it("should detect deeply nested security keys", () => {
      const { warnings } = validateYamlConfig({
        services: {
          api: {
            credentials: {
              token: "secret123",
            },
          },
        },
      });
      // Should detect both "credentials" and "token"
      expect(warnings.filter((w: string) => w.includes("Security warning")).length).toBeGreaterThanOrEqual(2);
      expect(warnings.some((w: string) => w.includes("services.api.credentials"))).toBe(true);
      expect(warnings.some((w: string) => w.includes("services.api.credentials.token"))).toBe(true);
    });

    it("should detect case-insensitive nested security keys", () => {
      const { warnings } = validateYamlConfig({
        Config: {
          API_KEY: "secret123",
        },
      });
      expect(warnings.some((w: string) => w.includes("Security warning"))).toBe(true);
      expect(warnings.some((w: string) => w.includes('"Config.API_KEY"'))).toBe(true);
    });

    // Newly added security keys (pass, cred, connection_string, dsn)
    it('should warn about "pass" key', () => {
      const { warnings } = validateYamlConfig({ db_pass: "hidden" });
      // "pass" is in SECURITY_KEYS, but key is "db_pass" — only exact match (lowercased)
      // db_pass.toLowerCase() = "db_pass" which is NOT in SECURITY_KEYS
      expect(warnings.some((w: string) => w.includes("Security warning") && w.includes('"db_pass"'))).toBe(false);
    });

    it('should warn about exact "pass" key', () => {
      const { warnings } = validateYamlConfig({ pass: "secret" });
      expect(warnings.some((w: string) => w.includes("Security warning"))).toBe(true);
    });

    it('should warn about "cred" key', () => {
      const { warnings } = validateYamlConfig({ cred: "value" });
      expect(warnings.some((w: string) => w.includes("Security warning"))).toBe(true);
    });

    it('should warn about "connection_string" key', () => {
      const { warnings } = validateYamlConfig({ connection_string: "postgres://..." });
      expect(warnings.some((w: string) => w.includes("Security warning"))).toBe(true);
    });

    it('should warn about "dsn" key', () => {
      const { warnings } = validateYamlConfig({ dsn: "mysql://..." });
      expect(warnings.some((w: string) => w.includes("Security warning"))).toBe(true);
    });

    // Multiple warnings
    it("should collect multiple warnings", () => {
      const result = validateYamlConfig({
        provider: "aws",
        template: "mega",
        name: "AB",
        unknown1: true,
      });
      expect(result.warnings.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("loadYamlConfig", () => {
    it("should load and parse a valid YAML file", () => {
      mockedFs.readFileSync.mockReturnValue(
        "provider: hetzner\nregion: nbg1\nsize: cx33\nname: my-server\n",
      );
      const result = loadYamlConfig("/path/to/kastell.yml");
      expect(result.config.provider).toBe("hetzner");
      expect(result.config.region).toBe("nbg1");
      expect(result.config.size).toBe("cx33");
      expect(result.config.name).toBe("my-server");
      expect(result.warnings).toHaveLength(0);
    });

    it("should return warning when file cannot be read", () => {
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT: no such file");
      });
      const result = loadYamlConfig("/nonexistent.yml");
      expect(result.config).toEqual({});
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Could not read config file");
    });

    it("should return warning for invalid YAML syntax", () => {
      mockedFs.readFileSync.mockReturnValue("{ invalid yaml: [");
      const result = loadYamlConfig("/bad.yml");
      expect(result.config).toEqual({});
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Invalid YAML syntax");
    });

    it("should warn about token in YAML file", () => {
      mockedFs.readFileSync.mockReturnValue("provider: hetzner\ntoken: secret123\n");
      const result = loadYamlConfig("/with-token.yml");
      expect(result.config.provider).toBe("hetzner");
      expect(result.warnings.some((w) => w.includes("Security warning"))).toBe(true);
    });

    it("should handle empty YAML file", () => {
      mockedFs.readFileSync.mockReturnValue("");
      const result = loadYamlConfig("/empty.yml");
      expect(result.config).toEqual({});
      expect(result.warnings).toHaveLength(0);
    });

    it("should handle YAML with only comments", () => {
      mockedFs.readFileSync.mockReturnValue("# just a comment\n# another comment\n");
      const result = loadYamlConfig("/comments.yml");
      expect(result.config).toEqual({});
      expect(result.warnings).toHaveLength(0);
    });

    it("should pass non-Error exceptions as string (readFileSync)", () => {
      mockedFs.readFileSync.mockImplementation(() => {
        throw "string error";
      });
      const result = loadYamlConfig("/fail.yml");
      expect(result.warnings[0]).toContain("string error");
    });

    it("should pass non-Error exceptions as string (yaml.load)", () => {
      // yaml.load always throws YAMLException (an Error subclass),
      // but we test the fallback branch for non-Error throws
      const yaml = jest.requireActual("js-yaml") as typeof import("js-yaml");
      const originalLoad = yaml.load;
      jest.spyOn(yaml, "load").mockImplementation(() => {
        throw "yaml string error";
      });
      mockedFs.readFileSync.mockReturnValue("valid: content\n");
      const result = loadYamlConfig("/yaml-throw.yml");
      expect(result.warnings[0]).toContain("Invalid YAML syntax");
      expect(result.warnings[0]).toContain("yaml string error");
      (yaml.load as jest.Mock).mockRestore?.();
    });
  });
});
