import inquirer from "inquirer";
import { promptList, validateRequired, validateScore, validateColonPair } from "./shared.js";
import { listAllProfileNames } from "../../core/audit/profiles.js";
import { isValidPort } from "../../core/firewall.js";

export async function promptFirewall(): Promise<string[] | null> {
  const sub = await promptList("Firewall action:", [
    { name: "Show current rules", value: "status" },
    { name: "Initial firewall setup", value: "setup" },
    { name: "Add a port rule", value: "add" },
    { name: "Remove a port rule", value: "remove" },
  ]);
  if (!sub) return null;

  if (sub === "add" || sub === "remove") {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "port",
        message: "Port number:",
        validate: (v: string) =>
          isValidPort(Number(v)) || "Enter a valid port (1-65535)",
      },
    ]);

    const protocol = await promptList("Protocol:", [
      { name: "TCP", value: "tcp" },
      { name: "UDP", value: "udp" },
    ]);
    if (!protocol) return null;

    return ["firewall", sub, "--port", answers.port, "--protocol", protocol];
  }

  return ["firewall", sub];
}

export async function promptSecure(): Promise<string[] | null> {
  const sub = await promptList("Security action:", [
    { name: "Harden SSH + install fail2ban", value: "setup" },
    { name: "Run security audit", value: "audit" },
    { name: "Show security status", value: "status" },
  ]);
  if (!sub) return null;
  return ["secure", sub];
}

export async function promptDomain(): Promise<string[] | null> {
  const sub = await promptList("Domain action:", [
    { name: "Show current domain info", value: "info" },
    { name: "List domains", value: "list" },
    { name: "Set a custom domain", value: "add" },
    { name: "Check DNS for a domain", value: "check" },
    { name: "Remove domain", value: "remove" },
  ]);
  if (!sub) return null;

  if (sub === "add" || sub === "check") {
    const { domain } = await inquirer.prompt([
      {
        type: "input",
        name: "domain",
        message: "Domain name (e.g. panel.example.com):",
        validate: (v: string) => (v.includes(".") ? true : "Enter a valid domain"),
      },
    ]);
    const args = ["domain", sub, "--domain", domain];
    if (sub === "add") {
      const { ssl } = await inquirer.prompt([
        { type: "confirm", name: "ssl", message: "Enable SSL (HTTPS)?", default: true },
      ]);
      if (!ssl) args.push("--no-ssl");
    }
    return args;
  }

  return ["domain", sub];
}

export async function promptAuth(): Promise<string[] | null> {
  const sub = await promptList("Auth action:", [
    { name: "List stored tokens", value: "list" },
    { name: "Store a provider token", value: "set" },
    { name: "Remove a provider token", value: "remove" },
  ]);
  if (!sub) return null;

  if (sub === "set" || sub === "remove") {
    const provider = await promptList("Provider:", [
      { name: "Hetzner Cloud", value: "hetzner" },
      { name: "DigitalOcean", value: "digitalocean" },
      { name: "Vultr", value: "vultr" },
      { name: "Linode", value: "linode" },
    ]);
    if (!provider) return null;
    return ["auth", sub, provider];
  }

  return ["auth", sub];
}

