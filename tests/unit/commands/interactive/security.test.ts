/**
 * security.ts (src/commands/interactive/security.ts) unit tests.
 * Covers: promptFirewall, promptSecure, promptDomain, promptAuth,
 *          promptAudit, promptLock, promptFix, promptEvidence.
 * Target: >= 90% stmts coverage (P1 #8).
 */

import inquirer from "inquirer";
import {
  promptFirewall,
  promptSecure,
  promptDomain,
  promptAuth,
  promptAudit,
  promptLock,
  promptFix,
  promptEvidence,
} from "../../../../src/commands/interactive/security";

jest.mock("../../../../src/commands/interactive/shared", () => ({
  promptList: jest.fn(),
  validateRequired: (msg: string) => (v: string) =>
    v.trim().length > 0 ? true : msg,
  validateScore: (v: string) => {
    const num = Number(v);
    return num >= 0 && num <= 100 ? true : "Enter 0-100";
  },
  validateColonPair: (msg: string) => (v: string) => {
    const parts = v.split(":");
    return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0 ? true : msg;
  },
  backChoice: () => ({ name: "← Back", value: "__BACK__" }),
}));

jest.mock("../../../../src/core/audit/profiles", () => ({
  listAllProfileNames: jest.fn().mockReturnValue(["cis-level1", "pci-dss", "hipaa"]),
}));

jest.mock("../../../../src/core/firewall", () => ({
  isValidPort: jest.fn((n: number) => Number.isInteger(n) && n >= 1 && n <= 65535),
}));

jest.mock("inquirer", () => ({
  prompt: jest.fn(),
  default: { prompt: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { promptList } = require("../../../../src/commands/interactive/shared");
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedPromptList = promptList as jest.MockedFunction<typeof promptList>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedPromptList.mockReset();
  mockedInquirer.prompt.mockReset();
});

// ─── promptFirewall ───────────────────────────────────────────────────────────

describe("promptFirewall", () => {
  it("returns null when user cancels", async () => {
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptFirewall()).toBeNull();
  });

  it("returns status args", async () => {
    mockedPromptList.mockResolvedValueOnce("status");
    expect(await promptFirewall()).toEqual(["firewall", "status"]);
  });

  it("returns setup args", async () => {
    mockedPromptList.mockResolvedValueOnce("setup");
    expect(await promptFirewall()).toEqual(["firewall", "setup"]);
  });

  it("returns add+port args with tcp", async () => {
    mockedPromptList.mockResolvedValueOnce("add");
    mockedInquirer.prompt.mockResolvedValueOnce({ port: "22" });
    mockedPromptList.mockResolvedValueOnce("tcp");
    expect(await promptFirewall()).toEqual(["firewall", "add", "--port", "22", "--protocol", "tcp"]);
  });

  it("returns remove+port args with udp", async () => {
    mockedPromptList.mockResolvedValueOnce("remove");
    mockedInquirer.prompt.mockResolvedValueOnce({ port: "53" });
    mockedPromptList.mockResolvedValueOnce("udp");
    expect(await promptFirewall()).toEqual(["firewall", "remove", "--port", "53", "--protocol", "udp"]);
  });

  it("returns null when protocol prompt returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("add");
    mockedInquirer.prompt.mockResolvedValueOnce({ port: "22" });
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptFirewall()).toBeNull();
  });
});

// ─── promptSecure ─────────────────────────────────────────────────────────────

describe("promptSecure", () => {
  it("returns null when user cancels", async () => {
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptSecure()).toBeNull();
  });

  it("returns setup args", async () => {
    mockedPromptList.mockResolvedValueOnce("setup");
    expect(await promptSecure()).toEqual(["secure", "setup"]);
  });

  it("returns audit args", async () => {
    mockedPromptList.mockResolvedValueOnce("audit");
    expect(await promptSecure()).toEqual(["secure", "audit"]);
  });

  it("returns status args", async () => {
    mockedPromptList.mockResolvedValueOnce("status");
    expect(await promptSecure()).toEqual(["secure", "status"]);
  });
});

// ─── promptDomain ─────────────────────────────────────────────────────────────

