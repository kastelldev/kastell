import {
  findCheckById,
  formatExplainTerminal,
  formatExplainJson,
  formatExplainMarkdown,
} from "../../src/core/audit/explainCheck.js";

describe("findCheckById", () => {
  it("returns exact match", () => {
    const result = findCheckById("SSH-PASSWORD-AUTH");
    expect(result.match).not.toBeNull();
    expect(result.match!.id).toBe("SSH-PASSWORD-AUTH");
    expect(result.suggestions).toEqual([]);
  });

  it("returns case-insensitive match", () => {
    const result = findCheckById("ssh-password-auth");
    expect(result.match).not.toBeNull();
    expect(result.match!.id).toBe("SSH-PASSWORD-AUTH");
  });

  it("returns null match with suggestions for close typo", () => {
    const result = findCheckById("SSH-PASWORD-AUTH");
    expect(result.match).toBeNull();
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions).toContain("SSH-PASSWORD-AUTH");
  });

  it("returns null match with empty suggestions for unrelated input", () => {
    const result = findCheckById("ZZZZZ-NONEXISTENT-999");
    expect(result.match).toBeNull();
    expect(result.suggestions).toEqual([]);
  });
});

describe("formatExplainTerminal", () => {
  it("includes check ID, category, severity, explain text, and fix command", () => {
    const result = findCheckById("SSH-PASSWORD-AUTH");
    const output = formatExplainTerminal(result.match!);
    const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("SSH-PASSWORD-AUTH");
    expect(plain).toContain("SSH");
    expect(plain).toContain("CRITICAL");
    expect(plain).toContain("brute-force");
    expect(plain).toContain("sed -i");
  });

  it("includes compliance references when present", () => {
    const result = findCheckById("SSH-PASSWORD-AUTH");
    const output = formatExplainTerminal(result.match!);
    const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("CIS");
    expect(plain).toContain("5.2.8");
  });
});

describe("formatExplainJson", () => {
  it("returns valid JSON with all fields", () => {
    const result = findCheckById("SSH-PASSWORD-AUTH");
    const json = formatExplainJson(result.match!);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe("SSH-PASSWORD-AUTH");
    expect(parsed.category).toBe("SSH");
    expect(parsed.severity).toBe("critical");
    expect(parsed.explain).toBeDefined();
    expect(parsed.fixCommand).toBeDefined();
    expect(parsed.complianceRefs).toBeInstanceOf(Array);
  });
});

describe("formatExplainMarkdown", () => {
  it("includes YAML frontmatter and markdown headings", () => {
    const result = findCheckById("SSH-PASSWORD-AUTH");
    const md = formatExplainMarkdown(result.match!);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain("id: SSH-PASSWORD-AUTH");
    expect(md).toContain("category: SSH");
    expect(md).toContain("severity: critical");
    expect(md).toContain("## Why This Matters");
    expect(md).toContain("## Fix");
    expect(md).toContain("```bash");
  });
});
