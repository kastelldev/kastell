import type { Command } from "commander";
import type { PluginCommandEntry } from "./registry.js";
import { debugLog } from "../utils/logger.js";
import { resolve } from "path";
import { pathToFileURL } from "url";

export function registerPluginCommands(
  program: Command,
  entries: PluginCommandEntry[],
): number {
  if (entries.length === 0) return 0;

  // Dynamic collision check — no static list needed, program.commands is authoritative
  const existingNames = new Set(program.commands.map(c => c.name()));
  const grouped = new Map<string, PluginCommandEntry[]>();

  for (const entry of entries) {
    const group = grouped.get(entry.pluginShortName) ?? [];
    group.push(entry);
    grouped.set(entry.pluginShortName, group);
  }

  let count = 0;
  for (const [shortName, cmds] of grouped) {
    if (existingNames.has(shortName)) {
      debugLog?.(`plugin command "${shortName}" collides with built-in command, skipping`);
      continue;
    }

    const pluginCmd = program
      .command(shortName)
      .description(`[plugin] ${cmds[0].pluginShortName} commands`);

    for (const entry of cmds) {
      pluginCmd
        .command(entry.command.name)
        .description(entry.command.description)
        .action(async (...args: unknown[]) => {
          const handlerPath = resolve(entry.pluginDir, entry.command.handler);
          const handlerUrl = pathToFileURL(handlerPath).href;
          const mod = await import(handlerUrl);
          const handler = (typeof mod.default === "function" ? mod.default : mod.default?.handler) ?? mod.handler ?? mod.run;
          if (typeof handler !== "function") {
            throw new Error(`Plugin command handler not found: ${entry.command.handler}`);
          }
          // Pass Commander args + PluginContext — ssh stub until P135 wires real SSH
          await handler(args[args.length - 1] ?? {}, {
            logger: {
              info: (msg: string) => console.log(msg),
              warn: (msg: string) => console.warn(msg),
              error: (msg: string) => console.error(msg),
            },
            ssh: async () => {
              throw new Error("SSH not available in CLI plugin context — use kastell audit/fix for SSH operations");
            },
          });
        });
      count++;
    }
  }

  return count;
}