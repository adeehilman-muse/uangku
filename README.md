# UangKu

UangKu adalah expense tracker pribadi Ade Hilman. Sumber data utama adalah Supabase; PWA di Vercel bersifat local-first dan membaca snapshot statis `web/data.json` yang dibuat dari Supabase saat deploy.

Live: https://uangku-ahmu1.vercel.app

## Arsitektur singkat

- `tracker/uang.py` — CLI untuk mencatat transaksi, akun, investasi, dan melihat arus kas di Supabase.
- `tracker/export_snapshot.py` — export Supabase ke `web/data.json`.
- `tracker/deploy_uangku.py` — deploy folder `web/` ke Vercel production lalu verifikasi `data.json` live.
- `tracker/supabase-schema.sql` — skema tabel Supabase: `accounts`, `transactions`, `investments`, `prices`.
- `web/` — PWA statis: `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.json`, ikon.

Alur data satu arah: Supabase → `export_snapshot.py` → `web/data.json` → Vercel → PWA. Edit permanen harus dilakukan di Supabase lewat CLI/chat, bukan hanya di PWA.

## Multi-user (API key per owner)

Satu deployment UangKu bisa dipakai beberapa user. Data dipisah dengan `owner_id`:

- `ade` — data Ade Hilman.
- `pacar` — data pasangan; akun awal id 16 `Utama` saldo 0.

Setup sekali:

1. Jalankan `tracker/migration-multiuser.sql` di Supabase SQL Editor.
2. Set env Vercel production: `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`.
3. Buat API key per owner; simpan hanya hash SHA-256 di tabel `api_keys`.
4. PWA: buka Pengaturan → tempel API key → Simpan.
5. Muse user lain mencatat lewat API, tanpa deploy Vercel/Supabase sendiri:

```bash
curl -X POST https://uangku-ahmu1.vercel.app/api/transactions \
  -H "Authorization: Bearer <API_KEY_USER>" \
  -H "Content-Type: application/json" \
  -d '{"amount":20000,"note":"Kopi","direction":"out","category":"makan","date":"2026-11-27","account_id":16}'
```

Endpoint:

- `GET /api/snapshot` — snapshot owner dari API key.
- `GET /api/accounts` — daftar akun owner.
- `POST /api/accounts` — tambah akun owner.
- `POST /api/transactions` — catat transaksi owner dan update saldo akun.

CLI lokal juga mendukung `--owner` / env `UANGKU_OWNER` (default `ade`).

## Quick start

### 1. Prasyarat

- Python 3.
- `curl`.
- Vercel CLI yang sudah login dan punya akses ke team/project tujuan.
- Supabase project untuk UangKu.
- File secret lokal, tidak ikut repo:

```text
~/.secrets/supabase-uangku
```

Isi file itu:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Di VM Muse saat ini juga ada `~/.secrets/egress-proxy-env` untuk egress proxy. Di mesin lain file itu boleh tidak ada; script akan tetap mencoba membaca path default, jadi buat file kosong atau set `UANGKU_EGRESS_ENV` ke file env yang valid bila perlu.

Environment override yang didukung:

```bash
export UANGKU_SECRETS="$HOME/.secrets/supabase-uangku"
export UANGKU_EGRESS_ENV="$HOME/.secrets/egress-proxy-env"
export UANGKU_WEB_DIR="$PWD/web"
export VERCEL_BIN="$(command -v vercel)"
export VERCEL_SCOPE="ahmu1"
export UANGKU_LIVE_URL="https://uangku-ahmu1.vercel.app"
```

### 2. Setup Supabase

1. Buat project Supabase.
2. Jalankan `tracker/supabase-schema.sql` di SQL Editor.
3. Isi tabel `accounts` dengan kantong/akun yang dipakai. ID akun harus stabil karena transaksi merujuk ke `account_id`.
4. Simpan `SUPABASE_URL` dan service role key ke `~/.secrets/supabase-uangku` dengan permission ketat, misalnya `chmod 600`.

ID akun yang dipakai saat ini:

| ID | Akun |
| --- | --- |
| 7 | Kantong Utama |
| 8 | Kebutuhan sehari-hari |
| 9 | GoPay |
| 10 | Kartu Kredit VISA |
| 11 | Love Pocket |
| 12 | Jajan Kantor |
| 13 | Bayar Karyawan AI |
| 14 | Makan Siang |
| 15 | SPayLater |

Kategori yang umum dipakai: `makan`, `pacaran`, `tagihan`, `bensin`, `parkir`, `lain-lain`, `tabungan`, `investasi`, `gaji`, `ai`.

### 3. Catat transaksi

```bash
cd tracker
python3 uang.py acc-list
python3 uang.py out 20000 "Kopi" --cat makan --date 2026-11-26 --acc 14
python3 uang.py in 7100000 "Gaji" --cat gaji --date 2026-11-30 --acc 7
python3 uang.py flow --month 2026-11
```

