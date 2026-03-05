import { readFileSync } from "fs";
import yaml from "js-yaml";
import type { KastellYamlConfig } from "../types/index.js";
import { VALID_TEMPLATE_NAMES } from "./templates.js";
import type { TemplateName } from "../types/index.js";
import { SUPPORTED_PROVIDERS, invalidProviderError } from "../constants.js";

const KNOWN_KEYS = new Set([
  "template",
  "provider",
  "region",
  "size",
  "name",
  "fullSetup",
  "domain",
]);

const SECURITY_KEYS = new Set([
  "token", "apitoken", "api_token", "apikey", "api_key", "secret",
  "password", "passwd", "pwd", "pass", "credential", "credentials", "cred",
  "auth", "authorization", "bearer", "jwt",
  "privatekey", "private_key", "accesskey", "access_key", "secretkey", "secret_key",
  "connection_string", "connectionstring", "dsn",
]);

function checkSecurityKeys(obj: Record<string, unknown>, warnings: string[], path = ""): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (SECURITY_KEYS.has(key.toLowerCase())) {
      warnings.push(
        `Security warning: "${fullPath}" found in config file. Tokens should NEVER be stored in config files. Use --token flag or environment variables instead.`,
      );
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      checkSecurityKeys(value as Record<string, unknown>, warnings, fullPath);
    }
  }
}

export interface YamlLoadResult {
  config: KastellYamlConfig;
  warnings: string[];
}

export function validateYamlConfig(raw: unknown): YamlLoadResult {
  const warnings: string[] = [];
  const config: KastellYamlConfig = {};

  if (raw === null || raw === undefined) {
    return { config, warnings };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("Config file must be a YAML object (key: value pairs)");
    return { config, warnings };
  }

  const obj = raw as Record<string, unknown>;

  // Security check: token fields (case-insensitive + nested)
  checkSecurityKeys(obj, warnings);

  // Unknown keys
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key) && !SECURITY_KEYS.has(key.toLowerCase())) {
      warnings.push(`Unknown config key: "${key}"`);
    }
  }

  // provider
  if (obj.provider !== undefined) {
    if (typeof obj.provider !== "string") {
      warnings.push(
        `Invalid provider: must be a string (${SUPPORTED_PROVIDERS.map((p) => `"${p}"`).join(", ")})`,
      );
    } else if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(obj.provider)) {
      warnings.push(invalidProviderError(obj.provider));
    } else {
      config.provider = obj.provider;
    }
  }

  // template
  if (obj.template !== undefined) {
    if (typeof obj.template !== "string") {
      warnings.push('Invalid template: must be a string ("starter", "production", or "dev")');
    } else if (!VALID_TEMPLATE_NAMES.includes(obj.template as TemplateName)) {
      warnings.push(`Invalid template: "${obj.template}". Use "starter", "production", or "dev".`);
    } else {
      config.template = obj.template as TemplateName;
    }
  }

  // name validation: 3-63 chars, lowercase, hyphens, starts with letter
  if (obj.name !== undefined) {
    if (typeof obj.name !== "string") {
      warnings.push("Invalid name: must be a string");
    } else {
      const name = obj.name;
      if (name.length < 3 || name.length > 63) {
        warnings.push("Invalid name: must be between 3 and 63 characters");
      } else if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)) {
        warnings.push(
          "Invalid name: must start with a lowercase letter, end with a letter or number, and contain only lowercase letters, numbers, and hyphens",
        );
      } else {
        config.name = name;
      }
    }
  }

  // region (string)
  if (obj.region !== undefined) {
    if (typeof obj.region !== "string") {
      warnings.push("Invalid region: must be a string");
    } else {
      config.region = obj.region;
    }
  }

  // size (string)
  if (obj.size !== undefined) {
    if (typeof obj.size !== "string") {
      warnings.push("Invalid size: must be a string");
    } else {
      config.size = obj.size;
    }
  }

  // fullSetup (boolean)
  if (obj.fullSetup !== undefined) {
    if (typeof obj.fullSetup !== "boolean") {
      warnings.push("Invalid fullSetup: must be true or false");
    } else {
      config.fullSetup = obj.fullSetup;
    }
  }

  // domain (string)
  if (obj.domain !== undefined) {
    if (typeof obj.domain !== "string") {
      warnings.push("Invalid domain: must be a string");
    } else {
      config.domain = obj.domain;
    }
  }

  return { config, warnings };
}

export function loadYamlConfig(filePath: string): YamlLoadResult {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { config: {}, warnings: [`Could not read config file: ${msg}`] };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { config: {}, warnings: [`Invalid YAML syntax: ${msg}`] };
  }

  return validateYamlConfig(parsed);
}
