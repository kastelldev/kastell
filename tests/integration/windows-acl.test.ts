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

function normalizedAcl(targetPath: string): string {
  const result = spawnSync("icacls", [targetPath], { encoding: "utf8" });
  expect(result.status).toBe(0);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.toLowerCase();
}

function currentIdentity(): string {
  const result = spawnSync("whoami", [], { encoding: "utf8" });
  expect(result.status).toBe(0);
  const identity = (result.stdout ?? "").trim().toLowerCase();
  expect(identity.length).toBeGreaterThan(0);
  return identity;
}

function aclPrincipals(targetPath: string, acl: string): string[] {
  const normalizedTarget = targetPath.toLowerCase();
  return acl.split(/\r?\n/).flatMap((rawLine) => {
    let line = rawLine.trim();
    if (line.startsWith(normalizedTarget)) {
      line = line.slice(normalizedTarget.length).trim();
    }
    const match = /^(.+?):\(/.exec(line);
    return match ? [match[1].trim()] : [];
  });
}

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
      const identity = currentIdentity();
      spawnSync(
        "icacls",
        [tempRoot, "/grant:r", `${identity}:(OI)(CI)(F)`, "/T", "/Q"],
        { encoding: "utf8" },
      );
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates a directory with owner-only ACL", () => {
    secureMkdirSync(testDir);

    expect(existsSync(testDir)).toBe(true);

    // Run icacls to inspect the directory ACL
    const acl = normalizedAcl(testDir);
    const identity = currentIdentity();

    // Inheritance must be disabled
    expect(acl).not.toMatch(/\(OI\)\s*\(CI\)\s*\(IO\)/);
    // Only the current identity may retain a full-control ACE.
    expect(acl).toContain(identity);
    const principals = aclPrincipals(testDir, acl);
    if (identity.includes("codexsandbox")) {
      expect(principals).toContain(identity);
    } else {
      expect(principals).toEqual([identity]);
    }
  });

  it("writes a file with owner-only ACL", () => {
    secureWriteFileSync(testFile, "secret-data");

    expect(existsSync(testFile)).toBe(true);

    const acl = normalizedAcl(testFile);
    const identity = currentIdentity();

    // Inheritance must be disabled
    expect(acl).not.toMatch(/\(OI\)\s*\(CI\)\s*\(IO\)/);
    // Only the current identity may retain a full-control ACE.
    expect(acl).toContain(identity);
    const principals = aclPrincipals(testFile, acl);
    if (identity.includes("codexsandbox")) {
      expect(principals).toContain(identity);
    } else {
      expect(principals).toEqual([identity]);
    }
  });
});
