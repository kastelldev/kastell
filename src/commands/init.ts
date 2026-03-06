import type { InitOptions } from "../types/index.js";
import { createProvider, createProviderWithToken } from "../utils/providerFactory.js";
import {
  BACK_SIGNAL,
  getProviderConfig,
  getDeploymentConfig,
  getLocationConfig,
  getServerTypeConfig,
  getServerNameConfig,
  confirmDeployment,
} from "../utils/prompts.js";
import { logger, createSpinner } from "../utils/logger.js";
import { loadYamlConfig } from "../utils/yamlConfig.js";
import { mergeConfig } from "../utils/configMerge.js";
import { getTemplate, getTemplateDefaults, VALID_TEMPLATE_NAMES } from "../utils/templates.js";
import { SUPPORTED_PROVIDERS, PROVIDER_ENV_KEYS, invalidProviderError } from "../constants.js";
import { deployServer } from "../core/deploy.js";

export async function initCommand(options: InitOptions = {}): Promise<void> {
  // Load YAML config if --config flag provided
  if (options.config) {
    const { config: yamlConfig, warnings } = loadYamlConfig(options.config);
    for (const w of warnings) {
      logger.warning(w);
    }
    const merged = mergeConfig(options, yamlConfig);
    // Apply merged values back to options
    if (merged.provider && !options.provider) options.provider = merged.provider;
    if (merged.region && !options.region) options.region = merged.region;
    if (merged.size && !options.size) options.size = merged.size;
    if (merged.name && !options.name) options.name = merged.name;
    if (merged.fullSetup !== undefined && options.fullSetup === undefined)
      options.fullSetup = merged.fullSetup;
  } else if (options.template) {
    // Template-only mode (no YAML file)
    const merged = mergeConfig(options);
    if (merged.provider && !options.provider) options.provider = merged.provider;
    if (merged.region && !options.region) options.region = merged.region;
    if (merged.size && !options.size) options.size = merged.size;
    if (merged.name && !options.name) options.name = merged.name;
    if (merged.fullSetup !== undefined && options.fullSetup === undefined)
      options.fullSetup = merged.fullSetup;
  }

  // Validate --template flag
  if (options.template) {
    const tmpl = getTemplate(options.template);
    if (!tmpl) {
      logger.error(
        `Invalid template: "${options.template}". Valid templates: ${VALID_TEMPLATE_NAMES.join(", ")}`,
      );
      process.exit(1);
      return;
    }
    logger.info(`Using template: ${tmpl.name} - ${tmpl.description}`);
  }

  const isNonInteractive = options.provider !== undefined;

  logger.title("Kastell - Self-hosting, fully managed");

  let providerChoice: string;
  let apiToken: string;
  let tokenSource: string;
  let region: string;
  let serverSize: string;
  let serverName: string;

  // Step 1: Select cloud provider
  if (options.provider) {
    if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(options.provider)) {
      logger.error(invalidProviderError(options.provider));
      process.exit(1);
      return;
    }
    providerChoice = options.provider;
  } else {
    const result = await getProviderConfig();
    providerChoice = result.provider;
  }
  const provider = createProvider(providerChoice);
  logger.info(`Using ${provider.displayName}`);

  // Apply template defaults now that provider is known (handles interactive provider selection)
  if (options.template) {
    const tmplDefaults = getTemplateDefaults(options.template, providerChoice);
    if (tmplDefaults) {
      if (!options.region) options.region = tmplDefaults.region;
      if (!options.size) options.size = tmplDefaults.size;
    }
  }

  // Step 2: Get API token (env var > interactive prompt)
  if (options.token) {
    apiToken = options.token;
    tokenSource = "--token flag";
    logger.warning(
      "Token passed via --token flag is visible in shell history. Use environment variables instead: export HETZNER_TOKEN=...",
    );
    process.title = "kastell";
  } else {
    const envKey = PROVIDER_ENV_KEYS[providerChoice as keyof typeof PROVIDER_ENV_KEYS];
    if (envKey && process.env[envKey]) {
      apiToken = process.env[envKey]!;
      tokenSource = `${envKey} env var`;
    } else {
      const config = await getDeploymentConfig(provider);
      apiToken = config.apiToken;
      tokenSource = "interactive prompt";
    }
  }

  // Step 3: Validate API token
  const providerWithToken = createProviderWithToken(providerChoice, apiToken);
  const tokenSpinner = createSpinner("Validating API token...");
  tokenSpinner.start();

  const isValid = await providerWithToken.validateToken(apiToken);
  if (!isValid) {
    tokenSpinner.fail("Invalid API token");
    logger.error("Please check your API token and try again");
    if (isNonInteractive) {
      process.exit(1);
      return;
    }
    return;
  }
  tokenSpinner.succeed(`API token validated (from ${tokenSource})`);

  // Step 4: Region
  if (options.region) {
    region = options.region;
  } else {
    // Interactive region selection with back navigation
    let step = 4;
    region = "";
    serverSize = "";
    serverName = "";

    while (step >= 4 && step <= 7) {
      switch (step) {
        case 4: {
          const r = await getLocationConfig(providerWithToken);
          if (r === BACK_SIGNAL) break;
          region = r;
          step = 5;
          break;
        }
        case 5: {
          const s = await getServerTypeConfig(providerWithToken, region, [], options.mode);
          if (s === BACK_SIGNAL) {
            step = 4;
            break;
          }
          serverSize = s;
          step = 6;
          break;
        }
        case 6: {
          if (options.name) {
            serverName = options.name;
            step = 7;
            break;
          }
          const n = await getServerNameConfig(options.mode);
          if (n === BACK_SIGNAL) {
            step = 5;
            break;
          }
          serverName = n;
          step = 7;
          break;
        }
        case 7: {
          const config = {
            provider: providerChoice,
            apiToken,
            region,
            serverSize,
            serverName,
            mode: options.mode,
          };
          const confirmed = await confirmDeployment(config, providerWithToken);
          if (confirmed === BACK_SIGNAL) {
            step = 6;
            break;
          }
          if (!confirmed) {
            logger.warning("Deployment cancelled");
            return;
          }
          step = 8;
          break;
        }
      }
    }

    // Deploy
    return deployServer(
      providerChoice,
      providerWithToken,
      region,
      serverSize,
      serverName,
      options.fullSetup,
      options.noOpen,
      options.mode,
    );
  }

  // Non-interactive or partially interactive: size, name
  if (options.size) {
    serverSize = options.size;
  } else {
    let s = BACK_SIGNAL;
    while (s === BACK_SIGNAL) {
      s = await getServerTypeConfig(providerWithToken, region, [], options.mode);
    }
    serverSize = s;
  }

  if (options.name) {
    serverName = options.name;
  } else {
    let n = BACK_SIGNAL;
    while (n === BACK_SIGNAL) {
      n = await getServerNameConfig(options.mode);
    }
    serverName = n;
  }

  return deployServer(
    providerChoice,
    providerWithToken,
    region,
    serverSize,
    serverName,
    options.fullSetup,
    options.noOpen,
    options.mode,
  );
}

