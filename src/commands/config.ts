import {
  getDefaults,
  setDefault,
  getDefault,
  resetDefaults,
  VALID_KEYS,
} from "../utils/defaults.js";
import { logger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/errorMapper.js";

export async function configCommand(subcommand?: string, args?: string[]): Promise<void> {
  switch (subcommand) {
    case "set": {
      if (!args || args.length < 2) {
        logger.error("Usage: kastell config set <key> <value>");
        return;
      }
      const [key, value] = args;
      try {
        setDefault(key, value);
        logger.success(`Set ${key} = ${value}`);
      } catch (error: unknown) {
        logger.error(getErrorMessage(error));
      }
      break;
    }
    case "get": {
      if (!args || args.length < 1) {
        logger.error("Usage: kastell config get <key>");
        return;
      }
      const val = getDefault(args[0]);
      if (val !== undefined) {
        logger.info(`${args[0]} = ${val}`);
      } else {
        logger.info(`${args[0]} is not set`);
      }
      break;
    }
    case "list": {
      const config = getDefaults();
      const entries = Object.entries(config).filter(([, v]) => v !== undefined);
      if (entries.length === 0) {
        logger.info("No default config set. Use: kastell config set <key> <value>");
        return;
      }
      logger.title("Default Configuration");
      for (const [k, v] of entries) {
        logger.info(`${k.padEnd(12)} ${v}`);
      }
      break;
    }
    case "reset": {
      resetDefaults();
      logger.success("Default configuration reset");
      break;
    }
    case "validate": {
      if (!args || args.length < 1) {
        logger.error("Usage: kastell config validate <path>");
        logger.info("Example: kastell config validate kastell.yml");
        return;
      }
      const { loadYamlConfig } = await import("../utils/yamlConfig.js");
      const result = loadYamlConfig(args[0]);
      if (result.warnings.length === 0) {
        logger.success(`Config file "${args[0]}" is valid`);
        // Show parsed config summary
        const entries = Object.entries(result.config).filter(([, v]) => v !== undefined);
        if (entries.length > 0) {
          for (const [k, v] of entries) {
            logger.info(`  ${k}: ${v}`);
          }
        }
      } else {
        logger.error(`Validation errors in "${args[0]}":`);
        for (const w of result.warnings) {
          logger.warning(`  ${w}`);
        }
      }
      break;
    }
    default:
      logger.error("Usage: kastell config <set|get|list|reset|validate>");
      logger.info(`  set <key> <value>  Set a default value`);
      logger.info(`  get <key>          Get a default value`);
      logger.info(`  list               Show all defaults`);
      logger.info(`  reset              Clear all defaults`);
      logger.info(`  validate <path>    Validate a kastell.yml config file`);
      logger.info(``);
      logger.info(`Valid keys: ${VALID_KEYS.join(", ")}`);
      break;
  }
}
