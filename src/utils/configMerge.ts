import type { InitOptions, KastellYamlConfig } from "../types/index.js";
import { getTemplate, getTemplateDefaults } from "./templates.js";

export interface ResolvedConfig {
  provider?: string;
  token?: string;
  region?: string;
  size?: string;
  name?: string;
  fullSetup?: boolean;
  domain?: string;
}

/**
 * Merge configuration from multiple sources.
 * Priority: CLI flags > YAML config > template defaults > undefined (interactive prompt)
 */
export function mergeConfig(
  cliOptions: InitOptions,
  yamlConfig?: KastellYamlConfig,
): ResolvedConfig {
  const resolved: ResolvedConfig = {};

  // Determine template name: CLI --template > YAML template
  const templateName = cliOptions.template ?? yamlConfig?.template;

  // Determine provider: CLI > YAML
  resolved.provider = cliOptions.provider ?? yamlConfig?.provider;

  // Token: only from CLI (never from YAML)
  resolved.token = cliOptions.token;

  // Get template defaults if both template and provider are known
  let templateDefaults: { region: string; size: string } | undefined;
  if (templateName && resolved.provider) {
    templateDefaults = getTemplateDefaults(templateName, resolved.provider);
  }

  // Template-level fullSetup default
  const templateDef = templateName ? getTemplate(templateName) : undefined;
  const templateFullSetup = templateDef?.fullSetup;

  // Region: CLI > YAML > template
  resolved.region = cliOptions.region ?? yamlConfig?.region ?? templateDefaults?.region;

  // Size: CLI > YAML > template
  resolved.size = cliOptions.size ?? yamlConfig?.size ?? templateDefaults?.size;

  // Name: CLI > YAML (template does not set name)
  resolved.name = cliOptions.name ?? yamlConfig?.name;

  // fullSetup: CLI > YAML > template
  resolved.fullSetup = cliOptions.fullSetup ?? yamlConfig?.fullSetup ?? templateFullSetup;

  // domain: only from YAML
  resolved.domain = yamlConfig?.domain;

  return resolved;
}
