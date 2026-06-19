import semver from "semver";
import { PLUGIN_NAME_PATTERN } from "./sdk/constants.js";

export interface FailedPluginDescriptor {
  name: string;
  version?: string;
  checkPrefix?: string;
  declaredApiVersion?: string;
}

export function toFailedPluginDescriptor(
  directoryName: string,
  parsed?: unknown,
): FailedPluginDescriptor {
  const value =
    parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  const name =
    typeof value.name === "string" && PLUGIN_NAME_PATTERN.test(value.name)
      ? value.name
      : directoryName;
  return {
    name,
    ...(typeof value.version === "string" && semver.valid(value.version)
      ? { version: value.version }
      : {}),
    ...(typeof value.checkPrefix === "string" &&
        /^[A-Z]{2,6}$/.test(value.checkPrefix)
      ? { checkPrefix: value.checkPrefix }
      : {}),
    ...(typeof value.apiVersion === "string"
      ? { declaredApiVersion: value.apiVersion }
      : {}),
  };
}