describe("promptDomain", () => {
  it("returns null when user cancels", async () => {
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptDomain()).toBeNull();
  });

  it("returns info args", async () => {
    mockedPromptList.mockResolvedValueOnce("info");
    expect(await promptDomain()).toEqual(["domain", "info"]);
  });

  it("returns list args", async () => {
    mockedPromptList.mockResolvedValueOnce("list");
    expect(await promptDomain()).toEqual(["domain", "list"]);
  });

  it("returns remove args", async () => {
    mockedPromptList.mockResolvedValueOnce("remove");
    expect(await promptDomain()).toEqual(["domain", "remove"]);
  });

  it("returns check domain args", async () => {
    mockedPromptList.mockResolvedValueOnce("check");
    mockedInquirer.prompt.mockResolvedValueOnce({ domain: "example.com" });
    expect(await promptDomain()).toEqual(["domain", "check", "--domain", "example.com"]);
  });

  it("returns add domain args with ssl enabled", async () => {
    mockedPromptList.mockResolvedValueOnce("add");
    mockedInquirer.prompt.mockResolvedValueOnce({ domain: "panel.example.com" });
    mockedInquirer.prompt.mockResolvedValueOnce({ ssl: true });
    expect(await promptDomain()).toEqual(["domain", "add", "--domain", "panel.example.com"]);
  });

  it("returns add domain args with ssl disabled (--no-ssl)", async () => {
    mockedPromptList.mockResolvedValueOnce("add");
    mockedInquirer.prompt.mockResolvedValueOnce({ domain: "panel.example.com" });
    mockedInquirer.prompt.mockResolvedValueOnce({ ssl: false });
    expect(await promptDomain()).toEqual(["domain", "add", "--domain", "panel.example.com", "--no-ssl"]);
  });
});

// ─── promptAuth ───────────────────────────────────────────────────────────────

describe("promptAuth", () => {
  it("returns null when user cancels", async () => {
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAuth()).toBeNull();
  });

  it("returns list args", async () => {
    mockedPromptList.mockResolvedValueOnce("list");
    expect(await promptAuth()).toEqual(["auth", "list"]);
  });

  it("returns set args with hetzner provider", async () => {
    mockedPromptList.mockResolvedValueOnce("set");
    mockedPromptList.mockResolvedValueOnce("hetzner");
    expect(await promptAuth()).toEqual(["auth", "set", "hetzner"]);
  });

  it("returns remove args with digitalocean provider", async () => {
    mockedPromptList.mockResolvedValueOnce("remove");
    mockedPromptList.mockResolvedValueOnce("digitalocean");
    expect(await promptAuth()).toEqual(["auth", "remove", "digitalocean"]);
  });

  it("returns null when provider prompt returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("set");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAuth()).toBeNull();
  });
});

// ─── promptAudit ──────────────────────────────────────────────────────────────

