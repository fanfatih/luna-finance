# Luna Finance

Aplikasi desktop Windows untuk keuangan Lunatopup dan Lunapremium. Data tersimpan lokal di komputer kamu (SQLite), jadi jalan tanpa internet.

Nama "Luna Finance" masih sementara. Logonya cuma tulisan, belum ada logo sungguhan.

## Isi rilis pertama

- **Lunatopup > Data Keuangan**: catat saldo akhir tiap channel (Seabank, Flip, Jago, Gopay, Duitku, Digiflazz), profit harian dihitung otomatis dari selisih saldo, dashboard, data utang-piutang, laporan + ekspor CSV.
- **Lunapremium App**: pricelist, data customer, rekap langganan per aplikasi (termasuk tim Canva), pengingat langganan hampir habis.
- PIN, tema terang/gelap/ikut Windows, cadangan harian otomatis (30 terakhir), backup dan restore manual, autostart bersama Windows, ikon tray.

- **Sinkron cloud** ke Supabase milikmu sendiri (project `luna-finance`), otomatis saat aplikasi dibuka dan tiap 10 menit, plus tombol **Perbarui data** di pojok atas.
- **Bot Telegram** untuk catat dan cek utang-piutang dari HP.

Menu lain (Momentum, Pribadi, Top Spender, Voucher) tampil sebagai "Segera hadir".

## Rumus profit

```
Profit = (saldo akhir - saldo awal) - modal masuk + modal keluar
         + piutang baru - piutang dibayar - utang baru + utang dibayar
```

Dihitung saat ditampilkan, tidak disimpan. Contoh: saldo awal Rp1.000.000, akhir Rp850.000, piutang baru Rp200.000, maka profit Rp50.000.

Uang utang-piutang dan setor/tarik modal tidak ikut dihitung sebagai profit.

## Cara paling gampang: rilis lewat GitHub (tanpa install apa-apa)

1. Kode ada di repo GitHub (repo harus **public** supaya update otomatis bisa jalan).
2. Buka tab **Actions**, pilih **Rilis Windows**, klik **Run workflow**.
3. Tunggu sekitar 10 menit. Hasilnya muncul di **Releases** sebagai `Luna Finance v<versi>`, berisi installer `.exe`.
4. Jalankan installer. SmartScreen akan memperingatkan karena aplikasi belum ditandatangani Microsoft. Klik **More info**, lalu **Run anyway**.

Prasyarat sekali saja: tambah secret `TAURI_SIGNING_PRIVATE_KEY` di Settings repo, Secrets and variables, Actions. Isinya kunci penandatangan update (jangan dibagikan ke siapa pun).

## Update aplikasi

Aplikasi mengecek Releases saat dibuka. Kalau ada versi baru, muncul pemberitahuan, lalu pasang lewat **Pengaturan, Pembaruan aplikasi, Pasang dan mulai ulang**. Data tidak terhapus.

Untuk merilis versi baru: naikkan angka versi di `package.json`, `src-tauri/Cargo.toml`, dan `src-tauri/tauri.conf.json` (ketiganya sama), push, lalu jalankan workflow **Rilis Windows**.

## Build di laptop sendiri

Perlu dipasang dulu:

1. [Node.js](https://nodejs.org) 20 atau lebih baru.
2. [Rust](https://rustup.rs).
3. **Microsoft C++ Build Tools** (pilih workload "Desktop development with C++"). WebView2 sudah ada di Windows 11.

Lalu di folder proyek:

```
npm install
npm run tauri dev       # mode pengembangan
npm run tauri build     # bikin installer, hasilnya di src-tauri/target/release/bundle/nsis
```

Build pertama lama (Rust mengompilasi banyak paket). Build berikutnya jauh lebih cepat.

## Coba tampilannya di browser saja

```
npm install
npm run dev
```

Buka http://localhost:1420. Di browser data disimpan di localStorage, cocok buat coba-coba. Tombol jendela, notifikasi Windows, autostart, dan cadangan harian hanya aktif di aplikasi desktop.

## Perintah lain

```
npm test       # 62 tes (parser nominal, profit, utang, premium, backup, sinkron)
npm run build  # cek tipe + build web
```

## Catatan keamanan

- PIN mengunci tampilan dan mengenkripsi password customer yang disimpan (AES-GCM, kunci dari PIN). Lupa PIN berarti password tersimpan tidak bisa dibuka lagi.
- PIN tidak mengenkripsi file database. Kalau laptop dipakai bareng orang lain, aktifkan BitLocker.
- Tombol tutup (X) menyembunyikan aplikasi ke tray supaya pengingat tetap jalan. Keluar penuh lewat klik kanan ikon tray, pilih **Keluar**.
- Aplikasi tidak ditandatangani, jadi SmartScreen akan muncul saat pertama install.

## Lokasi data (Windows)

- Database: `%APPDATA%\id.lunatopup.finance\luna.db`
- Cadangan harian: `%APPDATA%\id.lunatopup.finance\backups\`

## Sinkron cloud dan bot Telegram

Kode server ada di `supabase/functions` (`sync` dan `telegram`). Tabel dan fungsi `sync_push` sudah dibuat di project Supabase. Semua tabel memakai RLS tanpa kebijakan, jadi hanya Edge Function (service role) yang bisa membaca atau menulis. Akses ke fungsi dijaga `SYNC_KEY`.

Secret yang dibutuhkan (Supabase, Edge Functions, Secrets):

- `SYNC_KEY`: kunci panjang acak, sama dengan yang diisi di aplikasi (Pengaturan, Sinkron cloud).
- `TELEGRAM_BOT_TOKEN`: dari @BotFather.
- `TELEGRAM_OWNER_ID`: ID Telegram kamu. Sebelum diisi, bot hanya membalas `/start` dengan ID pengirim.

Setelah secret terisi, buka sekali `https://<project>.supabase.co/functions/v1/telegram?setup=<SYNC_KEY>` di browser untuk memasang webhook dan daftar perintah bot.

Perintah bot: `/piutang Budi 200rb`, `/utang Budi 200rb`, `/terima Budi 50rb`, `/bayar Budi 50rb`, `/saldo [nama]`, `/daftar`, `/bantuan`. Catatan lewat bot ikut menghitung profit hari itu setelah aplikasi sinkron.

Aturan konflik sinkron: catatan dengan waktu ubah terbaru menang. Salah catat di bot dikoreksi lewat aplikasi desktop.

## Belum ada

- Logo dan nama final.
- Bot belum bisa mengisi saldo channel atau menampilkan profit, hanya utang-piutang.
- Aplikasi ini belum pernah dijalankan di Windows asli. Seluruh logika dan tampilan sudah dites di browser, tapi bagian cangkang desktop (tray, autostart, notifikasi, jendela kustom) baru bisa dibuktikan setelah build pertama di Windows. Kalau ada yang error di sana, kirim pesan errornya.
