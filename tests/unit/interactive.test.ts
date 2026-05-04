import inquirer from "inquirer";
import { interactiveMenu, buildSearchSource } from "../../src/commands/interactive/index.js";

jest.mock("inquirer");

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

describe("buildSearchSource", () => {
  it("returns all choices including Separators and Exit when term is undefined", () => {
    const choices = buildSearchSource(undefined);
    expect(choices.length).toBeGreaterThan(10);
    // Should include separators
    const hasSeparator = choices.some((c: unknown) => typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "separator");
    expect(hasSeparator).toBe(true);
    // Should include exit
    const hasExit = choices.some((c: unknown) => typeof c === "object" && c !== null && "value" in c && (c as { value: string }).value === "exit");
    expect(hasExit).toBe(true);
  });

  it("returns all choices when term is empty string", () => {
    const all = buildSearchSource(undefined);
    const empty = buildSearchSource("");
    expect(empty.length).toBe(all.length);
  });

  it("returns only matching choices plus Exit when term matches (no Separators)", () => {
    const choices = buildSearchSource("deploy");
    // Should match "Deploy a new server"
    expect(choices.some((c: unknown) => typeof c === "object" && c !== null && "value" in c && (c as { value: string }).value === "init")).toBe(true);
    // Should NOT include separators
    const hasSeparator = choices.some((c: unknown) => typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "separator");
    expect(hasSeparator).toBe(false);
    // Exit always present
    expect(choices.some((c: unknown) => typeof c === "object" && c !== null && "value" in c && (c as { value: string }).value === "exit")).toBe(true);
  });

  it("returns only Exit when no matches found", () => {
    const choices = buildSearchSource("xyz-nonexistent");
    expect(choices.length).toBe(1);
    expect((choices[0] as { value: string }).value).toBe("exit");
  });

  it("matches by value field", () => {
    const choices = buildSearchSource("init");
    expect(choices.some((c: unknown) => typeof c === "object" && c !== null && "value" in c && (c as { value: string }).value === "init")).toBe(true);
  });

  it("matches by description field", () => {
    const choices = buildSearchSource("provision");
    // "Provision a VPS on Hetzner..." is the description for init
    expect(choices.some((c: unknown) => typeof c === "object" && c !== null && "value" in c && (c as { value: string }).value === "init")).toBe(true);
  });

  it("matches auth by value", () => {
    const choices = buildSearchSource("auth");
    expect(choices.some((c: unknown) => typeof c === "object" && c !== null && "value" in c && (c as { value: string }).value === "auth")).toBe(true);
  });

  it("matches auth by description (keychain)", () => {
    const choices = buildSearchSource("keychain");
    expect(choices.some((c: unknown) => typeof c === "object" && c !== null && "value" in c && (c as { value: string }).value === "auth")).toBe(true);
  });

  it("matches case-insensitively", () => {
    const choices = buildSearchSource("BACKUP");
    expect(choices.some((c: unknown) => typeof c === "object" && c !== null && "value" in c && (c as { value: string }).value === "backup")).toBe(true);
  });
});

