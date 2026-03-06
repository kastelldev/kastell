# Phase 9: Dokploy Adapter - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning
**Source:** User discussion (pre-session answers)

<domain>
## Phase Boundary

Phase 9 delivers DokployAdapter — PlatformAdapter interface'in ikinci implementasyonu. Kullanicilar `--platform dokploy` ile Dokploy sunucularini provision, health-check ve backup yapabilir. Coolify ile ayni CLI komutlari ve MCP tool'lari kullanilir.

Phase 8'de kurulan adapter altyapisi (PlatformAdapter interface, factory, resolvePlatform, requireManagedMode) kullanilir. Yeni interface/pattern ihtiyaci yok.

</domain>

<decisions>
## Implementation Decisions

### Cloud-Init
- Resmi Dokploy install script kullanilacak: `curl -sSL https://dokploy.com/install.sh | sh`
- CoolifyAdapter pattern'i takip edilecek: network wait, system update, install, firewall config
- Dokploy portlari: 3000 (web UI), 80, 443, 22, 2377 (Docker Swarm), 7946, 4789
- Docker Swarm init otomatik (Dokploy install script halleder)

### Health Check
- Dokploy API port 3000 uzerinden calisir
- Health check: HTTP GET ile port 3000 kontrolu (Coolify pattern ile ayni)
- API key gerektiren detayli status: `/api/admin.getOne` endpoint'i (Authorization header)

### Backup
- `/etc/dokploy` dizini tar.gz ile backup alinacak
- DB dump: Dokploy PostgreSQL container'indan pg_dump
- Manifest format: CoolifyAdapter ile tutarli (dokployVersion alani)
- Restore kapsam disi (v1.5'e birakildi — DOKP-F01)

### CLI Entegrasyonu
- `--platform dokploy` flag'i InitOptions'a eklenmeyecek — DeploymentConfig.platform zaten var
- Interactive menude platform secimi: coolify / dokploy / bare
- Factory'ye `case "dokploy"` eklenmesi yeterli

### MCP Entegrasyonu
- Mevcut MCP tool'lari platform parametresi zaten destekliyor (Phase 8)
- DokployAdapter factory'ye register olunca MCP otomatik calisir

### Claude's Discretion
- Dokploy container adi tespiti (health check / version komutu icin)
- Firewall rule detaylari (UFW vs iptables, hangi portlar)
- Cloud-init bekleme suresi (sleep saniyesi)
- Backup manifest'te ek metadata

</decisions>

<specifics>
## Specific Ideas

- CoolifyAdapter 225 satir — DokployAdapter benzer boyutta olacak
- BackupManifest.coolifyVersion alanini platform-agnostik yapmak icin `platformVersion` alani eklenebilir (veya `dokployVersion` kullanilir)
- Dokploy Docker Swarm mode kullanir — Traefik reverse proxy otomatik gelir
- Dokploy install script: `curl -sSL https://dokploy.com/install.sh | sh`

</specifics>

<deferred>
## Deferred Ideas

- DOKP-F01: Dokploy restore from backup (v1.5)
- DOKP-F02: Dokploy API ile proje/servis listeleme (v1.5)
- DOKP-F03: Dokploy versiyon tespiti (v1.5)
- DOKP-F04: Sunucuda Coolify/Dokploy otomatik algilama (v1.5)
- Docker Swarm cluster yonetimi (kapsam disi)

</deferred>

---

*Phase: 09-dokploy-adapter*
*Context gathered: 2026-03-06 via user discussion*
