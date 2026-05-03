import { raw, type SshCommand } from "../../utils/sshCommand.js";

export function buildAccountLockCommand(): SshCommand {
  return raw(
    [
      "for user in $(awk -F: '($3 >= 1000 && $3 < 65534 && ($7 == \"/bin/bash\" || $7 == \"/bin/sh\")) {print $1}' /etc/passwd); do",
      "  if ! who | grep -q \"^$user \"; then",
      "    passwd -l $user 2>/dev/null || true",
      "  fi",
      "done",
    ].join(" "),
  );
}

export function buildPwqualityCommand(): SshCommand {
  const conf = [
    "minlen = 14",
    "dcredit = -1",
    "ucredit = -1",
    "lcredit = -1",
    "ocredit = -1",
    "maxrepeat = 3",
  ].join("\\n");

  return raw(
    [
      "apt-cache show libpam-pwquality >/dev/null 2>&1 || { echo 'WARN: libpam-pwquality not available, skipping'; exit 0; }",
      "DEBIAN_FRONTEND=noninteractive apt-get install -y libpam-pwquality",
      `printf '${conf}\\n' > /etc/security/pwquality.conf`,
    ].join(" && "),
  );
}

export function buildLoginDefsCommand(): SshCommand {
  const entries: [string, string, string][] = [
    ["PASS_MIN_DAYS", "1", "/etc/login.defs"],
    ["PASS_WARN_AGE", "7", "/etc/login.defs"],
    ["ENCRYPT_METHOD", "SHA512", "/etc/login.defs"],
    ["UMASK", "027", "/etc/login.defs"],
  ];
  const lines = entries.map(
    ([key, val, file]) =>
      `grep -qE '^${key}' ${file} && sed -i 's/^${key}.*/${key} ${val}/' ${file} || echo '${key} ${val}' >> ${file}`,
  );
  const useradd = `grep -qE '^INACTIVE' /etc/default/useradd && sed -i 's/^INACTIVE.*/INACTIVE=30/' /etc/default/useradd || echo 'INACTIVE=30' >> /etc/default/useradd`;
  return raw([...lines, useradd].join(" && "));
}

export function buildFaillockCommand(): SshCommand {
  const directives: [string, string][] = [
    ["deny", "5"],
    ["unlock_time", "900"],
    ["fail_interval", "900"],
  ];
  const lines = directives.map(
    ([key, val]) =>
      `grep -qE '^${key}' /etc/security/faillock.conf 2>/dev/null && sed -i 's/^${key}.*/${key} = ${val}/' /etc/security/faillock.conf || echo '${key} = ${val}' >> /etc/security/faillock.conf`,
  );
  return raw(
    [
      "mkdir -p /etc/security",
      ...lines,
      "pam-auth-update --enable faillock 2>/dev/null || true",
    ].join(" && "),
  );
}

export function buildSudoHardeningCommand(): SshCommand {
  return raw(
    [
      "mkdir -p /etc/sudoers.d",
      `grep -qr 'log_output\\|syslog' /etc/sudoers /etc/sudoers.d/ 2>/dev/null || echo 'Defaults log_output' > /etc/sudoers.d/kastell-logging`,
      "chmod 440 /etc/sudoers.d/kastell-logging 2>/dev/null || true",
      `grep -qr 'requiretty' /etc/sudoers /etc/sudoers.d/ 2>/dev/null || echo 'Defaults requiretty' > /etc/sudoers.d/kastell-requiretty`,
      "chmod 440 /etc/sudoers.d/kastell-requiretty 2>/dev/null || true",
    ].join(" && "),
  );
}