describe("interactiveMenu", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Main menu ──────────────────────────────────────────────────────────────

  it("returns null when exit is selected", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "exit" });
    expect(await interactiveMenu()).toBeNull();
  });

  it.each(["list", "add", "destroy", "restart", "remove", "restore", "export", "config"])(
    "returns [%s] for direct command",
    async (cmd) => {
      mockedInquirer.prompt.mockResolvedValueOnce({ action: cmd });
      expect(await interactiveMenu()).toEqual([cmd]);
    },
  );

  // ─── Back button returns to main menu ───────────────────────────────────────

  it("returns to main menu when back is selected in sub-prompt, then exit", async () => {
    // First: select "secure", sub-prompt returns back
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "secure" }) // main menu
      .mockResolvedValueOnce({ answer: "__BACK__" }) // secure sub-prompt → back
      .mockResolvedValueOnce({ action: "exit" }); // main menu again → exit

    expect(await interactiveMenu()).toBeNull();
    expect(mockedInquirer.prompt).toHaveBeenCalledTimes(3);
  });

  it("returns to main menu when back is selected, then picks direct command", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "logs" }) // main menu
      .mockResolvedValueOnce({ answer: "__BACK__" }) // logs sub → back
      .mockResolvedValueOnce({ action: "list" }); // main menu → direct

    expect(await interactiveMenu()).toEqual(["list"]);
  });

  // ─── Init sub-prompt ────────────────────────────────────────────────────────

  it("init: returns full args with --full-setup", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "init" })
      .mockResolvedValueOnce({ answer: "bare" }) // mode
      .mockResolvedValueOnce({ answer: "production" }) // template
      .mockResolvedValueOnce({ fullSetup: true });

    expect(await interactiveMenu()).toEqual([
      "init", "--mode", "bare", "--template", "production", "--full-setup",
    ]);
  });

  it("init: returns args without --full-setup when declined", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "init" })
      .mockResolvedValueOnce({ answer: "coolify" })
      .mockResolvedValueOnce({ answer: "starter" })
      .mockResolvedValueOnce({ fullSetup: false });

    expect(await interactiveMenu()).toEqual([
      "init", "--mode", "coolify", "--template", "starter",
    ]);
  });

  it("init: back on mode returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "init" })
      .mockResolvedValueOnce({ answer: "__BACK__" }) // mode → back
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  it("init: back on template returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "init" })
      .mockResolvedValueOnce({ answer: "coolify" }) // mode
      .mockResolvedValueOnce({ answer: "__BACK__" }) // template → back
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  // ─── Logs sub-prompt ────────────────────────────────────────────────────────

  it("logs: returns full args with --follow", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "logs" })
      .mockResolvedValueOnce({ answer: "docker" })
      .mockResolvedValueOnce({ answer: "100" })
      .mockResolvedValueOnce({ follow: true });

    expect(await interactiveMenu()).toEqual([
      "logs", "--service", "docker", "--lines", "100", "--follow",
    ]);
  });

  it("logs: returns args without --follow", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "logs" })
      .mockResolvedValueOnce({ answer: "system" })
      .mockResolvedValueOnce({ answer: "50" })
      .mockResolvedValueOnce({ follow: false });

    expect(await interactiveMenu()).toEqual([
      "logs", "--service", "system", "--lines", "50",
    ]);
  });

  it("logs: back on service returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "logs" })
      .mockResolvedValueOnce({ answer: "__BACK__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  it("logs: back on lines returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "logs" })
      .mockResolvedValueOnce({ answer: "coolify" })
      .mockResolvedValueOnce({ answer: "__BACK__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  // ─── Firewall sub-prompt ────────────────────────────────────────────────────

  it("firewall: returns simple subcommand (status)", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "firewall" })
      .mockResolvedValueOnce({ answer: "status" });

    expect(await interactiveMenu()).toEqual(["firewall", "status"]);
  });

  it("firewall: returns add with port and protocol", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "firewall" })
      .mockResolvedValueOnce({ answer: "add" })
      .mockResolvedValueOnce({ port: "8080" }) // port input
      .mockResolvedValueOnce({ answer: "tcp" }); // protocol

    expect(await interactiveMenu()).toEqual([
      "firewall", "add", "--port", "8080", "--protocol", "tcp",
    ]);
  });

  it("firewall: back on subcommand returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "firewall" })
      .mockResolvedValueOnce({ answer: "__BACK__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  it("firewall: back on protocol returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "firewall" })
      .mockResolvedValueOnce({ answer: "remove" })
      .mockResolvedValueOnce({ port: "443" })
      .mockResolvedValueOnce({ answer: "__BACK__" }) // protocol → back
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  // ─── Secure sub-prompt ──────────────────────────────────────────────────────

  it("secure: returns subcommand", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "secure" })
      .mockResolvedValueOnce({ answer: "audit" });

    expect(await interactiveMenu()).toEqual(["secure", "audit"]);
  });

  it("secure: back returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "secure" })
      .mockResolvedValueOnce({ answer: "__BACK__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  // ─── Domain sub-prompt ──────────────────────────────────────────────────────

  it("domain: returns info subcommand", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "domain" })
      .mockResolvedValueOnce({ answer: "info" });

    expect(await interactiveMenu()).toEqual(["domain", "info"]);
  });

  it("domain: returns add with domain and ssl", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "domain" })
      .mockResolvedValueOnce({ answer: "add" })
      .mockResolvedValueOnce({ domain: "panel.example.com" })
      .mockResolvedValueOnce({ ssl: true });

    expect(await interactiveMenu()).toEqual([
      "domain", "add", "--domain", "panel.example.com",
    ]);
  });

  it("domain: returns add with --no-ssl", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "domain" })
      .mockResolvedValueOnce({ answer: "add" })
      .mockResolvedValueOnce({ domain: "panel.example.com" })
      .mockResolvedValueOnce({ ssl: false });

    expect(await interactiveMenu()).toEqual([
      "domain", "add", "--domain", "panel.example.com", "--no-ssl",
    ]);
  });

  it("domain: returns check with domain", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "domain" })
      .mockResolvedValueOnce({ answer: "check" })
      .mockResolvedValueOnce({ domain: "test.example.com" });

    expect(await interactiveMenu()).toEqual([
      "domain", "check", "--domain", "test.example.com",
    ]);
  });

  it("domain: back returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "domain" })
      .mockResolvedValueOnce({ answer: "__BACK__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  // ─── Snapshot sub-prompt ────────────────────────────────────────────────────

  it("snapshot: returns subcommand", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "snapshot" })
      .mockResolvedValueOnce({ answer: "create" });

    expect(await interactiveMenu()).toEqual(["snapshot", "create"]);
  });

  it("snapshot: back returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "snapshot" })
      .mockResolvedValueOnce({ answer: "__BACK__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  // ─── Monitor sub-prompt ─────────────────────────────────────────────────────

  it("monitor: returns with --containers", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "monitor" })
      .mockResolvedValueOnce({ answer: "containers" });

    expect(await interactiveMenu()).toEqual(["monitor", "--containers"]);
  });

  it("monitor: returns without --containers", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "monitor" })
      .mockResolvedValueOnce({ answer: "basic" });

    expect(await interactiveMenu()).toEqual(["monitor"]);
  });

  // ─── Maintain sub-prompt ────────────────────────────────────────────────────

  it("maintain: returns with --skip-reboot", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "maintain" })
      .mockResolvedValueOnce({ answer: "skip-reboot" });

    expect(await interactiveMenu()).toEqual(["maintain", "--skip-reboot"]);
  });

  it("maintain: returns without --skip-reboot", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "maintain" })
      .mockResolvedValueOnce({ answer: "full" });

    expect(await interactiveMenu()).toEqual(["maintain"]);
  });

  // ─── Status sub-prompt ──────────────────────────────────────────────────────

  it("status: returns with --all", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "status" })
      .mockResolvedValueOnce({ answer: "all" });

    expect(await interactiveMenu()).toEqual(["status", "--all"]);
  });

  it("status: returns without --all", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "status" })
      .mockResolvedValueOnce({ answer: "single" });

    expect(await interactiveMenu()).toEqual(["status"]);
  });

  // ─── Update sub-prompt ──────────────────────────────────────────────────────

  it("update: returns with --all", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "update" })
      .mockResolvedValueOnce({ answer: "all" });

    expect(await interactiveMenu()).toEqual(["update", "--all"]);
  });

  it("update: returns without --all", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "update" })
      .mockResolvedValueOnce({ answer: "single" });

    expect(await interactiveMenu()).toEqual(["update"]);
  });

  // ─── Doctor sub-prompt ──────────────────────────────────────────────────────

  it("doctor: returns with --fresh", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "doctor" })
      .mockResolvedValueOnce({ answer: "fresh" });

    expect(await interactiveMenu()).toEqual(["doctor", "--fresh"]);
  });

  it("doctor: returns without --fresh", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "doctor" })
      .mockResolvedValueOnce({ answer: "cached" });

    expect(await interactiveMenu()).toEqual(["doctor"]);
  });

  // ─── SSH sub-prompt ─────────────────────────────────────────────────────────

  it("ssh: returns interactive session", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "ssh" })
      .mockResolvedValueOnce({ answer: "interactive" });

    expect(await interactiveMenu()).toEqual(["ssh"]);
  });

  it("ssh: returns single command", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "ssh" })
      .mockResolvedValueOnce({ answer: "command" })
      .mockResolvedValueOnce({ command: "uptime" });

    expect(await interactiveMenu()).toEqual(["ssh", "--command", "uptime"]);
  });

  it("ssh: back returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "ssh" })
      .mockResolvedValueOnce({ answer: "__BACK__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  // ─── Backup sub-prompt ──────────────────────────────────────────────────────

  it("backup: returns with --all via sub-menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "backup" })
      .mockResolvedValueOnce({ answer: "all" });

    expect(await interactiveMenu()).toEqual(["backup", "--all"]);
  });

  it("backup: returns create via sub-menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "backup" })
      .mockResolvedValueOnce({ answer: "create" });

    expect(await interactiveMenu()).toEqual(["backup"]);
  });

  // ─── Import sub-prompt ──────────────────────────────────────────────────────

  it("import: returns with path", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "import" })
      .mockResolvedValueOnce({ answer: "file" })
      .mockResolvedValueOnce({ path: "./servers.json" });

    expect(await interactiveMenu()).toEqual(["import", "./servers.json"]);
  });

  // ─── Auth sub-prompt ──────────────────────────────────────────────────────

  it("auth: returns list subcommand", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "auth" })
      .mockResolvedValueOnce({ answer: "list" });

    expect(await interactiveMenu()).toEqual(["auth", "list"]);
  });

  it("auth: returns set with provider", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "auth" })
      .mockResolvedValueOnce({ answer: "set" })
      .mockResolvedValueOnce({ answer: "hetzner" });

    expect(await interactiveMenu()).toEqual(["auth", "set", "hetzner"]);
  });

  it("auth: returns remove with provider", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "auth" })
      .mockResolvedValueOnce({ answer: "remove" })
      .mockResolvedValueOnce({ answer: "digitalocean" });

    expect(await interactiveMenu()).toEqual(["auth", "remove", "digitalocean"]);
  });

  it("auth: back on action returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "auth" })
      .mockResolvedValueOnce({ answer: "__BACK__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  it("auth: back on provider returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "auth" })
      .mockResolvedValueOnce({ answer: "set" })
      .mockResolvedValueOnce({ answer: "__BACK__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  // ─── Health (no sub-prompt, falls through) ──────────────────────────────────

  it("health: returns as fallthrough command", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "health" });
    // health has a sub-prompt (no options needed beyond server select)
    // but it's not in DIRECT_COMMANDS, so it goes to SUB_PROMPTS
    // health is not in SUB_PROMPTS either, so it falls through
    expect(await interactiveMenu()).toEqual(["health"]);
  });

  // ─── Schedule commands (compound mapping) ────────────────────────────────────

  it("schedule-fix: returns ['schedule', 'fix']", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "schedule-fix" });
    expect(await interactiveMenu()).toEqual(["schedule", "fix"]);
  });

  it("schedule-audit: returns ['schedule', 'audit']", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "schedule-audit" });
    expect(await interactiveMenu()).toEqual(["schedule", "audit"]);
  });

  it("schedule-list: returns ['schedule', 'list']", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "schedule-list" });
    expect(await interactiveMenu()).toEqual(["schedule", "list"]);
  });

  it("schedule-remove: returns ['schedule', 'remove']", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "schedule-remove" });
    expect(await interactiveMenu()).toEqual(["schedule", "remove"]);
  });
});

