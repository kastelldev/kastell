import { ALL_MCP_TOOLS } from "../../../src/mcp/server.js";
import type { ToolFixture, ActionFixture } from "./index.js";

export { ALL_MCP_TOOLS };
export type { ToolFixture, ActionFixture };

// Placeholder imports — each will be replaced by the actual fixture files (Task A.4)
import { serverInfoFixtures } from "./serverInfo.fixtures.js";
import { serverLogsFixtures } from "./serverLogs.fixtures.js";
import { serverManageFixtures } from "./serverManage.fixtures.js";
import { serverMaintainFixtures } from "./serverMaintain.fixtures.js";
import { serverSecureFixtures } from "./serverSecure.fixtures.js";
import { serverBackupFixtures } from "./serverBackup.fixtures.js";
import { serverProvisionFixtures } from "./serverProvision.fixtures.js";
import { serverAuditFixtures } from "./serverAudit.fixtures.js";
import { serverEvidenceFixtures } from "./serverEvidence.fixtures.js";
import { serverGuardFixtures } from "./serverGuard.fixtures.js";
import { serverDoctorFixtures } from "./serverDoctor.fixtures.js";
import { serverLockFixtures } from "./serverLock.fixtures.js";
import { serverFleetFixtures } from "./serverFleet.fixtures.js";
import { serverFixFixtures } from "./serverFix.fixtures.js";
import { serverExplainFixtures } from "./serverExplain.fixtures.js";
import { serverCompareFixtures } from "./serverCompare.fixtures.js";
import { serverPluginFixtures } from "./serverPlugin.fixtures.js";

export const FIXTURES: Record<string, ToolFixture> = {
  server_info:      serverInfoFixtures,
  server_logs:      serverLogsFixtures,
  server_manage:    serverManageFixtures,
  server_maintain:  serverMaintainFixtures,
  server_secure:    serverSecureFixtures,
  server_backup:    serverBackupFixtures,
  server_provision: serverProvisionFixtures,
  server_audit:     serverAuditFixtures,
  server_evidence:  serverEvidenceFixtures,
  server_guard:     serverGuardFixtures,
  server_doctor:    serverDoctorFixtures,
  server_lock:      serverLockFixtures,
  server_fleet:     serverFleetFixtures,
  server_fix:       serverFixFixtures,
  server_explain:   serverExplainFixtures,
  server_compare:   serverCompareFixtures,
  server_plugin:    serverPluginFixtures,
};

export function assertCoverage(): void {
  const registered = Object.keys(ALL_MCP_TOOLS).sort();
  const fixtured = Object.keys(FIXTURES).sort();
  const missing = registered.filter((n) => !fixtured.includes(n));
  const extra = fixtured.filter((n) => !registered.includes(n));
  if (missing.length > 0) {
    throw new Error(`Missing fixture for tool(s): ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    throw new Error(`Fixture for unregistered tool(s): ${extra.join(", ")}`);
  }
}