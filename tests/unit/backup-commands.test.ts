/**
 * Unit tests for backup-commands.ts pure SSH command builders.
 * All functions are pure (no I/O) — they return SshCommand strings only.
 */

import {
  buildPgDumpCommand,
  buildConfigTarCommand,
  buildCleanupCommand,
  buildCoolifyVersionCommand,
  buildStopCoolifyCommand,
  buildStartCoolifyCommand,
  buildStartDbCommand,
  buildRestoreDbCommand,
  buildRestoreConfigCommand,
  buildBareConfigTarCommand,
  buildBareRestoreConfigCommand,
  buildBareCleanupCommand,
} from "../../src/core/backup-commands.js";

describe("Coolify backup command builders", () => {
  it("buildPgDumpCommand should contain pg_dump and gzip", () => {
    const cmd = buildPgDumpCommand();
    expect(cmd).toContain("pg_dump");
    expect(cmd).toContain("gzip");
    expect(cmd).toContain("coolify-backup.sql.gz");
  });

  it("buildConfigTarCommand should target coolify source directory", () => {
    const cmd = buildConfigTarCommand();
    expect(cmd).toContain("coolify-config.tar.gz");
    expect(cmd).toContain("/data/coolify/source");
    expect(cmd).toContain(".env");
  });

  it("buildCleanupCommand should remove coolify temp files", () => {
    const cmd = buildCleanupCommand();
    expect(cmd).toContain("rm -f");
    expect(cmd).toContain("coolify-backup.sql.gz");
    expect(cmd).toContain("coolify-config.tar.gz");
  });

  it("buildCoolifyVersionCommand should inspect coolify container", () => {
    const cmd = buildCoolifyVersionCommand();
    expect(cmd).toContain("docker inspect coolify");
  });
});

describe("Coolify restore command builders", () => {
  it("buildStopCoolifyCommand should use docker compose stop", () => {
    const cmd = buildStopCoolifyCommand();
    expect(cmd).toContain("docker compose");
    expect(cmd).toContain("stop");
    expect(cmd).toContain("/data/coolify/source");
  });

  it("buildStartCoolifyCommand should use docker compose up", () => {
    const cmd = buildStartCoolifyCommand();
    expect(cmd).toContain("docker compose");
    expect(cmd).toContain("up -d");
    expect(cmd).toContain("/data/coolify/source");
  });

  it("buildStartDbCommand should start postgres with sleep", () => {
    const cmd = buildStartDbCommand();
    expect(cmd).toContain("postgres");
    expect(cmd).toContain("sleep 3");
  });

  it("buildRestoreDbCommand should gunzip and pipe to psql", () => {
    const cmd = buildRestoreDbCommand();
    expect(cmd).toContain("gunzip");
    expect(cmd).toContain("psql");
    expect(cmd).toContain("coolify-backup.sql.gz");
  });

  it("buildRestoreConfigCommand should extract tar to coolify source", () => {
    const cmd = buildRestoreConfigCommand();
    expect(cmd).toContain("tar xzf");
    expect(cmd).toContain("coolify-config.tar.gz");
    expect(cmd).toContain("/data/coolify/source");
  });
});

describe("Bare server backup command builders", () => {
  it("buildBareConfigTarCommand should include key config paths", () => {
    const cmd = buildBareConfigTarCommand();
    expect(cmd).toContain("bare-config.tar.gz");
    expect(cmd).toContain("etc/ssh/sshd_config");
    expect(cmd).toContain("etc/ufw");
  });

  it("buildBareConfigTarCommand should use --ignore-failed-read for safety", () => {
    const cmd = buildBareConfigTarCommand();
    expect(cmd).toContain("--ignore-failed-read");
  });

  it("buildBareRestoreConfigCommand should extract to root", () => {
    const cmd = buildBareRestoreConfigCommand();
    expect(cmd).toContain("tar xzf");
    expect(cmd).toContain("bare-config.tar.gz");
    expect(cmd).toContain("-C /");
  });

  it("buildBareCleanupCommand should remove bare temp file", () => {
    const cmd = buildBareCleanupCommand();
    expect(cmd).toContain("rm -f");
    expect(cmd).toContain("bare-config.tar.gz");
  });
});