// ─── buildSearchSource — schedule items ────────────────────────────────────────

describe("buildSearchSource — schedule items", () => {
  it("matches schedule-fix by search term 'schedule'", () => {
    const choices = buildSearchSource("schedule");
    expect(choices.some((c: unknown) => typeof c === "object" && c !== null && "value" in c && (c as { value: string }).value === "schedule-fix")).toBe(true);
    expect(choices.some((c: unknown) => typeof c === "object" && c !== null && "value" in c && (c as { value: string }).value === "schedule-audit")).toBe(true);
  });

  it("matches schedule-fix by description 'cron'", () => {
    const choices = buildSearchSource("cron");
    expect(choices.some((c: unknown) => typeof c === "object" && c !== null && "value" in c && (c as { value: string }).value === "schedule-fix")).toBe(true);
  });
});

// ─── promptFix — nested menu ─────────────────────────────────────────────────

describe("promptFix — nested menu", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("apply dry-run: returns ['fix', '--safe', '--dry-run']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })   // main menu selects fix
      .mockResolvedValueOnce({ answer: "apply" }) // group: Apply fixes
      .mockResolvedValueOnce({ answer: "dry-run" }); // mode: dry-run

    expect(await interactiveMenu()).toEqual(["fix", "--safe", "--dry-run"]);
  });

  it("apply: returns ['fix', '--safe']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "apply" })
      .mockResolvedValueOnce({ answer: "apply" });

    expect(await interactiveMenu()).toEqual(["fix", "--safe"]);
  });

  it("apply profile web-server: returns ['fix', '--safe', '--profile', 'web-server']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "apply" })
      .mockResolvedValueOnce({ answer: "profile" })
      .mockResolvedValueOnce({ answer: "web-server" });

    expect(await interactiveMenu()).toEqual(["fix", "--safe", "--profile", "web-server"]);
  });

  it("apply top 5: returns ['fix', '--safe', '--top', '5']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "apply" })
      .mockResolvedValueOnce({ answer: "top" })
      .mockResolvedValueOnce({ n: "5" });

    expect(await interactiveMenu()).toEqual(["fix", "--safe", "--top", "5"]);
  });

  it("apply target 80: returns ['fix', '--safe', '--target', '80']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "apply" })
      .mockResolvedValueOnce({ answer: "target" })
      .mockResolvedValueOnce({ score: "80" });

    expect(await interactiveMenu()).toEqual(["fix", "--safe", "--target", "80"]);
  });

  it("history view: returns ['fix', '--history']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "history" })
      .mockResolvedValueOnce({ answer: "view" });

    expect(await interactiveMenu()).toEqual(["fix", "--history"]);
  });

  it("history rollback specific: returns ['fix', '--rollback', 'last']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "history" })
      .mockResolvedValueOnce({ answer: "rollback" })
      .mockResolvedValueOnce({ fixId: "last" });

    expect(await interactiveMenu()).toEqual(["fix", "--rollback", "last"]);
  });

  it("history rollback-all: returns ['fix', '--rollback-all']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "history" })
      .mockResolvedValueOnce({ answer: "rollback-all" });

    expect(await interactiveMenu()).toEqual(["fix", "--rollback-all"]);
  });

  it("back at group level: returns null", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "__BACK__" }) // promptList returns null
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  it("back at apply mode level: returns null", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "apply" })
      .mockResolvedValueOnce({ answer: "__BACK__" }) // promptList returns null
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  it("back at history action level: returns null", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "history" })
      .mockResolvedValueOnce({ answer: "__BACK__" }) // promptList returns null
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  it("apply with category filter: returns ['fix', '--safe', '--category', 'Auth']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "apply" })
      .mockResolvedValueOnce({ answer: "category" })
      .mockResolvedValueOnce({ cats: "Auth" });

    expect(await interactiveMenu()).toEqual(["fix", "--safe", "--category", "Auth"]);
  });

  it("apply with diff: returns ['fix', '--safe', '--diff']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "apply" })
      .mockResolvedValueOnce({ answer: "diff" });

    expect(await interactiveMenu()).toEqual(["fix", "--safe", "--diff"]);
  });

  it("apply with report: returns ['fix', '--safe', '--report']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "apply" })
      .mockResolvedValueOnce({ answer: "report" });

    expect(await interactiveMenu()).toEqual(["fix", "--safe", "--report"]);
  });

  it("history rollback-to: returns ['fix', '--rollback-to', 'fix-2026-04-01-001']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fix" })
      .mockResolvedValueOnce({ answer: "history" })
      .mockResolvedValueOnce({ answer: "rollback-to" })
      .mockResolvedValueOnce({ fixId: "fix-2026-04-01-001" });

    expect(await interactiveMenu()).toEqual(["fix", "--rollback-to", "fix-2026-04-01-001"]);
  });
});

