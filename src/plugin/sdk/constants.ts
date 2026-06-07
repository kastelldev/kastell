export const PLUGIN_NAME_PATTERN = /^kastell-plugin-[a-z0-9-]+$/;
export const FAILED_PLUGIN_PREFIX = "ERR";
export const PLUGIN_NAME_PREFIX = "kastell-plugin-";
export const PLUGIN_TOOL_PREFIX = "server_plugin_";

export const PLUGIN_API_VERSION = "2" as const;
export type PluginApiVersion = typeof PLUGIN_API_VERSION;
