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
import { SUPPORTED_PROVIDERS, PROVIDER_ENV_KEYS, invalidProviderError, PROVIDER_DISPLAY_NAMES } from "../constants.js";
import { deployServer } from "../core/deploy.js";
import inquirer from "inquirer";
import chalk from "chalk";
import { isServerMode } from "../types/index.js";
import { addServerRecord, validateIpAddress } from "../core/manage.js";
import { saveDefaults } from "../core/defaults.js";
import { getServers } from "../utils/config.js";

function applyMergedConfig(options: InitOptions, merged: Partial<InitOptions>): void {
  if (merged.provider && !options.provider) options.provider = merged.provider;
  if (merged.region && !options.region) options.region = merged.region;
  if (merged.size && !options.size) options.size = merged.size;
  if (merged.name && !options.name) options.name = merged.name;
  if (merged.fullSetup !== undefined && options.fullSetup === undefined)
    options.fullSetup = merged.fullSetup;
}

async function runRegisterPath(): Promise<void> {
  const { provider: providerName } = await inquirer.prompt([
    {
      type: "list",
      name: "provider",
      message: "Select cloud provider:",
      choices: SUPPORTED_PROVIDERS.map((p) => ({
        name: PROVIDER_DISPLAY_NAMES[p],
        value: p,
      })),
    },
  ]);

  const { apiToken } = await inquirer.prompt([
    {
      type: "password",
      name: "apiToken",
      message: `Enter your ${PROVIDER_DISPLAY_NAMES[providerName as keyof typeof PROVIDER_DISPLAY_NAMES] ?? providerName} API token:`,
      validate: (input: string) => (input.trim().length > 0 ? true : "API token is required"),
    },
  ]);

  const { ip } = await inquirer.prompt([
    {
      type: "input",
      name: "ip",
      message: "Enter server IP address:",
      validate: (input: string) => {
        const result = validateIpAddress(input.trim());
        return result === null ? true : result;
      },
    },
  ]);

  const { name } = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Server name:",
      default: "my-server",
      validate: (input: string) => {
        const trimmed = input.trim();
        if (!trimmed) return "Server name is required";
        if (trimmed.length < 3 || trimmed.length > 63)
          return "Server name must be 3-63 characters";
        if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(trimmed))
          return "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens";
        return true;
      },
    },
  ]);

  const { mode } = await inquirer.prompt([
    {
      type: "list",
      name: "mode",
      message: "Server mode:",
      choices: [
        { name: "Coolify", value: "coolify" },
        { name: "Dokploy", value: "dokploy" },
        { name: "Bare (no platform)", value: "bare" },
      ],
    },
  ]);

  const spinner = createSpinner("Adding server...");
  spinner.start();

  const result = await addServerRecord({
    provider: providerName,
    ip: ip.trim(),
    name: name.trim(),
    apiToken: apiToken.trim(),
    ...(isServerMode(mode) ? { mode } : {}),
  });

  if (!result.success) {
    spinner.fail(result.error ?? "Failed to add server");
    return;
  }

  if (result.platformStatus === "ssh_unavailable") {
    spinner.warn("SSH not available — server added without verification");
  } else if (result.platformStatus === "running") {
    spinner.succeed("Platform is running");
  } else if (result.platformStatus === "containers_detected") {
    spinner.succeed("Platform containers detected");
  } else if (result.platformStatus === "skipped") {
    spinner.succeed("Token validated");
  } else {
    spinner.warn("Could not verify platform — server added anyway");
  }

  const server = result.server!;
  console.log();
  console.log(chalk.green("Server added successfully!"));
  console.log(`  Name: ${server.name}`);
  console.log(`  IP: ${server.ip}`);
  console.log(`  Provider: ${server.provider}`);
  console.log();

  const { runAudit } = await inquirer.prompt([
    {
      type: "confirm",
      name: "runAudit",
      message: "Run `kastell audit` to check your server's security score?",
      default: true,
    },
  ]);

  if (runAudit) {
    logger.info(`Run: kastell audit ${server.name}`);
  }
}

