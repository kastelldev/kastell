import { raw, type SshCommand } from "../../utils/sshCommand.js";

export function buildSysctlHardeningCommand(): SshCommand {
  const settings = [
    // Existing baseline settings
    "net.ipv4.conf.all.accept_redirects=0",
    "net.ipv4.conf.default.accept_redirects=0",
    "net.ipv4.conf.all.accept_source_route=0",
    "net.ipv4.conf.default.accept_source_route=0",
    "net.ipv4.conf.all.log_martians=1",
    "net.ipv4.tcp_syncookies=1",
    "kernel.randomize_va_space=2",
    "net.ipv4.icmp_echo_ignore_broadcasts=1",
    // Deep kernel hardening (CIS L2)
    "kernel.dmesg_restrict=1",
    "kernel.kptr_restrict=1",
    "fs.suid_dumpable=0",
    "net.core.bpf_jit_harden=1",
    "kernel.unprivileged_bpf_disabled=1",
    // Reverse path filter — loose mode (2) to not break Docker bridge networking
    "net.ipv4.conf.all.rp_filter=2",
    "net.ipv4.conf.default.rp_filter=2",
    // Disable ICMP redirect sending
    "net.ipv4.conf.all.send_redirects=0",
    "net.ipv4.conf.default.send_redirects=0",
    // Disable secure redirects
    "net.ipv4.conf.all.secure_redirects=0",
    "net.ipv4.conf.default.secure_redirects=0",
    // IPv6 redirect hardening
    "net.ipv6.conf.all.accept_redirects=0",
    "net.ipv6.conf.default.accept_redirects=0",
  ].join("\\n");

  return raw(
    [
      `printf '${settings}\\n' > /etc/sysctl.d/99-kastell.conf`,
      "sysctl -p /etc/sysctl.d/99-kastell.conf 2>/dev/null || true",
    ].join(" && "),
  );
}

export function buildCloudMetaBlockCommand(): SshCommand {
  return raw(
    [
      "ufw deny out to 169.254.169.254",
      "ufw deny in from 169.254.169.254",
    ].join(" && "),
  );
}

export function buildDnsSecurityCommand(): SshCommand {
  const dropinContent = ["[Resolve]", "DNSSEC=yes", "DNSOverTLS=opportunistic"].join("\\n");

  return raw(
    [
      "cp /etc/systemd/resolved.conf /etc/systemd/resolved.conf.kastell.bak 2>/dev/null || true",
      "mkdir -p /etc/systemd/resolved.conf.d",
      `printf '${dropinContent}\\n' > /etc/systemd/resolved.conf.d/99-kastell-dns.conf`,
      "systemctl restart systemd-resolved",
      "dig google.com +timeout=5 +tries=1 @127.0.0.53 >/dev/null 2>&1",
    ].join(" && "),
  );
}

export function buildDnsRollbackCommand(): SshCommand {
  return raw(
    [
      "rm -f /etc/systemd/resolved.conf.d/99-kastell-dns.conf",
      "systemctl restart systemd-resolved",
    ].join(" && "),
  );
}
