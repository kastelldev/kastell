export const PLUGIN_NAME_PATTERN = /^kastell-plugin-[a-z0-9-]+$/;
export const FAILED_PLUGIN_PREFIX = "ERR";
export const PLUGIN_NAME_PREFIX = "kastell-plugin-";
export const PLUGIN_TOOL_PREFIX = "server_plugin_";

/**
 * Plugin manifest API version. Bumped from "1" to "2" in P140 (SDK-breaking).
 * Single source of truth for the `apiVersion` literal — both the TS interface
 * and the Zod schema derive from this constant so they cannot drift.
 */
export const PLUGIN_API_VERSION = "2" as const;
export type PluginApiVersion = typeof PLUGIN_API_VERSION;
