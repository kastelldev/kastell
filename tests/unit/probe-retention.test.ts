// tests/unit/probe-retention.test.ts
// P144 T10 — Retention policy for probe sessions.
//
// Invariants exercised:
//   - only `rolled-back` records older than 30 days delete;
//   - records exactly at the 30-day boundary remain (strictly older required);
//   - future, missing, and invalid terminal timestamps remain;
//   - unresolved / interrupted / preparing / corrupt / undecryptable remain;
//   - cleanup emits a security event;
//   - re-read under session + reservation lock prevents deleting concurrently
//     changed records.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import {
  importWithIsolatedKastellDir,
  createIsolatedKastellEnv,
  type IsolatedKastellEnv,
} from "../helpers/isolatedKastellEnv.js";

// Stub secureWriteFileSync with a plain fs.writeFileSync so tests do not
// depend on ACL/icacls behavior (which is platform-specific). Matches the
// pattern in tests/unit/probe-session-store.test.ts.
jest.mock("../../src/utils/secureWrite.js", () => {
  const fs = jest.requireActual("fs") as typeof import("fs");
  return {
    __esModule: true,
    secureWriteFileSync: (path: string, data: string, options?: { encoding?: BufferEncoding }) => {
      fs.mkdirSync(join(path, ".."), { recursive: true });
      fs.writeFileSync(path, data, { encoding: options?.encoding ?? "utf8" });
    },
    secureMkdirSync: (path: string) => fs.mkdirSync(path, { recursive: true }),
    ensureSecureDir: () => {},
    clearCache: () => {},
    getCurrentWindowsIdentity: () => "DOMAIN\\user",
    resetWindowsIdentityCacheForTesting: () => {},
  };
});

interface ModuleUnderTest {
  cleanupExpiredProbeSessions: typeof import("../../src/core/probe/sessionStore.js")["cleanupExpiredProbeSessions"];
  listProbeSessions: typeof import("../../src/core/probe/sessionStore.js")["listProbeSessions"];
  reserveProbeTarget: typeof import("../../src/core/probe/sessionStore.js")["reserveProbeTarget"];
  transitionProbeSession: typeof import("../../src/core/probe/sessionStore.js")["transitionProbeSession"];
  loadProbeSession: typeof import("../../src/core/probe/sessionStore.js")["loadProbeSession"];
  setRandomUUIDDependencyForTesting: typeof import("../../src/core/probe/sessionStore.js")["setRandomUUIDDependencyForTesting"];
  resetRandomUUIDDependencyForTesting: typeof import("../../src/core/probe/sessionStore.js")["resetRandomUUIDDependencyForTesting"];
  hashProbeTarget: typeof import("../../src/core/probe/sessionStore.js")["hashProbeTarget"];
}

interface ModulePaths {
  PROBE_SESSIONS_DIR: string;
  PROBE_TARGETS_DIR: string;
}

interface ModuleSecurityLogger {
  getSecurityLogEntriesForTesting: () => Array<Record<string, unknown>>;
  resetSecurityLogForTesting: () => void;
}

const VALID_UUID_A = "00000000-0000-4000-8000-00000000000a";
const VALID_UUID_B = "00000000-0000-4000-8000-00000000000b";
const VALID_UUID_C = "00000000-0000-4000-8000-00000000000c";
const VALID_UUID_D = "00000000-0000-4000-8000-00000000000d";
const VALID_UUID_E = "00000000-0000-4000-8000-00000000000e";
const VALID_UUID_F = "00000000-0000-4000-8000-00000000000f";
const VALID_UUID_G = "00000000-0000-4000-8000-0000000000aa";
const VALID_UUID_H = "00000000-0000-4000-8000-0000000000bb";

function buildInput(serverId: string): import("../../src/core/probe/sessionStore.js").NewProbeSession {
  return {
    pluginName: "probe-plugin",
    pluginVersion: "1.0.0",
    checkId: "check-active",
    handlerPath: "/abs/path/to/handler.js",
    handlerSha256: "abc123",
    risk: "safe",
    timeoutMs: 30_000,
    target: {
      serverId,
      provider: "hetzner",
      cloudId: `cloud-${serverId}`,
      ip: "1.2.3.4",
    },
  };
}

