import inquirer from "inquirer";
import chalk from "chalk";

import { buildMainChoices, type Choice, SCHEDULE_COMMANDS } from "./menu.js";
import { promptInit, promptStatus, promptSsh, promptFleet } from "./server-management.js";
import { promptFirewall, promptSecure, promptDomain, promptAudit, promptLock, promptFix, promptEvidence, promptAuth } from "./security.js";
import { promptLogs, promptMonitor, promptDoctor, promptGuard } from "./monitoring.js";
import { promptBackup, promptSnapshot, promptMaintain, promptUpdate, promptNotify, promptCompletions, promptImport } from "./backup-maintenance.js";
import { promptPlugin } from "./plugins.js";

const SUB_PROMPTS: Record<string, () => Promise<string[] | null>> = {
  init: promptInit,
  auth: promptAuth,
  logs: promptLogs,
  firewall: promptFirewall,
  secure: promptSecure,
  domain: promptDomain,
  snapshot: promptSnapshot,
  monitor: promptMonitor,
  maintain: promptMaintain,
  status: promptStatus,
  update: promptUpdate,
  doctor: promptDoctor,
  ssh: promptSsh,
  backup: promptBackup,
  import: promptImport,
  audit: promptAudit,
  lock: promptLock,
  fix: promptFix,
  evidence: promptEvidence,
  guard: promptGuard,
  fleet: promptFleet,
  notify: promptNotify,
  completions: promptCompletions,
  plugin: promptPlugin,
};

const DIRECT_COMMANDS = new Set([
  "list", "add", "destroy", "restart", "remove", "restore", "export", "config",
  "health", "backup-list", "version", "changelog",
  "regression-status", "regression-reset",
]);

export function buildSearchSource(term: string | undefined): Choice[] {
  const all = buildMainChoices();
  if (!term) return all;

  const lower = term.toLowerCase();
  const filtered = all.filter((c) => {
    if ("type" in c && c.type === "separator") return false;
    const choice = c as { name: string; value: string; description?: string };
    return (
      choice.name.toLowerCase().includes(lower) ||
      choice.value.toLowerCase().includes(lower) ||
      (choice.description?.toLowerCase().includes(lower) ?? false)
    );
  });

  if (!filtered.some((c) => "value" in c && c.value === "exit")) {
    filtered.push({ name: chalk.dim("  Exit"), value: "exit" });
  }

  return filtered;
}

export async function interactiveMenu(): Promise<string[] | null> {
  for (;;) {
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: "search",
        name: "action",
        message: "What would you like to do?",
        source: buildSearchSource,
        pageSize: 25,
      },
    ]);

    if (action === "exit") return null;

    if (action === "backup-list") return ["backup", "list"];
    if (action === "regression-status") return ["regression", "status"];
    if (action === "regression-reset") return ["regression", "reset"];
    if (action === "bot") return ["bot", "start"];
    if (action in SCHEDULE_COMMANDS) return ["schedule", SCHEDULE_COMMANDS[action]];

    if (DIRECT_COMMANDS.has(action)) {
      return [action];
    }

    const promptFn = SUB_PROMPTS[action];
    if (promptFn) {
      const result = await promptFn();
      if (result === null) continue;
      return result;
    }

    return [action];
  }
}
