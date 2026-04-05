/** Pure functions returning SshCommand values — no I/O. */

import { raw, type SshCommand } from "../utils/sshCommand.js";

const COOLIFY_COMPOSE = "cd /data/coolify/source && docker compose -f docker-compose.yml -f docker-compose.prod.yml";

// ─── Coolify Backup Commands ─────────────────────────────────────────────────

export function buildPgDumpCommand(): SshCommand {
  return raw("set -o pipefail && docker exec coolify-db pg_dump -U coolify -d coolify | gzip > /tmp/coolify-backup.sql.gz");
}

export function buildConfigTarCommand(): SshCommand {
  return raw("tar czf /tmp/coolify-config.tar.gz -C /data/coolify/source .env docker-compose.yml docker-compose.prod.yml 2>/dev/null || tar czf /tmp/coolify-config.tar.gz -C /data/coolify/source .env docker-compose.yml");
}

export function buildCleanupCommand(): SshCommand {
  return raw("rm -f /tmp/coolify-backup.sql.gz /tmp/coolify-config.tar.gz");
}

export function buildCoolifyVersionCommand(): SshCommand {
  return raw("docker inspect coolify --format '{{.Config.Image}}' 2>/dev/null | sed 's/.*://' || echo unknown");
}

// ─── Coolify Restore Commands ────────────────────────────────────────────────

export function buildStopCoolifyCommand(): SshCommand {
  return raw(`${COOLIFY_COMPOSE} stop`);
}

export function buildStartCoolifyCommand(): SshCommand {
  return raw(`${COOLIFY_COMPOSE} up -d`);
}

export function buildStartDbCommand(): SshCommand {
  return raw(`${COOLIFY_COMPOSE} up -d postgres && sleep 3`);
}

export function buildRestoreDbCommand(): SshCommand {
  return raw("gunzip -c /tmp/coolify-backup.sql.gz | docker exec -i coolify-db psql -U coolify -d coolify");
}

export function buildRestoreConfigCommand(): SshCommand {
  return raw("tar xzf /tmp/coolify-config.tar.gz -C /data/coolify/source");
}


// ─── Bare Server Backup Commands ─────────────────────────────────────────────

export function buildBareConfigTarCommand(): SshCommand {
  return raw(
    "tar czf /tmp/bare-config.tar.gz --ignore-failed-read " +
    "-C / " +
    "etc/nginx " +
    "etc/ssh/sshd_config " +
    "etc/ufw " +
    "etc/fail2ban " +
    "etc/crontab " +
    "etc/apt/apt.conf.d/50unattended-upgrades " +
    "2>/dev/null || tar czf /tmp/bare-config.tar.gz --ignore-failed-read -C / etc/ssh/sshd_config",
  );
}

export function buildBareRestoreConfigCommand(): SshCommand {
  return raw("tar xzf /tmp/bare-config.tar.gz -C /");
}

export function buildBareCleanupCommand(): SshCommand {
  return raw("rm -f /tmp/bare-config.tar.gz");
}
