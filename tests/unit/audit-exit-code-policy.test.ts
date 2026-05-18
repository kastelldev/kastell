/**
 * F-015: Audit exit code policy — parametrized test
 * Verifies that all early-return paths in audit.ts set exitCode = 1
 */

import { auditCommand } from "../../src/commands/audit";
import { getServers } from "../../src/utils/config.js";
import { listSnapshots } from "../../src/core/audit/snapshot.js";
import { resolveAuditPair } from "../../src/core/audit/diff.js";
import { runAudit } from "../../src/core/audit/index.js";
import { resolveServer } from "../../src/utils/serverSelect.js";

jest.mock("../../src/utils/config", () => ({
  getServers: jest.fn(),
}));

jest.mock("../../src/core/audit/snapshot", () => ({
  listSnapshots: jest.fn(),
}));

jest.mock("../../src/core/audit/diff", () => ({
  resolveAuditPair: jest.fn(),
  resolveSnapshotRef: jest.fn(),
  diffAudits: jest.fn(),
}));

jest.mock("../../src/core/audit/index", () => ({
  runAudit: jest.fn(),
}));

jest.mock("../../src/utils/serverSelect", () => ({
  resolveServer: jest.fn(),
}));

jest.mock("../../src/core/audit/history", () => ({
  saveAuditHistory: jest.fn(),
  loadAuditHistory: jest.fn().mockReturnValue([]),
  detectTrend: jest.fn().mockReturnValue("first audit"),
}));

jest.mock("../../src/core/audit/regression", () => ({
  loadBaseline: jest.fn().mockReturnValue(null),
  checkRegression: jest.fn().mockReturnValue(null),
  saveBaselineSafe: jest.fn(),
  shouldUpdateBaseline: jest.fn().mockReturnValue(false),
  extractPassedCheckIds: jest.fn().mockReturnValue([]),
  formatRegressionSummary: jest.fn().mockReturnValue([]),
}));

describe("audit exit code policy", () => {
  beforeEach(() => {
    process.exitCode = 0;
    jest.clearAllMocks();
  });

  type Case = {
    name: string;
    setup?: () => void;
    args?: string;
    opts: Record<string, unknown>;
  };

  const cases: Case[] = [
    {
      name: "L99 --ci without --threshold",
      opts: { ci: true },
    },
    {
      name: "L169 --diff invalid format",
      setup: () =>
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        }),
      args: "server-1",
      opts: { diff: "no-colon" },
    },
    {
      name: "L175 snapshot not found (before)",
      setup: () => {
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        });
        (listSnapshots as jest.Mock).mockResolvedValue([]);
      },
      args: "server-1",
      opts: { diff: "missing:latest" },
    },
    {
      name: "L176 snapshot not found (after)",
      setup: () => {
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        });
        (listSnapshots as jest.Mock).mockResolvedValue([{ name: "pre" }]);
      },
      args: "server-1",
      opts: { diff: "pre:missing" },
    },
    {
      name: "L189 --compare invalid format",
      setup: () =>
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        }),
      args: "server-1",
      opts: { compare: "no-colon" },
    },
    {
      name: "L196 compare server A not found",
      setup: () => {
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        });
        (getServers as jest.Mock).mockReturnValue([]);
      },
      args: "server-1",
      opts: { compare: "a:b" },
    },
    {
      name: "L197 compare server B not found",
      setup: () => {
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        });
        (getServers as jest.Mock).mockReturnValue([
          { name: "a", ip: "1.1.1.1" },
        ]);
      },
      args: "server-1",
      opts: { compare: "a:b" },
    },
    {
      name: "L203 compare pair failure",
      setup: () => {
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        });
        (getServers as jest.Mock).mockReturnValue([
          { name: "a", ip: "1.1.1.1" },
          { name: "b", ip: "2.2.2.2" },
        ]);
        (resolveAuditPair as jest.Mock).mockResolvedValue({
          success: false,
          error: "x",
        });
      },
      args: "server-1",
      opts: { compare: "a:b" },
    },
    {
      name: "L220 watch interval invalid",
      setup: () =>
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        }),
      args: "server-1",
      opts: { watch: "-1" },
    },
    {
      name: "L287 invalid framework (1st guard)",
      setup: () => {
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        });
        (runAudit as jest.Mock).mockResolvedValue({
          success: true,
          data: {
            overallScore: 80,
            serverIp: "1.1.1.1",
            auditVersion: "1",
            categories: [],
            checks: [],
            quickWins: [],
          },
        });
      },
      args: "server-1",
      opts: { framework: "bogus" },
    },
    {
      name: "L304 invalid framework (2nd guard)",
      setup: () => {
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        });
        (runAudit as jest.Mock).mockResolvedValue({
          success: true,
          data: {
            overallScore: 80,
            serverIp: "1.1.1.1",
            auditVersion: "1",
            categories: [],
            checks: [],
            quickWins: [],
          },
        });
      },
      args: "server-1",
      opts: { framework: "invalid-key" },
    },
    {
      name: "L330 invalid profile",
      setup: () => {
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        });
        (runAudit as jest.Mock).mockResolvedValue({
          success: true,
          data: {
            overallScore: 80,
            serverIp: "1.1.1.1",
            auditVersion: "1",
            categories: [],
            checks: [],
            quickWins: [],
          },
        });
      },
      args: "server-1",
      opts: { profile: "bogus" },
    },
    {
      name: "L421 --threshold not a number (1st)",
      setup: () => {
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        });
        (runAudit as jest.Mock).mockResolvedValue({
          success: true,
          data: {
            overallScore: 50,
            serverIp: "1.1.1.1",
            auditVersion: "1",
            categories: [],
            checks: [],
            quickWins: [],
          },
        });
      },
      args: "server-1",
      opts: { threshold: "abc" },
    },
    {
      name: "L454 --threshold not a number (2nd)",
      setup: () => {
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        });
        (runAudit as jest.Mock).mockResolvedValue({
          success: true,
          data: {
            overallScore: 50,
            serverIp: "1.1.1.1",
            auditVersion: "1",
            categories: [],
            checks: [],
            quickWins: [],
          },
        });
      },
      args: "server-1",
      opts: { threshold: "xyz", summary: true },
    },
    {
      name: "L458 score below threshold (already sets exitCode)",
      setup: () => {
        (resolveServer as jest.Mock).mockResolvedValue({
          ip: "1.1.1.1",
          name: "server-1",
          platform: "bare",
        });
        (runAudit as jest.Mock).mockResolvedValue({
          success: true,
          data: {
            overallScore: 50,
            serverIp: "1.1.1.1",
            auditVersion: "1",
            categories: [],
            checks: [],
            quickWins: [],
          },
        });
      },
      args: "server-1",
      opts: { threshold: "99" },
    },
  ];

  test.each(cases)("$name → process.exitCode === 1", async ({ setup, args, opts }) => {
    setup?.();
    await auditCommand(args, opts);
    expect(process.exitCode).toBe(1);
  });
});