// ─── New prompt functions — audit extras ─────────────────────────────────────

describe("promptAudit — new modes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("snapshot with name: returns ['audit', '--snapshot', 'pre-upgrade']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "audit" })
      .mockResolvedValueOnce({ answer: "snapshot" })
      .mockResolvedValueOnce({ snapName: "pre-upgrade" });

    expect(await interactiveMenu()).toEqual(["audit", "--snapshot", "pre-upgrade"]);
  });

  it("snapshots list: returns ['audit', '--snapshots']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "audit" })
      .mockResolvedValueOnce({ answer: "snapshots" });

    expect(await interactiveMenu()).toEqual(["audit", "--snapshots"]);
  });

  it("compare: returns ['audit', '--compare', 'srv1:srv2']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "audit" })
      .mockResolvedValueOnce({ answer: "compare" })
      .mockResolvedValueOnce({ compareRef: "srv1:srv2" })
      .mockResolvedValueOnce({ answer: "summary" });

    expect(await interactiveMenu()).toEqual(["audit", "--compare", "srv1:srv2"]);
  });

  it("trend 7 days: returns ['audit', '--trend', '--days', '7']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "audit" })
      .mockResolvedValueOnce({ answer: "trend" })
      .mockResolvedValueOnce({ answer: "7" });

    expect(await interactiveMenu()).toEqual(["audit", "--trend", "--days", "7"]);
  });

  it("trend all time: returns ['audit', '--trend']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "audit" })
      .mockResolvedValueOnce({ answer: "trend" })
      .mockResolvedValueOnce({ answer: "0" });

    expect(await interactiveMenu()).toEqual(["audit", "--trend"]);
  });

  it("watch 60s: returns ['audit', '--watch', '60']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "audit" })
      .mockResolvedValueOnce({ answer: "watch" })
      .mockResolvedValueOnce({ answer: "60" });

    expect(await interactiveMenu()).toEqual(["audit", "--watch", "60"]);
  });

  it("host: returns ['audit', '--host', 'root@1.2.3.4']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "audit" })
      .mockResolvedValueOnce({ answer: "host" })
      .mockResolvedValueOnce({ hostAddr: "root@1.2.3.4" });

    expect(await interactiveMenu()).toEqual(["audit", "--host", "root@1.2.3.4"]);
  });

  it("threshold: returns ['audit', '--threshold', '70']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "audit" })
      .mockResolvedValueOnce({ answer: "threshold" })
      .mockResolvedValueOnce({ thresholdScore: "70" });

    expect(await interactiveMenu()).toEqual(["audit", "--threshold", "70"]);
  });

  it("report md: returns ['audit', '--report', 'md']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "audit" })
      .mockResolvedValueOnce({ answer: "report" })
      .mockResolvedValueOnce({ answer: "md" });

    expect(await interactiveMenu()).toEqual(["audit", "--report", "md"]);
  });
});

