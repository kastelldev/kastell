/**
 * Integration test for F-015: --threshold exit code propagation.
 *
 * Tests that `process.exitCode = 1` set inside auditCommand (when score < threshold)
 * is correctly propagated to the CLI process exit code.
 *
 * Approach: direct auditCommand() call — wrapper behavior already tested in
 * audit-exit-code-policy.test.ts (Task 5). This test verifies propagation chain:
 * auditCommand -> process.exitCode -> CLI exit code.
 */
import * as auditCore from "../../src/core/audit/index";
import * as auditHistory from "../../src/core/audit/history";
import * as formatters from "../../src/core/audit/formatters/index";
import * as auditFix from "../../src/core/audit/fix";
import * as listChecksModule from "../../src/core/audit/listChecks";
import * as watchModule from "../../src/core/audit/watch";
import * as serverSelectModule from "../../src/utils/serverSelect";
import * as ssh from "../../src/utils/ssh";

jest.mock("../../src/core/audit/index");
jest.mock("../../src/core/audit/history");
jest.mock("../../src/core/audit/formatters/index");
jest.mock("../../src/core/audit/fix");
jest.mock("../../src/core/audit/listChecks");
jest.mock("../../src/core/audit/watch");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/audit/regression");
jest.mock("../../src/core/audit/compliance/scoring");
jest.mock("../../src/core/audit/formatters/trend");
jest.mock("../../src/core/audit/filter");
jest.mock("../../src/core/audit/formatters/compliance");
jest.mock("../../src/utils/logger.js");

import { auditCommand } from "../../src/commands/audit.js";
import * as formattersModule from "../../src/core/audit/formatters/index";
import * as filterModule from "../../src/core/audit/filter";

const FIXTURE_SERVER = "fixture-server";
const mockedAuditCore = auditCore as jest.Mocked<typeof auditCore>;
const mockedServerSelect = serverSelectModule as jest.Mocked<typeof serverSelectModule>;
const mockedFormatters = formattersModule as jest.Mocked<typeof formattersModule>;
const mockedFilter = filterModule as jest.Mocked<typeof filterModule>;

describe("audit --threshold propagation (F-015)", () => {
  beforeEach(() => {
    process.exitCode = 0;
    jest.clearAllMocks();
  });
  afterEach(() => {
    process.exitCode = 0;
  });

  it("sets exitCode=1 when score is below threshold", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue({
      id: "fixture-server",
      name: FIXTURE_SERVER,
      provider: "hetzner" as const,
      ip: "127.0.0.1",
      region: "fsn1",
      size: "cx22",
      createdAt: "2026-01-01",
      mode: "bare" as const,
    });
    mockedAuditCore.runAudit.mockResolvedValue({
      success: true,
      data: {
        overallScore: 64,
        serverIp: "127.0.0.1",
        serverName: FIXTURE_SERVER,
        timestamp: new Date().toISOString(),
        checks: [],
        quickWins: [],
        compliance: {},
      },
    } as unknown as ReturnType<typeof auditCore.runAudit>);
    mockedFormatters.selectFormatter.mockResolvedValue(() => "Score: 64");
    mockedFilter.filterAuditResult.mockImplementation((r) => r);
    mockedFilter.buildFilterAnnotation.mockReturnValue("");

    await auditCommand(FIXTURE_SERVER, { threshold: "99" });

    expect(process.exitCode).toBe(1);
  });

  it("leaves exitCode=0 when score meets threshold", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue({
      id: "fixture-server",
      name: FIXTURE_SERVER,
      provider: "hetzner" as const,
      ip: "127.0.0.1",
      region: "fsn1",
      size: "cx22",
      createdAt: "2026-01-01",
      mode: "bare" as const,
    });
    mockedAuditCore.runAudit.mockResolvedValue({
      success: true,
      data: {
        overallScore: 80,
        serverIp: "127.0.0.1",
        serverName: FIXTURE_SERVER,
        timestamp: new Date().toISOString(),
        checks: [],
        quickWins: [],
        compliance: {},
      },
    } as unknown as ReturnType<typeof auditCore.runAudit>);
    mockedFormatters.selectFormatter.mockResolvedValue(() => "Score: 80");
    mockedFilter.filterAuditResult.mockImplementation((r) => r);
    mockedFilter.buildFilterAnnotation.mockReturnValue("");

    await auditCommand(FIXTURE_SERVER, { threshold: "50" });

    expect(process.exitCode).toBe(0);
  });
});
