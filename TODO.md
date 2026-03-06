# Kastell — Yapilacaklar

## ACIL — v1.3 Tamamlanmasi
- [ ] git push (49 commit bekliyor)
- [ ] npm publish — kastell@1.3.0
- [ ] quicklify@1.2.1 deprecated yap
- [ ] GitHub repo rename (quicklify → kastell)

## v1.4 — TUI + Teknik Borc + Dokploy Tamamlama
- [ ] Dokploy update komutu (executeDokployUpdate)
- [ ] Dokploy maintain desteği (5-step cycle)
- [ ] Dokploy logs desteği (container adı platform-aware)
- [ ] ASCII logo (interaktif menude)
- [ ] Emoji kategoriler
- [ ] Tooltip
- [ ] Arama
- [ ] Saglik paneli
- [ ] Re-export temizligi (backup/restore)
- [ ] @types/inquirer v9<->v12 uyumsuzlugu coz

## v1.5 — Viral Buyume
- [ ] `kastell audit` — ucretsiz guvenlik taramasi
- [ ] Dokploy restore desteği
- [ ] kastell.dev website
- [ ] IP abuse kanit (firewall + port snapshot)
- [ ] Provider API timeout
- [ ] Logo kesinlesmeli (website oncesi)

## Logo — Karar Bekliyor
- [ ] Konsept grubu sec (B grubu oneriliyor: K + Kale Burcu)
- [ ] Secim sonrasi SVG prototip + AI prompt briefi

## Hook Otomasyonu
### Oncelikli
- [ ] PreToolUse/Bash → tehlikeli komut korumasi (rm -rf, DROP TABLE)
- [ ] PostToolUse/Write|Edit → otomatik tsc --noEmit
- [ ] PermissionRequest → Read auto-approve

### Orta Vadeli
- [ ] SessionStart → CHANGELOG + current focus yukle
- [ ] Stop → TS hata/CHANGELOG/README kontrolu (prompt hook)
- [ ] PreCompact → CHANGELOG snapshot
- [ ] SessionEnd → uncommitted changes uyarisi

### Uzun Vadeli (v1.5+)
- [ ] SessionStart → kastell audit --silent
- [ ] Deploy sonrasi Telegram bildirimi (HTTP hook + n8n)
- [ ] Kastell MCP auto-allow
- [ ] PostToolUse/Bash → session.log
- [ ] UserPromptSubmit → platform/versiyon enjeksiyonu

## Guvenlik — Acik Uyarilar
- [ ] --token flag shell history'de kaliyor
- [ ] openBrowser() shell injection dogrulanmadi

## Periyodik Bakim
- [ ] MEMORY.md stale bilgi kontrolu (her 2-3 major gorev)
- [ ] LESSONS.md yeni ders ekleme (hata cikinca)
- [ ] Oturum sonu: CHANGELOG, README, README.tr, SECURITY.md, llms.txt

## v2.0+ — Uzun Vade
- [ ] Guard Core (daemon, lock, fleet, doctor, uninstall)
- [ ] Telegram/Discord/Slack bildirimleri
- [ ] kastell backup --schedule
- [ ] ServerRecord.mode required yapma
- [ ] Risk trend scoring (v2.5)
- [ ] Web dashboard + plugin + managed servis (v3.0)
