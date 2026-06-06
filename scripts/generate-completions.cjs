#!/usr/bin/env node
/**
 * scripts/generate-completions.cjs
 * Parses src/index.ts and regenerates completions in src/core/completions.ts.
 * Run: node scripts/generate-completions.cjs
 */
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = require("path");
const INDEX_PATH = path_1.resolve("src/index.ts");
const COMPLETIONS_PATH = path_1.resolve("src/core/completions.ts");
// Extract all .command('xxx') or .command("xxx") from index.ts
function extractCommands() {
    const content = fs_1.default.readFileSync(INDEX_PATH, "utf8");
    const lines = content.split("\n");
    const raw = new Set();
    for (const line of lines) {
        const m = line.match(/\.command\(['"]([^'"]+)['"]/);
        if (m) {
            raw.add(m[1]);
        }
    }
    // Strip argument hints: "status [query]" -> "status", "install <name>" -> "install"
    const commands = [];
    for (const r of raw) {
        const cmd = r.replace(/\s*\[.*\]|\s*<[^>]*>.*$/g, "");
        if (!commands.includes(cmd))
            commands.push(cmd);
    }
    return commands.sort();
}
// Alphabetical command list
const COMMANDS = extractCommands();
const BASH_COMMANDS = `"${COMMANDS.join(" ")}"`;
const ZSH_COMMANDS = COMMANDS.map(c => `    '${c}:${getDescription(c)}'`).join("\n");
const FISH_COMMANDS = COMMANDS.map(c => `complete -c kastell -n '__kastell_no_subcommand' -a '${c}' -d '${getDescription(c)}'`).join("\n");
function getDescription(cmd) {
    const descriptions = {
        add: "Add an existing server to management",
        auth: "Manage provider API tokens (OS keychain)",
        audit: "Run a security audit on a server",
        backup: "Backup Coolify database and config",
        bot: "Telegram bot management",
        changelog: "Show version changelog",
        completions: "Generate shell completion scripts",
        config: "Manage default configuration",
        destroy: "Destroy a registered server",
        doctor: "Check local environment and configuration",
        domain: "Manage server domain and SSL",
        evidence: "Collect forensic evidence package from a server",
        explain: "Explain a security check by ID",
        export: "Export server list to JSON",
        firewall: "Manage server firewall",
        fix: "Apply safe auto-fixes to a server",
        fleet: "Show health and security posture of all registered servers",
        guard: "Manage autonomous security monitoring daemon",
        health: "Check health of all registered servers",
        import: "Import servers from JSON",
        init: "Deploy a new Coolify instance on a cloud provider",
        install: "Install a plugin from npm registry",
        list: "List all registered servers",
        lock: "Harden server to production standard",
        logs: "View server logs",
        maintain: "Run full maintenance cycle",
        monitor: "Show server resource usage",
        notify: "Manage notification channels",
        plugin: "Manage kastell plugins",
        regression: "Manage regression baselines",
        remove: "Remove a server from local config",
        reset: "Reset regression baseline for a server",
        restart: "Restart a registered server",
        restore: "Restore Coolify from a backup",
        secure: "Manage server security",
        snapshot: "Manage server snapshots",
        ssh: "SSH into a registered server",
        start: "Start guard daemon on a server",
        status: "Check server and Coolify status",
        stop: "Stop guard daemon on a server",
        update: "Update Coolify on a registered server",
        validate: "Validate plugin manifest and entry point",
    };
    return descriptions[cmd] || cmd;
}
console.log("Extracted commands:", COMMANDS);
console.log("\nBash commands string:");
console.log(BASH_COMMANDS);
