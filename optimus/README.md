# Optimus — simulator lalu lintas di peramban + server penyimpanan

Aplikasi Optimus (NetEdit, demand, lampu lalu lintas, detektor, flyover/underpass, TraCI, emisi)
dengan server untuk **menyimpan proyek dan membukanya lagi** dari perangkat mana pun.

| Bagian | Teknologi | Tugas |
|---|---|---|
| `web/` | HTML + JavaScript | Antarmuka & mesin simulasi (dibangun jadi `node/public/index.html`) |
| `node/` | Node.js + Express | Melayani aplikasi web, akun, REST API proyek/versi/hasil simulasi, ekspor XML SUMO |
| `python/` | Python + FastAPI | Analisis statistik (persentil, LOS, profil 15 menit), perbandingan hasil, menjalankan skenario di **Eclipse SUMO asli** |
| `db/` | PostgreSQL | Skema: `users`, `sessions`, `projects`, `project_versions`, `runs` |

```
peramban ──HTTP──> Node (port 3000) ──SQL──> PostgreSQL
                       │                          ▲
                       └──HTTP──> Python (8001) ──┘  (+ netconvert/sumo)
```

## Fitur simulasi (versi 1.1)
- **Lalu lintas lajur kiri (Indonesia)** — posisi lajur, aturan belok, bundaran searah jarum jam, ekspor `lefthand` ke SUMO.
- **Sepeda motor sublane** — motor menyelip di antara mobil dan berjajar di garis henti (bisa dimatikan di tab Simulasi).
- **Emisi terkalibrasi** terhadap Eclipse SUMO 1.28: HBEFA3 (mobil, LDV, kendaraan berat), HBEFA4 sepeda motor ≤250 cc Euro-3, model energi kendaraan listrik.
- **PKJI 2023** di tab Output: SMP/EMP, arus jenuh, kapasitas, derajat kejenuhan, panjang antrean & tundaan (rumus PKJI dan hasil simulasi), tingkat pelayanan PM 96/2015, kapasitas ruas.
- **Bundaran** (NetEdit › simpul › Jadikan bundaran) dan **satu program lampu untuk beberapa simpang** (tab Lampu › Gabungkan).
- **Pejalan kaki**: zebra cross (dengan tingkat kepatuhan pengemudi), pelican crossing bertombol, penyeberangan ikut lampu simpang.
- **Angkutan umum**: halte, trayek bus/angkot dengan selang waktu dan waktu henti, angkot "ngetem" acak di tepi jalan.
- **Ambil peta OSM** dari area peta (cari lokasi → pilih area → unduh), lewat server (Overpass & Nominatim).
- **RL lampu lalu lintas** (Q-learning) dengan grafik pembelajaran dan pembanding tetap/aktuasi/RL; contoh skrip TraCI Python Q-learning.
- **Tampilan 3D** (Three.js, disajikan lokal oleh server) termasuk flyover bertiang, underpass, halte, pejalan kaki dan lampu.
- **Perbandingan berdampingan**: dua skenario (salinan, contoh, atau versi proyek lain) berjalan serempak dengan tabel indikator.

## Fitur penyimpanan
- Daftar akun & masuk (kata sandi di-hash scrypt, token sesi hanya disimpan sebagai SHA-256).
- **Simpan** (Ctrl+S) membuat versi baru; semua versi lama tetap bisa dibuka atau dipulihkan.
- Pencegahan timpa: bila proyek sudah disimpan dari tempat lain, server menolak (409) dan Anda bisa “Simpan sebagai baru”.
- Proyek terakhir dibuka otomatis saat aplikasi dibuka lagi; penanda `•` di pojok kanan atas berarti ada perubahan belum disimpan.
- Duplikat, ganti nama, hapus proyek; ekspor `.nod.xml`, `.edg.xml`, `.con.xml`, `.tll.xml`, `.rou.xml`, `.add.xml`, `.sumocfg`, `.net.xml` serta skrip `build.sh`/`build.bat` dari server.
- **Membuka di SUMO desktop**: taruh semua berkas ekspor dalam satu folder lalu jalankan `build.bat` (Windows) atau `sh build.sh` (Linux/macOS). Skrip memanggil `netconvert` untuk membangun `.net.xml` dari nod/edg/con/tll (lajur & program lampu Optimus dipertahankan) lalu membuka `sumo-gui`. Berkas `.net.xml` yang langsung diekspor Optimus dimaksudkan untuk dibaca ulang oleh Optimus; SUMO menolaknya karena tidak memuat *internal edge* buatan netconvert.
- **Hasil simulasi** disimpan per versi proyek (ringkasan, tripinfo, detektor, emisi) lalu bisa dianalisis dan dibandingkan.
- **Berbagi proyek** ke pengguna lain (hak *lihat* atau *edit*) dan **tautan publik hanya-baca** (`/?p=<token>`).
- **Laporan Word / PDF** per hasil simulasi: ringkasan temuan, peta jaringan, data lalu lintas, program lampu, grafik, tabel PKJI 2023, pejalan kaki & halte, perbandingan dengan hasil lain yang dicentang.
- **Jalankan di SUMO asli**: server membangun jaringan dengan `netconvert` (memakai koneksi lajur & program lampu dari Optimus) lalu menjalankan `sumo`; hasilnya tersimpan sebagai run `engine = sumo` untuk dibandingkan dengan hasil peramban.

Tanpa server (berkas HTML dibuka langsung), aplikasi tetap berjalan dan proyek disimpan di peramban saja.

