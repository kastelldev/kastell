/**
 * Parse and display CHANGELOG.md content.
 * Supports: latest version, specific version, or full changelog.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import chalk from "chalk";

interface ChangelogEntry {
  version: string;
  date: string;
  content: string;
}

/** Walk up from a directory to find CHANGELOG.md (max 5 levels) */
function findChangelogFile(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "CHANGELOG.md");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Find and read CHANGELOG.md */
function readChangelog(): string | null {
  const filePath = findChangelogFile();
  if (!filePath) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Parse CHANGELOG.md into version entries */
export function parseChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let current: ChangelogEntry | null = null;
  const contentLines: string[] = [];

  for (const line of lines) {
    // Match ## [1.15.0] - 2026-03-27 or ## 1.15.0 or ## [1.15.0]
    const match = line.match(/^## \[?v?(\d+\.\d+\.\d+)\]?\s*(?:-\s*(.+))?$/);
    if (match) {
      if (current) {
        current.content = contentLines.join("\n").trim();
        entries.push(current);
        contentLines.length = 0;
      }
      current = {
        version: match[1],
        date: match[2]?.trim() || "",
        content: "",
      };
    } else if (current) {
      contentLines.push(line);
    }
  }

  if (current) {
    current.content = contentLines.join("\n").trim();
    entries.push(current);
  }

  return entries;
}

/** Format a single changelog entry with chalk colors */
function formatEntry(entry: ChangelogEntry): string {
  const header = entry.date
    ? chalk.green(`## v${entry.version} — ${entry.date}`)
    : chalk.green(`## v${entry.version}`);

  return `${header}\n\n${entry.content}`;
}

/** Display changelog: latest, specific version, or all */
export function displayChangelog(options: {
  version?: string;
  all?: boolean;
}): string | null {
  const raw = readChangelog();
  if (!raw) return null;

  const entries = parseChangelog(raw);
  if (entries.length === 0) return null;

  if (options.all) {
    return entries.map(formatEntry).join("\n\n---\n\n");
  }

  if (options.version) {
    const normalized = options.version.replace(/^v/, "");
    const entry = entries.find((e) => e.version === normalized);
    if (!entry) return `Version ${options.version} not found in changelog.`;
    return formatEntry(entry);
  }

  // Default: latest version
  return formatEntry(entries[0]);
}
