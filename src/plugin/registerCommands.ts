import type { Command } from "commander";
import type { PluginCommandEntry } from "./registry.js";
import { debugLog } from "../utils/logger.js";
import { resolvePluginHandler } from "./handlerResolver.js";

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
          const handler = await resolvePluginHandler(entry.pluginDir, entry.command.handler);
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