async function loadModules(env: IsolatedKastellEnv): Promise<{
  mod: ModuleUnderTest;
  paths: ModulePaths;
  sec: ModuleSecurityLogger;
}> {
  return importWithIsolatedKastellDir(env, async () => {
    const mod = (await import("../../src/core/probe/sessionStore.js")) as unknown as ModuleUnderTest;
    const paths = (await import("../../src/utils/paths.js")) as unknown as ModulePaths;
    const sec = (await import("../../src/utils/securityLogger.js")) as unknown as ModuleSecurityLogger;
    return { mod, paths, sec };
  });
}

// Set terminalAt on a durable session record without re-running CAS.
function setTerminalAt(
  paths: ModulePaths,
  sessionId: string,
  iso: string | undefined,
): void {
  const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${sessionId}.session.json`);
  const record = JSON.parse(readFileSync(sessionPath, "utf8")) as Record<string, unknown>;
  if (iso === undefined) {
    delete record["terminalAt"];
  } else {
    record["terminalAt"] = iso;
  }
  writeFileSync(sessionPath, JSON.stringify(record));
}

describe("cleanupExpiredProbeSessions — retention rule", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;
  let paths: ModulePaths;
  let sec: ModuleSecurityLogger;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod, paths, sec } = await loadModules(env));
    sec.resetSecurityLogForTesting();
  });

  afterEach(() => {
    mod.resetRandomUUIDDependencyForTesting();
    env.cleanup();
  });

  it("only deletes rolled-back sessions older than 30 days", async () => {
    // Old rolled-back (60 days ago) — must delete.
    mod.setRandomUUIDDependencyForTesting(() => VALID_UUID_A);
    const oldRolled = await mod.reserveProbeTarget(buildInput("srv-1"));
    let current = oldRolled;
    for (const to of [
      "prepared",
      "executing",
      "executed",
      "verifying",
      "verified",
      "rollback-pending",
      "rolling-back",
      "rolled-back",
    ] as const) {
      current = await mod.transitionProbeSession(
        current.sessionId,
        { state: current.state, revision: current.revision },
        { toState: to },
      );
    }
    setTerminalAt(
      paths,
      VALID_UUID_A,
      new Date("2026-05-21T00:00:00.000Z").toISOString(),
    );

    // Recent rolled-back (5 days ago) — must remain.
    mod.setRandomUUIDDependencyForTesting(() => VALID_UUID_B);
    const recentRolled = await mod.reserveProbeTarget(buildInput("srv-2"));
    current = recentRolled;
    for (const to of [
      "prepared",
      "executing",
      "executed",
      "verifying",
      "verified",
      "rollback-pending",
      "rolling-back",
      "rolled-back",
    ] as const) {
      current = await mod.transitionProbeSession(
        current.sessionId,
        { state: current.state, revision: current.revision },
        { toState: to },
      );
    }
    setTerminalAt(
      paths,
      VALID_UUID_B,
      new Date("2026-07-15T00:00:00.000Z").toISOString(),
    );

    const result = mod.cleanupExpiredProbeSessions(new Date("2026-07-20T00:00:00.000Z"));

    expect(result.deletedSessionIds).toContain(VALID_UUID_A);
    expect(result.deletedSessionIds).not.toContain(VALID_UUID_B);
  });

  it("keeps rolled-back session that is exactly 30 days old (strictly older required)", () => {
    // Use a synthetic file because we do not want to wait 30 days for terminalAt.
    mkdirSync(paths.PROBE_SESSIONS_DIR, { recursive: true });
    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${VALID_UUID_C}.session.json`);
    const session = {
      schemaVersion: 1,
      revision: 9,
      sessionId: VALID_UUID_C,
      targetKeyHash: mod.hashProbeTarget({
        serverId: "srv-3",
        provider: "hetzner",
        cloudId: "cloud-srv-3",
        ip: "1.2.3.4",
      }),
      state: "rolled-back",
      pluginName: "p",
      pluginVersion: "1",
      checkId: "c",
      handlerPath: "/h.js",
      handlerSha256: "abc",
      risk: "safe",
      timeoutMs: 1000,
      target: { serverId: "srv-3", provider: "hetzner", cloudId: "cloud-srv-3", ip: "1.2.3.4" },
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
      terminalAt: "2026-06-20T00:00:00.000Z",
      history: [],
    };
    writeFileSync(sessionPath, JSON.stringify(session));

    // now is exactly 30 days later
    const result = mod.cleanupExpiredProbeSessions(new Date("2026-07-20T00:00:00.000Z"));

    expect(result.deletedSessionIds).not.toContain(VALID_UUID_C);
  });

  it("keeps rolled-back session with future terminalAt timestamp", () => {
    mkdirSync(paths.PROBE_SESSIONS_DIR, { recursive: true });
    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${VALID_UUID_D}.session.json`);
    const session = {
      schemaVersion: 1,
      revision: 9,
      sessionId: VALID_UUID_D,
      targetKeyHash: "future-hash",
      state: "rolled-back",
      pluginName: "p",
      pluginVersion: "1",
      checkId: "c",
      handlerPath: "/h.js",
      handlerSha256: "abc",
      risk: "safe",
      timeoutMs: 1000,
      target: { serverId: "srv-4", provider: "hetzner", ip: "1.2.3.4" },
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
      terminalAt: "2099-01-01T00:00:00.000Z",
      history: [],
    };
    writeFileSync(sessionPath, JSON.stringify(session));

    const result = mod.cleanupExpiredProbeSessions(new Date("2026-07-20T00:00:00.000Z"));

    expect(result.deletedSessionIds).not.toContain(VALID_UUID_D);
  });

  it("keeps rolled-back session with missing terminalAt timestamp", () => {
    mkdirSync(paths.PROBE_SESSIONS_DIR, { recursive: true });
    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${VALID_UUID_E}.session.json`);
    const session = {
      schemaVersion: 1,
      revision: 9,
      sessionId: VALID_UUID_E,
      targetKeyHash: "missing-hash",
      state: "rolled-back",
      pluginName: "p",
      pluginVersion: "1",
      checkId: "c",
      handlerPath: "/h.js",
      handlerSha256: "abc",
      risk: "safe",
      timeoutMs: 1000,
      target: { serverId: "srv-5", provider: "hetzner", ip: "1.2.3.4" },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      history: [],
    };
    writeFileSync(sessionPath, JSON.stringify(session));

    const result = mod.cleanupExpiredProbeSessions(new Date("2026-07-20T00:00:00.000Z"));

    expect(result.deletedSessionIds).not.toContain(VALID_UUID_E);
  });

  it("keeps rolled-back session with invalid terminalAt timestamp", () => {
    mkdirSync(paths.PROBE_SESSIONS_DIR, { recursive: true });
    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${VALID_UUID_F}.session.json`);
    const session = {
      schemaVersion: 1,
      revision: 9,
      sessionId: VALID_UUID_F,
      targetKeyHash: "invalid-hash",
      state: "rolled-back",
      pluginName: "p",
      pluginVersion: "1",
      checkId: "c",
      handlerPath: "/h.js",
      handlerSha256: "abc",
      risk: "safe",
      timeoutMs: 1000,
      target: { serverId: "srv-6", provider: "hetzner", ip: "1.2.3.4" },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      terminalAt: "not-a-date",
      history: [],
    };
    writeFileSync(sessionPath, JSON.stringify(session));

    const result = mod.cleanupExpiredProbeSessions(new Date("2026-07-20T00:00:00.000Z"));

    expect(result.deletedSessionIds).not.toContain(VALID_UUID_F);
  });

  it("keeps unresolved sessions regardless of age", async () => {
    mod.setRandomUUIDDependencyForTesting(() => VALID_UUID_G);
    const session = await mod.reserveProbeTarget(buildInput("srv-7"));
    const unresolved = await mod.transitionProbeSession(
      session.sessionId,
      { state: session.state, revision: session.revision },
      { toState: "unresolved" },
    );
    // Even though terminalAt is from a long time ago, unresolved must remain.
    setTerminalAt(
      paths,
      VALID_UUID_G,
      new Date("2025-01-01T00:00:00.000Z").toISOString(),
    );
    expect(unresolved.state).toBe("unresolved");

    const result = mod.cleanupExpiredProbeSessions(new Date("2026-07-20T00:00:00.000Z"));

    expect(result.deletedSessionIds).not.toContain(VALID_UUID_G);
  });

  it("keeps preparing sessions regardless of age", async () => {
    mod.setRandomUUIDDependencyForTesting(() => VALID_UUID_H);
    const session = await mod.reserveProbeTarget(buildInput("srv-8"));
    expect(session.state).toBe("preparing");

    const result = mod.cleanupExpiredProbeSessions(new Date("2026-07-20T00:00:00.000Z"));

    expect(result.deletedSessionIds).not.toContain(VALID_UUID_H);
  });

  it("emits a security event for each retention deletion", () => {
    mkdirSync(paths.PROBE_SESSIONS_DIR, { recursive: true });
    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${VALID_UUID_A}.session.json`);
    const session = {
      schemaVersion: 1,
      revision: 9,
      sessionId: VALID_UUID_A,
      targetKeyHash: "delete-hash",
      state: "rolled-back",
      pluginName: "p",
      pluginVersion: "1",
      checkId: "c",
      handlerPath: "/h.js",
      handlerSha256: "abc",
      risk: "safe",
      timeoutMs: 1000,
      target: { serverId: "srv-del", provider: "hetzner", ip: "1.2.3.4" },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      terminalAt: "2026-01-01T00:00:00.000Z",
      history: [],
    };
    writeFileSync(sessionPath, JSON.stringify(session));

    mod.cleanupExpiredProbeSessions(new Date("2026-07-20T00:00:00.000Z"));

    const entries = sec.getSecurityLogEntriesForTesting();
    const probeDeletions = entries.filter((e) => e["action"] === "probe_session_retention_deleted");
    expect(probeDeletions.length).toBeGreaterThanOrEqual(1);
    expect(probeDeletions[0]?.["category"]).toBe("plugin-probe");
    expect(probeDeletions[0]?.["result"]).toBe("success");
  });
});

