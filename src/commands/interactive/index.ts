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

export const ROOT_SEARCH_PAGE_SIZE = {
  min: 6,
  default: 12,
  max: 15,
  reservedRows: 6,
  minRowsForDescriptions: 24,
} as const;

export function getRootSearchPageSize(rows = process.stdout.rows): number {
  if (typeof rows !== "number" || !Number.isFinite(rows) || rows <= 0) {
    return ROOT_SEARCH_PAGE_SIZE.default;
  }

  const availableRows = Math.max(0, rows - ROOT_SEARCH_PAGE_SIZE.reservedRows);
  const candidate = Math.floor(availableRows * 0.6);
  return Math.min(ROOT_SEARCH_PAGE_SIZE.max, Math.max(ROOT_SEARCH_PAGE_SIZE.min, candidate));
}

export interface SearchSourceOptions {
  columns?: number;
  includeDescriptions?: boolean;
}

export function formatRootSearchDescription(
  description: string | undefined,
  options: SearchSourceOptions = {},
): string | undefined {
  if (!description || options.includeDescriptions === false) return undefined;

  const singleLine = description.replace(/\s+/g, " ").trim();
  if (singleLine.length === 0) return undefined;
  const columns = typeof options.columns === "number" && options.columns > 0 ? options.columns : process.stdout.columns;
  const maxLength = Math.max(24, Math.min(100, (columns ?? 80) - 3));

  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3).trimEnd()}...`;
}

function filterRootSearchChoices(choices: Choice[], term: string): Choice[] {
  const lower = term.toLowerCase();
  return choices.filter((c) => {
    if ("type" in c && c.type === "separator") return false;
    const choice = c as { name: string; value: string; description?: string };
    return (
      choice.name.toLowerCase().includes(lower) ||
      choice.value.toLowerCase().includes(lower) ||
      (choice.description?.toLowerCase().includes(lower) ?? false)
    );
  });
}

function ensureExitChoice(choices: Choice[]): Choice[] {
  if (choices.some((c) => "value" in c && c.value === "exit")) return choices;
  return [...choices, { name: chalk.dim("  Exit"), value: "exit" }];
}

function formatChoiceForRootSearchDisplay(
  choice: Choice,
  options: SearchSourceOptions,
): Choice {
  if (!("description" in choice)) return choice;
  return {
    ...choice,
    description: formatRootSearchDescription(choice.description, options),
  };
}

export function buildSearchSource(term: string | undefined, options: SearchSourceOptions = {}): Choice[] {
  const all = buildMainChoices();
  const matches = !term ? all : filterRootSearchChoices(all, term);
  const result = ensureExitChoice(matches);
  return result.map((choice) => formatChoiceForRootSearchDisplay(choice, options));
}

export async function interactiveMenu(): Promise<string[] | null> {
  for (;;) {
    const pageSize = getRootSearchPageSize();
    const columns = process.stdout.columns;
    const includeDescriptions = (process.stdout.rows ?? ROOT_SEARCH_PAGE_SIZE.default) >= ROOT_SEARCH_PAGE_SIZE.minRowsForDescriptions;

    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: "search",
        name: "action",
        message: "What would you like to do?",
        source: (term: string | undefined) => buildSearchSource(term, { columns, includeDescriptions }),
        pageSize,
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
