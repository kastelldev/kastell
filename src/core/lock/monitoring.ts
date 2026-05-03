import { raw, type SshCommand } from "../../utils/sshCommand.js";

export function buildAuditdCommand(): SshCommand {
  // Deep rules go in 50-kastell-deep.rules (sorts BEFORE 99-kastell.rules -e 2 immutability)
  const deepRules = [
    "# Identity — file integrity",
    "-w /etc/passwd -p wa -k identity",
    "-w /etc/shadow -p wa -k identity",
    "-w /etc/group -p wa -k identity",
    "-w /etc/gshadow -p wa -k identity",
    "# Privilege escalation",
    "-w /etc/sudoers -p wa -k privilege",
    "-w /etc/sudoers.d/ -p wa -k privilege",
    "-a always,exit -F arch=b64 -S setuid -S setgid -S setreuid -S setregid -k privilege",
    "# Time change",
    "-a always,exit -F arch=b64 -S adjtimex -S settimeofday -S clock_settime -k time-change",
    "-w /etc/localtime -p wa -k time-change",
    "# Login and session",
    "-w /var/log/lastlog -p wa -k logins",
    "-w /var/run/faillock/ -p wa -k logins",
    "-w /var/run/utmp -p wa -k session",
    "-w /var/log/wtmp -p wa -k session",
    "-w /var/log/btmp -p wa -k session",
    "# Network changes",
    "-a always,exit -F arch=b64 -S sethostname -S setdomainname -k network-change",
    "-w /etc/hostname -p wa -k network-change",
    "-w /etc/hosts -p wa -k network-change",
    "-w /etc/sysconfig/network -p wa -k network-change",
    "# Kernel modules",
    "-a always,exit -F arch=b64 -S init_module -S delete_module -S finit_module -k kernel-module",
    "-w /sbin/insmod -p x -k kernel-module",
    "-w /sbin/modprobe -p x -k kernel-module",
    "-w /sbin/rmmod -p x -k kernel-module",
  ].join("\\n");

  // Immutability directive in 99 — sorts AFTER 50
  const immutableRule = "-e 2";

  return raw(
    [
      "DEBIAN_FRONTEND=noninteractive apt-get install -y auditd audispd-plugins",
      "systemctl enable auditd && systemctl start auditd",
      `printf '${deepRules}\\n' > /etc/audit/rules.d/50-kastell-deep.rules`,
      `printf '${immutableRule}\\n' > /etc/audit/rules.d/99-kastell.rules`,
      "augenrules --load 2>/dev/null || true",
      "service auditd restart 2>/dev/null || systemctl restart auditd 2>/dev/null || true",
    ].join(" && "),
  );
}

export function buildAideInitCommand(): SshCommand {
  const cronScript = "#!/bin/bash\\n/usr/sbin/aide --check 2>/dev/null || true";
  return raw(
    [
      "DEBIAN_FRONTEND=noninteractive apt-get install -y aide",
      "rm -f /etc/cron.d/kastell-aide",
      `printf '${cronScript}\\n' > /etc/cron.daily/aide-check`,
      "chmod 755 /etc/cron.daily/aide-check",
      "nohup aide --init > /var/log/aide-init.log 2>&1 &",
    ].join(" && "),
  );
}
