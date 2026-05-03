import { raw, type SshCommand } from "../../utils/sshCommand.js";
import { WEAK_CIPHERS, WEAK_MACS, WEAK_KEX } from "../../constants.js";

export function buildLoginBannersCommand(): SshCommand {
  const bannerText = "Authorized access only. All activity is monitored and logged.";
  return raw(
    [
      `printf '${bannerText}\\n' > /etc/issue`,
      `printf '${bannerText}\\n' > /etc/issue.net`,
      `printf '${bannerText}\\n' > /etc/motd`,
      `grep -qE '^Banner' /etc/ssh/sshd_config || echo 'Banner /etc/issue.net' >> /etc/ssh/sshd_config`,
      "systemctl restart ssh 2>/dev/null || systemctl restart sshd",
    ].join(" && "),
  );
}

export function buildSshCipherCommand(): SshCommand {
  const cipherBlacklist = WEAK_CIPHERS.map((c) => `-${c}`).join(",");
  const macBlacklist = WEAK_MACS.map((m) => `-${m}`).join(",");
  const kexBlacklist = WEAK_KEX.map((k) => `-${k}`).join(",");

  return raw(
    [
      "cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-cipher",
      "sed -i '/^Ciphers[ \\t]/d; /^MACs[ \\t]/d; /^KexAlgorithms[ \\t]/d' /etc/ssh/sshd_config",
      `printf '\\nCiphers ${cipherBlacklist}\\nMACs ${macBlacklist}\\nKexAlgorithms ${kexBlacklist}\\n' >> /etc/ssh/sshd_config`,
      "if sshd -t; then systemctl restart sshd; else cp /etc/ssh/sshd_config.bak-cipher /etc/ssh/sshd_config && echo 'SSH cipher hardening rolled back: sshd -t failed' >&2 && exit 1; fi",
    ].join(" && "),
  );
}

export function buildSshFineTuningCommand(): SshCommand {
  const directives: [string, string][] = [
    ["ClientAliveInterval", "300"],
    ["ClientAliveCountMax", "3"],
    ["LoginGraceTime", "60"],
    ["AllowAgentForwarding", "no"],
    ["X11Forwarding", "no"],
    ["MaxStartups", "10:30:60"],
    ["StrictModes", "yes"],
    ["PermitUserEnvironment", "no"],
    ["LogLevel", "VERBOSE"],
    ["UseDNS", "no"],
    ["PrintMotd", "no"],
    ["IgnoreRhosts", "yes"],
    ["HostbasedAuthentication", "no"],
    ["MaxSessions", "10"],
    ["PermitEmptyPasswords", "no"],
  ];
  const sedLines = directives.map(
    ([key, val]) =>
      `grep -qE '^#?${key}' /etc/ssh/sshd_config && sed -i 's/^#\\?${key}.*/${key} ${val}/' /etc/ssh/sshd_config || echo '${key} ${val}' >> /etc/ssh/sshd_config`,
  );
  return raw(
    [
      "cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-finetune",
      ...sedLines,
      "if sshd -t; then systemctl restart sshd 2>/dev/null || systemctl restart ssh; else cp /etc/ssh/sshd_config.bak-finetune /etc/ssh/sshd_config && echo 'SSH fine-tuning rolled back' >&2 && exit 1; fi",
    ].join(" && "),
  );
}
