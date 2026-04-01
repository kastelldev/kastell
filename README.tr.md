<p align="center">
  <img src="assets/logo.png" alt="Kastell" width="120" />
</p>

<h1 align="center">Kastell</h1>
<p align="center">Altyapınız, güçlendirilmiş.</p>

> [English](README.md) | Türkçe

![Tests](https://github.com/kastelldev/kastell/actions/workflows/ci.yml/badge.svg)
[![Coverage](https://codecov.io/gh/kastelldev/kastell/branch/main/graph/badge.svg)](https://app.codecov.io/gh/kastelldev/kastell)
![npm](https://img.shields.io/npm/v/kastell)
![Downloads](https://img.shields.io/npm/dt/kastell)
![License](https://img.shields.io/badge/license-Apache%202.0-blue)
![GitHub stars](https://img.shields.io/github/stars/kastelldev/kastell?style=flat-square)
[![Socket Badge](https://socket.dev/api/badge/npm/package/kastell)](https://socket.dev/npm/package/kastell)
[![Snyk](https://snyk.io/test/github/kastelldev/kastell/badge.svg)](https://snyk.io/test/github/kastelldev/kastell)
[![Website](https://img.shields.io/badge/website-kastell.dev-blue?style=flat-square)](https://kastell.dev)
![Zero Telemetry](https://img.shields.io/badge/telemetry-zero-brightgreen)

## Neden Kastell?

Sunucu guvenligi parcali. Lynis tarar ama duzeltmez. OpenSCAP guclu ama karmasik. Ozel script'ler bir sure calisir, sonra kimse bakmaz. Her aracin ayri cikti formati, ayri guncelleme dongusu, ayri ogrenme egrisi var.

**Kastell farkli bir yaklasim benimser:** tek CLI ile denetle, duzelt, kilitle ve izle. Sunucunu tara, guvenli fix'leri uygula, uretim standartlarina kilitle ve izlemeye devam et -- hepsi ayni aracla.

**Ilk gunden yapay zeka uyumlu.** Kastell yerlesik MCP sunucusuyla gelir; Claude, Cursor veya herhangi bir MCP uyumlu yapay zeka ajanı sunucularinizi dogrudan yonetebilir. Bir prompt'tan uretim siklastirmasina saniyeler icinde gecin.

Bir sunucuyu guvenli hale getirmek icin dort ayri araca ihtiyaciniz yok.

## Hızlı Başlangıç

```bash
# İnteraktif mod -- komut ezberlemeye gerek yok
npx kastell
```

`kastell` komutunu argümansız çalıştırdığınızda gradient ASCII banner ve hızlı başlangıç örnekleriyle birlikte **interaktif arama menüsü** açılır. Emoji kategorileriyle gruplanmış tüm işlemleri görebilir, yazarak anında filtreleyebilir ve alt seçenekleri adım adım yapılandırabilirsiniz -- komut adı veya flag ezberlemek zorunda değilsiniz.

```
 ██╗  ██╗  ██████╗  ███████╗████████╗███████╗██╗     ██╗
 ██║ ██╔╝  ██╔══██╗ ██╔════╝╚══██╔══╝██╔════╝██║     ██║
 █████╔╝   ███████║ ███████╗   ██║   █████╗  ██║     ██║
 ██╔═██╗   ██╔══██║ ╚════██║   ██║   ██╔══╝  ██║     ██║
 ██║  ██╗  ██║  ██║ ███████║   ██║   ███████╗███████╗███████╗
 ╚═╝  ╚═╝  ╚═╝  ╚═╝ ╚══════╝   ╚═╝   ╚══════╝╚══════╝╚══════╝

  KASTELL  v1.17.0  ·  Your infrastructure, fortified.

  $ kastell init --template production  → deploy a new server
  $ kastell status --all                → check all servers
  $ kastell secure setup                → harden SSH + fail2ban
  $ kastell maintain --all              → full maintenance cycle

? What would you like to do?
   Server Management
❯    Deploy a new server
     Add an existing server
     List all servers
     ...
   Security
     Harden SSH & fail2ban
     Manage firewall (UFW)
     ...
```

Her işlem alt seçenekler (sunucu modu, şablon, log kaynağı, port numarası vb.) içerir ve istediğiniz noktada ana menüye dönmek için **<- Back** seçeneği sunar.

Komutları zaten biliyorsanız, doğrudan da kullanabilirsiniz:

```bash
kastell init                    # Yeni sunucu kur
kastell status sunucum          # Sunucu durumunu kontrol et
kastell backup --all            # Tüm sunucuları yedekle
```

Kastell sunucu oluşturma, SSH anahtar kurulumu, güvenlik duvarı yapılandırması ve platform kurulumunu otomatik yapar.

## Kastell'i Farklı Kılan Ne?

| Problem | Çözüm |
|---------|-------|
| Güncelleme sunucuyu bozdu mu? | `maintain` ile güncelleme öncesi snapshot koruması |
| Sunucunuz sağlıklı mı bilmiyor musunuz? | Yerleşik izleme, sağlık kontrolleri ve `doctor` tanılama |
| Güvenlik sonradan mı düşünülüyor? | Güvenlik duvarı, SSH sıkılaştırma, SSL ve güvenlik denetimi hazır |
| Yedekleme? Belki bir gün... | Tek komutla yedekleme ve geri yükleme, manifest takibiyle |
| Birden fazla sunucu mu yönetiyorsunuz? | Yedekleme, bakım, durum ve sağlıkta `--all` desteği |
| Mevcut sunucu takip dışı mı? | `kastell add` ile her sunucuyu yönetime alın |
| Komutları ezberlemek mi? | `kastell` yazın -- interaktif menü sizi yönlendirir |

## Kastell vs Alternatifler

| Ozellik | Kastell | Lynis | OpenSCAP |
|---------|---------|-------|----------|
| Kurulum | `npm i -g kastell` | Paket yoneticisi | Paket yoneticisi |
| Dil | TypeScript | Shell | C/Python |
| Guvenlik Kontrolleri | 457+ | 300+ | Profile gore degisir |
| Otomatik Duzeltme | Guvenli katman | Sadece oneri | Sadece oneri |
| MCP (AI Ajan) | 14 arac | -- | -- |
| Uyumluluk | CIS, PCI-DSS, HIPAA | CIS, HIPAA | CIS, STIG, PCI-DSS |
| Bulut Saglama | 4 saglayici | -- | -- |
| Siklastirma (Lock) | 24 adim | -- | -- |
| Uzaktan Izleme | Guard daemon | -- | -- |
| Telegram Bot | Yerlesik | -- | -- |
| Platform Destegi | Linux (SSH) | Linux/macOS/BSD | Linux |
| Lisans | Apache 2.0 | GPL-3.0 | LGPL-2.1 |

## Neler Yapabilirsiniz?

### Kurulum
```bash
kastell                               # İnteraktif menü (önerilen)
kastell init                          # İnteraktif kurulum (doğrudan)
kastell init --provider hetzner       # Otomatik kurulum
kastell init --config kastell.yml     # YAML ile kurulum
kastell init --template production    # Şablon kullanarak
kastell init --mode bare              # Genel VPS (platform yok)
kastell init --mode dokploy           # Dokploy (Docker Swarm PaaS)
```

### Yönetim
```bash
kastell list                  # Sunucuları listele
kastell status sunucum        # Sunucu durumu
kastell status --all          # Tüm sunucuları kontrol et
kastell ssh sunucum           # Sunucuya SSH bağlantısı
kastell restart sunucum       # Sunucuyu yeniden başlat
kastell destroy sunucum       # Bulut sunucusunu tamamen sil
kastell add                   # Mevcut sunucu ekle
kastell remove sunucum        # Yerel yapılandırmadan kaldır
kastell config set key value  # Varsayılan yapılandırma yönet
kastell config validate       # servers.yaml yapısını ve tiplerini doğrula
kastell export                # Sunucu listesini JSON'a aktar
kastell import servers.json   # JSON'dan sunucuları içe aktar
```

### Güncelleme ve Bakım
```bash
kastell update sunucum                # Platformu güncelle (Coolify veya Dokploy, sunucu kaydından otomatik algılanır)
kastell update sunucum --dry-run      # Güncellemeyi çalıştırmadan önizle
kastell maintain sunucum              # Tam bakım (snapshot + güncelleme + sağlık + yeniden başlatma)
kastell maintain sunucum --dry-run    # Bakım adımlarını önizle
kastell maintain --all                # Tüm sunucuları bakıma al
```

### Yedekleme ve Geri Yükleme
```bash
kastell backup sunucum        # Veritabanı + yapılandırma yedeği
kastell backup --all          # Tüm sunucuları yedekle
kastell restore sunucum       # Yedekten geri yükle
```

### Snapshot'lar
```bash
kastell snapshot create sunucum   # VPS snapshot'ı oluştur (maliyet tahminiyle)
kastell snapshot list sunucum     # Snapshot'ları listele
kastell snapshot list --all       # Tüm sunuculardaki snapshot'ları listele
kastell snapshot delete sunucum   # Snapshot sil
```

### Güvenlik
```bash
kastell firewall status sunucum   # Güvenlik duvarı durumu
kastell firewall setup sunucum    # UFW yapılandırması
kastell secure audit sunucum      # Güvenlik denetimi
kastell secure setup sunucum      # SSH sıkılaştırma + fail2ban
kastell domain add sunucum --domain ornek.com  # Domain + SSL ayarla
```

### Güvenlik Denetimi
```bash
kastell audit sunucum                    # Tam güvenlik denetimi (31 kategori, 468+ kontrol)
kastell audit sunucum --json             # Otomasyon için JSON çıktısı
kastell audit sunucum --threshold 70     # Skor eşiğin altındaysa exit code 1
kastell audit sunucum --fix              # İnteraktif düzeltme modu (önem derecesine göre)
kastell audit sunucum --fix --dry-run    # Düzeltmeleri çalıştırmadan önizle
kastell audit sunucum --watch            # 5 dk aralıkla tekrar denetle, sadece değişiklikleri göster
kastell audit sunucum --watch 60         # Özel aralık (60 saniye)
kastell audit --host root@1.2.3.4       # Kayıtlı olmayan sunucuyu denetle
kastell audit sunucum --badge            # SVG rozet çıktısı
kastell audit sunucum --report html      # Tam HTML raporu
kastell audit sunucum --score-only       # Sadece skor (CI uyumlu)
kastell audit sunucum --summary          # Kompakt özet görünümü
kastell audit sunucum --explain          # Başarısız kontrolleri iyileştirme rehberiyle açıkla
kastell audit sunucum --compliance cis   # Uyumluluk çerçevesine göre filtrele (cis-level1, cis-level2, pci-dss, hipaa)
```

### Güvenlik Sertleştirme
```bash
kastell lock sunucum                          # 19 adımlı production sertleştirme (SSH + UFW + sysctl + auditd + AIDE + Docker)
kastell lock sunucum --dry-run                # Sertleştirme adımlarını uygulamadan önizle
```

### İzleme ve Hata Ayıklama
```bash
kastell monitor sunucum             # CPU, RAM, disk kullanımı
kastell logs sunucum                 # Platform logları (Coolify veya Dokploy)
kastell logs sunucum -f              # Logları canlı takip et
kastell health                       # Tüm sunucuların sağlık kontrolü
kastell doctor                       # Yerel ortam kontrolü
```

## Desteklenen Sağlayıcılar

| Sağlayıcı | Durum | Bölgeler | Başlangıç Fiyatı |
|-----------|-------|----------|------------------|
| [Hetzner Cloud](https://hetzner.cloud) | Kararlı | Avrupa, ABD | ~€4/ay |
| [DigitalOcean](https://digitalocean.com) | Kararlı | Küresel | ~$18/ay |
| [Vultr](https://vultr.com) | Kararlı | Küresel | ~$12/ay |
| [Linode (Akamai)](https://linode.com) | Beta | Küresel | ~$12/ay |

> Fiyatlar en az 2 GB RAM'e sahip en ucuz planı yansıtır (Coolify ve Dokploy gereksinimi). Bare modda minimum gereksinim yoktur -- sağlayıcıya göre ~$2.50/ay'dan başlayan planlar kullanılabilir. Kurulum sırasında farklı boyut seçebilirsiniz. Linode desteği beta aşamasındadır -- topluluk testleri memnuniyetle karşılanır.

## Desteklenen Platformlar

| Platform | Mod Bayrağı | Min RAM | Min CPU | Açıklama |
|----------|-------------|---------|---------|----------|
| Coolify | `--mode coolify` (varsayılan) | 2 GB | 2 vCPU | Docker tabanlı PaaS (port 8000) |
| Dokploy | `--mode dokploy` | 2 GB | 2 vCPU | Docker Swarm tabanlı PaaS (port 3000) |
| Bare | `--mode bare` | — | — | Genel VPS, platform yükü yok |

Kastell **PlatformAdapter** mimarisini kullanır -- aynı komutlar (`update`, `maintain`, `logs`, `health`) tüm platformlarda çalışır. Platform sunucu kaydınızda saklanır ve her komutta otomatik algılanır.

## Geliştirici Deneyimi

| Özellik | Komut / Bayrak | Açıklama |
|---------|---------------|----------|
| Kuru Çalıştırma | `--dry-run` | Yıkıcı komutları çalıştırmadan önizleyin. Destekleyen komutlar: destroy, update, restart, remove, maintain, restore, firewall, domain, backup, snapshot, secure. |
| Kabuk Tamamlama | `kastell completions bash\|zsh\|fish` | Komut ve seçeneklerin sekme ile tamamlanması için kabuk tamamlama betikleri oluşturur. |
| Yapılandırma Doğrulama | `kastell config validate` | `servers.yaml` dosyasını Zod strict şemaları ile yapısal ve tip hataları açısından kontrol eder. |
| Sürüm Kontrolü | `kastell --version` | Mevcut sürümü gösterir ve npm'de daha yeni bir sürüm varsa bildirir. |

## YAML Yapılandırması

Tek bir yapılandırma dosyasıyla kurulum yapın:

```yaml
# kastell.yml
provider: hetzner
region: nbg1
size: cax11
name: sunucum
fullSetup: true
domain: coolify.ornek.com
```

```bash
kastell init --config kastell.yml
```

## Şablonlar

| Şablon | Kullanım Alanı | İçerik |
|--------|---------------|--------|
| `starter` | Test, yan projeler | 1-2 vCPU, 2-4 GB RAM |
| `production` | Canlı uygulamalar | 2-4 vCPU, 4-8 GB RAM, tam sıkılaştırma |
| `dev` | Geliştirme ve CI/CD | Starter ile aynı, sıkılaştırma yok |

```bash
kastell init --template production --provider hetzner
```

## Güvenlik

Kastell güvenlik öncelikli olarak geliştirilmektedir -- 219 test suite'inde **9.871 test**, özel güvenlik test suite'leri dahil.

- API token'ları asla diske kaydedilmez -- çalışma zamanında sorulur veya ortam değişkenlerinden alınır
- SSH anahtarları gerekirse otomatik oluşturulur (Ed25519)
- Tüm SSH bağlantıları `StrictHostKeyChecking=accept-new` ile IP doğrulama (oktet aralığı) ve ortam filtreleme kullanır
- Tüm kullanıcı girdilerinde shell injection koruması (`spawn`/`spawnSync`, `execSync` yok)
- Provider hata mesajları token sızıntısını önlemek için temizlenir
- stderr temizleme -- hata çıktısından IP'ler, home dizinleri, token'lar ve gizli veriler otomatik redakte edilir
- Yapılandırma dosyasında token tespiti (22+ anahtar pattern, büyük/küçük harf duyarsız, iç içe yapılar)
- İçe/dışa aktarma işlemleri hassas alanları temizler ve dosya izinlerini sıkılaştırır (`0o600`)
- `--full-setup` güvenlik duvarı ve SSH sıkılaştırmasını otomatik etkinleştirir
- MCP: SAFE_MODE (varsayılan: açık) tüm yıkıcı işlemleri engeller, tüm girdilerde Zod şema doğrulaması, yedek geri yüklemede path traversal koruması
- Claude Code hook'ları: destroy-block, `--force` olmadan `kastell destroy` komutunu engeller; pre-commit audit guard skor düşüşünde uyarır
- **Sıfır Telemetri** — Kastell hiçbir kullanım verisi, analitik veya telemetri toplamaz. Sunucu verileriniz makinenizden asla çıkmaz.

## Kurulum

```bash
# Doğrudan çalıştırın (önerilen)
npx kastell <komut>

# Veya global olarak kurun
npm install -g kastell
kastell <komut>
```

Node.js 20 veya üstü gereklidir.

## Sorun Giderme

**Sunucu oluşturma başarısız mı?**
API token'ınızı ve yerel ortamınızı doğrulamak için `kastell doctor --check-tokens` komutunu çalıştırın.

**Sunucu yanıt vermiyor mu?**
Platform durumunu kontrol edip gerekirse otomatik yeniden başlatmak için `kastell status sunucum --autostart` kullanın veya tüm sunucuları kontrol etmek için `kastell health` çalıştırın.

**Sıfırdan başlamak mı istiyorsunuz?**
`kastell destroy sunucum` bulut sunucusunu tamamen kaldırır.

## Katkıda Bulunma

Geliştirme ortamı kurulumu, test ve katkı rehberi için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın.

Kastell, 207 suite'te **6.441 test** kullanmaktadır. PR göndermeden önce `npm test` çalıştırın.

## MCP Sunucusu (Yapay Zeka Entegrasyonu)

Kastell, yapay zeka destekli sunucu yönetimi için yerleşik bir [Model Context Protocol](https://modelcontextprotocol.io/) sunucusu içerir. Claude Code, Cursor, Windsurf ve diğer MCP uyumlu istemcilerle çalışır.

```json
{
  "mcpServers": {
    "kastell": {
      "command": "npx",
      "args": ["-y", "-p", "kastell", "kastell-mcp"],
      "env": {
        "HETZNER_TOKEN": "token-buraya",
        "DIGITALOCEAN_TOKEN": "token-buraya",
        "VULTR_TOKEN": "token-buraya",
        "LINODE_TOKEN": "token-buraya"
      }
    }
  }
}
```

Mevcut araçlar:

| Araç | Eylemler | Açıklama |
|------|----------|----------|
| `server_info` | list, status, health, sizes | Sunucu bilgilerini sorgula, bulut sağlayıcı ve platform durumunu kontrol et |
| `server_logs` | logs, monitor | SSH ile platform/Docker loglarını ve sistem metriklerini getir |
| `server_manage` | add, remove, destroy | Sunucuları kaydet, kaldır veya bulut sunucusunu sil |
| `server_maintain` | update, restart, maintain | Platformu güncelle, sunucuları yeniden başlat, tam bakım yap |
| `server_secure` | secure, firewall, domain | SSH sıkılaştırma, güvenlik duvarı kuralları, domain/SSL yönetimi (10 alt komut) |
| `server_backup` | backup, snapshot | Veritabanı yedekle/geri yükle ve VPS snapshot oluştur/yönet |
| `server_provision` | create | Bulut sağlayıcılarda yeni sunucu oluştur |
| `server_audit` | audit | 468+ kontrollü güvenlik denetimi, uyumluluk çerçevesi filtresiyle; iyileştirme rehberi için `--explain` kullanın |
| `server_evidence` | collect | Adli kanıt paketi topla (SHA256 checksum ile) |
| `server_guard` | start, stop, status | Otonom güvenlik izleme daemon'u yönet |
| `server_doctor` | diagnose | Proaktif sağlık analizi ve iyileştirme komutları |
| `server_lock` | harden | 24 adımlı production sertleştirme (SSH, UFW, sysctl, auditd, AIDE, Docker) |
| `server_fleet` | overview | Tüm filo için sağlık ve güvenlik duruşu panosu |
| `server_fix` | fix --safe | Otomatik güvenli düzeltmeler uygula (yalnızca SAFE tier, dryRun varsayılan) |

> Tüm yıkıcı işlemler (destroy, restore, snapshot-delete, provision, restart, maintain, snapshot-create) çalıştırılmak için `SAFE_MODE=false` gerektirir.

### Claude Code Eklentisi

Kastell, Anthropic marketplace için [Claude Code eklentisi](kastell-plugin/) olarak da sunulmaktadır. Eklenti şunları içerir:

- **4 beceri**: kastell-ops (mimari referans), kastell-scaffold (bileşen üretimi), kastell-careful (yıkıcı işlem koruyucusu), kastell-research (kod tabanı keşfi)
- **2 ajan**: kastell-auditor (paralel denetim analizcisi), kastell-fixer (worktree izolasyonlu otomatik düzeltici)
- **5 hook**: destroy-block, session-audit, session-log, pre-commit-audit-guard, stop-quality-check

Kurulum için Claude Code eklenti yöneticisini kullanın ya da doğrudan `claude --plugin-dir kastell-plugin` ile çalıştırın.

### MCP Platform Kurulumu

| Platform | Yapılandırma Konumu | Kılavuz |
|----------|---------------------|---------|
| Claude Code | `claude mcp add` veya `.mcp.json` | [Kurulum Rehberi](docs/mcp-platforms/claude-code.md) |
| Claude Desktop | `claude_desktop_config.json` | [Kurulum Rehberi](docs/mcp-platforms/claude-desktop.md) |
| VS Code / Copilot | `.vscode/mcp.json` | [Kurulum Rehberi](docs/mcp-platforms/vscode.md) |
| Cursor | `.cursor/mcp.json` | [Kurulum Rehberi](docs/mcp-platforms/cursor.md) |

> Daha fazla platform (JetBrains, Windsurf, Gemini ve diğerleri) v2.0'da eklenecek.

### AI Keşfedilebilirliği

Kastell, AI tarayıcıları için [`llms.txt`](llms.txt) sağlar ve [MCP Registry](https://registry.modelcontextprotocol.io/)'de `io.github.kastelldev/kastell` olarak listelenmiştir.

`kastell audit` komutunu CI pipeline'ınızda güvenlik eşiği zorunluluğu için kullanın:

```yaml
# .github/workflows/security-audit.yml
name: Güvenlik Denetimi
on:
  schedule:
    - cron: '0 6 * * 1'  # Her Pazartesi 06:00
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - run: npx -y kastell audit --host root@${{ secrets.SERVER_IP }} --threshold 70 --json > audit-result.json
      - uses: actions/upload-artifact@v4
        with:
          name: audit-report
          path: audit-result.json
```

## Gelecek Planlar

- Test Mükemmelliği: Mutasyon testi, kapsam boşlukları, entegrasyon testleri (v1.14)
- Marketplace dağıtımıyla plugin ekosistemi (v2.0)
- Dashboard ve yönetilen hizmet (v3.0)

## Felsefe

> Altyapı sıkıcı, öngörülebilir ve güvenli olmalıdır.

Kastell bir script değildir. Self-hosted altyapınız için DevOps güvenlik katmanınızdır.

## Lisans

Apache 2.0 -- [LICENSE](LICENSE) dosyasına bakın

## Destek

- [GitHub Issues](https://github.com/kastelldev/kastell/issues) -- Hata bildirimleri ve özellik istekleri
- [Changelog](CHANGELOG.md) -- Sürüm geçmişi

---

[@omrfc](https://github.com/omrfc) tarafından geliştirilmektedir.
