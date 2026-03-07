import {
  generateBashCompletions,
  generateZshCompletions,
  generateFishCompletions,
} from "../../src/core/completions";

const ALL_COMMANDS = [
  "init", "list", "status", "destroy", "config", "ssh", "update", "restart",
  "logs", "monitor", "health", "doctor", "firewall", "domain", "secure",
  "backup", "restore", "export", "import", "add", "remove", "maintain",
  "snapshot", "completions",
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

  it("includes all 24 commands", () => {
    for (const cmd of ALL_COMMANDS) {
      expect(output).toContain(cmd);
    }
  });

  it("includes per-command options in case statement", () => {
    expect(output).toContain("--provider");
    expect(output).toContain("--dry-run");
    expect(output).toContain("--all");
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

  it("includes all 24 commands", () => {
    for (const cmd of ALL_COMMANDS) {
      expect(output).toContain(cmd);
    }
  });

  it("includes per-command options", () => {
    expect(output).toContain("--provider");
    expect(output).toContain("--dry-run");
    expect(output).toContain("--follow");
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

  it("includes all 24 commands", () => {
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
});
