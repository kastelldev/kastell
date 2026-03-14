import {
  generateBashCompletions,
  generateZshCompletions,
  generateFishCompletions,
} from "../../src/core/completions";

const ALL_COMMANDS = [
  "init", "list", "status", "destroy", "config", "ssh", "update", "restart",
  "logs", "monitor", "health", "doctor", "firewall", "domain", "secure",
  "backup", "restore", "export", "import", "add", "remove", "maintain",
  "snapshot", "completions", "guard", "lock",
];

describe("generateBashCompletions", () => {
  let output: string;

  beforeAll(() => {
    output = generateBashCompletions();
  });

  it("returns a non-empty string", () => {
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("contains _kastell function definition", () => {
    expect(output).toContain("_kastell()");
  });

  it("contains complete -F registration", () => {
    expect(output).toContain("complete -F _kastell kastell");
  });

  it("contains header comment with generation notice", () => {
    expect(output).toMatch(/^#.*[Gg]enerat/m);
  });

  it("includes all 26 commands", () => {
    for (const cmd of ALL_COMMANDS) {
      expect(output).toContain(cmd);
    }
  });

  it("includes per-command options in case statement", () => {
    expect(output).toContain("--provider");
    expect(output).toContain("--dry-run");
    expect(output).toContain("--all");
  });

  it("includes guard subcommands (start stop status)", () => {
    expect(output).toContain('"start stop status"');
  });

  it("includes lock options (--production --dry-run --force)", () => {
    expect(output).toContain("--production");
    expect(output).toMatch(/lock\)[\s\S]*?--production[\s\S]*?--dry-run[\s\S]*?--force/);
  });

  it("includes updated doctor flags (--fresh --json)", () => {
    expect(output).toContain("--fresh");
    expect(output).toContain("--json");
    expect(output).toMatch(/doctor\)[\s\S]*?--fresh[\s\S]*?--json/);
  });
});

describe("generateZshCompletions", () => {
  let output: string;

  beforeAll(() => {
    output = generateZshCompletions();
  });

  it("returns a non-empty string", () => {
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("contains #compdef kastell directive", () => {
    expect(output).toContain("#compdef kastell");
  });

  it("contains _kastell function definition", () => {
    expect(output).toContain("_kastell()");
  });

  it("contains header comment with generation notice", () => {
    expect(output).toMatch(/^#.*[Gg]enerat/m);
  });

  it("includes all 26 commands", () => {
    for (const cmd of ALL_COMMANDS) {
      expect(output).toContain(cmd);
    }
  });

  it("includes per-command options", () => {
    expect(output).toContain("--provider");
    expect(output).toContain("--dry-run");
    expect(output).toContain("--follow");
  });

  it("includes guard with description in commands array", () => {
    expect(output).toContain("guard:Manage autonomous security monitoring daemon");
  });

  it("includes lock with description in commands array", () => {
    expect(output).toContain("lock:Harden server to production standard");
  });

  it("includes guard subcommands (start/stop/status)", () => {
    expect(output).toContain("'start' 'stop' 'status'");
  });

  it("includes lock options (--production --dry-run --force)", () => {
    expect(output).toContain("--production[Apply full production hardening profile]");
  });

  it("includes updated doctor flags (--fresh --json)", () => {
    expect(output).toContain("--fresh[Force fresh SSH probe, skip cache]");
    expect(output).toContain("--json[Output result as JSON]");
  });
});

describe("generateFishCompletions", () => {
  let output: string;

  beforeAll(() => {
    output = generateFishCompletions();
  });

  it("returns a non-empty string", () => {
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("contains complete -c kastell commands", () => {
    expect(output).toContain("complete -c kastell");
  });

  it("contains header comment with generation notice", () => {
    expect(output).toMatch(/^#.*[Gg]enerat/m);
  });

  it("includes all 26 commands", () => {
    for (const cmd of ALL_COMMANDS) {
      expect(output).toContain(cmd);
    }
  });

  it("uses -l long flag syntax for options", () => {
    expect(output).toMatch(/-l\s+\w+/);
  });

  it("includes per-command options", () => {
    expect(output).toContain("provider");
    expect(output).toContain("dry-run");
  });

  it("includes guard as top-level command", () => {
    expect(output).toContain("-a 'guard' -d 'Manage guard daemon'");
  });

  it("includes lock as top-level command", () => {
    expect(output).toContain("-a 'lock' -d 'Harden server to production standard'");
  });

  it("includes guard subcommands (start stop status)", () => {
    expect(output).toContain("'__kastell_using_subcommand guard' -a 'start stop status'");
  });

  it("includes lock options (--production --dry-run --force)", () => {
    expect(output).toContain("'__kastell_using_subcommand lock' -l production");
    expect(output).toContain("'__kastell_using_subcommand lock' -l dry-run");
    expect(output).toContain("'__kastell_using_subcommand lock' -l force");
  });

  it("includes updated doctor flags (--fresh --json)", () => {
    expect(output).toContain("'__kastell_using_subcommand doctor' -l fresh");
    expect(output).toContain("'__kastell_using_subcommand doctor' -l json");
  });
});
