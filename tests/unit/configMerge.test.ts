import { mergeConfig } from "../../src/utils/configMerge";
import type { InitOptions, KastellYamlConfig } from "../../src/types/index";

describe("configMerge", () => {
  describe("mergeConfig", () => {
    it("should return empty resolved config when no inputs given", () => {
      const result = mergeConfig({});
      expect(result.provider).toBeUndefined();
      expect(result.region).toBeUndefined();
      expect(result.size).toBeUndefined();
      expect(result.name).toBeUndefined();
      expect(result.fullSetup).toBeUndefined();
    });

    // CLI > YAML priority
    it("should prioritize CLI provider over YAML", () => {
      const cli: InitOptions = { provider: "hetzner" };
      const yaml: KastellYamlConfig = { provider: "digitalocean" };
      const result = mergeConfig(cli, yaml);
      expect(result.provider).toBe("hetzner");
    });

    it("should use YAML provider when CLI has none", () => {
      const cli: InitOptions = {};
      const yaml: KastellYamlConfig = { provider: "digitalocean" };
      const result = mergeConfig(cli, yaml);
      expect(result.provider).toBe("digitalocean");
    });

    it("should prioritize CLI region over YAML", () => {
      const cli: InitOptions = { region: "fsn1" };
      const yaml: KastellYamlConfig = { region: "nbg1" };
      const result = mergeConfig(cli, yaml);
      expect(result.region).toBe("fsn1");
    });

    it("should use YAML region when CLI has none", () => {
      const cli: InitOptions = {};
      const yaml: KastellYamlConfig = { region: "nbg1" };
      const result = mergeConfig(cli, yaml);
      expect(result.region).toBe("nbg1");
    });

    it("should prioritize CLI size over YAML", () => {
      const cli: InitOptions = { size: "cx43" };
      const yaml: KastellYamlConfig = { size: "cx33" };
      const result = mergeConfig(cli, yaml);
      expect(result.size).toBe("cx43");
    });

    it("should prioritize CLI name over YAML", () => {
      const cli: InitOptions = { name: "cli-name" };
      const yaml: KastellYamlConfig = { name: "yaml-name" };
      const result = mergeConfig(cli, yaml);
      expect(result.name).toBe("cli-name");
    });

    it("should prioritize CLI fullSetup over YAML", () => {
      const cli: InitOptions = { fullSetup: true };
      const yaml: KastellYamlConfig = { fullSetup: false };
      const result = mergeConfig(cli, yaml);
      expect(result.fullSetup).toBe(true);
    });

    it("should allow CLI fullSetup=false to override template default", () => {
      const cli: InitOptions = { provider: "hetzner", template: "production", fullSetup: false };
      const result = mergeConfig(cli);
      expect(result.fullSetup).toBe(false); // CLI false overrides production's true
    });

    // Template defaults
    it("should apply template defaults when provider is known", () => {
      const cli: InitOptions = { provider: "hetzner", template: "production" };
      const result = mergeConfig(cli);
      expect(result.region).toBe("nbg1");
      expect(result.size).toBe("cx33");
      expect(result.fullSetup).toBe(true);
    });

    it("should apply starter template defaults for digitalocean", () => {
      const cli: InitOptions = { provider: "digitalocean", template: "starter" };
      const result = mergeConfig(cli);
      expect(result.region).toBe("fra1");
      expect(result.size).toBe("s-2vcpu-2gb");
      expect(result.fullSetup).toBe(false);
    });

    it("should apply dev template defaults for hetzner", () => {
      const cli: InitOptions = { provider: "hetzner", template: "dev" };
      const result = mergeConfig(cli);
      expect(result.region).toBe("nbg1");
      expect(result.size).toBe("cax11");
      expect(result.fullSetup).toBe(false);
    });

    // CLI > YAML > template priority
    it("should prioritize YAML region over template defaults", () => {
      const cli: InitOptions = { provider: "hetzner", template: "production" };
      const yaml: KastellYamlConfig = { region: "fsn1" };
      const result = mergeConfig(cli, yaml);
      expect(result.region).toBe("fsn1");
    });

    it("should prioritize CLI region over YAML and template", () => {
      const cli: InitOptions = { provider: "hetzner", template: "production", region: "hel1" };
      const yaml: KastellYamlConfig = { region: "fsn1" };
      const result = mergeConfig(cli, yaml);
      expect(result.region).toBe("hel1");
    });

    it("should use YAML template when CLI has no template", () => {
      const cli: InitOptions = { provider: "hetzner" };
      const yaml: KastellYamlConfig = { template: "production" };
      const result = mergeConfig(cli, yaml);
      expect(result.region).toBe("nbg1");
      expect(result.size).toBe("cx33");
      expect(result.fullSetup).toBe(true);
    });

    it("should prioritize CLI template over YAML template", () => {
      const cli: InitOptions = { provider: "hetzner", template: "starter" };
      const yaml: KastellYamlConfig = { template: "production" };
      const result = mergeConfig(cli, yaml);
      expect(result.size).toBe("cax11"); // starter default, not production
    });

    // Token: only from CLI
    it("should pass CLI token through", () => {
      const cli: InitOptions = { token: "my-secret" };
      const result = mergeConfig(cli);
      expect(result.token).toBe("my-secret");
    });

    it("should not take token from YAML", () => {
      const cli: InitOptions = {};
      // token is not part of KastellYamlConfig, so this tests that
      const result = mergeConfig(cli, {} as KastellYamlConfig);
      expect(result.token).toBeUndefined();
    });

    // Domain from YAML only
    it("should pass domain from YAML", () => {
      const cli: InitOptions = {};
      const yaml: KastellYamlConfig = { domain: "coolify.example.com" };
      const result = mergeConfig(cli, yaml);
      expect(result.domain).toBe("coolify.example.com");
    });

    // No template defaults when provider unknown
    it("should not apply template defaults when provider is unknown", () => {
      const cli: InitOptions = { template: "production" };
      const result = mergeConfig(cli);
      expect(result.region).toBeUndefined();
      expect(result.size).toBeUndefined();
      // But fullSetup should still come from template
      expect(result.fullSetup).toBe(true);
    });

    // fullSetup: YAML > template
    it("should prioritize YAML fullSetup over template", () => {
      const cli: InitOptions = { provider: "hetzner", template: "production" };
      const yaml: KastellYamlConfig = { fullSetup: false };
      const result = mergeConfig(cli, yaml);
      expect(result.fullSetup).toBe(false); // YAML overrides production's true
    });

    // Unknown template gives no defaults
    it("should handle unknown template gracefully", () => {
      const cli: InitOptions = { provider: "hetzner", template: "nonexistent" };
      const result = mergeConfig(cli);
      expect(result.region).toBeUndefined();
      expect(result.size).toBeUndefined();
      expect(result.fullSetup).toBeUndefined();
    });
  });
});
