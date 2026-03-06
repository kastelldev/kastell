# Kastell

> Self-hosted sunucularinizi kurmak, guvenligini saglamak ve yonetmek icin CLI araci.

> [English](README.md) | Turkce

![Tests](https://github.com/kastelldev/kastell/actions/workflows/ci.yml/badge.svg)
[![Coverage](https://codecov.io/gh/kastelldev/kastell/branch/main/graph/badge.svg)](https://codecov.io/gh/kastelldev/kastell)
![npm](https://img.shields.io/npm/v/kastell)
![Downloads](https://img.shields.io/npm/dt/kastell)
![License](https://img.shields.io/badge/license-Apache%202.0-blue)
![GitHub stars](https://img.shields.io/github/stars/kastelldev/kastell?style=flat-square)
[![Socket Badge](https://socket.dev/api/badge/npm/package/kastell)](https://socket.dev/npm/package/kastell)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fkastell.dev&label=website)](https://kastell.dev)

## Kastell Neden Var?

Self-hosted sunucularin cogu su nedenlerle coker:

- Yedekleme disiplini yok
- Guncelleme stratejisi yok
- Guvenlik sikilastirmasi yok
- Izleme yok
- Snapshot rutini yok

Sunuculariniza cocuk bakiciligi yapmayi birakin. Kastell bunu cozmek icin yapildi.

## Hizli Baslangic

```bash
# Interaktif mod -- komut ezberlemeye gerek yok
npx kastell
```

`kastell` komutunu argumansiz calistirdiginizda **interaktif bir menu** acilir. Tum islemleri kategorilere gore gorebilir, ok tuslariyla secim yapabilir ve alt secenekleri adim adim yapilandirabilirsiniz -- komut adi veya flag ezberlemek zorunda degilsiniz.

```
? What would you like to do?
  Server Management
>   Deploy a new server
    Add an existing server
    List all servers
    Check server status
    ...
  Security
    Harden SSH & fail2ban
    Manage firewall (UFW)
    ...
```

Her islem alt secenekler (sunucu modu, sablon, log kaynagi, port numarasi vb.) icerir ve istediginiz noktada ana menuye donmek icin **<- Back** secenegi sunar.

Komutlari zaten biliyorsaniz, dogrudan da kullanabilirsiniz:

```bash
kastell init                    # Yeni sunucu kur
kastell status sunucum          # Sunucu durumunu kontrol et
kastell backup --all            # Tum sunuculari yedekle
```

Kastell sunucu olusturma, SSH anahtar kurulumu, guvenlik duvari yapilandirmasi ve platform kurulumunu otomatik yapar.

## Kastell'i Farkli Kilan Ne?

| Problem | Cozum |
|---------|-------|
| Guncelleme sunucuyu bozdu mu? | `maintain` ile guncelleme oncesi snapshot korumasi |
| Sunucunuz saglikli mi bilmiyor musunuz? | Yerlesik izleme, saglik kontrolleri ve `doctor` tanilama |
| Guvenlik sonradan mi dusunuluyor? | Guvenlik duvari, SSH sikilastirma, SSL ve guvenlik denetimi hazir |
| Yedekleme? Belki bir gun... | Tek komutla yedekleme ve geri yukleme, manifest takibiyle |
| Birden fazla sunucu mu yonetiyorsunuz? | Yedekleme, bakim, durum ve saglikta `--all` destegi |
| Mevcut sunucu takip disi mi? | `kastell add` ile her sunucuyu yonetime alin |
| Komutlari ezberlemek mi? | `kastell` yazin -- interaktif menu sizi yonlendirir |

## Neler Yapabilirsiniz?

### Kurulum
```bash
kastell                               # Interaktif menu (onerilen)
kastell init                          # Interaktif kurulum (dogrudan)
kastell init --provider hetzner       # Otomatik kurulum
kastell init --config kastell.yml     # YAML ile kurulum
kastell init --template production    # Sablon kullanarak
kastell init --mode bare              # Genel VPS (Coolify olmadan)
```

### Yonetim
```bash
kastell list                  # Sunuculari listele
kastell status sunucum        # Sunucu durumu
kastell status --all          # Tum sunuculari kontrol et
kastell ssh sunucum           # Sunucuya SSH baglantisi
kastell restart sunucum       # Sunucuyu yeniden baslat
kastell destroy sunucum       # Bulut sunucusunu tamamen sil
kastell add                   # Mevcut sunucu ekle
kastell remove sunucum        # Yerel yapilandirmadan kaldir
kastell config set key value  # Varsayilan yapilandirma yonet
kastell export                # Sunucu listesini JSON'a aktar
kastell import servers.json   # JSON'dan sunuculari ice aktar
```

### Guncelleme ve Bakim
```bash
kastell update sunucum        # Coolify guncelle (Coolify sunuculari)
kastell maintain sunucum      # Tam bakim (snapshot + guncelleme + saglik + yeniden baslatma)
kastell maintain --all        # Tum sunuculari bakima al
```

### Yedekleme ve Geri Yukleme
```bash
kastell backup sunucum        # Veritabani + yapilandirma yedegi
kastell backup --all          # Tum sunuculari yedekle
kastell restore sunucum       # Yedekten geri yukle
```

### Snapshot'lar
```bash
kastell snapshot create sunucum   # VPS snapshot'i olustur (maliyet tahminiyle)
kastell snapshot list sunucum     # Snapshot'lari listele
kastell snapshot list --all       # Tum sunuculardaki snapshot'lari listele
kastell snapshot delete sunucum   # Snapshot sil
```

### Guvenlik
```bash
kastell firewall status sunucum   # Guvenlik duvari durumu
kastell firewall setup sunucum    # UFW yapilandirmasi
kastell secure audit sunucum      # Guvenlik denetimi
kastell secure setup sunucum      # SSH sikilastirma + fail2ban
kastell domain add sunucum --domain ornek.com  # Domain + SSL ayarla
```

### Izleme ve Hata Ayiklama
```bash
kastell monitor sunucum             # CPU, RAM, disk kullanimi
kastell logs sunucum                 # Sunucu loglari
kastell logs sunucum -f              # Loglari canli takip et
kastell health                       # Tum sunucularin saglik kontrolu
kastell doctor                       # Yerel ortam kontrolu
```

## Desteklenen Saglayicilar

| Saglayici | Durum | Bolgeler | Baslangic Fiyati |
|-----------|-------|----------|------------------|
| [Hetzner Cloud](https://hetzner.cloud) | Kararli | Avrupa, ABD | ~EUR4/ay |
| [DigitalOcean](https://digitalocean.com) | Kararli | Kuresel | ~$18/ay |
| [Vultr](https://vultr.com) | Kararli | Kuresel | ~$10/ay |
| [Linode (Akamai)](https://linode.com) | Beta | Kuresel | ~$24/ay |

> Fiyatlar provider basina varsayilan starter sablonunu yansitir. Kurulum sirasinda farkli boyut secebilirsiniz. Linode destegi beta asamasindadir -- topluluk testleri memnuniyetle karsilanir.

## YAML Yapilandirmasi

Tek bir yapilandirma dosyasiyla kurulum yapin:

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

## Sablonlar

| Sablon | Kullanim Alani | Icerik |
|--------|---------------|--------|
| `starter` | Test, yan projeler | 1-2 vCPU, 2-4 GB RAM |
| `production` | Canli uygulamalar | 2-4 vCPU, 4-8 GB RAM, tam sikilastirma |
| `dev` | Gelistirme ve CI/CD | Starter ile ayni, sikilastirma yok |

```bash
kastell init --template production --provider hetzner
```

## Guvenlik

Kastell guvenlik oncelikli olarak gelistirilmektedir -- 78 test suite'inde **2.099 test**, ozel guvenlik test suite'leri dahil.

- API token'lari asla diske kaydedilmez -- calisma zamaninda sorulur veya ortam degiskenlerinden alinir
- SSH anahtarlari gerekirse otomatik olusturulur (Ed25519)
- Tum SSH baglantilari `StrictHostKeyChecking=accept-new` ile IP dogrulama (oktet araligi) ve ortam filtreleme kullanir
- Tum kullanici girdilerinde shell injection korumasi (`spawn`/`spawnSync`, `execSync` yok)
- Provider hata mesajlari token sizintisini onlemek icin temizlenir
- stderr temizleme -- hata ciktisindan IP'ler, home dizinleri, token'lar ve gizli veriler otomatik redakte edilir
- Yapilandirma dosyasinda token tespiti (22+ anahtar pattern, buyuk/kucuk harf duyarsiz, ic ice yapilar)
- Ice/disa aktarma islemleri hassas alanlari temizler ve dosya izinlerini sikilastirir (`0o600`)
- `--full-setup` guvenlik duvari ve SSH sikilastirmasini otomatik etkinlestirir
- MCP: SAFE_MODE (varsayilan: acik) tum yikici islemleri engeller, tum girdilerde Zod sema dogrulamasi, yedek geri yuklemede path traversal korumasi

## Kurulum

```bash
# Dogrudan calistirin (onerilen)
npx kastell <komut>

# Veya global olarak kurun
npm install -g kastell
kastell <komut>
```

Node.js 20 veya ustu gereklidir.

## Sorun Giderme

**Sunucu olusturma basarisiz mi?**
API token'inizi ve yerel ortaminizi dogrulamak icin `kastell doctor --check-tokens` komutunu calistirin.

**Coolify yanit vermiyor mu?**
Durumu kontrol edip gerekirse otomatik yeniden baslatmak icin `kastell status sunucum --autostart` kullanin.

**Sifirdan baslamak mi istiyorsunuz?**
`kastell destroy sunucum` bulut sunucusunu tamamen kaldirir.

## Katkida Bulunma

Gelistirme ortami kurulumu, test ve katki rehberi icin [CONTRIBUTING.md](CONTRIBUTING.md) dosyasina bakin.

## MCP Sunucusu (Yapay Zeka Entegrasyonu)

Kastell, yapay zeka destekli sunucu yonetimi icin yerlesik bir [Model Context Protocol](https://modelcontextprotocol.io/) sunucusu icerir. Claude Code, Cursor, Windsurf ve diger MCP uyumlu istemcilerle calisir.

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

Mevcut araclar:

| Arac | Eylemler | Aciklama |
|------|----------|----------|
| `server_info` | list, status, health | Sunucu bilgilerini sorgula, bulut saglayici ve Coolify durumunu kontrol et |
| `server_logs` | logs, monitor | SSH ile Coolify/Docker loglarini ve sistem metriklerini getir |
| `server_manage` | add, remove, destroy | Sunuculari kaydet, kaldir veya bulut sunucusunu sil |
| `server_maintain` | update, restart, maintain | Coolify guncelle, sunuculari yeniden baslat, tam bakim yap |
| `server_secure` | secure, firewall, domain | SSH sikilastirma, guvenlik duvari kurallari, domain/SSL yonetimi (10 alt komut) |
| `server_backup` | backup, snapshot | Veritabani yedekle/geri yukle ve VPS snapshot olustur/yonet |
| `server_provision` | create | Bulut saglayicilarda yeni sunucu olustur |

> Tum yikici islemler (destroy, restore, snapshot-delete, provision, restart, maintain, snapshot-create) calistirilmak icin `SAFE_MODE=false` gerektirir.

## Gelecek Planlar

- Zamanlanmis bakim (cron tabanli otomatik bakim)
- Dokploy platform destegi (`--platform dokploy`)

## Felsefe

> Altyapi sikici, ongorulebilir ve guvenli olmalidir.

Kastell bir script degildir. Self-hosted altyapiniz icin DevOps guvenlik katmaninizdir.

## Lisans

Apache 2.0 -- [LICENSE](LICENSE) dosyasina bakin

## Destek

- [GitHub Issues](https://github.com/kastelldev/kastell/issues) -- Hata bildirimleri ve ozellik istekleri
- [Changelog](CHANGELOG.md) -- Surum gecmisi

---

[@omrfc](https://github.com/omrfc) tarafindan gelistirilmektedir.
