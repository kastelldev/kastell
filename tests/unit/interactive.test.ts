import inquirer from "inquirer";
import { interactiveMenu, buildSearchSource } from "../../src/commands/interactive";

jest.mock("inquirer");
jest.mock("../../src/utils/logo.js", () => ({
  renderLogo: jest.fn(() => "MOCK_LOGO"),
}));
// Note: renderLogo is no longer called by interactiveMenu (header is printed by index.ts)

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

  it("does not call renderLogo (header printed by index.ts)", async () => {
    const { renderLogo } = require("../../src/utils/logo.js");
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "exit" });
    await interactiveMenu();
    expect(renderLogo).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce({ answer: "__back__" }) // secure sub-prompt → back
      .mockResolvedValueOnce({ action: "exit" }); // main menu again → exit

    expect(await interactiveMenu()).toBeNull();
    expect(mockedInquirer.prompt).toHaveBeenCalledTimes(3);
  });

  it("returns to main menu when back is selected, then picks direct command", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "logs" }) // main menu
      .mockResolvedValueOnce({ answer: "__back__" }) // logs sub → back
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
      .mockResolvedValueOnce({ answer: "__back__" }) // mode → back
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  it("init: back on template returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "init" })
      .mockResolvedValueOnce({ answer: "coolify" }) // mode
      .mockResolvedValueOnce({ answer: "__back__" }) // template → back
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
      .mockResolvedValueOnce({ answer: "__back__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  it("logs: back on lines returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "logs" })
      .mockResolvedValueOnce({ answer: "coolify" })
      .mockResolvedValueOnce({ answer: "__back__" })
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
      .mockResolvedValueOnce({ answer: "__back__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  it("firewall: back on protocol returns to main menu", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "firewall" })
      .mockResolvedValueOnce({ answer: "remove" })
      .mockResolvedValueOnce({ port: "443" })
      .mockResolvedValueOnce({ answer: "__back__" }) // protocol → back
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
      .mockResolvedValueOnce({ answer: "__back__" })
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
      .mockResolvedValueOnce({ answer: "__back__" })
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
      .mockResolvedValueOnce({ answer: "__back__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  // ─── Monitor sub-prompt ─────────────────────────────────────────────────────

  it("monitor: returns with --containers", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "monitor" })
      .mockResolvedValueOnce({ containers: true });

    expect(await interactiveMenu()).toEqual(["monitor", "--containers"]);
  });

  it("monitor: returns without --containers", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "monitor" })
      .mockResolvedValueOnce({ containers: false });

    expect(await interactiveMenu()).toEqual(["monitor"]);
  });

  // ─── Maintain sub-prompt ────────────────────────────────────────────────────

  it("maintain: returns with --skip-reboot", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "maintain" })
      .mockResolvedValueOnce({ skipReboot: true });

    expect(await interactiveMenu()).toEqual(["maintain", "--skip-reboot"]);
  });

  it("maintain: returns without --skip-reboot", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "maintain" })
      .mockResolvedValueOnce({ skipReboot: false });

    expect(await interactiveMenu()).toEqual(["maintain"]);
  });

  // ─── Status sub-prompt ──────────────────────────────────────────────────────

  it("status: returns with --all", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "status" })
      .mockResolvedValueOnce({ all: true });

    expect(await interactiveMenu()).toEqual(["status", "--all"]);
  });

  it("status: returns without --all", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "status" })
      .mockResolvedValueOnce({ all: false });

    expect(await interactiveMenu()).toEqual(["status"]);
  });

  // ─── Update sub-prompt ──────────────────────────────────────────────────────

  it("update: returns with --all", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "update" })
      .mockResolvedValueOnce({ all: true });

    expect(await interactiveMenu()).toEqual(["update", "--all"]);
  });

  it("update: returns without --all", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "update" })
      .mockResolvedValueOnce({ all: false });

    expect(await interactiveMenu()).toEqual(["update"]);
  });

  // ─── Doctor sub-prompt ──────────────────────────────────────────────────────

  it("doctor: returns with --check-tokens", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "doctor" })
      .mockResolvedValueOnce({ checkTokens: true });

    expect(await interactiveMenu()).toEqual(["doctor", "--check-tokens"]);
  });

  it("doctor: returns without --check-tokens", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "doctor" })
      .mockResolvedValueOnce({ checkTokens: false });

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
      .mockResolvedValueOnce({ answer: "__back__" })
      .mockResolvedValueOnce({ action: "exit" });

    expect(await interactiveMenu()).toBeNull();
  });

  // ─── Backup sub-prompt ──────────────────────────────────────────────────────

  it("backup: returns with --all", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "backup" })
      .mockResolvedValueOnce({ all: true });

    expect(await interactiveMenu()).toEqual(["backup", "--all"]);
  });

  it("backup: returns without --all", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "backup" })
      .mockResolvedValueOnce({ all: false });

    expect(await interactiveMenu()).toEqual(["backup"]);
  });

  // ─── Import sub-prompt ──────────────────────────────────────────────────────

  it("import: returns with path", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "import" })
      .mockResolvedValueOnce({ path: "./servers.json" });

    expect(await interactiveMenu()).toEqual(["import", "./servers.json"]);
  });

  // ─── Health (no sub-prompt, falls through) ──────────────────────────────────

  it("health: returns as fallthrough command", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "health" });
    // health has a sub-prompt (no options needed beyond server select)
    // but it's not in DIRECT_COMMANDS, so it goes to SUB_PROMPTS
    // health is not in SUB_PROMPTS either, so it falls through
    expect(await interactiveMenu()).toEqual(["health"]);
  });
});
