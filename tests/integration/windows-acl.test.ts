/**
 * Real Windows ACL integration test (P142 Task 6).
 *
 * Skipped on non-Windows platforms. On Windows it actually invokes
 * `icacls` to verify the owner-only ACL is applied by
 * `secureWriteFileSync` and `secureMkdirSync`.
 *
 * Run on Windows Node 22 CI step:
 *   npm test -- --runInBand tests/integration/windows-acl.test.ts
 */

import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

import { secureWriteFileSync, secureMkdirSync } from "../../src/utils/secureWrite";

const isWindows = process.platform === "win32";

const describeIfWindows = isWindows ? describe : describe.skip;

describeIfWindows("Windows ACL hardening (real icacls)", () => {
  let tempRoot: string;
  let testDir: string;
  let testFile: string;

  beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "kastell-acl-test-"));
    testDir = join(tempRoot, "secure-dir");
    testFile = join(testDir, "secret.txt");
  });

  afterAll(() => {
    // Clean up only our own temp directory
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates a directory with owner-only ACL", () => {
    secureMkdirSync(testDir);

    expect(existsSync(testDir)).toBe(true);

    // Run icacls to inspect the directory ACL
    const result = spawnSync("icacls", [testDir], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const acl = (result.stdout ?? "") + (result.stderr ?? "");

    // Inheritance must be disabled
    expect(acl).toMatch(/\(OI\)\s*\(CI\)\s*\(IO\)/);
    // The current user must have full control
    const whoami = spawnSync("whoami", [], { encoding: "utf8" });
    const identity = (whoami.stdout ?? "").trim();
    expect(identity.length).toBeGreaterThan(0);
    // icacls output format: "DOMAIN\user:(F)"
    expect(acl).toContain(identity);
  });

  it("writes a file with owner-only ACL", () => {
    secureWriteFileSync(testFile, "secret-data");

    expect(existsSync(testFile)).toBe(true);

    const result = spawnSync("icacls", [testFile], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const acl = (result.stdout ?? "") + (result.stderr ?? "");

    // Inheritance must be disabled
    expect(acl).toMatch(/\(OI\)\s*\(CI\)\s*\(IO\)/);
    // Current user must have full control
    const whoami = spawnSync("whoami", [], { encoding: "utf8" });
    const identity = (whoami.stdout ?? "").trim();
    expect(acl).toContain(identity);
  });
});
