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
  "audit", "evidence", "fleet", "notify",
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

  it("includes all 30 commands", () => {
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

  it("contains doctor v1.8 flags (--fix --force --dry-run)", () => {
    expect(output).toMatch(/doctor\)[\s\S]*?--fix[\s\S]*?--force[\s\S]*?--dry-run/);
  });

  it("contains audit command with key flags", () => {
    expect(output).toMatch(/audit\)[\s\S]*?--trend[\s\S]*?--days/);
    expect(output).toContain("--badge");
    expect(output).toContain("--report");
    expect(output).toContain("--snapshot");
    expect(output).toContain("--diff");
    expect(output).toContain("--compare");
    expect(output).toContain("--score-only");
    expect(output).toContain("--category");
    expect(output).toContain("--threshold");
    expect(output).toContain("--watch");
  });

  it("contains evidence command with flags", () => {
    expect(output).toMatch(/evidence\)[\s\S]*?--name[\s\S]*?--output[\s\S]*?--lines[\s\S]*?--no-docker[\s\S]*?--no-sysinfo/);
  });

  it("contains fleet command with flags", () => {
    expect(output).toMatch(/fleet\)[\s\S]*?--json[\s\S]*?--sort/);
  });

  it("contains notify subcommands (add test)", () => {
    expect(output).toContain('"add test"');
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

  it("includes all 30 commands", () => {
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

  it("includes audit in commands array with description", () => {
    expect(output).toContain("audit:Run a security audit on a server");
  });

  it("includes evidence in commands array with description", () => {
    expect(output).toContain("evidence:Collect forensic evidence package from a server");
  });

  it("includes fleet in commands array with description", () => {
    expect(output).toContain("fleet:Show health and security posture of all registered servers");
  });

  it("includes notify in commands array with description", () => {
    expect(output).toContain("notify:Manage notification channels");
  });

  it("includes doctor v1.8 flags (--fix --force --dry-run)", () => {
    expect(output).toContain("--fix[Interactive fix mode]");
    expect(output).toContain("--force[Skip confirmation prompts]");
    expect(output).toContain("--dry-run[Show fix commands without executing]");
  });

  it("includes audit arguments block with key flags", () => {
    expect(output).toContain("--trend[Show score trend over time]");
    expect(output).toContain("--days[Limit trend to N days]:n:");
    expect(output).toContain("--badge[Output SVG badge with score]");
    expect(output).toContain("--score-only[Output only the score]");
  });

  it("includes fleet arguments block", () => {
    expect(output).toContain("--sort[Sort by field]:field:(score name provider)");
  });

  it("includes notify subcommands block", () => {
    expect(output).toContain("subcommands=('add' 'test')");
    expect(output).toContain("--bot-token[Telegram bot token]:token:");
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

  it("includes all 30 commands", () => {
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

  it("includes doctor v1.8 flags (--fix --force --dry-run)", () => {
    expect(output).toContain("'__kastell_using_subcommand doctor' -l fix");
    expect(output).toContain("'__kastell_using_subcommand doctor' -l force");
    expect(output).toContain("'__kastell_using_subcommand doctor' -l dry-run");
  });

  it("includes audit as top-level command", () => {
    expect(output).toContain("-a 'audit' -d 'Run a security audit'");
  });

  it("includes evidence as top-level command", () => {
    expect(output).toContain("-a 'evidence' -d 'Collect forensic evidence'");
  });

  it("includes fleet as top-level command", () => {
    expect(output).toContain("-a 'fleet' -d 'Show fleet health and security'");
  });

  it("includes notify as top-level command", () => {
    expect(output).toContain("-a 'notify' -d 'Manage notification channels'");
  });

  it("includes audit subcommand flags", () => {
    expect(output).toContain("'__kastell_using_subcommand audit' -l json");
    expect(output).toContain("'__kastell_using_subcommand audit' -l trend");
    expect(output).toContain("'__kastell_using_subcommand audit' -l days");
    expect(output).toContain("'__kastell_using_subcommand audit' -l score-only");
  });

  it("includes evidence subcommand flags", () => {
    expect(output).toContain("'__kastell_using_subcommand evidence' -l name");
    expect(output).toContain("'__kastell_using_subcommand evidence' -l no-docker");
    expect(output).toContain("'__kastell_using_subcommand evidence' -l no-sysinfo");
  });

  it("includes fleet subcommand flags", () => {
    expect(output).toContain("'__kastell_using_subcommand fleet' -l json");
    expect(output).toContain("'__kastell_using_subcommand fleet' -l sort");
  });

  it("includes notify subcommands and flags", () => {
    expect(output).toContain("'__kastell_using_subcommand notify' -a 'add test'");
    expect(output).toContain("'__kastell_using_subcommand notify' -l bot-token");
    expect(output).toContain("'__kastell_using_subcommand notify' -l webhook-url");
  });
});
