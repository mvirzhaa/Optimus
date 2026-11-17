# Optimus — Simulator Lalu Lintas & Kapasitas Jalan (PKJI 2023)

Aplikasi simulator mikrosimulasi lalu lintas di peramban + visualisasi 3D (Three.js) dengan penyimpanan proyek, analisis statistik PKJI 2023, laporan Word/PDF, peta OpenStreetMap (OSM), dan validasi skenario Eclipse SUMO.

Dilengkapi dukungan penuh untuk subpath reverse proxy seperti `utility.uika-bogor.ac.id/optimus`.

---

## 1. Menjalankan di Lokal

### Opsi A: Instan Tanpa Server (Mode Standalone)
Cukup buka berkas `optimus.html` langsung dengan peramban (Chrome, Edge, Firefox).
- Tidak membutuhkan instalasi server atau database.
- Proyek disimpan secara lokal di peramban.

### Opsi B: Menggunakan Docker Compose (Full Stack)
```bash
# 1. Salin konfigurasi environment
cp .env.example .env

# 2. Jalankan PostgreSQL, Python FastAPI, dan Node.js Express
docker compose up -d --build
```
Aplikasi akan aktif di `http://localhost:3004`.

### Opsi C: Manual Tanpa Docker
1. **Basis Data**: Siapkan PostgreSQL (db: `optimus`, user: `optimus`).
2. **Layanan Python** (port 8001):
   ```bash
   cd optimus/python
   python -m venv .venv
   source .venv/bin/activate  # atau .venv\Scripts\activate di Windows
   pip install -r requirements.txt
   uvicorn app.main:app --port 8001
   ```
3. **Server Node.js** (port 3004):
   ```bash
   cd optimus/node
   npm install
   npm start
   ```

---

## 2. Deploy ke Server (GitHub & Docker)

### Langkah 1: Push ke GitHub
```bash
git init
git add .
git commit -m "feat: initial commit Optimus with subpath support"
git branch -M main
git remote add origin https://github.com/<USERNAME>/<REPO_NAME>.git
git push -u origin main
```

### Langkah 2: Setup di Server
```bash
# Clone repo di server
cd /var/www  # atau direktori deployment Anda
git clone https://github.com/<USERNAME>/<REPO_NAME>.git optimus-app
cd optimus-app

# Konfigurasi environment
cp .env.example .env
nano .env  # Atur DB_PASSWORD yang aman

# Jalankan container
docker compose up -d --build
```

---

## 3. Konfigurasi Nginx (`utility.uika-bogor.ac.id/optimus`)

Tambahkan blok lokasi berikut ke dalam konfigurasi Nginx `utility.uika-bogor.ac.id`:

```nginx
    # =========================================================
    # 7. Optimus (Simulator Lalu Lintas & PKJI 2023)
    # =========================================================
    location = /optimus {
        return 301 /optimus/;
    }
    location /optimus/ {
        proxy_pass http://127.0.0.1:3004/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix /optimus;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
```

Setelah konfigurasi disimpan, lakukan uji dan reload Nginx:
```bash
sudo nginx -t && sudo systemctl reload nginx
```
