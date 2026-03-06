# Requirements: Kastell

**Defined:** 2026-03-05
**Core Value:** Autonomous server security and maintenance across multiple cloud providers

## v1.3 Requirements

Requirements for Kastell Rebrand + Dokploy Adapter release. Each maps to roadmap phases.

### Rebrand

- [x] **BRAND-01**: CLI komutu `kastell` olarak calisir (`kastell --version`, `kastell init`, vb.)
- [x] **BRAND-02**: Config path `~/.kastell` kullanilir, `~/.quicklify` varsa otomatik migrate edilir
- [x] **BRAND-03**: Tum src/ icinde "quicklify" referanslari "kastell" olarak guncellenir
- [x] **BRAND-04**: Test dosyalarinda "quicklify" referanslari "kastell" olarak guncellenir
- [x] **BRAND-05**: LICENSE dosyasi MIT'den Apache 2.0'a gecer, NOTICE dosyasi olusturulur
- [x] **BRAND-06**: README.md, README.tr.md, CHANGELOG.md, SECURITY.md, CONTRIBUTING.md, llms.txt guncellenir
- [x] **BRAND-07**: GitHub Actions workflow'lari guncellenir
- [x] **BRAND-08**: MCP server adi "kastell" olarak guncellenir
- [x] **BRAND-09**: Environment variable'lar `KASTELL_*` prefix'i kullanir (eski `QUICKLIFY_*` uyariyla desteklenir)
- [x] **BRAND-10**: npm'de `kastell@1.3.0` yayinlanir, `quicklify` deprecated olarak isaretlenir

### Adapter Foundation

- [x] **ADAPT-01**: `PlatformAdapter` interface tanimlanir (cloudInit, healthCheck, backup, status metodlari)
- [x] **ADAPT-02**: `CoolifyAdapter` mevcut Coolify logic'inden refactor edilir (davranis degisikligi sifir)
- [x] **ADAPT-03**: `ServerRecord` tipi `platform` alani kazanir, geriye donuk uyumluluk korunur
- [x] **ADAPT-04**: `getAdapter(platform)` factory fonksiyonu olusturulur
- [x] **ADAPT-05**: `core/deploy.ts`, `core/status.ts`, `core/backup.ts` adapter uzerinden calisir
- [x] **ADAPT-06**: `modeGuard.ts` platform-aware hale gelir (`requireManagedMode()`)
- [x] **ADAPT-07**: Mevcut 2099 test gecmeye devam eder (sifir regresyon)

### Dokploy

- [x] **DOKP-01**: `DokployAdapter` implement edilir (PlatformAdapter interface)
- [x] **DOKP-02**: Dokploy cloud-init script ile sunucu provision edilir
- [x] **DOKP-03**: Dokploy health check calisir (API key ile /api/admin.getOne)
- [x] **DOKP-04**: Dokploy backup SSH + SCP ile alinir (/etc/dokploy)
- [ ] **DOKP-05**: CLI'da `--platform dokploy` flag'i desteklenir
- [ ] **DOKP-06**: MCP tool'lari platform parametresi ile Dokploy'a yonlendirilir
- [ ] **DOKP-07**: Interactive menude platform secimi sunulur

## Future Requirements (v1.5+)

### Dokploy Extended

- **DOKP-F01**: Dokploy restore from backup
- **DOKP-F02**: Dokploy API ile proje/servis listeleme
- **DOKP-F03**: Dokploy versiyon tespiti
- **DOKP-F04**: Sunucuda Coolify/Dokploy otomatik algilama
- **DOKP-F05**: Docker Swarm servis durum izleme
- **DOKP-F06**: Dokploy container log goruntuleme

### Infrastructure

- **INFRA-F01**: GitHub repo transfer (omrfc/quicklify -> kastelldev/kastell)
- **INFRA-F02**: kastell.dev website
- **INFRA-F03**: `kastell audit` free security scan

## Out of Scope

| Feature | Reason |
|---------|--------|
| Dokploy restore | Deferred to v1.5 — requires separate research on Dokploy restore flow |
| Dokploy API proje/servis yonetimi | Dokploy'un kendi isi, Kastell guvenlik + bakim katmani |
| GitHub repo transfer | v1.3 sonrasina ertelendi — daha az risk |
| Docker Swarm cluster yonetimi | Kastell'in kapsami disi |
| Dokploy config dosyasi duzenleme | Anti-feature — Dokploy bunu kendi UI'indan yapar |
| Dokploy sertifika yonetimi | Traefik halleder |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BRAND-01 | Phase 7 | Complete |
| BRAND-02 | Phase 7 | Complete |
| BRAND-03 | Phase 7 | Complete |
| BRAND-04 | Phase 7 | Complete |
| BRAND-05 | Phase 7 | Complete |
| BRAND-06 | Phase 7 | Complete |
| BRAND-07 | Phase 7 | Complete |
| BRAND-08 | Phase 7 | Complete |
| BRAND-09 | Phase 7 | Complete |
| BRAND-10 | Phase 7 | Complete |
| ADAPT-01 | Phase 8 | Complete |
| ADAPT-02 | Phase 8 | Complete |
| ADAPT-03 | Phase 8 | Complete |
| ADAPT-04 | Phase 8 | Complete |
| ADAPT-05 | Phase 8 | Complete |
| ADAPT-06 | Phase 8 | Complete |
| ADAPT-07 | Phase 8 | Complete |
| DOKP-01 | Phase 9 | Complete |
| DOKP-02 | Phase 9 | Complete |
| DOKP-03 | Phase 9 | Complete |
| DOKP-04 | Phase 9 | Complete |
| DOKP-05 | Phase 9 | Pending |
| DOKP-06 | Phase 9 | Pending |
| DOKP-07 | Phase 9 | Pending |

**Coverage:**
- v1.3 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0

---
*Requirements defined: 2026-03-05*
*Last updated: 2026-03-05 — Phase 7 complete (BRAND-01 through BRAND-10 all complete)*
