import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as evidenceCore from "../../../src/core/evidence.js";

// Full ServerRecord fields needed for type compatibility
const server = {
  id: "hcloud-1", name: "web-1", ip: "10.0.0.1", platform: "coolify" as const,
  provider: "hetzner" as const, region: "fsn1" as const, size: "cx22" as const,
  mode: "bare" as const, sshPort: 22, sshUser: "root",
  createdAt: "2026-05-01T00:00:00Z", lastAuditAt: null, platformStatus: "running",
};

export const serverEvidenceFixtures: ToolFixture = {
  fixtures: [
    {
      action: "collect",
      input: { action: "collect", server: "web-1" },
      setup: () => {
        const configSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const evidenceSpy = jest.spyOn(evidenceCore, "collectEvidence").mockResolvedValue({
          success: true,
          data: {
            evidenceDir: "/root/kastell-evidence/web-1-2026-05-16",
            serverName: "web-1",
            serverIp: "10.0.0.1",
            platform: "coolify",
            totalFiles: 8,
            skippedFiles: 0,
            collectedAt: "2026-05-16T00:00:00Z",
            manifestPath: "/root/kastell-evidence/web-1-2026-05-16/manifest.json",
          },
        });
        return () => { configSpy.mockRestore(); findSpy.mockRestore(); evidenceSpy.mockRestore(); };
      },
    },
  ],
};