export async function promptAudit(): Promise<string[] | null> {
  const mode = await promptList("Audit mode:", [
    { name: "Run full audit", value: "run" },
    { name: "Run with --explain (show fixes)", value: "explain" },
    { name: "Compare two snapshots (diff)", value: "diff" },
    { name: "Interactive fix mode", value: "fix" },
    { name: "List all checks (no scan)", value: "list-checks" },
    { name: "Explain a specific check (deep-dive)", value: "explain-check" },
    { name: "Run with compliance profile", value: "profile" },
    { name: "Compliance framework report", value: "compliance" },
    { name: "Save snapshot", value: "snapshot" },
    { name: "List saved snapshots", value: "snapshots" },
    { name: "Compare two servers", value: "compare" },
    { name: "Score trend over time", value: "trend" },
    { name: "Watch mode (auto-refresh)", value: "watch" },
    { name: "Audit unregistered server by IP", value: "host" },
    { name: "CI gate (exit 1 if below threshold)", value: "threshold" },
    { name: "Generate report (HTML/Markdown)", value: "report" },
  ]);
  if (!mode) return null;

  if (mode === "explain") return ["audit", "--explain"];

  if (mode === "diff") {
    const { diffRef } = await inquirer.prompt([
      {
        type: "input",
        name: "diffRef",
        message: "Diff reference (e.g. pre-upgrade:latest or pre-upgrade:post-upgrade):",
        validate: validateColonPair("Format: before:after (e.g. pre-upgrade:latest)"),
      },
    ]);
    return ["audit", "--diff", diffRef];
  }

  if (mode === "fix") {
    const dryRun = await promptList("Fix mode:", [
      { name: "Execute fixes interactively", value: "live" },
      { name: "Dry run (show commands only)", value: "dry-run" },
    ]);
    if (!dryRun) return null;
    const args = ["audit", "--fix"];
    if (dryRun === "dry-run") args.push("--dry-run");
    return args;
  }

  if (mode === "list-checks") return ["audit", "--list-checks"];

  if (mode === "explain-check") {
    const { checkId } = await inquirer.prompt([
      {
        type: "input",
        name: "checkId",
        message: "Enter check ID (e.g. SSH-PASSWORD-AUTH):",
      },
    ]);
    if (!checkId?.trim()) return null;
    return ["explain", checkId.trim()];
  }

  if (mode === "snapshot") {
    const { snapName } = await inquirer.prompt([
      { type: "input", name: "snapName", message: "Snapshot name (leave empty for auto):", default: "" },
    ]);
    return snapName ? ["audit", "--snapshot", snapName] : ["audit", "--snapshot"];
  }

  if (mode === "snapshots") return ["audit", "--snapshots"];

  if (mode === "compare") {
    const { compareRef } = await inquirer.prompt([
      {
        type: "input",
        name: "compareRef",
        message: "Compare (server1:server2):",
        validate: validateColonPair("Format: server1:server2"),
      },
    ]);
    const compareMode = await promptList("Compare mode:", [
      { name: "Category summary (default)", value: "summary" },
      { name: "Check-level diff (detailed)", value: "detail" },
    ]);
    if (!compareMode) return null;
    const args = ["audit", "--compare", compareRef];
    if (compareMode === "detail") args.push("--detail");
    return args;
  }

  if (mode === "trend") {
    const days = await promptList("Time range:", [
      { name: "Last 7 days", value: "7" },
      { name: "Last 30 days", value: "30" },
      { name: "All time", value: "0" },
    ]);
    if (!days) return null;
    return days === "0" ? ["audit", "--trend"] : ["audit", "--trend", "--days", days];
  }

  if (mode === "watch") {
    const interval = await promptList("Refresh interval:", [
      { name: "30 seconds", value: "30" },
      { name: "60 seconds", value: "60" },
      { name: "300 seconds (5 min)", value: "300" },
    ]);
    if (!interval) return null;
    return ["audit", "--watch", interval];
  }

  if (mode === "host") {
    const { hostAddr } = await inquirer.prompt([
      {
        type: "input",
        name: "hostAddr",
        message: "Server address (user@ip):",
        validate: (v: string) => (v.includes("@") ? true : "Format: user@ip"),
      },
    ]);
    return ["audit", "--host", hostAddr];
  }

  if (mode === "threshold") {
    const { thresholdScore } = await inquirer.prompt([
      {
        type: "input",
        name: "thresholdScore",
        message: "Minimum score (exit 1 if below):",
        validate: validateScore,
      },
    ]);
    return ["audit", "--threshold", thresholdScore];
  }

  if (mode === "report") {
    const reportFormat = await promptList("Report format:", [
      { name: "Markdown (.md)", value: "md" },
      { name: "HTML (.html)", value: "html" },
    ]);
    if (!reportFormat) return null;
    return ["audit", "--report", reportFormat];
  }

  if (mode === "profile") {
    const profile = await promptList("Compliance profile:", [
      { name: "CIS Level 1 (essential)", value: "cis-level1" },
      { name: "CIS Level 2 (advanced)", value: "cis-level2" },
      { name: "PCI-DSS (payment)", value: "pci-dss" },
      { name: "HIPAA (healthcare)", value: "hipaa" },
    ]);
    if (!profile) return null;

    const format = await promptList("Output format:", [
      { name: "Dashboard summary", value: "summary" },
      { name: "JSON output", value: "json" },
      { name: "Score only", value: "score-only" },
    ]);
    if (!format) return null;

    const args = ["audit", "--profile", profile];
    if (format === "json") args.push("--json");
    else if (format === "score-only") args.push("--score-only");
    else args.push("--summary");
    return args;
  }

  if (mode === "compliance") {
    const { frameworks } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "frameworks",
        message: "Select compliance frameworks:",
        choices: [
          { name: "CIS Benchmark", value: "cis" },
          { name: "PCI-DSS", value: "pci-dss" },
          { name: "HIPAA", value: "hipaa" },
        ],
        validate: (v: string[]) => (v.length > 0 ? true : "Select at least one framework"),
      },
    ]);
    return ["audit", "--compliance", frameworks.join(",")];
  }

  // mode === "run" — standard audit
  const format = await promptList("Output format:", [
    { name: "Dashboard summary", value: "summary" },
    { name: "JSON output", value: "json" },
    { name: "Score only", value: "score-only" },
    { name: "SVG badge", value: "badge" },
    { name: "Show score trend", value: "trend" },
  ]);
  if (!format) return null;

  const args = ["audit"];
  if (format === "summary") args.push("--summary");
  else if (format === "json") args.push("--json");
  else if (format === "score-only") args.push("--score-only");
  else if (format === "badge") args.push("--badge");
  else if (format === "trend") args.push("--trend");

  // Optional category/severity filters (AUX-01, AUX-02)
  const filter = await promptList("Filter results?", [
    { name: "No filter (show all)", value: "none" },
    { name: "Filter by category", value: "category" },
    { name: "Filter by severity", value: "severity" },
    { name: "Filter by both", value: "both" },
  ]);
  if (!filter) return null;

  if (filter === "category" || filter === "both") {
    const TOP_CATEGORIES = [
      { name: "SSH", value: "ssh" },
      { name: "Firewall", value: "firewall" },
      { name: "Updates", value: "updates" },
      { name: "Auth", value: "auth" },
      { name: "Docker", value: "docker" },
      { name: "Network", value: "network" },
      { name: "Kernel", value: "kernel" },
      { name: "Logging", value: "logging" },
    ];
    const ALL_CATEGORIES = [
      ...TOP_CATEGORIES,
      { name: "Filesystem", value: "filesystem" },
      { name: "Accounts", value: "accounts" },
      { name: "Services", value: "services" },
      { name: "Boot", value: "boot" },
      { name: "Scheduling", value: "scheduling" },
      { name: "Time", value: "time" },
      { name: "Banners", value: "banners" },
      { name: "Crypto", value: "crypto" },
      { name: "File Integrity", value: "file integrity" },
      { name: "Malware", value: "malware" },
      { name: "MAC", value: "mac" },
      { name: "Memory", value: "memory" },
      { name: "Secrets", value: "secrets" },
      { name: "Cloud Metadata", value: "cloud metadata" },
      { name: "Supply Chain", value: "supply chain" },
      { name: "Backup Hygiene", value: "backup hygiene" },
      { name: "Resource Limits", value: "resource limits" },
      { name: "Incident Readiness", value: "incident readiness" },
      { name: "DNS Security", value: "dns security" },
    ];

    const category = await promptList("Category:", [
      ...TOP_CATEGORIES,
      { name: "Show all 31 categories...", value: "__all__" },
    ]);
    if (!category) return null;

    if (category === "__all__") {
      const fullCategory = await promptList("Category:", ALL_CATEGORIES);
      if (!fullCategory) return null;
      args.push("--category", fullCategory);
    } else {
      args.push("--category", category);
    }
  }

  if (filter === "severity" || filter === "both") {
    const severity = await promptList("Severity:", [
      { name: "Critical only", value: "critical" },
      { name: "Warning", value: "warning" },
      { name: "Info", value: "info" },
    ]);
    if (!severity) return null;
    args.push("--severity", severity);
  }

  return args;
}