async function runConfigurePath(): Promise<void> {
  const { framework } = await inquirer.prompt([
    {
      type: "list",
      name: "framework",
      message: "Default compliance standard:",
      choices: [
        { name: "CIS Level 1 (basic hardening)", value: "cis-level1" },
        { name: "CIS Level 2 (advanced hardening)", value: "cis-level2" },
        { name: "PCI-DSS (payment card industry)", value: "pci-dss" },
        { name: "HIPAA (healthcare)", value: "hipaa" },
        { name: "None (no default)", value: "" },
      ],
    },
  ]);

  const { threshold: thresholdStr } = await inquirer.prompt([
    {
      type: "input",
      name: "threshold",
      message: "Default audit threshold (0-100, empty for none):",
      default: "",
      validate: (input: string) => {
        if (!input.trim()) return true;
        const num = parseInt(input, 10);
        if (isNaN(num) || num < 0 || num > 100) return "Must be a number between 0 and 100";
        return true;
      },
    },
  ]);

  const config: Record<string, unknown> = {};
  if (framework) config.framework = framework;
  const threshold = parseInt(thresholdStr, 10);
  if (!isNaN(threshold)) config.threshold = threshold;

  saveDefaults(config as { threshold?: number; framework?: string });
  logger.success("Defaults saved to ~/.kastell/defaults.json");

  const servers = getServers();
  if (servers.length > 0) {
    const { runAudit } = await inquirer.prompt([
      {
        type: "confirm",
        name: "runAudit",
        message: `Run audit on ${servers.length} existing server(s) with these defaults?`,
        default: false,
      },
    ]);
    if (runAudit) {
      logger.info("Run: kastell audit <server-name> for each server");
    }
  }
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  // Load YAML config if --config flag provided
  if (options.config) {
    const { config: yamlConfig, warnings } = loadYamlConfig(options.config);
    for (const w of warnings) {
      logger.warning(w);
    }
    applyMergedConfig(options, mergeConfig(options, yamlConfig));
  } else if (options.template) {
    applyMergedConfig(options, mergeConfig(options));
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

  // === 3-WAY WIZARD (interactive only) ===
  if (!isNonInteractive) {
    const { wizardPath } = await inquirer.prompt([
      {
        type: "list",
        name: "wizardPath",
        message: "What would you like to do?",
        choices: [
          { name: "Provision a new server (create on cloud provider)", value: "provision" },
          { name: "Register an existing server (add by IP)", value: "register" },
          { name: "Configure defaults (compliance, notifications)", value: "configure" },
        ],
      },
    ]);

    if (wizardPath === "register") {
      await runRegisterPath();
      return;
    }

    if (wizardPath === "configure") {
      await runConfigurePath();
      return;
    }

    // wizardPath === "provision" — fall through to existing provision flow
  }

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

  // Step 2: Get API token (stdin > env var > interactive prompt)
  if (options.tokenStdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    apiToken = Buffer.concat(chunks).toString().trim();
    if (!apiToken) {
      logger.error("No token received from stdin");
      process.exitCode = 1;
      return;
    }
    tokenSource = "stdin";
  } else if (options.token) {
    apiToken = options.token;
    tokenSource = "--token flag";
    logger.warning(
      "Token passed via --token flag is visible in shell history. Use --token-stdin or environment variables instead: echo $TOKEN | kastell init --token-stdin",
    );
    // Hide token from process list
    process.title = "kastell";
    const tokenIdx = process.argv.indexOf("--token");
    if (tokenIdx !== -1) {
      process.argv[tokenIdx + 1] = "***";
    }
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
          if (r === BACK_SIGNAL) {
            step = 3; // Exit loop — go back to provider selection
            break;
          }
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
    await deployServer(
      providerChoice,
      providerWithToken,
      region,
      serverSize,
      serverName,
      options.fullSetup,
      options.noOpen,
      options.mode,
    );
    return;
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

  await deployServer(
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