describe("promptAudit", () => {
  it("returns null when user cancels", async () => {
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAudit()).toBeNull();
  });

  it("returns --explain args for explain mode", async () => {
    mockedPromptList.mockResolvedValueOnce("explain");
    expect(await promptAudit()).toEqual(["audit", "--explain"]);
  });

  it("returns --list-checks args", async () => {
    mockedPromptList.mockResolvedValueOnce("list-checks");
    expect(await promptAudit()).toEqual(["audit", "--list-checks"]);
  });

  it("returns --snapshots args", async () => {
    mockedPromptList.mockResolvedValueOnce("snapshots");
    expect(await promptAudit()).toEqual(["audit", "--snapshots"]);
  });

  it("returns --diff args", async () => {
    mockedPromptList.mockResolvedValueOnce("diff");
    mockedInquirer.prompt.mockResolvedValueOnce({ diffRef: "pre:latest" });
    expect(await promptAudit()).toEqual(["audit", "--diff", "pre:latest"]);
  });

  it("returns --snapshot args with auto name when empty", async () => {
    mockedPromptList.mockResolvedValueOnce("snapshot");
    mockedInquirer.prompt.mockResolvedValueOnce({ snapName: "" });
    expect(await promptAudit()).toEqual(["audit", "--snapshot"]);
  });

  it("returns --snapshot args with custom name", async () => {
    mockedPromptList.mockResolvedValueOnce("snapshot");
    mockedInquirer.prompt.mockResolvedValueOnce({ snapName: "before-upgrade" });
    expect(await promptAudit()).toEqual(["audit", "--snapshot", "before-upgrade"]);
  });

  it("returns null when explain-check id is empty", async () => {
    mockedPromptList.mockResolvedValueOnce("explain-check");
    mockedInquirer.prompt.mockResolvedValueOnce({ checkId: "  " });
    expect(await promptAudit()).toBeNull();
  });

  it("returns explain args for explain-check mode", async () => {
    mockedPromptList.mockResolvedValueOnce("explain-check");
    mockedInquirer.prompt.mockResolvedValueOnce({ checkId: "SSH-PASSWORD-AUTH" });
    expect(await promptAudit()).toEqual(["explain", "SSH-PASSWORD-AUTH"]);
  });

  it("returns --fix dry-run args", async () => {
    mockedPromptList.mockResolvedValueOnce("fix");
    mockedPromptList.mockResolvedValueOnce("dry-run");
    expect(await promptAudit()).toEqual(["audit", "--fix", "--dry-run"]);
  });

  it("returns --fix live args", async () => {
    mockedPromptList.mockResolvedValueOnce("fix");
    mockedPromptList.mockResolvedValueOnce("live");
    expect(await promptAudit()).toEqual(["audit", "--fix"]);
  });

  it("returns null when fix mode returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("fix");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAudit()).toBeNull();
  });

  it("returns --compare detail args", async () => {
    mockedPromptList.mockResolvedValueOnce("compare");
    mockedInquirer.prompt.mockResolvedValueOnce({ compareRef: "srv1:srv2" });
    mockedPromptList.mockResolvedValueOnce("detail");
    expect(await promptAudit()).toEqual(["audit", "--compare", "srv1:srv2", "--detail"]);
  });

  it("returns --compare summary args", async () => {
    mockedPromptList.mockResolvedValueOnce("compare");
    mockedInquirer.prompt.mockResolvedValueOnce({ compareRef: "srv1:srv2" });
    mockedPromptList.mockResolvedValueOnce("summary");
    expect(await promptAudit()).toEqual(["audit", "--compare", "srv1:srv2"]);
  });

  it("returns null when compare mode returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("compare");
    mockedInquirer.prompt.mockResolvedValueOnce({ compareRef: "srv1:srv2" });
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAudit()).toBeNull();
  });

  it("returns --trend all-time args", async () => {
    mockedPromptList.mockResolvedValueOnce("trend");
    mockedPromptList.mockResolvedValueOnce("0");
    expect(await promptAudit()).toEqual(["audit", "--trend"]);
  });

  it("returns --trend days args", async () => {
    mockedPromptList.mockResolvedValueOnce("trend");
    mockedPromptList.mockResolvedValueOnce("30");
    expect(await promptAudit()).toEqual(["audit", "--trend", "--days", "30"]);
  });

  it("returns --watch args", async () => {
    mockedPromptList.mockResolvedValueOnce("watch");
    mockedPromptList.mockResolvedValueOnce("60");
    expect(await promptAudit()).toEqual(["audit", "--watch", "60"]);
  });

  it("returns null when watch interval returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("watch");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAudit()).toBeNull();
  });

  it("returns --host args", async () => {
    mockedPromptList.mockResolvedValueOnce("host");
    mockedInquirer.prompt.mockResolvedValueOnce({ hostAddr: "root@1.2.3.4" });
    expect(await promptAudit()).toEqual(["audit", "--host", "root@1.2.3.4"]);
  });

  it("returns --threshold args", async () => {
    mockedPromptList.mockResolvedValueOnce("threshold");
    mockedInquirer.prompt.mockResolvedValueOnce({ thresholdScore: "80" });
    expect(await promptAudit()).toEqual(["audit", "--threshold", "80"]);
  });

  it("returns --report md args", async () => {
    mockedPromptList.mockResolvedValueOnce("report");
    mockedPromptList.mockResolvedValueOnce("md");
    expect(await promptAudit()).toEqual(["audit", "--report", "md"]);
  });

  it("returns --report html args", async () => {
    mockedPromptList.mockResolvedValueOnce("report");
    mockedPromptList.mockResolvedValueOnce("html");
    expect(await promptAudit()).toEqual(["audit", "--report", "html"]);
  });

  it("returns null when report format returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("report");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAudit()).toBeNull();
  });

  it("returns --profile summary args", async () => {
    mockedPromptList.mockResolvedValueOnce("profile");
    mockedPromptList.mockResolvedValueOnce("cis-level1");
    mockedPromptList.mockResolvedValueOnce("summary");
    expect(await promptAudit()).toEqual(["audit", "--profile", "cis-level1", "--summary"]);
  });

  it("returns --profile json args", async () => {
    mockedPromptList.mockResolvedValueOnce("profile");
    mockedPromptList.mockResolvedValueOnce("pci-dss");
    mockedPromptList.mockResolvedValueOnce("json");
    expect(await promptAudit()).toEqual(["audit", "--profile", "pci-dss", "--json"]);
  });

  it("returns --profile score-only args", async () => {
    mockedPromptList.mockResolvedValueOnce("profile");
    mockedPromptList.mockResolvedValueOnce("hipaa");
    mockedPromptList.mockResolvedValueOnce("score-only");
    expect(await promptAudit()).toEqual(["audit", "--profile", "hipaa", "--score-only"]);
  });

  it("returns null when profile format returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("profile");
    mockedPromptList.mockResolvedValueOnce("cis-level1");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAudit()).toBeNull();
  });

  it("returns --compliance args with selected frameworks", async () => {
    mockedPromptList.mockResolvedValueOnce("compliance");
    mockedInquirer.prompt.mockResolvedValueOnce({ frameworks: ["cis", "pci-dss"] });
    expect(await promptAudit()).toEqual(["audit", "--compliance", "cis,pci-dss"]);
  });

  // ─── run mode ────────────────────────────────────────────────────────────────

  it("returns --run summary args", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("summary");
    mockedPromptList.mockResolvedValueOnce("none");
    expect(await promptAudit()).toEqual(["audit", "--summary"]);
  });

  it("returns --run json args", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("json");
    mockedPromptList.mockResolvedValueOnce("none");
    expect(await promptAudit()).toEqual(["audit", "--json"]);
  });

  it("returns --run score-only args", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("score-only");
    mockedPromptList.mockResolvedValueOnce("none");
    expect(await promptAudit()).toEqual(["audit", "--score-only"]);
  });

  it("returns --run badge args", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("badge");
    mockedPromptList.mockResolvedValueOnce("none");
    expect(await promptAudit()).toEqual(["audit", "--badge"]);
  });

  it("returns null when filter returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("summary");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAudit()).toBeNull();
  });

  it("returns --run category args", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("summary");
    mockedPromptList.mockResolvedValueOnce("category");
    mockedPromptList.mockResolvedValueOnce("ssh");
    mockedPromptList.mockResolvedValueOnce("none");
    expect(await promptAudit()).toEqual(["audit", "--summary", "--category", "ssh"]);
  });

  it("returns --run __all__ category args", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("summary");
    mockedPromptList.mockResolvedValueOnce("category");
    mockedPromptList.mockResolvedValueOnce("__all__");
    mockedPromptList.mockResolvedValueOnce("kernel");
    mockedPromptList.mockResolvedValueOnce("none");
    expect(await promptAudit()).toEqual(["audit", "--summary", "--category", "kernel"]);
  });

  it("returns null when full category returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("summary");
    mockedPromptList.mockResolvedValueOnce("category");
    mockedPromptList.mockResolvedValueOnce("__all__");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAudit()).toBeNull();
  });

  it("returns null when category prompt returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("summary");
    mockedPromptList.mockResolvedValueOnce("category");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAudit()).toBeNull();
  });

  it("returns --run severity args", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("summary");
    mockedPromptList.mockResolvedValueOnce("severity");
    mockedPromptList.mockResolvedValueOnce("critical");
    expect(await promptAudit()).toEqual(["audit", "--summary", "--severity", "critical"]);
  });

  it("returns null when severity returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("summary");
    mockedPromptList.mockResolvedValueOnce("severity");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAudit()).toBeNull();
  });

  it("returns --run both filters args", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("summary");
    mockedPromptList.mockResolvedValueOnce("both");
    mockedPromptList.mockResolvedValueOnce("ssh");
    mockedPromptList.mockResolvedValueOnce("warning");
    expect(await promptAudit()).toEqual(["audit", "--summary", "--category", "ssh", "--severity", "warning"]);
  });

  it("returns null when category returns null in both filter", async () => {
    mockedPromptList.mockResolvedValueOnce("run");
    mockedPromptList.mockResolvedValueOnce("summary");
    mockedPromptList.mockResolvedValueOnce("both");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptAudit()).toBeNull();
  });
});