export async function promptLock(): Promise<string[] | null> {
  const mode = await promptList("Lock mode:", [
    { name: "Dry run (preview changes)", value: "dry-run" },
    { name: "Apply production hardening", value: "production" },
    { name: "Apply production (skip confirmation)", value: "production-force" },
  ]);
  if (!mode) return null;

  const args = ["lock"];
  if (mode === "dry-run") args.push("--dry-run");
  else if (mode === "production-force") args.push("--production", "--force");
  else args.push("--production");
  return args;
}

export async function promptFix(): Promise<string[] | null> {
  const group = await promptList("Fix options:", [
    { name: "Apply fixes", value: "apply" },
    { name: "Fix history", value: "history" },
  ]);
  if (!group) return null;

  if (group === "apply") {
    const mode = await promptList("Apply mode:", [
      { name: "Dry run (preview safe fixes)", value: "dry-run" },
      { name: "Apply safe fixes (backup + fix + verify)", value: "apply" },
      { name: "Apply with profile filter", value: "profile" },
      { name: "Apply with category filter", value: "category" },
      { name: "Apply top N fixes by impact", value: "top" },
      { name: "Apply until target score", value: "target" },
      { name: "Apply with diff preview", value: "diff" },
      { name: "Apply and generate report", value: "report" },
    ]);
    if (!mode) return null;

    if (mode === "dry-run") return ["fix", "--safe", "--dry-run"];
    if (mode === "apply") return ["fix", "--safe"];
    if (mode === "diff") return ["fix", "--safe", "--diff"];
    if (mode === "report") return ["fix", "--safe", "--report"];

    if (mode === "profile") {
      const profileNames = listAllProfileNames();
      const choices = profileNames.map((p) => ({ name: p, value: p }));
      const profile = await promptList("Fix profile:", choices);
      if (!profile) return null;
      return ["fix", "--safe", "--profile", profile];
    }

    if (mode === "category") {
      const { cats } = await inquirer.prompt([{
        type: "input",
        name: "cats",
        message: "Category filter (comma-separated, e.g. Auth,Kernel):",
        validate: validateRequired("Enter at least one category"),
      }]);
      return ["fix", "--safe", "--category", cats];
    }

    if (mode === "top") {
      const { n } = await inquirer.prompt([{
        type: "input",
        name: "n",
        message: "Number of fixes to apply:",
        validate: (v: string) => {
          const num = Number(v);
          return num >= 1 && Number.isInteger(num) ? true : "Enter a positive integer";
        },
      }]);
      return ["fix", "--safe", "--top", n];
    }

    if (mode === "target") {
      const { score } = await inquirer.prompt([{
        type: "input",
        name: "score",
        message: "Target score (0-100):",
        validate: validateScore,
      }]);
      return ["fix", "--safe", "--target", score];
    }
  }

  if (group === "history") {
    const action = await promptList("History action:", [
      { name: "View fix history", value: "view" },
      { name: "Rollback a specific fix", value: "rollback" },
      { name: "Rollback all fixes", value: "rollback-all" },
      { name: "Rollback down to a specific fix", value: "rollback-to" },
    ]);
    if (!action) return null;

    if (action === "view") return ["fix", "--history"];
    if (action === "rollback-all") return ["fix", "--rollback-all"];

    if (action === "rollback-to") {
      const { fixId } = await inquirer.prompt([{
        type: "input",
        name: "fixId",
        message: "Rollback down to fix ID:",
        validate: validateRequired("Fix ID required"),
      }]);
      return ["fix", "--rollback-to", fixId];
    }

    if (action === "rollback") {
      const { fixId } = await inquirer.prompt([{
        type: "input",
        name: "fixId",
        message: "Fix ID (or 'last'):",
        validate: validateRequired("Fix ID required"),
      }]);
      return ["fix", "--rollback", fixId];
    }
  }

  return null;
}