// ─── New prompt functions — other commands ───────────────────────────────────

describe("New prompt additions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("doctor check-tokens: returns ['doctor', '--check-tokens']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "doctor" })
      .mockResolvedValueOnce({ answer: "check-tokens" });

    expect(await interactiveMenu()).toEqual(["doctor", "--check-tokens"]);
  });

  it("doctor json: returns ['doctor', '--fresh', '--json']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "doctor" })
      .mockResolvedValueOnce({ answer: "json" });

    expect(await interactiveMenu()).toEqual(["doctor", "--fresh", "--json"]);
  });

  it("lock production-force: returns ['lock', '--production', '--force']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "lock" })
      .mockResolvedValueOnce({ answer: "production-force" });

    expect(await interactiveMenu()).toEqual(["lock", "--production", "--force"]);
  });

  it("maintain all: returns ['maintain', '--all']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "maintain" })
      .mockResolvedValueOnce({ answer: "all" });

    expect(await interactiveMenu()).toEqual(["maintain", "--all"]);
  });

  it("maintain dry-run: returns ['maintain', '--dry-run']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "maintain" })
      .mockResolvedValueOnce({ answer: "dry-run" });

    expect(await interactiveMenu()).toEqual(["maintain", "--dry-run"]);
  });

  it("status autostart: returns ['status', '--autostart']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "status" })
      .mockResolvedValueOnce({ answer: "autostart" });

    expect(await interactiveMenu()).toEqual(["status", "--autostart"]);
  });

  it("snapshot list-all: returns ['snapshot', 'list', '--all']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "snapshot" })
      .mockResolvedValueOnce({ answer: "list-all" });

    expect(await interactiveMenu()).toEqual(["snapshot", "list", "--all"]);
  });

  it("fleet json: returns ['fleet', '--json']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fleet" })
      .mockResolvedValueOnce({ answer: "json" });

    expect(await interactiveMenu()).toEqual(["fleet", "--json"]);
  });

  it("fleet sort by score: returns ['fleet', '--sort', 'score']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "fleet" })
      .mockResolvedValueOnce({ answer: "sort-score" });

    expect(await interactiveMenu()).toEqual(["fleet", "--sort", "score"]);
  });

  it("backup dry-run: returns ['backup', '--dry-run']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "backup" })
      .mockResolvedValueOnce({ answer: "dry-run" });

    expect(await interactiveMenu()).toEqual(["backup", "--dry-run"]);
  });

  it("backup schedule list: returns ['backup', '--schedule', 'list']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "backup" })
      .mockResolvedValueOnce({ answer: "schedule" })
      .mockResolvedValueOnce({ answer: "list" });

    expect(await interactiveMenu()).toEqual(["backup", "--schedule", "list"]);
  });

  it("backup schedule set cron: returns ['backup', '--schedule', '0 2 * * *']", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "backup" })
      .mockResolvedValueOnce({ answer: "schedule" })
      .mockResolvedValueOnce({ answer: "set" })
      .mockResolvedValueOnce({ cron: "0 2 * * *" });

    expect(await interactiveMenu()).toEqual(["backup", "--schedule", "0 2 * * *"]);
  });

  it("evidence force with full collection: returns ['evidence', '--force', ...]", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "evidence" })
      .mockResolvedValueOnce({ answer: "force" })
      .mockResolvedValueOnce({ answer: "full" })
      .mockResolvedValueOnce({ answer: "500" });

    expect(await interactiveMenu()).toEqual(["evidence", "--force", "--name", "manual"]);
  });

  it("evidence custom with no-docker + 1000 lines", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "evidence" })
      .mockResolvedValueOnce({ answer: "custom" })
      .mockResolvedValueOnce({ name: "pre-incident" })
      .mockResolvedValueOnce({ answer: "no-docker" })
      .mockResolvedValueOnce({ answer: "1000" });

    expect(await interactiveMenu()).toEqual(["evidence", "--name", "pre-incident", "--no-docker", "--lines", "1000"]);
  });
});