// ─── promptLock ───────────────────────────────────────────────────────────────

describe("promptLock", () => {
  it("returns null when user cancels", async () => {
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptLock()).toBeNull();
  });

  it("returns --dry-run args", async () => {
    mockedPromptList.mockResolvedValueOnce("dry-run");
    expect(await promptLock()).toEqual(["lock", "--dry-run"]);
  });

  it("returns --production args", async () => {
    mockedPromptList.mockResolvedValueOnce("production");
    expect(await promptLock()).toEqual(["lock", "--production"]);
  });

  it("returns --production --force args", async () => {
    mockedPromptList.mockResolvedValueOnce("production-force");
    expect(await promptLock()).toEqual(["lock", "--production", "--force"]);
  });
});

// ─── promptFix ────────────────────────────────────────────────────────────────

describe("promptFix", () => {
  it("returns null when user cancels group", async () => {
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptFix()).toBeNull();
  });

  it("returns --history args", async () => {
    mockedPromptList.mockResolvedValueOnce("history");
    mockedPromptList.mockResolvedValueOnce("view");
    expect(await promptFix()).toEqual(["fix", "--history"]);
  });

  it("returns --rollback-all args", async () => {
    mockedPromptList.mockResolvedValueOnce("history");
    mockedPromptList.mockResolvedValueOnce("rollback-all");
    expect(await promptFix()).toEqual(["fix", "--rollback-all"]);
  });

  it("returns --rollback args with fixId", async () => {
    mockedPromptList.mockResolvedValueOnce("history");
    mockedPromptList.mockResolvedValueOnce("rollback");
    mockedInquirer.prompt.mockResolvedValueOnce({ fixId: "fix-2026-06-22-001" });
    expect(await promptFix()).toEqual(["fix", "--rollback", "fix-2026-06-22-001"]);
  });

  it("returns --rollback-to args", async () => {
    mockedPromptList.mockResolvedValueOnce("history");
    mockedPromptList.mockResolvedValueOnce("rollback-to");
    mockedInquirer.prompt.mockResolvedValueOnce({ fixId: "fix-2026-06-22-001" });
    expect(await promptFix()).toEqual(["fix", "--rollback-to", "fix-2026-06-22-001"]);
  });

  it("returns --safe --dry-run args", async () => {
    mockedPromptList.mockResolvedValueOnce("apply");
    mockedPromptList.mockResolvedValueOnce("dry-run");
    expect(await promptFix()).toEqual(["fix", "--safe", "--dry-run"]);
  });

  it("returns --safe args", async () => {
    mockedPromptList.mockResolvedValueOnce("apply");
    mockedPromptList.mockResolvedValueOnce("apply");
    expect(await promptFix()).toEqual(["fix", "--safe"]);
  });

  it("returns --safe --diff args", async () => {
    mockedPromptList.mockResolvedValueOnce("apply");
    mockedPromptList.mockResolvedValueOnce("diff");
    expect(await promptFix()).toEqual(["fix", "--safe", "--diff"]);
  });

  it("returns --safe --report args", async () => {
    mockedPromptList.mockResolvedValueOnce("apply");
    mockedPromptList.mockResolvedValueOnce("report");
    expect(await promptFix()).toEqual(["fix", "--safe", "--report"]);
  });

  it("returns --safe --profile args", async () => {
    mockedPromptList.mockResolvedValueOnce("apply");
    mockedPromptList.mockResolvedValueOnce("profile");
    mockedPromptList.mockResolvedValueOnce("cis-level1");
    expect(await promptFix()).toEqual(["fix", "--safe", "--profile", "cis-level1"]);
  });

  it("returns null when profile returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("apply");
    mockedPromptList.mockResolvedValueOnce("profile");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptFix()).toBeNull();
  });

  it("returns --safe --category args", async () => {
    mockedPromptList.mockResolvedValueOnce("apply");
    mockedPromptList.mockResolvedValueOnce("category");
    mockedInquirer.prompt.mockResolvedValueOnce({ cats: "Auth,Kernel" });
    expect(await promptFix()).toEqual(["fix", "--safe", "--category", "Auth,Kernel"]);
  });

  it("returns --safe --top args", async () => {
    mockedPromptList.mockResolvedValueOnce("apply");
    mockedPromptList.mockResolvedValueOnce("top");
    mockedInquirer.prompt.mockResolvedValueOnce({ n: "5" });
    expect(await promptFix()).toEqual(["fix", "--safe", "--top", "5"]);
  });

  it("returns --safe --target args", async () => {
    mockedPromptList.mockResolvedValueOnce("apply");
    mockedPromptList.mockResolvedValueOnce("target");
    mockedInquirer.prompt.mockResolvedValueOnce({ score: "85" });
    expect(await promptFix()).toEqual(["fix", "--safe", "--target", "85"]);
  });

  it("returns null when apply mode returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("apply");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptFix()).toBeNull();
  });
});

