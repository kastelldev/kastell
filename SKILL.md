---
name: kastell
description: "Server security auditing, hardening, and fleet management. 413 security checks across 29 categories (SSH, Firewall, Docker, TLS, HTTP Headers), CIS/PCI-DSS/HIPAA compliance mapping, 19-step production hardening, and 13 MCP tools. Supports Hetzner, DigitalOcean, Vultr, and Linode with Coolify, Dokploy, and bare VPS modes. Install: claude plugins add kastell"
---

# Kastell — Server Security Toolkit

CLI toolkit and Claude Code plugin for provisioning, securing, and managing self-hosted servers.

## Install

```bash
claude plugins add kastell
```

## Features

- **Security Audit**: 413 checks across 29 categories with CIS/PCI-DSS/HIPAA compliance mapping
- **Production Hardening**: 19-step server lock (SSH, fail2ban, UFW, sysctl, auditd, AIDE, Docker)
- **Fleet Management**: Monitor multiple servers from a single dashboard
- **4 Cloud Providers**: Hetzner, DigitalOcean, Vultr, Linode
- **3 Platform Modes**: Coolify, Dokploy, bare VPS
- **Forensic Evidence**: Collection with SHA256 checksums
- **Health Analysis**: Proactive disk trending, swap detection, stale package alerts

## MCP Tools (13)

| Tool | Purpose |
|------|---------|
| `server_audit` | 413-check security scan |
| `server_lock` | 19-step production hardening |
| `server_secure` | SSH, firewall, domain/SSL management |
| `server_doctor` | Proactive health analysis |
| `server_fleet` | Fleet-wide security dashboard |
| `server_info` | Server status and health checks |
| `server_logs` | Log retrieval and system metrics |
| `server_guard` | Autonomous security monitoring |
| `server_evidence` | Forensic evidence collection |
| `server_backup` | Backup/restore and cloud snapshots |
| `server_provision` | New server provisioning |
| `server_manage` | Server registration and lifecycle |
| `server_maintain` | Updates, restarts, maintenance |

## Links

- Website: [kastell.dev](https://kastell.dev)
- npm: [kastell](https://www.npmjs.com/package/kastell)
- GitHub: [kastelldev/kastell](https://github.com/kastelldev/kastell)
