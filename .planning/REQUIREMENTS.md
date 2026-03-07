# Requirements: Kastell v1.4

**Defined:** 2026-03-07
**Core Value:** Autonomous server security and maintenance across multiple cloud providers

## v1.4 Requirements

Requirements for v1.4 release. Each maps to roadmap phases.

### Dokploy Lifecycle

- [x] **DOKP-01**: User can update Dokploy on a managed server via `kastell update`
- [x] **DOKP-02**: User can run full maintenance cycle on Dokploy server via `kastell maintain`
- [x] **DOKP-03**: User can view Dokploy container logs via `kastell logs`

### Bug Fixes

- [x] **BUGF-01**: User can use SCP operations on Windows without path resolution failure
- [x] **BUGF-02**: User can view accurate server metrics on non-English locale servers
- [x] **BUGF-03**: User can get correct security audit results on Ubuntu 22.04+ with Include directives

### Developer Experience

- [x] **DX-01**: User can preview destructive command effects with `--dry-run` flag
- [x] **DX-02**: User can generate shell completions via `kastell completions bash|zsh|fish`
- [x] **DX-03**: User gets clear validation errors for malformed YAML config files
- [x] **DX-04**: User sees new version notification when running `kastell --version`

### TUI

- [ ] **TUI-01**: User sees branded ASCII logo in interactive menu
- [ ] **TUI-02**: User sees emoji icons on menu categories
- [ ] **TUI-03**: User sees tooltip descriptions on menu items
- [ ] **TUI-04**: User can search/filter menu items by typing

### Documentation

- [ ] **DOCS-01**: README.md and README.tr.md accurately reflect all v1.4 features, Dokploy support, and current test counts

## Future Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Dokploy (v1.5)

- **DOKP-04**: User can restore Dokploy backups
- **DOKP-05**: System auto-detects whether server runs Coolify or Dokploy
- **DOKP-06**: System detects Dokploy version via API

### TUI (Deferred)

- **TUI-05**: User sees live health panel in interactive menu (latency risk -- use cached data)

## Out of Scope

| Feature | Reason |
|---------|--------|
| TUI health panel with live SSH | High complexity, latency risk on menu open |
| Full TUI framework (blessed/ink) | Massive dependency for marginal gain |
| Dokploy API integration | SSH-based approach more reliable for now (v1.6) |
| Dokploy restore | Needs separate research (v1.5) |
| Runtime-derived shell completions | Fragile and unnecessary for 23 static commands |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DOKP-01 | Phase 11 | Complete |
| DOKP-02 | Phase 11 | Complete |
| DOKP-03 | Phase 11 | Complete |
| BUGF-01 | Phase 12 | Complete |
| BUGF-02 | Phase 12 | Complete |
| BUGF-03 | Phase 12 | Complete |
| DX-01 | Phase 13 | Complete |
| DX-02 | Phase 13 | Complete |
| DX-03 | Phase 13 | Complete |
| DX-04 | Phase 13 | Complete |
| TUI-01 | Phase 14 | Pending |
| TUI-02 | Phase 14 | Pending |
| TUI-03 | Phase 14 | Pending |
| TUI-04 | Phase 14 | Pending |
| DOCS-01 | Phase 15 | Pending |

**Coverage:**
- v1.4 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-03-07*
*Last updated: 2026-03-07 — traceability updated with phases 11-15*