// ─── promptEvidence ───────────────────────────────────────────────────────────

describe("promptEvidence", () => {
  it("returns null when user cancels action", async () => {
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptEvidence()).toBeNull();
  });

  it("returns default evidence args (manual label, full, 500 lines)", async () => {
    mockedPromptList.mockResolvedValueOnce("default");
    mockedPromptList.mockResolvedValueOnce("full");
    mockedPromptList.mockResolvedValueOnce("500");
    expect(await promptEvidence()).toEqual(["evidence", "--name", "manual"]);
  });

  it("returns custom evidence args with custom name", async () => {
    mockedPromptList.mockResolvedValueOnce("custom");
    mockedInquirer.prompt.mockResolvedValueOnce({ name: "pre-incident" });
    mockedPromptList.mockResolvedValueOnce("full");
    mockedPromptList.mockResolvedValueOnce("500");
    expect(await promptEvidence()).toEqual(["evidence", "--name", "pre-incident"]);
  });

  it("returns force evidence args", async () => {
    mockedPromptList.mockResolvedValueOnce("force");
    mockedPromptList.mockResolvedValueOnce("full");
    mockedPromptList.mockResolvedValueOnce("500");
    expect(await promptEvidence()).toEqual(["evidence", "--force", "--name", "manual"]);
  });

  it("returns json evidence args", async () => {
    mockedPromptList.mockResolvedValueOnce("json");
    mockedPromptList.mockResolvedValueOnce("full");
    mockedPromptList.mockResolvedValueOnce("500");
    expect(await promptEvidence()).toEqual(["evidence", "--json", "--name", "manual"]);
  });

  it("returns no-docker evidence args", async () => {
    mockedPromptList.mockResolvedValueOnce("default");
    mockedPromptList.mockResolvedValueOnce("no-docker");
    mockedPromptList.mockResolvedValueOnce("500");
    expect(await promptEvidence()).toEqual(["evidence", "--name", "manual", "--no-docker"]);
  });

  it("returns no-sysinfo evidence args", async () => {
    mockedPromptList.mockResolvedValueOnce("default");
    mockedPromptList.mockResolvedValueOnce("no-sysinfo");
    mockedPromptList.mockResolvedValueOnce("500");
    expect(await promptEvidence()).toEqual(["evidence", "--name", "manual", "--no-sysinfo"]);
  });

  it("returns no-both evidence args", async () => {
    mockedPromptList.mockResolvedValueOnce("default");
    mockedPromptList.mockResolvedValueOnce("no-both");
    mockedPromptList.mockResolvedValueOnce("500");
    expect(await promptEvidence()).toEqual(["evidence", "--name", "manual", "--no-docker", "--no-sysinfo"]);
  });

  it("returns 100-line evidence args", async () => {
    mockedPromptList.mockResolvedValueOnce("default");
    mockedPromptList.mockResolvedValueOnce("full");
    mockedPromptList.mockResolvedValueOnce("100");
    expect(await promptEvidence()).toEqual(["evidence", "--name", "manual", "--lines", "100"]);
  });

  it("returns 1000-line evidence args", async () => {
    mockedPromptList.mockResolvedValueOnce("default");
    mockedPromptList.mockResolvedValueOnce("full");
    mockedPromptList.mockResolvedValueOnce("1000");
    expect(await promptEvidence()).toEqual(["evidence", "--name", "manual", "--lines", "1000"]);
  });

  it("returns null when options prompt returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("default");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptEvidence()).toBeNull();
  });

  it("returns null when lines prompt returns null", async () => {
    mockedPromptList.mockResolvedValueOnce("default");
    mockedPromptList.mockResolvedValueOnce("full");
    mockedPromptList.mockResolvedValueOnce(null);
    expect(await promptEvidence()).toBeNull();
  });
});