Transfer antar-kantong dicatat sebagai dua kaki: `out` dari kantong asal dan `in` ke kantong tujuan, keduanya kategori `tabungan`.

### 4. Export snapshot

```bash
cd tracker
python3 export_snapshot.py
```

Perintah ini membuat `web/data.json`. File itu sengaja tidak di-commit karena berisi snapshot data pribadi dan selalu bisa dibuat ulang dari Supabase.

### 5. Deploy ke Vercel

Pertama kali, link folder `web/` ke project Vercel:

```bash
cd web
vercel link --scope ahmu1
```

Setelah ter-link, deploy dari script:

```bash
cd ../tracker
python3 deploy_uangku.py
```

Script deploy menjalankan `vercel deploy --prod`, lalu membandingkan `version` di `web/data.json` lokal dengan `https://uangku-ahmu1.vercel.app/data.json`. Hasil sehat: `OK live sama`.

### 6. Aturan PWA

- Setiap mengubah `web/index.html`, `web/app.js`, atau `web/styles.css`, naikkan `CACHE` di `web/sw.js` (saat ini `uangku-v23`).
- Setelah deploy, user mungkin perlu menutup lalu membuka ulang PWA agar service worker baru aktif.
- Jangan commit `.env*`, `.vercel/`, secret, database lokal, log, atau `web/data.json`.

## Prosedur tetap untuk transaksi dari chat

Setiap transaksi yang dicatat dari chat harus selesai sampai live:

1. Catat dengan `tracker/uang.py`.
2. Jalankan `tracker/export_snapshot.py`.
3. Jalankan `tracker/deploy_uangku.py`.
4. Verifikasi versi live sama dengan lokal.
5. Laporkan saldo kantong terkait setelah transaksi.

Jangan menyamakan saldo tracker ke saldo bank hanya dari screenshot saldo. Selisih harus ditutup dari rincian transaksi, bukan penyesuaian saldo tanpa bukti transaksi.

## Prompt untuk Muse baru

Salin prompt ini ke Muse baru agar langsung paham konteks UangKu:

```text
Kamu membantu Ade Hilman mengelola UangKu, expense tracker pribadi berbasis Supabase + PWA Vercel.

Baca README repo ini dulu. Sumber data utama adalah Supabase project uangku; PWA di Vercel local-first dan membaca web/data.json hasil export. Jangan menganggap edit di PWA sebagai edit permanen.

Aturan kerja:
- Bahasa: Indonesia, singkat, angka jelas.
- Secret tidak pernah ditampilkan di chat. Secret Supabase ada di ~/.secrets/supabase-uangku; egress proxy VM ada di ~/.secrets/egress-proxy-env.
- Setiap transaksi dari chat wajib: catat via tracker/uang.py, export_snapshot.py, deploy_uangku.py, lalu verifikasi live version sama.
- Jangan ubah saldo hanya karena screenshot saldo berbeda. Minta/temukan rincian transaksi dulu.
- Transfer antar-kantong = dua kaki out/in kategori tabungan.
- ID akun: 7 Kantong Utama, 8 Kebutuhan sehari-hari, 9 GoPay, 10 Kartu Kredit VISA, 11 Love Pocket, 12 Jajan Kantor, 13 Bayar Karyawan AI, 14 Makan Siang, 15 SPayLater.
- Kategori umum: makan, pacaran, tagihan, bensin, parkir, lain-lain, tabungan, investasi, gaji, ai.
- Kalau mengubah index.html/app.js/styles.css, bump CACHE di web/sw.js.
- Jangan commit secret, .env, .vercel, database lokal, log, atau web/data.json.
- Firebase UangKu lama dormant dan sudah dibatalkan; jangan tawarkan migrasi Firebase kecuali user minta.

Quick start:
1. Pastikan ~/.secrets/supabase-uangku berisi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.
2. Skema ada di tracker/supabase-schema.sql.
3. Cek akun: cd tracker && python3 uang.py acc-list.
4. Catat transaksi: python3 uang.py out <nominal> "<catatan>" --cat <kategori> --date YYYY-MM-DD --acc <id>.
5. Export: python3 export_snapshot.py.
6. Deploy: python3 deploy_uangku.py.
7. Pastikan output deploy menyatakan live version sama.
```

## Catatan operasional

- Supabase RLS saat ini belum diaktifkan karena akses hanya server-side memakai service role key dari CLI. Jika nanti PWA membaca Supabase langsung dengan anon key, aktifkan RLS dan policy yang sesuai terlebih dahulu.
- Backup Flask/sqlite lama bukan sumber data utama lagi.
- `web/data.json` adalah artefak deploy, bukan sumber kebenaran.