## Menjalankan di Ubuntu (diuji: Ubuntu 24.04, Node 22, Python 3.13, PostgreSQL 16)

```bash
# 1) PostgreSQL
sudo apt install postgresql
sudo -u postgres psql -c "CREATE ROLE optimus LOGIN PASSWORD 'GANTI_SANDI';"
sudo -u postgres createdb -O optimus optimus
sudo -u postgres psql -d optimus -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# 2) konfigurasi
cp .env.example .env        # ubah DATABASE_URL
set -a; . ./.env; set +a

# 3) layanan Python (port 8001)
cd python
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt          # termasuk eclipse-sumo (±100 MB)
uvicorn app.main:app --port 8001 &
cd ..

# 4) server Node (port 3000) — migrasi basis data berjalan otomatis saat start
cd node
npm ci
npm start
```
Buka `http://localhost:3000`, pilih tab **Proyek**, daftar akun, lalu simpan skenario.

Paket tambahan untuk laporan PDF di Ubuntu: `sudo apt install libreoffice-writer-nogui fonts-crosextra-carlito`.

### Docker
```bash
DB_PASSWORD=sandi-kuat docker compose up -d --build
```
`docker compose config` valid dan tiap langkah image sudah dicoba setara di Ubuntu (instal dari lockfile, start dengan `DB_DIR`, health check). Build image sungguhan **belum** bisa diuji di lingkungan pengembangan karena registry Docker Hub diblokir di sana.

### Mengubah antarmuka
Sumber ada di `web/src/`. Setelah mengubah, jalankan `python3 web/build.py` untuk menghasilkan
`node/public/index.html` dan menyalin inti simulasi ke `node/src/optimus-core.js`
(dipakai server untuk ekspor XML agar hasilnya sama dengan di peramban).

### Uji
```bash
cd node && npm run test:api        # server harus sedang berjalan
cd node && npm run test:features   # PKJI, laporan, berbagi, tautan publik, OSM
```

## REST API (ringkas)
Semua endpoint selain `/api/health`, `/api/auth/register`, `/api/auth/login` memerlukan header `Authorization: Bearer <token>`.

| Metode | Endpoint | Fungsi |
|---|---|---|
| GET | `/api/health` | status DB, Python, versi SUMO |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | akun |
| GET | `/api/auth/me` · POST `/api/auth/password` | profil · ganti sandi |
| GET / POST | `/api/projects` | daftar (`?q=`) / buat proyek |
| GET / PUT / PATCH / DELETE | `/api/projects/:id` | buka (`?version=`) / simpan versi baru (`baseVersion`) / ganti nama / hapus |
| GET | `/api/projects/:id/versions` · POST `/versions/:v/restore` | riwayat versi · pulihkan |
| POST | `/api/projects/:id/duplicate` | salin proyek |
| GET | `/api/projects/:id/export` (`?file=`) | berkas XML SUMO |
| GET / POST | `/api/projects/:id/runs` | daftar / simpan hasil simulasi |
| GET / DELETE | `/api/runs/:id` · GET `/api/runs/:id/analysis` | hasil · analisis (Python) |
| POST | `/api/runs/compare` | bandingkan 2–8 hasil (Python) |
| POST | `/api/projects/:id/verify` | jalankan di SUMO asli (Python + eclipse-sumo) |
| GET / POST / DELETE | `/api/projects/:id/shares` (`/:username`) | daftar / bagikan (`view`/`edit`) / cabut |
| POST | `/api/projects/:id/public` | aktif/nonaktifkan tautan publik |
| GET | `/api/public/:token` | buka proyek publik tanpa login |
| GET | `/api/runs/:id/report?format=docx` atau `pdf`, `&compare=<run>` | laporan Word/PDF |
| GET | `/api/osm?s=&w=&n=&e=` · `/api/geocode?q=` | jaringan OSM area (Overpass) · cari lokasi (Nominatim) |

### Variabel lingkungan tambahan
`OVERPASS_URL`, `NOMINATIM_URL` (default server publik OSM), `OSM_MAX_KM2` (batas luas area, default 6), `GEOCODE_COUNTRY` (default `id`).

## Catatan & keterbatasan
- Faktor emisi per detik sama dengan SUMO (selisih total ≤2% pada siklus uji), tetapi total CO₂ per skenario masih berbeda sekitar 2–22% karena perilaku pengemudi (percepatan/berhenti) tidak identik.
- Pejalan kaki dan penyeberangan **tidak** diekspor ke SUMO asli; halte, trayek dan sublane sepeda motor diekspor.
- PKJI untuk hasil "SUMO asli" belum tersedia (data per pendekat hanya dicatat oleh simulasi Optimus).
- Jaringan besar yang sangat padat dengan beberapa simpang digabung dalam satu siklus panjang dapat macet total (gridlock) lebih cepat di Optimus dibanding SUMO; untuk kasus seperti ini verifikasi dengan tombol "Jalankan di SUMO asli".
- Tampilan 3D dan TraCI Python mengunduh Three.js/Pyodide dari CDN bila aplikasi dibuka sebagai berkas HTML tanpa server (perlu internet). Lewat server, Three.js disajikan lokal.
- RL memakai Q-learning tabel sederhana; untuk penelitian lanjutan gunakan skrip TraCI Python.
- Simulasi utama tetap berjalan di peramban; server hanya menyimpan dan menganalisis
  (kecuali fitur SUMO asli yang berjalan di server).
- `PUBLIC` deployment: pasang di belakang HTTPS (nginx/caddy), set `TRUST_PROXY=1`, dan ganti sandi basis data.