export async function promptEvidence(): Promise<string[] | null> {
  const action = await promptList("Evidence collection:", [
    { name: "Collect with default label", value: "default" },
    { name: "Collect with custom label", value: "custom" },
    { name: "Collect (overwrite existing)", value: "force" },
    { name: "Collect (JSON manifest output)", value: "json" },
  ]);
  if (!action) return null;

  const args = ["evidence"];

  if (action === "force") args.push("--force");
  if (action === "json") args.push("--json");

  if (action === "custom") {
    const { name } = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Evidence label (e.g. pre-incident, weekly-check):",
        default: "manual",
      },
    ]);
    args.push("--name", name);
  } else {
    args.push("--name", "manual");
  }

  const options = await promptList("Collection options:", [
    { name: "Full collection (default)", value: "full" },
    { name: "Skip Docker data", value: "no-docker" },
    { name: "Skip system info", value: "no-sysinfo" },
    { name: "Skip Docker + system info", value: "no-both" },
  ]);
  if (!options) return null;

  if (options === "no-docker" || options === "no-both") args.push("--no-docker");
  if (options === "no-sysinfo" || options === "no-both") args.push("--no-sysinfo");

  const lines = await promptList("Log lines to collect:", [
    { name: "100 lines", value: "100" },
    { name: "500 lines (default)", value: "500" },
    { name: "1000 lines", value: "1000" },
  ]);
  if (!lines) return null;
  if (lines !== "500") args.push("--lines", lines);

  return args;
}
