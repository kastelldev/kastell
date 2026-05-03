import { raw, type SshCommand } from "../../utils/sshCommand.js";

export function buildUnattendedUpgradesCommand(): SshCommand {
  const periodicConfig = [
    'APT::Periodic::Update-Package-Lists "1";',
    'APT::Periodic::Unattended-Upgrade "1";',
    'APT::Periodic::AutocleanInterval "7";',
  ].join("\\n");

  return raw(
    [
      "DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades",
      `printf '${periodicConfig}\\n' > /etc/apt/apt.conf.d/20auto-upgrades`,
    ].join(" && "),
  );
}

export function buildResourceLimitsCommand(): SshCommand {
  const limitsContent = [
    "* soft nproc 1024",
    "* hard nproc 2048",
    "* soft nofile 65536",
    "* hard nofile 65536",
    "root soft nproc unlimited",
    "root hard nproc unlimited",
  ].join("\\n");

  return raw(`printf '${limitsContent}\\n' > /etc/security/limits.d/99-kastell.conf`);
}

export function buildServiceDisableCommand(): SshCommand {
  const services = ["bluetooth", "avahi-daemon", "cups", "rpcbind"];
  const disableScript = services
    .map(
      (s) =>
        `systemctl list-unit-files '${s}.service' 2>/dev/null | grep -q '${s}' && systemctl stop ${s} && systemctl disable ${s} 2>/dev/null || true`,
    )
    .join("; ");
  return raw(disableScript);
}

export function buildAptValidationCommand(): SshCommand {
  const aptConf = [
    'APT::Get::AllowUnauthenticated "false";',
    'Acquire::AllowInsecureRepositories "false";',
    'Acquire::AllowDowngradeToInsecureRepositories "false";',
  ].join("\\n");

  return raw(`printf '${aptConf}\\n' > /etc/apt/apt.conf.d/99-kastell-apt.conf`);
}

export function buildLogRetentionCommand(): SshCommand {
  const logrotateConf = [
    "/var/log/syslog",
    "{",
    "    daily",
    "    missingok",
    "    rotate 90",
    "    compress",
    "    delaycompress",
    "    notifempty",
    "    postrotate",
    "        /usr/lib/rsyslog/rsyslog-rotate",
    "    endscript",
    "}",
  ].join("\\n");

  return raw(
    [
      "DEBIAN_FRONTEND=noninteractive apt-get install -y logrotate",
      "systemctl enable rsyslog 2>/dev/null || true",
      "systemctl start rsyslog 2>/dev/null || true",
      `printf '${logrotateConf}\\n' > /etc/logrotate.d/99-kastell-syslog`,
      "systemctl enable logrotate.timer 2>/dev/null || true",
    ].join(" && "),
  );
}

export function buildCronAccessCommand(): SshCommand {
  return raw(
    [
      "echo root > /etc/cron.allow",
      "chmod 600 /etc/cron.allow",
      "echo root > /etc/at.allow",
      "chmod 600 /etc/at.allow",
      "touch /etc/at.deny",
      "chmod 600 /etc/at.deny",
    ].join(" && "),
  );
}

export function buildBackupPermissionsCommand(): SshCommand {
  return raw(
    [
      "DEBIAN_FRONTEND=noninteractive apt-get install -y rsync",
      "mkdir -p /var/backups",
      "chmod 700 /var/backups",
      "chown root:root /var/backups",
    ].join(" && "),
  );
}
