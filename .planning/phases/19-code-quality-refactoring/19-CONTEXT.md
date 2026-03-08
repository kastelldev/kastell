# Phase 19: Code Quality Refactoring - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Dead code temizliği, orphan method kaldırma, DRY refactoring (maintain pipeline), büyük fonksiyon bölme (deployServer), naming consistency (coolifyStatus → platformStatus, QuicklifyResult → KastellResult), ortak adapter utility çıkarma ve provider error handling HOF. Yeni yetenek eklenmeyecek — sadece mevcut kodun kalitesi iyileştirilecek.

</domain>

<decisions>
## Implementation Decisions

### Dead Code Temizliği
- `logo.ts` dosyasını sil + `figlet` paketini package.json'dan tamamen kaldır (npm dep olarak da)
- `getLogCommand()` interface'den (PlatformAdapter) + her iki adapter'dan (Coolify, Dokploy) + testlerden direkt kaldır. Breaking change değil — internal API, external consumer yok
- `getCoolifyCloudInit()` fonksiyonunu cloudInit.ts'den kaldır. Hiçbir yerde import edilmiyor

### Maintain.ts DRY Refactoring
- `maintainSingleServer()` business logic tamamen `core/maintain.ts`'e taşınacak (tüm 5-step pipeline)
- Core fonksiyonu `MaintainResult` döndürecek — command sadece sonucu render edecek (spinner/logger)
- `maintainAll()` orchestration command'da kalacak — server iteration, token collection, bare server filtreleme UI katmanı işi
- Bu sayede MCP tools'dan da aynı core fonksiyonu çağrılabilir

### deployServer() Bölme Stratejisi
- 3 faza bölünecek: `createServer()` → `waitForReady()` → `postSetup()`
- deployServer() orchestrator olarak kalır — iç yapısı bu 3 fazı sırayla çağırır
- Dışarıdan çağıranlar (init.ts, MCP) sadece deployServer() çağırır (aynı API)
- Her faz bağımsız test edilebilir + deployServer() integration test olarak
- `process.exit(1)` → `KastellResult` döndürecek (mevcut core pattern'e uyumlu)

### Naming & Consistency
- `coolifyStatus` → `platformStatus` tüm codebase'de rename (core/manage.ts, core/status.ts, commands/status.ts, commands/add.ts, MCP tools)
- `QuicklifyResult<T>` → `KastellResult<T>` rename (types/index.ts + tüm import'lar)
- BasePlatformAdapter yerine shared utility functions yaklaşımı — ortak backup/update helper'ları `adapters/shared.ts`'e çıkarılacak. Interface değişmez
- `withProviderErrorHandling()` HOF — 4 provider'daki tekrarlanan try/catch + stripSensitiveData + mapProviderError pattern'i

### Claude's Discretion
- Shared utility fonksiyonların tam API'si (hangi ortak parçalar çıkarılacak)
- withProviderErrorHandling() HOF'un tam imzası ve wrapper pattern'i
- deployServer() iç fazlarının tam parametre tasarımı
- Test migration stratejisi (hangi testler güncellenmeli)

</decisions>

<specifics>
## Specific Ideas

- MaintainResult döndürme pattern'i: MCP'den de kullanılabilir hale getirme hedefi
- deployServer() orchestrator pattern: init.ts ve MCP aynı entry point'i kullanmaya devam edecek
- Shared adapter utilities: Inheritance yerine composition tercih edildi (test mock'lama kolaylığı)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `core/maintain.ts`: Mevcut `pollHealth()` fonksiyonu — pipeline'a entegre edilecek
- `adapters/interface.ts`: PlatformAdapter interface — getLogCommand() kaldırılacak
- `adapters/factory.ts`: getAdapter() + resolvePlatform() — maintain pipeline'da kullanılıyor
- `providers/base.ts`: stripSensitiveData() — HOF'a entegre edilecek
- `utils/errorMapper.ts`: mapProviderError() — HOF'un içinde kullanılacak

### Established Patterns
- QuicklifyResult<T> pattern: `{ success: boolean; data?: T; error?: string; hint?: string }` — tüm core fonksiyonlarda
- Command thin / Core fat: Commands UI, Core business logic
- Adapter dispatch: resolvePlatform() → getAdapter() → adapter.method()

### Integration Points
- `types/index.ts`: QuicklifyResult → KastellResult rename merkezi
- `commands/maintain.ts` → `core/maintain.ts`: Pipeline taşıma
- `core/deploy.ts`: 3 faza bölme + process.exit kaldırma
- `providers/*.ts` (4 dosya): HOF uygulaması
- `adapters/coolify.ts` + `adapters/dokploy.ts`: getLogCommand kaldırma + shared utility çıkarma

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-code-quality-refactoring*
*Context gathered: 2026-03-08*