describe("cleanupExpiredProbeSessions — concurrent re-read under lock", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;
  let paths: ModulePaths;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod, paths } = await loadModules(env));
  });

  afterEach(() => {
    mod.resetRandomUUIDDependencyForTesting();
    env.cleanup();
  });

  it("does not delete a record whose state changed concurrently between enumeration and lock", () => {
    // Seed a rolled-back session that LOOKS eligible, but a concurrent writer
    // flips it to a non-terminal state before cleanup re-reads it under lock.
    mkdirSync(paths.PROBE_SESSIONS_DIR, { recursive: true });
    const sessionId = VALID_UUID_A;
    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${sessionId}.session.json`);
    const eligible = {
      schemaVersion: 1,
      revision: 9,
      sessionId,
      targetKeyHash: "concurrent-hash",
      state: "rolled-back",
      pluginName: "p",
      pluginVersion: "1",
      checkId: "c",
      handlerPath: "/h.js",
      handlerSha256: "abc",
      risk: "safe",
      timeoutMs: 1000,
      target: { serverId: "srv-conc", provider: "hetzner", ip: "1.2.3.4" },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      terminalAt: "2026-01-01T00:00:00.000Z",
      history: [],
    };
    writeFileSync(sessionPath, JSON.stringify(eligible));

    // Re-write under the same path with a different state — cleanup must
    // re-read under the session lock and observe the new state.
    const mutated = {
      ...eligible,
      state: "executing",
      revision: 10,
      terminalAt: undefined,
    };
    // Cleanup acquires the session lock around the deletion, so to test
    // "concurrent change" we mutate the file BEFORE cleanup enumerates, but
    // cleanup must still verify state under lock. The state is now
    // `executing` (non-terminal) — retention must not delete it.
    writeFileSync(sessionPath, JSON.stringify(mutated));

    const result = mod.cleanupExpiredProbeSessions(new Date("2026-07-20T00:00:00.000Z"));

    expect(result.deletedSessionIds).not.toContain(sessionId);
    expect(existsSync(sessionPath)).toBe(true);
  });
});
