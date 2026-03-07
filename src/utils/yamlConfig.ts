import { readFileSync } from "fs";
import yaml from "js-yaml";
import { z } from "zod";
import type { KastellYamlConfig } from "../types/index.js";
import { VALID_TEMPLATE_NAMES } from "./templates.js";
import type { TemplateName } from "../types/index.js";
import { SUPPORTED_PROVIDERS, invalidProviderError } from "../constants.js";

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

// Zod schema for kastell.yml config
const KastellYamlSchema = z.object({
  provider: z.enum(SUPPORTED_PROVIDERS).optional(),
  template: z.enum(VALID_TEMPLATE_NAMES as [TemplateName, ...TemplateName[]]).optional(),
  name: z.string().min(3).max(63).regex(/^[a-z][a-z0-9-]*[a-z0-9]$/).optional(),
  region: z.string().optional(),
  size: z.string().optional(),
  fullSetup: z.boolean().optional(),
  domain: z.string().optional(),
}).strict();

/**
 * Map a Zod issue to a user-friendly warning string.
 */
function formatZodIssue(issue: z.core.$ZodIssue, rawObj: Record<string, unknown>): string {
  const field = issue.path.length > 0 ? String(issue.path[issue.path.length - 1]) : "value";

  switch (issue.code) {
    case "invalid_value": {
      // Enum validation failure -- provide the invalidProviderError for provider
      const values = (issue as any).values as string[] | undefined;
      if (field === "provider" && values) {
        const received = rawObj.provider;
        if (typeof received === "string") {
          return invalidProviderError(received);
        }
        return `Invalid provider: expected ${values.map((v: string) => `"${v}"`).join(", ")}`;
      }
      if (field === "template" && values) {
        const received = rawObj.template;
        if (typeof received === "string") {
          return `Invalid template: "${received}". Use ${values.map((v: string) => `"${v}"`).join(", ")}.`;
        }
        return `Invalid template: expected ${values.map((v: string) => `"${v}"`).join(", ")}`;
      }
      return `Invalid ${field}: ${issue.message}`;
    }
    case "invalid_type":
      return `Invalid ${field}: expected ${(issue as any).expected}, received ${(issue as any).received ?? typeof issue.input}`;
    case "too_small":
      return `Invalid ${field}: must be at least ${(issue as any).minimum} characters`;
    case "too_big":
      return `Invalid ${field}: must be at most ${(issue as any).maximum} characters`;
    case "invalid_format":
      if (field === "name") {
        return "Invalid name: must start with a lowercase letter, end with a letter or number, and contain only lowercase letters, numbers, and hyphens";
      }
      return `Invalid ${field}: ${issue.message}`;
    case "unrecognized_keys": {
      const keys = (issue as any).keys as string[];
      // Filter out security keys -- they already get security-specific warnings from checkSecurityKeys()
      const nonSecurityKeys = keys.filter((k: string) => !SECURITY_KEYS.has(k.toLowerCase()));
      if (nonSecurityKeys.length === 0) return "";
      return nonSecurityKeys.map((k: string) => `Unknown config key: "${k}"`).join("\n");
    }
    default:
      return `Invalid ${field}: ${issue.message}`;
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

  // Security check: token fields (case-insensitive + nested) -- before Zod
  checkSecurityKeys(obj, warnings);

  // Run Zod validation
  const result = KastellYamlSchema.safeParse(raw);

  if (result.success) {
    // All fields valid
    const data = result.data;
    if (data.provider !== undefined) config.provider = data.provider;
    if (data.template !== undefined) config.template = data.template;
    if (data.name !== undefined) config.name = data.name;
    if (data.region !== undefined) config.region = data.region;
    if (data.size !== undefined) config.size = data.size;
    if (data.fullSetup !== undefined) config.fullSetup = data.fullSetup;
    if (data.domain !== undefined) config.domain = data.domain;
  } else {
    // Collect warnings from Zod issues
    const issueFields = new Set<string>();
    for (const issue of result.error.issues) {
      const warning = formatZodIssue(issue, obj);
      // unrecognized_keys returns newline-separated warnings; may be empty if all keys are security keys
      for (const line of warning.split("\n")) {
        if (line) warnings.push(line);
      }
      // Track which fields had errors
      if (issue.path.length > 0) {
        issueFields.add(String(issue.path[issue.path.length - 1]));
      }
      if (issue.code === "unrecognized_keys") {
        const keys = (issue as any).keys as string[];
        for (const k of keys) issueFields.add(k);
      }
    }

    // Build partial config from fields that didn't have errors
    // Parse each known field individually to get valid values
    const knownFields = ["provider", "template", "name", "region", "size", "fullSetup", "domain"] as const;
    for (const field of knownFields) {
      if (obj[field] !== undefined && !issueFields.has(field)) {
        const fieldSchema = KastellYamlSchema.shape[field];
        const fieldResult = fieldSchema.safeParse(obj[field]);
        if (fieldResult.success && fieldResult.data !== undefined) {
          (config as any)[field] = fieldResult.data;
        }
      }
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
