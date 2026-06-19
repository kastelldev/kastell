export const PLUGIN_NAME_PATTERN = /^kastell-plugin-[a-z0-9-]+$/;
export const FAILED_PLUGIN_PREFIX = "ERR";
export const PLUGIN_NAME_PREFIX = "kastell-plugin-";
export const PLUGIN_TOOL_PREFIX = "server_plugin_";

export const SUPPORTED_PLUGIN_API_VERSIONS = ["2", "3"] as const;
export const CURRENT_PLUGIN_API_VERSION = "3" as const;
export type PluginApiVersion = (typeof SUPPORTED_PLUGIN_API_VERSIONS)[number];

/** @deprecated Task 2 migration shim; remove after validation dispatch moves. */
export const PLUGIN_API_VERSION = "2" as const;
